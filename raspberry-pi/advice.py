"""설비 운전 권고 — 수질 판정을 "지금 무엇을 돌릴까"로 옮긴다.

값과 경보만으로는 현장에서 한 번 더 생각해야 한다. "용존산소 3.1" 과 "산소공급기를
지금 최대로" 사이에는 사람의 판단이 들어가고, 새벽 세 시에 그 판단을 제대로 하기는
어렵다. 그래서 장비가 한 줄로 답한다.

**자동제어는 하지 않는다.** 릴레이를 직접 당기는 것은 후속 단계이고, 지금은 운전
필요성을 표시하는 데까지다. 설비를 잘못 돌리는 쪽이 늦게 돌리는 쪽보다 나쁠 수
있고(히터 오동작·펌프 공회전), 현장 설비 구성이 농가마다 다르기 때문이다.

권고는 두 갈래에서 나온다.
  · **지금 값** — 임계값을 이미 넘었다. 즉시성이 중요해 매 측정마다 본다.
  · **움직임**(anomaly.py) — 아직 안 넘었지만 가고 있다. 몇 분 늦어도 된다.

에너지 절감도 같은 자리에서 다룬다. 용존산소가 충분한데 폭기를 계속 돌리는 것은
전력만 쓰는 일이라, 그 상태가 **지속될 때** 출력을 낮추라고 말한다. 한 번 높게
찍혔다고 폭기를 줄이게 하면 그 조언 한 번이 수조 하나를 잃게 할 수 있다.

문장은 여기서 만들지 않는다 — 화면이 4개 국어를 쓰므로 코드만 돌려주고 번역은
webui.py 의 I18N 이 맡는다.
"""

from __future__ import annotations

from limits import BANDS

# 과잉 폭기로 보는 선. 28 ℃ 해수의 포화 용존산소가 약 7 ㎎/L 이라, 8 을 넘어
# 계속 머무르면 폭기가 필요 이상으로 돌고 있다고 본다. 포화도(%)를 읽는 센서면
# 그쪽이 더 정확하므로 그것을 먼저 쓴다.
SURPLUS_DO = 8.0
SURPLUS_SATURATION = 110.0
# "지속" 의 길이. 이보다 짧으면 한낮 광합성으로 잠깐 오른 것일 수 있다.
SURPLUS_MIN_MINUTES = 60
# 지속 판단에 쓸 최소 표본. 측정 주기가 길면 한두 점으로 "지속" 을 말할 수 없다.
SURPLUS_MIN_SAMPLES = 10


def _num(values: dict, key: str):
    v = values.get(key)
    return float(v) if isinstance(v, (int, float)) and v != 0 else None


def _find(anomalies: list[dict], field: str, *kinds: str):
    for a in anomalies:
        if a.get("parameter") == field and (not kinds or a.get("kind") in kinds):
            return a
    return None


def _sustained_surplus(rows: list[dict] | None) -> bool:
    """최근 한 시간 내내 용존산소가 남아돌았는가."""
    if not rows:
        return False
    last_t = max((r.get("t") or 0) for r in rows)
    window = [r for r in rows if (r.get("t") or 0) >= last_t - SURPLUS_MIN_MINUTES * 60]
    picked = []
    for r in window:
        sat = r.get("do_saturation")
        do = r.get("do_level")
        if isinstance(sat, (int, float)) and sat > 0:
            picked.append(sat >= SURPLUS_SATURATION)
        elif isinstance(do, (int, float)) and do > 0:
            picked.append(do >= SURPLUS_DO)
    if len(picked) < SURPLUS_MIN_SAMPLES:
        return False
    return all(picked)


def recommend(values: dict,
              anomalies: list[dict] | None = None,
              rows: list[dict] | None = None,
              nutrient_mode: bool = False) -> list[dict]:
    """지금 상황에서 점검·가동할 설비를 권고로 돌려준다.

    돌려주는 항목 하나는 {"code", "level", "value", "digits"} 이고,
    level 은 danger(즉시) · warn(점검) · save(전력 절감) 중 하나다.

    수경재배 모드에서는 비운다 — 산소공급기·환수 같은 말이 그쪽 현장에서는
    맞지 않고, 양액 보충 안내가 이미 그 자리를 맡고 있다.
    """
    if nutrient_mode:
        return []

    anomalies = anomalies or []
    out: list[dict] = []

    def add(code: str, level: str, value=None, digits: int = 1) -> None:
        out.append({"code": code, "level": level, "value": value, "digits": digits})

    do = _num(values, "do_level")
    ph = _num(values, "ph")
    temp = _num(values, "temperature")
    turbidity = _num(values, "turbidity")
    salinity = _num(values, "salinity")

    # ── 용존산소 — 폐사까지의 시간이 가장 짧다. 언제나 맨 위다. ──────────
    if do is not None:
        do_warn_min = BANDS["do_level"]["warn"][0]
        do_ok_min = BANDS["do_level"]["ok"][0]
        if do < do_warn_min:
            # 산소공급기·브로워 즉시 최대 + 급이 중단
            add("do_critical", "danger", do, 2)
        elif do < do_ok_min:
            add("do_low", "warn", do, 2)
        else:
            falling = _find(anomalies, "do_level", "surge", "drift")
            if falling is not None and falling.get("direction") == "down":
                # 아직 기준 안이지만 내려가는 중 — 지금 폭기를 올리면 사고를 면한다.
                add("do_falling", "warn", do, 2)
            elif _sustained_surplus(rows):
                # 여기만 전력을 **줄이라고** 말하는 자리다.
                add("do_surplus", "save", do, 2)

    # ── pH — 급변은 암모니아 독성과 탈피에 바로 걸린다. ──────────────────
    if ph is not None:
        lo, hi = BANDS["ph"]["warn"]
        if ph < lo or ph > hi:
            add("ph_critical", "danger", ph, 2)
        elif _find(anomalies, "ph", "surge", "deviation") is not None:
            add("ph_shift", "warn", ph, 2)

    # ── 탁도 — 순환·여과 계통이 일을 못 하고 있다는 신호다.
    #    (센서 증설 전에는 값이 없어 이 분기가 돌지 않는다) ───────────────
    if turbidity is not None:
        hi = BANDS["turbidity"]["warn"][1]
        if hi is not None and turbidity > hi:
            add("turbidity_high", "danger", turbidity, 1)
        elif _find(anomalies, "turbidity") is not None:
            add("turbidity_up", "warn", turbidity, 1)

    # ── 수온 — 설비가 히터·냉각기로 갈리고, 높으면 산소까지 끌어내린다. ──
    if temp is not None:
        lo, hi = BANDS["temperature"]["ok"]
        if hi is not None and temp > hi:
            add("temp_high", "danger", temp, 1)
        elif lo is not None and temp < lo:
            add("temp_low", "warn", temp, 1)
        elif _find(anomalies, "temperature", "surge") is not None:
            add("temp_swing", "warn", temp, 1)

    # ── 염도 — 환수량·원수가 흔들렸다는 뜻이라 환수 계통을 본다. ─────────
    if salinity is not None:
        lo, hi = BANDS["salinity"]["warn"]
        if (lo is not None and salinity < lo) or (hi is not None and salinity > hi):
            add("salinity_critical", "danger", salinity, 1)
        elif _find(anomalies, "salinity", "surge") is not None:
            add("salinity_shift", "warn", salinity, 1)

    # 급한 것부터. 화면이 좁아 다 띄우지 못하므로 순서가 곧 중요도다.
    order = {"danger": 0, "warn": 1, "save": 2}
    out.sort(key=lambda a: order[a["level"]])
    return out
