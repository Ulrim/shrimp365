"""prepare_dataset.py — 폴리곤 변환·클래스 병합·분할 누수 검사.

구글 드라이브의 shrimp_cf 라벨이 세그멘테이션 폴리곤이라, 이 변환이 틀리면
학습 자체가 조용히 망가진다(좌표가 엉뚱하게 해석된다). 그래서 실제 라벨과
같은 모양(24점 폴리곤)으로 검증한다.
"""
from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
MODULE_PATH = BACKEND / "ai" / "trainer" / "prepare_dataset.py"

_spec = importlib.util.spec_from_file_location("prepare_dataset", MODULE_PATH)
prep = importlib.util.module_from_spec(_spec)
sys.modules["prepare_dataset"] = prep
_spec.loader.exec_module(prep)


# ---------------------------------------------------------------------------
# 라벨 변환
# ---------------------------------------------------------------------------


def test_polygon_to_bbox_uses_extremes():
    coords = [0.2, 0.4, 0.6, 0.4, 0.6, 0.8, 0.2, 0.8]
    xc, yc, w, h = prep.polygon_to_bbox(coords)
    assert (round(xc, 6), round(yc, 6)) == (0.4, 0.6)
    assert (round(w, 6), round(h, 6)) == (0.4, 0.4)


def _ellipse_polygon(cx: float, cy: float, rx: float, ry: float, n: int = 24) -> list[float]:
    pts: list[float] = []
    for i in range(n):
        angle = 2 * math.pi * i / n
        pts += [cx + rx * math.cos(angle), cy + ry * math.sin(angle)]
    return pts


def test_segmentation_polygon_becomes_single_bbox_line():
    # shrimp_cf 실제 라벨과 같은 모양: 클래스 1개 + 좌표 48개 = 필드 49개
    coords = _ellipse_polygon(0.5, 0.5, 0.1, 0.05)
    line = "0 " + " ".join(f"{v:.6f}" for v in coords)
    assert len(line.split()) == 49

    out, stats, issues = prep.convert_label_text(line, {0: 0})

    assert stats["polygon"] == 1
    assert not issues
    assert len(out) == 1
    cls, xc, yc, w, h = out[0].split()
    assert cls == "0"
    assert abs(float(xc) - 0.5) < 1e-3
    assert abs(float(yc) - 0.5) < 1e-3
    # 폴리곤의 최대 반경이 그대로 폭/높이가 된다.
    assert abs(float(w) - 0.2) < 1e-3
    assert abs(float(h) - 0.1) < 1e-3


def test_plain_bbox_line_passes_through():
    out, stats, _ = prep.convert_label_text("0 0.5 0.25 0.1 0.2", {0: 0})
    assert stats["bbox"] == 1
    assert out == ["0 0.500000 0.250000 0.100000 0.200000"]


def test_out_of_frame_box_is_clipped_not_dropped():
    out, stats, issues = prep.convert_label_text("0 0.98 0.5 0.2 0.2", {0: 0})
    assert stats["bbox"] == 1
    assert {i.kind for i in issues} == {"out_of_range"}
    _, xc, _, w, _ = out[0].split()
    # 0.88~1.0 만 남으므로 중심 0.94, 폭 0.12
    assert abs(float(xc) - 0.94) < 1e-6
    assert abs(float(w) - 0.12) < 1e-6


def test_degenerate_and_unknown_lines_are_dropped():
    text = "\n".join(
        [
            "0 0.5 0.5 0.0 0.2",  # 폭 0
            "3 0.5 0.5 0.1 0.1",  # 없는 클래스
            "0 0.5 0.5 0.1",  # 좌표 개수 이상
            "쓰레기줄",
            "",
        ]
    )
    out, stats, issues = prep.convert_label_text(text, {0: 0})
    assert out == []
    assert stats["dropped"] == 4
    assert {i.kind for i in issues} == {"degenerate", "class", "arity", "parse"}


