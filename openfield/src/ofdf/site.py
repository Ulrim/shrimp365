"""현장 설정(화면 M6)과 농가 응답(화면 M2) — 화면이 쓰고 제어기가 읽는 상태.

제어기(``ofdf.cli edge``)와 화면 서버(``ofdf.cli serve``)는 서로 다른
프로세스다. 판단이 죽어도 화면은 살아서 '멈췄다'고 알려야 하기 때문이다.
그래서 둘은 **파일로만** 이야기한다.

    state/settings.json        화면에서 바꾼 설정값 (설정 파일 위에 덮인다)
    state/settings_log.jsonl   누가 언제 무엇을 바꿨는지
    state/approvals.jsonl      농가가 누른 승인·거부

제어기는 이 파일들을 읽기만 하고, 화면 서버는 쓰기만 한다. 제어기는 매
주기(5분) 처음에 다시 읽으므로 재시작 없이 다음 판단부터 반영된다.

화면에서 바꿀 수 있는 것은 **제어기의 동작을 실제로 바꾸는 값**뿐이다 —
권고모드 신뢰도 기준, 현장 즉응규칙(L1) 기준, 설치 구동부. 위험 판정
기준값(``configs/weather.yaml`` 의 ``thresholds``)은 모델을 학습할 때 정답을
만드는 기준이라, 화면에서 바꿔도 이미 학습된 모델의 판단은 달라지지 않는다.
바뀐 것처럼 보이는 숫자를 내보이지 않도록 그 값들은 읽기 전용으로만 보여 준다.
"""

from __future__ import annotations

import datetime
import json
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Any

from ofdf.action.recommend import (
    ALL_DEVICES,
    CONFIDENCE_THRESHOLD,
    DEFAULT_FIELD_RULES,
    FieldRules,
)

SETTINGS_FILE = "settings.json"
SETTINGS_LOG_FILE = "settings_log.jsonl"
APPROVALS_FILE = "approvals.jsonl"

#: 농가 응답의 유효시간. 저녁에 누른 '피복 승인'이 밤새 이어져야 하므로
#: 하룻밤을 덮는 길이로 잡는다. 지나면 다시 묻는다 — 어제의 승인이 오늘의
#: 다른 기상사례에 그대로 붙으면 안 된다.
RESPONSE_TTL_HOURS = 12

#: 응답 기록이 이 크기를 넘으면 유효한 것만 남기고 줄인다.
APPROVALS_MAX_BYTES = 256 * 1024

#: 화면에서 켜고 끄는 구동부. 차광막과 야간피복은 같은 권취 구동부를 쓰는
#: 묶음 명령('차광막·피복')이 따로 있어, 둘 중 하나라도 달리면 묶음도 달린
#: 것으로 본다.
SELECTABLE_DEVICES = ("관수밸브", "살수", "차광막", "야간피복")
SHARED_DRIVE = "차광막·피복"
#: 안전 차단(L0)에 쓰는 장치. 화면에서 끄지 못한다 — 설정 파일을 따른다.
SAFETY_DEVICES = frozenset({"전 구동부", "해당 구동부"})

#: 숫자 설정의 허용 범위 ``{이름: (최소, 최대, 단위, 설명)}``.
#:
#: 범위를 두는 이유 — 강풍 잠금을 60m/s 로 올리거나 신뢰도 기준을 0 으로
#: 내리면 안전규칙과 권고모드가 사실상 꺼진다. 화면에서 한 번 잘못 누른
#: 값이 그런 결과를 내지 않도록, 서버가 범위 밖의 값을 받지 않는다.
#:
#: 상한은 '규칙이 꺼진 것과 같은 값'보다 안쪽에 둔다. 흙 수분 상한 100% 는
#: 센서가 그 값을 내지 않으므로 관수 금지가 영영 걸리지 않는다. 사업계획서
#: 초기 기준(7·9·14m/s, 4m/s, 90%, 0.70)에서 한두 단계까지만 느슨하게 한다.
BOUNDS: dict[str, tuple[float, float, str, str]] = {
    "confidence_threshold": (0.60, 0.95, "",
                             "판단 신뢰도가 이 값 미만이면 자동 실행하지 않고 농가 승인을 받는다"),
    "wind_no_deploy": (3.0, 9.0, "m/s", "순간최대풍속이 이 값 이상이면 차광막·피복을 펴지 않는다"),
    "wind_recover": (5.0, 12.0, "m/s", "이 값 이상이면 차광막·피복을 즉시 걷는다"),
    "wind_lock": (8.0, 18.0, "m/s", "이 값 이상이면 구동부를 잠그고 경보를 낸다"),
    "spray_stop_wind": (1.0, 6.0, "m/s", "살수 중 이 풍속을 넘으면 살수를 멈춘다"),
    "soil_upper_limit": (50.0, 95.0, "%", "흙 수분이 이 값 이상이면 관수를 금지한다"),
}

