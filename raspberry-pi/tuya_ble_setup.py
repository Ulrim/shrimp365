#!/usr/bin/env python3
"""투야 블루투스 센서 등록 — 투야 클라우드에서 센서 열쇠를 받아 devices.yaml 의 tuya_ble: 칸에 적는다.

    sudo /opt/shrimp365/ble-venv/bin/python /opt/shrimp365/tuya_ble_setup.py          # 등록(대화형)
    sudo /opt/shrimp365/ble-venv/bin/python /opt/shrimp365/tuya_ble_setup.py --list   # 등록된 것 보기
    sudo /opt/shrimp365/ble-venv/bin/python /opt/shrimp365/tuya_ble_setup.py --remove SOIL-T1

필요한 것(한 번만): 투야 IoT 개발자 계정의 Access ID · Access Secret, 그리고 그 프로젝트에
센서를 붙인 투야(또는 Smart Life) 앱 계정을 연결해 둔 것. INSTALL.md '투야 블루투스 토양센서' 참고.

열쇠를 받은 뒤로는 인터넷 없이 파이가 직접 읽는다. Access ID·Secret 은 저장하지 않는다.
투야 앱에서 센서를 지우고 다시 붙이면 열쇠가 바뀐다 — 그때는 이 도구를 다시 실행한다.
수집기(farm365-tuyable)는 설정 파일을 매번 다시 읽으므로 다시 시작할 필요가 없다.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import shutil
import sys
from pathlib import Path

DEVICES = Path("/var/lib/shrimp365/field/devices.yaml")
REGIONS = ("us", "eu", "cn", "in", "sg", "us-e", "eu-w")   # 한국 앱 계정은 us(미국 서부)
ZONES = {"1": ("treatment", "T"), "2": ("control", "C"), "3": ("facility", "")}
#: 토양센서로 보이는 투야 분류(category) — 목록에서 앞에 띄운다.
SOIL_CATEGORIES = {"zwjcy", "wsdcg", "ldcg"}
_SAFE = re.compile(r"^[A-Za-z0-9_.:-]+$")


# ── devices.yaml 의 tuya_ble: 칸 (주석과 다른 칸은 그대로 둔다) ────────────────
def _block(lines: list[str], key: str) -> tuple[int, int] | None:
    start = None
    for i, line in enumerate(lines):
        if re.match(rf"^{re.escape(key)}:\s*(#.*)?$", line) or re.match(rf"^{re.escape(key)}:\s*\{{\s*\}}", line):
            start = i
            continue
        if start is not None and line and not line[0].isspace() and not line.startswith("#"):
            return start, i
    return (start, len(lines)) if start is not None else None


def read_entries(path: Path) -> dict[str, dict]:
    import yaml
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except FileNotFoundError:
        return {}
    return {str(k): dict(v) for k, v in (raw.get("tuya_ble") or {}).items() if isinstance(v, dict)}


def _q(v) -> str:
    return json.dumps(str(v), ensure_ascii=False)       # YAML 은 JSON 문자열을 그대로 읽는다


def render_block(entries: dict[str, dict]) -> list[str]:
    out = ["tuya_ble:   # 투야 블루투스 센서 — tuya_ble_setup.py 가 적는다. local_key 는 남에게 보이지 마세요."]
    for dev_id, cfg in entries.items():
        out.append(f"  {_q(dev_id)}:")
        for k in ("sensor_id", "zone", "name", "uuid", "local_key", "mac", "category", "product_id"):
            if cfg.get(k) not in (None, ""):
                out.append(f"    {k}: {_q(cfg[k])}")
        dps = cfg.get("dps")
        if isinstance(dps, dict) and dps:
            out.append("    dps: {" + ", ".join(f"{k}: {v}" for k, v in dps.items()) + "}")
    return out


def write_entries(path: Path, entries: dict[str, dict]) -> None:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        lines = []
    blk = _block(lines, "tuya_ble")
    if blk:
        lines = lines[:blk[0]] + lines[blk[1]:]
    while lines and not lines[-1].strip():
        lines.pop()
    if entries:
        lines += [""] + render_block(entries)
    text = "\n".join(lines) + "\n"
    tmp = path.with_suffix(".yaml.tmp")
    tmp.write_text(text, encoding="utf-8")
    try:
        st = path.stat()
        os.chown(tmp, st.st_uid, st.st_gid)
    except (FileNotFoundError, PermissionError):
        pass
    os.chmod(tmp, 0o640)                                    # 열쇠가 들어 있다 — 아무나 읽지 못하게
    if path.exists():
        bak = path.with_suffix(".yaml.bak")
        shutil.copy2(path, bak)
        os.chmod(bak, 0o640)
    tmp.replace(path)


def taken_names(path: Path) -> set[str]:
    """이미 쓰는 센서 이름(지그비·433MHz·에코윗·블루투스 모두)."""
    import yaml
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (FileNotFoundError, yaml.YAMLError):
        return set()
    out: set[str] = set()

    def walk(node, key=None):
        if isinstance(node, dict):
            if "sensor_id" in node:
                out.add(str(node["sensor_id"]).upper())
            for k, v in node.items():
                walk(v, k)
        elif isinstance(node, list):
            for v in node:
                walk(v, key)

    walk(raw)
    for name in (raw.get("devices") or {}):
        out.add(str(name).upper())
    return out


def next_name(letter: str, taken: set[str]) -> str:
    base = f"SOIL-{letter}" if letter else "SOIL-"
    n = 1
    while f"{base}{n}".upper() in taken:
        n += 1
    return f"{base}{n}"


# ── 투야 클라우드 ─────────────────────────────────────────────────────────────
def fetch_devices(access_id: str, secret: str, region: str | None, any_device: str | None) -> tuple[list[dict], str]:
    import tinytuya
    regions = [region] if region else list(REGIONS)
    last = ""
    for r in regions:
        try:
            cloud = tinytuya.Cloud(apiRegion=r, apiKey=access_id, apiSecret=secret, apiDeviceID=any_device or None)
        except Exception as exc:  # noqa: BLE001 — 지역이 틀리면 여기서 실패하기도 한다
            last = str(exc)
            continue
        if getattr(cloud, "error", None):
            last = json.dumps(cloud.error, ensure_ascii=False)
            continue
        devs = cloud.getdevices(verbose=False)
        if isinstance(devs, dict):                        # 오류(error_json)
            last = json.dumps(devs, ensure_ascii=False)
            continue
        if devs:
            return devs, r
        last = "기기가 0대입니다(이 지역에 앱 계정이 연결돼 있지 않음)"
    raise SystemExit(f"투야 클라우드에서 기기를 받지 못했습니다: {last}\n"
                     "  · Access ID/Secret 이 맞는지, 프로젝트에 앱 계정을 연결했는지(Devices → Link App Account) 확인하세요.\n"
                     "  · 지역을 직접 주려면 --region us (서아메리카) / eu (중부유럽) 등.")


#: 게이트웨이 분류 — 센서가 아니다(G01Y 블루투스·지그비 게이트웨이는 wg2). 목록에서 뺀다.
GATEWAY_CATEGORIES = {"wg", "wg2", "wfcon", "wgsxj", "alexa_yywg"}


def is_ble(d: dict) -> bool:
    """블루투스 센서로 보이는가 — 클라우드가 알려 주는 uuid 가 있고, 와이파이 IP 가 없고, 게이트웨이가 아니면."""
    cat = str(d.get("category") or "").lower()
    return bool(d.get("uuid")) and not d.get("ip") and cat not in GATEWAY_CATEGORIES and not cat.startswith("wg")


def describe(d: dict) -> str:
    bits = [d.get("name") or "(이름 없음)", d.get("category") or "?", d.get("product_name") or d.get("model") or ""]
    return " · ".join(b for b in bits if b)


# ── 명령 ──────────────────────────────────────────────────────────────────────
def cmd_list(path: Path) -> int:
    entries = read_entries(path)
    if not entries:
        print("등록된 투야 블루투스 센서가 없습니다.")
        return 0
    for dev_id, c in entries.items():
        print(f"  {c.get('sensor_id', '?'):10} {c.get('zone', ''):10} {c.get('name', '')}  (기기 {dev_id}, uuid {c.get('uuid')})")
    return 0


def cmd_remove(path: Path, sid: str) -> int:
    entries = read_entries(path)
    keep = {k: v for k, v in entries.items() if str(v.get("sensor_id", "")).upper() != sid.upper() and k != sid}
    if len(keep) == len(entries):
        print(f"{sid} 를 찾지 못했습니다.", file=sys.stderr)
        return 1
    write_entries(path, keep)
    print(f"{sid} 를 뺐습니다.")
    return 0


def ask(prompt: str, default: str = "") -> str:
    v = input(f"{prompt}{f' [{default}]' if default else ''}: ").strip()
    return v or default


def cmd_register(path: Path, args) -> int:
    access_id = args.access_id or os.environ.get("TUYA_ACCESS_ID") or ask("투야 IoT Access ID")
    secret = args.access_secret or os.environ.get("TUYA_ACCESS_SECRET") or getpass.getpass("투야 IoT Access Secret: ")
    if not access_id or not secret:
        print("Access ID 와 Secret 이 필요합니다.", file=sys.stderr)
        return 2
    print("투야 클라우드에서 기기 목록을 받는 중…")
    devs, region = fetch_devices(access_id, secret, args.region, args.any_device)
    ble = [d for d in devs if is_ble(d)]
    ble.sort(key=lambda d: (d.get("category") not in SOIL_CATEGORIES, d.get("name") or ""))
    print(f"지역 {region}: 기기 {len(devs)}대, 블루투스로 보이는 것 {len(ble)}대")
    if not ble:
        print("블루투스 기기가 없습니다. 투야 앱에 센서가 붙어 있는지, 같은 앱 계정을 프로젝트에 연결했는지 확인하세요.")
        return 1
    entries = read_entries(path)
    known = {k: v for k, v in entries.items()}
    for i, d in enumerate(ble, 1):
        mark = f"  ← 등록됨 {known[d['id']].get('sensor_id')}" if d["id"] in known else ""
        print(f"  {i}. {describe(d)}{mark}")
    pick = ask("등록할 번호(여러 개는 쉼표, 모두는 all)", "all")
    chosen = ble if pick.lower() == "all" else [ble[int(x) - 1] for x in re.split(r"[,\s]+", pick) if x.strip().isdigit()
                                                  and 0 < int(x) <= len(ble)]
    if not chosen:
        print("고른 것이 없습니다.")
        return 1
    taken = taken_names(path)
    for d in chosen:
        dev_id, key, uuid = str(d["id"]), str(d.get("key") or ""), str(d.get("uuid") or "")
        if not key or not _SAFE.match(dev_id) or not _SAFE.match(uuid):
            print(f"  {describe(d)}: 열쇠·uuid 를 받지 못해 건너뜁니다.")
            continue
        old = entries.get(dev_id, {})
        if old.get("sensor_id"):
            taken.discard(str(old["sensor_id"]).upper())
        print(f"\n▶ {describe(d)}")
        z = ask("  구간 — 1 처리구 / 2 대조구 / 3 시설", {"treatment": "1", "control": "2", "facility": "3"}.get(old.get("zone", ""), "1"))
        zone, letter = ZONES.get(z, ZONES["1"])
        sid = ask("  센서 이름", old.get("sensor_id") or next_name(letter, taken)).upper()
        if sid in taken:
            print(f"  {sid} 는 이미 씁니다 — {next_name(letter, taken)} 로 합니다.")
            sid = next_name(letter, taken)
        taken.add(sid)
        entries[dev_id] = {**old, "sensor_id": sid, "zone": zone, "name": d.get("name") or "", "uuid": uuid,
                           "local_key": key, "mac": d.get("mac") or old.get("mac") or "",
                           "category": d.get("category") or "", "product_id": d.get("product_id") or ""}
        print(f"  → {sid} ({zone})")
    write_entries(path, entries)
    print(f"\n{path} 에 적었습니다(이전 파일은 .bak).")
    print("수집기가 5분 안에 읽기 시작합니다. 바로 확인하려면:")
    print("  sudo systemctl stop farm365-tuyable")
    print(f"  sudo -u shrimp365 /opt/shrimp365/ble-venv/bin/python /opt/shrimp365/field/scripts/tuya_ble_bridge.py "
          f"--devices {path} --once -v --out /var/lib/shrimp365/field/data --capture /var/lib/shrimp365/field/data/capture")
    print("  sudo systemctl start farm365-tuyable")
    return 0


# ── 장비 화면에서 부르는 길(JSON) ─────────────────────────────────────────────
# 장비 프로그램(shrimp365_sensor.py)은 bleak·tinytuya 가 없는 시스템 파이썬으로 돈다. 화면의
# [무선 센서] → 블루투스 칸은 이 파일을 ble-venv 파이썬으로 불러 결과를 JSON 한 줄로 받는다.
# Access ID·Secret 은 명령줄(ps 에 보인다)이 아니라 환경변수로 받는다.
def json_fetch() -> dict:
    access_id = os.environ.get("TUYA_ACCESS_ID", "").strip()
    secret = os.environ.get("TUYA_ACCESS_SECRET", "").strip()
    if not access_id or not secret:
        return {"ok": False, "error": "Access ID 와 Secret 이 필요합니다"}
    try:
        devs, region = fetch_devices(access_id, secret, os.environ.get("TUYA_REGION") or None, None)
    except SystemExit as exc:
        return {"ok": False, "error": str(exc).splitlines()[0]}
    except Exception as exc:  # noqa: BLE001 — 네트워크·라이브러리 오류를 화면에 그대로 알린다
        return {"ok": False, "error": f"투야 클라우드 오류: {exc}"}
    out = []
    for d in devs:
        if not is_ble(d) or not d.get("key"):
            continue
        if not _SAFE.match(str(d.get("id", ""))) or not _SAFE.match(str(d.get("uuid", ""))):
            continue
        out.append({k: str(d.get(k) or "") for k in ("id", "name", "key", "uuid", "mac", "category", "product_id")})
    out.sort(key=lambda d: (d["category"] not in SOIL_CATEGORIES, d["name"]))
    return {"ok": True, "region": region, "devices": out}


def json_add(path: Path, req: dict) -> dict:
    d, zone = req.get("device") or {}, req.get("zone")
    letter = {"treatment": "T", "control": "C", "facility": ""}.get(zone)
    if letter is None:
        return {"ok": False, "error": "구간이 올바르지 않습니다"}
    dev_id, key, uuid = str(d.get("id", "")), str(d.get("key", "")), str(d.get("uuid", ""))
    if not key or not _SAFE.match(dev_id) or not _SAFE.match(uuid):
        return {"ok": False, "error": "센서 정보가 올바르지 않습니다(열쇠·uuid)"}
    entries = read_entries(path)
    old = entries.get(dev_id, {})
    taken = taken_names(path) | {str(x).upper() for x in req.get("taken") or []}
    if old.get("sensor_id"):
        taken.discard(str(old["sensor_id"]).upper())
    sid = next_name(letter, taken)
    entries[dev_id] = {**old, "sensor_id": sid, "zone": zone, "name": str(d.get("name") or ""), "uuid": uuid,
                       "local_key": key, "mac": str(d.get("mac") or old.get("mac") or ""),
                       "category": str(d.get("category") or ""), "product_id": str(d.get("product_id") or "")}
    write_entries(path, entries)
    return {"ok": True, "sensor_id": sid, "zone": zone}


def json_refresh(path: Path, req: dict) -> dict:
    """이미 등록된 센서의 열쇠·uuid·MAC 을 새로 받은 값으로 바꾼다(앱에서 다시 붙이면 열쇠가 바뀐다).
    이름·구간·dps 는 그대로 둔다. 바뀐 센서 이름 목록을 돌려준다."""
    entries = read_entries(path)
    changed = []
    for d in req.get("devices") or []:
        dev_id = str(d.get("id", ""))
        old = entries.get(dev_id)
        if not old or not d.get("key") or not _SAFE.match(str(d.get("uuid", ""))):
            continue
        new = {"local_key": str(d["key"]), "uuid": str(d["uuid"])}
        if d.get("mac"):
            new["mac"] = str(d["mac"])
        if any(str(old.get(k, "")) != v for k, v in new.items()):
            old.update(new)
            changed.append(str(old.get("sensor_id") or dev_id))
    if changed:
        write_entries(path, entries)
    return {"ok": True, "updated": changed}


def json_remove(path: Path, sid: str) -> dict:
    entries = read_entries(path)
    keep = {k: v for k, v in entries.items() if str(v.get("sensor_id", "")).upper() != sid.upper()}
    if len(keep) == len(entries):
        return {"ok": False, "error": f"{sid} 를 찾지 못했습니다"}
    write_entries(path, keep)
    return {"ok": True}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--devices", type=Path, default=DEVICES)
    p.add_argument("--region", choices=REGIONS, help="투야 데이터센터. 안 주면 차례로 찾아본다")
    p.add_argument("--access-id")
    p.add_argument("--access-secret")
    p.add_argument("--any-device", help="(선택) 앱에 붙은 아무 기기 id — 기기 목록을 못 받을 때")
    p.add_argument("--list", action="store_true")
    p.add_argument("--remove", metavar="SENSOR_ID")
    p.add_argument("--fetch-json", action="store_true", help="(장비 화면용) 블루투스 기기 목록을 JSON 으로")
    p.add_argument("--add-json", action="store_true", help="(장비 화면용) 표준입력 JSON 의 기기를 등록")
    p.add_argument("--remove-json", metavar="SENSOR_ID", help="(장비 화면용) 빼고 JSON 으로 알린다")
    p.add_argument("--refresh-json", action="store_true", help="(장비 화면용) 등록된 센서의 열쇠를 새 값으로")
    args = p.parse_args(argv)
    if args.fetch_json or args.add_json or args.remove_json or args.refresh_json:
        if args.fetch_json:
            r = json_fetch()
        elif args.refresh_json:
            try:
                r = json_refresh(args.devices, json.loads(sys.stdin.read() or "{}"))
            except (ValueError, OSError) as exc:
                r = {"ok": False, "error": str(exc)}
        elif args.add_json:
            try:
                r = json_add(args.devices, json.loads(sys.stdin.read() or "{}"))
            except (ValueError, OSError) as exc:
                r = {"ok": False, "error": str(exc)}
        else:
            try:
                r = json_remove(args.devices, args.remove_json)
            except OSError as exc:
                r = {"ok": False, "error": str(exc)}
        print(json.dumps(r, ensure_ascii=False))
        return 0
    if args.list:
        return cmd_list(args.devices)
    if args.remove:
        return cmd_remove(args.devices, args.remove)
    return cmd_register(args.devices, args)


if __name__ == "__main__":
    raise SystemExit(main())
