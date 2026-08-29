"""Tracking (ByteTrack-style dedup counting) + stable-count EMA smoothing."""
from __future__ import annotations

import logging
import uuid

import numpy as np

from app.config import settings
from app.services.detector import (
    DetectionResult,
    ShrimpDetector,
    SimulatedDetector,
    TankSimulation,
)
from app.services.stream_service import CameraSnapshot, CameraStreamProcessor


def _snapshot() -> CameraSnapshot:
    return CameraSnapshot(
        id=uuid.uuid4(),
        tank_id=uuid.uuid4(),
        farm_id=uuid.uuid4(),
        name="트래킹 테스트 카메라",
        camera_type="usb",
        stream_url=None,
        fps_target=1.0,
    )


def test_detection_result_track_ids_additive_default():
    # Existing callers construct DetectionResult without track_ids.
    result = DetectionResult(count=0)
    assert result.track_ids is None


def test_simulated_detector_exposes_stable_track_ids():
    sim = TankSimulation(seed="track-test")
    detector = SimulatedDetector(sim)

    r1 = detector.detect_with_tracking(None)
    assert r1.track_ids is not None
    assert len(r1.track_ids) == len(r1.bboxes) == r1.count
    assert len(set(r1.track_ids)) == len(r1.track_ids)  # ids unique

    sim.step()
    r2 = detector.detect_with_tracking(None)
    assert r2.track_ids is not None
    # Persistent identities: the vast majority of ids survive between frames
    # (small churn from population walk + simulated missed detections).
    overlap = set(r1.track_ids) & set(r2.track_ids)
    assert len(overlap) >= 0.8 * min(len(r1.track_ids), len(r2.track_ids))


class _FakeBox:
    def __init__(self, xyxy, conf, box_id):
        self.xyxy = [np.array(xyxy, dtype=float)]
        self.conf = [conf]
        self.id = None if box_id is None else np.array([box_id])


class _FakeResult:
    def __init__(self, boxes):
        self.boxes = boxes


class _FakeModel:
    def __init__(self, results):
        self._results = results
        self.track_kwargs = None

    def track(self, frame, **kwargs):
        self.track_kwargs = kwargs
        return self._results

    def predict(self, frame, **kwargs):
        return self._results


def test_shrimp_detector_tracking_parses_bytetrack_ids():
    detector = ShrimpDetector(model_path="fake.pt")
    boxes = [_FakeBox([10, 10, 50, 50], 0.9, 7), _FakeBox([100, 100, 150, 150], 0.8, 9)]
    detector._model = _FakeModel([_FakeResult(boxes)])
    frame = np.zeros((720, 1280, 3), dtype=np.uint8)

    result = detector.detect_with_tracking(frame)
    assert result.count == 2
    assert result.track_ids == [7, 9]
    assert result.frame_width == 1280 and result.frame_height == 720
    kwargs = detector._model.track_kwargs
    assert kwargs["persist"] is True
    assert kwargs["tracker"] == "bytetrack.yaml"
    assert kwargs["conf"] == detector.conf_threshold


def test_shrimp_detector_tracking_warmup_without_ids():
    # Tracker warm-up: boxes without ids -> track_ids stays None, count intact.
    detector = ShrimpDetector(model_path="fake.pt")
    boxes = [_FakeBox([10, 10, 50, 50], 0.9, None)]
    detector._model = _FakeModel([_FakeResult(boxes)])
    result = detector.detect_with_tracking(np.zeros((720, 1280, 3), dtype=np.uint8))
    assert result.count == 1
    assert result.track_ids is None


def test_run_detection_falls_back_and_logs_once(monkeypatch, caplog):
    monkeypatch.setattr(settings, "use_tracking", True)
    processor = CameraStreamProcessor(_snapshot())

    def boom(frame):
        raise RuntimeError("tracker exploded")

    monkeypatch.setattr(processor.detector, "detect_with_tracking", boom)
    with caplog.at_level(logging.ERROR, logger="app.services.stream_service"):
        r1 = processor._run_detection(None)
        r2 = processor._run_detection(None)
    assert isinstance(r1, DetectionResult) and isinstance(r2, DetectionResult)
    fallback_logs = [r for r in caplog.records if "Tracking failed" in r.getMessage()]
    assert len(fallback_logs) == 1  # logged once per camera


def test_run_detection_respects_use_tracking_flag(monkeypatch):
    monkeypatch.setattr(settings, "use_tracking", False)
    processor = CameraStreamProcessor(_snapshot())

    def boom(frame):
        raise AssertionError("detect_with_tracking must not be called")

    monkeypatch.setattr(processor.detector, "detect_with_tracking", boom)
    result = processor._run_detection(None)
    assert isinstance(result, DetectionResult)


def test_stable_count_ema(monkeypatch):
    monkeypatch.setattr(settings, "count_smoothing_alpha", 0.5)
    processor = CameraStreamProcessor(_snapshot())
    assert processor._update_stable_count(100) == 100  # seeded with first value
    assert processor._update_stable_count(0) == 50
    assert processor._update_stable_count(0) == 25
    # Smoothed value damps a single-frame spike far below the raw reading.
    assert processor._update_stable_count(200) < 200
