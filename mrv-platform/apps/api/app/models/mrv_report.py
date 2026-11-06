"""mrv_reports — MRV 리포트(★Phase 3 헤드라인, phase-3.md 1.2절). append-only.

before_json/after_json 은 재계산하지 않고 1.4절 구조 그대로 영속화한다(baseline 과 동일
'재계산 금지' 정신, ADR 0002). boundary_json 은 자동 생성(자유 입력 아님, 1.6절).
수정/삭제 엔드포인트를 만들지 않는다(재생성이 필요하면 새 리포트 행을 추가) — 물리적
불변 트리거까지는 과설계(1.2절 근거: 리포트는 baseline 과 달리 다른 산출물의 입력이 아니라
최종 산출물이라 연쇄 오염 리스크가 낮다).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

# postgres 는 JSONB, 그 외(sqlite)는 JSON 으로 폴백(멀티백엔드 호환; 기존 패턴 재사용).
JsonType = JSON().with_variant(JSONB(), "postgresql")


class MrvReport(Base):
    __tablename__ = "mrv_reports"

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
    # "Before" 기준(잠긴 baseline, 불변).
    baseline_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("baselines.id", ondelete="RESTRICT"), nullable=False,
    )
    # "After" 기간(요청 파라미터).
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # 적용된 배출계수(고정 참조).
    emission_factor_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("emission_factors.id", ondelete="RESTRICT"), nullable=False,
    )
    # After 기간 스냅샷(생성 시 영속화, drill-down).
    after_kpi_snapshot_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("kpi_snapshots.id", ondelete="RESTRICT"), nullable=False,
    )
    # Before/After 요약(1.4절 구조). before는 baseline에서 그대로 복사(재계산 안 함).
    before_json: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    after_json: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    # 감축량. None=산출 불가(EI 중 하나라도 None).
    reduction_tco2e: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 산식 전문(실제 대입값 포함, MASTER 3.3 ③ "재현 가능").
    formula_text: Mapped[str] = mapped_column(Text, nullable=False)
    # 측정경계·가정(1.6절 — 자동 생성, 자유 입력 아님).
    boundary_json: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    # 생성된 PDF 파일 경로. 생성 직후 채움(폴백 시 HTML 경로일 수 있음).
    pdf_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # 생성자(JWT user_id).
    generated_by: Mapped[str] = mapped_column(String(64), nullable=False)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
