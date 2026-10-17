"""판단 결과 서버 업로더 — Shrimp365/Farm365 ``POST /api/field/device/judgements``.

원본 OFDF 엣지는 판단을 ``logs/journal.jsonl`` 과 ``dashboard/data.json`` 에
**기록만** 했다. 이 모듈이 그 판단을 Farm365 서버로 올려 노지 베드의
"재해위험" 카드에 띄운다. 계약은 ``docs/plans/openfield-merge.md`` 4-2 절이고,
서버 쪽 라우트도 같은 문서로 만들어지므로 **JSON 필드명을 바꾸면 안 된다.**

설계 원칙:

- 환경변수 ``OFDF_UPLOAD_URL`` 과 ``OFDF_DEVICE_KEY_FILE`` 둘 중 하나라도 없으면
  **완전히 비활성**이다. 기존 오프라인 동작(기록만)이 그대로 유지된다.
- 판단은 먼저 로컬 큐(``logs/upload_queue.jsonl``)에 적고, 그 다음 보낸다.
  통신이 끊겨도 판단은 계속 쌓이고, 복구되면 시간순으로 올라간다. 큐는 7일치가
  상한이다 — 큐 안의 가장 새 판단보다 7일 넘게 오래된 건은 버린다
  (5분 주기 × 10건 × 7일 ≈ 2만 건).
- 한 요청에 최대 200건. 멱등은 서버가 ``(device_id, ts, risk, horizon_h)``
  유니크로 보장하므로 같은 건을 다시 보내도 안전하다. 그래서 전송 실패 시
  그냥 다음 주기에 다시 보낸다(지수 백오프 없음 — 5분 주기면 충분하다).
- 시각은 OFDF 가 시간대 없는 로컬(KST)로 적는다. 여기서 ``Asia/Seoul`` 을
  붙여 ISO 8601(+09:00)로 보낸다. 서버는 timestamptz 다.
- 의존성은 ``requests`` 하나(이미 있다). ``zoneinfo`` 는 표준 라이브러리.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests

LOG = logging.getLogger("ofdf.upload")

ENV_URL = "OFDF_UPLOAD_URL"
ENV_KEY_FILE = "OFDF_DEVICE_KEY_FILE"
HEADER_KEY = "X-Device-Key"

#: 한 요청에 담는 최대 판단 건수 (서버 계약 4-2: 최대 200건, 시간순)
BATCH_SIZE = 200
#: 로컬 큐 보존 기간
QUEUE_MAX_AGE = dt.timedelta(days=7)
#: HTTP 타임아웃(초). 5분 주기 안에서 한 번 막혀도 다음 판단을 늦추지 않게 짧게.
TIMEOUT_SECONDS = 15

TZ = ZoneInfo("Asia/Seoul")

#: 계약이 허용하는 열거값. 어긋나는 건은 큐에 넣기 전에 걸러 422 를 미리 막는다.
RISKS = ("heat_dry", "rain_wet", "disease", "frost", "compound")
HORIZONS = (1, 3)
#: ``environment`` 에 들어가는 숫자 키 9개 — 그 외는 서버가 버린다
ENVIRONMENT_KEYS = (
    "t_air", "canopy_temp", "rh", "leaf_wetness", "solar_w",
    "rain", "soil_moisture", "soil_index", "wind_speed",
)
#: 판단근거 최대 개수
MAX_EVIDENCE = 5

#: 판단근거 피처의 한국어 이름. 웹 카드가 ``evidence[0].label`` 을 한 줄로
#: 보여 주므로 농가가 읽을 수 있는 말이어야 한다. 없는 피처는 이름 그대로.
FEATURE_LABELS_KO = {
    "t_air": "기온", "canopy_temp": "초관부 온도", "rh": "상대습도",
    "leaf_wetness": "엽면습윤", "solar_w": "일사", "solar": "일사",
    "rain": "시간 강수", "soil_moisture": "토양수분", "soil_index": "토양수분 지수",
    "wind_speed": "풍속", "dew_point": "이슬점", "vpd": "증기압차",
    "cloud_cover": "운량", "et0": "기준 증발산", "wet_hours": "엽면습윤 지속",
    "tmin_forecast": "예보 최저기온", "hour": "시각", "doy": "날짜",
}


# ---------------------------------------------------------------------------
# 시각
# ---------------------------------------------------------------------------

def to_iso(value: Any) -> str | None:
    """시간대 없는 로컬 시각에 ``Asia/Seoul`` 을 붙여 ISO 8601 로 만든다.

    이미 시간대가 있으면 서울로 환산만 한다. 문자열·``datetime``·
    ``pandas.Timestamp`` 를 받는다. 못 읽으면 ``None``.
    """
    if value is None:
        return None
    if hasattr(value, "to_pydatetime"):          # pandas.Timestamp
        value = value.to_pydatetime()
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            value = dt.datetime.fromisoformat(text)
        except ValueError:
            return None
    if not isinstance(value, dt.datetime):
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=TZ)
    else:
        value = value.astimezone(TZ)
    return value.isoformat(timespec="seconds")


def _parse_iso(text: str) -> dt.datetime | None:
    try:
        parsed = dt.datetime.fromisoformat(text)
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=TZ)


# ---------------------------------------------------------------------------
# 판단 레코드 만들기
# ---------------------------------------------------------------------------

def feature_label(name: str) -> str:
    """피처 이름을 농가 말로. ``t_air_min_6h`` 처럼 접미사가 붙은 것도 앞부분으로."""
    if name in FEATURE_LABELS_KO:
        return FEATURE_LABELS_KO[name]
    for key in sorted(FEATURE_LABELS_KO, key=len, reverse=True):
        if name.startswith(key + "_"):
            return f"{FEATURE_LABELS_KO[key]}({name[len(key) + 1:]})"
    return name


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:                           # NaN
        return None
    return number


def environment_from(row: Mapping[str, Any] | None) -> dict[str, float]:
    """관측 마지막 행에서 계약의 숫자 키 9개만 뽑는다. NaN·없는 키는 뺀다."""
    out: dict[str, float] = {}
    if row is None:
        return out
    for key in ENVIRONMENT_KEYS:
        try:
            raw = row[key] if key in row else None
        except (TypeError, KeyError):
            raw = None
        number = _number(raw)
        if number is not None:
            out[key] = round(number, 3)
    return out


def actions_from(decision) -> list[dict[str, Any]]:
    """:class:`ofdf.action.recommend.Decision` 의 조치를 계약 모양으로.

    ``executed`` 는 '거부되지 않았고 권고도 아닌 것' — 원본 ``data.json`` 과 같은
    기준이다. ``rejected_by`` 는 빈 문자열 대신 ``null`` 로 보낸다.
    """
    if decision is None:
        return []
    out = []
    for action in getattr(decision, "actions", []):
        rejected = getattr(action, "rejected_by", "") or None
        advisory = bool(getattr(action, "advisory", False))
        out.append({
            "device": action.device,
            "command": action.command,
            "layer": int(action.layer),
            "reason": action.reason,
            "executed": rejected is None and not advisory,
            "rejected_by": rejected,
            "advisory": advisory,
        })
    return out


def _evidence(items: Iterable[Any]) -> list[dict[str, Any]]:
    out = []
    for item in list(items)[:MAX_EVIDENCE]:
        if hasattr(item, "__dataclass_fields__"):
            item = {k: getattr(item, k) for k in item.__dataclass_fields__}
        feature = str(item.get("feature", ""))
        out.append({
            "feature": feature,
            "label": feature_label(feature),
            "value": _number(item.get("value")),
            "contribution": _number(item.get("contribution")),
        })
    return out


def build_judgements(
    now: Any,
    by_horizon: Mapping[int, tuple[Mapping[str, int], Mapping[str, float], Mapping[str, list]]],
    *,
    model_version: str,
    level_names: Mapping[int, str],
    environment: Mapping[str, Any] | None = None,
    decision=None,
    expected_onset: Callable[[str], Any] | None = None,
) -> list[dict[str, Any]]:
    """한 주기의 판단을 계약 4-2 의 ``judgements`` 배열로 만든다.

    ``by_horizon`` 은 :func:`ofdf.cli.judge_all` 의 결과(``{시계: (등급, 신뢰도,
    판단근거)}``)다. **등급 0(정상)도 보낸다** — 저널은 주의 이상만 남기지만
    웹 카드는 위험 5종 × 1·3시간 격자를 그리므로 '정상'이라는 사실도 자료다.
    서버가 받으면 기기가 살아 있다는 뜻이기도 하다.
    """
    ts = to_iso(now)
    if ts is None:
        return []
    env = environment_from(environment)
    actions = actions_from(decision)
    out: list[dict[str, Any]] = []
    for horizon in sorted(by_horizon):
        if int(horizon) not in HORIZONS:
            continue
        levels, confidences, evidence = by_horizon[horizon]
        for risk, level in levels.items():
            if risk not in RISKS:
                continue
            level = int(level)
            level = max(0, min(3, level))
            out.append({
                "ts": ts,
                "risk": risk,
                "horizon_h": int(horizon),
                "level": level,
                "level_name": level_names.get(level, str(level)),
                "confidence": round(float(confidences.get(risk, 1.0)), 4),
                "model_version": model_version,
                "expected_onset": to_iso(expected_onset(risk)) if expected_onset else None,
                "evidence": _evidence(evidence.get(risk, [])),
                "actions": actions,
                "environment": env,
            })
    return out


# ---------------------------------------------------------------------------
# 업로더
# ---------------------------------------------------------------------------

def _default_post(url: str, *, json: Any, headers: Mapping[str, str], timeout: float):
    return requests.post(url, json=json, headers=headers, timeout=timeout)


@dataclass
class UploadResult:
    """한 번의 전송 시도 결과."""

    sent: int = 0            # 이번에 서버가 받아 준 건수
    pending: int = 0         # 아직 큐에 남은 건수
    dropped: int = 0         # 7일 상한·서버 거부로 버린 건수
    error: str | None = None


@dataclass
class Uploader:
    """판단을 큐에 쌓고 서버로 보낸다. :meth:`from_env` 로 만든다."""

    url: str
    key_file: Path
    queue_path: Path
    agent_version: str = "ofdf"
    batch_size: int = BATCH_SIZE
    max_age: dt.timedelta = QUEUE_MAX_AGE
    timeout: float = TIMEOUT_SECONDS
    post: Callable[..., Any] = field(default=_default_post, repr=False)

    last_success: dt.datetime | None = field(default=None, init=False)
    last_error: str | None = field(default=None, init=False)
    pending: int = field(default=0, init=False)

    @classmethod
    def from_env(
        cls, queue_path: str | Path, *, agent_version: str = "ofdf",
        environ: Mapping[str, str] | None = None, **kwargs,
    ) -> Uploader | None:
        """환경변수 둘이 다 있을 때만 업로더를 만든다. 아니면 ``None`` (비활성)."""
        env = os.environ if environ is None else environ
        url = (env.get(ENV_URL) or "").strip()
        key_file = (env.get(ENV_KEY_FILE) or "").strip()
        if not url or not key_file:
            return None
        return cls(url=url, key_file=Path(key_file), queue_path=Path(queue_path),
                   agent_version=agent_version, **kwargs)

    # -- 키 -------------------------------------------------------------

    def read_key(self) -> str | None:
        """기기 키 파일을 읽는다. 없거나 비어 있으면 ``None`` — 큐만 쌓고 보내지 않는다."""
        try:
            key = self.key_file.read_text(encoding="utf-8").strip()
        except OSError:
            return None
        return key or None

    # -- 큐 -------------------------------------------------------------

    def enqueue(self, judgements: Iterable[Mapping[str, Any]]) -> int:
        """판단을 큐 파일 끝에 한 줄씩 적는다. 돌려주는 값은 적은 건수."""
        items = [dict(j) for j in judgements]
        if not items:
            return 0
        self.queue_path.parent.mkdir(parents=True, exist_ok=True)
        with self.queue_path.open("a", encoding="utf-8") as handle:
            for item in items:
                handle.write(json.dumps(item, ensure_ascii=False) + "\n")
        self.pending += len(items)
        return len(items)

    def _load_queue(self) -> tuple[list[dict[str, Any]], int]:
        """큐를 읽는다. 깨진 줄은 건너뛰고 **가장 새 판단보다** 7일 넘게 오래된 건은 버린다.

        벽시계가 아니라 큐 안의 최신 ``ts`` 기준이다. 엣지의 '지금'은 관측 자료의
        마지막 시각이라(``run_once`` 의 ``now``), 모사 자료 재생이나 시계가 틀어진
        제어기에서는 벽시계와 며칠씩 어긋날 수 있다. 벽시계 기준이면 그런 판단은
        큐에 들어오는 즉시 '오래됐다'며 버려져 한 건도 올라가지 않는다.
        """
        if not self.queue_path.exists():
            return [], 0
        parsed: list[tuple[dt.datetime, dict[str, Any]]] = []
        dropped = 0
        for line in self.queue_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                dropped += 1
                continue
            when = _parse_iso(str(item.get("ts", "")))
            if when is None:
                dropped += 1
                continue
            parsed.append((when, item))
        if not parsed:
            return [], dropped
        cutoff = max(when for when, _ in parsed) - self.max_age
        kept = [item for when, item in parsed if when >= cutoff]
        dropped += len(parsed) - len(kept)
        return kept, dropped

    def _save_queue(self, items: list[dict[str, Any]]) -> None:
        """남은 건으로 큐를 통째로 다시 쓴다(임시파일 경유 — 쓰다 죽어도 큐가 깨지지 않게)."""
        self.queue_path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.queue_path.with_suffix(self.queue_path.suffix + ".tmp")
        with temp.open("w", encoding="utf-8") as handle:
            for item in items:
                handle.write(json.dumps(item, ensure_ascii=False) + "\n")
        temp.replace(self.queue_path)
        self.pending = len(items)

    # -- 전송 -----------------------------------------------------------

    def flush(self, now: dt.datetime | None = None) -> UploadResult:
        """큐를 200건씩 시간순으로 보낸다.

        - 2xx: 그 배치를 큐에서 지운다.
        - 401·403·408·429, 5xx, 연결 오류: 큐에 남기고 **이번 주기는 여기서 멈춘다**
          (다음 주기에 같은 순서로 다시 시도. 멱등이라 중복 전송은 무해하다).
        - 그 외 4xx(422 등): 자료가 서버 계약에 안 맞는다는 뜻이라 다시 보내도
          똑같이 거부된다. 그 배치를 버리고 응답 본문을 로그에 남긴다 — 한 건이
          큐 머리에서 영원히 막는 것보다 낫다.
        """
        now = now or dt.datetime.now(TZ)
        items, dropped = self._load_queue()
        result = UploadResult(pending=len(items), dropped=dropped)
        if not items:
            if dropped:
                self._save_queue(items)          # 버린 줄을 파일에서도 지운다
            self.pending = 0
            return result

        key = self.read_key()
        if key is None:
            self.last_error = f"기기 키 파일을 읽지 못했다: {self.key_file}"
            result.error = self.last_error
            self._save_queue(items)
            return result

        headers = {HEADER_KEY: key, "Content-Type": "application/json"}
        items.sort(key=lambda j: str(j.get("ts", "")))
        index = 0
        while index < len(items):
            batch = items[index:index + self.batch_size]
            payload = {"agent_version": self.agent_version, "judgements": batch}
            try:
                response = self.post(self.url, json=payload, headers=headers,
                                     timeout=self.timeout)
            except requests.RequestException as exc:
                self.last_error = f"연결 실패: {exc.__class__.__name__}"
                result.error = self.last_error
                break
            status = int(getattr(response, "status_code", 0))
            if 200 <= status < 300:
                result.sent += len(batch)
                index += len(batch)
                self.last_success = now
                self.last_error = None
                continue
            body = _body_text(response)
            if status in (401, 403, 408, 429) or status >= 500 or status == 0:
                self.last_error = f"HTTP {status}"
                result.error = self.last_error
                LOG.warning("업로드 실패 HTTP %s — 다음 주기에 재시도 (%s)", status, body)
                break
            # 그 밖의 4xx: 서버가 이 자료를 받지 않는다. 버린다.
            LOG.error("서버가 판단 %d건을 거부했다(HTTP %s): %s", len(batch), status, body)
            result.dropped += len(batch)
            index += len(batch)
            self.last_error = f"HTTP {status}"
            result.error = self.last_error

        remaining = items[index:]
        self._save_queue(remaining)
        result.pending = len(remaining)
        return result

    # -- 화면용 ---------------------------------------------------------

    def status(self, now: dt.datetime | None = None) -> str:
        """키오스크 바닥줄용 한 줄. 예: ``업로드 3분 전 · 대기 0건``."""
        now = now or dt.datetime.now(TZ)
        if self.last_success is not None:
            minutes = max(0, int((now - self.last_success).total_seconds() // 60))
            head = f"업로드 {minutes}분 전"
        else:
            head = "업로드 기록 없음"
        if self.last_error:
            head += f" · 실패({self.last_error})"
        return f"{head} · 대기 {self.pending}건"


def _body_text(response) -> str:
    try:
        text = response.text
    except Exception:                                  # noqa: BLE001
        return ""
    text = (text or "").strip().replace("\n", " ")
    return text[:300]


#: 업로더가 꺼져 있을 때 ``data.json`` 에 적는 값
STATUS_DISABLED = "미연동"
