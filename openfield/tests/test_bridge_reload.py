"""수집 브리지가 devices.yaml 을 다시 읽는지 — 장비 화면 [무선 센서] 에서 등록한 센서가
서비스 재시작 없이 들어와야 한다."""

import importlib.util
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _bridge():
    spec = importlib.util.spec_from_file_location("zigbee_bridge", ROOT / "scripts" / "zigbee_bridge.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


YAML = """kinds:
  soil:
    map: {{temperature: soil_temp}}
devices:
{body}
"""


def test_reload_on_change(tmp_path):
    bridge = _bridge()
    path = tmp_path / "devices.yaml"
    path.write_text(YAML.format(body=""), encoding="utf-8")
    table = bridge.DeviceTable(str(path), {})
    assert table.current(now=100.0) == {}

    path.write_text(YAML.format(body="  soil-c1: {kind: soil, zone: control, sensor_id: SOIL-C1}"), encoding="utf-8")
    os.utime(path, (path.stat().st_atime, path.stat().st_mtime + 10))
    assert table.current(now=102.0) == {}            # 5초 안에는 파일을 다시 보지 않는다
    devs = table.current(now=106.0)
    assert list(devs) == ["soil-c1"] and devs["soil-c1"].sensor_id == "SOIL-C1"


def test_bad_file_keeps_previous(tmp_path):
    bridge = _bridge()
    path = tmp_path / "devices.yaml"
    path.write_text(YAML.format(body="  soil-c1: {kind: soil, zone: control, sensor_id: SOIL-C1}"), encoding="utf-8")
    from ofdf.data import zigbee
    table = bridge.DeviceTable(str(path), zigbee.load_devices(path))
    path.write_text(YAML.format(body="  x: {kind: nosuchkind}"), encoding="utf-8")     # 모르는 종류 → 읽기 실패
    os.utime(path, (path.stat().st_atime, path.stat().st_mtime + 10))
    assert list(table.current(now=1000.0)) == ["soil-c1"]


@pytest.mark.parametrize("exists", [False, True])
def test_starts_without_devices(tmp_path, exists, monkeypatch):
    """처음 설치한 장비는 등록한 센서가 없다 — 그래도 브리지는 떠야 한다(페어링 목록을 남기려고)."""
    bridge = _bridge()
    path = tmp_path / "devices.yaml"
    if exists:
        path.write_text(YAML.format(body=""), encoding="utf-8")
    called = {}
    monkeypatch.setattr(bridge, "run_subscribe", lambda args, devices, writer: called.setdefault("devices", devices) or 0)
    assert bridge.main(["--devices", str(path), "--out", str(tmp_path / "out"), "--capture", ""]) == 0
    assert called["devices"] == {}
