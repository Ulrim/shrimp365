"""recipes/recipe_versions — 추천(운전 레시피) 영속화(phase-2 슬라이스 K, phase-2.md 2.1절).

- `recipes`: site당 type(feed|oxygen|circulation)별 최대 1행(유니크 (site_id, type)).
  org_id 비정규화(RLS 앵커, 기존 패턴).
- `recipe_versions`: append-only. baseline 과 달리 "버전이 늘어나는 것 자체가 정상 동작"
  (잠금 개념 없음, 매 추천 산출마다 새 버전). recipe_id FK 를 통해 org 스코프가 간접
  연결되므로 조회/쓰기는 반드시 recipe(및 site) 소유권을 먼저 검증한 뒤 접근해야 한다
  (서비스/라우터의 3중 방어, Rule 4) — 이는 그대로 유지되는 1차 방어선이다.

  QA phase-2 조건부승인 하드닝(갭2, 0007 마이그레이션): recipe_versions 를 id 로 직접
  조회하는 엔드포인트가 현재는 없어 org_id 부재가 실제 누수로 이어지지 않지만, 향후 그런
  엔드포인트가 생겼을 때를 대비해 `org_id`(부모 recipes.org_id 와 항상 동일, 삽입 시점에
  채움)를 비정규화하고 RLS 를 건다 — 기존 3중 방어를 대체하는 것이 아니라 2번째 방어선
  (RLS)을 recipe_versions 에도 추가하는 구조적 방어 강화다.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

# postgres 는 JSONB, 그 외(sqlite 테스트)는 JSON.
_JsonType = JSON().with_variant(JSONB(), "postgresql")


class Recipe(Base):
    __tablename__ = "recipes"
    __table_args__ = (
        CheckConstraint(
            "type IN ('feed', 'oxygen', 'circulation')", name="ck_recipes_type"
        ),
        UniqueConstraint("site_id", "type", name="uq_recipes_site_id_type"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    site_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # org_id 비정규화(RLS 앵커).
    org_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    # recipe_versions 가 가리키는 최신 버전 번호(0=버전 없음, 최초 산출 전).
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class RecipeVersion(Base):
    __tablename__ = "recipe_versions"
    __table_args__ = (
        UniqueConstraint("recipe_id", "version", name="uq_recipe_versions_recipe_version"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    recipe_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("recipes.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # org_id 비정규화(RLS 앵커, 부모 recipes.org_id 와 항상 동일 — 0007 마이그레이션, 갭2 하드닝).
    org_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    # 산출 파라미터(값 + source_refs, drill-down 근거 포함). append-only, 불변.
    params_json: Mapped[dict] = mapped_column(_JsonType, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
