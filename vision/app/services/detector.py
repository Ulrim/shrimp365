"""Shrimp detection: real YOLO wrapper + high-fidelity simulation.

Two interchangeable detector implementations:

- `ShrimpDetector`  — wraps an Ultralytics YOLO model (lazy import, only when
  the `ml` extra is installed and a trained weight file exists).
- `SimulatedDetector` — deterministic-ish per-camera population simulation
  used for demos/CI. Shrimp positions persist per camera and move smoothly
  between frames so live overlays look like real tracked animals.

`TankSimulation` is the shared world model: `SimulatedCamera` renders frames
from it and `SimulatedDetector` derives detections from the same state.
"""
from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass, field

import numpy as np
from PIL import Image

from app.config import settings


@dataclass
class BBox:
    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float


@dataclass
class DetectionResult:
    count: int
    bboxes: list[BBox] = field(default_factory=list)
    confidence_avg: float = 0.0
    inference_ms: int = 0
    frame_width: int = 0
    frame_height: int = 0
    model_version: str = "unknown"
    # Stable per-object tracker ids (ByteTrack in real mode, persistent shrimp
    # identities in simulation). Parallel to `bboxes` when present; None when
    # the detector ran without tracking. Additive — existing callers ignore it.
    track_ids: list[int] | None = None


# ---------------------------------------------------------------------------
# Simulation world
# ---------------------------------------------------------------------------


@dataclass
class _SimShrimp:
    x: float
    y: float
    angle: float  # heading, radians
    speed: float  # px/sec
    length: float  # body length, px
    shade: int  # base grey/pink tone offset
    track_id: int = 0  # persistent identity (simulated tracker id)


