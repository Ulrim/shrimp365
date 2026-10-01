"""생육 성장곡선 엔진(엔진 1)이 실제로 되는지 확인한다.

docs/plans/tips-2026-dataset-assessment.md 가 인용하는 수치를 만드는 스크립트다.
문서에 숫자만 적어 두면 나중에 아무도 다시 확인하지 못하므로, 그 숫자가 어디서
나왔는지 여기에 남긴다. raspberry-pi/verify.py 와 같은 역할이다.

네 처방을 같은 조건에서 비교한다.

    전 구간 · Winf 자유        하나의 곡선으로 입식부터 출하까지
    전 구간 · Winf 고정        상한중량을 문헌값으로 묶는다
    7.5 g 이상 · Winf 자유     출하 구간만 보되 상한은 풀어 둔다
    7.5 g 이상 · Winf 고정     둘 다 적용한다

**적합도(R²)로 판정하지 않는다.** 전 구간 적합의 R² 는 0.97 을 넘는데 그 곡선으로
미래를 예측시키면 19.7 g 을 95 g 으로 내놓는다. 곡선이 지나온 점을 잘 지난다는 것과
아직 안 본 점을 맞힌다는 것은 다른 말이다. 그래서 앞 70% 로 적합해 뒤 30% 를
예측하는 홀드아웃만 본다.

**비교는 반드시 같은 수조 집합에서 한다.** 처방마다 적합에 실패하거나 표본이
모자라는 수조가 다르다. 처방 A 가 수조 3개 평균이고 처방 B 가 5개 평균이면 두 수를
나눈 값은 아무 뜻이 없다 — 처음 쓸 때 이 실수를 해서 개선 배수를 부풀려 보고했다.
그래서 이 스크립트는 네 처방 모두에서 값이 나온 수조만 골라 공정 비교표를 찍고,
모든 평균 옆에 n 을 적으며, 제외된 수조도 이유와 함께 출력한다. 조용히 빠지면
평균이 좋아 보인다.

데이터: 천황수산 새우 양식 AI 학습용 데이터셋 v1.0 (5개 수조, 2024-03-12~12-05).
저장소에 포함하지 않는다 — 단일 농가의 운영 기록이고 원본에 거래처명이 들어 있다.

    python3 scripts/analysis/growth_curve_feasibility.py \\
        --daily daily_tank_dataset.csv --growth GrowthSamples.csv

필요한 컬럼은 아래가 전부다. 다른 컬럼은 읽지 않는다.

    --daily    tank_id                   수조 번호
               date                      날짜 (YYYY-MM-DD)
               water_temperature_c_mean  그날 수온 평균(℃). 결측 허용

    --growth   tank_id                   수조 번호
               date                      샘플링 날짜 (YYYY-MM-DD)
               body_weight_g             실측 개체중(g)

`--growth` 는 엑셀 검토본의 `GrowthSamples` 시트를 `header=1` 로 읽어 CSV 로
떨군 것이다(첫 행이 한글 설명, 둘째 행이 영문 변수명).

⚠ `production_events.weight_g_per_shrimp` 를 `body_weight_g` 자리에 넣지 말 것.
그 값은 실측이 아니라 유통 규격에서 역산된 것이다(28.571429 = 1000/35).
"""

from __future__ import annotations

import argparse
import sys
import warnings

import numpy as np
import pandas as pd
from scipy.optimize import curve_fit

warnings.filterwarnings("ignore")

