"""Thin re-export of the canonical detector implementations.

The real detector code lives in `app.services.detector` (the Phase-0 stub
that used to live here has been retired so there is a single detector
interface). Import from there directly in new code:

    from app.services.detector import (
        BBox, DetectionResult, ShrimpDetector, SimulatedDetector, TankSimulation
    )

This module remains only for backwards compatibility with code/docs that
referenced `backend/ai/inference/detector.py`.
"""
from __future__ import annotations

from app.services.detector import (
    BBox,
    DetectionResult,
    ShrimpDetector,
    SimulatedDetector,
    TankSimulation,
)

__all__ = [
    "BBox",
    "DetectionResult",
    "ShrimpDetector",
    "SimulatedDetector",
    "TankSimulation",
]
