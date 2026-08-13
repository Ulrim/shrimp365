#!/usr/bin/env python3
"""Shrimp365 수질 센서 수집기 (라즈베리파이용)

RS-485(MODBUS-RTU)로 연결된 디지털 센서에서 수온·pH·DO·염도를 읽어
Shrimp365 서버로 올린다.

지원 센서 (Nengshi 디지털 센서 프로토콜)
  - pH/ORP      기본 슬레이브 ID 1
  - DO          기본 슬레이브 ID 3
  - EC/TDS/염도  기본 슬레이브 ID 4

통신 규격: 9600bps, 8N1, RS-485, MODBUS-RTU
측정값 읽기: 기능코드 04 로 입력 레지스터 0x0000 부터 16개

레지스터는 "값"과 "소수점+단위"가 짝을 이룬다.
  예) 0x0000 = pH 원시값(0~1400), 0x0001 = 상위바이트 소수 자릿수 / 하위바이트 단위코드
  실제 값 = 원시값 / 10^소수자릿수
"""

from __future__ import annotations

import argparse
import configparser
import json
import logging
import os
import signal
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

try:
    import serial  # pyserial
except ImportError:  # pragma: no cover
    sys.exit("pyserial 이 필요합니다.  pip install pyserial")

# LCD·상태 페이지는 선택 사항. 파일이 없어도 수집은 그대로 동작해야 한다.
try:
    import display as display_mod
except ImportError:  # pragma: no cover
    display_mod = None

try:
    import webui
except ImportError:  # pragma: no cover
    webui = None

try:
    import wifi as wifi_mod
except ImportError:  # pragma: no cover
    wifi_mod = None

try:
    import buffer as buffer_mod
except ImportError:  # pragma: no cover
    buffer_mod = None

try:
    import history as history_mod
except ImportError:  # pragma: no cover
    history_mod = None

VERSION = "1.6.8"
log = logging.getLogger("shrimp365")


# ── MODBUS-RTU ────────────────────────────────────────────────────────────────

def crc16(payload: bytes) -> bytes:
    """MODBUS CRC16. 반환은 전송 순서(하위 바이트 먼저)."""
    crc = 0xFFFF
    for byte in payload:
        crc ^= byte
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return struct.pack("<H", crc)


class ModbusError(RuntimeError):
    pass


class ModbusClient:
    """센서 여러 대가 같은 RS-485 선을 공유하므로 포트 하나를 돌려 쓴다."""

    def __init__(self, port: str, baudrate: int = 9600, timeout: float = 1.0):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self._ser: serial.Serial | None = None
        # 마지막으로 선을 쓴 시각. 다음 프레임을 언제 보낼 수 있는지 계산한다.
        self._last_use = 0.0

    def _frame_gap(self) -> float:
        """MODBUS-RTU 가 요구하는 프레임 간 침묵(3.5 문자 시간).

        이 간격을 안 두면 앞 기기의 응답 꼬리가 아직 선에 남은 채로 다음
        질문을 보내게 된다. 그 잔여 바이트가 다음 기기의 응답으로 읽혀
        "응답 없음" 이나 CRC 오류가 난다. 센서를 여러 대 물렸을 때만
        나타나므로 배선 문제로 오해하기 쉽다.

        8N1 은 문자당 11비트다. 9600bps 에서 3.5문자 = 약 4ms.
        너무 짧으면 USB 변환기의 송수신 전환이 못 따라오므로 여유를 둔다.
        """
        return max(0.008, 3.5 * 11.0 / self.baudrate)

    def _await_gap(self) -> None:
        idle = time.monotonic() - self._last_use
        gap = self._frame_gap()
        if idle < gap:
            time.sleep(gap - idle)

    def open(self) -> None:
        if self._ser and self._ser.is_open:
            return
        self._ser = serial.Serial(
            port=self.port,
            baudrate=self.baudrate,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            timeout=self.timeout,
        )

    def close(self) -> None:
        if self._ser and self._ser.is_open:
            self._ser.close()
        self._ser = None

    def read_input_registers(self, slave_id: int, start: int, count: int) -> list[int]:
        """기능코드 04. 반환은 부호 있는 16비트 정수 목록."""
        if self._ser is None or not self._ser.is_open:
            self.open()
        assert self._ser is not None

        request = struct.pack(">BBHH", slave_id, 0x04, start, count)
        frame = request + crc16(request)

        # 앞 프레임이 끝난 뒤 충분히 조용해질 때까지 기다렸다가 버퍼를 비운다.
        # 순서가 중요하다 — 먼저 비우면 그 뒤에 도착하는 꼬리를 못 걸러 낸다.
        self._await_gap()
        self._ser.reset_input_buffer()
        self._ser.write(frame)

        # 응답: ID(1) 기능코드(1) 바이트수(1) 데이터(2*count) CRC(2)
        expected = 5 + count * 2
        response = self._ser.read(expected)
        self._last_use = time.monotonic()
        if len(response) < 5:
            raise ModbusError(f"ID {slave_id}: 응답 없음 (배선·전원·슬레이브 ID 확인)")

        if response[0] != slave_id:
            raise ModbusError(f"ID {slave_id}: 다른 기기가 응답함({response[0]})")
        if response[1] & 0x80:
            raise ModbusError(f"ID {slave_id}: 예외 응답 코드 {response[2]}")
        if crc16(response[:-2]) != response[-2:]:
            raise ModbusError(f"ID {slave_id}: CRC 불일치 (노이즈·종단저항 확인)")

        byte_count = response[2]
        data = response[3:3 + byte_count]
        return [struct.unpack(">h", data[i:i + 2])[0] for i in range(0, len(data), 2)]

    def write_register(self, slave_id: int, register: int, value: int) -> None:
        """기능코드 06. 센서 설정을 바꾼다(슬레이브 ID 변경 등).

        응답은 보낸 것을 그대로 되돌려주는 형태다. 그래서 정말 바뀌었는지
        확인할 수 있다.
        """
        if self._ser is None or not self._ser.is_open:
            self.open()
        assert self._ser is not None

        request = struct.pack(">BBHH", slave_id, 0x06, register, value)
        frame = request + crc16(request)

        self._await_gap()
        self._ser.reset_input_buffer()
        self._ser.write(frame)

        response = self._ser.read(8)
        self._last_use = time.monotonic()
        if len(response) < 8:
            raise ModbusError(f"ID {slave_id}: 응답 없음 (배선·전원·슬레이브 ID 확인)")
        if crc16(response[:-2]) != response[-2:]:
            raise ModbusError(f"ID {slave_id}: CRC 불일치 (노이즈·종단저항 확인)")
        if response[1] & 0x80:
            raise ModbusError(f"ID {slave_id}: 쓰기를 거부했습니다(코드 {response[2]})")

        echoed_reg, echoed_val = struct.unpack(">HH", response[2:6])
        if echoed_reg != register or echoed_val != value:
            raise ModbusError(
                f"되돌아온 값이 다릅니다 (레지스터 {echoed_reg:#06x}, 값 {echoed_val})")


# ── 값 해석 ───────────────────────────────────────────────────────────────────

# 프로토콜 문서 마지막 장의 단위 코드표
UNITS = {
    0x00: "mV", 0x01: "nA", 0x02: "uA", 0x03: "mA", 0x04: "ohm", 0x05: "kohm",
    0x06: "Mohm", 0x07: "uS", 0x08: "mS", 0x09: "S", 0x0A: "pH", 0x0B: "C",
    0x0C: "F", 0x0D: "ug/L", 0x0E: "mg/L", 0x0F: "g/L", 0x10: "ppb",
    0x11: "ppm", 0x12: "ppt", 0x13: "%", 0x14: "mbar", 0x15: "bar",
    0x16: "mmHg", 0x17: "ppt",
}


def decode(regs: list[int], value_idx: int) -> tuple[float, str] | None:
    """값 레지스터와 그 다음의 '소수점+단위' 레지스터를 함께 읽어 실수로 바꾼다.

    소수점+단위 레지스터는 상위 바이트가 소수 자릿수, 하위 바이트가 단위 코드다.
    """
    if value_idx + 1 >= len(regs):
        return None

    raw = regs[value_idx]
    meta = regs[value_idx + 1] & 0xFFFF  # 부호 없는 원래 비트로 되돌린다
    decimals = (meta >> 8) & 0xFF
    unit = UNITS.get(meta & 0xFF, "")

    if decimals > 4:  # 센서가 아직 준비되지 않았을 때 나오는 쓰레기값 방어
        return None

    return raw / (10 ** decimals), unit


# ── 센서 정의 ─────────────────────────────────────────────────────────────────

@dataclass
class SensorSpec:
    """센서 한 대에서 어떤 레지스터를 읽어 어떤 이름으로 보낼지."""
    key: str
    slave_id: int
    # {보낼 이름: 값 레지스터 번호}
    fields: dict[str, int] = field(default_factory=dict)


# 값 레지스터 위치는 프로토콜 문서 기준.
# 수온은 세 센서 모두 0x0008 에 있으므로 아래 우선순위대로 하나만 채택한다.
SENSOR_SPECS: dict[str, SensorSpec] = {
    "ph": SensorSpec("ph", 1, {"ph": 0x0000, "orp": 0x0004, "temperature": 0x0008}),
    "do": SensorSpec("do", 3, {"do_level": 0x0000, "do_saturation": 0x0002, "temperature": 0x0008}),
    # 염도(0x0006)는 읽지 않는다. 민물에서 132 ppt 처럼 말이 안 되는 값이 나와
    # 믿을 수 없다. 대신 전도도에서 직접 환산한다(아래 salinity_from_ec).
    "ec": SensorSpec("ec", 4, {"conductivity": 0x0000, "tds": 0x0002, "temperature": 0x0008}),
}

# 화면에 띄울 이름. 코드 안의 key 를 그대로 보여 주면 알아보기 어렵다.
SENSOR_LABELS = {"ph": "pH / ORP", "do": "용존산소", "ec": "전도도 / 염도"}

# 수온을 어느 센서 것으로 쓸지. 앞에 있는 것부터 우선.
#
# DO 를 먼저 본다. 용존산소는 수온에 따라 포화 농도가 크게 달라져서 변환기가
# 자기 수온으로 보정해 값을 낸다. 그 보정에 쓰인 수온과 화면·기록에 남는 수온이
# 다르면, 나중에 "이 DO 값이 왜 이런가" 를 따져 볼 때 근거가 어긋난다.
# DO 센서가 없을 때만 pH → EC 순으로 대신 쓴다.
TEMPERATURE_PRIORITY = ("do", "ph", "ec")

