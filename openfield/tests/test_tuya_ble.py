"""투야 블루투스 — 포장·암호 왕복, 가짜 센서와 로그인부터 DP 받기까지, 값 변환."""

import asyncio
import hashlib
import importlib.util
from pathlib import Path
from struct import pack

import pytest

pytest.importorskip("Crypto.Cipher.AES")

from ofdf.data import tuya_ble as tb  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
LOCAL_KEY = "abcdefghijklmnop"
UUID = "tuya1234abcd5678"
DEV_ID = "bf0123456789abcdef"
SRAND = b"RANDOM"


def _bridge():
    spec = importlib.util.spec_from_file_location("tuya_ble_bridge", ROOT / "scripts" / "tuya_ble_bridge.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _device_info() -> bytes:
    # 판(2) 규격판(2) flags(1) 묶임(1) srand(6) 하드웨어판(2) auth(32)
    return bytes([1, 0, 3, 0, 0, 1]) + SRAND + bytes([1, 0]) + b"A" * 32


def _dp(dp_id: int, dtype: int, value: bytes) -> bytes:
    return bytes([dp_id, dtype, len(value)]) + value


def test_varint_and_crc():
    for n in (0, 1, 127, 128, 300, 70000):
        assert tb.unpack_int(tb.pack_int(n), 0) == (n, len(tb.pack_int(n)))
    assert tb.crc16(b"123456789") == 0x4B37            # CRC-16/MODBUS 검사값


def test_packets_roundtrip_login_and_session():
    keys = tb.Keys.from_local_key(LOCAL_KEY)
    assert keys.login == hashlib.md5(b"abcdef").digest()
    chunks = tb.build_packets(keys, 7, tb.DEVICE_INFO, b"")
    assert all(len(c) <= tb.GATT_MTU for c in chunks)
    assert chunks[0][2] == 3 << 4                       # 규격판 바이트
    msg = None
    r = tb.Reassembler(keys)
    for c in chunks:
        msg = r.feed(c)
    assert (msg.seq, msg.code, msg.data) == (7, tb.DEVICE_INFO, b"")

    with pytest.raises(tb.TuyaBLEError):
        tb.build_packets(keys, 8, tb.PAIR, b"x")       # 세션 열쇠 전
    meta = tb.apply_device_info(keys, _device_info())
    assert meta == {"device_version": "1.0", "protocol_version": 3, "bound": True}
    assert keys.session == hashlib.md5(b"abcdef" + SRAND).digest()
    data = bytes(range(60))
    chunks = tb.build_packets(keys, 9, tb.PAIR, data, response_to=3)
    assert len(chunks) > 3
    for c in chunks:
        msg = r.feed(c)
    assert (msg.seq, msg.response_to, msg.code, msg.data) == (9, 3, tb.PAIR, data)


def test_wrong_key_is_rejected():
    good = tb.Keys.from_local_key(LOCAL_KEY)
    chunks = tb.build_packets(good, 1, tb.DEVICE_INFO, b"hello")
    r = tb.Reassembler(tb.Keys.from_local_key("zzzzzzzzzzzz"))
    with pytest.raises(tb.TuyaBLEError):
        for c in chunks:
            r.feed(c)


def test_out_of_order_chunk():
    keys = tb.Keys.from_local_key(LOCAL_KEY)
    chunks = tb.build_packets(keys, 1, tb.DEVICE_INFO, bytes(40))
    r = tb.Reassembler(keys)
    r.feed(chunks[0])
    with pytest.raises(tb.TuyaBLEError):
        r.feed(chunks[2])


def test_pairing_request():
    req = tb.pairing_request(UUID, LOCAL_KEY, DEV_ID)
    assert len(req) == 44 and req.startswith(UUID.encode() + b"abcdef" + DEV_ID.encode())


def test_parse_dps_variants():
    body = _dp(3, 2, (31).to_bytes(4, "big")) + _dp(5, 2, (-25).to_bytes(4, "big", signed=True)) + _dp(14, 4, b"\x01")
    want = {3: 31, 5: -25, 14: 1}
    assert tb.parse_dps(tb.RECEIVE_DP, body) == want
    assert tb.parse_dps(tb.RECEIVE_SIGN_DP, b"\x00\x05\x00" + body) == want
    assert tb.parse_dps(tb.RECEIVE_TIME_DP, b"\x01" + b"\x00" * 4 + body) == want
    assert tb.parse_dps(tb.RECEIVE_TIME_DP, b"\x00" + b"1700000000000" + body) == want
    assert tb.parse_dps(tb.RECEIVE_SIGN_TIME_DP, b"\x00\x05\x00\x01" + b"\x00" * 4 + body) == want
    v4 = bytes([3, 2, 0, 4]) + (31).to_bytes(4, "big")
    assert tb.parse_dps(tb.RECEIVE_DP_V4, b"\x00\x01\x00" + v4) == {3: 31}
    assert tb.parse_dps(tb.RECEIVE_DP, _dp(1, 1, b"\x01") + _dp(2, 3, b"hi")) == {1: True, 2: "hi"}
    with pytest.raises(tb.TuyaBLEError):
        tb.parse_dps(tb.RECEIVE_DP, bytes([3, 2, 9, 0]))


def test_mapping_and_rows():
    dps = {3: 31, 5: 215, 15: 88, 101: True}
    m = tb.guess_mapping(dps)
    assert m.vars == {"soil_moisture": (3, 1.0), "soil_temp": (5, 10.0), "battery_pct": (15, 1.0)}
    rows = tb.to_rows(dps, m, zone="treatment", sensor_id="SOIL-T1", ts="2026-10-24T10:00:00")
    assert {r["variable"]: r["value"] for r in rows} == {"soil_moisture": 31, "soil_temp": 21.5, "battery_pct": 88}
    assert all(r["quality"] == "ok" for r in rows)
    assert tb.guess_mapping({1: 230, 2: 45, 4: 100}).vars["soil_temp"] == (1, 10.0)
    assert tb.guess_mapping({9: 1}) is None
    cfg = tb.Mapping.from_config({"soil_moisture": 7, "soil_temp": 8, "soil_temp_scale": 1})
    assert cfg.vars == {"soil_moisture": (7, 1.0), "soil_temp": (8, 1.0)}
    bad = tb.to_rows({3: 150, 5: 215}, m, zone="z", sensor_id="s", ts="t")
    assert [r["quality"] for r in bad] == ["out_of_range", "ok"]


def test_decode_advertisement():
    from Crypto.Cipher import AES
    product_id = b"abcd1234"
    key = hashlib.md5(product_id).digest()
    enc = AES.new(key, AES.MODE_CBC, key).encrypt(UUID.encode())
    md = {tb.MANUFACTURER_ID: bytes([0x80, 3, 0, 0, 0, 0]) + enc}
    sd = {tb.SERVICE_UUID: b"\x00" + product_id}
    assert tb.decode_advertisement(sd, md) == UUID
    assert tb.advertised_protocol(md) == 3
    assert tb.decode_advertisement({}, md) is None
    assert tb.decode_advertisement(sd, {}) is None


class FakeSensor:
    """bleak 클라이언트 흉내 — 투야 센서처럼 로그인을 받고 DP 를 보낸다."""

    def __init__(self, dps_body: bytes, code: int = tb.RECEIVE_DP, pair_result: int = 0):
        self.keys = tb.Keys.from_local_key(LOCAL_KEY)
        self.inbox = tb.Reassembler(self.keys)
        self.notify = None
        self.seq = 100
        self.dps_body, self.dp_code, self.pair_result = dps_body, code, pair_result
        self.received: list[tb.Message] = []

    async def start_notify(self, _char, cb):
        self.notify = cb

    def _reply(self, code, data, response_to=0):
        self.seq += 1
        for c in tb.build_packets(self.keys, self.seq, code, data, response_to):
            self.notify(None, bytearray(c))

    async def write_gatt_char(self, char, chunk, _response):
        assert char == tb.CHAR_WRITE
        msg = self.inbox.feed(bytes(chunk))
        if msg is None:
            return
        self.received.append(msg)
        if msg.code == tb.DEVICE_INFO:
            info = _device_info()
            self._reply(tb.DEVICE_INFO, info, msg.seq)         # 로그인 열쇠로 답한다
            tb.apply_device_info(self.keys, info)
        elif msg.code == tb.PAIR:
            assert msg.data == tb.pairing_request(UUID, LOCAL_KEY, DEV_ID)
            self._reply(tb.PAIR, bytes([self.pair_result]), msg.seq)
        elif msg.code == tb.DEVICE_STATUS:
            self._reply(tb.DEVICE_STATUS, b"\x00", msg.seq)
            self._reply(self.dp_code, self.dps_body)


def _session(fake, verbose=False):
    bridge = _bridge()
    cfg = {"uuid": UUID, "local_key": LOCAL_KEY, "sensor_id": "SOIL-T1"}

    async def go():
        s = bridge.Session(fake, DEV_ID, cfg, verbose)
        return await s.run(collect_s=5)

    return asyncio.run(go())


def test_session_with_fake_sensor():
    body = _dp(3, 2, (42).to_bytes(4, "big")) + _dp(5, 2, (187).to_bytes(4, "big")) + _dp(15, 2, (90).to_bytes(4, "big"))
    fake = FakeSensor(b"\x00\x09\x00" + body, code=tb.RECEIVE_SIGN_DP)
    dps = _session(fake)
    assert dps == {3: 42, 5: 187, 15: 90}
    codes = [m.code for m in fake.received]
    assert codes[:3] == [tb.DEVICE_INFO, tb.PAIR, tb.DEVICE_STATUS]
    ack = [m for m in fake.received if m.code == tb.RECEIVE_SIGN_DP]
    assert ack and ack[0].data == pack(">HBB", 9, 0, 0)


def test_session_pair_refused():
    with pytest.raises(tb.TuyaBLEError):
        _session(FakeSensor(b"", pair_result=1))


def test_bridge_config_and_rows(tmp_path):
    bridge = _bridge()
    dev = tmp_path / "devices.yaml"
    dev.write_text(
        "devices: {}\n"
        "tuya_ble:\n"
        f"  {DEV_ID}:\n    uuid: {UUID}\n    local_key: \"{LOCAL_KEY}\"\n    zone: treatment\n    sensor_id: SOIL-T1\n"
        "  broken:\n    uuid: x\n",
        encoding="utf-8")
    cfg = bridge.load_config(dev)
    assert list(cfg) == [DEV_ID]
    rows = tb.to_rows({3: 31, 5: 200}, tb.guess_mapping({3: 31, 5: 200}), zone="treatment", sensor_id="SOIL-T1", ts="t")
    bridge.write_rows(tmp_path, rows)
    files = list(tmp_path.glob("tuyable_*.csv"))
    lines = files[0].read_text(encoding="utf-8").splitlines()
    assert lines[0] == "ts,zone,sensor_id,variable,value,unit,quality"
    assert lines[1] == "t,treatment,SOIL-T1,soil_moisture,31.0,%,ok"


class _Dev:
    def __init__(self, address):
        self.address = address


def _cycle(tmp_path, monkeypatch, by_uuid, by_mac, nearby, dps=None):
    bridge = _bridge()
    dev = tmp_path / "devices.yaml"
    dev.write_text(
        "tuya_ble:\n"
        f"  {DEV_ID}:\n    uuid: {UUID}\n    local_key: \"{LOCAL_KEY}\"\n    mac: \"dc:23:53:94:45:98\"\n"
        "    zone: treatment\n    sensor_id: SOIL-T1\n", encoding="utf-8")

    async def fake_scan(seconds, verbose):
        return by_uuid, by_mac, nearby

    async def fake_read(device, dev_id, cfg, verbose, proto=None):
        assert device.address == "DC:23:53:94:45:98"
        return dps

    monkeypatch.setattr(bridge, "scan", fake_scan)
    monkeypatch.setattr(bridge, "read_one", fake_read)
    args = type("A", (), {"devices": str(dev), "out": str(tmp_path), "capture": str(tmp_path / "cap"),
                          "scan_seconds": 1, "timeout": 5, "verbose": False})()
    heard: dict = {}
    n = asyncio.run(bridge.cycle(args, heard))
    return n, heard["SOIL-T1"]


def test_cycle_finds_sensor_by_mac_when_uuid_unknown(tmp_path, monkeypatch):
    item = (_Dev("DC:23:53:94:45:98"), -61, 3)
    n, h = _cycle(tmp_path, monkeypatch, {}, {"DC:23:53:94:45:98": item}, 4, {3: 33, 5: 201, 15: 80})
    assert n == 3 and h["error"] is None and h["address"] == "DC:23:53:94:45:98" and h["rssi"] == -61


def test_cycle_not_heard_says_what_to_do(tmp_path, monkeypatch):
    _, h = _cycle(tmp_path, monkeypatch, {}, {}, 7)
    assert "게이트웨이" in h["error"] and "앱" in h["error"]
    _, h = _cycle(tmp_path, monkeypatch, {}, {}, 0)
    assert "블루투스가 꺼져" in h["error"]
