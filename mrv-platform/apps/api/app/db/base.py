"""SQLAlchemy 2.0 Declarative Base.

모든 ORM 모델은 이 Base 를 상속한다. Alembic autogenerate 가 이 metadata 를 참조한다.
"""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """공용 declarative base (SQLAlchemy 2.0 스타일)."""

    pass
