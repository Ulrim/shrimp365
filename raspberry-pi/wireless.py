"""무선 센서(Zigbee·433MHz) 연결 — 장비 화면 [설정] → [무선 센서] 의 뒤편.

화면에서 할 수 있는 일:
  · 상태 보기 — 동글이 꽂혔는지, 수집 프로그램이 도는지, 센서마다 배터리·신호·마지막 수신
  · 새 센서 찾기 — Zigbee 페어링 모드를 2분 연다(Zigbee2MQTT 에 요청)
  · 등록 — 찾은 센서에 종류(초관부 온습도·토양·차단기 …)와 구간을 고르면
           Zigbee2MQTT 이름을 바꾸고 devices.yaml 에 한 줄을 더한다
  · 빼기 — devices.yaml 에서 지우고 페어링도 푼다(고장 난 센서 교체)

수집 브리지(openfield/scripts/zigbee_bridge.py)는 devices.yaml 이 바뀌면 스스로 다시
읽는다. 그래서 등록한 센서 값은 서비스 재시작 없이 몇 초 안에 들어온다.

외부 패키지를 쓰지 않는다. 장비 프로그램은 pyserial 만 깔린 시스템 파이썬으로 돌고,
MQTT 는 요청 하나 보내고 응답 하나 받는 정도라 아래 작은 클라이언트로 충분하다.
설치(브로커·Zigbee2MQTT·수집기)는 setup-wireless.sh 가 한다.
"""

from __future__ import annotations

import csv
import datetime as dt
import glob
import json
import os
import re
import socket
import struct
import subprocess
import threading
import time
import uuid
from pathlib import Path

#: 무선 센서 자료를 두는 곳. 장비 서비스의 StateDirectory(/var/lib/shrimp365) 아래라
#: 장비 프로그램이 쓸 수 있고, ProtectHome 에 막히지 않는다.
FIELD_ROOT = Path("/var/lib/shrimp365/field")
DEFAULT_DEVICES = FIELD_ROOT / "devices.yaml"
DEFAULT_DATA = FIELD_ROOT / "data"

#: 화면에서 고르는 센서 종류. kind 는 devices.yaml 의 kinds: 열쇠, prefix 는 센서 이름 앞부분.
#: 같은 온습도 센서라도 지상 10cm(초관부)와 2m 폴대(기온)는 뜻이 달라 따로 고른다 —
#: 서리 판단은 이 둘을 가려야 성립한다(devices.yaml 머리말).
KINDS: dict[str, dict] = {
    "canopy":       {"kind": "canopy",       "prefix": "CN",    "zoned": True},
    "air":          {"kind": "canopy",       "prefix": "AIR",   "zoned": False, "map": {"temperature": "t_air"}},
    "soil":         {"kind": "soil",         "prefix": "SOIL",  "zoned": True},
    "breaker-pump": {"kind": "breaker-pump", "prefix": "PUMP",  "zoned": False},
    "breaker-aux":  {"kind": "breaker-aux",  "prefix": "AUX",   "zoned": False},
    "leak":         {"kind": "leak",         "prefix": "LEAK",  "zoned": False},
    "valve":        {"kind": "valve",        "prefix": "VALVE", "zoned": False},
}
#: 433MHz 센서 종류. 페어링이 없어 '근처에서 들리는 장치' 중에서 골라 devices.yaml 의 rf: 칸에 적는다.
#: map 은 rtl_433 필드 → 우리 변수(기본: temperature_C → t_air). 지상 10cm 온습도는 초관부 온도로 덮는다.
RF_KINDS: dict[str, dict] = {
    "weather": {"prefix": "",     "zoned": False},                                   # 이름은 모델에서(WS90-01)
    "soil":    {"prefix": "SOIL", "zoned": True},
    "canopy":  {"prefix": "CN",   "zoned": True, "map": {"temperature_C": "canopy_temp"}},
    "air":     {"prefix": "AIR",  "zoned": False},
    "leaf":    {"prefix": "LW",   "zoned": True},
    "rain":    {"prefix": "RAIN", "zoned": False},
}
#: 화면에 '근처 센서' 로 띄울 모델 — 그 밖의 433MHz 신호(타이어 공기압계·이웃집 초인종 등)는 개수만 센다.
_RF_SENSOR_RE = re.compile(r"fineoffset|ecowitt|ambient|froggit|misol|\bW[SHN]\d|-W[SHN]\d", re.I)
_RF_MODEL_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
_RF_ID_RE = re.compile(r"^[A-Za-z0-9]{0,12}$")

#: 구간. 센서 이름의 가운데 글자(CN-T1 의 T)가 여기서 나온다.
ZONES = {"treatment": "T", "control": "C", "facility": "", "mast": ""}

#: 상태를 볼 서비스(setup-wireless.sh 가 만드는 이름).
UNITS = ("mosquitto", "zigbee2mqtt", "farm365-zigbee", "farm365-rtl433", "farm365-ecowitt", "farm365-tuyable")

_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,31}$")
_ENTRY_RE = re.compile(r"^  ([A-Za-z0-9_.-]+):\s*\{(.*)\}\s*(#.*)?$")


# ── 아주 작은 MQTT 3.1.1 클라이언트 (QoS 0) ─────────────────────────────────────
class MqttError(Exception):
    pass


def _varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n % 128
        n //= 128
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def _str(s: str) -> bytes:
    b = s.encode("utf-8")
    return struct.pack("!H", len(b)) + b


