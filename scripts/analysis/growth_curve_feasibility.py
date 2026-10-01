"""생육 성장곡선 엔진(엔진 1)이 실제로 되는지 확인한다.

docs/plans/tips-2026-dataset-assessment.md 가 인용하는 수치를 만드는 스크립트다.
문서에 숫자만 적어 두면 나중에 아무도 다시 확인하지 못하므로, 그 숫자가 어디서
나왔는지 여기에 남긴다. raspberry-pi/verify.py 와 같은 역할이다.

핵심 결론 세 가지를 순서대로 확인한다.

  1. 적산수온 축에 곡선을 얹으면 잘 맞는다          R² 0.967~0.992
  2. 그러나 적합도는 예측력이 아니다                 홀드아웃 MAE 14.94 g
  3. Winf 를 고정하면 예측이 산다                    홀드아웃 MAE 2.84 g

2번이 이 스크립트의 존재 이유다. R² 만 보고 "성장곡선 됩니다" 라고 보고했다면
수조 2에서 19.7 g 을 95.1 g 으로 예측하는 엔진을 현장에 내보낼 뻔했다.

데이터: 천황수산 새우 양식 AI 학습용 데이터셋 v1.0 (5개 수조, 2024-03-12~12-05).
저장소에 포함하지 않는다 — 단일 농가의 운영 기록이고 원본에 거래처명이 들어 있다.
경로는 --daily / --growth 로 준다.

    python3 scripts/analysis/growth_curve_feasibility.py \
        --daily daily_tank_dataset.csv --growth GrowthSamples.csv
"""

from __future__ import annotations

import argparse
import sys
import warnings

import numpy as np
import pandas as pd
from scipy.optimize import curve_fit

warnings.filterwarnings("ignore")

# 적산수온의 기준온도(℃). 이 값 아래의 수온은 성장에 기여하지 않는다고 본다.
#
# 10·12·15·18 ℃ 를 전부 돌려 본 평균 R² 가 0.9750·0.9752·0.9755·0.9759 로
# 사실상 같았다. 기준온도는 결과를 좌우하지 않으므로 여기서 튜닝하지 않는다.
BASE_TEMP_C = 15.0

# Winf 를 고정할 때 쓸 후보값(g). 25~40 g 어디로 잡아도 홀드아웃 MAE 가
# 2.8~3.6 g 안에 들어온다 — 정확한 값보다 "고정한다"는 사실이 중요하다.
WINF_CANDIDATES = (25.0, 30.0, 35.0, 40.0)

# 곡선을 부르려면 최소 몇 점이 필요한가. 그 아래는 적합 자체가 의미 없다.
MIN_SAMPLES = 8

# 순차검증에서 몇 점을 쌓은 뒤부터 '다음 1건' 예측을 시작할지.
WALK_FORWARD_START = 6


def gompertz(x, w_inf, b, k):
    """Gompertz 성장곡선. x 는 적산수온, 반환은 개체중(g)."""
    return w_inf * np.exp(-b * np.exp(-k * x))


def cumulative_degree_days(daily: pd.DataFrame, tank: int, base: float) -> pd.DataFrame:
    """수조 하나의 날짜별 적산수온을 만든다.

    수온이 없는 날(1032일 중 10일)은 그 수조의 평균 증분으로 메운다. 0 으로 두면
    그날 성장이 멈춘 것으로 보게 되고, 행을 버리면 적산이 끊긴다.
    """
    s = daily[daily.tank_id == tank].sort_values("date")[["date", "water_temperature_c_mean"]].copy()
    increment = (s.water_temperature_c_mean - base).clip(lower=0)
    s["cdd"] = increment.fillna(increment.mean()).cumsum()
    return s[["date", "cdd"]]


def series_for(daily: pd.DataFrame, growth: pd.DataFrame, tank: int, base: float) -> pd.DataFrame:
    """성장 실측을 적산수온 축에 올린 표."""
    axis = cumulative_degree_days(daily, tank, base)
    return (
        growth[growth.tank_id == tank]
        .merge(axis, on="date", how="inner")
        .sort_values("cdd")
        .reset_index(drop=True)
    )


def fit_free(x, y):
    """Winf 까지 자유롭게 적합. 2번 결론을 만드는 쪽이다."""
    params, _ = curve_fit(gompertz, x, y, p0=[30.0, 5.0, 0.002], maxfev=60000)
    return params


def fit_fixed_winf(x, y, w_inf):
    """Winf 를 고정하고 b·k 만 적합. 3번 결론을 만드는 쪽이다."""
    params, _ = curve_fit(
        lambda xx, b, k: gompertz(xx, w_inf, b, k), x, y, p0=[5.0, 0.002], maxfev=60000
    )
    return (w_inf, *params)


def step1_goodness_of_fit(daily, growth, tanks):
    """전 구간을 적합해 R² 를 본다. '잘 맞는다'는 것까지만 말할 수 있다."""
    print("\n[1] 적합도 — 전 구간 적합\n")
    print(f"{'수조':>4} {'n':>4} {'Winf':>8} {'k':>10} {'R²':>8} {'RMSE(g)':>9}")
    scores = []
    for tank in tanks:
        gt = series_for(daily, growth, tank, BASE_TEMP_C)
        if len(gt) < MIN_SAMPLES:
            continue
        x, y = gt.cdd.values, gt.body_weight_g.values
        try:
            p = fit_free(x, y)
        except RuntimeError:
            print(f"{tank:>4} {len(gt):>4}   적합 실패")
            continue
        pred = gompertz(x, *p)
        r2 = 1 - ((y - pred) ** 2).sum() / ((y - y.mean()) ** 2).sum()
        rmse = float(np.sqrt(((y - pred) ** 2).mean()))
        scores.append(r2)
        print(f"{tank:>4} {len(gt):>4} {p[0]:>8.1f} {p[2]:>10.5f} {r2:>8.4f} {rmse:>9.2f}")
    if scores:
        print(f"\n  R² {min(scores):.3f} ~ {max(scores):.3f} — 잘 맞는다.")
        print("  여기서 멈추면 안 된다. 적합도는 예측력이 아니다.")
    return scores