# 시간축의 기준온도(℃). 0 은 기준온도를 차감하지 않는다는 뜻이다.
#
# 0 이 문헌과 맞다. Powell(2020)이 흰다리새우에 적용한 TGC(thermal-unit growth
# coefficient)는 수온의 단순 누적합 Σ(T × 일수)를 쓰고 기준온도를 빼지 않는다.
# 작물학의 Σ(T − T_base) 형 degree-day 와 같은 것이 아니다.
#
# 처음에는 15 ℃ 를 차감했는데, 흰다리새우용으로 공표된 기준온도가 없어서 그 15 는
# 우리가 지어낸 숫자였다. 0·5·10·15·18 을 전부 돌려 보니 권고 처방의 홀드아웃
# MAE 가 다섯 경우 모두 같았다 — 기준온도는 결과를 바꾸지 않는다. 성능이 같다면
# 문헌이 쓰는 형태를 쓴다. 근거 없는 상수를 들고 있으면 "왜 15 입니까" 에 답할
# 말이 없다.
BASE_TEMP_C = 0.0

# 성장 구간이 갈리는 경계(g). Powell(2020, Aquaculture Research, DOI
# 10.1111/are.14391)이 흰다리새우 성장 궤적에서 7.5 g 을 경계로 두 패턴이 뚜렷이
# 갈린다고 보고했다. 출하 판단에 필요한 구간도 어차피 이쪽이다.
STANZA_BREAK_G = 7.5

# Winf 를 고정할 때 쓸 후보값(g). 정확한 값보다 "고정한다"는 사실이 중요하다.
WINF_CANDIDATES = (25.0, 30.0, 35.0, 40.0)

# 학습 구간에 필요한 최소 관측 수. 파라미터 수보다 많아야 적합이 성립한다 —
# 자유 적합은 Winf·b·k 세 개라 4점, Winf 고정은 b·k 두 개라 3점이 하한이다.
# 하한을 하나로 고정하면 Winf 고정 처방이 멀쩡히 적합되는데도 통째로 제외된다.
MIN_TRAIN_FREE = 4
MIN_TRAIN_FIXED = 3

# 홀드아웃에서 예측 구간에 최소 몇 점이 있어야 평균을 믿을 수 있는지.
MIN_TEST_POINTS = 2

# 학습/예측 분할 비율.
TRAIN_FRACTION = 0.7

# 순차검증에서 몇 점을 쌓은 뒤부터 '다음 1건' 예측을 시작할지.
WALK_FORWARD_START = 6


def gompertz(x, w_inf, b, k):
    """Gompertz 성장곡선. x 는 적산수온, 반환은 개체중(g)."""
    return w_inf * np.exp(-b * np.exp(-k * x))


def cumulative_degree_days(daily: pd.DataFrame, tank: int, base: float) -> pd.DataFrame:
    """수조 하나의 날짜별 적산수온.

    수온이 없는 날은 그 수조의 평균 증분으로 메운다. 0 으로 두면 그날 성장이
    멈춘 것으로 보게 되고, 행을 버리면 적산이 끊긴다.
    """
    s = daily[daily.tank_id == tank].sort_values("date")[["date", "water_temperature_c_mean"]].copy()
    increment = (s.water_temperature_c_mean - base).clip(lower=0)
    s["cdd"] = increment.fillna(increment.mean()).cumsum()
    return s[["date", "cdd"]]


def series_for(daily, growth, tank, stanza2_only=False) -> pd.DataFrame:
    """성장 실측을 적산수온 축에 올린 표.

    개체중이나 적산수온이 비어 있는 행은 버린다. 이 데이터셋은 빈칸을 0 으로
    채우지 않는 것이 미덕이라 결측이 NaN 으로 들어오는데, curve_fit 은 NaN 을
    받으면 ValueError 로 죽는다. 지금 표본이 전부 비결측이라 우연히 넘어가고
    있을 뿐이고, 재추출본에 빈 행이 하나 섞이면 그 자리에서 멈춘다.
    """
    axis = cumulative_degree_days(daily, tank, BASE_TEMP_C)
    gt = growth[growth.tank_id == tank].merge(axis, on="date", how="inner")
    gt = gt.dropna(subset=["body_weight_g", "cdd"])
    if stanza2_only:
        gt = gt[gt.body_weight_g >= STANZA_BREAK_G]
    return gt.sort_values("cdd").reset_index(drop=True)


