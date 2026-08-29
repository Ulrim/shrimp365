"""phase-1 스키마 확장(슬라이스 S0) — 4절 8개 테이블 + RLS + baseline 불변성.

생성: users, tanks, batches, feed_logs, mortality_logs, kpi_snapshots, baselines, api_keys.
- 전부 org_id 비정규화 + org 스코프 RLS 정책(0001 패턴 재사용, Postgres 전용).
- baselines 불변성(ADR 0002): BEFORE UPDATE/DELETE 트리거 + 부분 유니크(site_id) WHERE locked.
- harvest_logs.batch_id → batches.id FK 연결(기존 nullable 유지; Postgres 전용 ALTER).
sqlite(테스트/로컬 폴백): 트리거·부분유니크·ALTER FK 는 미지원이라 생략하고
격리/불변성은 서비스 레이어 가드로 대체(0001 폴백 관례 동일).
downgrade 는 모든 객체를 역순 제거한다.

Revision ID: 0002_phase1_schema
Revises: 0001_initial_schema
Create Date: 2026-07-03
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0002_phase1_schema"
down_revision: Union[str, None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# org 스코프 RLS 를 적용할 신규 테이블(전부 비정규화 org_id 보유).
_RLS_TABLES = (
    "users",
    "tanks",
    "batches",
    "feed_logs",
    "mortality_logs",
    "kpi_snapshots",
    "baselines",
    "api_keys",
)

# baseline 불변성 강제 객체 이름(ADR 0002).
_BASELINE_TRIGGER = "trg_baselines_immutable"
_BASELINE_TRIGGER_FN = "prevent_locked_baseline_change"
_BASELINE_LOCKED_UX = "ux_baselines_one_locked"
# harvest_logs → batches FK(0001 은 nullable plain 컬럼이었음).
_HARVEST_BATCH_FK = "fk_harvest_logs_batch_id"


def _is_postgres() -> bool:
    return op.get_bind().dialect.name in ("postgresql", "postgres")


def upgrade() -> None:
    json_type = sa.JSON().with_variant(JSONB(), "postgresql")

    # --- users ---
    op.create_table(
        "users",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "org_id",
            sa.String(64),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("role", sa.String(16), nullable=False, server_default="viewer"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("org_id", "email", name="ux_users_org_email"),
    )
    op.create_index("ix_users_org_id", "users", ["org_id"])

    # --- tanks ---
    op.create_table(
        "tanks",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "site_id",
            sa.String(64),
            sa.ForeignKey("sites.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "org_id",
            sa.String(64),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("volume_m3", sa.Float(), nullable=True),
        sa.Column("target_do_min", sa.Float(), nullable=True),
        sa.Column("target_do_max", sa.Float(), nullable=True),
    )
    op.create_index("ix_tanks_site_id", "tanks", ["site_id"])
    op.create_index("ix_tanks_org_id", "tanks", ["org_id"])

    # --- batches ---
    op.create_table(
        "batches",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "tank_id",
            sa.String(64),
            sa.ForeignKey("tanks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "org_id",
            sa.String(64),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("species", sa.String(64), nullable=False),
        sa.Column("stocked_count", sa.Integer(), nullable=False),
        sa.Column("stocked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_batches_tank_id", "batches", ["tank_id"])
    op.create_index("ix_batches_org_id", "batches", ["org_id"])

    # --- feed_logs ---
    op.create_table(
        "feed_logs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "batch_id",
            sa.String(64),
            sa.ForeignKey("batches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "org_id",
            sa.String(64),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("feed_kg", sa.Float(), nullable=False),
        sa.Column("source", sa.String(16), nullable=False, server_default="manual"),
        sa.Column("quality_flag", sa.String(16), nullable=False, server_default="ok"),
    )
    op.create_index("ix_feed_logs_batch_id", "feed_logs", ["batch_id"])
    op.create_index("ix_feed_logs_org_id", "feed_logs", ["org_id"])

    # --- mortality_logs ---
    op.create_table(
        "mortality_logs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "batch_id",
            sa.String(64),
            sa.ForeignKey("batches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "org_id",
            sa.String(64),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dead_count", sa.Integer(), nullable=False),
        sa.Column("cause_note", sa.Text(), nullable=True),
    )
    op.create_index("ix_mortality_logs_batch_id", "mortality_logs", ["batch_id"])
    op.create_index("ix_mortality_logs_org_id", "mortality_logs", ["org_id"])

    # --- kpi_snapshots (append-only; baselines FK 대상이므로 먼저 생성) ---
    op.create_table(
        "kpi_snapshots",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "site_id",
            sa.String(64),
            sa.ForeignKey("sites.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "tank_id",
            sa.String(64),
            sa.ForeignKey("tanks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "org_id",
            sa.String(64),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ei_total", sa.Float(), nullable=True),
        sa.Column("ei_aeration", sa.Float(), nullable=True),
        sa.Column("oei", sa.Float(), nullable=True),
        sa.Column("fcr", sa.Float(), nullable=True),
        sa.Column("mortality_rate", sa.Float(), nullable=True),
        sa.Column("config_version", sa.String(32), nullable=False),
        sa.Column("inputs_json", json_type, nullable=False),
        sa.Column("provenance_json", json_type, nullable=False),
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_kpi_snapshots_site_id", "kpi_snapshots", ["site_id"])
    op.create_index("ix_kpi_snapshots_org_id", "kpi_snapshots", ["org_id"])

    # --- baselines (잠금 후 불변; ADR 0002) ---
    op.create_table(
        "baselines",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "site_id",
            sa.String(64),
            sa.ForeignKey("sites.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "org_id",
            sa.String(64),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ei_total", sa.Float(), nullable=True),
        sa.Column("ei_aeration", sa.Float(), nullable=True),
        sa.Column("oei", sa.Float(), nullable=True),
        sa.Column("fcr", sa.Float(), nullable=True),
        sa.Column("mortality_rate", sa.Float(), nullable=True),
        sa.Column("config_version", sa.String(32), nullable=False),
        sa.Column(
            "kpi_snapshot_id",
            sa.String(64),
            sa.ForeignKey("kpi_snapshots.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("locked_by", sa.String(64), nullable=True),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'locked')", name="ck_baselines_status"
        ),
    )
    op.create_index("ix_baselines_site_id", "baselines", ["site_id"])
    op.create_index("ix_baselines_org_id", "baselines", ["org_id"])

    # --- api_keys (ingestion 인증; 원문 저장 금지) ---
    op.create_table(
        "api_keys",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "org_id",
            sa.String(64),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "site_id",
            sa.String(64),
            sa.ForeignKey("sites.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key_hash", sa.String(128), nullable=False, unique=True),
        sa.Column("label", sa.String(255), nullable=True),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_api_keys_org_id", "api_keys", ["org_id"])
    op.create_index("ix_api_keys_site_id", "api_keys", ["site_id"])

    # --- Postgres 전용: harvest_logs.batch_id FK, RLS, baseline 불변성 ---
    if _is_postgres():
        # harvest_logs.batch_id → batches.id (기존 nullable 유지; sqlite 는 ORM create_all 로 반영).
        op.create_foreign_key(
            _HARVEST_BATCH_FK,
            "harvest_logs",
            "batches",
            ["batch_id"],
            ["id"],
            ondelete="SET NULL",
        )
        _apply_rls()
        _apply_baseline_immutability()


def _apply_rls() -> None:
    """org 스코프 RLS 정책 적용(Postgres 전용; 0001 _apply_rls 와 동일 패턴)."""
    for table in _RLS_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY org_isolation_{table} ON {table}
            USING (org_id = current_setting('app.current_org_id', true))
            WITH CHECK (org_id = current_setting('app.current_org_id', true))
            """
        )


