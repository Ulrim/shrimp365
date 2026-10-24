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
#: 센서 응답을 기다리는 시간(초). 참고 구현(ha_tuya_ble)은 60초 — 잠든 센서는 연결 간격이 길다.
RESPONSE_WAIT_S = 40
#: 연결을 몇 번까지 다시 시도할지. 라즈베리파이 블루투스는 첫 연결이 자주 실패한다.
CONNECT_TRIES = 3
#: 단계 이름 — 실패하면 어디서 멈췄는지 화면에 알린다.
STAGES = {"connect": "연결", "notify": "알림 켜기", "info": "기기정보 응답", "pair": "로그인 응답",
          "status": "상태 요청", "dps": "값 받기"}
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
        self.stage = "notify"

    def log(self, msg: str) -> None:
        if self.verbose:
            print(f"  [{self.cfg.get('sensor_id')}] {msg}")

    async def send(self, code: int, data: bytes = b"", response_to: int = 0, wait: bool = True,
                   timeout: float | None = None, with_response: bool = False) -> tb.Message | None:
        seq = self.seq
        self.seq += 1
        fut = self.loop.create_future() if wait else None
        if fut:
            self.waiting[seq] = fut
        for chunk in tb.build_packets(self.keys, seq, code, data, response_to, self.proto):
            await self.client.write_gatt_char(tb.CHAR_WRITE, chunk, with_response)
        if not fut:
            return None
        try:
            return await asyncio.wait_for(fut, timeout or RESPONSE_WAIT_S)
        finally:
            self.waiting.pop(seq, None)

    def on_notify(self, _sender, data: bytearray) -> None:
        self.log(f"알림 원본 {bytes(data).hex()}")
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

    async def device_info(self) -> tb.Message:
        """기기정보 요청. 대답이 없으면 규격판(패킷 머리)과 쓰기 방식을 바꿔 가며 다시 묻는다 —
        광고에서 규격판을 못 읽은 센서는 몇 번인지 모른다(참고 구현의 기본값은 2)."""
        tries = [(self.proto, False)] + [(v, False) for v in (2, 3, 4) if v != self.proto] + [(self.proto, True)]
        per = max(RESPONSE_WAIT_S / len(tries), min(8.0, RESPONSE_WAIT_S))
        last: BaseException | None = None
        for proto, with_resp in tries:
            self.proto = proto
            self.log(f"기기정보 요청(규격판 {proto}{', 쓰기 확인' if with_resp else ''})")
            try:
                return await self.send(tb.DEVICE_INFO, timeout=per, with_response=with_resp)
            except (asyncio.TimeoutError, TimeoutError) as exc:
                last = exc
        raise last or TimeoutError()

    async def run(self, collect_s: float = 15.0) -> dict[int, object]:
        self.stage = "notify"
        await self.client.start_notify(tb.CHAR_NOTIFY, self.on_notify)
        self.stage = "info"
        info = await self.device_info()
        meta = tb.apply_device_info(self.keys, info.data)
        self.proto = meta["protocol_version"] or self.proto
        self.log(f"기기정보 {meta}")
        self.stage = "pair"
        self.log("로그인 요청")
        pair = await self.send(tb.PAIR, tb.pairing_request(str(self.cfg["uuid"]), str(self.cfg["local_key"]), self.dev_id))
        if pair.data[:1] not in (b"\x00", b"\x02"):
            raise tb.TuyaBLEError(f"로그인 거부({pair.data.hex()}) — 열쇠가 바뀌었을 수 있습니다(앱에서 다시 붙였나?)")
        self.stage = "status"
        self.log("로그인 성공 — 상태 요청")
        await self.send(tb.DEVICE_STATUS)
        self.stage = "dps"
        start = time.monotonic()
        # DP 는 상태 요청 뒤 곧 몰려온다. 마지막 DP 뒤 3초 조용하면 끝, 길어도 collect_s.
        while time.monotonic() - start < collect_s:
            await asyncio.sleep(0.5)
            if self.dps and time.monotonic() - self.last_dp > 3:
                break
        return self.dps


