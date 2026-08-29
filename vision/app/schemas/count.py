"""Count schemas."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class CountLatestSchema(BaseModel):
    camera_id: uuid.UUID
    tank_id: uuid.UUID
    farm_id: uuid.UUID
    timestamp: datetime
    count: int
    confidence_avg: float | None = None


class CountBucketSchema(BaseModel):
    bucket: datetime
    camera_id: uuid.UUID
    tank_id: uuid.UUID
    farm_id: uuid.UUID
    avg_count: int
    max_count: int
    min_count: int
    sample_count: int
