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
#: 구간. 센서 이름의 가운데 글자(CN-T1 의 T)가 여기서 나온다.
ZONES = {"treatment": "T", "control": "C", "facility": "", "mast": ""}

#: 상태를 볼 서비스(setup-wireless.sh 가 만드는 이름).
UNITS = ("mosquitto", "zigbee2mqtt", "farm365-zigbee", "farm365-rtl433")

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
        cid = "farm365-ui-" + uuid.uuid4().hex[:8]
        body = _str("MQTT") + bytes([4, 0x02]) + struct.pack("!H", 30) + _str(cid)
        self._send(0x10, body)
        kind, data = self._read(self.timeout)
        if kind != 0x20 or len(data) < 2 or data[1] != 0:
            raise MqttError("MQTT 브로커가 연결을 거절했습니다")
        return self

    def __exit__(self, *exc) -> None:
        if self.sock:
            try:
                self._send(0xE0, b"")
                self.sock.close()
            except OSError:
                pass
            self.sock = None

    def _send(self, header: int, body: bytes) -> None:
        assert self.sock is not None
        self.sock.sendall(bytes([header]) + _varint(len(body)) + body)

    def _recv_exact(self, n: int, deadline: float) -> bytes:
        assert self.sock is not None
        while len(self._buf) < n:
            left = deadline - time.monotonic()
            if left <= 0:
                raise TimeoutError
            self.sock.settimeout(left)
            try:
                chunk = self.sock.recv(4096)
            except socket.timeout as exc:
                raise TimeoutError from exc
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
            kind, data = self._read(max(0.01, deadline - time.monotonic()))
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
    try:
        tmp = config_path.with_name(config_path.name + ".tmp")
        tmp.write_text("".join(lines), encoding="utf-8")
        os.chmod(tmp, 0o600)
        os.replace(tmp, config_path)
        return True
    except OSError:
        return False


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
            for src in ("zigbee", "rtl433", "ecowitt"):
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
                    if row[3] in ("battery_pct", "linkquality"):
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
        left = max(0, int(self.permit_until - time.time()))
        return {
            "dongle": self._dongle(), "rtlsdr": self._rtlsdr(), "units": units,
            "mqtt": err is None, "mqtt_error": err, "z2m": z2m_online,
            "installed": units.get("zigbee2mqtt") is not None and Path("/opt/zigbee2mqtt").exists(),
            "permit_left": left, "sensors": sensors, "new": new,
            "taken": sorted({(c.get("sensor_id") or n).upper() for n, c in registered.items()}),
        }

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
        if kind_key not in KINDS or zone not in ZONES:
            return {"ok": False, "error": "종류나 구간이 올바르지 않습니다"}
        registered = read_registered(self.devices_path)
        taken = {(c.get("sensor_id") or n) for n, c in registered.items()}
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
            add_device(self.devices_path, name, kind_key, zone, sid, note[:40].replace(",", " ").replace("}", ""))
        except OSError as exc:
            return {"ok": False, "error": f"설정 파일에 쓰지 못했습니다: {exc}"}
        return {"ok": True, "name": name, "sensor_id": sid}

    def remove(self, name: str) -> dict:
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