async def scan(seconds: float, verbose: bool) -> tuple[dict, dict, int]:
    """광고를 듣는다. (uuid → (기기, 신호세기, 규격판), MAC → 같은 것, 들린 블루투스 기기 수).

    투야 광고에서 uuid 를 못 풀어도(펌웨어마다 다르다) MAC 으로 찾을 수 있게 둘 다 모은다.
    찾은 기기 객체를 그대로 연결에 쓴다 — 주소 글자로 연결하면 bleak 이 처음부터 다시 찾는다."""
    from bleak import BleakScanner
    by_uuid: dict[str, tuple] = {}
    by_mac: dict[str, tuple] = {}

    def cb(device, adv) -> None:
        proto = None
        try:
            proto = tb.advertised_protocol(adv.manufacturer_data)
            uuid = tb.decode_advertisement(adv.service_data, adv.manufacturer_data)
        except Exception:  # noqa: BLE001 — 남의 광고는 무엇이 와도 넘긴다
            uuid = None
        item = (device, adv.rssi, proto)
        by_mac[str(device.address).upper()] = item
        if uuid:
            by_uuid[uuid] = item

    async with BleakScanner(cb):
        await asyncio.sleep(seconds)
    if verbose:
        tuya = {u: (d.address, r) for u, (d, r, _p) in by_uuid.items()}
        print(f"[스캔] {seconds:.0f}초 동안 블루투스 기기 {len(by_mac)}대, 그중 투야 {len(tuya)}대: {tuya}")
    return by_uuid, by_mac, len(by_mac)


class StageError(Exception):
    """어느 단계에서 실패했는지 담는다."""

    def __init__(self, stage: str, cause: BaseException) -> None:
        super().__init__(f"{STAGES.get(stage, stage)} 단계: {cause!r}")
        self.stage, self.cause = stage, cause


async def find_again(address: str, seconds: float = 20.0):
    """연결이 한 번 실패하면 BlueZ 가 기기를 목록에서 지운다 — 다시 붙기 전에 광고를 다시 듣는다."""
    from bleak import BleakScanner
    try:
        return await BleakScanner.find_device_by_address(address, timeout=seconds)
    except Exception:  # noqa: BLE001
        return None


async def read_one(device, dev_id: str, cfg: dict, verbose: bool, proto: int | None = None) -> dict[int, object]:
    from bleak import BleakClient
    last: BaseException | None = None
    address = str(getattr(device, "address", device))
    for attempt in range(1, CONNECT_TRIES + 1):
        stage = "connect"
        try:
            if attempt > 1:
                if verbose:
                    print(f"  [{cfg.get('sensor_id')}] 센서를 다시 찾는 중…")
                again = await find_again(address)
                if again is None:
                    raise TimeoutError("다시 찾기에서 광고가 안 들림")
                device = again
            if verbose:
                print(f"  [{cfg.get('sensor_id')}] 연결 시도 {attempt}/{CONNECT_TRIES}")
            async with BleakClient(device, timeout=30) as client:
                session = Session(client, dev_id, cfg, verbose, proto)
                try:
                    return await session.run()
                except BaseException:
                    stage = session.stage
                    raise
        except tb.TuyaBLEError as exc:
            raise StageError(stage, exc) from exc        # 열쇠·형식 문제 — 다시 해도 같다
        except (asyncio.CancelledError, KeyboardInterrupt):
            raise
        except Exception as exc:  # noqa: BLE001 — 블루투스 오류는 종류가 많다
            last = StageError(stage, exc)
            if verbose:
                print(f"  [{cfg.get('sensor_id')}] {last}")
            if stage != "connect":
                break                                       # 붙은 뒤 응답이 없으면 다시 붙어도 같다
            await asyncio.sleep(2 * attempt)
    raise last or StageError("connect", TimeoutError())