# 서버가 수질 기록으로 저장하는 항목. 나머지는 참고용으로 함께 보내되
# 기기 카드의 "마지막 수신값"에만 남는다.
STORED_FIELDS = {"temperature", "ph", "do_level", "salinity"}


# 첫 레지스터의 단위 코드로 어떤 센서인지 짐작한다.
# 값을 읽는 데 쓰는 것이 아니라 "ID 3 에 뭐가 붙어 있나" 를 알려 주기 위함이다.
UNIT_TO_SENSOR = {
    "pH": "pH 센서", "mV": "ORP 센서",
    "mg/L": "DO 센서", "ug/L": "DO 센서",
    "uS": "EC 센서", "mS": "EC 센서", "S": "EC 센서",
    "ppm": "EC 센서(TDS)", "ppt": "EC 센서(염도)",
}


# 슬레이브 ID 가 들어 있는 설정 레지스터. 제조사 프로토콜 문서 기준.
#   예) 01 06 00 1E 00 04  →  1번 기기를 4번으로 바꾼다
SLAVE_ID_REGISTER = 0x001E


# 첫 레지스터의 단위로 어느 변환기인지 가른다.
# pH 변환기는 pH, DO 변환기는 mg/L, EC 변환기는 전도도 단위를 첫 값으로 낸다.
UNIT_TO_KEY = {
    "pH": "ph",
    "mg/L": "do", "ug/L": "do",
    "uS": "ec", "mS": "ec", "S": "ec",
}


def _pad(text: str, width: int) -> str:
    """한글은 터미널에서 두 칸을 차지한다. 그대로 ljust 하면 표가 어긋난다."""
    shown = sum(2 if ord(ch) > 0x2000 else 1 for ch in text)
    return text + " " * max(0, width - shown)


def classify(regs: list[int]) -> str | None:
    """읽어 온 레지스터를 보고 어느 변환기인지 가려낸다. 모르면 None."""
    decoded = decode(regs, 0x0000)
    if decoded is None:
        return None
    return UNIT_TO_KEY.get(decoded[1])


def auto_assign(client: ModbusClient, first: int = 1, last: int = 32) -> dict:
    """선을 훑어 어느 번호에 어떤 센서가 있는지 알아내고 배치를 제안한다.

    설정 파일에 적힌 번호가 실제와 다를 때, 사람이 하나씩 맞춰 보는 대신
    "값이 나오는 자리"를 그대로 쓰면 된다. 센서에 쓰기를 하지 않으므로
    잘못돼도 되돌릴 것이 없다 — 우리 쪽 설정만 고친다.
    """
    assign: dict[str, int] = {}
    conflicts: dict[str, list[int]] = {}
    others: list[dict] = []

    for slave_id in range(first, last + 1):
        try:
            regs = client.read_input_registers(slave_id, 0x0000, 16)
        except (ModbusError, serial.SerialException):
            continue

        key = classify(regs)
        decoded = decode(regs, 0x0000)
        note = f"{decoded[0]} {decoded[1]}".strip() if decoded else "값 해석 실패"

        if key is None:
            others.append({"id": slave_id, "note": note})
            continue
        if key in assign:
            # 같은 종류가 둘이면 어느 쪽을 쓸지 사람이 정해야 한다.
            conflicts.setdefault(key, [assign[key]]).append(slave_id)
            continue
        assign[key] = slave_id

    return {
        "assign": assign,
        "conflicts": conflicts,
        "others": others,
        "missing": [k for k in SENSOR_SPECS if k not in assign],
    }


def dump_registers(client: ModbusClient, slave_id: int) -> list[str]:
    """레지스터 16개를 있는 그대로 보여 준다.

    값이 이상할 때(민물인데 염도가 132 ppt 라든지) 우리 해석이 틀린 것인지
    센서가 이상한 것인지 가리려면 원본을 봐야 한다. 레지스터는 값과
    "소수점+단위" 가 짝이므로 짝수 자리마다 해석을 함께 붙인다.
    """
    regs = client.read_input_registers(slave_id, 0x0000, 16)
    lines = []
    for i in range(0, len(regs), 2):
        raw, meta = regs[i], regs[i + 1] & 0xFFFF
        decimals, unit_code = (meta >> 8) & 0xFF, meta & 0xFF
        unit = UNITS.get(unit_code, f"?({unit_code:#04x})")
        decoded = decode(regs, i)
        shown = f"{decoded[0]:g} {decoded[1]}".strip() if decoded else "해석 불가"
        lines.append(
            f"  0x{i:04X}  원시 {raw:>7}   소수 {decimals}자리  단위 {unit:<6}  →  {shown}"
        )
    return lines


def scan_bus(client: ModbusClient, first: int, last: int) -> list[tuple[int, str, str]]:
    """선에 물려 있는 슬레이브 ID 를 훑는다.

    센서 하나만 안 읽힐 때 원인은 대개 슬레이브 ID 다. 출고 기본값과 다르게
    설정되어 나오는 경우가 있고, 같은 ID 가 둘이면 서로를 가린다.
    설정을 고치기 전에 "지금 선에 무엇이 붙어 있는지" 부터 보는 편이 빠르다.
    """
    found: list[tuple[int, str, str]] = []
    for slave_id in range(first, last + 1):
        try:
            regs = client.read_input_registers(slave_id, 0x0000, 16)
        except (ModbusError, serial.SerialException):
            continue  # 응답 없음 — 그 자리에 아무것도 없다는 뜻

        decoded = decode(regs, 0x0000)
        if decoded is None:
            found.append((slave_id, "?", "응답함(값 해석 실패)"))
            continue
        value, unit = decoded
        kind = UNIT_TO_SENSOR.get(unit, "알 수 없음")
        found.append((slave_id, kind, f"첫 값 {value} {unit}".strip()))
    return found


# 전도도에서 염도를 환산할 때 쓰는 계수.
# 물에 녹은 소금이 많을수록 전기가 잘 통한다는 성질을 쓰는 것으로, TDS 계측기가
# 흔히 쓰는 NaCl 기준값이다. 물의 조성에 따라 0.5~0.7 사이에서 달라지므로
# 설정에서 바꿀 수 있게 해 둔다(정밀 측정이 필요하면 굴절계로 대조).
# 낮은 농도(민물·기수 초입)에서 쓰는 단순 환산 계수.
# TDS 계측기가 흔히 쓰는 NaCl 기준값이다. 아래 실용염분식이 다루지 못하는
# 2 ppt 미만 구간에서만 쓴다.
DEFAULT_EC_TO_PPM = 0.5

# 표준 해수(염분 35)의 15°C 전도도. 실용염분식의 기준값이다.
SEAWATER_REF_MS = 42.914


def practical_salinity(ms_per_cm: float, celsius: float) -> float | None:
    """전도도와 수온으로 실용염분(PSS-78)을 구한다. 단위는 ppt.

    바닷물의 염분은 전도도에 단순 비례하지 않고 수온에 따라서도 크게 달라진다.
    같은 물이라도 여름과 겨울의 전도도가 다르다. 그래서 계수 하나를 곱하는
    방식은 해수 구간에서 10% 넘게 어긋난다 — 흰다리새우 적정 범위가
    15~25 ppt 인 것을 생각하면 무시할 수 없는 차이다.

    PSS-78 은 해양학에서 쓰는 표준식으로, 염분 2~42 ppt 구간에서 유효하다.
    수심 보정은 생략한다(양식장 수조는 얕아 영향이 없다).
    """
    if ms_per_cm <= 0:
        return None

    ratio = ms_per_cm / SEAWATER_REF_MS

    # 수온 보정 — 기준인 15°C 로 되돌린다.
    t = celsius
    rt_denom = (0.6766097 + 2.00564e-2 * t + 1.104259e-4 * t * t
                - 6.9698e-7 * t ** 3 + 1.0031e-9 * t ** 4)
    if rt_denom <= 0:
        return None
    rt = ratio / rt_denom
    if rt <= 0:
        return None

    root = rt ** 0.5
    salinity = (0.0080 - 0.1692 * root + 25.3851 * rt
                + 14.0941 * rt ** 1.5 - 7.0261 * rt ** 2 + 2.7081 * rt ** 2.5)
    # 15°C 에서 벗어난 만큼을 다시 보정한다.
    salinity += ((t - 15.0) / (1.0 + 0.0162 * (t - 15.0))
                 * (0.0005 - 0.0056 * root - 0.0066 * rt
                    - 0.0375 * rt ** 1.5 + 0.0636 * rt ** 2 - 0.0144 * rt ** 2.5))
    return salinity


def salinity_from_ec(conductivity: float, unit: str, factor: float,
                     celsius: float | None = None) -> float | None:
    """전도도를 염도(ppm)로 환산한다.

    센서가 내는 염도 레지스터는 쓰지 않는다. 같은 변환기라도 염도 자리가
    엉뚱한 값을 내는 경우가 있는데, 전도도는 실제로 재는 값이라 믿을 만하다.

    수온을 알면 실용염분식(PSS-78)을 쓴다. 해수 양식에서는 이쪽이 정확하다.
    수온을 모르거나 너무 옅어 식이 다루지 못하는 구간이면 계수를 곱한다.
    """
    if unit == "uS":
        micro_siemens = conductivity
    elif unit == "mS":
        micro_siemens = conductivity * 1000.0
    elif unit == "S":
        micro_siemens = conductivity * 1_000_000.0
    else:
        return None

    if celsius is not None:
        ppt = practical_salinity(micro_siemens / 1000.0, celsius)
        # 식이 유효한 구간(2~42 ppt)에서만 쓴다. 민물은 아래 단순 환산으로.
        if ppt is not None and 2.0 <= ppt <= 42.0:
            return round(ppt, 2)

    # 낮은 농도 구간. 계수는 ppm 기준(TDS 계측기 관례)이라 1000 으로 나눠
    # ppt 로 맞춘다. 민물이면 0.1 ppt 아래라 소수 셋째 자리까지 남긴다.
    return round(micro_siemens * factor / 1000.0, 3)


