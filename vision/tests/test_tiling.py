"""app/services/tiling.py — 조각 추론의 자르기·합치기 규칙."""
from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from app.services import tiling
from app.services.detector import BBox, DetectionResult


class TestPlanTiles:
    def test_작은_프레임은_한_조각(self):
        assert tiling.plan_tiles(400, 300, 768, 0.25) == [tiling.TileRect(0, 0, 400, 300)]

    def test_프레임_전체를_덮는다(self):
        width, height = 1512, 2016
        covered = np.zeros((height, width), dtype=bool)
        for rect in tiling.plan_tiles(width, height, 768, 0.25):
            assert 0 <= rect.x0 < rect.x1 <= width
            assert 0 <= rect.y0 < rect.y1 <= height
            assert rect.x1 - rect.x0 == 768 and rect.y1 - rect.y0 == 768
            covered[rect.y0:rect.y1, rect.x0:rect.x1] = True
        assert covered.all()

    def test_겹침만큼_이웃과_겹친다(self):
        origins = tiling.tile_origins(2016, 768, 0.25)
        gaps = [b - a for a, b in zip(origins, origins[1:], strict=False)]
        assert max(gaps) <= 768 * 0.75 + 1


class TestCutEdge:
    def test_안쪽_경계에_닿으면_잘린_것(self):
        rect = tiling.TileRect(500, 0, 1268, 768)
        boxes = np.array([[500.0, 100, 600, 150], [700.0, 100, 800, 150]])
        assert tiling.touches_cut_edge(boxes, rect, 1512, 2016).tolist() == [True, False]

    def test_프레임_가장자리는_잘린_것이_아니다(self):
        rect = tiling.TileRect(0, 0, 768, 768)
        boxes = np.array([[0.0, 0, 100, 50]])
        assert tiling.touches_cut_edge(boxes, rect, 1512, 2016).tolist() == [False]

    def test_빈_입력(self):
        rect = tiling.TileRect(0, 0, 768, 768)
        assert tiling.touches_cut_edge(np.zeros((0, 4)), rect, 1512, 2016).shape == (0,)


class TestMerge:
    def test_빈_입력(self):
        assert tiling.merge_tile_boxes(
            np.zeros((0, 4)), np.zeros(0), np.zeros(0, dtype=int), np.zeros(0, dtype=bool)
        ) == []

    def test_두_조각이_같은_새우를_온전히_보면_하나만(self):
        boxes = np.array([[100.0, 100, 300, 160], [102.0, 101, 299, 161]])
        keep = tiling.merge_tile_boxes(
            boxes, np.array([0.8, 0.9]), np.array([0, 1]), np.array([False, False])
        )
        assert keep == [1]  # 신뢰도 높은 쪽

    def test_잘린_반쪽은_온전한_상자에_먹힌다(self):
        # 조각0 이 새우 전체, 조각1 이 경계에 잘린 오른쪽 절반(신뢰도는 더 높다)
        boxes = np.array([[100.0, 100, 300, 160], [200.0, 102, 300, 158]])
        keep = tiling.merge_tile_boxes(
            boxes, np.array([0.6, 0.9]), np.array([0, 1]), np.array([False, True])
        )
        assert keep == [0]

    def test_경계에_닿지_않은_작은_상자는_큰_상자_안에_있어도_남는다(self):
        # 비스듬한 새우의 큰 상자 안에 다른 새우가 통째로 들어간 경우
        boxes = np.array([[100.0, 100, 400, 400], [120.0, 300, 200, 380]])
        keep = tiling.merge_tile_boxes(
            boxes, np.array([0.9, 0.8]), np.array([0, 1]), np.array([False, False])
        )
        assert sorted(keep) == [0, 1]

    def test_같은_조각의_상자로는_반쪽을_지우지_않는다(self):
        boxes = np.array([[100.0, 100, 400, 400], [300.0, 300, 400, 400]])
        keep = tiling.merge_tile_boxes(
            boxes, np.array([0.9, 0.8]), np.array([0, 0]), np.array([False, True])
        )
        assert sorted(keep) == [0, 1]

    def test_떨어진_상자는_모두_남고_신뢰도순(self):
        boxes = np.array([[0.0, 0, 50, 50], [100.0, 100, 150, 150], [300.0, 300, 350, 350]])
        keep = tiling.merge_tile_boxes(
            boxes, np.array([0.5, 0.9, 0.7]), np.array([0, 1, 2]), np.zeros(3, dtype=bool)
        )
        assert keep == [1, 2, 0]


