"""make_tiles.py — 사진을 조각내는 규칙."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ai" / "trainer"))

import make_tiles as mt  # noqa: E402


class TestTileOrigins:
    def test_사진이_조각보다_작으면_하나(self):
        assert mt.tile_origins(400, 768, 0.25) == [0]
        assert mt.tile_origins(768, 768, 0.25) == [0]

    def test_마지막_조각은_끝에_맞춘다(self):
        origins = mt.tile_origins(1512, 768, 0.25)
        assert origins[0] == 0
        assert origins[-1] == 1512 - 768

    def test_빈틈없이_덮는다(self):
        for size in (769, 1000, 1512, 2016, 4032):
            origins = mt.tile_origins(size, 768, 0.25)
            covered = 0
            for start in origins:
                assert start <= covered, f"{size}: {covered}~{start} 사이가 비었다"
                covered = max(covered, start + 768)
            assert covered == size

    def test_겹침이_클수록_조각이_많다(self):
        assert len(mt.tile_origins(2016, 768, 0.5)) > len(mt.tile_origins(2016, 768, 0.0))

    def test_잘못된_값은_거부(self):
        with pytest.raises(ValueError):
            mt.tile_origins(1000, 0, 0.25)
        with pytest.raises(ValueError):
            mt.tile_origins(1000, 768, 1.0)


class TestClipBoxes:
    def test_안에_든_상자는_좌표만_옮긴다(self):
        assert mt.clip_boxes([(110, 220, 160, 300)], 100, 200, 500, 500) == [(10, 20, 60, 100)]

    def test_밖의_상자는_버린다(self):
        assert mt.clip_boxes([(0, 0, 50, 50)], 100, 200, 500, 500) == []

    def test_절반_넘게_보이면_잘라서_남긴다(self):
        # 가로 100 중 60 이 조각 안 → 0.6
        kept = mt.clip_boxes([(60, 10, 160, 50)], 100, 0, 500, 500)
        assert kept == [(0, 10, 60, 50)]

    def test_절반_미만이면_버린다(self):
        # 가로 100 중 40 만 조각 안 → 0.4
        assert mt.clip_boxes([(40, 10, 140, 50)], 100, 0, 500, 500) == []

    def test_기준을_낮추면_남는다(self):
        assert mt.clip_boxes([(40, 10, 140, 50)], 100, 0, 500, 500, min_visible=0.3)

    def test_넓이_없는_상자는_무시(self):
        assert mt.clip_boxes([(10, 10, 10, 50)], 0, 0, 500, 500) == []


class TestYoloIo:
    def test_읽고_쓰면_같다(self, tmp_path):
        boxes = [(100.0, 200.0, 300.0, 260.0), (0.0, 0.0, 50.0, 80.0)]
        path = tmp_path / "a.txt"
        path.write_text(mt.format_yolo(boxes, 1000, 800), encoding="utf-8")
        back = mt.read_yolo(path, 1000, 800)
        for got, want in zip(back, boxes, strict=True):
            assert got == pytest.approx(want, abs=0.01)

    def test_라벨_파일이_없으면_빈_사진(self, tmp_path):
        assert mt.read_yolo(tmp_path / "없음.txt", 100, 100) == []

    def test_상자가_없으면_빈_문자열(self):
        assert mt.format_yolo([], 100, 100) == ""


class TestMakeTiles:
    @pytest.fixture
    def source(self, tmp_path):
        Image = pytest.importorskip("PIL.Image")
        images, labels = tmp_path / "images", tmp_path / "labels"
        images.mkdir()
        labels.mkdir()
        Image.new("RGB", (1000, 600), (90, 90, 70)).save(images / "tank1-s1.rf.000001.jpg")
        # 왼쪽 위 한 마리, 조각 경계(x=500 부근)에 걸친 한 마리
        (labels / "tank1-s1.rf.000001.txt").write_text(
            mt.format_yolo([(20, 20, 120, 60), (450, 300, 650, 340)], 1000, 600),
            encoding="utf-8",
        )
        return images, labels, tmp_path / "out"

    def test_조각과_라벨을_쓴다(self, source):
        images, labels, out = source
        stats = mt.make_tiles(images, labels, out, tile=600, overlap=0.0)
        tiles = sorted(p.name for p in (out / "images").iterdir())
        assert tiles == ["tank1-s1.rf.000001__x0_y0.jpg", "tank1-s1.rf.000001__x400_y0.jpg"]
        assert stats["사진"] == 1 and stats["조각"] == 2
        left = (out / "labels" / "tank1-s1.rf.000001__x0_y0.txt").read_text().splitlines()
        right = (out / "labels" / "tank1-s1.rf.000001__x400_y0.txt").read_text().splitlines()
        assert len(left) == 2  # 걸친 새우는 왼쪽에 150/200 보인다
        assert len(right) == 1  # 걸친 새우 전체가 오른쪽 조각 안

    def test_회차_이름이_남는다(self, source):
        images, labels, out = source
        mt.make_tiles(images, labels, out, tile=600, overlap=0.0)
        for path in (out / "images").iterdir():
            assert path.name.split(".rf.")[0] == "tank1-s1"

    def test_빈_조각도_지우지_않는다(self, source):
        images, labels, out = source
        stats = mt.make_tiles(images, labels, out, tile=300, overlap=0.0)
        assert stats["빈_조각"] > 0
        empty = [p for p in (out / "labels").iterdir() if p.read_text() == ""]
        assert len(empty) == stats["빈_조각"]
        assert len(list((out / "images").iterdir())) == stats["조각"]

    def test_원본도_함께_넣을_수_있다(self, source):
        images, labels, out = source
        mt.make_tiles(images, labels, out, tile=600, overlap=0.0, keep_full=True)
        assert (out / "images" / "tank1-s1.rf.000001.jpg").exists()
        full = (out / "labels" / "tank1-s1.rf.000001.txt").read_text().splitlines()
        assert len(full) == 2

    def test_사진이_없으면_실패(self, tmp_path):
        (tmp_path / "images").mkdir()
        (tmp_path / "labels").mkdir()
        code = mt.main(
            [
                "--images", str(tmp_path / "images"),
                "--labels", str(tmp_path / "labels"),
                "--out", str(tmp_path / "out"),
            ]
        )
        assert code == 1
