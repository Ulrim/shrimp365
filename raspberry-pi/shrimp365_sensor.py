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

# LCD 는 선택 사항. 파일이 없어도 수집은 그대로 동작해야 한다.
try:
    import display as display_mod
except ImportError:  # pragma: no cover
    display_mod = None

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


def run_pairing(
    endpoint: str,
    serial_no: str,
    config_path: Path,
    screen,
    columns: int,
    rows: int,
    should_stop,
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
            log.error("코드를 받지 못했습니다(%s). 30초 후 다시 시도합니다.", status or "연결 실패")
            _show(screen, ["Shrimp365".center(columns), "NO NETWORK"[:columns]], rows)
            for _ in range(30):
                if should_stop():
                    return None
                time.sleep(1)
            continue

        code = str(data["code"])
        secret = data["pairing_secret"]
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
            state = info.get("status")

            if state == "linked":
                key = info.get("device_key")
                tank = info.get("tank_name") or ""
                log.info("연결 완료 — 수조: %s", tank or "(이름 없음)")
                # 문자 LCD 는 한글을 못 내므로 수조 이름에 한글이 섞이면 대신
                # 영문 안내를 띄운다(물음표만 늘어놓지 않기 위해).
                ascii_tank = tank if tank.isascii() else ""
                _show(screen, ["PAIRED".center(columns), (ascii_tank or "connected").center(columns)], rows)
                if key:
                    save_device_key(config_path, key)
                time.sleep(3)
                return key

            if state in ("expired", "not_found", "revoked"):
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

    # 기기 키가 없으면 페어링부터. 긴 키를 손으로 옮겨 적지 않아도 되도록,
    # 화면에 6자리 코드를 띄우고 계정 주인이 승인하기를 기다린다.
    stop = False

    def handle_signal(signum, _frame):
        nonlocal stop
        log.info("종료 신호(%s) 수신 — 정리 중", signum)
        stop = True

    # 연결 대기 중에도 systemd stop / Ctrl+C 가 바로 먹히도록 먼저 등록한다.
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    def _stopped() -> bool:
        return stop

    if not device_key or device_key.startswith("여기에"):
        log.info("기기 키가 없습니다 — 연결 모드로 들어갑니다.")
        device_key = run_pairing(
            endpoint, serial_no, args.config, screen, lcd_columns, lcd_rows, _stopped
        ) or ""
        if not device_key:
            log.error("연결되지 않았습니다. 종료합니다.")
            if screen is not None:
                screen.close()
            return 1

    client = ModbusClient(port, baudrate)
    last_values: dict[str, float] = {}
    status_line = ""

    while not stop:
        started = time.monotonic()

        values, errors = read_all(client, enabled)

        if not values:
            log.error("읽은 값이 없습니다. 배선·전원·슬레이브 ID를 확인하세요. %s", errors)
            status_line = "SENSOR ERROR"
        else:
            stored = {k: v for k, v in values.items() if k in STORED_FIELDS}
            extra = {k: v for k, v in values.items() if k not in STORED_FIELDS}
            log.info("측정 %s%s", stored, f" (참고 {extra})" if extra else "")

            last_values = values

            if args.dry_run:
                print(json.dumps(values, ensure_ascii=False, indent=2))
                status_line = "dry-run " + time.strftime("%H:%M")
            else:
                payload = {**values, "serial": serial_no, "firmware": f"pi-{VERSION}"}
                ok, detail = post(endpoint, device_key, payload)
                if ok:
                    log.info("전송 완료")
                    status_line = "sent " + time.strftime("%H:%M")
                else:
                    # 네트워크가 끊겨도 프로세스는 살아 있어야 한다. 다음 주기에 다시 시도.
                    log.error("전송 실패 — %s", detail)
                    status_line = "SEND FAIL " + time.strftime("%H:%M")

        if screen is not None:
            _render(screen, last_values, lcd_columns, lcd_rows, status_line, 0)

        if args.once:
            break

        # 측정은 interval 마다지만 화면은 그동안에도 페이지를 넘겨야 한다.
        elapsed = time.monotonic() - started
        remaining = int(max(0.0, interval - elapsed))
        for tick in range(remaining):
            if stop:
                break
            if screen is not None and page_seconds > 0 and tick % page_seconds == 0:
                _render(screen, last_values, lcd_columns, lcd_rows, status_line, tick // page_seconds)
            time.sleep(1)

    client.close()
    if screen is not None:
        screen.close()
    log.info("종료")
    return 0


if __name__ == "__main__":
    sys.exit(main())
