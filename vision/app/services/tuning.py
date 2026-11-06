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
    #: 1 cm 가 가로·세로로 각각 몇 픽셀인가. 먹이망 격자로 잰다.
    #: 가로·세로를 따로 두는 이유는 격자 칸이 정사각형이 아니고(8 × 7.5 cm),
    #: 카메라가 비스듬히 보면 두 축의 축척이 달라지기 때문이다.
    px_per_cm: tuple[float, float] | None = None

    def is_empty(self) -> bool:
        return self.roi is None and self.min_conf is None and self.px_per_cm is None


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

    scale = raw.get("px_per_cm")
    px = None
    if isinstance(scale, list) and len(scale) == 2:
        try:
            sx, sy = float(scale[0]), float(scale[1])
        except (TypeError, ValueError):
            sx = sy = 0.0
        # 0 이나 음수면 나눗셈이 터지거나 길이가 음수로 나온다. 터무니없이 큰
        # 값도 막는다 — 1 cm 가 1000픽셀이면 격자를 잘못 짚은 것이다.
        if 0.1 < sx < 1000 and 0.1 < sy < 1000:
            px = (sx, sy)
    return Tuning(roi=box, min_conf=conf, px_per_cm=px)


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
        if tuning.px_per_cm is not None:
            entry["px_per_cm"] = list(tuning.px_per_cm)
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


#: 먹이망 격자 한 칸의 실제 크기(cm). 현장에서 쓰는 망의 규격이다.
MESH_CELL_CM = (8.0, 7.5)


def scale_from_cells(
    box_px: tuple[float, float], cells: tuple[int, int],
    cell_cm: tuple[float, float] = MESH_CELL_CM,
) -> tuple[float, float] | None:
    """격자 몇 칸을 덮은 네모의 픽셀 크기로 1 cm 당 픽셀 수를 구한다.

    여러 칸을 한 번에 덮을수록 정확하다 — 한 칸만 짚으면 손가락 오차가
    그대로 축척 오차가 된다. 세 칸을 덮으면 오차가 1/3 로 준다.
    """
    w_px, h_px = box_px
    nx, ny = cells
    if nx < 1 or ny < 1 or w_px <= 0 or h_px <= 0:
        return None
    sx = w_px / (nx * cell_cm[0])
    sy = h_px / (ny * cell_cm[1])
    if not (0.1 < sx < 1000 and 0.1 < sy < 1000):
        return None
    return (round(sx, 4), round(sy, 4))


def body_length_cm(b: BBox, px_per_cm: tuple[float, float]) -> float:
    """상자 하나에서 몸길이를 추정한다(cm).

    모델은 네모 상자만 주고 **어느 쪽을 보고 누웠는지는 모른다.** 길이 L,
    두께 T 인 새우가 각도 θ 로 누우면 상자의 대각선은 이렇게 된다.

        대각선² = L² + T² + 4·L·T·|sinθ·cosθ|

        θ=0°  (수평)   → √(L²+T²) ≈ L      거의 정확
        θ=45° (비스듬) → L + T             두께만큼 과대 (새우는 약 +20%)

    그래서 대각선은 **L 이상 L+T 이하**다. 개별 마리는 최대 20% 과대평가되지만,
    여러 마리 평균에서는 각도가 섞여 치우침이 일정해진다. 날짜별 평균을 견주는
    **성장 추이**에 쓰는 값이지, 한 마리의 자를 대신하는 값이 아니다.

    가로·세로 축척이 다르므로 각 축을 따로 cm 로 바꾼 뒤 대각선을 잰다.
    """
    w_cm = abs(b.x2 - b.x1) / px_per_cm[0]
    h_cm = abs(b.y2 - b.y1) / px_per_cm[1]
    return round((w_cm**2 + h_cm**2) ** 0.5, 2)


def lengths_cm(result: DetectionResult, t: Tuning) -> list[float]:
    """이 프레임에서 잰 몸길이들. 축척이 없으면 빈 목록."""
    if t.px_per_cm is None:
        return []
    return [body_length_cm(b, t.px_per_cm) for b in result.bboxes]


def median(values: list[float]) -> float | None:
    """가운뎃값. 평균이 아니라 가운뎃값을 쓰는 이유는 **한 마리 때문이다.**

    두 마리가 겹쳐 한 상자로 잡히면 길이가 두 배로 나온다. 평균은 그 한 건에
    끌려가지만 가운뎃값은 거의 꿈쩍하지 않는다.
    """
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    mid = n // 2
    return round(s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2, 2)
