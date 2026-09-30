"""pseudo_label.py — 라벨 없는 이미지에 사전 라벨을 만드는 도구.

좌표 변환이 틀리면 사람이 고치는 작업이 오히려 늘어난다(엉뚱한 자리의 박스를
전부 지워야 한다). 변환과 출력 형태를 검증한다.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest

BACKEND = Path(__file__).resolve().parents[1]
MODULE_PATH = BACKEND / "ai" / "trainer" / "pseudo_label.py"

_spec = importlib.util.spec_from_file_location("pseudo_label", MODULE_PATH)
pl = importlib.util.module_from_spec(_spec)
sys.modules["pseudo_label"] = pl
_spec.loader.exec_module(pl)


def test_pixel_box_becomes_normalized_yolo_line():
    line = pl.to_yolo_line(100, 200, 300, 400, width=1000, height=800)
    cls, xc, yc, w, h = line.split()
    assert cls == "0"
    assert float(xc) == pytest.approx(0.2)  # (100+300)/2 / 1000
    assert float(yc) == pytest.approx(0.375)  # (200+400)/2 / 800
    assert float(w) == pytest.approx(0.2)
    assert float(h) == pytest.approx(0.25)


def test_zero_size_box_is_rejected():
    assert pl.to_yolo_line(100, 200, 100, 400, 1000, 800) is None
    assert pl.to_yolo_line(100, 200, 300, 200, 1000, 800) is None


def test_collect_images_filters_and_sorts(tmp_path):
    for name in ("b.jpg", "a.png", "notes.txt", "c.JPEG"):
        (tmp_path / name).write_bytes(b"x")
    found = pl.collect_images(tmp_path, recursive=False, limit=None)
    assert [p.name for p in found] == ["a.png", "b.jpg", "c.JPEG"]


def test_collect_images_recursive_and_limit(tmp_path):
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "deep.jpg").write_bytes(b"x")
    (tmp_path / "top.jpg").write_bytes(b"x")
    assert len(pl.collect_images(tmp_path, recursive=True, limit=None)) == 2
    assert len(pl.collect_images(tmp_path, recursive=False, limit=None)) == 1
    assert len(pl.collect_images(tmp_path, recursive=True, limit=1)) == 1


def test_collect_images_reports_empty_directory(tmp_path):
    with pytest.raises(SystemExit) as excinfo:
        pl.collect_images(tmp_path, recursive=False, limit=None)
    assert "이미지를 찾지 못했습니다" in str(excinfo.value)


class _FakeBox:
    """ultralytics 의 Boxes 처럼 텐서 유사 객체를 담는다(.tolist() 가 있어야 한다)."""

    def __init__(self, xyxy):
        self.xyxy = [np.array(xyxy, dtype=float)]


class _FakeResult:
    def __init__(self, boxes, orig_shape):
        self.boxes = boxes
        self.orig_shape = orig_shape  # (height, width)


class _FakeModel:
    def __init__(self, boxes, orig_shape=(800, 1000)):
        self._boxes = boxes
        self._orig_shape = orig_shape
        self.predict_kwargs = None

    def predict(self, _path, **kwargs):
        self.predict_kwargs = kwargs
        return [_FakeResult(self._boxes, self._orig_shape)]


def test_end_to_end_writes_a_correctable_dataset(tmp_path, monkeypatch, capsys):
    source = tmp_path / "DB1"
    source.mkdir()
    for index in range(3):
        (source / f"s9_{index}.png").write_bytes(b"x")

    fake = _FakeModel([_FakeBox([100, 200, 300, 400]), _FakeBox([0, 0, 50, 50])])
    monkeypatch.setattr(pl, "_load_model", lambda _weights: fake)
    out = tmp_path / "prelabel"

    code = pl.main(
        ["--weights", "best.pt", "--images", str(source), "--out", str(out), "--conf", "0.4"]
    )
    assert code == 0

    images = sorted(p.name for p in (out / "images").iterdir())
    assert images == ["s9_0.png", "s9_1.png", "s9_2.png"]
    label = (out / "labels" / "s9_0.txt").read_text(encoding="utf-8")
    assert len(label.strip().splitlines()) == 2
    assert label.startswith("0 0.200000 0.375000 ")

    yaml_text = (out / "data.yaml").read_text(encoding="utf-8")
    assert "names: ['shrimp']" in yaml_text
    assert "사람이 고친 뒤" in yaml_text  # 경고가 파일에 남아 있어야 한다

    # 밀식 장면에서 잘리지 않도록 상한을 넘겨야 한다.
    assert fake.predict_kwargs["max_det"] == 1000
    assert fake.predict_kwargs["conf"] == 0.4

    printed = capsys.readouterr().out
    assert "사람이 박스를 고칩니다" in printed
    assert "자기 실수를 정답으로 배웁니다" in printed


def test_empty_predictions_still_produce_label_files(tmp_path, monkeypatch, capsys):
    source = tmp_path / "images"
    source.mkdir()
    (source / "blank.jpg").write_bytes(b"x")
    monkeypatch.setattr(pl, "_load_model", lambda _weights: _FakeModel([]))
    out = tmp_path / "out"

    assert pl.main(["--weights", "w.pt", "--images", str(source), "--out", str(out)]) == 0
    # YOLO 는 빈 라벨 파일을 '새우 없는 배경'으로 읽는다 — 그대로 둬야 한다.
    assert (out / "labels" / "blank.txt").read_text(encoding="utf-8") == ""
    assert "박스가 하나도 없는 장 1개" in capsys.readouterr().out


def test_link_mode_avoids_copying(tmp_path, monkeypatch):
    source = tmp_path / "images"
    source.mkdir()
    (source / "a.jpg").write_bytes(b"x")
    monkeypatch.setattr(pl, "_load_model", lambda _weights: _FakeModel([]))
    out = tmp_path / "out"

    pl.main(["--weights", "w.pt", "--images", str(source), "--out", str(out), "--link"])
    linked = out / "images" / "a.jpg"
    assert linked.is_symlink()
    assert linked.resolve() == (source / "a.jpg").resolve()