RULE_KEYS = tuple(f.name for f in fields(FieldRules))


@dataclass
class SiteSettings:
    """제어기가 한 주기에 쓰는 현장 설정."""

    confidence_threshold: float = CONFIDENCE_THRESHOLD
    field_rules: FieldRules = DEFAULT_FIELD_RULES
    #: ``None`` 이면 전부 달린 것으로 본다(ofdf.action.recommend.decide 참조).
    installed_devices: frozenset[str] | None = None

    def values(self) -> dict[str, Any]:
        """화면이 보여 줄 모양 — 숫자 설정과 구동부 켬·끔."""
        installed = ALL_DEVICES if self.installed_devices is None else self.installed_devices
        return {
            "confidence_threshold": self.confidence_threshold,
            **asdict(self.field_rules),
            "installed_devices": [d for d in SELECTABLE_DEVICES if d in installed],
        }


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):     # 1e400 같은 정수도 온다
        return None
    return number if number == number and abs(number) != float("inf") else None


def base_settings(weather: dict | None, fusion: dict | None) -> SiteSettings:
    """설정 파일(``weather.yaml`` · ``fusion.yaml``)이 말하는 값.

    범위 밖이거나 숫자가 아닌 값은 버리고 코드 기본값을 쓴다 — 설정 파일의
    오타 하나로 안전규칙이 꺼지면 안 된다.
    """
    control = (fusion or {}).get("control") or {}
    rules_raw = control.get("field_rules") or {}

    def bounded(key: str, raw: Any, default: float) -> float:
        number = _number(raw)
        low, high = BOUNDS[key][:2]
        return number if number is not None and low <= number <= high else default

    rules = FieldRules(**{
        key: bounded(key, rules_raw.get(key), getattr(DEFAULT_FIELD_RULES, key))
        for key in RULE_KEYS
    })
    if not rules.wind_no_deploy < rules.wind_recover < rules.wind_lock:
        rules = DEFAULT_FIELD_RULES

    raw_devices = ((weather or {}).get("edge") or {}).get("installed_devices")
    installed = None
    if raw_devices is not None:
        names = raw_devices.split(",") if isinstance(raw_devices, str) else list(raw_devices)
        installed = frozenset(str(n).strip() for n in names if str(n).strip())

    return SiteSettings(
        confidence_threshold=bounded(
            "confidence_threshold", control.get("confidence_threshold"), CONFIDENCE_THRESHOLD),
        field_rules=rules,
        installed_devices=installed,
    )


def validate(payload: Any) -> tuple[dict[str, Any], list[str]]:
    """화면이 보낸 값을 검사한다. ``(받아들인 값, 오류 문구)``.

    오류가 하나라도 있으면 아무것도 저장하지 않는다. 절반만 반영된 설정은
    어느 값이 지금 도는지 아무도 모르게 만든다.
    """
    if not isinstance(payload, dict):
        return {}, ["설정값은 이름과 값의 묶음이어야 합니다"]

    clean: dict[str, Any] = {}
    errors: list[str] = []
    for key, raw in payload.items():
        if key == "installed_devices":
            if not isinstance(raw, list) or any(not isinstance(d, str) for d in raw):
                errors.append("설치 구동부는 장치 이름 목록이어야 합니다")
                continue
            unknown = [d for d in raw if d not in SELECTABLE_DEVICES]
            if unknown:
                errors.append(f"모르는 장치입니다: {', '.join(unknown)}")
                continue
            clean[key] = [d for d in SELECTABLE_DEVICES if d in raw]
        elif key in BOUNDS:
            number = _number(raw)
            low, high, unit, _ = BOUNDS[key]
            if number is None:
                errors.append(f"{key}: 숫자가 아닙니다")
            elif not low <= number <= high:
                errors.append(f"{key}: {low:g}~{high:g}{unit} 사이여야 합니다")
            else:
                clean[key] = round(number, 2)
        else:
            errors.append(f"화면에서 바꿀 수 없는 값입니다: {key}")
    return clean, errors


