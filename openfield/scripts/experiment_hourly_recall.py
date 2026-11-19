"""시간 단위 재현율 개선안 비교 실험 — 강우·과습과 복합위험.

사용 예::

    python scripts/experiment_hourly_recall.py \
        --cache artifacts/dataset.pkl \
        --year-round-cache artifacts/dataset_all.pkl \
        --out artifacts/experiments/hourly_recall

**시험 대상과 무관한 실험이다.** 모델 묶음(`artifacts/weather`)을 읽지도 쓰지도 않고,
판단 코드(`src/ofdf`)를 바꾸지 않는다. STA 시험(커밋 5ff054f, 고정 모델)에는 영향이 없다.

**시험셋을 쓰지 않는다.** 모든 수치는 학습+검증 자료의 기상사례 블록 5겹 교차검증
예측(`weather_risk.oof_risk_proba`)에서 잰다. 개선안을 시험셋 결과로 고르면 그
시험셋은 더 이상 봉인된 것이 아니게 된다. 경계도 같은 교차검증 예측에서 고르므로
수치는 다소 낙관적이지만, 개선안끼리 견주는 데는 같은 조건이다.

비교하는 것

    경계 선택 단위     case — 지금 방식. 사례 단위 놓침 방지율의 95% 신뢰하한 >= 0.85
                       hour — 시간 단위 재현율의 95% 신뢰하한 >= 0.85
                       (둘 다 그 조건을 지키는 경계 가운데 Macro F1 이 가장 높은 것)
    학습 자료          season — 지금 방식. 작기(9~11월) 자료만
                       +연중  — 작기 밖 자료를 전용학습 앙상블의 **학습에만** 더한다
                                (--year-round-cache 를 줄 때만)
    복합위험 점수      product — 지금 방식. P(과습) × max(P(병해), P(서리))
                       min     — min(P(과습), max(P(병해), P(서리)))
                       mean    — (P(과습) + max(P(병해), P(서리))) / 2

예보 입력의 효과는 `scripts/forecast_value.py` 가 잰다(모사 예보, 정확도별 성능 곡선).
"""

from __future__ import annotations

import argparse
import importlib.util
import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ofdf.evaluation import metrics  # noqa: E402
from ofdf.labels.risk import RISK_LABELS_KO  # noqa: E402
from ofdf.models import weather_risk  # noqa: E402

COMPOUND_SCORES = {
    "product": lambda wet, other: wet * other,
    "min": lambda wet, other: np.minimum(wet, other),
    "mean": lambda wet, other: (wet + other) / 2.0,
}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--cache", required=True, help="작기 데이터셋 캐시 pickle")
    p.add_argument("--year-round-cache", default=None,
                   help="연중 데이터셋 캐시 pickle. 주면 「+연중」 학습안도 잰다")
    p.add_argument("--out", default="artifacts/experiments/hourly_recall")
    p.add_argument("--horizons", default="1,3")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--season", default="9,10,11")
    return p.parse_args(argv)


def _train_weather():
    """작기 밖 자료를 고르는 규칙(load_off_season)을 학습 스크립트에서 그대로 빌린다."""
    path = Path(__file__).resolve().parent / "train_weather.py"
    spec = importlib.util.spec_from_file_location("train_weather", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def oof_with_extra(X, y, dev_idx, groups, extra_X, extra_y, *, risk, horizon, n_splits=5):
    """`weather_risk.oof_risk_proba` 와 같은 접힘에, 접힘 학습분에만 ``extra`` 행을 더한다.

    조기종료 검증분과 교차검증 예측 대상은 작기 자료 그대로다.
    """
    from sklearn.model_selection import GroupKFold, GroupShuffleSplit

    X_all = pd.concat([X, extra_X], ignore_index=True)
    y_all = np.concatenate([y, extra_y])
    extra_idx = len(X) + np.arange(len(extra_X))
    out = np.full(len(X), np.nan)
    g = np.asarray(groups)
    for k, (fit_rel, hold_rel) in enumerate(GroupKFold(n_splits=n_splits).split(dev_idx, groups=g[dev_idx])):
        fit, hold = dev_idx[fit_rel], dev_idx[hold_rel]
        inner = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=k)
        f_tr, f_va = next(inner.split(fit, groups=g[fit]))
        model = weather_risk.train_one(
            X_all, y_all, np.concatenate([fit[f_tr], extra_idx]), fit[f_va], risk=risk, horizon=horizon
        )
        out[hold] = weather_risk.risk_probability(model.predict_proba(X.iloc[hold]))
    return out