def _apply_baseline_immutability() -> None:
    """baseline 불변성 강제(ADR 0002, Postgres 전용).

    1) BEFORE UPDATE OR DELETE 트리거: OLD.status='locked' → RAISE EXCEPTION.
    2) 부분 유니크: 사이트당 활성 잠금 baseline 최대 1개(재잠금 방지).
    """
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION {_BASELINE_TRIGGER_FN}() RETURNS trigger AS $$
        BEGIN
            IF OLD.status = 'locked' THEN
                RAISE EXCEPTION
                    'baseline % is locked and immutable (ADR 0002)', OLD.id;
            END IF;
            IF TG_OP = 'DELETE' THEN
                RETURN OLD;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER {_BASELINE_TRIGGER}
        BEFORE UPDATE OR DELETE ON baselines
        FOR EACH ROW EXECUTE FUNCTION {_BASELINE_TRIGGER_FN}();
        """
    )
    op.execute(
        f"CREATE UNIQUE INDEX {_BASELINE_LOCKED_UX} ON baselines (site_id) "
        f"WHERE status = 'locked'"
    )


def downgrade() -> None:
    if _is_postgres():
        # baseline 불변성 객체 제거(역순).
        op.execute(f"DROP INDEX IF EXISTS {_BASELINE_LOCKED_UX}")
        op.execute(f"DROP TRIGGER IF EXISTS {_BASELINE_TRIGGER} ON baselines")
        op.execute(f"DROP FUNCTION IF EXISTS {_BASELINE_TRIGGER_FN}()")
        # RLS 정책 제거.
        for table in _RLS_TABLES:
            op.execute(f"DROP POLICY IF EXISTS org_isolation_{table} ON {table}")
            op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
        # harvest_logs FK 해제(0001 상태로 복원).
        op.drop_constraint(_HARVEST_BATCH_FK, "harvest_logs", type_="foreignkey")

    # 테이블 역순 제거(FK 의존 역순: api_keys → baselines → kpi_snapshots → ...).
    op.drop_index("ix_api_keys_site_id", table_name="api_keys")
    op.drop_index("ix_api_keys_org_id", table_name="api_keys")
    op.drop_table("api_keys")

    op.drop_index("ix_baselines_org_id", table_name="baselines")
    op.drop_index("ix_baselines_site_id", table_name="baselines")
    op.drop_table("baselines")

    op.drop_index("ix_kpi_snapshots_org_id", table_name="kpi_snapshots")
    op.drop_index("ix_kpi_snapshots_site_id", table_name="kpi_snapshots")
    op.drop_table("kpi_snapshots")

    op.drop_index("ix_mortality_logs_org_id", table_name="mortality_logs")
    op.drop_index("ix_mortality_logs_batch_id", table_name="mortality_logs")
    op.drop_table("mortality_logs")

    op.drop_index("ix_feed_logs_org_id", table_name="feed_logs")
    op.drop_index("ix_feed_logs_batch_id", table_name="feed_logs")
    op.drop_table("feed_logs")

    op.drop_index("ix_batches_org_id", table_name="batches")
    op.drop_index("ix_batches_tank_id", table_name="batches")
    op.drop_table("batches")

    op.drop_index("ix_tanks_org_id", table_name="tanks")
    op.drop_index("ix_tanks_site_id", table_name="tanks")
    op.drop_table("tanks")

    op.drop_index("ix_users_org_id", table_name="users")
    op.drop_table("users")
