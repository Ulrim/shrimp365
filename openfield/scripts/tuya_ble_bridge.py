#!/usr/bin/env python3
"""투야 블루투스(BLE) 센서 수집기 — 몇 분마다 센서에 붙어 값을 읽고 수집 파일에 적는다.

    python scripts/tuya_ble_bridge.py --devices devices.yaml --out data --capture data/capture
    python scripts/tuya_ble_bridge.py --devices devices.yaml --once -v      # 한 번만, 자세히(현장 점검)

설정(devices.yaml 의 tuya_ble: 칸)은 tuya_ble_setup.py 가 투야 클라우드에서 열쇠를 받아 적는다:

    tuya_ble:
      bf0123456789abcdef:                  # 투야 기기 id
        uuid: tuyaxxxxxxxxxxxx
        local_key: "…"
        mac: "DC:23:…"                     # 없어도 된다 — 광고(uuid)로 찾는다
        zone: treatment
        sensor_id: SOIL-T1
        dps: {soil_moisture: 3, soil_temp: 5, soil_temp_scale: 10, battery_pct: 15}   # 없으면 짐작

다른 수집기(지그비·433MHz)와 같은 형식으로 tuyable_YYYYMMDD.csv 에 쓴다 — 장비 화면·서버가 그대로 읽는다.
받은 DP 전부와 마지막 수신은 capture/tuyable_heard.json 에 남긴다(배치가 맞는지 확인용).
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import sys
import time
from pathlib import Path
from struct import pack

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ofdf.data import tuya_ble as tb  # noqa: E402

COLUMNS = ["ts", "zone", "sensor_id", "variable", "value", "unit", "quality"]
FILE_PATTERN = "tuyable_%Y%m%d.csv"
HEARD_FILE = "tuyable_heard.json"


def load_config(path: Path) -> dict[str, dict]:
    import yaml
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as exc:
        print(f"[설정] 읽지 못했다: {exc}", file=sys.stderr)
        return {}
    out = {}
    for dev_id, cfg in (raw.get("tuya_ble") or {}).items():
        if isinstance(cfg, dict) and cfg.get("local_key") and cfg.get("uuid") and cfg.get("sensor_id"):
            out[str(dev_id)] = cfg
    return out


class Session:
    """한 센서와의 연결 하나 — 로그인하고 DP 를 받는다."""

    def __init__(self, client, dev_id: str, cfg: dict, verbose: bool = False, proto: int | None = None) -> None:
        self.client = client
        self.dev_id = dev_id
        self.cfg = cfg
        self.keys = tb.Keys.from_local_key(str(cfg["local_key"]))
        self.reasm = tb.Reassembler(self.keys)
        self.seq = 1
        self.proto = proto or 3                    # 광고에 실린 규격판 — 기기정보 응답으로 다시 맞춘다
        self.waiting: dict[int, asyncio.Future] = {}
        self.dps: dict[int, object] = {}
        self.last_dp = 0.0
        self.verbose = verbose
        self.loop = asyncio.get_running_loop()

    def log(self, msg: str) -> None:
        if self.verbose:
            print(f"  [{self.cfg.get('sensor_id')}] {msg}")

    async def send(self, code: int, data: bytes = b"", response_to: int = 0, wait: bool = True) -> tb.Message | None:
        seq = self.seq
        self.seq += 1
        fut = self.loop.create_future() if wait else None
        if fut:
            self.waiting[seq] = fut
        for chunk in tb.build_packets(self.keys, seq, code, data, response_to, self.proto):
            await self.client.write_gatt_char(tb.CHAR_WRITE, chunk, False)
        if not fut:
            return None
        try:
            return await asyncio.wait_for(fut, 15)
        finally:
            self.waiting.pop(seq, None)

    def on_notify(self, _sender, data: bytearray) -> None:
        try:
            msg = self.reasm.feed(bytes(data))
        except tb.TuyaBLEError as exc:
            self.log(f"받은 조각 무시: {exc}")
            return
        if msg is None:
            return
        self.log(f"받음 #{msg.seq} 명령 {msg.code:#06x} 응답대상 #{msg.response_to}")
        if msg.response_to and msg.response_to in self.waiting:
            fut = self.waiting[msg.response_to]
            if not fut.done():
                fut.set_result(msg)
            return
        if msg.code in tb.DP_RECEIVE_CODES:
            try:
                dps = tb.parse_dps(msg.code, msg.data)
            except tb.TuyaBLEError as exc:
                self.log(f"DP 해석 실패({exc}) — 원본 {msg.data.hex()}")
                dps = {}
            self.dps.update(dps)
            self.last_dp = time.monotonic()
            self.log(f"DP {dps}")
            ack = b""
            if msg.code in (tb.RECEIVE_SIGN_DP, tb.RECEIVE_SIGN_TIME_DP) and len(msg.data) >= 3:
                ack = pack(">HBB", int.from_bytes(msg.data[:2], "big"), msg.data[2], 0)
            asyncio.ensure_future(self.send(msg.code, ack, msg.seq, wait=False))
        elif msg.code in (tb.TIME1_REQ, tb.TIME2_REQ):
            asyncio.ensure_future(self.send(msg.code, tb.time_response(msg.code), msg.seq, wait=False))

    async def run(self, collect_s: float = 12.0) -> dict[int, object]:
        await self.client.start_notify(tb.CHAR_NOTIFY, self.on_notify)
        info = await self.send(tb.DEVICE_INFO)
        meta = tb.apply_device_info(self.keys, info.data)
        self.proto = meta["protocol_version"] or self.proto
        self.log(f"기기정보 {meta}")
        pair = await self.send(tb.PAIR, tb.pairing_request(str(self.cfg["uuid"]), str(self.cfg["local_key"]), self.dev_id))
        if pair.data[:1] not in (b"\x00", b"\x02"):
            raise tb.TuyaBLEError(f"로그인 거부({pair.data.hex()}) — 열쇠가 바뀌었을 수 있습니다(앱에서 다시 붙였나?)")
        await self.send(tb.DEVICE_STATUS)
        start = time.monotonic()
        # DP 는 상태 요청 뒤 곧 몰려온다. 마지막 DP 뒤 3초 조용하면 끝, 길어도 collect_s.
        while time.monotonic() - start < collect_s:
            await asyncio.sleep(0.5)
            if self.dps and time.monotonic() - self.last_dp > 3:
                break
        return self.dps


async def scan(seconds: float, verbose: bool) -> dict[str, tuple[str, int | None, int | None]]:
    """광고를 듣고 uuid → (주소, 신호세기, 규격판)."""
    from bleak import BleakScanner
    found: dict[str, tuple[str, int | None, int | None]] = {}

    def cb(device, adv) -> None:
        try:
            uuid = tb.decode_advertisement(adv.service_data, adv.manufacturer_data)
        except Exception:  # noqa: BLE001 — 남의 광고는 무엇이 와도 넘긴다
            return
        if uuid:
            found[uuid] = (device.address, adv.rssi, tb.advertised_protocol(adv.manufacturer_data))

    async with BleakScanner(cb):
        await asyncio.sleep(seconds)
    if verbose:
        print(f"[스캔] 투야 블루투스 기기 {len(found)}대: {found}")
    return found


async def read_one(address: str, dev_id: str, cfg: dict, verbose: bool, proto: int | None = None) -> dict[int, object]:
    from bleak import BleakClient
    async with BleakClient(address, timeout=20) as client:
        return await Session(client, dev_id, cfg, verbose, proto).run()


def write_rows(out_dir: Path, rows: list[dict]) -> None:
    if not rows:
        return
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / dt.datetime.now().strftime(FILE_PATTERN)
    new = not path.exists()
    with path.open("a", encoding="utf-8") as fh:
        if new:
            fh.write(",".join(COLUMNS) + "\n")
        for r in rows:
            fh.write(",".join(str(r[c]) for c in COLUMNS) + "\n")


async def cycle(args, heard: dict) -> int:
    devices = load_config(Path(args.devices))
    if not devices:
        if args.verbose:
            print("[설정] tuya_ble: 칸에 등록된 센서가 없습니다")
        return 0
    seen = await scan(args.scan_seconds, args.verbose)
    total = 0
    for dev_id, cfg in devices.items():
        sid = str(cfg["sensor_id"])
        adv = seen.get(str(cfg["uuid"])) or (None, None, None)
        address = adv[0] or cfg.get("mac")        # 광고로 찾은 주소 먼저, 없으면 클라우드가 알려 준 MAC
        now = dt.datetime.now().isoformat(timespec="seconds")
        item = heard.setdefault(sid, {"sensor_id": sid, "device_id": dev_id})
        if not address:
            item.update(error="광고가 안 들립니다(거리·배터리 확인)", tried=now)
            print(f"[{sid}] 광고가 안 들립니다 — 거리·배터리를 확인하세요", file=sys.stderr)
            continue
        try:
            dps = await asyncio.wait_for(read_one(address, dev_id, cfg, args.verbose, adv[2]), args.timeout)
        except Exception as exc:  # noqa: BLE001 — 한 센서가 실패해도 다음 센서는 읽는다
            item.update(error=str(exc)[:160] or exc.__class__.__name__, tried=now, address=address)
            print(f"[{sid}] 읽기 실패: {exc!r}", file=sys.stderr)
            continue
        mapping = tb.Mapping.from_config(cfg.get("dps")) or tb.guess_mapping(dps)
        rows = tb.to_rows(dps, mapping, zone=str(cfg.get("zone", "")), sensor_id=sid, ts=now) if mapping else []
        write_rows(Path(args.out), rows)
        total += len(rows)
        item.update(address=address, last=now, dps={str(k): v for k, v in dps.items()}, error=None,
                    mapping={k: list(v) for k, v in mapping.vars.items()} if mapping else None,
                    rssi=adv[1])
        if not mapping:
            print(f"[{sid}] DP 배치를 모릅니다 — 받은 값 {dps}. devices.yaml 의 dps: 를 적으세요", file=sys.stderr)
        elif args.verbose:
            print(f"[{sid}] {rows}")
    if args.capture:
        cap = Path(args.capture)
        cap.mkdir(parents=True, exist_ok=True)
        tmp = cap / (HEARD_FILE + ".tmp")
        tmp.write_text(json.dumps({"ts": dt.datetime.now().isoformat(timespec="seconds"),
                                   "sensors": list(heard.values())}, ensure_ascii=False), encoding="utf-8")
        tmp.replace(cap / HEARD_FILE)
    return total


def _mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--devices", default="configs/devices.yaml")
    p.add_argument("--out", default="data/field")
    p.add_argument("--capture", default="data/field/capture")
    p.add_argument("--interval", type=float, default=300, help="읽는 간격(초). 배터리를 아끼려고 5분")
    p.add_argument("--scan-seconds", type=float, default=15)
    p.add_argument("--timeout", type=float, default=60, help="센서 하나를 읽는 최대 시간(초)")
    p.add_argument("--once", action="store_true", help="한 번만 읽고 끝낸다(현장 점검)")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    heard: dict = {}

    async def loop() -> None:
        while True:
            started = time.monotonic()
            try:
                n = await cycle(args, heard)
                print(f"[수집] {n}행")
            except Exception as exc:  # noqa: BLE001 — 블루투스 오류로 서비스가 죽지 않게
                print(f"[오류] {exc!r}", file=sys.stderr)
            if args.once:
                return
            # 다음 읽기까지 기다리되, 화면에서 센서를 등록·빼면(devices.yaml 이 바뀌면) 바로 다시 읽는다.
            mtime = _mtime(Path(args.devices))
            wait_until = time.monotonic() + max(10.0, args.interval - (time.monotonic() - started))
            while time.monotonic() < wait_until:
                await asyncio.sleep(3)
                if _mtime(Path(args.devices)) != mtime:
                    print("[설정] 센서 목록이 바뀌어 바로 읽습니다")
                    break

    asyncio.run(loop())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
