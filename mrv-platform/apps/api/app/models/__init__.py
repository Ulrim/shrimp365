"""ORM 모델 재노출 + Alembic metadata 등록.

Alembic env.py 는 `from app.models import Base` 로 전체 metadata 를 참조한다.
새 모델 추가 시 여기에 import 해 metadata 에 반드시 포함시킬 것.
"""

from __future__ import annotations

from app.db.base import Base
from app.models.alert import Alert
from app.models.api_key import ApiKey
from app.models.audit_log import AuditLog
from app.models.baseline import Baseline
from app.models.batch import Batch
from app.models.control_action import ControlAction
from app.models.emission_factor import EmissionFactor
from app.models.feed_log import FeedLog
from app.models.harvest_log import HarvestLog
from app.models.kpi_config import KpiConfig
from app.models.kpi_snapshot import KpiSnapshot
from app.models.meter import Meter
from app.models.mortality_log import MortalityLog
from app.models.mrv_report import MrvReport
from app.models.organization import Organization
from app.models.reading import Reading
from app.models.recipe import Recipe, RecipeVersion
from app.models.site import Site
from app.models.sop_checklist_run import SopChecklistRun
from app.models.tank import Tank
from app.models.user import User

__all__ = [
    "Base",
    "Organization",
    "Site",
    "Meter",
    "Reading",
    "HarvestLog",
    "KpiConfig",
    # --- Phase 1 (슬라이스 S0) ---
    "User",
    "Tank",
    "Batch",
    "FeedLog",
    "MortalityLog",
    "KpiSnapshot",
    "Baseline",
    "ApiKey",
    "AuditLog",
    # --- Phase 2 (슬라이스 H) ---
    "Alert",
    # --- Phase 2 (슬라이스 K) ---
    "Recipe",
    "RecipeVersion",
    # --- Phase 3 (슬라이스 M, MRV 리포트) ---
    "EmissionFactor",
    "MrvReport",
    # --- Phase 3 P1 (SOP 라이브러리) ---
    "SopChecklistRun",
    # --- Phase 3 P2 (승인형 제어 콘솔) ---
    "ControlAction",
]