class _FakeDetector:
    """프레임 좌표로 정해 둔 '새우'를, 조각 안에 보이는 만큼 잘라서 돌려준다."""

    def __init__(self, shrimp: list[tuple[float, float, float, float]]):
        self.shrimp = shrimp
        self.calls: list[tuple[int, int]] = []
        self._rects: list[tiling.TileRect] = []

    def plan(self, width: int, height: int, tile: int, overlap: float) -> None:
        self._rects = tiling.plan_tiles(width, height, tile, overlap)

    def detect(self, frame):
        rect = self._rects[len(self.calls)]
        self.calls.append(frame.size)
        boxes = []
        for x1, y1, x2, y2 in self.shrimp:
            cx1, cy1 = max(x1, rect.x0), max(y1, rect.y0)
            cx2, cy2 = min(x2, rect.x1), min(y2, rect.y1)
            if cx2 - cx1 < 5 or cy2 - cy1 < 5:
                continue
            visible = (cx2 - cx1) * (cy2 - cy1) / ((x2 - x1) * (y2 - y1))
            score = 0.5 + 0.4 * visible
            boxes.append(
                BBox(cx1 - rect.x0, cy1 - rect.y0, cx2 - rect.x0, cy2 - rect.y0, score)
            )
        return DetectionResult(count=len(boxes), bboxes=boxes, model_version="fake.onnx")


class TestDetectTiled:
    def test_조각마다_추론하고_한_마리씩만_남긴다(self):
        shrimp = [
            (50.0, 50, 250, 110),       # 왼쪽 위 — 한 조각에만
            (700.0, 300, 900, 360),     # 가로 겹침 구역 — 여러 조각에 보임
            (400.0, 1100, 460, 1300),   # 세로 경계에 걸침
            (1300.0, 1900, 1500, 1960), # 오른쪽 아래 구석
        ]
        detector = _FakeDetector(shrimp)
        detector.plan(1512, 2016, 768, 0.25)
        frame = Image.new("RGB", (1512, 2016), (90, 90, 70))

        result = tiling.detect_tiled(detector, frame, tile=768, overlap=0.25)

        assert len(detector.calls) == len(tiling.plan_tiles(1512, 2016, 768, 0.25))
        assert all(size == (768, 768) for size in detector.calls)
        assert result.count == len(shrimp)
        assert (result.frame_width, result.frame_height) == (1512, 2016)
        assert result.model_version == "fake.onnx"
        found = sorted((b.x1, b.y1, b.x2, b.y2) for b in result.bboxes)
        for got, want in zip(found, sorted(shrimp), strict=True):
            assert got == pytest.approx(want, abs=0.5)

    def test_새우가_없으면_빈_결과(self):
        detector = _FakeDetector([])
        detector.plan(1000, 600, 500, 0.2)
        result = tiling.detect_tiled(
            detector, Image.new("RGB", (1000, 600)), tile=500, overlap=0.2
        )
        assert result.count == 0 and result.bboxes == [] and result.confidence_avg == 0.0


class TestMinConfidence:
    """임계값은 합치기 **전에** 걸어야 서비스(거른 뒤 합치기)와 같은 결과가 난다."""

    def _candidates(self):
        # 조각0: 신뢰도 낮은 온전한 상자 / 조각1: 신뢰도 높은 잘린 반쪽
        return tiling.TileCandidates(
            boxes=np.array([[100.0, 100, 300, 160], [200.0, 102, 300, 158]]),
            scores=np.array([0.10, 0.90]),
            tile_index=np.array([0, 1]),
            cut=np.array([False, True]),
            width=1512,
            height=2016,
            model_version="fake.onnx",
        )

    def test_임계값_없이는_낮은_신뢰도_상자가_반쪽을_지운다(self):
        merged = tiling.merge_candidates(self._candidates())
        assert [b.confidence for b in merged] == [0.10]

    def test_임계값을_먼저_걸면_반쪽이_남는다(self):
        merged = tiling.merge_candidates(self._candidates(), min_confidence=0.25)
        assert [b.confidence for b in merged] == [0.90]
        assert (merged[0].x1, merged[0].x2) == (200.0, 300.0)

    def test_detect_tiled_는_모으기와_합치기를_이은_것(self):
        shrimp = [(700.0, 300, 900, 360), (400.0, 1100, 460, 1300)]
        frame = Image.new("RGB", (1512, 2016))
        first, second = _FakeDetector(shrimp), _FakeDetector(shrimp)
        first.plan(1512, 2016, 768, 0.25)
        second.plan(1512, 2016, 768, 0.25)
        whole = tiling.detect_tiled(first, frame, tile=768, min_confidence=0.6)
        parts = tiling.merge_candidates(
            tiling.collect_tile_boxes(second, frame, tile=768), min_confidence=0.6
        )
        assert whole.bboxes == parts
        assert all(b.confidence >= 0.6 for b in parts)
