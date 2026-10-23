"""433MHz 브리지 — 들린 장치 목록, 설정에 적힌 장치만 받기, 설정 다시 읽기."""

import importlib.util
import io
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _bridge():
    spec = importlib.util.spec_from_file_location("rtl433_bridge", ROOT / "scripts" / "rtl433_bridge.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


WS90 = {"time": "2026-11-01 05:00:00", "model": "Fineoffset-WS90", "id": 12345, "temperature_C": 3.1,
        "humidity": 92, "rssi": -7.5}
WS90_NEIGHBOR = {**WS90, "id": 40711, "temperature_C": 9.9}
WH51 = {"time": "2026-11-01 05:00:01", "model": "Fineoffset-WH51", "id": "0a3f21", "moisture": 31, "battery_mV": 1600}
TPMS = {"time": "2026-11-01 05:00:02", "model": "Toyota-TPMS", "id": "ff00", "pressure_kPa": 230}


def _run(tmp_path, monkeypatch, yaml_rf: str, records):
    bridge = _bridge()
    dev = tmp_path / "devices.yaml"
    dev.write_text("devices:\n\nrf:\n" + yaml_rf, encoding="utf-8")
    monkeypatch.setattr("sys.stdin", io.StringIO("\n".join(json.dumps(r) for r in records) + "\n"))
    out = tmp_path / "out"
    assert bridge.main(["--devices", str(dev), "--out", str(out), "--capture", str(out / "capture")]) == 0
    rows = []
    for f in out.glob("rtl433_*.csv"):
        rows += [line.split(",") for line in f.read_text(encoding="utf-8").splitlines()[1:]]
    heard = json.loads((out / "capture" / "rtl433_heard.json").read_text(encoding="utf-8"))
    return rows, heard


def test_only_registered_id(tmp_path, monkeypatch):
    rows, heard = _run(tmp_path, monkeypatch, "  Fineoffset-WS90/12345: {zone: mast, sensor_id: WS90-01}\n",
                       [WS90, WS90_NEIGHBOR, WH51, TPMS])
    sensors = {r[2] for r in rows}
    assert sensors == {"WS90-01"}                                    # 이웃집 WS90·WH51·TPMS 는 버린다
    assert not any(r[3] == "t_air" and r[4] == "9.9" for r in rows)
    keys = {f"{d['model']}/{d['id']}" for d in heard["devices"]}
    assert keys == {"Fineoffset-WS90/12345", "Fineoffset-WS90/40711", "Fineoffset-WH51/0a3f21", "Toyota-TPMS/ff00"}
    assert next(d for d in heard["devices"] if d["id"] == "12345")["rssi"] == -7.5


def test_model_only_entry_takes_model(tmp_path, monkeypatch):
    rows, _ = _run(tmp_path, monkeypatch, "  Fineoffset-WS90:\n    zone: mast\n    sensor_id: WS90-01\n",
                   [WS90, WH51])
    assert {r[2] for r in rows} == {"WS90-01"}


def test_registered_wh51_with_map(tmp_path, monkeypatch):
    rows, _ = _run(tmp_path, monkeypatch,
                   "  Fineoffset-WH51/0a3f21: {zone: control, sensor_id: SOIL-C1}\n", [WS90, WH51])
    assert {(r[1], r[2], r[3]) for r in rows if r[3] == "soil_moisture"} == {("control", "SOIL-C1", "soil_moisture")}
    assert not any(r[2] == "WS90-01" for r in rows)


def test_rf_table_reload(tmp_path):
    bridge = _bridge()
    dev = tmp_path / "devices.yaml"
    dev.write_text("rf:\n", encoding="utf-8")
    table = bridge.RfTable(str(dev), {})
    dev.write_text("rf:\n  Fineoffset-WH51/1: {zone: control, sensor_id: SOIL-C1}\n", encoding="utf-8")
    os.utime(dev, (dev.stat().st_atime, dev.stat().st_mtime + 10))
    assert table.current(now=1.0) == {}
    assert list(table.current(now=10.0)) == ["Fineoffset-WH51/1"]