class Mqtt:
    """연결 → 구독 → 발행 → 받기만 하는 클라이언트. with 문으로 쓴다."""

    def __init__(self, host: str = "127.0.0.1", port: int = 1883, timeout: float = 3.0) -> None:
        self.host, self.port, self.timeout = host, port, timeout
        self.sock: socket.socket | None = None
        self._buf = b""
        self._pending: list[tuple[str, str]] = []   # SUBACK 보다 먼저 온 보존 메시지

    def __enter__(self) -> "Mqtt":
        try:
            self.sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
        except OSError as exc:
            raise MqttError(f"MQTT 브로커에 연결하지 못했습니다({self.host}:{self.port})") from exc
        try:
            cid = "farm365-ui-" + uuid.uuid4().hex[:8]
            body = _str("MQTT") + bytes([4, 0x02]) + struct.pack("!H", 30) + _str(cid)
            self._send(0x10, body)
            kind, data = self._read(self.timeout)
        except TimeoutError as exc:
            self._close()
            raise MqttError("MQTT 브로커가 응답하지 않습니다") from exc
        except MqttError:
            self._close()
            raise
        if kind != 0x20 or len(data) < 2 or data[1] != 0:
            self._close()
            raise MqttError("MQTT 브로커가 연결을 거절했습니다")
        return self

    def _close(self) -> None:
        if self.sock:
            try:
                self.sock.close()
            except OSError:
                pass
            self.sock = None

    def __exit__(self, *exc) -> None:
        if self.sock:
            try:
                self._send(0xE0, b"")
            except MqttError:
                pass
            self._close()

    def _send(self, header: int, body: bytes) -> None:
        assert self.sock is not None
        try:
            self.sock.sendall(bytes([header]) + _varint(len(body)) + body)
        except OSError as exc:
            raise MqttError("MQTT 연결이 끊겼습니다") from exc

    def _recv_exact(self, n: int, deadline: float) -> bytes:
        assert self.sock is not None
        while len(self._buf) < n:
            left = deadline - time.monotonic()
            if left <= 0:
                raise TimeoutError
            self.sock.settimeout(left)
            try:
                chunk = self.sock.recv(4096)
            except socket.timeout as exc:          # 시간 초과는 그대로(받을 것이 없다는 뜻)
                raise TimeoutError from exc
            except OSError as exc:                 # 끊김·재설정은 MQTT 오류로 — 호출자가 잡는다
                raise MqttError("MQTT 연결이 끊겼습니다") from exc
            if not chunk:
                raise MqttError("MQTT 연결이 끊겼습니다")
            self._buf += chunk
        out, self._buf = self._buf[:n], self._buf[n:]
        return out

    def _read(self, timeout: float) -> tuple[int, bytes]:
        deadline = time.monotonic() + timeout
        header = self._recv_exact(1, deadline)[0]
        mult, length = 1, 0
        for _ in range(4):
            b = self._recv_exact(1, deadline)[0]
            length += (b & 0x7F) * mult
            mult *= 128
            if not b & 0x80:
                break
        return header & 0xF0, self._recv_exact(length, deadline) if length else b""

    def subscribe(self, *topics: str) -> None:
        body = struct.pack("!H", 1) + b"".join(_str(t) + b"\x00" for t in topics)
        self._send(0x82, body)
        deadline = time.monotonic() + self.timeout
        while True:   # SUBACK 전에 보존 메시지가 먼저 올 수 있다 — 버리지 않고 쌓아 둔다
            try:
                kind, data = self._read(max(0.01, deadline - time.monotonic()))
            except TimeoutError as exc:
                raise MqttError("MQTT 브로커가 구독에 응답하지 않습니다") from exc
            if kind == 0x90:
                return
            if kind == 0x30:
                self._pending.append(self._parse_publish(data))

    def publish(self, topic: str, payload: dict | str) -> None:
        text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
        self._send(0x30, _str(topic) + text.encode("utf-8"))

    @staticmethod
    def _parse_publish(data: bytes) -> tuple[str, str]:
        n = struct.unpack("!H", data[:2])[0]
        return data[2:2 + n].decode("utf-8", "replace"), data[2 + n:].decode("utf-8", "replace")

    def messages(self, timeout: float):
        """timeout 동안 받은 PUBLISH 를 (topic, payload) 로 내놓는다."""
        while self._pending:
            yield self._pending.pop(0)
        deadline = time.monotonic() + timeout
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                return
            try:
                kind, data = self._read(left)
            except TimeoutError:
                return
            if kind == 0x30:
                yield self._parse_publish(data)


def _mqtt(host, port, timeout=3.0) -> Mqtt:
    return Mqtt(host, port, timeout)


# ── devices.yaml (주석을 지키며 한 줄씩 고친다) ─────────────────────────────────
def _flow_to_dict(text: str) -> dict:
    """`kind: canopy, zone: treatment, sensor_id: CN-T1, note: 지상 10cm` 를 읽는다(얕게)."""
    out: dict[str, str] = {}
    depth, cur = 0, ""
    parts = []
    for ch in text:
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    for p in parts:
        if ":" in p:
            k, v = p.split(":", 1)
            out[k.strip()] = v.strip().strip("'\"")
    return out


def _block(lines: list[str], key: str) -> tuple[int, int] | None:
    """최상위 `key:` 칸의 (시작 줄, 끝 줄(다음 최상위 칸 직전)). 없으면 None."""
    start = None
    for i, line in enumerate(lines):
        if re.match(rf"^{re.escape(key)}:\s*(#.*)?$", line.rstrip("\n")) or re.match(rf"^{re.escape(key)}:\s*\{{\s*\}}", line):
            start = i
            continue
        if start is not None and line and not line[0].isspace() and not line.startswith("#"):
            return start, i
    return (start, len(lines)) if start is not None else None


def read_registered(path: Path) -> dict[str, dict]:
    """devices: 칸에 적힌 장치 — {이름: {kind, zone, sensor_id, note, ...}}."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return {}
    blk = _block(lines, "devices")
    if not blk:
        return {}
    out = {}
    for line in lines[blk[0] + 1:blk[1]]:
        m = _ENTRY_RE.match(line)
        if m:
            out[m.group(1)] = _flow_to_dict(m.group(2))
    return out


def _write_atomic(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def add_device(path: Path, name: str, kind_key: str, zone: str, sensor_id: str, note: str = "") -> None:
    """devices: 칸 끝에 한 줄을 더한다. 주석과 다른 칸은 그대로 둔다."""
    k = KINDS[kind_key]
    fields = [f"kind: {k['kind']}", f"zone: {zone}", f"sensor_id: {sensor_id}"]
    note = clean_note(note)
    if note:
        fields.append(f"note: {note}")
    if k.get("map"):
        fields.append("map: {" + ", ".join(f"{a}: {b}" for a, b in k["map"].items()) + "}")
    entry = f"  {name}: {{{', '.join(fields)}}}\n"
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True) if path.exists() else []
    blk = _block([line.rstrip("\n") for line in lines], "devices")
    if blk is None:
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        lines += ["\ndevices:\n", entry]
    else:
        s, e = blk
        if re.match(r"^devices:\s*\{\s*\}", lines[s]):          # `devices: {}` → 블록으로 편다
            lines[s] = "devices:\n"
        # 마지막 장치 줄 바로 다음에 넣는다. 장치가 없으면 `devices:` 바로 다음.
        at = s + 1
        for i in range(s + 1, e):
            if _ENTRY_RE.match(lines[i].rstrip("\n")):
                at = i + 1
        lines.insert(at, entry)
    _write_atomic(path, "".join(lines))


def remove_device(path: Path, name: str) -> bool:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    blk = _block([line.rstrip("\n") for line in lines], "devices")
    if not blk:
        return False
    for i in range(blk[0] + 1, blk[1]):
        m = _ENTRY_RE.match(lines[i].rstrip("\n"))
        if m and m.group(1) == name:
            del lines[i]
            _write_atomic(path, "".join(lines))
            return True
    return False


_RF_KEY_RE = re.compile(r"^  ([^\s#:][^:]*?):\s*(\{.*\})?\s*(#.*)?$")


def _rf_entries(lines: list[str]) -> list[tuple[str, int, int, dict]]:
    """rf: 칸의 장치들 — (열쇠, 시작 줄, 끝 줄(다음 장치 직전), 설정). 한 줄 { } 와 여러 줄 형식 모두."""
    blk = _block([line.rstrip("\n") for line in lines], "rf")
    if not blk:
        return []
    out = []
    cur = None
    for i in range(blk[0] + 1, blk[1]):
        raw = lines[i].rstrip("\n")
        m = _RF_KEY_RE.match(raw)
        if m:
            if cur:
                out.append(cur)
            cur = [m.group(1).strip(), i, i + 1, _flow_to_dict(m.group(2)[1:-1]) if m.group(2) else {}]
            continue
        if cur and (raw.startswith("    ") or not raw.strip()):
            if raw.startswith("    ") and not raw.strip().startswith("#") and ":" in raw:
                k, v = raw.strip().split(":", 1)
                cur[3][k.strip()] = v.split("#", 1)[0].strip().strip("'\"")
            if raw.strip():
                cur[2] = i + 1                   # 빈 줄은 끝에 넣지 않는다 — 다음 장치 머리 주석을 지키게
            continue
        if cur and raw.startswith("  #"):
            out.append(cur)
            cur = None
    if cur:
        out.append(cur)
    return [tuple(c) for c in out]


def read_rf(path: Path) -> dict[str, dict]:
    """rf: 칸 — {'Fineoffset-WS90/12345': {zone, sensor_id, note, ...}}."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    except OSError:
        return {}
    return {key: cfg for key, _s, _e, cfg in _rf_entries(lines)}