def fit(x, y, w_inf=None):
    """Gompertz 적합. 실패하면 None 을 돌려준다.

    curve_fit 은 RuntimeError(수렴 실패) 말고도 TypeError(점이 파라미터보다 적음),
    ValueError(NaN·inf) 를 던진다. 한 수조가 죽어서 전체 비교가 중단되면 안 되므로
    넓게 받는다 — 어느 수조가 왜 빠졌는지는 호출 쪽이 출력한다.
    """
    try:
        if w_inf is None:
            params, _ = curve_fit(gompertz, x, y, p0=[30.0, 5.0, 0.002], maxfev=60000)
            return tuple(params)
        params, _ = curve_fit(
            lambda xx, b, k: gompertz(xx, w_inf, b, k), x, y, p0=[5.0, 0.002], maxfev=60000
        )
        return (w_inf, *params)
    except (RuntimeError, TypeError, ValueError):
        return None


def holdout(daily, growth, tanks, w_inf=None, stanza2_only=False):
    """앞 70% 로 적합해 뒤 30%(미래)를 예측한다. 실제로 쓸 때의 상황이다.

    수조마다 (MAE, 제외사유, 마지막 실측, 마지막 예측) 을 돌려준다. MAE 가 None
    이면 제외된 것이고 사유가 채워진다 — 제외를 조용히 넘기면 평균이 좋아 보인다.
    """
    out = {}
    for tank in tanks:
        gt = series_for(daily, growth, tank, stanza2_only)
        cut = int(len(gt) * TRAIN_FRACTION)
        train, test = gt.iloc[:cut], gt.iloc[cut:]
        need = MIN_TRAIN_FIXED if w_inf is not None else MIN_TRAIN_FREE
        if cut < need:
            out[tank] = (None, f"학습 {cut}건<{need}", None, None)
            continue
        if len(test) < MIN_TEST_POINTS:
            out[tank] = (None, f"예측 {len(test)}건<{MIN_TEST_POINTS}", None, None)
            continue
        params = fit(train.cdd.values, train.body_weight_g.values, w_inf)
        if params is None:
            out[tank] = (None, "수렴 실패", None, None)
            continue
        pred = gompertz(test.cdd.values, *params)
        mae = float(np.abs(pred - test.body_weight_g.values).mean())
        out[tank] = (mae, None, float(test.body_weight_g.values[-1]), float(pred[-1]))
    return out


def mean_of(result, only=None):
    """제외되지 않은 수조의 MAE 평균과 그 수조 목록."""
    got = {t: v[0] for t, v in result.items() if v[0] is not None and (only is None or t in only)}
    if not got:
        return None, []
    return float(np.mean(list(got.values()))), sorted(got)


def fmt_row(result, tanks):
    """수조별 MAE 한 줄. 제외된 수조는 이유를 적는다."""
    return "  ".join(
        f"T{t}:{result[t][0]:.2f}" if result[t][0] is not None else f"T{t}:제외({result[t][1]})"
        for t in tanks
    )


def step_goodness_of_fit(daily, growth, tanks):
    """전 구간을 적합해 R² 를 본다. '잘 맞는다'는 것까지만 말할 수 있다."""
    print("\n[1] 적합도 — 전 구간을 전부 써서 적합 (예측이 아니다)\n")
    print(f"{'수조':>4} {'n':>4} {'Winf':>8} {'k':>10} {'R²':>8} {'RMSE(g)':>9}")
    scores = []
    for tank in tanks:
        gt = series_for(daily, growth, tank)
        if len(gt) < MIN_TRAIN_FREE:
            print(f"{tank:>4} {len(gt):>4}   관측 부족")
            continue
        x, y = gt.cdd.values, gt.body_weight_g.values
        params = fit(x, y)
        if params is None:
            print(f"{tank:>4} {len(gt):>4}   적합 실패")
            continue
        pred = gompertz(x, *params)
        r2 = 1 - ((y - pred) ** 2).sum() / ((y - y.mean()) ** 2).sum()
        rmse = float(np.sqrt(((y - pred) ** 2).mean()))
        scores.append(r2)
        print(f"{tank:>4} {len(gt):>4} {params[0]:>8.1f} {params[2]:>10.5f} {r2:>8.4f} {rmse:>9.2f}")
    if scores:
        print(f"\n  R² {min(scores):.3f} ~ {max(scores):.3f} (n={len(scores)}) — 잘 맞는다.")
        print("  여기서 멈추면 안 된다. 아래 [2] 가 같은 곡선에게 미래를 묻는다.")