def measure(score: np.ndarray, y_risk: np.ndarray, events: np.ndarray, unit: str) -> dict:
    """교차검증 점수에서 경계를 고르고(단위 ``unit``) 같은 표본에서 지표를 잰다."""
    threshold = weather_risk.tune_risk_threshold(
        score, y_risk, events=events if unit == "case" else None
    )
    pred = (score >= threshold).astype(int)
    s = metrics.binary_score(y_risk, pred)
    det = metrics.event_detection(y_risk, pred, pd.Series(events))
    return {
        "경계 선택 단위": unit, "경계": round(threshold, 2),
        "시간 단위 재현율": round(s.risk_recall, 3),
        "사례 단위 놓침 방지율": round(det["detection_rate"], 3),
        "조치단위 MacroF1": round(s.macro_f1, 3),
        "오경보율": round(s.false_alarm_rate, 4),
        "위험 표본": s.n_risk, "사례 수": det["n_events"],
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    horizons = [int(h) for h in args.horizons.split(",")]

    ds = pickle.loads(Path(args.cache).read_bytes())
    X = ds.features.reset_index(drop=True)
    meta = ds.meta.reset_index(drop=True)
    states = ds.states.reset_index(drop=True)
    groups = weather_risk.shared_group_keys(meta, states)
    train_idx, valid_idx, test_idx = weather_risk.split_by_event(groups, seed=args.seed)
    dev_idx = np.sort(np.concatenate([train_idx, valid_idx]))
    group_arr = groups.to_numpy()
    print(f"[분할] 학습+검증 {len(dev_idx):,}시간으로 교차검증 — 시험 {len(test_idx):,}시간은 쓰지 않는다")

    off_X = off_labels = None
    if args.year_round_cache:
        args.aaos_dir = args.agera5 = None
        season = tuple(int(m) for m in args.season.split(","))
        off_X, off_labels = _train_weather().load_off_season(args, season)
        off_X = off_X[list(X.columns)]
        print(f"[학습 보강] 작기 밖 {len(off_X):,}시간을 접힘 학습분에만 더하는 안을 함께 잰다")

    def labels(key: str) -> np.ndarray:
        return ds.labels[key].reset_index(drop=True).fillna(0).astype(int).to_numpy()

    def events(risk: str) -> np.ndarray:
        return ds.events[f"{risk}_event"].reset_index(drop=True).iloc[dev_idx].to_numpy()

    rows = []
    for horizon in horizons:
        # 교차검증 P(위험) — 학습안별로. season 은 지금 학습과 같은 함수다
        proba: dict[str, dict[str, np.ndarray]] = {"season": {}, "+연중": {}}
        for risk in ("rain_wet", "frost", "disease"):
            y = labels(f"{risk}_h{horizon}")
            target = (y >= 1).astype(int) if risk != "disease" else y
            print(f"  교차검증: {RISK_LABELS_KO[risk]} {horizon}시간 ...", flush=True)
            proba["season"][risk] = weather_risk.oof_risk_proba(
                X, target, dev_idx, group_arr, risk=risk, horizon=horizon
            )
            if off_X is not None and risk == "rain_wet":
                extra = (off_labels[f"{risk}_h{horizon}"].fillna(0).astype(int).to_numpy() >= 1).astype(int)
                proba["+연중"][risk] = oof_with_extra(
                    X, target, dev_idx, group_arr, off_X, extra, risk=risk, horizon=horizon
                )

        # 강우·과습
        y_wet = (labels(f"rain_wet_h{horizon}")[dev_idx] >= 1).astype(int)
        for data in ("season", "+연중"):
            if "rain_wet" not in proba[data]:
                continue
            for unit in ("case", "hour"):
                rows.append({"판정항목": f"{RISK_LABELS_KO['rain_wet']} {horizon}시간", "학습 자료": data,
                             "복합 점수": "", **measure(proba[data]["rain_wet"][dev_idx], y_wet,
                                                    events("rain_wet"), unit)})

        # 복합위험 — 구성 위험 확률을 묶는 방식별로
        y_comp = (labels(f"compound_h{horizon}")[dev_idx] >= 1).astype(int)
        other = np.maximum(proba["season"]["disease"], proba["season"]["frost"])[dev_idx]
        for data in ("season", "+연중"):
            if "rain_wet" not in proba[data]:
                continue
            wet = proba[data]["rain_wet"][dev_idx]
            for name, combine in COMPOUND_SCORES.items():
                for unit in ("case", "hour"):
                    rows.append({"판정항목": f"{RISK_LABELS_KO['compound']} {horizon}시간", "학습 자료": data,
                                 "복합 점수": name,
                                 **measure(combine(wet, other), y_comp, events("compound"), unit)})

    table = pd.DataFrame(rows)
    base = (table["학습 자료"] == "season") & (table["경계 선택 단위"] == "case") & (
        table["복합 점수"].isin(["", "product"]))
    table.insert(3, "구분", np.where(base, "현재 방식", "개선안"))
    table.to_csv(out_dir / "hourly_recall_experiment.csv", index=False, encoding="utf-8-sig")
    pd.set_option("display.width", 250)
    pd.set_option("display.max_rows", 200)
    print("\n===== 교차검증(학습+검증) 비교 — 시험셋 아님 =====")
    print(table.to_string(index=False))
    print("\n읽는 법: 「현재 방식」 줄과 견줘 시간 단위 재현율이 오르고 조치단위 MacroF1 이 0.80 아래로 "
          "내려가지 않는 안을 찾는다. 채택하면 train_weather.py 와 cli.judge 를 같은 규칙으로 고쳐 "
          "다시 학습하고, 성능평가서·모델해시를 새로 낸다(시험 대상이 바뀐다).")
    print(f"\n산출물: {out_dir / 'hourly_recall_experiment.csv'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