class TankSimulation:
    """Per-camera tank world: population random walk + smooth shrimp motion."""

    WIDTH = 1280
    HEIGHT = 720

    def __init__(self, seed: str | None = None) -> None:
        self.rng = random.Random(seed)
        self.baseline = self.rng.randint(200, 400)
        self.population = float(self.baseline)
        self.drift = self.rng.uniform(-0.02, 0.02)  # slow trend, shrimp/sec
        self._dip_until = 0.0
        self._dip_factor = 1.0
        self.shrimp: list[_SimShrimp] = []
        self._next_track_id = 1  # monotonically increasing shrimp identity
        self._last_step = time.monotonic()
        # Pre-rendered background (teal water + subtle static noise).
        self._background = self._make_background()
        self._sync_shrimp()

    # -- population dynamics --------------------------------------------------
    def step(self) -> None:
        now = time.monotonic()
        dt = min(max(now - self._last_step, 1e-3), 5.0)
        self._last_step = now

        # Bounded random walk with slow drift.
        self.population += self.drift * dt + self.rng.gauss(0, 0.8) * math.sqrt(dt)
        lo, hi = self.baseline * 0.6, self.baseline * 1.25
        self.population = min(max(self.population, lo), hi)

        # Occasional dips (feeding / clustering out of view).
        if now >= self._dip_until and self.rng.random() < 0.004:
            self._dip_until = now + self.rng.uniform(15, 45)
            self._dip_factor = self.rng.uniform(0.55, 0.8)
        if now >= self._dip_until:
            self._dip_factor = min(1.0, self._dip_factor + 0.01 * dt)

        self._sync_shrimp()
        self._move_shrimp(dt)

    def current_count(self) -> int:
        return max(0, int(round(self.population * self._dip_factor)))

    def _sync_shrimp(self) -> None:
        target = self.current_count()
        while len(self.shrimp) < target:
            self.shrimp.append(self._spawn())
        while len(self.shrimp) > target:
            self.shrimp.pop(self.rng.randrange(len(self.shrimp)))

    def _spawn(self) -> _SimShrimp:
        track_id = self._next_track_id
        self._next_track_id += 1
        return _SimShrimp(
            x=self.rng.uniform(30, self.WIDTH - 30),
            y=self.rng.uniform(30, self.HEIGHT - 30),
            angle=self.rng.uniform(0, 2 * math.pi),
            speed=self.rng.uniform(4, 22),
            length=self.rng.uniform(18, 32),
            shade=self.rng.randint(-25, 25),
            track_id=track_id,
        )

    def _move_shrimp(self, dt: float) -> None:
        for s in self.shrimp:
            # Gentle wander: small heading changes, occasional darts.
            s.angle += self.rng.gauss(0, 0.35) * dt
            if self.rng.random() < 0.01:
                s.speed = self.rng.uniform(30, 90)  # dart
            else:
                s.speed += (self.rng.uniform(4, 22) - s.speed) * 0.05
            s.x += math.cos(s.angle) * s.speed * dt
            s.y += math.sin(s.angle) * s.speed * dt
            # Bounce at tank walls.
            if s.x < 15 or s.x > self.WIDTH - 15:
                s.angle = math.pi - s.angle
                s.x = min(max(s.x, 15), self.WIDTH - 15)
            if s.y < 15 or s.y > self.HEIGHT - 15:
                s.angle = -s.angle
                s.y = min(max(s.y, 15), self.HEIGHT - 15)

    # -- rendering --------------------------------------------------------------
    def _make_background(self) -> Image.Image:
        rng = np.random.default_rng(abs(hash(repr(self.rng.random()))) % (2**32))
        h, w = self.HEIGHT, self.WIDTH
        # Dark teal water with a radial light falloff + noise.
        yy, xx = np.mgrid[0:h, 0:w]
        cx, cy = w / 2, h / 2
        dist = np.sqrt(((xx - cx) / w) ** 2 + ((yy - cy) / h) ** 2)
        light = (1.0 - 0.55 * dist).clip(0, 1)
        noise = rng.normal(0, 6, size=(h, w))
        base_r = (14 + 10 * light + noise * 0.5).clip(0, 255)
        base_g = (58 + 26 * light + noise).clip(0, 255)
        base_b = (66 + 30 * light + noise).clip(0, 255)
        arr = np.stack([base_r, base_g, base_b], axis=-1).astype(np.uint8)
        return Image.fromarray(arr, "RGB")

    def render(self) -> Image.Image:
        from PIL import ImageDraw

        frame = self._background.copy()
        draw = ImageDraw.Draw(frame)
        for s in self.shrimp:
            self._draw_shrimp(draw, s)
        return frame

    @staticmethod
    def _draw_shrimp(draw, s: _SimShrimp) -> None:
        # Elongated body: a few overlapping circles along the heading vector
        # (cheap oriented-ellipse approximation), light pink/grey tones.
        half = s.length / 2
        wr = s.length / 5.5  # body half-width
        dx, dy = math.cos(s.angle), math.sin(s.angle)
        r = min(max(205 + s.shade, 150), 255)
        g = min(max(175 + s.shade, 120), 255)
        b = min(max(165 + s.shade, 110), 255)
        n = 4
        for i in range(n):
            t = -half + s.length * i / (n - 1)
            radius = wr * (1.0 - 0.45 * (i / (n - 1)))  # tapering tail
            cx, cy = s.x + dx * t, s.y + dy * t
            draw.ellipse(
                (cx - radius, cy - radius, cx + radius, cy + radius),
                fill=(int(r), int(g), int(b)),
            )

    def detections(self) -> DetectionResult:
        rng = self.rng
        bboxes: list[BBox] = []
        track_ids: list[int] = []
        for s in self.shrimp:
            if rng.random() < 0.03:  # occasional missed detection
                continue
            half = s.length / 2 + 3
            jitter = rng.uniform(-2, 2)
            x1 = max(0.0, s.x - half + jitter)
            y1 = max(0.0, s.y - half + jitter)
            x2 = min(float(self.WIDTH), s.x + half + jitter)
            y2 = min(float(self.HEIGHT), s.y + half + jitter)
            bboxes.append(BBox(x1, y1, x2, y2, round(rng.uniform(0.75, 0.95), 3)))
            track_ids.append(s.track_id)
        conf_avg = round(sum(b.confidence for b in bboxes) / len(bboxes), 3) if bboxes else 0.0
        return DetectionResult(
            count=len(bboxes),
            bboxes=bboxes,
            confidence_avg=conf_avg,
            inference_ms=rng.randint(20, 80),
            frame_width=self.WIDTH,
            frame_height=self.HEIGHT,
            model_version="simulated-v1",
            track_ids=track_ids,
        )