def friendly_error(exc: Exception) -> str:
    """화면에 띄울 한 줄 — 어느 단계에서 멈췄고 무엇을 하면 되는지."""
    if isinstance(exc, StageError):
        cause = exc.cause
        if isinstance(cause, tb.TuyaBLEError):
            return str(cause)[:160]
        if exc.stage == "connect":
            return ("센서에 연결하지 못했습니다(3번 시도) — 휴대폰 투야 앱·게이트웨이가 센서를 잡고 있지 않은지, "
                    "센서가 가까운지 확인하세요")
        if exc.stage in ("info", "notify"):
            # 투야 센서는 열쇠가 틀린 요청을 대답 없이 버린다 — 앱에서 다시 붙인 뒤가 가장 흔하다.
            return ("연결은 됐지만 센서가 대답하지 않습니다 — 열쇠가 틀렸을 수 있습니다: 화면 [투야에서 센서 가져오기] 로 "
                    "열쇠를 새로 받으세요(앱에서 다시 붙였다면 반드시)")
        if exc.stage == "pair":
            return "로그인 응답이 없습니다 — 앱에서 다시 붙였다면 [투야에서 센서 가져오기] 를 눌러 열쇠를 새로 받으세요"
        return f"{STAGES.get(exc.stage, exc.stage)} 단계에서 멈췄습니다: {cause.__class__.__name__}"
    text = str(exc) or exc.__class__.__name__
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)) or "timeout" in text.lower() or "timed out" in text.lower():
        return "센서에 붙다가 시간이 끝났습니다 — 휴대폰 투야 앱·게이트웨이가 센서를 잡고 있지 않은지 확인하세요"
    if "not found" in text.lower():
        return NOT_HEARD
    if isinstance(exc, tb.TuyaBLEError):
        return text[:160]
    return f"연결 실패: {text[:140]}"


NOT_HEARD = ("센서 신호가 안 들립니다 — ① 휴대폰 투야 앱 완전히 종료 ② 투야 게이트웨이 전원 끄기 "
             "③ 센서 버튼을 한 번 눌러 깨우기 ④ 파이와 가까이(1~2m)")


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
    seen, by_mac, nearby = await scan(args.scan_seconds, args.verbose)
    total = 0
    for dev_id, cfg in devices.items():
        sid = str(cfg["sensor_id"])
        mac = str(cfg.get("mac") or "").upper()
        adv = seen.get(str(cfg["uuid"])) or by_mac.get(mac) or (None, None, None)   # uuid 로, 못 풀면 MAC 으로
        address = adv[0]
        now = dt.datetime.now().isoformat(timespec="seconds")
        item = heard.setdefault(sid, {"sensor_id": sid, "device_id": dev_id})
        if not address:
            err = NOT_HEARD if nearby else "블루투스 기기가 하나도 안 들립니다 — 파이 블루투스가 꺼져 있습니다(재부팅 또는 rfkill unblock bluetooth)"
            item.update(error=err, tried=now)
            print(f"[{sid}] {err} (MAC {mac or '모름'}, 들린 기기 {nearby}대)", file=sys.stderr)
            continue
        try:
            dps = await asyncio.wait_for(read_one(address, dev_id, cfg, args.verbose, adv[2]), args.timeout)
        except Exception as exc:  # noqa: BLE001 — 한 센서가 실패해도 다음 센서는 읽는다
            item.update(error=friendly_error(exc), tried=now, address=str(address.address))
            print(f"[{sid}] 읽기 실패: {exc!r}", file=sys.stderr)
            continue
        mapping = tb.Mapping.from_config(cfg.get("dps")) or tb.guess_mapping(dps)
        rows = tb.to_rows(dps, mapping, zone=str(cfg.get("zone", "")), sensor_id=sid, ts=now) if mapping else []
        write_rows(Path(args.out), rows)
        total += len(rows)
        item.update(address=str(address.address), last=now, dps={str(k): v for k, v in dps.items()}, error=None,
                    mapping={k: list(v) for k, v in mapping.vars.items()} if mapping else None,
                    rssi=adv[1])
        if not dps:
            item.update(error="로그인은 됐지만 센서가 값을 보내지 않았습니다 — 다음 읽기를 기다려 보세요")
            print(f"[{sid}] 로그인 성공, 값 없음", file=sys.stderr)
        elif not mapping:
            item.update(error=f"값은 받았지만 칸 배치를 모릅니다 — 받은 값 {dps}")
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


