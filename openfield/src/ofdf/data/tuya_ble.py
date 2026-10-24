"""투야 블루투스(BLE) 센서 — 통신 규격(포장·암호·데이터포인트)과 값 변환.

투야 블루투스 센서는 값을 그냥 뿌리지 않는다. 연결해서 기기 열쇠(local_key)로 로그인해야
값(데이터포인트, DP)을 준다. 열쇠는 투야 클라우드에서 한 번 받아 둔다(tuya_ble_setup.py).
그 뒤로는 인터넷 없이 라즈베리파이가 직접 읽는다.

규격은 공개 구현 ha_tuya_ble(PlusPlus-ua, MIT)을 따랐다:
  · 패킷: [번호(varint)] [첫 패킷만: 전체 길이(varint), 규격판<<4] [암호문 조각…] — GATT 20바이트씩
  · 암호문: 보안표시(1) + IV(16) + AES-CBC( seq(4) 응답대상(4) 명령(2) 길이(2) 자료 CRC16(2) 0채움 )
  · 열쇠: 로그인 = md5(local_key[:6]), 세션 = md5(local_key[:6] + srand) — srand 는 기기정보 응답에서
  · DP(v3): id(1) 형(1) 길이(1) 값 — 값 형 2(정수)·4(열거)는 부호 있는 big-endian

이 파일은 블루투스 장치를 만지지 않는다(bleak 없이 시험할 수 있게). 연결은 scripts/tuya_ble_bridge.py.
"""

from __future__ import annotations

import hashlib
import secrets
import time
from dataclasses import dataclass, field
from struct import pack, unpack

GATT_MTU = 20
CHAR_NOTIFY = "00002b10-0000-1000-8000-00805f9b34fb"
CHAR_WRITE = "00002b11-0000-1000-8000-00805f9b34fb"
SERVICE_UUID = "0000a201-0000-1000-8000-00805f9b34fb"
MANUFACTURER_ID = 0x07D0

# 명령
DEVICE_INFO = 0x0000
PAIR = 0x0001
DEVICE_STATUS = 0x0003
RECEIVE_DP = 0x8001
RECEIVE_TIME_DP = 0x8003
RECEIVE_SIGN_DP = 0x8004
RECEIVE_SIGN_TIME_DP = 0x8005
RECEIVE_DP_V4 = 0x8006
RECEIVE_TIME_DP_V4 = 0x8007
TIME1_REQ = 0x8011
TIME2_REQ = 0x8012

#: 열쇠 계산 방식 — 표준이 먼저, 나머지는 표준이 대답을 못 받을 때만.
KEY_VARIANTS = ("std", "full", "raw")

DP_RECEIVE_CODES = {RECEIVE_DP, RECEIVE_TIME_DP, RECEIVE_SIGN_DP, RECEIVE_SIGN_TIME_DP,
                    RECEIVE_DP_V4, RECEIVE_TIME_DP_V4}


class TuyaBLEError(Exception):
    pass


def _aes():
    try:
        from Crypto.Cipher import AES  # pycryptodome
    except ImportError as exc:  # pragma: no cover — 장비에는 setup-tuya-ble.sh 가 깐다
        raise TuyaBLEError("pycryptodome 이 없습니다 — setup-tuya-ble.sh 를 실행하세요") from exc
    return AES


