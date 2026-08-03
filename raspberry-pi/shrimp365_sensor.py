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
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

try:
    import serial  # pyserial
except ImportError:  # pragma: no cover
    sys.exit("pyserial 이 필요합니다.  pip install pyserial")

VERSION = "1.0.0"
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

        self._ser.reset_input_buffer()
        self._ser.write(frame)

        # 응답: ID(1) 기능코드(1) 바이트수(1) 데이터(2*count) CRC(2)
        expected = 5 + count * 2
        response = self._ser.read(expected)
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
    "ec": SensorSpec("ec", 4, {"conductivity": 0x0000, "tds": 0x0002, "salinity": 0x0006, "temperature": 0x0008}),
}

# 수온을 어느 센서 것으로 쓸지. 앞에 있는 것부터 우선.
TEMPERATURE_PRIORITY = ("ph", "ec", "do")

# 서버가 수질 기록으로 저장하는 항목. 나머지는 참고용으로 함께 보내되
# 기기 카드의 "마지막 수신값"에만 남는다.
STORED_FIELDS = {"temperature", "ph", "do_level", "salinity"}


def normalize(name: str, value: float, unit: str) -> float | None:
    """서버가 기대하는 단위로 맞춘다."""
    if name == "temperature":
        if unit == "F":
            return round((value - 32) * 5 / 9, 2)
        return round(value, 2)

    if name == "salinity":
        # 서버는 ppt 기준. g/L 은 실무상 ppt 와 같게 다룬다.
        if unit in ("ppt", "g/L", ""):
            return round(value, 2)
        if unit == "ppm":
            return round(value / 1000, 3)
        if unit == "%":
            return round(value * 10, 2)
        return round(value, 2)

    if name == "do_level":
        if unit == "ug/L":
            return round(value / 1000, 3)
        return round(value, 2)

    return round(value, 3)


# ── 수집 ──────────────────────────────────────────────────────────────────────

def read_all(client: ModbusClient, enabled: dict[str, int]) -> tuple[dict[str, float], dict[str, str]]:
    """켜져 있는 센서를 모두 읽어 (측정값, 오류) 를 돌려준다."""
    values: dict[str, float] = {}
    temps: dict[str, float] = {}
    errors: dict[str, str] = {}

    for key, slave_id in enabled.items():
        spec = SENSOR_SPECS[key]
        try:
            regs = client.read_input_registers(slave_id, 0x0000, 16)
        except (ModbusError, serial.SerialException) as exc:
            errors[key] = str(exc)
            log.warning("%s 센서 읽기 실패: %s", key, exc)
            continue

        for name, idx in spec.fields.items():
            decoded = decode(regs, idx)
            if decoded is None:
                continue
            raw_value, unit = decoded
            value = normalize(name, raw_value, unit)
            if value is None:
                continue

            if name == "temperature":
                temps[key] = value
            else:
                values[name] = value

    # 수온은 한 값만 보낸다 — 센서마다 미세하게 다른 값을 겹쳐 보내면 혼란스럽다.
    for key in TEMPERATURE_PRIORITY:
        if key in temps:
            values["temperature"] = temps[key]
            break

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


def main() -> int:
    parser = argparse.ArgumentParser(description="Shrimp365 수질 센서 수집기")
    parser.add_argument("-c", "--config", default="/etc/shrimp365/config.ini", type=Path)
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
    interval = cfg.getint("server", "interval_seconds", fallback=300)

    port = cfg.get("serial", "port", fallback="/dev/ttyUSB0")
    baudrate = cfg.getint("serial", "baudrate", fallback=9600)

    enabled: dict[str, int] = {}
    for key, spec in SENSOR_SPECS.items():
        if cfg.getboolean("sensors", f"{key}_enabled", fallback=True):
            enabled[key] = cfg.getint("sensors", f"{key}_slave_id", fallback=spec.slave_id)

    if not enabled:
        sys.exit("활성화된 센서가 없습니다. config.ini 의 [sensors] 를 확인하세요.")

    serial_no = board_serial()
    log.info("Shrimp365 센서 수집기 %s 시작 — 보드 %s, 센서 %s", VERSION, serial_no, list(enabled))

    client = ModbusClient(port, baudrate)
    stop = False

    def handle_signal(signum, _frame):
        nonlocal stop
        log.info("종료 신호(%s) 수신 — 정리 중", signum)
        stop = True

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    while not stop:
        started = time.monotonic()

        values, errors = read_all(client, enabled)

        if not values:
            log.error("읽은 값이 없습니다. 배선·전원·슬레이브 ID를 확인하세요. %s", errors)
        else:
            stored = {k: v for k, v in values.items() if k in STORED_FIELDS}
            extra = {k: v for k, v in values.items() if k not in STORED_FIELDS}
            log.info("측정 %s%s", stored, f" (참고 {extra})" if extra else "")

            if args.dry_run:
                print(json.dumps(values, ensure_ascii=False, indent=2))
            else:
                payload = {**values, "serial": serial_no, "firmware": f"pi-{VERSION}"}
                ok, detail = post(endpoint, device_key, payload)
                if ok:
                    log.info("전송 완료")
                else:
                    # 네트워크가 끊겨도 프로세스는 살아 있어야 한다. 다음 주기에 다시 시도.
                    log.error("전송 실패 — %s", detail)

        if args.once:
            break

        elapsed = time.monotonic() - started
        for _ in range(int(max(0.0, interval - elapsed))):
            if stop:
                break
            time.sleep(1)

    client.close()
    log.info("종료")
    return 0


if __name__ == "__main__":
    sys.exit(main())