def add_rf(path: Path, key: str, zone: str, sensor_id: str, note: str = "", mapping: dict | None = None) -> None:
    fields = [f"zone: {zone}", f"sensor_id: {sensor_id}"]
    note = clean_note(note)
    if note:
        fields.append(f"note: {note}")
    if mapping:
        fields.append("map: {" + ", ".join(f"{a}: {b}" for a, b in mapping.items()) + "}")
    entry = f"  {key}: {{{', '.join(fields)}}}\n"
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True) if path.exists() else []
    blk = _block([line.rstrip("\n") for line in lines], "rf")
    if blk is None:
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        lines += ["\nrf:\n", entry]
    else:
        if re.match(r"^rf:\s*\{\s*\}", lines[blk[0]]):
            lines[blk[0]] = "rf:\n"
        entries = _rf_entries(lines)
        at = entries[-1][2] if entries else blk[0] + 1
        lines.insert(at, entry)
    _write_atomic(path, "".join(lines))


def remove_rf(path: Path, key: str) -> bool:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    for k, start, end, _cfg in _rf_entries(lines):
        if k == key:
            del lines[start:end]
            _write_atomic(path, "".join(lines))
            return True
    return False


def guess_rf_kind(model: str) -> str:
    m = model.upper()
    if re.search(r"WS\d|WH(24|25|65|80)|WN(67|68|69)|WS6[89]", m):
        return "weather"
    if "WH51" in m:
        return "soil"
    if "WH35" in m:
        return "leaf"
    if "WH40" in m:
        return "rain"
    if re.search(r"WH3[12]|WN3[012]", m):
        return "air"
    return ""


def suggest_rf_id(kind: str, zone: str, model: str, taken: set[str]) -> str:
    k = RF_KINDS[kind]
    prefix = k["prefix"] or (re.sub(r"[^A-Z0-9]", "", model.split("-")[-1].upper())[:6] or "WX")
    letter = ZONES.get(zone, "") if k["zoned"] else ""
    taken = {t.upper() for t in taken}
    for n in range(1, 100):
        sid = f"{prefix}-{letter}{n}" if letter else f"{prefix}-{n:02d}"
        if sid not in taken:
            return sid
    raise ValueError("이름이 가득 찼습니다")


# ── 에코윗 게이트웨이(와이파이) ─────────────────────────────────────────────────
#: 게이트웨이 채널 계열 → (화면 종류, 이름 앞부분, 구간 글자를 붙이나). th(범용 온습도)는 사람이 고른다.
ECO_FAMILIES = {"soil": ("soil", "SOIL", True), "tf": ("soiltemp", "ST", True),
                "leaf": ("leaf", "LW", True), "th": ("", "", True)}
_ECO_KEY_RE = re.compile(r"^(soil|tf|leaf|th)([1-8])$")
_PASSKEY_RE = re.compile(r"^[A-Fa-f0-9]{8,64}$")


def read_tuya_ble(path: Path) -> dict[str, dict]:
    """tuya_ble: 칸 — {기기 id: {"sensor_id", "zone", ...}}. 열쇠(local_key)는 화면에 내보내지 않는다.
    등록은 tuya_ble_setup.py 가 투야 클라우드에서 열쇠를 받아 한다(화면에서는 상태만 본다)."""
    out: dict[str, dict] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return out
    blk = _block(lines, "tuya_ble")
    if not blk:
        return out
    cur = None
    for raw in lines[blk[0] + 1:blk[1]]:
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip())
        key, _, rest = raw.strip().partition(":")
        rest = rest.split(" #", 1)[0].strip()
        if indent == 2:
            cur = out.setdefault(key.strip("'\""), {})
        elif indent == 4 and cur is not None and key in ("sensor_id", "zone", "name", "mac"):
            cur[key] = rest.strip("'\"")
    return out