def crc16(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte & 255
        for _ in range(8):
            tmp = crc & 1
            crc >>= 1
            if tmp:
                crc ^= 0xA001
    return crc


def pack_int(value: int) -> bytes:
    out = bytearray()
    while True:
        b = value & 0x7F
        value >>= 7
        if value:
            b |= 0x80
        out.append(b)
        if not value:
            return bytes(out)


def unpack_int(data: bytes, pos: int) -> tuple[int, int]:
    result = 0
    for offset in range(5):
        if pos + offset >= len(data):
            raise TuyaBLEError("자료가 짧습니다(varint)")
        b = data[pos + offset]
        result |= (b & 0x7F) << (offset * 7)
        if not b & 0x80:
            return result, pos + offset + 1
    raise TuyaBLEError("varint 형식 오류")


@dataclass
class Keys:
    """local_key 앞 6글자로 만든 열쇠들. 세션 열쇠는 기기정보 응답(srand)을 받은 뒤에 생긴다."""
    local_key: bytes
    login: bytes
    session: bytes | None = None
    auth: bytes | None = None

    @classmethod
    def from_local_key(cls, local_key: str, variant: str = "std") -> "Keys":
        k = cls(local_key=b"", login=b"")
        k.use_variant(local_key, variant)
        return k

    def use_variant(self, local_key: str, variant: str) -> None:
        """열쇠 계산 방식을 고른다. 표준(std)은 공개 구현 둘(ha_tuya_ble·tuya-ble-sdk)이 쓰는 것:
        로그인 = md5(local_key 앞 6글자), 세션 = md5(앞 6글자 + srand).
        센서가 표준에 대답하지 않을 때만 다른 둘을 시험한다 — 틀린 열쇠의 요청은 센서가 조용히 버리므로
        시험해도 해가 없다. full: local_key 전체로 md5, raw: local_key 16글자를 그대로 열쇠로."""
        if variant == "full":
            self.local_key = local_key.encode()
            self.login = hashlib.md5(self.local_key).digest()
        elif variant == "raw":
            if len(local_key) != 16:
                raise TuyaBLEError("raw 열쇠는 local_key 가 16글자일 때만")
            self.local_key = local_key[:6].encode()
            self.login = local_key.encode()
        else:
            self.local_key = local_key[:6].encode()
            self.login = hashlib.md5(self.local_key).digest()
        self.session = None
        self.auth = None

    def for_flag(self, flag: int) -> bytes:
        key = {1: self.auth, 4: self.login, 5: self.session}.get(flag)
        if not key:
            raise TuyaBLEError(f"이 보안표시({flag})의 열쇠가 아직 없습니다")
        return key


def build_packets(keys: Keys, seq: int, code: int, data: bytes, response_to: int = 0,
                  protocol_version: int = 3, iv: bytes | None = None) -> list[bytes]:
    """보낼 명령 하나를 GATT 조각들로."""
    if code == DEVICE_INFO:
        key, flag = keys.login, 4
    else:
        if not keys.session:
            raise TuyaBLEError("세션 열쇠 없이 보낼 수 없습니다(기기정보를 먼저)")
        key, flag = keys.session, 5
    iv = iv or secrets.token_bytes(16)
    raw = bytearray(pack(">IIHH", seq, response_to, code, len(data)) + data)
    raw += pack(">H", crc16(bytes(raw)))
    while len(raw) % 16:
        raw.append(0)
    enc = bytes([flag]) + iv + _aes().new(key, _aes().MODE_CBC, iv).encrypt(bytes(raw))
    out, num, pos = [], 0, 0
    while pos < len(enc):
        head = bytearray(pack_int(num))
        if num == 0:
            head += pack_int(len(enc))
            head.append((protocol_version << 4) & 0xFF)
        part = enc[pos:pos + GATT_MTU - len(head)]
        out.append(bytes(head + part))
        pos += len(part)
        num += 1
    return out


@dataclass
class Message:
    seq: int
    response_to: int
    code: int
    data: bytes


class Reassembler:
    """알림(notify) 조각을 모아 한 메시지로 풀어낸다."""

    def __init__(self, keys: Keys) -> None:
        self.keys = keys
        self._buf: bytearray | None = None
        self._expect_num = 0
        self._expect_len = 0

    def _reset(self) -> None:
        self._buf, self._expect_num, self._expect_len = None, 0, 0

    def feed(self, chunk: bytes) -> Message | None:
        num, pos = unpack_int(chunk, 0)
        if num == 0:
            self._buf = bytearray()
            self._expect_num = 0
            self._expect_len, pos = unpack_int(chunk, pos)
            pos += 1                                   # 규격판 바이트
        elif self._buf is None or num != self._expect_num:
            self._reset()
            raise TuyaBLEError(f"조각 순서가 틀렸습니다({num})")
        self._buf += chunk[pos:]
        self._expect_num += 1
        if len(self._buf) > self._expect_len:
            self._reset()
            raise TuyaBLEError("조각 길이가 넘칩니다")
        if len(self._buf) < self._expect_len:
            return None
        buf = bytes(self._buf)
        self._reset()
        return decrypt_message(self.keys, buf)


def decrypt_message(keys: Keys, buf: bytes) -> Message:
    flag, iv, enc = buf[0], buf[1:17], buf[17:]
    if len(enc) % 16:
        raise TuyaBLEError("암호문 길이가 16의 배수가 아닙니다")
    raw = _aes().new(keys.for_flag(flag), _aes().MODE_CBC, iv).decrypt(enc)
    seq, response_to, code, length = unpack(">IIHH", raw[:12])
    end = 12 + length
    if len(raw) < end:
        raise TuyaBLEError("자료가 짧습니다")
    if len(raw) >= end + 2 and crc16(raw[:end]) != unpack(">H", raw[end:end + 2])[0]:
        raise TuyaBLEError("CRC 가 맞지 않습니다(열쇠가 틀렸을 수 있음)")
    return Message(seq, response_to, code, raw[12:end])


def apply_device_info(keys: Keys, data: bytes) -> dict:
    """기기정보 응답 → 세션 열쇠. 규격판·묶임 여부를 돌려준다."""
    if len(data) < 46:
        raise TuyaBLEError("기기정보 응답이 짧습니다")
    srand = data[6:12]
    keys.session = hashlib.md5(keys.local_key + srand).digest()
    keys.auth = data[14:46]
    return {"device_version": f"{data[0]}.{data[1]}", "protocol_version": data[2],
            "bound": data[5] != 0}


def pairing_request(uuid: str, local_key: str, device_id: str) -> bytes:
    out = uuid.encode() + local_key[:6].encode() + device_id.encode()
    return out + b"\x00" * max(0, 44 - len(out))


def _value(dtype: int, raw: bytes):
    if dtype in (2, 4):                       # 정수·열거
        return int.from_bytes(raw, "big", signed=True)
    if dtype == 1:
        return int.from_bytes(raw, "big") != 0
    if dtype == 3:
        return raw.decode("utf-8", "replace")
    return raw.hex()                           # 원본·비트맵


def _parse_dp_list(data: bytes, pos: int, head: int) -> dict[int, object]:
    out: dict[int, object] = {}
    while len(data) - pos >= head + 1:
        dp_id, dtype = data[pos], data[pos + 1]
        length = int.from_bytes(data[pos + 2:pos + head], "big")
        pos += head
        if pos + length > len(data) or dtype > 5:
            raise TuyaBLEError("DP 형식 오류")
        out[dp_id] = _value(dtype, data[pos:pos + length])
        pos += length
    if pos != len(data):
        raise TuyaBLEError("DP 뒤에 남는 바이트가 있습니다")
    return out


def _skip_time(data: bytes, pos: int) -> int:
    if pos >= len(data):
        raise TuyaBLEError("시각 칸이 없습니다")
    return pos + 1 + (13 if data[pos] == 0 else 4)


def parse_dps(code: int, data: bytes) -> dict[int, object]:
    """DP 보고 메시지 → {dp 번호: 값}. 서명·시각이 붙은 형식도 받는다(v3, v4)."""
    v4 = code in (RECEIVE_DP_V4, RECEIVE_TIME_DP_V4)
    head = 4 if v4 else 3
    if code in (RECEIVE_SIGN_DP, RECEIVE_SIGN_TIME_DP):
        # dp 순번(2) + flags(1) 뒤에 DP. 참고 구현은 서명 DP 를 2바이트 뒤부터 읽는다 —
        # 펌웨어마다 다를 수 있어 둘 다 해 보고 끝까지 맞아떨어지는 쪽을 쓴다.
        last: TuyaBLEError | None = None
        for start in (3, 2):
            try:
                pos = _skip_time(data, start) if code == RECEIVE_SIGN_TIME_DP else start
                return _parse_dp_list(data, pos, head)
            except TuyaBLEError as exc:
                last = exc
        raise last or TuyaBLEError("DP 형식 오류")
    pos = 3 if code == RECEIVE_DP_V4 else 0          # v4: dp 순번(2) + flags(1)
    if code in (RECEIVE_TIME_DP, RECEIVE_TIME_DP_V4):
        pos = _skip_time(data, pos)
    return _parse_dp_list(data, pos, head)


def time_response(code: int) -> bytes:
    """기기가 시각을 물으면(8011·8012) 돌려줄 값."""
    tz = -int(time.timezone / 36)
    if code == TIME1_REQ:
        return str(int(time.time() * 1000)).encode() + pack(">h", tz)
    t = time.localtime()
    return pack(">BBBBBBBh", t.tm_year % 100, t.tm_mon, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec,
                t.tm_wday, tz)


def advertised_protocol(manufacturer_data: dict) -> int | None:
    """광고의 규격판(첫 명령을 보낼 때 패킷 머리에 쓴다)."""
    md = (manufacturer_data or {}).get(MANUFACTURER_ID)
    return md[1] if md and len(md) > 6 else None


def decode_advertisement(service_data: dict, manufacturer_data: dict) -> str | None:
    """광고에서 기기 uuid 를 꺼낸다(클라우드에서 받은 uuid 와 맞춰 주소를 찾는다)."""
    sd = None
    for k, v in (service_data or {}).items():
        if str(k).lower() == SERVICE_UUID:
            sd = v
    md = (manufacturer_data or {}).get(MANUFACTURER_ID)
    if not sd or len(sd) < 2 or sd[0] != 0 or not md or len(md) <= 6:
        return None
    key = hashlib.md5(bytes(sd[1:])).digest()
    raw = _aes().new(key, _aes().MODE_CBC, key).decrypt(bytes(md[6:]))
    try:
        return raw.decode("utf-8").strip("\x00")
    except UnicodeDecodeError:
        return None


# ── 값 → 수집 변수 ───────────────────────────────────────────────────────────
#: 투야 블루투스 토양센서의 DP 배치는 제품마다 다르다. 알려진 둘을 기본으로 두고,
#: 설정(dps:)으로 덮을 수 있다. 처음 붙일 때 받은 DP 전부를 기록(capture)에 남겨 확인하게 한다.
KNOWN_SOIL_LAYOUTS = (
    {"soil_temp": (1, 10.0), "soil_moisture": (2, 1.0), "battery_pct": (4, 1.0)},    # wsdcg/ojzlzzsw
    {"soil_moisture": (3, 1.0), "soil_temp": (5, 10.0), "battery_pct": (15, 1.0)},   # zwjcy 계열
)
UNITS = {"soil_temp": "degC", "soil_moisture": "%", "battery_pct": "%", "t_air": "degC", "rh": "%"}
RANGES = {"soil_temp": (-30, 70), "soil_moisture": (0, 100), "battery_pct": (0, 100),
          "t_air": (-50, 70), "rh": (0, 100)}


@dataclass
class Mapping:
    vars: dict[str, tuple[int, float]] = field(default_factory=dict)

    @classmethod
    def from_config(cls, cfg: dict | None) -> "Mapping | None":
        """설정 {soil_moisture: 3, soil_temp: 5, soil_temp_scale: 10, battery_pct: 15} → Mapping."""
        if not cfg:
            return None
        out = {}
        for var in UNITS:
            if var in cfg:
                out[var] = (int(cfg[var]), float(cfg.get(f"{var}_scale", 10.0 if var.endswith("temp") or var == "t_air" else 1.0)))
        return cls(out) if out else None


def guess_mapping(dps: dict[int, object]) -> Mapping | None:
    """받은 DP 번호로 알려진 배치 중 맞는 것을 고른다. 모르면 None(설정이 필요)."""
    nums = {k for k, v in dps.items() if isinstance(v, int) and not isinstance(v, bool)}
    for layout in KNOWN_SOIL_LAYOUTS:
        need = {layout["soil_moisture"][0], layout["soil_temp"][0]}
        if need <= nums:
            return Mapping(dict(layout))
    return None


def to_rows(dps: dict[int, object], mapping: Mapping, *, zone: str, sensor_id: str, ts: str) -> list[dict]:
    rows = []
    for var, (dp, scale) in mapping.vars.items():
        v = dps.get(dp)
        if not isinstance(v, int) or isinstance(v, bool):
            continue
        value = v / scale if scale else float(v)
        lo, hi = RANGES.get(var, (-1e9, 1e9))
        quality = "ok" if lo <= value <= hi else "out_of_range"
        rows.append({"ts": ts, "zone": zone, "sensor_id": sensor_id, "variable": var,
                     "value": round(value, 2), "unit": UNITS.get(var, ""), "quality": quality})
    return rows
