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
    import buffer as buffer_mod
except ImportError:  # pragma: no cover
    buffer_mod = None

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

    stop = False

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

    def _stopped() -> bool:
        # 페어링 대기용 — 취소 버튼을 누르면 즉시 빠져나온다.
        return stop or not pairing["active"]

    def _stopped_global() -> bool:
        # 재전송용 — 종료 신호에만 반응한다.
        return stop

    # 인증 정보는 페어링 스레드가 바꿀 수 있으므로 한 곳에 모아 둔다.
    auth = {"key": device_key if device_key and not device_key.startswith("여기에") else ""}
    pairing = {"active": False, "thread": None}

    # 터치스크린용 상태 페이지.
    # 연결 화면은 사용자가 버튼을 눌렀을 때만 뜬다 — 연결하지 않은 장비도
    # 계측기로는 멀쩡히 쓸 수 있어야 하기 때문이다.
    state = None
    if webui is not None and cfg.has_section("webui") and cfg.getboolean("webui", "enabled", fallback=False):
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

        webui.serve(
            state,
            cfg.getint("webui", "port", fallback=8080),
            on_pair_start=start_pairing,
            on_pair_cancel=cancel_pairing,
        )
        state.update(serial=serial_no, linked=bool(auth["key"]), status="센서 확인 중")

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

    flush_batch = cfg.getint("buffer", "flush_batch", fallback=20) if cfg.has_section("buffer") else 20

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

        if state is not None:
            state.update(
                values=last_values,
                status=status_line,
                errors=errors,
                linked=bool(auth["key"]),
                pending=store.pending() if store is not None else 0,
                updated_at=time.strftime("%H:%M:%S"),
            )

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
            if state is not None and tick % 5 == 0:
                state.update(linked=bool(auth["key"]))
            time.sleep(1)

    client.close()
    if store is not None:
        store.close()
    if screen is not None:
        screen.close()
    log.info("종료")
    return 0


if __name__ == "__main__":
    sys.exit(main())