def read_eco(path: Path) -> dict:
    """ecowitt: 칸 — {"gateway": 설정 또는 None, "channels": {"soil1": 설정, ...}, "passkey": 등록한 게이트웨이}.
    한 줄 { } 형식과 여러 줄 형식을 모두 읽는다. 주석 줄은 건너뛴다."""
    out: dict = {"gateway": None, "channels": {}, "passkey": ""}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return out
    blk = _block(lines, "ecowitt")
    if not blk:
        return out
    section, cur = None, None
    for raw in lines[blk[0] + 1:blk[1]]:
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip())
        key, _, rest = raw.strip().partition(":")
        rest = rest.split(" #", 1)[0].strip()
        if indent == 2:
            section, cur = key, None
            if key == "passkey":
                out["passkey"] = rest.strip("'\"")
            if key == "gateway":
                out["gateway"] = _flow_to_dict(rest[1:-1]) if rest.startswith("{") and rest != "{}" else {}
                cur = out["gateway"]
            continue
        if section == "gateway" and indent >= 4 and cur is not None:
            cur[key] = rest.strip("'\"")
        elif section == "channels":
            if indent == 4:
                cur = _flow_to_dict(rest[1:-1]) if rest.startswith("{") else {}
                out["channels"][key] = cur
            elif indent == 6 and cur is not None:
                cur[key] = rest.strip("'\"")
            elif indent >= 8 and cur is not None and "map" in cur:
                # 여러 줄 map: — 한 줄 형식과 같은 글로 모은다(화면이 종류를 가늠할 때 쓴다)
                inner = cur["map"][1:-1] if cur["map"].startswith("{") else ""
                cur["map"] = "{" + ", ".join(x for x in (inner, f"{key}: {rest}") if x) + "}"
    gw = out["gateway"]
    if not out["passkey"] and gw:
        out["passkey"] = gw.get("passkey", "")         # 예전 형식: gateway 안에 적은 열쇠
    if out["gateway"] == {}:
        out["gateway"] = None if not any(l.strip() == "gateway:" for l in lines[blk[0]:blk[1]]) else {}
    return out


def _eco_entries(lines: list[str]) -> list[tuple[str, int, int]]:
    """ecowitt: 칸에서 지울 수 있는 항목 — ("gateway"|"soil1", 시작 줄, 끝 줄)."""
    blk = _block([line.rstrip("\n") for line in lines], "ecowitt")
    if not blk:
        return []
    out, cur, section = [], None, None
    for i in range(blk[0] + 1, blk[1]):
        raw = lines[i].rstrip("\n")
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip())
        key = raw.strip().split(":", 1)[0]
        if indent == 2:
            if cur:
                out.append(tuple(cur))
            section = key
            cur = [key, i, i + 1] if key == "gateway" else None
        elif indent == 4 and section == "channels":
            if cur:
                out.append(tuple(cur))
            cur = [key, i, i + 1]
        elif cur and indent > (2 if cur[0] == "gateway" else 4):
            cur[2] = i + 1
    if cur:
        out.append(tuple(cur))
    return out


def _eco_line(fields: dict) -> str:
    return ", ".join(f"{k}: {v}" for k, v in fields.items() if v not in (None, ""))


def add_eco(path: Path, key: str, fields: dict) -> None:
    """게이트웨이(key="gateway") 또는 채널(soil1 …) 한 줄을 ecowitt: 칸에 더한다."""
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True) if path.exists() else []
    if _block([line.rstrip("\n") for line in lines], "ecowitt") is None:
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        lines += ["\n", "ecowitt:\n"]
    s, e = _block([line.rstrip("\n") for line in lines], "ecowitt")
    if re.match(r"^ecowitt:\s*\{\s*\}", lines[s]):
        lines[s] = "ecowitt:\n"
    if key == "gateway":
        lines.insert(s + 1, f"  gateway: {{{_eco_line(fields)}}}\n")
    else:
        ch = next((i for i in range(s + 1, e) if re.match(r"^  channels:", lines[i])), None)
        if ch is None:
            lines.insert(e, "  channels:\n")
            ch = e
        elif re.match(r"^  channels:\s*\{\s*\}", lines[ch]):
            lines[ch] = "  channels:\n"
        entries = [x for x in _eco_entries(lines) if x[0] != "gateway"]
        at = entries[-1][2] if entries else ch + 1
        lines.insert(at, f"    {key}: {{{_eco_line(fields)}}}\n")
    _write_atomic(path, "".join(lines))


def remove_eco(path: Path, key: str) -> bool:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    for k, start, end in _eco_entries(lines):
        if k == key:
            del lines[start:end]
            _write_atomic(path, "".join(lines))
            return True
    return False


def set_eco_passkey(path: Path, passkey: str) -> None:
    """등록한 게이트웨이의 PASSKEY 를 ecowitt: 바로 아래 한 줄로 둔다(없으면 지운다).
    수신기는 이 열쇠의 게이트웨이만 받는다. 숫자만으로 된 열쇠가 YAML 수로 읽히지 않게 따옴표로 감싼다."""
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    blk = _block([line.rstrip("\n") for line in lines], "ecowitt")
    if blk is None:
        if not passkey:
            return
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        lines += ["\n", "ecowitt:\n"]
        blk = _block([line.rstrip("\n") for line in lines], "ecowitt")
    s, e = blk
    lines = [ln for i, ln in enumerate(lines) if not (s < i < e and re.match(r"^  passkey:", ln))]
    if passkey:
        lines.insert(s + 1, f'  passkey: "{passkey}"\n')
    _write_atomic(path, "".join(lines))