def _check_wind_order(rules: FieldRules) -> str | None:
    if rules.wind_no_deploy < rules.wind_recover < rules.wind_lock:
        return None
    return ("강풍 기준은 전개 금지 < 즉시 회수 < 구동 잠금 순서여야 합니다 "
            f"(지금 {rules.wind_no_deploy:g} / {rules.wind_recover:g} / {rules.wind_lock:g})")


def apply_overrides(base: SiteSettings, overrides: dict[str, Any]) -> SiteSettings:
    """설정 파일 값 위에 화면에서 바꾼 값을 덮는다. 검사를 통과한 값만 쓴다."""
    clean, _ = validate(overrides)
    rules = FieldRules(**{
        key: clean.get(key, getattr(base.field_rules, key)) for key in RULE_KEYS
    })
    if _check_wind_order(rules):
        rules = base.field_rules

    installed = base.installed_devices
    if "installed_devices" in clean:
        chosen = set(clean["installed_devices"])
        if chosen & {"차광막", "야간피복"}:
            chosen.add(SHARED_DRIVE)
        # 안전 차단은 화면이 건드리지 않는다. 설정 파일이 '전부 달렸다'(None)고
        # 했으면 안전 차단도 달린 것이다.
        safety = SAFETY_DEVICES if installed is None else installed & SAFETY_DEVICES
        installed = frozenset(chosen | safety)

    return SiteSettings(
        confidence_threshold=clean.get("confidence_threshold", base.confidence_threshold),
        field_rules=rules,
        installed_devices=installed,
    )


def read_overrides(state_dir: str | Path | None) -> dict[str, Any]:
    """화면에서 바꾼 값을 읽는다. 파일이 없거나 깨졌으면 빈 묶음."""
    if not state_dir:
        return {}
    path = Path(state_dir) / SETTINGS_FILE
    try:
        # 쓰다 끊겨 글자 중간에서 잘린 파일도 예외 없이 읽는다(errors="replace").
        # 이 함수는 제어기의 판단 주기 안에서 불린다 — 여기서 예외가 나면
        # 안전규칙까지 함께 멈춘다.
        data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError, RecursionError):
        return {}
    values = data.get("values") if isinstance(data, dict) else None
    return values if isinstance(values, dict) else {}


def effective_settings(base: SiteSettings, state_dir: str | Path | None) -> SiteSettings:
    """이번 주기에 쓸 설정 — 설정 파일 + 화면에서 바꾼 값."""
    overrides = read_overrides(state_dir)
    return apply_overrides(base, overrides) if overrides else base


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(text, encoding="utf-8")
    temp.replace(path)


def save_overrides(
    state_dir: str | Path, base: SiteSettings, payload: Any,
    *, now: datetime.datetime | None = None, source: str = "",
) -> tuple[SiteSettings | None, list[str]]:
    """화면에서 보낸 값을 저장한다. ``(반영된 설정, 오류 문구)``.

    보낸 값만 바꾸고 나머지는 그대로 둔다. 바뀐 항목은 이전 값과 함께
    ``settings_log.jsonl`` 에 남긴다 — 강풍 기준이 왜 달라졌는지 나중에
    물을 수 있어야 한다.
    """
    clean, errors = validate(payload)
    if errors:
        return None, errors

    state = Path(state_dir)
    current = read_overrides(state)
    merged = {**current, **clean}
    before = apply_overrides(base, current)
    rules = FieldRules(**{
        key: merged.get(key, getattr(base.field_rules, key)) for key in RULE_KEYS
    })
    problem = _check_wind_order(rules)
    if problem:
        return None, [problem]
    after = apply_overrides(base, merged)

    now = now or datetime.datetime.now()
    _atomic_write(state / SETTINGS_FILE, json.dumps(
        {"values": merged, "updated": now.isoformat(timespec="seconds")},
        ensure_ascii=False, indent=2))

    old, new = before.values(), after.values()
    changes = {k: {"from": old[k], "to": new[k]} for k in new if old[k] != new[k]}
    if changes:
        with (state / SETTINGS_LOG_FILE).open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(
                {"at": now.isoformat(timespec="seconds"), "source": source, "changes": changes},
                ensure_ascii=False) + "\n")
    return after, []


