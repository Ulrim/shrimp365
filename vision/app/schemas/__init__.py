"""Pydantic v2 schemas for the vision service API."""
from app.schemas.alert import AlertConfigCreateSchema, AlertConfigSchema
from app.schemas.camera import CameraCreate, CameraSchema, CameraStatusSchema, CameraUpdate
from app.schemas.count import CountBucketSchema, CountLatestSchema

__all__ = [
    "AlertConfigCreateSchema",
    "AlertConfigSchema",
    "CameraCreate",
    "CameraSchema",
    "CameraStatusSchema",
    "CameraUpdate",
    "CountBucketSchema",
    "CountLatestSchema",
]