# ---------------------------------------------------------------------------
# Detectors
# ---------------------------------------------------------------------------


class SimulatedDetector:
    """Detector twin of a `TankSimulation` — same interface as ShrimpDetector."""

    def __init__(self, simulation: TankSimulation) -> None:
        self.simulation = simulation

    def detect(self, frame) -> DetectionResult:  # noqa: ANN001 - frame unused
        return self.simulation.detections()

    def detect_with_tracking(self, frame) -> DetectionResult:  # noqa: ANN001
        """Simulation already has persistent identities — same as detect()."""
        return self.simulation.detections()


class ShrimpDetector:
    """Ultralytics YOLO wrapper. The heavy import happens lazily inside
    `_load()` so the app runs without the `ml` extra installed."""

    def __init__(self, model_path: str | None = None, conf_threshold: float | None = None):
        self.model_path = model_path or settings.model_path
        self.conf_threshold = conf_threshold or settings.confidence_threshold
        self._model = None

    def _load(self):
        if self._model is None:
            from ultralytics import YOLO  # lazy: requires the `ml` extra

            self._model = YOLO(self.model_path)
        return self._model

    def detect(self, frame) -> DetectionResult:  # noqa: ANN001 (np.ndarray, BGR)
        model = self._load()
        start = time.perf_counter()
        results = model.predict(frame, conf=self.conf_threshold, verbose=False)
        inference_ms = int((time.perf_counter() - start) * 1000)
        return self._to_result(results, frame, inference_ms, track_ids=None)

    def detect_with_tracking(self, frame) -> DetectionResult:  # noqa: ANN001
        """Detection + ByteTrack association (ultralytics built-in tracker).

        `persist=True` keeps tracker state between calls so the same shrimp
        keeps its track id across frames, enabling dedup counting.
        """
        model = self._load()
        start = time.perf_counter()
        results = model.track(
            frame,
            persist=True,
            tracker="bytetrack.yaml",
            conf=self.conf_threshold,
            verbose=False,
        )
        inference_ms = int((time.perf_counter() - start) * 1000)
        track_ids: list[int] = []
        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                box_id = getattr(box, "id", None)
                if box_id is not None:
                    track_ids.append(int(box_id[0]))
        detection = self._to_result(results, frame, inference_ms, track_ids=None)
        # Only attach ids when every box got one (tracker warm-up frames may
        # return unassociated boxes).
        if len(track_ids) == len(detection.bboxes):
            detection.track_ids = track_ids
        return detection

    def _to_result(
        self,
        results,  # noqa: ANN001 - ultralytics Results list
        frame,  # noqa: ANN001 - np.ndarray (BGR)
        inference_ms: int,
        track_ids: list[int] | None,
    ) -> DetectionResult:
        bboxes: list[BBox] = []
        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
                bboxes.append(BBox(x1, y1, x2, y2, float(box.conf[0])))
        conf_avg = round(sum(b.confidence for b in bboxes) / len(bboxes), 3) if bboxes else 0.0
        h, w = frame.shape[:2]
        return DetectionResult(
            count=len(bboxes),
            bboxes=bboxes,
            confidence_avg=conf_avg,
            inference_ms=inference_ms,
            frame_width=w,
            frame_height=h,
            model_version=self.model_path.rsplit("/", 1)[-1],
            track_ids=track_ids,
        )
