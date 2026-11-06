"""meters — 계측기(전력계 등). org_id 비정규화 보유.

sprint-0 2.5절: id, site_id, org_id, type, unit, sub_meter_of, is_aeration.
- is_aeration: 폭기(블로워) 서브미터 여부 → ei_aeration 분자 구분(2.5절 주석).
- unit: ADR 0001 규약(예: 'kWh_interval').
- tank_id: phase-2 4.1절 `GET /sites/{id}/readings?tank_id=&type=` 조회를 위해 추가
  (수조별 계측기 그룹핑; 예: 수조 1의 DO 계측기 여러 대). NULL 허용(수조 미소속 계측기,
  예: 사이트 전체 전력 메인 계측기). 마이그레이션 0004 에서 반영됨.
- label / certification_info: Phase 3 온보딩 슬라이스(phase-3.md 7.2절)에서 추가
  (마이그레이션 0011). label 은 사람이 읽는 계측기 이름(예: '서산 A동 메인 전력계').
  certification_info 는 MASTER 9장 규제훅(IoT/무선기기 KCC, 전기안전 KC 인증정보) "자리만"
  마련하는 선택 필드 — 이번 Phase 는 저장만 하고 검증/포맷 강제는 하지 않는다.
"""

from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

# postgres 는 JSONB, 그 외(sqlite)는 JSON 으로 폴백(멀티백엔드 호환; 기존 패턴 재사용).
_JsonType = JSON().with_variant(JSONB(), "postgresql")


class Meter(Base):
    __tablename__ = "meters"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    site_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # org_id 비정규화(RLS 를 조인 없이 적용; 2.3/2.5절 성능·격리).
    org_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # 계측기 유형(예: 'power'). 스프린트 0 은 전력계만.
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    # 저장 원단위(ADR 0001: 'kWh_interval').
    unit: Mapped[str] = mapped_column(String(32), nullable=False, default="kWh_interval")
    # 서브미터의 상위 계측기(main 아래 blower 등). nullable.
    sub_meter_of: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("meters.id", ondelete="SET NULL"), nullable=True,
    )
    # 폭기 서브미터 명시 플래그(EI aeration 분자 구분).
    is_aeration: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 소속 수조(phase-2 4.1절 tank_id+type 조회 근거). 선택(NULL=수조 미소속).
    tank_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("tanks.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    # 사람이 읽는 계측기 라벨(온보딩 화면16, phase-3.md 7.2절). 선택.
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 규제훅 "자리만"(MASTER 9장 — IoT/무선기기 KCC, 전기안전 KC 인증정보). 선택, 자유 JSON.
    certification_info: Mapped[dict | None] = mapped_column(_JsonType, nullable=True)