# 물리적으로 있을 수 없는 값은 버린다.
# 센서 해석이 어긋나거나(레지스터 위치·단위) 전극이 물 밖에 있으면 터무니없는
# 숫자가 나오는데, 그대로 두면 화면에 뜨고 그래프를 망가뜨린다. 서버도 범위 밖
# 값을 조용히 버리므로, 화면에는 보이는데 기록에는 없는 상태가 되어 더 헷갈린다.
# 실제 양식 현장에서 나올 수 있는 폭보다 넉넉히 잡되, 명백한 오류는 거른다.
PLAUSIBLE = {
    "temperature":   (-5.0, 60.0),     # 서버와 같은 범위
    "ph":            (0.0, 14.0),
    "do_level":      (0.0, 30.0),
    "salinity":      (0.0, 50.0),      # ppt. 바닷물이 약 35 ppt
    "conductivity":  (0.0, 200000.0),  # uS/cm. 바닷물이 약 50,000
    "tds":           (0.0, 100000.0),  # ppm
    "do_saturation": (0.0, 200.0),
    "orp":           (-2000.0, 2000.0),
}


def plausible(name: str, value: float) -> bool:
    span = PLAUSIBLE.get(name)
    return span is None or span[0] <= value <= span[1]


def normalize(name: str, value: float, unit: str) -> float | None:
    """서버가 기대하는 단위로 맞춘다."""
    if name == "temperature":
        if unit == "F":
            return round((value - 32) * 5 / 9, 2)
        return round(value, 2)

    if name == "salinity":
        # 서버는 ppt 기준. 새우 양식의 관례 단위다(바닷물이 약 35 ppt).
        if unit == "ppm":
            return round(value / 1000.0, 3)
        if unit in ("ppt", "g/L"):
            return round(value, 2)
        return round(value, 2)

    if name == "conductivity":
        # uS/cm 로 통일한다. 민물은 수백~수천, 바닷물은 오만 단위라
        # mS 로 두면 민물이 소수점 아래로 뭉개진다.
        if unit == "mS":
            return round(value * 1000.0, 1)
        if unit == "S":
            return round(value * 1_000_000.0, 1)
        return round(value, 1)

    if name in ("do_level", "tds"):
        # ppm 으로 통일한다. 물에서 mg/L 과 ppm 은 수치가 같으므로 환산이 없다.
        if unit == "ug/L":
            return round(value / 1000, 3)
        return round(value, 2)

    return round(value, 3)


# ── 양액(수경재배) EC 관리 ────────────────────────────────────────────────────
# EC 로 양액 농도를 보고 보충량을 계산한다. 계산식은 현장에서 쓰던 환산표
# (쪽파 수경재배 EC 자동계산)를 그대로 옮긴 것이다.
#
# 정확도는 전적으로 '교정 EC 상승폭' 에 달려 있다 — 실제 원액·원수로 재서
# 넣어야 한다. 그래서 실증 전에는 화면에 그 사실을 계속 알린다.

# EC 온도보정 계수 — 25℃ 기준, 1℃ 당 약 2%. 수용액의 통상값이다.
EC_TEMP_COEFF = 0.02


def ec_at_25c(ec_ms: float, water_temp: float | None) -> float:
    """측정 EC 를 25℃ 기준으로 환산한다(ATC).

    센서가 스스로 보정하는 모델이면 이 함수를 쓰지 않는다(이중 보정 방지).
    수온을 모르면 그대로 돌려준다 — 억지로 보정하는 것보다 낫다.
    """
    if water_temp is None:
        return ec_ms
    denom = 1.0 + EC_TEMP_COEFF * (water_temp - 25.0)
    if denom <= 0.1:          # 말이 안 되는 수온 — 보정하지 않는다
        return ec_ms
    return ec_ms / denom


def nutrient_plan(conductivity_us: float | None, water_temp: float | None,
                  cfg: dict) -> dict | None:
    """지금 EC 로 양액을 어떻게 손봐야 하는지 계산한다.

    돌려주는 것: 상대농도(%), 판단(low|ok|high), 보충량(A·B mL) 또는 교환량(L).
    계산할 수 없으면 None — 화면은 아무것도 띄우지 않는다.
    """
    if not cfg.get("enabled") or conductivity_us is None:
        return None

    ec = conductivity_us / 1000.0                      # uS/cm → mS/cm
    if cfg.get("atc", True):
        ec = ec_at_25c(ec, water_temp)

    target = float(cfg.get("target_ec", 1.8))
    source = float(cfg.get("source_ec", 0.3))
    span = target - source
    if span <= 0:                                      # 설정이 어긋났다
        return {"error": "target_lte_source", "ec": round(ec, 2)}

    # 상대농도 — 원수 자체의 전도도를 뺀, 양액 성분만의 농도.
    percent = (ec - source) / span * 100.0

    out = {
        "ec": round(ec, 2),
        "target": round(target, 2),
        "percent": round(max(percent, 0.0), 1),
        "atc": bool(cfg.get("atc", True)),
    }

    # 목표에 못 미치면 보충, 넘으면 원수로 교환. 사이면 그대로 둔다.
    # 0.05 mS/cm 는 센서 흔들림 수준이라 그 안쪽은 건드리지 않는다.
    DEADBAND = 0.05
    if ec < target - DEADBAND:
        rise = target - ec
        cal_rise = float(cfg.get("cal_ec_rise", 0.05))
        cal_ml = float(cfg.get("cal_ml", 10))
        cal_liters = float(cfg.get("cal_liters", 100))
        tank = float(cfg.get("tank_liters", 1000))
        if cal_rise <= 0 or cal_liters <= 0:
            return {**out, "verdict": "low", "error": "bad_calibration"}
        total_ml = rise / cal_rise * cal_ml * tank / cal_liters
        a_ratio = min(max(float(cfg.get("a_ratio", 50)), 0.0), 100.0)
        out.update({
            "verdict": "low",
            "need_rise": round(rise, 2),
            "dose_total": round(total_ml),
            "dose_a": round(total_ml * a_ratio / 100.0),
            "dose_b": round(total_ml * (100.0 - a_ratio) / 100.0),
        })
    elif ec > target + DEADBAND:
        tank = float(cfg.get("tank_liters", 1000))
        gap = ec - source
        if gap <= 0:
            return {**out, "verdict": "high", "error": "bad_source"}
        out.update({
            "verdict": "high",
            "exchange_l": round(tank * (ec - target) / gap),
        })
    else:
        out["verdict"] = "ok"
    return out


# ── 수집 ──────────────────────────────────────────────────────────────────────

def read_all(client: ModbusClient, enabled: dict[str, int],
             ec_to_ppm: float = DEFAULT_EC_TO_PPM,
             ec_mode: str = "salinity") -> tuple[dict[str, float], dict[str, str]]:
    """켜져 있는 센서를 모두 읽어 (측정값, 오류) 를 돌려준다."""
    values: dict[str, float] = {}
    temps: dict[str, float] = {}
    errors: dict[str, str] = {}
    raw_conductivity: tuple[float, str] | None = None

    for key, slave_id in enabled.items():
        spec = SENSOR_SPECS[key]
        # 한 번 어긋나면 한 번만 다시 물어본다. 선을 여럿이 나눠 쓰다 보면
        # 잡음이나 응답 겹침으로 한 프레임이 깨지는 일이 있는데, 그때마다
        # 한 주기를 통째로 버릴 이유는 없다.
        regs = None
        for attempt in (1, 2):
            try:
                regs = client.read_input_registers(slave_id, 0x0000, 16)
                break
            except (ModbusError, serial.SerialException) as exc:
                if attempt == 1:
                    log.debug("%s 센서 읽기 실패(%s) — 다시 시도합니다.", key, exc)
                    time.sleep(0.05)
                    continue
                errors[key] = str(exc)
                log.warning("%s 센서 읽기 실패: %s", key, exc)
        if regs is None:
            continue

        for name, idx in spec.fields.items():
            decoded = decode(regs, idx)
            if decoded is None:
                continue
            raw_value, unit = decoded
            value = normalize(name, raw_value, unit)
            if value is None:
                continue
            if not plausible(name, value):
                # 있을 수 없는 값이다. 담아 두면 화면·그래프가 망가지고,
                # 서버는 어차피 버리므로 여기서 이유를 남기고 끊는다.
                log.warning(
                    "%s 값이 범위를 벗어났습니다: %s = %s (원시 %s %s) — 버립니다. "
                    "--dump 으로 레지스터를 확인해 보세요.",
                    key, name, value, raw_value, unit or "단위없음",
                )
                errors.setdefault(key, f"{name} 값 이상({value})")
                continue

            if name == "temperature":
                temps[key] = value
            else:
                values[name] = value
                if name == "conductivity":
                    # 염도를 계산하려면 단위까지 알아야 한다(uS 냐 mS 냐).
                    raw_conductivity = (raw_value, unit)

    # 수온은 한 값만 보낸다 — 센서마다 미세하게 다른 값을 겹쳐 보내면 혼란스럽다.
    for key in TEMPERATURE_PRIORITY:
        if key in temps:
            values["temperature"] = temps[key]
            break

    # 염도는 전도도에서 환산한다. 센서의 염도 레지스터는 믿지 않는다.
    # 수온이 있어야 실용염분식을 쓸 수 있으므로 수온을 고른 뒤에 계산한다.
    #
    # ec_mode 가 conductivity 면 환산하지 않는다 — 양액처럼 EC 자체가 관리
    # 대상인 곳에서는 염도로 바꾼 값이 오히려 뜻을 흐린다. 전도도는 위에서
    # 이미 values["conductivity"] 에 담겼으므로 그대로 쓰인다.
    if raw_conductivity is not None and ec_mode != "conductivity":
        salinity = salinity_from_ec(
            raw_conductivity[0], raw_conductivity[1], ec_to_ppm,
            values.get("temperature"),
        )
        if salinity is not None and plausible("salinity", salinity):
            values["salinity"] = salinity
        elif salinity is not None:
            log.warning("환산한 염도가 범위를 벗어났습니다: %s ppm — 버립니다.", salinity)

    return values, errors


def board_serial() -> str:
    """라즈베리파이 CPU 시리얼. 보드마다 고정이라 기기 식별에 쓴다."""
    try:
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.startswith("Serial"):
                return line.split(":")[1].strip()
    except OSError:
        pass
    # 라즈베리파이가 아닌 환경(개발용 PC 등)에서도 값이 있도록.
    try:
        return Path("/etc/machine-id").read_text().strip()[:16]
    except OSError:
        return "unknown"


