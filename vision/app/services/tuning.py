"""카메라마다 따로 두는 보정값 — 관심영역과 최소 신뢰도.

왜 있나
-------
모델은 클래스가 "새우" 하나뿐이라, 무언가를 찾으면 무조건 새우라고 부른다.
수조 바깥(철망·배관·호스·수면 반사)이 화면에 들어오면 그것까지 센다. 실험실
설정에서 철망 격자와 종이 모서리를 새우로 잡는 것을 실제로 보았다.

재학습이 제일 확실하지만 현장 사진이 쌓여야 한다. 그 전에 쓸 수 있는 것이
둘이다.

  관심영역  수조 안쪽만 센다. 카메라가 고정되어 있으므로 한 번만 그으면 된다.
  최소 신뢰도  약한 탐지를 버린다. 모델의 기본값(0.30)보다 **올리는 쪽으로만**
            쓴다 — 탐지가 끝난 결과에서 거르는 것이라 없던 것을 되살릴 수는 없다.

왜 DB 가 아니라 파일인가
------------------------
이 값은 그 보드에 달린 카메라의 성질이다(렌즈가 어디를 보는가). 서버에 둘
이유가 없고, 두려면 Supabase 에 열을 더해야 해서 사람이 SQL 을 돌려야 한다.
설치에서 사람 손을 빼는 것이 이 장비의 방향이라 파일로 둔다. 기기 키 옆에
두므로 재부팅을 넘기고, 서버에서 카메라 정보를 받아 와도 지워지지 않는다.
"""
from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from pathlib import Path

from app.config import settings
from app.services.detector import BBox, DetectionResult

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Tuning:
    """한 카메라의 보정값. 둘 다 없으면 아무것도 거르지 않는다."""

    #: 셀 수 있는 영역. 화면 크기에 대한 비율(0~1)이라 해상도를 바꿔도 그대로다.
    roi: tuple[float, float, float, float] | None = None
    #: 이 값보다 약한 탐지는 버린다. None 이면 모델 기본값을 그대로 쓴다.
    min_conf: float | None = None

    def is_empty(self) -> bool:
        return self.roi is None and self.min_conf is None


def _path() -> Path:
    return Path(settings.device_state_path).with_name("tuning.json")


def _read_all() -> dict:
    try:
        return json.loads(_path().read_text())
    except (OSError, ValueError):
        return {}


def get(camera_id: uuid.UUID | str) -> Tuning:
    raw = _read_all().get(str(camera_id))
    if not isinstance(raw, dict):
        return Tuning()
    roi = raw.get("roi")
    box = None
    if isinstance(roi, list) and len(roi) == 4:
        try:
            x1, y1, x2, y2 = (float(v) for v in roi)
        except (TypeError, ValueError):
            x1 = y1 = x2 = y2 = 0.0
        # 뒤집혀 들어와도 받아 준다 — 화면에서 오른쪽→왼쪽으로 그으면 그렇게 된다.
        lo_x, hi_x = min(x1, x2), max(x1, x2)
        lo_y, hi_y = min(y1, y2), max(y1, y2)
        if hi_x - lo_x > 0.01 and hi_y - lo_y > 0.01:
            box = (max(0.0, lo_x), max(0.0, lo_y), min(1.0, hi_x), min(1.0, hi_y))
    conf = raw.get("min_conf")
    try:
        conf = float(conf) if conf is not None else None
    except (TypeError, ValueError):
        conf = None
    if conf is not None and not (0.0 < conf < 1.0):
        conf = None
    return Tuning(roi=box, min_conf=conf)


def save(camera_id: uuid.UUID | str, tuning: Tuning) -> bool:
    data = _read_all()
    key = str(camera_id)
    if tuning.is_empty():
        data.pop(key, None)
    else:
        entry: dict = {}
        if tuning.roi is not None:
            entry["roi"] = list(tuning.roi)
        if tuning.min_conf is not None:
            entry["min_conf"] = tuning.min_conf
        data[key] = entry
    try:
        _path().write_text(json.dumps(data, indent=1))
    except OSError as exc:
        # 못 적어도 측정은 계속된다. 다음 재시작 때 옛 값으로 돌아갈 뿐이다.
        logger.warning("보정값을 저장하지 못했습니다: %s", exc)
        return False
    return True


def apply(result: DetectionResult, tuning: Tuning) -> DetectionResult:
    """보정값으로 탐지 결과를 거른다.

    **거르기만 한다.** 모델이 못 본 것을 만들어 내지 않으므로, 최소 신뢰도는
    모델 기본값보다 올리는 쪽으로만 효과가 있다.

    관심영역 판정은 **상자의 가운데**로 한다. 겹침으로 하면 수조 테두리에 걸친
    새우가 들어왔다 나갔다 하며 개체수가 흔들린다.
    """
    if tuning.is_empty() or not result.bboxes:
        return result

    w = result.frame_width or 1
    h = result.frame_height or 1
    roi = tuning.roi
    keep: list[int] = []
    for i, b in enumerate(result.bboxes):
        if tuning.min_conf is not None and b.confidence < tuning.min_conf:
            continue
        if roi is not None:
            cx = (b.x1 + b.x2) / 2 / w
            cy = (b.y1 + b.y2) / 2 / h
            if not (roi[0] <= cx <= roi[2] and roi[1] <= cy <= roi[3]):
                continue
        keep.append(i)

    if len(keep) == len(result.bboxes):
        return result

    boxes: list[BBox] = [result.bboxes[i] for i in keep]
    conf_avg = round(sum(b.confidence for b in boxes) / len(boxes), 3) if boxes else 0.0
    tracks = None
    if result.track_ids is not None and len(result.track_ids) == len(result.bboxes):
        tracks = [result.track_ids[i] for i in keep]

    # count 는 상자 수를 다시 센다. 추적기가 준 수를 그대로 두면 거른 것까지
    # 세어, 화면의 상자 수와 개체수가 어긋난다.
    return DetectionResult(
        count=len(boxes),
        bboxes=boxes,
        confidence_avg=conf_avg,
        inference_ms=result.inference_ms,
        frame_width=result.frame_width,
        frame_height=result.frame_height,
        model_version=result.model_version,
        track_ids=tracks,
    )
