"""에코윗 수신기 — 장비 화면에서 등록한 게이트웨이·채널만 받기(--registered-only), 들어온 게이트웨이 목록."""

import importlib.util
import json
import os
from pathlib import Path

from ofdf.data import ecowitt

ROOT = Path(__file__).resolve().parents[1]

MINE, OTHER = "A1B2C3D4E5F60718", "FFEE0011FFEE0011"


def _receiver():
    spec = importlib.util.spec_from_file_location("ecowitt_receiver", ROOT / "scripts" / "ecowitt_receiver.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _body(passkey: str, **extra) -> str:
    fields = {"PASSKEY": passkey, "stationtype": "GW2000A_V3.1.4", "model": "GW2000A",
              "dateutc": "2026-11-01 05:00:00", "tempf": "36.3", "humidity": "92", "dailyrainin": "0.0",
              "wh90batt": "3.10", "soilmoisture1": "34", "soilbatt1": "1.5", "temp2f": "50.0", "humidity2": "80"}
    fields.update(extra)
    return "&".join(f"{k}={v}".replace(" ", "+") for k, v in fields.items())


def _state(tmp_path, ecowitt_yaml: str):
    mod = _receiver()
    dev = tmp_path / "devices.yaml"
    dev.write_text("devices:\n\necowitt:\n" + ecowitt_yaml, encoding="utf-8")
    out = tmp_path / "out"
    args = mod.argparse.Namespace(out=str(out), capture=str(out / "capture"), devices=str(dev), zone="mast",
                                  sensor_id="WS90-01", registered_only=True)
    return mod.State(args), dev, out


def _sensors(out: Path) -> set[str]:
    rows = []
    for f in out.glob("ecowitt_*.csv"):
        rows += [line.split(",") for line in f.read_text(encoding="utf-8").splitlines()[1:]]
    return {r[2] for r in rows}


def test_등록_안_했으면_기상값을_받지_않는다(tmp_path):
    st, _, out = _state(tmp_path, "  channels: {}\n")
    st.handle(_body(MINE), "192.168.0.31")
    assert _sensors(out) == set()                       # WS90 도 채널도 아직 등록 전
    heard = json.loads((out / "capture" / "ecowitt_heard.json").read_text(encoding="utf-8"))
    g = heard["gateways"][0]
    assert (g["passkey"], g["ip"], g["outdoor"]) == (MINE, "192.168.0.31", True)
    assert set(g["channels"]) == {"soil1", "th2"}


def test_등록한_게이트웨이만_받는다(tmp_path):
    st, _, out = _state(tmp_path, f"  gateway: {{zone: mast, sensor_id: WS90-01, passkey: {MINE}}}\n"
                                  "  channels:\n    soil1: {zone: control, sensor_id: SOIL-C1}\n")
    st.handle(_body(OTHER), "192.168.0.77")
    assert _sensors(out) == set()                       # 이웃 게이트웨이
    st.handle(_body(MINE[:-2]), "192.168.0.78")
    assert _sensors(out) == set()                       # 앞부분만 같은 열쇠도 남의 것이다
    st.handle(_body(MINE), "192.168.0.31")
    assert _sensors(out) == {"WS90-01", "SOIL-C1"}      # th2 는 등록하지 않았다


def test_화면에서_등록하면_다시_읽는다(tmp_path):
    st, dev, out = _state(tmp_path, "  channels: {}\n")
    st.handle(_body(MINE), "192.168.0.31")
    assert _sensors(out) == set()
    dev.write_text("devices:\n\necowitt:\n  channels:\n"
                   "    th2: {zone: treatment, sensor_id: CN-T1, map: {t_air: canopy_temp}}\n", encoding="utf-8")
    os.utime(dev, (dev.stat().st_atime, dev.stat().st_mtime + 10))
    st._checked = 0.0                                   # 5초 기다리지 않는다
    st.handle(_body(MINE), "192.168.0.31")
    assert _sensors(out) == {"CN-T1"}


def test_report_summary():
    s = ecowitt.report_summary({"tempf": "36", "wh90batt": "3.1", "soilmoisture3": "20", "leafwetness_ch2": "0",
                                "tf_ch1": "50", "temp4f": "60", "dailyrainin": "0"})
    assert s["outdoor"] and s["ws90"]
    assert set(s["channels"]) == {"soil3", "leaf2", "tf1", "th4"}


def test_채널만_등록해도_열쇠가_있으면_다른_게이트웨이는_버린다(tmp_path):
    # 장비 화면은 첫 등록 때 ecowitt: 바로 아래에 열쇠를 적는다(숫자만이어도 글자로).
    st, _, out = _state(tmp_path, f'  passkey: "{MINE}"\n  channels:\n    soil1: {{zone: control, sensor_id: SOIL-C1}}\n')
    st.handle(_body(OTHER), "192.168.0.77")
    assert _sensors(out) == set()
    st.handle(_body(MINE.lower()), "192.168.0.31")      # 대소문자는 가리지 않는다
    assert _sensors(out) == {"SOIL-C1"}


def test_들어온_게이트웨이_목록은_상한이_있다(tmp_path):
    mod = _receiver()
    st, _, out = _state(tmp_path, "  channels: {}\n")
    for i in range(mod.HEARD_MAX + 10):
        st._flushed = 0.0
        st.handle(_body(f"{i:016X}"), "192.168.0.31")
    heard = json.loads((out / "capture" / "ecowitt_heard.json").read_text(encoding="utf-8"))
    assert len(heard["gateways"]) == mod.HEARD_MAX
