"""온보딩 진행 상태 스키마 — phase-3.md 7.3절(파생 조회, 신규 상태 테이블 불필요)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

OnboardingStepName = Literal[
    "install_kit", "sensor_mapping", "baseline_locked", "plan_active"
]


class OnboardingStepStatus(BaseModel):
    done: bool
    detail: str


class OnboardingSteps(BaseModel):
    install_kit: OnboardingStepStatus
    sensor_mapping: OnboardingStepStatus
    baseline_locked: OnboardingStepStatus
    plan_active: OnboardingStepStatus


class OnboardingStatusResponse(BaseModel):
    steps: OnboardingSteps
    # 아직 끝나지 않은 첫 단계. 4단계 전부 완료면 None.
    current_step: OnboardingStepName | None