def step_walk_forward(daily, growth, tanks):
    """직전 관측까지로 적합해 '다음 1건'만 예측. 단기 예측 성능."""
    print("\n[5] 단기 순차예측 — 직전까지로 적합해 다음 1건만\n")
    print(f"{'수조':>4} {'예측':>5} {'MAE(g)':>9} {'MAPE(%)':>9}")
    all_err, all_pct = [], []
    for tank in tanks:
        gt = series_for(daily, growth, tank)
        errs, pcts = [], []
        for i in range(WALK_FORWARD_START, len(gt)):
            train, nxt = gt.iloc[:i], gt.iloc[i]
            params = fit(train.cdd.values, train.body_weight_g.values)
            if params is None:
                continue
            pred = gompertz(nxt.cdd, *params)
            errs.append(abs(pred - nxt.body_weight_g))
            pcts.append(abs(pred - nxt.body_weight_g) / nxt.body_weight_g * 100)
        if errs:
            print(f"{tank:>4} {len(errs):>5} {np.mean(errs):>9.2f} {np.mean(pcts):>9.1f}")
            all_err += errs
            all_pct += pcts
    if all_err:
        print(f"\n  전체 MAE {np.mean(all_err):.2f} g · MAPE {np.mean(all_pct):.1f}%  (n={len(all_err)})")