def test_class_remap_applies():
    out, _, _ = prep.convert_label_text("0 0.5 0.5 0.1 0.1", {0: 1})
    assert out[0].startswith("1 ")


# ---------------------------------------------------------------------------
# 클래스 매핑 / 파일명
# ---------------------------------------------------------------------------


def test_frame_stem_strips_roboflow_hash():
    assert prep.frame_stem("IMG_0042_jpg.rf.9f8e7d6c5b4a.jpg") == "IMG_0042_jpg"
    assert prep.frame_stem("plain_name.png") == "plain_name"


def test_merged_classes_fold_both_datasets_into_one():
    sources = [
        prep.SourceInfo("cf", Path("cf"), ["shrimp"]),
        prep.SourceInfo("pl", Path("pl"), ["Shrimp-baby"]),
    ]
    names, maps = prep.build_class_maps(sources, stage_classes=False)
    assert names == ["shrimp"]
    assert maps["cf"] == {0: 0}
    assert maps["pl"] == {0: 0}


def test_stage_classes_separate_postlarvae():
    sources = [
        prep.SourceInfo("cf", Path("cf"), ["shrimp"]),
        prep.SourceInfo("pl", Path("pl"), ["Shrimp-baby"]),
    ]
    names, maps = prep.build_class_maps(sources, stage_classes=True)
    assert names == ["shrimp", "shrimp_pl"]
    assert maps["cf"][0] == 0
    assert maps["pl"][0] == 1  # 자어는 별도 클래스


def test_read_source_classes_parses_roboflow_yaml(tmp_path):
    (tmp_path / "data.yaml").write_text(
        "train: ../train/images\nval: ../valid/images\n\nnc: 1\nnames: ['Shrimp-baby']\n",
        encoding="utf-8",
    )
    assert prep.read_source_classes(tmp_path) == ["Shrimp-baby"]


# ---------------------------------------------------------------------------
# 누수 검사 + 통합
# ---------------------------------------------------------------------------


def _item(split: str, name: str, stem: str, digest: str = "") -> prep.Item:
    return prep.Item(
        source="s",
        split=split,
        image=Path(name),
        label=None,
        out_name=name,
        stem=stem,
        digest=digest,
    )


def test_find_leaks_detects_shared_frame_across_splits():
    items = [
        _item("train", "a.jpg", "frame1", "h1"),
        _item("valid", "b.jpg", "frame1", "h2"),
        _item("train", "c.jpg", "frame2", "h3"),
    ]
    leaks = prep.find_leaks(items, use_hash=True)
    assert len(leaks) == 1
    assert leaks[0].kind == "frame"
    assert leaks[0].train_names == ["a.jpg"]
    assert leaks[0].eval_names == ["b.jpg"]


def test_find_leaks_reports_each_pair_once():
    # 같은 파일이 이름과 해시 양쪽에 걸려도 한 건으로만 센다.
    items = [
        _item("train", "a.jpg", "frame1", "same"),
        _item("test", "b.jpg", "frame1", "same"),
    ]
    assert len(prep.find_leaks(items, use_hash=True)) == 1


def test_find_leaks_ignores_duplicates_inside_train():
    items = [
        _item("train", "a.jpg", "frame1", "same"),
        _item("train", "b.jpg", "frame1", "same"),
    ]
    assert prep.find_leaks(items, use_hash=True) == []


def _make_roboflow_export(root: Path, class_name: str, polygon: bool) -> None:
    for split, count in (("train", 3), ("valid", 2)):
        (root / split / "images").mkdir(parents=True)
        (root / split / "labels").mkdir(parents=True)
        for i in range(count):
            stem = f"{split}{i}_jpg.rf.{'0' * 8}{i}"
            (root / split / "images" / f"{stem}.jpg").write_bytes(f"{root.name}{split}{i}".encode())
            if polygon:
                coords = _ellipse_polygon(0.5, 0.5, 0.08, 0.04)
                body = "0 " + " ".join(f"{v:.6f}" for v in coords)
            else:
                body = "0 0.5 0.5 0.1 0.1"
            (root / split / "labels" / f"{stem}.txt").write_text(f"{body}\n{body}\n")
    (root / "data.yaml").write_text(f"nc: 1\nnames: ['{class_name}']\n", encoding="utf-8")