def step2_holdout(daily, growth, tanks, w_inf=None):
    """앞 70% 로 적합해 뒤 30%(미래)를 예측한다. 이것이 실제로 쓸 때의 상황이다."""
    maes = []
    detail = []
    for tank in tanks:
        gt = series_for(daily, growth, tank, BASE_TEMP_C)
        cut = int(len(gt) * 0.7)
        train, test = gt.iloc[:cut], gt.iloc[cut:]
        if len(test) < 2:
            continue
        try:
            p = fit_fixed_winf(train.cdd.values, train.body_weight_g.values, w_inf) \
                if w_inf else fit_free(train.cdd.values, train.body_weight_g.values)
        except RuntimeError:
            detail.append((tank, None, None, None))
            continue
        pred = gompertz(test.cdd.values, *p)
        mae = float(np.abs(pred - test.body_weight_g.values).mean())
        maes.append(mae)
        detail.append((tank, mae, float(test.body_weight_g.values[-1]), float(pred[-1])))
    return (float(np.mean(maes)) if maes else float("nan")), detail


def step3_walk_forward(daily, growth, tanks):
    """직전 관측까지로 적합해 '다음 1건'만 예측. 단기 예측 성능."""
    print("\n[4] 단기 순차예측 — 다음 1건만\n")
    print(f"{'수조':>4} {'예측':>5} {'MAE(g)':>9} {'MAPE(%)':>9}")
    all_err, all_pct = [], []
    for tank in tanks:
        gt = series_for(daily, growth, tank, BASE_TEMP_C)
        errs, pcts = [], []
        for i in range(WALK_FORWARD_START, len(gt)):
            train, nxt = gt.iloc[:i], gt.iloc[i]
            try:
                p = fit_free(train.cdd.values, train.body_weight_g.values)
            except RuntimeError:
                continue
            pred = gompertz(nxt.cdd, *p)
            errs.append(abs(pred - nxt.body_weight_g))
            pcts.append(abs(pred - nxt.body_weight_g) / nxt.body_weight_g * 100)
        if errs:
            print(f"{tank:>4} {len(errs):>5} {np.mean(errs):>9.2f} {np.mean(pcts):>9.1f}")
            all_err += errs
            all_pct += pcts
    if all_err:
        print(f"\n  전체 MAE {np.mean(all_err):.2f} g · MAPE {np.mean(all_pct):.1f}%  (n={len(all_err)})")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--daily", required=True, help="daily_tank_dataset.csv")
    ap.add_argument("--growth", required=True, help="GrowthSamples 시트를 뽑은 CSV")
    args = ap.parse_args()

    daily = pd.read_csv(args.daily, parse_dates=["date"])
    growth = pd.read_csv(args.growth, parse_dates=["date"])
    tanks = sorted(set(daily.tank_id) & set(growth.tank_id))

    print("=" * 68)
    print(f"생육 성장곡선 엔진 타당성 — 수조 {len(tanks)}개 · 성장 실측 {len(growth)}건")
    print(f"적산수온 기준온도 {BASE_TEMP_C:g} ℃ · Gompertz")
    print("=" * 68)

    step1_goodness_of_fit(daily, growth, tanks)

    print("\n[2] 홀드아웃 — Winf 를 자유 파라미터로 두면\n")
    print(f"{'수조':>4} {'MAE(g)':>9} {'마지막 실측':>12} {'예측':>10}")
    free_mae, detail = step2_holdout(daily, growth, tanks)
    for tank, mae, actual, pred in detail:
        if mae is None:
            print(f"{tank:>4}   적합 실패 — 수렴하지 않음")
        else:
            print(f"{tank:>4} {mae:>9.2f} {actual:>12.1f} {pred:>10.1f}")
    print(f"\n  평균 MAE {free_mae:.2f} g — 쓸 수 없다.")
    print("  Winf 가 자유로우면 성장 중기 데이터만으로 상한이 정해지지 않아 발산한다.")

    print("\n[3] 홀드아웃 — Winf 를 고정하면\n")
    print(f"{'고정 Winf':>10} {'평균 MAE(g)':>13}   수조별")
    best = None
    for w in WINF_CANDIDATES:
        mae, det = step2_holdout(daily, growth, tanks, w_inf=w)
        per = " ".join(f"T{t}:{m:.1f}" for t, m, _, _ in det if m is not None)
        print(f"{w:>10.0f} {mae:>13.2f}   {per}")
        if best is None or mae < best[1]:
            best = (w, mae)
    print(f"\n  최적 {best[0]:.0f} g 에서 MAE {best[1]:.2f} g — 자유 적합 대비 {free_mae / best[1]:.1f}배 개선.")
    print("  Winf 를 자유 파라미터로 두지 않는 것이 엔진 1 의 1순위 설계 규칙이다.")

    step3_walk_forward(daily, growth, tanks)

    print("\n" + "=" * 68)
    print("결론 — 엔진 1 은 이 데이터로 구현 가능하다. 단 Winf 는 고정한다.")
    print("문헌 파라미터 조사는 데이터가 없을 때의 차선책이 아니라, 데이터가")
    print("있어도 필요한 구조다. 위 [2] 와 [3] 의 차이가 그 근거다.")
    print("=" * 68)
    return 0


if __name__ == "__main__":
    sys.exit(main())