def best_fixed(daily, growth, tanks, stanza, idx, label):
    """Winf 후보를 훑어 가장 좋은 것을 고르고 표를 찍는다."""
    print(f"\n[{idx}] 홀드아웃 — {label}, Winf 고정\n")
    print(f"{'고정 Winf':>10} {'평균 MAE':>10} {'n':>4}   수조별")
    best = None
    for w in WINF_CANDIDATES:
        res = holdout(daily, growth, tanks, w_inf=w, stanza2_only=stanza)
        mm, gg = mean_of(res)
        if mm is None:
            continue
        print(f"{w:>10.0f} {mm:>10.2f} {len(gg):>4}   {fmt_row(res, tanks)}")
        if best is None or mm < best[1]:
            best = (w, mm, res)
    return best


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--daily", required=True, help="daily_tank_dataset.csv")
    ap.add_argument("--growth", required=True, help="GrowthSamples 시트를 뽑은 CSV")
    args = ap.parse_args()

    daily = pd.read_csv(args.daily, parse_dates=["date"])
    growth = pd.read_csv(args.growth, parse_dates=["date"])
    tanks = sorted(set(daily.tank_id) & set(growth.tank_id))

    print("=" * 76)
    print(f"생육 성장곡선 엔진 타당성 — 수조 {len(tanks)}개 · 성장 실측 {len(growth)}건")
    print(f"시간축 TGC(적산수온, 기준온도 {BASE_TEMP_C:g} ℃) · Gompertz")
    print("=" * 76)

    step_goodness_of_fit(daily, growth, tanks)

    recipes = []

    free_full = holdout(daily, growth, tanks)
    print("\n[2] 홀드아웃 — 전 구간, Winf 자유\n")
    print(f"{'수조':>4} {'MAE(g)':>9} {'마지막 실측':>12} {'예측':>10}")
    for tank in tanks:
        mae, why, actual, pred = free_full[tank]
        if mae is None:
            print(f"{tank:>4} {'제외':>9}   {why}")
        else:
            print(f"{tank:>4} {mae:>9.2f} {actual:>12.1f} {pred:>10.1f}")
    m, got = mean_of(free_full)
    print(f"\n  평균 MAE {m:.2f} g  (수조 {got}, n={len(got)}) — 쓸 수 없다.")
    print("  Winf 가 자유로우면 곡선이 꺾이기 전 구간만 보고 상한을 정하려다 발산한다.")
    recipes.append(("전 구간 · Winf 자유", free_full))

    b = best_fixed(daily, growth, tanks, False, 3, "전 구간")
    if b is None:
        print("\n  전 구간 Winf 고정이 전 수조에서 실패했다. 데이터를 확인하라.")
        return 1
    recipes.append((f"전 구간 · Winf {b[0]:.0f} g", b[2]))

    free_stanza = holdout(daily, growth, tanks, stanza2_only=True)
    ms, gs = mean_of(free_stanza)
    print(f"\n[4] 홀드아웃 — {STANZA_BREAK_G:g} g 이상, Winf 자유\n")
    shown = f"{ms:.2f} g (n={len(gs)})" if ms is not None else "전 수조 제외 — 값 없음"
    print(f"  평균 MAE {shown}   {fmt_row(free_stanza, tanks)}")
    recipes.append((f"{STANZA_BREAK_G:g} g 이상 · Winf 자유", free_stanza))

    b2 = best_fixed(daily, growth, tanks, True, 6, f"{STANZA_BREAK_G:g} g 이상")
    if b2 is None:
        print(f"\n  {STANZA_BREAK_G:g} g 이상 구간의 표본이 모자라 비교할 수 없다.")
        return 1
    recipes.append((f"{STANZA_BREAK_G:g} g 이상 · Winf {b2[0]:.0f} g", b2[2]))

    step_walk_forward(daily, growth, tanks)

    # ── 공정 비교 ────────────────────────────────────────────────
    # 네 처방 모두에서 값이 나온 수조만 쓴다. 처방마다 빠진 수조가 다른 채로
    # 평균을 나누면 그 비율은 아무 뜻이 없다.
    common = [t for t in tanks if all(res[t][0] is not None for _, res in recipes)]

    print("\n" + "=" * 76)
    print(f"처방 비교 — 네 처방 모두 값이 나온 수조 {common} 만 사용 (n={len(common)})")
    print("=" * 76)
    if not common:
        print("  공통 수조가 없다. 비교할 수 없다.")
        return 1

    scored = [(name, mean_of(res, common)[0]) for name, res in recipes]
    worst = max(s for _, s in scored)
    best_name, best_score = min(scored, key=lambda s: s[1])
    for name, score in scored:
        tag = "  ← 가장 좋음" if name == best_name else ""
        print(f"  {name:<26} {score:>7.2f} g   ({worst / score:>5.1f}배){tag}")

    print("=" * 76)
    print(f"가장 나쁜 처방 대비 {worst / best_score:.1f}배.")
    stanza_alone = dict(scored)[f"{STANZA_BREAK_G:g} g 이상 · Winf 자유"]
    if stanza_alone >= worst * 0.9:
        print(f"구간을 끊는 것만으로는 듣지 않는다({stanza_alone:.2f} g). Winf 고정과 같이 써야 한다.")

    full_mean, full_tanks = mean_of(recipes[-1][1])
    print(f"\n권고 처방을 전체 수조로 보면 MAE {full_mean:.2f} g (수조 {full_tanks}, n={len(full_tanks)}).")
    print("위 비교표와 모집단이 다르므로 이 수를 배수 계산에 섞어 쓰지 않는다.")
    print("=" * 76)
    return 0


if __name__ == "__main__":
    sys.exit(main())
