"""SQLAlchemy ORM models.

스키마의 원본은 이 파일이 아니라 shrimp365 의
`supabase/migrations/vision_monitoring.sql` 이다. 여기 있는 모델은 그 표를
읽고 쓰기 위한 매핑일 뿐이며, 테이블을 만들지 않는다(create_all 호출 없음).
`tanks`·`farms`·`alerts` 는 shrimp365 가 소유하는 표라 읽기 위주로만 매핑한다.
"""
from app.models.alert import AlertConfig, ShrimpAlert
from app.models.camera import Camera
from app.models.count_record import CountRecord
from app.models.tank import Farm, Tank
from app.models.water_quality import WaterQualityReading

__all__ = [
    "AlertConfig",
    "Camera",
    "CountRecord",
    "Farm",
    "ShrimpAlert",
    "Tank",
    "WaterQualityReading",
]