async def diagnose(mac: str, seconds: float = 30.0) -> int:
    """센서가 무엇을 내보내는지 그대로 보인다 — 광고, 블루투스 서비스, 알림 원본.
    투야 표준 규격이 아닌 센서를 맞출 때 쓴다(현장에서 화면을 찍어 보내면 된다)."""
    from bleak import BleakClient, BleakScanner
    mac = mac.upper()
    seen: dict = {}

    def cb(device, adv) -> None:
        if str(device.address).upper() != mac:
            return
        if not seen:
            print(f"[광고] 이름={adv.local_name!r} 신호={adv.rssi}")
        seen["dev"] = device
        key = (tuple(adv.service_uuids or []), tuple((k, bytes(v).hex()) for k, v in (adv.service_data or {}).items()),
               tuple((k, bytes(v).hex()) for k, v in (adv.manufacturer_data or {}).items()))
        if key not in seen.setdefault("ads", set()):
            seen["ads"].add(key)
            print(f"[광고] 서비스={list(key[0])}")
            for k, v in key[1]:
                print(f"       서비스데이터 {k}: {v}")
            for k, v in key[2]:
                print(f"       제조사데이터 0x{k:04X}: {v}")

    print(f"[진단] {mac} 광고를 {seconds:.0f}초 듣습니다…")
    async with BleakScanner(cb):
        await asyncio.sleep(seconds)
    if "dev" not in seen:
        print("[진단] 이 주소의 광고가 안 들립니다 — 앱 종료·게이트웨이 끄기·버튼 눌러 깨우기 후 다시")
        return 1
    print("[진단] 연결합니다…")
    async with BleakClient(seen["dev"], timeout=25) as client:
        notif = []
        for svc in client.services:
            print(f"[서비스] {svc.uuid}")
            for ch in svc.characteristics:
                print(f"    [특성] {ch.uuid} {','.join(ch.properties)}")
                if {"notify", "indicate"} & set(ch.properties):
                    notif.append(ch)
        for ch in notif:
            try:
                await client.start_notify(ch, lambda c, d, u=ch.uuid: print(f"[알림] {u}: {bytes(d).hex()}"))
            except Exception as exc:  # noqa: BLE001
                print(f"[알림] {ch.uuid} 켜기 실패: {exc}")
        print("[진단] 20초 동안 들어오는 알림을 봅니다(센서 버튼을 한 번 눌러 보세요)…")
        await asyncio.sleep(20)
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--devices", default="configs/devices.yaml")
    p.add_argument("--out", default="data/field")
    p.add_argument("--capture", default="data/field/capture")
    p.add_argument("--interval", type=float, default=300, help="읽는 간격(초). 배터리를 아끼려고 5분")
    p.add_argument("--scan-seconds", type=float, default=30, help="광고를 듣는 시간(초). 잠든 센서는 몇 초에 한 번 광고한다")
    p.add_argument("--timeout", type=float, default=240, help="센서 하나를 읽는 최대 시간(초, 다시 찾기·연결 재시도 포함)")
    p.add_argument("--once", action="store_true", help="한 번만 읽고 끝낸다(현장 점검)")
    p.add_argument("-v", "--verbose", action="store_true")
    p.add_argument("--diagnose", metavar="MAC", help="그 센서의 광고·서비스·알림 원본을 보인다(현장 진단)")
    args = p.parse_args(argv)
    if args.diagnose:
        return asyncio.run(diagnose(args.diagnose))

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