def reset_overrides(
    state_dir: str | Path, base: SiteSettings,
    *, now: datetime.datetime | None = None, source: str = "",
) -> SiteSettings:
    """화면에서 바꾼 값을 모두 지우고 설정 파일 값으로 돌아간다."""
    state = Path(state_dir)
    before = effective_settings(base, state)
    path = state / SETTINGS_FILE
    if path.exists():
        path.unlink()
    old, new = before.values(), base.values()
    changes = {k: {"from": old[k], "to": new[k]} for k in new if old[k] != new[k]}
    if changes:
        now = now or datetime.datetime.now()
        state.mkdir(parents=True, exist_ok=True)
        with (state / SETTINGS_LOG_FILE).open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(
                {"at": now.isoformat(timespec="seconds"), "source": source,
                 "changes": changes, "reset": True}, ensure_ascii=False) + "\n")
    return base


def settings_log(state_dir: str | Path | None, limit: int = 10) -> list[dict]:
    """최근 설정 변경 기록(새것부터)."""
    if not state_dir:
        return []
    return list(reversed(_read_jsonl(Path(state_dir) / SETTINGS_LOG_FILE)))[:limit]


def _read_jsonl(path: Path) -> list[dict]:
    try:
        # 조치 이름은 한글이라, 쓰다 끊기면 글자 중간에서 잘릴 수 있다.
        # 그 줄 하나 때문에 판단 주기가 멈추면 안 된다.
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    out = []
    for line in lines:
        try:
            item = json.loads(line)
        except (ValueError, RecursionError):
            continue                      # 쓰다 끊긴 줄은 건너뛴다
        if isinstance(item, dict):
            out.append(item)
    return out


# --------------------------------------------------------------------------
# 농가 응답 (승인·거부)
# --------------------------------------------------------------------------

RESPONSES = ("approve", "reject", "clear")


def active_responses(
    state_dir: str | Path | None, now: datetime.datetime | None = None,
) -> dict[str, dict]:
    """지금 유효한 농가 응답 ``{조치 이름: {"response", "at"}}``.

    같은 조치에 여러 번 눌렀으면 마지막 것이 이긴다. '취소'(clear)를
    누르면 응답이 없던 상태로 돌아가 다시 승인을 기다린다.
    """
    if not state_dir:
        return {}
    now = now or datetime.datetime.now()
    latest: dict[str, dict] = {}
    for item in _read_jsonl(Path(state_dir) / APPROVALS_FILE):
        action_id, response = item.get("id"), item.get("response")
        if isinstance(action_id, str) and response in RESPONSES:
            latest[action_id] = item

    out: dict[str, dict] = {}
    limit = datetime.timedelta(hours=RESPONSE_TTL_HOURS)
    for action_id, item in latest.items():
        if item["response"] == "clear":
            continue
        try:
            at = datetime.datetime.fromisoformat(str(item.get("at")))
        except ValueError:
            continue
        if at.tzinfo is not None:
            at = at.astimezone().replace(tzinfo=None)
        # 시계가 조금 앞서 적힌 것(5분)까지는 받는다. 그보다 먼 미래 시각은 시계가
        # 틀렸을 때 적힌 것이라 믿지 않는다 — 받으면 영영 만료되지 않는다.
        if -datetime.timedelta(minutes=5) <= now - at <= limit:
            out[action_id] = {"response": item["response"], "at": item["at"]}
    return out


def record_response(
    state_dir: str | Path, action_id: str, response: str,
    *, now: datetime.datetime | None = None,
) -> dict[str, dict]:
    """농가 응답을 적고, 지금 유효한 응답 전체를 돌려준다."""
    if response not in RESPONSES:
        raise ValueError(f"모르는 응답: {response}")
    if not action_id or len(action_id) > 200 or action_id.count("|") != 1:
        raise ValueError("조치 이름이 올바르지 않습니다")

    now = now or datetime.datetime.now()
    path = Path(state_dir) / APPROVALS_FILE
    path.parent.mkdir(parents=True, exist_ok=True)

    if path.exists() and path.stat().st_size > APPROVALS_MAX_BYTES:
        kept = active_responses(state_dir, now)
        _atomic_write(path, "".join(
            json.dumps({"id": k, **v}, ensure_ascii=False) + "\n" for k, v in kept.items()))

    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(
            {"id": action_id, "response": response, "at": now.isoformat(timespec="seconds")},
            ensure_ascii=False) + "\n")
    return active_responses(state_dir, now)