def post(endpoint: str, device_key: str, payload: dict, timeout: float = 10.0) -> tuple[bool, str]:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Device-Key": device_key,
            "User-Agent": f"shrimp365-pi/{VERSION}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return True, res.read().decode()[:200]
    except urllib.error.HTTPError as exc:
        return False, f"HTTP {exc.code}: {exc.read().decode()[:200]}"
    except (urllib.error.URLError, TimeoutError) as exc:
        return False, f"연결 실패: {exc}"


# ── 실행 ──────────────────────────────────────────────────────────────────────

def load_config(path: Path) -> configparser.ConfigParser:
    if not path.exists():
        sys.exit(f"설정 파일이 없습니다: {path}\nconfig.example.ini 를 복사해 만드세요.")
    cfg = configparser.ConfigParser()
    cfg.read(path, encoding="utf-8")
    return cfg



# ── 페어링 ────────────────────────────────────────────────────────────────────

def _api_base(endpoint: str) -> str:
    """측정 전송 주소에서 페어링 주소를 유도한다.
    설정 파일에 주소를 두 번 적게 하지 않기 위함."""
    return endpoint.rsplit("/api/", 1)[0] if "/api/" in endpoint else endpoint.rstrip("/")


def _get_json(url: str, timeout: float = 10.0) -> tuple[int, dict]:
    req = urllib.request.Request(url, headers={"User-Agent": f"shrimp365-pi/{VERSION}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read().decode() or "{}")
        except (ValueError, OSError):
            return exc.code, {}
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        log.warning("페어링 조회 실패: %s", exc)
        return 0, {}


def _post_json(url: str, payload: dict, timeout: float = 10.0) -> tuple[int, dict]:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": f"shrimp365-pi/{VERSION}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read().decode() or "{}")
        except (ValueError, OSError):
            return exc.code, {}
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        log.warning("페어링 요청 실패: %s", exc)
        return 0, {}


def save_sensor_config(config_path: Path, settings: dict[str, dict]) -> bool:
    """[sensors] 구간의 사용 여부와 슬레이브 ID 를 설정 파일에 적는다.

    화면에서 고친 값이 재부팅 후에도 남아야 하므로 파일에 쓴다.
    configparser 로 다시 쓰면 주석이 전부 사라지므로 해당 줄만 바꿔 넣는다.
    """
    try:
        lines = config_path.read_text(encoding="utf-8").splitlines(keepends=True)
    except OSError as exc:
        log.error("설정 파일을 읽을 수 없습니다: %s", exc)
        return False

    wanted: dict[str, str] = {}
    for key, cfg in settings.items():
        wanted[f"{key}_enabled"] = "true" if cfg["enabled"] else "false"
        wanted[f"{key}_slave_id"] = str(cfg["slave_id"])

    in_sensors = False
    seen: set[str] = set()
    out: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("["):
            # [sensors] 를 막 벗어나는 참이면, 없던 항목을 여기서 채워 넣는다.
            if in_sensors:
                for name, value in wanted.items():
                    if name not in seen:
                        out.append(f"{name} = {value}\n")
                out.append("\n")
            in_sensors = stripped.lower() == "[sensors]"
            out.append(line)
            continue

        if in_sensors and "=" in stripped and not stripped.startswith((";", "#")):
            name = stripped.split("=", 1)[0].strip().lower()
            if name in wanted:
                seen.add(name)
                out.append(f"{name} = {wanted[name]}\n")
                continue
        out.append(line)

    if in_sensors:  # 파일이 [sensors] 로 끝난 경우
        for name, value in wanted.items():
            if name not in seen:
                out.append(f"{name} = {value}\n")

    try:
        config_path.write_text("".join(out), encoding="utf-8")
        os.chmod(config_path, 0o600)
        return True
    except OSError as exc:
        log.error("설정 파일을 쓸 수 없습니다: %s (권한을 확인하세요)", exc)
        return False


def save_interval(config_path: Path, seconds: int) -> bool:
    """측정 주기를 설정 파일에 적는다. 화면에서 고친 값이 재부팅 후에도 남아야 한다."""
    try:
        lines = config_path.read_text(encoding="utf-8").splitlines(keepends=True)
    except OSError:
        return False
    for i, line in enumerate(lines):
        if line.strip().lower().startswith("interval_seconds"):
            lines[i] = f"interval_seconds = {seconds}\n"
            break
    else:
        return False
    try:
        config_path.write_text("".join(lines), encoding="utf-8")
        os.chmod(config_path, 0o600)
        return True
    except OSError:
        return False


def save_language(config_path: Path, lang: str) -> bool:
    """화면 언어를 [webui] 구간에 적는다. 재부팅 후에도 고른 언어가 남아야 한다.

    language 항목이 없으면 [webui] 안에 새로 끼워 넣는다. 주석을 지우지 않으려고
    configparser 로 통째로 다시 쓰지 않고 줄 단위로 손본다(save_interval 과 같은 방식).
    """
    try:
        lines = config_path.read_text(encoding="utf-8").splitlines(keepends=True)
    except OSError:
        return False
    in_webui = False
    for i, line in enumerate(lines):
        s = line.strip().lower()
        if s == "[webui]":
            in_webui = True
            continue
        if in_webui:
            if s.startswith("language") and "=" in line:
                lines[i] = f"language = {lang}\n"   # 기존 값 교체
                break
            if s.startswith("[") and s.endswith("]"):
                lines.insert(i, f"language = {lang}\n")   # 다음 구간 직전에 삽입
                break
    else:
        if not in_webui:
            return False   # [webui] 구간이 없다
        lines.append(f"language = {lang}\n")   # [webui] 가 파일 끝까지 이어졌다
    try:
        config_path.write_text("".join(lines), encoding="utf-8")
        os.chmod(config_path, 0o600)
        return True
    except OSError:
        return False


def save_ec_mode(config_path: Path, mode: str, unit: str) -> bool:
    """EC 센서 측정 항목·단위를 [sensors] 구간에 적는다.

    항목이 없으면 구간 안에 새로 끼워 넣는다. 주석을 지우지 않으려고
    configparser 로 통째로 다시 쓰지 않고 줄 단위로 손본다.
    """
    try:
        lines = config_path.read_text(encoding="utf-8").splitlines(keepends=True)
    except OSError:
        return False

    wanted = {"ec_mode": mode, "ec_unit": unit}
    seen: set[str] = set()
    in_sensors = False
    insert_at = None
    for i, line in enumerate(lines):
        stripped = line.strip().lower()
        if stripped.startswith("[") and stripped.endswith("]"):
            if in_sensors and insert_at is None:
                insert_at = i          # [sensors] 를 막 벗어나는 참
            in_sensors = stripped == "[sensors]"
            continue
        if in_sensors:
            for key, val in wanted.items():
                if stripped.startswith(key) and "=" in line:
                    lines[i] = f"{key} = {val}\n"
                    seen.add(key)
    missing = [f"{k} = {v}\n" for k, v in wanted.items() if k not in seen]
    if missing:
        if insert_at is not None:
            lines[insert_at:insert_at] = missing
        elif in_sensors:               # [sensors] 가 파일 끝까지 이어졌다
            lines.extend(missing)
        else:
            return False               # [sensors] 구간이 없다
    try:
        config_path.write_text("".join(lines), encoding="utf-8")
        os.chmod(config_path, 0o600)
        return True
    except OSError:
        return False


def save_nutrient(config_path: Path, values: dict) -> bool:
    """양액 설정을 [nutrient] 구간에 적는다. 없는 항목은 새로 끼워 넣는다."""
    try:
        lines = config_path.read_text(encoding="utf-8").splitlines(keepends=True)
    except OSError:
        return False

    wanted = {k: ("true" if v is True else "false" if v is False else f"{v:g}")
              for k, v in values.items()}
    seen: set[str] = set()
    in_sec = False
    insert_at = None
    for i, line in enumerate(lines):
        stripped = line.strip().lower()
        if stripped.startswith("[") and stripped.endswith("]"):
            if in_sec and insert_at is None:
                insert_at = i
            in_sec = stripped == "[nutrient]"
            continue
        if in_sec:
            for key, val in wanted.items():
                if stripped.startswith(key) and "=" in line:
                    lines[i] = f"{key} = {val}\n"
                    seen.add(key)
    missing = [f"{k} = {v}\n" for k, v in wanted.items() if k not in seen]
    if missing:
        if insert_at is not None:
            lines[insert_at:insert_at] = missing
        elif in_sec:
            lines.extend(missing)
        else:
            # [nutrient] 구간이 아예 없는 예전 설정 파일 — 끝에 만들어 붙인다.
            lines.append("\n[nutrient]\n")
            lines.extend(missing)
    try:
        config_path.write_text("".join(lines), encoding="utf-8")
        os.chmod(config_path, 0o600)
        return True
    except OSError:
        return False


def save_device_key(config_path: Path, key: str) -> bool:
    """받은 기기 키를 설정 파일에 적는다.

    configparser 로 다시 쓰면 주석이 전부 사라지므로, 해당 줄만 바꿔 넣는다.
    """
    try:
        lines = config_path.read_text(encoding="utf-8").splitlines(keepends=True)
    except OSError as exc:
        log.error("설정 파일을 읽을 수 없습니다: %s", exc)
        return False

    replaced = False
    for i, line in enumerate(lines):
        if line.strip().lower().startswith("device_key"):
            lines[i] = f"device_key = {key}\n"
            replaced = True
            break
    if not replaced:
        lines.append(f"\ndevice_key = {key}\n")

    try:
        config_path.write_text("".join(lines), encoding="utf-8")
        os.chmod(config_path, 0o600)  # 키가 들어 있으므로 권한을 좁힌다
        return True
    except OSError as exc:
        log.error("설정 파일을 쓸 수 없습니다: %s (권한을 확인하세요)", exc)
        return False



def fetch_device_info(endpoint: str, device_key: str) -> dict | None:
    """서버에 "나는 어느 계정·수조에 붙어 있나"를 묻는다.
    재부팅한 뒤에도 화면에 연결 정보를 띄우기 위한 것."""
    req = urllib.request.Request(
        endpoint,
        headers={"X-Device-Key": device_key, "User-Agent": f"shrimp365-pi/{VERSION}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.loads(res.read().decode() or "{}")
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as exc:
        # 인터넷이 없을 수도 있다. 측정·표시에는 영향을 주지 않는다.
        log.info("연결 정보를 확인하지 못했습니다: %s", exc)
        return None


def run_pairing(
    endpoint: str,
    serial_no: str,
    config_path: Path,
    screen,
    columns: int,
    rows: int,
    should_stop,
    state=None,
    on_key=None,
) -> str | None:
    """기기 키가 없을 때 코드를 받아 화면에 띄우고, 승인될 때까지 기다린다.

    성공하면 기기 키를 돌려주고 설정 파일에도 저장한다.
    """
    base = _api_base(endpoint)
    pair_url = f"{base}/api/sensors/pair"
    host = base.replace("https://", "").replace("http://", "")

    while not should_stop():
        status, data = _post_json(pair_url, {"serial": serial_no, "firmware": f"pi-{VERSION}"})
        if status != 200 or "code" not in data:
            reason = data.get("error") or ("인터넷 연결을 확인하세요" if not status else f"서버 오류 {status}")
            log.error("코드를 받지 못했습니다: %s", reason)
            _show(screen, ["Shrimp365".center(columns), "NO NETWORK"[:columns]], rows)
            if state is not None:
                state.update(pair_error=reason, pair_code=None)
            # 화면에 사유를 띄우고 사용자가 다시 시도하게 한다.
            # 여기서 자동 반복하면 요청 제한에 걸린다.
            return None

        code = str(data["code"])
        secret = data["pairing_secret"]
        if state is not None:
            state.update(pair_code=code, pair_url=host, pair_error=None, status="연결 대기 중")
        spaced = " ".join(code)  # 화면에서 읽기 쉽게 자리마다 띄운다
        log.info("연결 코드: %s — Shrimp365 에 로그인해 이 코드를 입력하세요", code)

        # 코드는 15분간 유효하다. 5초 간격으로 승인 여부를 확인한다.
        deadline = time.monotonic() + 15 * 60
        while time.monotonic() < deadline and not should_stop():
            _show(screen, [
                "Pair this device".center(columns),
                spaced.center(columns),
                host[:columns],
                "waiting..."[:columns],
            ], rows)

            for _ in range(5):
                if should_stop():
                    return None
                time.sleep(1)

            status, info = _get_json(f"{pair_url}?secret={secret}")
            # 지역 변수 이름이 state 파라미터와 겹치지 않게 한다.
            pair_state = info.get("status")

            if pair_state == "linked":
                key = info.get("device_key")
                tank = info.get("tank_name") or ""
                log.info("연결 완료 — 수조: %s", tank or "(이름 없음)")
                # 문자 LCD 는 한글을 못 내므로 수조 이름에 한글이 섞이면 대신
                # 영문 안내를 띄운다(물음표만 늘어놓지 않기 위해).
                ascii_tank = tank if tank.isascii() else ""
                _show(screen, ["PAIRED".center(columns), (ascii_tank or "connected").center(columns)], rows)
                if state is not None:
                    state.update(
                        pairing=False, pair_code=None, pair_error=None,
                        linked=True, tank=tank, account=info.get("account"),
                        status="연결 완료",
                    )
                if key:
                    save_device_key(config_path, key)
                    # 키를 받은 즉시 알린다. 아래 3초는 화면에 "PAIRED"를
                    # 보여 주기 위한 것이라, 그 사이 수집 루프가 아직
                    # 미연결로 판단하면 안 된다.
                    if on_key is not None:
                        on_key(key)
                time.sleep(3)
                return key

            if pair_state in ("expired", "not_found", "revoked"):
                log.info("코드가 만료되었습니다. 새 코드를 받습니다.")
                break

    return None


def _show(screen, lines: list[str], rows: int) -> None:
    if screen is None or display_mod is None:
        return
    try:
        screen.show(lines[:rows])
    except OSError as exc:
        log.warning("화면 출력 실패: %s", exc)



def _with_pending(base: str, store) -> str:
    """상태 줄에 밀린 건수를 함께 보여 준다. 몇 건이 대기 중인지 알아야
    '지금 안 올라가고 있다'는 사실이 실감난다."""
    stamp = time.strftime("%H:%M")
    if store is not None:
        n = store.pending()
        if n:
            return f"{base} · 보관 {n}건 ({stamp})"
    return f"{base} ({stamp})"


def flush_buffer(store, endpoint: str, device_key: str, batch: int, should_stop) -> int:
    """끊겼던 동안 모아 둔 값을 오래된 것부터 다시 올린다.

    · 한 주기에 batch 건까지만 보낸다. 서버가 기기당 분당 60회로 제한하므로
      한꺼번에 쏟아부으면 429 로 막힌다.
    · 한 건이라도 실패하면 즉시 멈춘다. 회선이 다시 끊긴 것이므로 순서를
      지키려면 여기서 그만두는 편이 맞다.
    """
    if store is None:
        return 0

    sent = 0
    for row_id, recorded_at, payload in store.take(batch):
        if should_stop():
            break
        body = dict(payload)
        if recorded_at:
            body["recorded_at"] = recorded_at
        ok, detail = post(endpoint, device_key, body)
        if not ok:
            log.info("보관분 재전송 중단(%s) — 다음 기회에 이어서 보냅니다.", detail)
            break
        store.drop([row_id])
        sent += 1
        # 서버 요청 제한에 걸리지 않도록 간격을 둔다.
        time.sleep(0.3)
    return sent


def _render(screen, values: dict[str, float], columns: int, rows: int, status: str, page: int) -> None:
    """화면 갱신. LCD 가 빠져도 수집은 멈추면 안 되므로 실패를 삼킨다."""
    if display_mod is None:
        return
    try:
        screen.show(display_mod.compose(values, columns, rows, page, status))
    except OSError as exc:
        log.warning("화면 출력 실패: %s", exc)


def main() -> int:
    parser = argparse.ArgumentParser(description="Shrimp365 수질 센서 수집기")
    parser.add_argument("-c", "--config", default="/etc/shrimp365/config.ini", type=Path)
    parser.add_argument("--pair", action="store_true",
                        help="연결 코드를 띄우고 계정에 연결될 때까지 기다림(화면 없는 설치용)")
    parser.add_argument("--scan", action="store_true",
                        help="선에 물려 있는 슬레이브 ID 를 훑어봄(센서가 안 읽힐 때)")
    parser.add_argument("--scan-range", default="1-32", metavar="처음-끝",
                        help="훑을 ID 범위 (기본 1-32)")
    parser.add_argument("--set-id", nargs=2, type=int, metavar=("지금ID", "바꿀ID"),
                        help="센서의 슬레이브 ID 변경 — 센서를 한 대만 연결하고 실행하세요")
    parser.add_argument("--auto", action="store_true",
                        help="센서를 꽂아 둔 채로 훑어 슬레이브 ID 를 자동 배치")
    parser.add_argument("--dump", nargs="?", const=-1, type=int, metavar="ID",
                        help="레지스터를 있는 그대로 출력(값이 이상할 때). ID 생략 시 켜진 센서 전부")
    parser.add_argument("--once", action="store_true", help="한 번만 측정하고 종료(설치 점검용)")
    parser.add_argument("--dry-run", action="store_true", help="서버로 보내지 않고 값만 출력")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    cfg = load_config(args.config)
    endpoint = cfg.get("server", "endpoint")
    device_key = cfg.get("server", "device_key")
    interval = cfg.getint("server", "interval_seconds", fallback=60)

    port = cfg.get("serial", "port", fallback="/dev/ttyUSB0")
    baudrate = cfg.getint("serial", "baudrate", fallback=9600)
    ec_to_ppm = cfg.getfloat("sensors", "ec_to_ppm", fallback=DEFAULT_EC_TO_PPM)
    # EC 센서로 무엇을 잴지 — salinity(염도) 또는 conductivity(전도도).
    # 화면에서 바꿀 수 있으므로 값 하나를 여러 곳에서 함께 본다.
    _mode = cfg.get("sensors", "ec_mode", fallback="salinity").strip().lower()
    _unit = cfg.get("sensors", "ec_unit", fallback="us").strip().lower()
    ec_holder = {
        "mode": _mode if _mode in ("salinity", "conductivity") else "salinity",
        "unit": _unit if _unit in ("us", "ms") else "us",
    }
    # 양액 관리 설정. 화면에서 바꿀 수 있어 값 하나를 여러 곳에서 함께 본다.
    def _nf(key, default):
        try:
            return cfg.getfloat("nutrient", key, fallback=default)
        except ValueError:
            return default
    nut_holder = {
        "enabled": cfg.getboolean("nutrient", "enabled", fallback=False),
        "target_ec": _nf("target_ec", 1.8),
        "source_ec": _nf("source_ec", 0.3),
        "tank_liters": _nf("tank_liters", 1000),
        "cal_ml": _nf("cal_ml", 10),
        "cal_liters": _nf("cal_liters", 100),
        "cal_ec_rise": _nf("cal_ec_rise", 0.05),
        "a_ratio": _nf("a_ratio", 50),
        "atc": cfg.getboolean("nutrient", "atc", fallback=True),
    }

    # 슬레이브 ID 변경. 같은 ID 를 쓰는 센서가 둘일 때 쓴다.
    if args.set_id:
        old_id, new_id = args.set_id
        for label, value in (("지금 ID", old_id), ("바꿀 ID", new_id)):
            if not 1 <= value <= 247:
                sys.exit(f"{label} 는 1~247 사이여야 합니다: {value}")
        if old_id == new_id:
            sys.exit("같은 번호로는 바꿀 수 없습니다.")

        client = ModbusClient(port, baudrate, timeout=1.0)
        try:
            client.open()
        except serial.SerialException as exc:
            sys.exit(f"시리얼 포트를 열 수 없습니다: {port}\n  {exc}")

        try:
            # 바꾸려는 번호를 이미 누가 쓰고 있으면 그대로 충돌이 난다.
            # 바꾸고 나서 아는 것보다 여기서 막는 편이 낫다.
            try:
                client.read_input_registers(new_id, 0x0000, 2)
                sys.exit(f"ID {new_id} 는 이미 다른 센서가 쓰고 있습니다. "
                         f"비어 있는 번호를 고르세요.\n"
                         f"  --scan 으로 사용 중인 번호를 볼 수 있습니다.")
            except ModbusError:
                pass  # 응답이 없다 = 비어 있다. 우리가 원하는 상태다.

            print(f"ID {old_id} → {new_id} 로 바꿉니다.")
            print("센서를 여러 대 연결한 채로 하면 엉뚱한 센서가 바뀔 수 있습니다.\n")
            client.write_register(old_id, SLAVE_ID_REGISTER, new_id)
        except ModbusError as exc:
            sys.exit(f"바꾸지 못했습니다: {exc}")
        finally:
            client.close()

        print(f"바꿨습니다. 설정 파일의 슬레이브 ID 도 {new_id} 로 고치세요.")
        print(f"  sudo nano {args.config}")
        print()
        print("전원을 껐다 켜야 적용되는 제품도 있습니다. 확인:")
        print(f"  ... --scan")
        return 0

    # 값이 이상할 때 원본 레지스터를 본다.
    if args.dump is not None:
        client = ModbusClient(port, baudrate)
        try:
            client.open()
        except serial.SerialException as exc:
            sys.exit(f"시리얼 포트를 열 수 없습니다: {port}\n  {exc}")

        if args.dump > 0:
            targets = [(f"ID {args.dump}", args.dump)]
        else:
            targets = [
                (f"{SENSOR_LABELS[k]} (ID {cfg.getint('sensors', f'{k}_slave_id', fallback=v.slave_id)})",
                 cfg.getint("sensors", f"{k}_slave_id", fallback=v.slave_id))
                for k, v in SENSOR_SPECS.items()
                if cfg.getboolean("sensors", f"{k}_enabled", fallback=True)
            ]

        try:
            for label, slave_id in targets:
                print(f"\n=== {label} ===")
                try:
                    for line in dump_registers(client, slave_id):
                        print(line)
                except (ModbusError, serial.SerialException) as exc:
                    print(f"  읽지 못했습니다: {exc}")
        finally:
            client.close()
        print()
        return 0

    # 꽂아 둔 센서를 훑어 설정을 자동으로 맞춘다.
    if args.auto:
        client = ModbusClient(port, baudrate, timeout=0.4)
        try:
            client.open()
        except serial.SerialException as exc:
            sys.exit(f"시리얼 포트를 열 수 없습니다: {port}\n  {exc}")

        print(f"{port} 를 훑는 중입니다. 잠시 기다리세요…\n")
        try:
            result = auto_assign(client)
        finally:
            client.close()

        assign, conflicts = result["assign"], result["conflicts"]
        if not assign and not conflicts:
            print("응답하는 센서가 없습니다.")
            print("  · 센서 전원(DC 9~24V)이 들어와 있는지")
            print("  · A/B 두 선이 바뀌지 않았는지 (가장 흔한 원인입니다)")
            return 1

        for key, slave_id in assign.items():
            print(f"  {_pad(SENSOR_LABELS[key], 16)} → ID {slave_id}")
        for item in result["others"]:
            print(f"  {_pad('(알 수 없는 기기)', 16)} → ID {item['id']}  {item['note']}")
        for key in result["missing"]:
            print(f"  {_pad(SENSOR_LABELS[key], 16)} → 찾지 못함")
        print()

        if conflicts:
            for key, ids in conflicts.items():
                print(f"{SENSOR_LABELS[key]} 가 {ids} 두 자리에서 응답합니다.")
            print("같은 종류가 둘이면 어느 쪽을 쓸지 사람이 정해야 합니다. "
                  "설정을 바꾸지 않았습니다.")
            return 1

        settings = {
            key: {"enabled": key in assign,
                  "slave_id": assign.get(key, SENSOR_SPECS[key].slave_id)}
            for key in SENSOR_SPECS
        }
        if save_sensor_config(args.config, settings):
            print(f"설정에 반영했습니다: {args.config}")
            print("  sudo systemctl restart shrimp365-sensor")
        else:
            print("설정 파일에 쓰지 못했습니다. 권한을 확인하세요.")
            return 1

        if result["missing"]:
            print()
            print("찾지 못한 센서는 꺼 두었습니다. 달아 두셨는데 안 잡혔다면")
            print("전원과 A/B 배선을 확인하거나, 같은 번호를 쓰는 센서가 없는지 보세요")
            print("(같은 번호가 둘이면 하나가 다른 하나를 가립니다).")
        return 0

    # 센서가 안 읽힐 때 쓰는 진단. 설정과 무관하게 선을 직접 훑으므로
    # [sensors] 가 어떻게 되어 있든 먼저 처리한다.
    if args.scan:
        try:
            first, _, last = args.scan_range.partition("-")
            first, last = int(first), int(last or first)
        except ValueError:
            sys.exit(f"범위 형식이 잘못됐습니다: {args.scan_range!r} (예: 1-32)")
        if not (1 <= first <= last <= 247):
            sys.exit("ID 는 1~247 사이여야 합니다.")

        # 없는 ID 마다 기본 1초를 기다리면 훑는 데만 몇 분이 걸린다.
        client = ModbusClient(port, baudrate, timeout=0.4)
        # 포트를 먼저 열어 본다. 훑는 중에 나는 오류는 "그 ID 에 아무것도 없다"
        # 는 뜻이라 조용히 넘기는데, 포트 자체가 없는 것은 전혀 다른 문제다.
        # 구분하지 않으면 변환기를 안 꽂았는데 "센서가 없다" 고 나온다.
        try:
            client.open()
        except serial.SerialException as exc:
            sys.exit(f"시리얼 포트를 열 수 없습니다: {port}\n"
                     f"  {exc}\n"
                     f"  · USB-RS485 변환기가 꽂혀 있는지 확인하세요.\n"
                     f"  · 포트 이름 확인:  ls -l /dev/serial/by-id/\n"
                     f"  · 이름이 다르면 config.ini 의 [serial] port 를 고치세요.")

        print(f"{port} 에서 ID {first}~{last} 를 훑습니다. 잠시 기다리세요…\n")
        try:
            found = scan_bus(client, first, last)
        finally:
            client.close()

        if not found:
            print("응답하는 센서가 없습니다.")
            print("  · 센서 전원(DC 9~24V)이 들어와 있는지")
            print("  · A/B 두 선이 바뀌지 않았는지 (가장 흔한 원인입니다)")
            print("  · 센서 0V 와 파이 GND 가 공통으로 묶여 있는지")
            return 1

        print("  ID   추정             비고")
        print("  ---  ---------------  ------------------------")
        for slave_id, kind, note in found:
            print(f"  {slave_id:<3}  {kind:<15}  {note}")
        print()
        print("설정의 슬레이브 ID 와 견줘 보세요 — /etc/shrimp365/config.ini 의 [sensors]")
        for key, spec in SENSOR_SPECS.items():
            configured = cfg.getint("sensors", f"{key}_slave_id", fallback=spec.slave_id)
            on = cfg.getboolean("sensors", f"{key}_enabled", fallback=True)
            mark = "" if any(f[0] == configured for f in found) else "   ← 응답 없음"
            print(f"  {key}_slave_id = {configured}"
                  f"{'' if on else '  (꺼져 있음)'}{mark}")
        return 0

    enabled: dict[str, int] = {}
    for key, spec in SENSOR_SPECS.items():
        if cfg.getboolean("sensors", f"{key}_enabled", fallback=True):
            enabled[key] = cfg.getint("sensors", f"{key}_slave_id", fallback=spec.slave_id)

    if not enabled:
        sys.exit("활성화된 센서가 없습니다. config.ini 의 [sensors] 를 확인하세요.")

    # 화면(LCD) — 없으면 조용히 넘어간다.
    screen = None
    page_seconds = cfg.getint("display", "page_seconds", fallback=5) if cfg.has_section("display") else 5
    lcd_columns = cfg.getint("display", "columns", fallback=16) if cfg.has_section("display") else 16
    lcd_rows = cfg.getint("display", "rows", fallback=2) if cfg.has_section("display") else 2
    if display_mod is not None:
        screen = display_mod.make_display(
            cfg.get("display", "type", fallback="none") if cfg.has_section("display") else "none",
            bus=cfg.getint("display", "i2c_bus", fallback=1) if cfg.has_section("display") else 1,
            address=int(cfg.get("display", "i2c_address", fallback="0x27"), 16) if cfg.has_section("display") else 0x27,
            columns=lcd_columns,
            rows=lcd_rows,
        )

    serial_no = board_serial()
    log.info("Shrimp365 센서 수집기 %s 시작 — 보드 %s, 센서 %s", VERSION, serial_no, list(enabled))

    if screen is not None:
        screen.show(["Shrimp365".center(lcd_columns), "starting..."[:lcd_columns]])

    stop = False

    # 측정 루프와 화면이 같은 시리얼 선을 쓴다. 훑는 중에 측정이 끼어들면
    # 둘 다 엉뚱한 응답을 받으므로 자물쇠로 한 번에 하나만 쓰게 한다.
    serial_lock = threading.Lock()
    client_holder: dict[str, ModbusClient] = {}
    # 화면에서 고칠 수 있으므로 값 하나를 여러 곳에서 함께 본다.
    interval_holder = {"seconds": interval}
    # 화면 언어(ko/en/vi/id). 화면에서 고르면 config 에도 남긴다.
    lang_holder = {"lang": cfg.get("webui", "language", fallback="ko")}
    # 연속 전송 실패 횟수. 회선이 끊긴 채 안 돌아올 때 무선을 다시 깨우는 기준.
    net_fail = {"count": 0}

    def handle_signal(signum, _frame):
        nonlocal stop
        log.info("종료 신호(%s) 수신 — 정리 중", signum)
        stop = True

    # 연결 대기 중에도 systemd stop / Ctrl+C 가 바로 먹히도록 먼저 등록한다.
    # 메인 스레드가 아니면(테스트·임베드) 등록이 안 되지만, 그 때문에
    # 수집이 죽어서는 안 된다.
    try:
        signal.signal(signal.SIGTERM, handle_signal)
        signal.signal(signal.SIGINT, handle_signal)
    except ValueError:
        log.debug("메인 스레드가 아니라 종료 신호를 등록하지 않았습니다.")

    # 화면 없이 설치한 경우. 터치스크린이 있으면 화면의 "기기 연결" 버튼을
    # 누르면 되지만, 화면이 없으면 코드를 띄울 방법이 없어 연결할 수가 없다.
    # 그래서 SSH 에서 한 줄로 연결할 수 있는 길을 따로 둔다.
    if args.pair:
        if device_key:
            log.info("이미 계정에 연결되어 있습니다. "
                     "다시 연결하려면 설정의 device_key 를 비우고 실행하세요.")
            return 0
        key = run_pairing(
            endpoint, serial_no, args.config, screen, lcd_columns, lcd_rows,
            should_stop=lambda: stop,
        )
        if not key:
            log.error("연결하지 못했습니다.")
            return 1
        log.info("연결되었습니다. 이제 시작하세요:  sudo systemctl restart shrimp365-sensor")
        return 0

    def _stopped() -> bool:
        # 페어링 대기용 — 취소 버튼을 누르면 즉시 빠져나온다.
        return stop or not pairing["active"]

    def _stopped_global() -> bool:
        # 재전송용 — 종료 신호에만 반응한다.
        return stop

    # 인증 정보는 페어링 스레드가 바꿀 수 있으므로 한 곳에 모아 둔다.
    auth = {"key": device_key if device_key and not device_key.startswith("여기에") else ""}
    pairing = {"active": False, "thread": None}

    # 그래프용 이력. 재전송 큐와 달리 올린 뒤에도 남는다.
    hist = None
    if history_mod is not None and cfg.getboolean("history", "enabled", fallback=True):
        hist = history_mod.History(
            cfg.get("history", "path", fallback="/var/lib/shrimp365/history.db")
            if cfg.has_section("history") else "/var/lib/shrimp365/history.db",
            cfg.getint("history", "retention_days", fallback=history_mod.DEFAULT_RETENTION_DAYS)
            if cfg.has_section("history") else history_mod.DEFAULT_RETENTION_DAYS,
        )
        if not hist.available:
            hist = None

    # 터치스크린용 상태 페이지.
    # 연결 화면은 사용자가 버튼을 눌렀을 때만 뜬다 — 연결하지 않은 장비도
    # 계측기로는 멀쩡히 쓸 수 있어야 하기 때문이다.
    # 기본값은 켬. 127.0.0.1 에만 열리므로 화면이 없는 장비에서도 해가 없고,
    # 나중에 화면을 붙였을 때 설정을 고칠 필요가 없다. 끄려면 enabled = false.
    state = None
    if webui is not None and cfg.getboolean("webui", "enabled", fallback=True):
        state = webui.State()

        def start_pairing() -> None:
            if pairing["active"]:
                return
            pairing["active"] = True
            if state is not None:
                state.update(pairing=True, pair_code=None, pair_error=None)

            def worker() -> None:
                def apply_key(key: str) -> None:
                    auth["key"] = key

                try:
                    key = run_pairing(
                        endpoint, serial_no, args.config, screen,
                        lcd_columns, lcd_rows, _stopped, state, apply_key,
                    )
                    if key:
                        auth["key"] = key
                finally:
                    pairing["active"] = False
                    if state is not None and not auth["key"]:
                        state.update(pairing=False)

            pairing["thread"] = threading.Thread(target=worker, daemon=True)
            pairing["thread"].start()

        def cancel_pairing() -> None:
            pairing["active"] = False
            if state is not None:
                state.update(pairing=False, pair_code=None, pair_error=None)

        def unlink_account() -> None:
            # 계정 연결을 화면에서 끊는다. 지금까지는 SSH 로 설정 파일의
            # device_key 를 지워야 했는데, 그럴 필요 없이 버튼으로 한다.
            # 키를 비우고(재부팅해도 유지) 곧바로 새 연결 코드를 띄워, 화면만으로
            # 다른 계정에 옮겨 붙일 수 있게 한다. 측정은 그대로 계속되고, 못 올린
            # 값은 보관했다가 새 계정에 연결되면 함께 올라간다.
            auth["key"] = ""
            save_device_key(args.config, "")
            if state is not None:
                state.update(linked=False, account=None, tank=None, farm=None,
                             status="계정 연결 해제됨 — 새 코드로 연결하세요")
            log.info("화면에서 계정 연결을 해제했습니다. 새 연결을 시작합니다.")
            start_pairing()

        # ── 화면에서 센서 설정 고치기 ────────────────────────────────────────
        # 지금까지는 SSH 로 들어가 설정 파일을 고쳐야 했다. 현장에서는 수조
        # 옆에 선 채로 화면만 보고 고칠 수 있어야 한다.
        #
        # 선(시리얼 포트)은 측정 루프가 쓰고 있으므로 자물쇠로 겹침을 막는다.
        # 훑는 중에 측정이 끼어들면 둘 다 엉뚱한 응답을 받는다.

        def ui_scan() -> list[dict]:
            with serial_lock:
                try:
                    found = scan_bus(client_holder["client"], 1, 32)
                except serial.SerialException as exc:
                    return [{"error": str(exc)}]
            return [{"id": i, "kind": k, "note": n} for i, k, n in found]

        def ui_save_sensors(payload: dict) -> dict:
            """화면에서 고친 센서 설정을 적용하고 파일에도 남긴다."""
            settings: dict[str, dict] = {}
            for key in SENSOR_SPECS:
                item = payload.get(key) or {}
                try:
                    slave_id = int(item.get("slave_id", SENSOR_SPECS[key].slave_id))
                except (TypeError, ValueError):
                    return {"ok": False, "error": f"{key}: 슬레이브 ID 가 숫자가 아닙니다"}
                if not 1 <= slave_id <= 247:
                    return {"ok": False, "error": f"{key}: 슬레이브 ID 는 1~247"}
                settings[key] = {"enabled": bool(item.get("enabled")), "slave_id": slave_id}

            on = {k: v["slave_id"] for k, v in settings.items() if v["enabled"]}
            if not on:
                return {"ok": False, "error": "센서를 하나 이상 켜 주세요."}
            dupes = [i for i in on.values() if list(on.values()).count(i) > 1]
            if dupes:
                return {"ok": False, "error": f"슬레이브 ID {dupes[0]} 가 중복입니다."}

            try:
                new_interval = int(payload.get("interval", interval_holder["seconds"]))
            except (TypeError, ValueError):
                return {"ok": False, "error": "측정 주기가 숫자가 아닙니다"}
            if not 60 <= new_interval <= 3600:
                return {"ok": False, "error": "측정 주기는 60~3600초"}

            # EC 센서 측정 항목(염도/전도도)과 표시 단위.
            mode = payload.get("ec_mode")
            unit = payload.get("ec_unit")
            if mode in ("salinity", "conductivity"):
                ec_holder["mode"] = mode
            if unit in ("us", "ms"):
                ec_holder["unit"] = unit
            if state is not None:
                state.update(ec_unit=ec_holder["unit"])

            # 파일 저장이 실패해도 지금 화면에서는 동작해야 하므로 먼저 적용한다.
            enabled.clear()
            enabled.update(on)
            interval_holder["seconds"] = new_interval
            saved = save_sensor_config(args.config, settings)
            if saved:
                save_interval(args.config, new_interval)
                save_ec_mode(args.config, ec_holder["mode"], ec_holder["unit"])
            log.info("화면에서 센서 설정을 바꿨습니다: %s, 주기 %d초", on, new_interval)
            return {"ok": True, "saved": saved}

        def ui_set_id(old_id: int, new_id: int) -> dict:
            if not (1 <= old_id <= 247 and 1 <= new_id <= 247):
                return {"ok": False, "error": "ID 는 1~247 사이여야 합니다"}
            if old_id == new_id:
                return {"ok": False, "error": "같은 번호로는 바꿀 수 없습니다"}
            with serial_lock:
                client = client_holder["client"]
                try:
                    client.read_input_registers(new_id, 0x0000, 2)
                    return {"ok": False, "error": f"ID {new_id} 는 이미 쓰이고 있습니다"}
                except ModbusError:
                    pass  # 비어 있다 — 우리가 원하는 상태
                except serial.SerialException as exc:
                    return {"ok": False, "error": str(exc)}
                try:
                    client.write_register(old_id, SLAVE_ID_REGISTER, new_id)
                except (ModbusError, serial.SerialException) as exc:
                    return {"ok": False, "error": str(exc)}
            log.info("화면에서 슬레이브 ID 를 바꿨습니다: %d → %d", old_id, new_id)
            return {"ok": True}

        def ui_auto() -> dict:
            """꽂아 둔 센서를 훑어 배치를 제안한다. 저장은 사람이 누른다."""
            with serial_lock:
                try:
                    return auto_assign(client_holder["client"])
                except serial.SerialException as exc:
                    return {"error": str(exc)}

        def ui_sensors() -> dict:
            return {
                "interval": interval_holder["seconds"],
                "port": port,
                "ec_mode": ec_holder["mode"],
                "ec_unit": ec_holder["unit"],
                "sensors": [
                    {
                        "key": key,
                        "label": SENSOR_LABELS[key],
                        "enabled": key in enabled,
                        "slave_id": enabled.get(key, SENSOR_SPECS[key].slave_id),
                    }
                    for key in SENSOR_SPECS
                ],
            }

        # ── 화면에서 Wi‑Fi 붙이기 ────────────────────────────────────────────
        # 무선은 시리얼 선과 무관하므로 자물쇠가 필요 없다. nmcli 가 직접
        # NetworkManager 와 이야기한다(wifi.py 주석 참고).
        def ui_wifi_status() -> dict:
            if wifi_mod is None:
                return {"available": False, "reason": "이 기기에서 Wi‑Fi 설정을 지원하지 않습니다."}
            return wifi_mod.status()

        def ui_wifi_scan(rescan: bool = True) -> dict:
            if wifi_mod is None:
                return {"available": False, "networks": []}
            return wifi_mod.scan(rescan)

        def ui_wifi_connect(ssid: str, password: str = "") -> dict:
            if wifi_mod is None:
                return {"ok": False, "error": "이 기기에서 Wi‑Fi 설정을 지원하지 않습니다."}
            return wifi_mod.connect(ssid, password)

        def ui_nutrient() -> dict:
            return dict(nut_holder)

        def ui_save_nutrient(payload: dict) -> dict:
            """화면에서 고친 양액 설정을 적용하고 파일에도 남긴다."""
            LIMITS = {
                "target_ec":   (0.1, 20.0),
                "source_ec":   (0.0, 20.0),
                "tank_liters": (1.0, 1_000_000.0),
                "cal_ml":      (0.1, 100_000.0),
                "cal_liters":  (0.1, 100_000.0),
                "cal_ec_rise": (0.001, 20.0),
                "a_ratio":     (0.0, 100.0),
            }
            new_vals: dict = {}
            for key, (lo, hi) in LIMITS.items():
                if key not in payload:
                    continue
                try:
                    val = float(payload[key])
                except (TypeError, ValueError):
                    return {"ok": False, "error": f"{key}: 숫자가 아닙니다"}
                if not lo <= val <= hi:
                    return {"ok": False, "error": f"{key}: {lo:g}~{hi:g} 사이여야 합니다"}
                new_vals[key] = val

            if new_vals.get("target_ec", nut_holder["target_ec"]) <= \
               new_vals.get("source_ec", nut_holder["source_ec"]):
                return {"ok": False, "error": "목표 EC 는 원수 EC 보다 커야 합니다."}

            for flag in ("enabled", "atc"):
                if flag in payload:
                    new_vals[flag] = bool(payload[flag])

            nut_holder.update(new_vals)
            saved = save_nutrient(args.config, dict(nut_holder))
            log.info("화면에서 양액 설정을 바꿨습니다: %s (파일 저장 %s)", new_vals, saved)
            return {"ok": True, "saved": saved}

        def ui_restart() -> dict:
            """프로그램만 다시 시작한다.

            권한이 필요 없다 — 스스로 곱게 끝내면 systemd 가 되살린다
            (shrimp365-sensor.service 의 Restart=always, RestartSec=15).
            측정값·보관함은 종료 절차에서 정상적으로 닫힌다.
            """
            nonlocal stop
            log.info("화면에서 프로그램 다시 시작을 요청했습니다.")
            if state is not None:
                state.update(status="다시 시작하는 중… 약 15초")
            stop = True          # 메인 루프가 정리하고 빠져나온다
            return {"ok": True, "seconds": 15}

        def ui_reboot() -> dict:
            """기기를 재부팅한다. polkit 규칙으로 이 사용자에게만 열어 두었다."""
            log.info("화면에서 기기 재부팅을 요청했습니다.")
            if state is not None:
                state.update(status="재부팅하는 중… 약 1분")
            try:
                res = subprocess.run(["systemctl", "reboot"],
                                     capture_output=True, text=True, timeout=15)
            except (OSError, subprocess.SubprocessError) as exc:
                log.error("재부팅 실패: %s", exc)
                return {"ok": False, "error": str(exc)[:120]}
            if res.returncode != 0:
                msg = (res.stderr or "").strip()[:120]
                log.error("재부팅 실패: %s", msg)
                return {"ok": False, "error": msg or "권한이 없어 재부팅하지 못했습니다."}
            return {"ok": True, "seconds": 60}

        def ui_set_lang(lang: str) -> bool:
            """화면 언어를 바꾼다. 화면은 이미 즉시 반영하므로, 여기선 파일에
            남겨 재부팅 후에도 유지되게 한다. 파일 저장이 실패해도 이번 세션은
            반영된 상태이므로 True 를 돌려준다(웹페이지 언어와 같은 4종만 허용)."""
            if lang not in ("ko", "en", "vi", "id"):
                return False
            lang_holder["lang"] = lang
            saved = save_language(args.config, lang)
            log.info("화면 언어를 바꿨습니다: %s (파일 저장 %s)", lang, saved)
            return True

        webui.serve(
            state,
            cfg.getint("webui", "port", fallback=8080),
            on_pair_start=start_pairing,
            on_pair_cancel=cancel_pairing,
            on_unlink=unlink_account,
            history=hist,
            on_scan=ui_scan,
            on_save_sensors=ui_save_sensors,
            on_set_id=ui_set_id,
            on_auto=ui_auto,
            get_sensors=ui_sensors,
            get_wifi=ui_wifi_status,
            on_wifi_scan=ui_wifi_scan,
            on_wifi_connect=ui_wifi_connect,
            language=lang_holder["lang"],
            on_set_lang=ui_set_lang,
            on_restart=ui_restart,
            on_reboot=ui_reboot,
            get_nutrient=ui_nutrient,
            on_save_nutrient=ui_save_nutrient,
        )
        state.update(serial=serial_no, linked=bool(auth["key"]), status="센서 확인 중",
                     version=VERSION, ec_unit=ec_holder["unit"])

    # 이미 연결된 기기라면 어느 계정·수조에 붙어 있는지 확인해 화면에 남긴다.
    if auth["key"] and state is not None:
        info = fetch_device_info(endpoint, auth["key"])
        if info and not info.get("error"):
            state.update(
                linked=True,
                account=info.get("account"),
                tank=info.get("tank_name"),
                farm=info.get("farm_name"),
            )

    if not auth["key"]:
        log.info("기기 키가 없습니다 — 측정은 계속하고, 화면의 '기기 연결' 버튼으로 연결하세요.")

    # 인터넷이 끊긴 동안의 값을 모아 두는 저장소.
    # 회선이 돌아오면 끊겼던 시점부터 순서대로 다시 올린다.
    store = None
    if buffer_mod is not None and cfg.getboolean("buffer", "enabled", fallback=True):
        store = buffer_mod.Buffer(
            cfg.get("buffer", "path", fallback="/var/lib/shrimp365/queue.db")
            if cfg.has_section("buffer") else "/var/lib/shrimp365/queue.db",
            cfg.getint("buffer", "max_rows", fallback=buffer_mod.DEFAULT_MAX_ROWS)
            if cfg.has_section("buffer") else buffer_mod.DEFAULT_MAX_ROWS,
        )
        if not store.available:
            store = None

    flush_batch = cfg.getint("buffer", "flush_batch", fallback=40) if cfg.has_section("buffer") else 40

    client = ModbusClient(port, baudrate)
    client_holder["client"] = client
    last_values: dict[str, float] = {}
    status_line = ""

    while not stop:
        started = time.monotonic()

        with serial_lock:
            values, errors = read_all(client, dict(enabled), ec_to_ppm, ec_holder["mode"])

        if not values:
            log.error("읽은 값이 없습니다. 배선·전원·슬레이브 ID를 확인하세요. %s", errors)
            status_line = "SENSOR ERROR"
            nutrient = None          # 값이 없으면 양액 안내도 띄우지 않는다
        else:
            stored = {k: v for k, v in values.items() if k in STORED_FIELDS}
            extra = {k: v for k, v in values.items() if k not in STORED_FIELDS}
            log.info("측정 %s%s", stored, f" (참고 {extra})" if extra else "")

            last_values = values
            if hist is not None:
                hist.record(values)

            # 양액 보충량 — 켜져 있고 전도도가 있을 때만. 화면이 이 값을 띄운다.
            nutrient = nutrient_plan(values.get("conductivity"),
                                     values.get("temperature"), nut_holder)

            if args.dry_run:
                print(json.dumps(values, ensure_ascii=False, indent=2))
                status_line = "dry-run " + time.strftime("%H:%M")
            else:
                recorded_at = time.strftime("%Y-%m-%dT%H:%M:%S%z") or None
                payload = {**values, "serial": serial_no, "firmware": f"pi-{VERSION}"}

                if not auth["key"]:
                    # 연결되지 않은 장비도 계측기로는 그대로 쓸 수 있어야 한다.
                    # 값은 모아 두었다가 연결되는 순간 한꺼번에 올린다.
                    if store is not None:
                        store.append(payload, recorded_at)
                    status_line = _with_pending("미연결 — 측정만", store)
                else:
                    ok, detail = post(endpoint, auth["key"], payload)
                    if ok:
                        log.info("전송 완료")
                        net_fail["count"] = 0
                        status_line = "sent " + time.strftime("%H:%M")
                        # 회선이 살아 있는 지금이 밀린 것을 비울 기회다.
                        sent = flush_buffer(store, endpoint, auth["key"], flush_batch, _stopped_global)
                        if sent:
                            log.info("보관해 둔 %d건을 마저 전송했습니다.", sent)
                            status_line = f"sent +{sent} " + time.strftime("%H:%M")
                    else:
                        # 네트워크가 끊겨도 프로세스는 살아 있어야 한다.
                        # 값은 버리지 않고 저장해 두었다가 다음에 올린다.
                        log.error("전송 실패 — %s", detail)
                        if store is not None:
                            store.append(payload, recorded_at)
                        status_line = _with_pending("SEND FAIL", store)

                        # 무인 복구 — 연달아 실패하면 무선이 끊긴 채 안 돌아온
                        # 것일 수 있다. 사람이 현장에 가지 않아도 되게 직접 깨운다.
                        # 회선 문제일 때만 시도한다(HTTP 응답이 온 경우는 서버 쪽
                        # 문제라 무선을 흔들어 봐야 소용없다).
                        net_fail["count"] += 1
                        if (wifi_mod is not None
                                and detail.startswith("연결 실패")
                                and net_fail["count"] >= 3
                                and net_fail["count"] % 3 == 0):
                            log.warning("전송이 %d회 연속 실패 — Wi‑Fi 재연결을 시도합니다.",
                                        net_fail["count"])
                            try:
                                wifi_mod.kick()
                            except Exception as exc:  # noqa: BLE001 — 복구 시도가 수집을 막으면 안 된다
                                log.warning("Wi‑Fi 재연결 시도 실패: %s", exc)

        if state is not None:
            state.update(
                values=last_values,
                nutrient=nutrient,
                status=status_line,
                errors=errors,
                linked=bool(auth["key"]),
                pending=store.pending() if store is not None else 0,
                # 무인 장비라 며칠씩 아무도 안 볼 수 있다. 시각만 있으면
                # 화면의 값이 오늘 것인지 지난주 것인지 구분되지 않는다.
                updated_at=time.strftime("%Y-%m-%d %H:%M:%S"),
            )

        if screen is not None:
            _render(screen, last_values, lcd_columns, lcd_rows, status_line, 0)

        if args.once:
            break

        # 측정은 interval 마다지만 화면은 그동안에도 페이지를 넘겨야 한다.
        elapsed = time.monotonic() - started
        remaining = int(max(0.0, interval_holder["seconds"] - elapsed))
        for tick in range(remaining):
            if stop:
                break
            if screen is not None and page_seconds > 0 and tick % page_seconds == 0:
                _render(screen, last_values, lcd_columns, lcd_rows, status_line, tick // page_seconds)
            if state is not None and tick % 5 == 0:
                state.update(linked=bool(auth["key"]))
            time.sleep(1)

    client.close()
    if store is not None:
        store.close()
    if hist is not None:
        hist.close()
    if screen is not None:
        screen.close()
    log.info("종료")
    return 0


if __name__ == "__main__":
    sys.exit(main())