def test_end_to_end_merge_writes_usable_dataset(tmp_path):
    _make_roboflow_export(tmp_path / "cf", "shrimp", polygon=True)
    _make_roboflow_export(tmp_path / "pl", "Shrimp-baby", polygon=False)
    out = tmp_path / "merged"

    code = prep.main(
        [
            "--source",
            f"cf={tmp_path / 'cf'}",
            "--source",
            f"pl={tmp_path / 'pl'}",
            "--out",
            str(out),
        ]
    )
    assert code == 0

    train_images = sorted(p.name for p in (out / "train" / "images").iterdir())
    assert len(train_images) == 6  # 두 원본의 train 3 + 3
    assert all(name.startswith(("cf__", "pl__")) for name in train_images)

    # 라벨은 모두 detect 형식(5개 필드)으로 바뀌어 있어야 한다.
    for label in (out / "train" / "labels").iterdir():
        for line in label.read_text(encoding="utf-8").splitlines():
            assert len(line.split()) == 5

    yaml_text = (out / "data.yaml").read_text(encoding="utf-8")
    assert f"path: {out.resolve()}" in yaml_text
    assert "train: train/images" in yaml_text
    assert "val: valid/images" in yaml_text
    assert "nc: 1" in yaml_text
    assert "names: ['shrimp']" in yaml_text
    assert "test:" not in yaml_text  # test 분할이 없으면 적지 않는다


def test_leakage_drop_removes_the_train_copy(tmp_path):
    root = tmp_path / "src"
    for split in ("train", "valid"):
        (root / split / "images").mkdir(parents=True)
        (root / split / "labels").mkdir(parents=True)
        # 같은 원본 프레임(frame7)이 train 과 valid 양쪽에 들어간 상태
        stem = f"frame7_jpg.rf.{split}"
        (root / split / "images" / f"{stem}.jpg").write_bytes(b"x")
        (root / split / "labels" / f"{stem}.txt").write_text("0 0.5 0.5 0.1 0.1\n")
    # 겹치지 않는 train 이미지 한 장(누수만 빠지는지 보려면 남는 장이 있어야 한다)
    (root / "train" / "images" / "frame8_jpg.rf.train.jpg").write_bytes(b"y")
    (root / "train" / "labels" / "frame8_jpg.rf.train.txt").write_text("0 0.5 0.5 0.1 0.1\n")
    (root / "data.yaml").write_text("nc: 1\nnames: ['shrimp']\n", encoding="utf-8")

    out = tmp_path / "clean"
    assert prep.main(["--source", f"s={root}", "--out", str(out), "--on-leakage", "drop"]) == 0
    train_left = [p.name for p in (out / "train" / "images").iterdir()]
    assert train_left == ["s__frame8_jpg.rf.train.jpg"]  # 누수된 frame7 만 빠졌다
    assert len(list((out / "valid" / "images").iterdir())) == 1  # 검증 쪽은 그대로


def test_dry_run_writes_nothing(tmp_path):
    _make_roboflow_export(tmp_path / "cf", "shrimp", polygon=True)
    out = tmp_path / "nope"
    assert prep.main(["--source", f"cf={tmp_path / 'cf'}", "--out", str(out), "--dry-run"]) == 0
    assert not out.exists()


def test_missing_source_directory_fails_clearly(tmp_path):
    try:
        prep.main(["--source", f"x={tmp_path / 'ghost'}", "--out", str(tmp_path / 'o')])
    except SystemExit as exc:
        assert "데이터셋 경로가 없습니다" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("없는 경로인데 통과했다")