def local_ip() -> str:
    """이 장비의 망 주소 — 게이트웨이 앱에 적을 값. 실제로 보내지 않는다(UDP 연결만 맺어 본다)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as so:
            so.connect(("10.255.255.255", 1))
            return so.getsockname()[0]
    except OSError:
        return ""


def save_section_value(config_path: Path, section: str, key: str, value: str) -> bool:
    """[section] 의 key 하나를 적는다. 항목이 없으면 끼워 넣고, 구간이 없으면 끝에 만든다.

    키는 정확히 같은 이름만 바꾼다(enabled 와 enabled_x 를 섞지 않게). 주석은 그대로 둔다.
    """
    try:
        lines = config_path.read_text(encoding="utf-8").splitlines(keepends=True)
    except OSError:
        return False
    head = f"[{section}]".lower()
    start = next((i for i, l in enumerate(lines) if l.strip().lower() == head), None)
    if start is None:
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        lines += [f"\n[{section}]\n", f"{key} = {value}\n"]
    else:
        end = next((i for i in range(start + 1, len(lines))
                    if lines[i].strip().startswith("[") and lines[i].strip().endswith("]")), len(lines))
        for i in range(start + 1, end):
            raw = lines[i].strip()
            if raw and not raw.startswith((";", "#")) and "=" in raw \
                    and raw.split("=", 1)[0].strip().lower() == key.lower():
                lines[i] = f"{key} = {value}\n"
                break
        else:
            at = end
            while at - 1 > start and not lines[at - 1].strip():
                at -= 1                       # 다음 구간 앞 빈 줄 위에 넣는다
            lines.insert(at, f"{key} = {value}\n")
    # 제자리에 덮어쓴다. 임시 파일로 바꿔 끼우면 (1) 서비스는 /etc/shrimp365 에 새 파일을 만들
    # 권한이 없고 (2) root 가 돌린 설치 도구에서는 파일 주인이 root 로 바뀌어 서비스가 못 읽는다.
    # 주인·권한은 그대로 둔다(기존 _save_webui_value 와 같은 방식).
    try:
        with config_path.open("r+", encoding="utf-8") as fh:
            fh.seek(0)
            fh.write("".join(lines))
            fh.truncate()
        return True
    except OSError:
        return False


def clean_note(note: str) -> str:
    """메모는 devices.yaml 한 줄 { } 안에 그대로 들어간다. YAML 에서 뜻이 있는 글자(: # { } [ ] , " ' * & ! | > @ `
    줄바꿈)가 섞이면 파일 전체가 안 읽혀 수집기가 멈춘다 — 한글·영숫자·공백·- . ( ) ~ 만 남긴다."""
    text = re.sub(r"[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ \-.()~]", " ", str(note or ""))
    return re.sub(r"\s+", " ", text).strip(" -.")[:40]


def suggest_id(kind_key: str, zone: str, taken: set[str]) -> str:
    """CN-T3, SOIL-C2, PUMP-02 처럼 비어 있는 다음 이름. 기존 설치(devices.yaml 예시)와 같은 규칙."""
    k = KINDS[kind_key]
    letter = ZONES.get(zone, "") if k["zoned"] else ""
    taken = {t.upper() for t in taken}
    for n in range(1, 100):
        sid = f"{k['prefix']}-{letter}{n}" if letter else f"{k['prefix']}-{n:02d}"
        if sid not in taken:
            return sid
    raise ValueError("이름이 가득 찼습니다")


# ── 화면 쪽 ───────────────────────────────────────────────────────────────────
class Wireless:
    def __init__(self, devices_path: str | Path = DEFAULT_DEVICES, data_dir: str | Path = DEFAULT_DATA,
                 host: str = "127.0.0.1", port: int = 1883, base_topic: str = "zigbee2mqtt") -> None:
        self.devices_path = Path(devices_path)
        self.data_dir = Path(data_dir)
        self.host, self.port, self.base = host, port, base_topic
        self.permit_until = 0.0
        self._lock = threading.Lock()          # 등록·빼기가 겹치면 같은 이름을 두 번 줄 수 있다

    # 상태 ------------------------------------------------------------------
    @staticmethod
    def _unit_active(unit: str) -> bool | None:
        try:
            r = subprocess.run(["systemctl", "is-active", unit], capture_output=True, text=True, timeout=3)
        except (OSError, subprocess.SubprocessError):
            return None
        return r.stdout.strip() == "active"

    @staticmethod
    def _dongle() -> str | None:
        for p in sorted(glob.glob("/dev/serial/by-id/*")):
            if re.search(r"sonoff|itead|zigbee|efr32|mg2[14]|cc26|conbee|skyconnect", p, re.I):
                return os.path.basename(p)
        return None

    @staticmethod
    def _rtlsdr() -> bool:
        for d in glob.glob("/sys/bus/usb/devices/*"):
            try:
                v = Path(d, "idVendor").read_text().strip()
                p = Path(d, "idProduct").read_text().strip()
            except OSError:
                continue
            if v == "0bda" and p in ("2838", "2832"):
                return True
        return False

    def _last_seen(self) -> dict[str, dict]:
        """오늘·어제 수집 파일 끝부분에서 센서별 마지막 수신·배터리·신호."""
        out: dict[str, dict] = {}
        now = dt.datetime.now()
        for day in (now - dt.timedelta(days=1), now):
            for src in ("zigbee", "rtl433", "ecowitt", "tuyable"):
                f = self.data_dir / f"{src}_{day:%Y%m%d}.csv"
                try:
                    with f.open("rb") as fh:
                        fh.seek(max(0, f.stat().st_size - 400_000))
                        tail = fh.read().decode("utf-8", "replace").splitlines()[1:]
                except OSError:
                    continue
                for row in csv.reader(tail):
                    if len(row) < 5:
                        continue
                    try:
                        ts = dt.datetime.fromisoformat(row[0])
                    except ValueError:
                        continue
                    if ts.tzinfo is not None:
                        ts = ts.astimezone().replace(tzinfo=None)
                    d = out.setdefault(row[2].upper(), {})
                    if ts >= d.get("ts", dt.datetime.min):
                        d["ts"] = ts
                    if row[3] in ("battery_pct", "linkquality", "rssi"):
                        try:
                            d[row[3]] = float(row[4])
                        except ValueError:
                            pass
        return out

    def snapshot(self) -> dict:
        """화면이 그리는 전부 — 상태, 등록된 센서, 찾았지만 등록 안 된 센서."""
        units = {u: self._unit_active(u) for u in UNITS}
        z2m_online, paired, err = None, [], None
        try:
            with _mqtt(self.host, self.port, 2.0) as m:
                m.subscribe(f"{self.base}/bridge/state", f"{self.base}/bridge/devices")
                for topic, payload in m.messages(1.0):
                    if topic.endswith("/bridge/state"):
                        try:
                            z2m_online = (json.loads(payload).get("state") == "online")
                        except (ValueError, AttributeError):
                            z2m_online = payload.strip() == "online"
                    elif topic.endswith("/bridge/devices"):
                        try:
                            paired = [d for d in json.loads(payload) if d.get("type") != "Coordinator"]
                        except ValueError:
                            paired = []
        except MqttError as exc:
            err = str(exc)
        registered = read_registered(self.devices_path)
        seen = self._last_seen()
        now = dt.datetime.now()

        def info(sid: str) -> dict:
            s = seen.get(sid.upper(), {})
            return {
                "age_min": int((now - s["ts"]).total_seconds() // 60) if "ts" in s else None,
                "battery": s.get("battery_pct"), "lqi": s.get("linkquality"),
            }

        by_name = {d.get("friendly_name"): d for d in paired}
        sensors = []
        for name, cfg in registered.items():
            d = by_name.get(name, {})
            definition = d.get("definition") or {}
            sid = cfg.get("sensor_id") or name
            sensors.append({"name": name, "sensor_id": sid, "kind": cfg.get("kind", ""), "zone": cfg.get("zone", ""),
                            "note": cfg.get("note", ""), "paired": bool(d) if paired else None,
                            "model": definition.get("model") or "", **info(sid)})
        new = []
        for d in paired:
            if d.get("friendly_name") in registered:
                continue
            definition = d.get("definition") or {}
            new.append({"name": d.get("friendly_name", ""), "ieee": d.get("ieee_address", ""),
                        "model": definition.get("model") or d.get("model_id") or "",
                        "vendor": definition.get("vendor") or "",
                        "description": definition.get("description") or "",
                        "supported": bool(d.get("supported", True)),
                        "interviewing": bool(d.get("interviewing")),
                        "guess": guess_kind(definition.get("description") or "", definition.get("exposes"))})
        rf_reg = read_rf(self.devices_path)
        rf_sensors = []
        for key, cfg in rf_reg.items():
            model, _, ident = key.partition("/")
            sid = cfg.get("sensor_id") or model
            kind = guess_rf_kind(model)
            if kind == "air" and "canopy_temp" in str(cfg.get("map", "")):
                kind = "canopy"
            rf_sensors.append({"key": key, "model": model, "id": ident, "sensor_id": sid,
                               "zone": cfg.get("zone", ""), "kind": kind,
                               "rssi": seen.get(sid.upper(), {}).get("rssi"), **info(sid)})
        heard_all = self._heard()
        rf_new, rf_other = [], 0
        for h in heard_all:
            key = f"{h['model']}/{h['id']}" if h.get("id") else h["model"]
            if key in rf_reg:
                continue                       # 이미 이 id 로 등록됨
            # 모델만 적은 기본 칸(Fineoffset-WS90)으로 받고 있는 장치도 띄운다 — 등록하면 이 한 대로 좁혀
            # 이웃집 같은 모델이 섞이지 않는다. 화면이 그 사정을 한 줄로 알린다(model_only).
            if h["age_min"] > 15:
                continue
            if not _RF_SENSOR_RE.search(h["model"]):
                rf_other += 1
                continue
            rf_new.append({**h, "key": key, "guess": guess_rf_kind(h["model"]),
                           "model_only": h["model"] in rf_reg})
        rf_new.sort(key=lambda x: (x.get("rssi") is None, -(x.get("rssi") or -99)))
        eco_reg = read_eco(self.devices_path)
        eco = self._eco_snapshot(eco_reg, info)
        ble = self._ble_snapshot(info)
        left = max(0, int(self.permit_until - time.time()))
        return {
            "dongle": self._dongle(), "rtlsdr": self._rtlsdr(), "units": units,
            "mqtt": err is None, "mqtt_error": err, "z2m": z2m_online,
            "installed": units.get("zigbee2mqtt") is not None and Path("/opt/zigbee2mqtt").exists(),
            "permit_left": left, "sensors": sensors, "new": new,
            "taken": sorted(self._taken(registered, rf_reg)),
            "rf_sensors": rf_sensors, "rf_new": rf_new, "rf_other": rf_other,
            "rf_heard_ok": self._heard_path().exists(),
            "ble_sensors": ble,
            **eco,
        }

    def _eco_snapshot(self, eco_reg: dict, info) -> dict:
        """에코윗 — 등록된 게이트웨이·채널, 들어온 게이트웨이와 거기 붙은 아직 등록 안 한 센서."""
        gw = eco_reg.get("gateway")
        mykey = eco_reg.get("passkey") or ""
        sensors = []
        if gw is not None:
            sid = gw.get("sensor_id") or "WS90-01"
            sensors.append({"key": "gateway", "sensor_id": sid, "kind": "weather", "zone": gw.get("zone", "mast"),
                            "label": "", **info(sid)})
        for key, cfg in eco_reg.get("channels", {}).items():
            m = _ECO_KEY_RE.match(key)
            fam = m.group(1) if m else ""
            kind = ECO_FAMILIES.get(fam, ("",))[0] or ("canopy" if "canopy_temp" in str(cfg.get("map", "")) else "air")
            sid = cfg.get("sensor_id") or key.upper()
            sensors.append({"key": key, "sensor_id": sid, "kind": kind, "zone": cfg.get("zone", ""),
                            "channel": int(m.group(2)) if m else None, **info(sid)})
        try:
            heard = json.loads((self.data_dir / "capture" / "ecowitt_heard.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            heard = {}
        now = dt.datetime.now()
        gateways, new = [], []
        for g in heard.get("gateways") or []:
            try:
                age = int((now - dt.datetime.fromisoformat(g["last"])).total_seconds() // 60)
            except (KeyError, ValueError, TypeError):
                continue
            passkey = str(g.get("passkey") or "")
            if not _PASSKEY_RE.match(passkey):
                passkey = ""
            # 열쇠를 정한 뒤로는 그 게이트웨이만 '내 것'이다. 아직 아무것도 등록 안 했으면 고를 수 있다.
            mine = bool(mykey) and passkey.upper() == mykey.upper()
            gateways.append({"passkey": passkey, "ip": str(g.get("ip", ""))[:45],
                             "model": str(g.get("stationtype") or g.get("model") or "")[:40], "age_min": age,
                             "registered": mine})
            if age > 30 or not passkey or (mykey and not mine):
                continue
            # 같은 망에 게이트웨이가 여럿이면 같은 열쇠(gateway·soil1)가 겹친다 — id 에 열쇠를 붙여 구분한다.
            if g.get("outdoor") and gw is None:
                new.append({"id": f"{passkey}:gateway", "key": "gateway", "passkey": passkey, "kind": "weather",
                            "model": "WS90" if g.get("ws90") else "", "age_min": age})
            for ch in g.get("channels") or []:
                if ch in eco_reg.get("channels", {}) or not _ECO_KEY_RE.match(ch):
                    continue
                fam = _ECO_KEY_RE.match(ch).group(1)
                new.append({"id": f"{passkey}:{ch}", "key": ch, "family": fam, "channel": int(ch[len(fam):]),
                            "kind": ECO_FAMILIES[fam][0], "age_min": age, "passkey": passkey})
        return {"eco_sensors": sensors, "eco_gateways": gateways, "eco_new": new, "ip": local_ip(),
                "eco_port": 8088, "eco_path": "/data/report/"}

    def _taken(self, registered: dict, rf_reg: dict) -> set[str]:
        eco = read_eco(self.devices_path)
        return {(c.get("sensor_id") or n).upper() for n, c in registered.items()} | \
               {(c.get("sensor_id") or k.split("/")[0]).upper() for k, c in rf_reg.items()} | \
               {(c.get("sensor_id") or k).upper() for k, c in eco["channels"].items()} | \
               ({(eco["gateway"].get("sensor_id") or "WS90-01").upper()} if eco["gateway"] is not None else set()) | \
               {(c.get("sensor_id") or k).upper() for k, c in read_tuya_ble(self.devices_path).items()}

    def _ble_snapshot(self, info) -> list[dict]:
        """투야 블루투스 센서 — 등록(tuya_ble:)과 수집기가 남긴 마지막 시도(tuyable_heard.json)."""
        reg = read_tuya_ble(self.devices_path)
        if not reg:
            return []
        try:
            heard = json.loads((self.data_dir / "capture" / "tuyable_heard.json").read_text(encoding="utf-8"))
            tries = {str(s.get("sensor_id", "")).upper(): s for s in heard.get("sensors", [])}
        except (OSError, ValueError, AttributeError):
            tries = {}
        out = []
        for dev_id, cfg in reg.items():
            sid = cfg.get("sensor_id") or dev_id
            h = tries.get(sid.upper(), {})
            out.append({"sensor_id": sid, "zone": cfg.get("zone", ""), "name": cfg.get("name", ""),
                        "error": h.get("error") or "", "rssi": h.get("rssi"), **info(sid)})
        return out

    def _heard_path(self) -> Path:
        return self.data_dir / "capture" / "rtl433_heard.json"

    def _heard(self) -> list[dict]:
        """433MHz 수집기가 남긴 '근처에서 들리는 장치' (rtl433_bridge.Heard)."""
        try:
            data = json.loads(self._heard_path().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        now = dt.datetime.now()
        out = []
        for d in data.get("devices") or []:
            try:
                last = dt.datetime.fromisoformat(d["last"])
            except (KeyError, ValueError, TypeError):
                continue
            model, ident = str(d.get("model", "")), str(d.get("id", ""))
            if not _RF_MODEL_RE.match(model) or not _RF_ID_RE.match(ident):
                continue                       # 열쇠로 그대로 쓰므로 이상한 글자는 받지 않는다
            out.append({"model": model, "id": ident, "count": int(d.get("count") or 0),
                        "rssi": d.get("rssi"), "age_min": int((now - last).total_seconds() // 60)})
        return out

    # 동작 ------------------------------------------------------------------
    def _request(self, name: str, payload: dict, timeout: float = 6.0) -> dict:
        with _mqtt(self.host, self.port) as m:
            m.subscribe(f"{self.base}/bridge/response/{name}")
            m._pending.clear()                  # 이전 요청의 보존 응답은 우리 것이 아니다
            m.publish(f"{self.base}/bridge/request/{name}", payload)
            for _topic, text in m.messages(timeout):
                try:
                    return json.loads(text)
                except ValueError:
                    continue
        raise MqttError("Zigbee2MQTT 가 응답하지 않습니다 — 서비스가 도는지 확인하세요")

    def permit(self, seconds: int = 120) -> dict:
        seconds = max(0, min(int(seconds), 254))
        try:
            # 1.x 는 {"value": true, "time": n}, 2.x 는 {"time": n}. 1.x 형식이 거절되면 2.x 로.
            r = self._request("permit_join", {"value": seconds > 0, "time": seconds})
            if r.get("status") != "ok":
                r = self._request("permit_join", {"time": seconds})
        except MqttError as exc:
            return {"ok": False, "error": str(exc)}
        if r.get("status") != "ok":
            return {"ok": False, "error": r.get("error") or "페어링 모드를 열지 못했습니다"}
        self.permit_until = time.time() + seconds
        return {"ok": True, "seconds": seconds}

    def register(self, current: str, kind_key: str, zone: str, note: str = "") -> dict:
        with self._lock:
            return self._register(current, kind_key, zone, note)

    def _register(self, current: str, kind_key: str, zone: str, note: str = "") -> dict:
        if kind_key not in KINDS or zone not in ZONES:
            return {"ok": False, "error": "종류나 구간이 올바르지 않습니다"}
        registered = read_registered(self.devices_path)
        taken = self._taken(registered, read_rf(self.devices_path))
        sid = suggest_id(kind_key, zone, taken)
        name = sid.lower()
        if name in registered or not _NAME_RE.match(name):
            return {"ok": False, "error": "이름을 만들지 못했습니다"}
        if not self.devices_path.exists():
            return {"ok": False, "error": f"설정 파일이 없습니다({self.devices_path}) — setup-wireless.sh 를 먼저 실행하세요"}
        if current != name:
            try:
                r = self._request("device/rename", {"from": current, "to": name, "homeassistant_rename": False})
            except MqttError as exc:
                return {"ok": False, "error": str(exc)}
            if r.get("status") != "ok":
                return {"ok": False, "error": r.get("error") or "이름을 바꾸지 못했습니다"}
        try:
            add_device(self.devices_path, name, kind_key, zone, sid, clean_note(note))
        except OSError as exc:
            return {"ok": False, "error": f"설정 파일에 쓰지 못했습니다: {exc}"}
        return {"ok": True, "name": name, "sensor_id": sid}

    def register_rf(self, model: str, ident: str, kind: str, zone: str, note: str = "") -> dict:
        """433MHz 센서 등록 — rf: 칸에 '모델/id' 한 줄. 수집기가 몇 초 안에 다시 읽는다."""
        with self._lock:
            return _rf_register(self, model, ident, kind, zone, note)

    def remove_rf(self, key: str) -> dict:
        with self._lock:
            try:
                return {"ok": remove_rf(self.devices_path, key)}
            except OSError as exc:
                return {"ok": False, "error": f"설정 파일에 쓰지 못했습니다: {exc}"}

    def register_eco(self, key: str, kind: str, zone: str, passkey: str = "", note: str = "") -> dict:
        """에코윗 등록. key 가 "gateway" 면 게이트웨이 본체 센서(WS90 등), 아니면 채널(soil1·th2 …)."""
        with self._lock:
            return _eco_register(self, key, kind, zone, passkey, note)

    def remove_eco(self, key: str) -> dict:
        with self._lock:
            try:
                ok = remove_eco(self.devices_path, key)
                eco = read_eco(self.devices_path)
                if eco["gateway"] is None and not eco["channels"] and eco["passkey"]:
                    set_eco_passkey(self.devices_path, "")   # 다 뺐으면 다른 게이트웨이를 고를 수 있게
                return {"ok": ok}
            except OSError as exc:
                return {"ok": False, "error": f"설정 파일에 쓰지 못했습니다: {exc}"}

    def remove(self, name: str) -> dict:
        with self._lock:
            return self._remove(name)

    def _remove(self, name: str) -> dict:
        try:
            removed = remove_device(self.devices_path, name)
        except OSError as exc:
            return {"ok": False, "error": f"설정 파일에 쓰지 못했습니다: {exc}"}
        unpaired = False
        try:   # 페어링도 푼다 — 같은 센서를 다시 쓰려면 다시 찾기로 붙인다
            unpaired = self._request("device/remove", {"id": name, "force": False}).get("status") == "ok"
        except MqttError:
            pass
        return {"ok": removed or unpaired, "removed": removed, "unpaired": unpaired}


def _rf_register(w: "Wireless", model: str, ident: str, kind: str, zone: str, note: str = "") -> dict:
    if kind not in RF_KINDS or zone not in ZONES or not _RF_MODEL_RE.match(model) or not _RF_ID_RE.match(ident):
        return {"ok": False, "error": "요청이 올바르지 않습니다"}
    if not w.devices_path.exists():
        return {"ok": False, "error": f"설정 파일이 없습니다({w.devices_path}) — setup-wireless.sh 를 먼저 실행하세요"}
    rf_reg = read_rf(w.devices_path)
    if (kind in ("weather", "rain") or guess_rf_kind(model) == "weather") and read_eco(w.devices_path)["gateway"] is not None:
        return {"ok": False, "error": "기상센서를 에코윗 게이트웨이로 받고 있습니다 — 같은 비가 두 번 더해지지 "
                                      "않게, 게이트웨이 칸을 먼저 빼세요"}
    key = f"{model}/{ident}" if ident else model
    if key in rf_reg:
        return {"ok": False, "error": "이미 등록된 센서입니다"}
    sid = None
    # 기본 설정의 '모델만 적은' 칸(Fineoffset-WS90)은 그 모델이면 이웃집 것까지 받는다.
    # 같은 모델을 id 로 등록하면 그 칸을 걷어 내고 이름(WS90-01)을 이어받는다 — 기록이 끊기지 않게.
    if ident and model in rf_reg:
        sid = rf_reg[model].get("sensor_id") or None
        remove_rf(w.devices_path, model)
    if not sid:
        sid = suggest_rf_id(kind, zone, model, w._taken(read_registered(w.devices_path), read_rf(w.devices_path)))
    try:
        add_rf(w.devices_path, key, zone, sid, note, RF_KINDS[kind].get("map"))
    except OSError as exc:
        return {"ok": False, "error": f"설정 파일에 쓰지 못했습니다: {exc}"}
    return {"ok": True, "key": key, "sensor_id": sid}


def _eco_register(w: "Wireless", key: str, kind: str, zone: str, passkey: str = "", note: str = "") -> dict:
    if zone not in ZONES:
        return {"ok": False, "error": "구간이 올바르지 않습니다"}
    if not w.devices_path.exists():
        return {"ok": False, "error": f"설정 파일이 없습니다({w.devices_path}) — setup-wireless.sh 를 먼저 실행하세요"}
    eco = read_eco(w.devices_path)
    taken = w._taken(read_registered(w.devices_path), read_rf(w.devices_path))
    note = clean_note(note)
    passkey = passkey if _PASSKEY_RE.match(passkey or "") else ""
    if not passkey:
        return {"ok": False, "error": "게이트웨이 열쇠(PASSKEY)를 읽지 못했습니다 — 게이트웨이가 다시 보낸 뒤 해 보세요"}
    if eco["passkey"] and eco["passkey"].upper() != passkey.upper():
        return {"ok": False, "error": "다른 게이트웨이가 이미 등록돼 있습니다 — 그쪽 센서를 먼저 모두 빼세요"}
    try:
        if not eco["passkey"]:
            set_eco_passkey(w.devices_path, passkey)   # 이 게이트웨이만 받는다(채널만 등록해도)
    except OSError as exc:
        return {"ok": False, "error": f"설정 파일에 쓰지 못했습니다: {exc}"}
    if key == "gateway":
        if eco["gateway"] is not None:
            return {"ok": False, "error": "게이트웨이가 이미 등록돼 있습니다"}
        # 같은 WS90 을 433MHz(RTL-SDR)로도 받고 있으면 그 칸을 걷고 이름을 이어받는다 —
        # 두 길로 받으면 같은 비가 두 번 더해진다(devices.yaml 머리말).
        sid = None
        for rkey, cfg in read_rf(w.devices_path).items():
            if guess_rf_kind(rkey.split("/")[0]) == "weather":
                sid = sid or cfg.get("sensor_id")
                remove_rf(w.devices_path, rkey)
        if not sid:
            sid = suggest_rf_id("weather", "mast", "WS90", taken)
        fields = {"zone": zone, "sensor_id": sid, "note": note}
        try:
            add_eco(w.devices_path, "gateway", fields)
        except OSError as exc:
            return {"ok": False, "error": f"설정 파일에 쓰지 못했습니다: {exc}"}
        return {"ok": True, "key": "gateway", "sensor_id": sid}
    m = _ECO_KEY_RE.match(key or "")
    if not m:
        return {"ok": False, "error": "채널이 올바르지 않습니다"}
    if key in eco["channels"]:
        return {"ok": False, "error": "이미 등록된 채널입니다"}
    fam = m.group(1)
    fixed, prefix, zoned = ECO_FAMILIES[fam]
    mapping = None
    if fam == "th":
        if kind not in ("canopy", "air"):
            return {"ok": False, "error": "온습도계는 초관부(지상 10cm)인지 기온(2m)인지 골라야 합니다"}
        prefix, zoned = ("CN", True) if kind == "canopy" else ("AIR", False)
        mapping = {"t_air": "canopy_temp"} if kind == "canopy" else None
    letter = ZONES.get(zone, "") if zoned else ""
    sid = next((x for x in (f"{prefix}-{letter}{n}" if letter else f"{prefix}-{n:02d}" for n in range(1, 100))
                if x not in taken), None)
    if sid is None:
        return {"ok": False, "error": "이름이 가득 찼습니다"}
    fields = {"zone": zone, "sensor_id": sid, "note": note}
    if mapping:
        fields["map"] = "{" + ", ".join(f"{a}: {b}" for a, b in mapping.items()) + "}"
    try:
        add_eco(w.devices_path, key, fields)
    except OSError as exc:
        return {"ok": False, "error": f"설정 파일에 쓰지 못했습니다: {exc}"}
    return {"ok": True, "key": key, "sensor_id": sid}


def guess_kind(description: str, exposes=None) -> str:
    """찾은 센서의 종류를 미리 짐작한다(화면이 그 칸을 먼저 골라 둔다). 틀리면 사람이 바꾼다."""
    text = (description or "").lower()
    names = set()
    for e in exposes or []:
        if isinstance(e, dict):
            names.add(e.get("property") or e.get("name") or "")
            for f in e.get("features") or []:
                if isinstance(f, dict):
                    names.add(f.get("property") or "")
    if "soil" in text or "soil_moisture" in names:
        return "soil"
    if "water_leak" in names or "leak" in text:
        return "leak"
    if "valve" in text or "flow" in names:
        return "valve"
    if {"power", "current"} & names or "breaker" in text or "circuit" in text:
        return "breaker-aux"
    if {"temperature", "humidity"} <= names or "temperature" in text:
        return "canopy"
    return ""
