"""pytest 픽스처 — SQLite 로 백엔드 통합 테스트.

TimescaleDB/RLS 특수기능은 SQLite 로 우회하고(2.5/B5절), 격리는 서비스 레이어
재검증(tenancy.py)으로 검증한다. 시드 데이터는 infra/seed 를 재사용해 DB→API 일관성을 보장.

환경변수는 app.config/get_settings 캐시가 생성되기 전에 설정해야 하므로
이 파일 상단(임포트 이전)에서 os.environ 을 세팅한다.
"""

from __future__ import annotations

import os
import sys
import tempfile
from datetime import timedelta
from pathlib import Path

import pytest

# --- 경로/환경 설정: app 임포트 이전에 수행 ---
_HERE = Path(__file__).resolve()
_API_ROOT = _HERE.parents[1]          # apps/api
_REPO_ROOT = _HERE.parents[3]         # repo root
sys.path.insert(0, str(_API_ROOT))
sys.path.insert(0, str(_REPO_ROOT / "packages" / "kpi"))
sys.path.insert(0, str(_REPO_ROOT / "infra" / "seed"))

_DB_FILE = Path(tempfile.gettempdir()) / "culiver_test.db"
if _DB_FILE.exists():
    _DB_FILE.unlink()
os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{_DB_FILE}"
os.environ["JWT_SECRET"] = "test-secret-key"
os.environ["JWT_ALGORITHM"] = "HS256"

import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.organization import Organization  # noqa: E402
from app.models.site import Site  # noqa: E402

import seed_demo_site as seed_mod  # noqa: E402

# 시드가 만드는 org1/site1 상수 재노출.
ORG1_ID = seed_mod.ORG_ID
SITE1_ID = seed_mod.SITE_ID
BATCH1_ID = seed_mod.BATCH_ID
STOCKED_COUNT = seed_mod.STOCKED_COUNT
PERIOD_START = seed_mod.PERIOD_START
HOURS = seed_mod.HOURS

# 별도 테넌트(격리 테스트용).
ORG2_ID = "org-OTHER-9999"
SITE2_ID = "site-9999"


@pytest.fixture(scope="session", autouse=True)
def _prepare_db():
    """스키마 생성 + 시드(org1/site1) + 별도 org2/site2 삽입."""
    Base.metadata.create_all(engine, checkfirst=True)
    with SessionLocal() as session:
        seed_mod.seed(session)
        # 격리 테스트용 두 번째 테넌트.
        session.add(Organization(id=ORG2_ID, name="타 법인", plan="START"))
        session.flush()
        session.add(Site(id=SITE2_ID, org_id=ORG2_ID, name="타 org 양식장"))
        session.commit()
    yield
    Base.metadata.drop_all(engine, checkfirst=True)


def _make_token(org_id: str, role: str = "admin", user_id: str = "u-1") -> str:
    settings = get_settings()
    return jwt.encode(
        {"org_id": org_id, "role": role, "user_id": user_id},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def org1_token() -> str:
    return _make_token(ORG1_ID)


@pytest.fixture
def org2_token() -> str:
    return _make_token(ORG2_ID)


@pytest.fixture
def owner_token() -> str:
    """org1 owner(쓰기 권한)."""
    return _make_token(ORG1_ID, role="owner")


@pytest.fixture
def operator_token() -> str:
    """org1 operator(쓰기 권한)."""
    return _make_token(ORG1_ID, role="operator")


@pytest.fixture
def viewer_token() -> str:
    """org1 viewer(읽기 전용; 쓰기 403)."""
    return _make_token(ORG1_ID, role="viewer")


@pytest.fixture
def full_period() -> dict:
    """시드 전체 기간을 포함하는 [from, to). biomass_delta=2560."""
    frm = PERIOD_START
    to = PERIOD_START + timedelta(hours=HOURS)
    return {"from": frm.isoformat(), "to": to.isoformat()}


@pytest.fixture
def short_period() -> dict:
    """개시 harvest 만 포함 → biomass_delta=0 → EI 산출 불가(null)."""
    frm = PERIOD_START
    to = PERIOD_START + timedelta(hours=100)
    return {"from": frm.isoformat(), "to": to.isoformat()}
