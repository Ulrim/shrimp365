"""기상 기반 농지위험 판단 모델 학습·평가.

사용 예::

    python scripts/train_weather.py \
        --aaos-dir data/raw/aaos \
        --agera5 data/raw/agera5_naju_daily.csv \
        --out artifacts/weather

위험유형 x 예측시계마다 LightGBM 을 학습하고, 같은 시험데이터에서
단순 기준값 규칙 및 로지스틱 회귀와 성능을 비교한다.
"""

from __future__ import annotations

import argparse
import json
import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ofdf.data.dataset import build  # noqa: E402
from ofdf.evaluation import metrics  # noqa: E402
from ofdf.labels.risk import RISK_LABELS_KO, RISK_TYPES, compose_compound  # noqa: E402
from ofdf.models import weather_risk  # noqa: E402
from ofdf.models.baseline import LogisticBaseline, RuleBaseline  # noqa: E402


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--aaos-dir", required=True, help="농업기상 월별 파일 디렉터리")
    p.add_argument("--agera5", required=True, help="AgERA5 일자료 CSV")
    p.add_argument("--out", default="artifacts/weather", help="산출물 디렉터리")
    p.add_argument("--cache", default=None, help="데이터셋 캐시 pickle 경로")
    p.add_argument("--horizons", default="1,3", help="예측시계(시간), 쉼표 구분")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument(
        "--season", default="9,10,11", help="대상 월. 'all' 이면 연중 전체"
    )
    return p.parse_args()


def load_dataset(args: argparse.Namespace):
    cache = Path(args.cache) if args.cache else None
    if cache and cache.exists():
        print(f"[데이터] 캐시 사용: {cache}")
        return pickle.loads(cache.read_bytes())

    months = None if args.season == "all" else tuple(int(m) for m in args.season.split(","))
    print("[데이터] 원본에서 생성 중 ...")
    ds = build(args.aaos_dir, args.agera5, season_months=months)
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(pickle.dumps(ds))
    return ds


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    horizons = [int(h) for h in args.horizons.split(",")]

    ds = load_dataset(args)
    print(f"[데이터] {len(ds):,} 시간 x {ds.features.shape[1]} 피처")
    if ds.qc is not None:
        print(f"[품질] 이상표시 {sum(ds.qc.flagged.values()):,}건 / "
              f"중복 {ds.qc.duplicates} / 결측시각 {ds.qc.gaps}")

    X = ds.features.reset_index(drop=True)
    meta = ds.meta.reset_index(drop=True)

    results: dict[str, dict[str, metrics.RiskScore]] = {
        "단순 기준값 규칙": {}, "로지스틱 회귀(현재값)": {}, "LightGBM(AI)": {},
    }
    rows, explanations = [], {}
    # 복합위험은 구성 위험 예측을 조합해 만든다(독립 학습하지 않는다)
    base_risks = [r for r in RISK_TYPES if r != "compound"]
    component_preds: dict[int, dict[str, np.ndarray]] = {h: {} for h in horizons}

    # 모든 위험유형이 같은 시험셋을 쓰도록 공통 분할을 한 번만 만든다.
    # 그래야 복합위험을 구성 위험 예측으로 조합할 수 있다.
    states = ds.states.reset_index(drop=True)
    shared_groups = weather_risk.shared_group_keys(meta, states)
    train_idx, valid_idx, test_idx = weather_risk.split_by_event(shared_groups, seed=args.seed)
    print(f"[분할] 학습 {len(train_idx):,} / 검증 {len(valid_idx):,} / 시험 {len(test_idx):,} "
          f"(기상사례 블록 {shared_groups.nunique():,}개 단위)")
    # 판정 경계를 고를 표본 — 학습+검증 전체의 교차검증 예측. 시험셋은 쓰지 않는다.
    dev_idx = np.sort(np.concatenate([train_idx, valid_idx]))
    group_arr = shared_groups.to_numpy()
    # 복합위험 점수용 구성 위험 확률 — 교차검증(oof)과 시험(test)
    compound_parts: dict[int, dict[str, dict[str, np.ndarray]]] = {
        h: {"oof": {}, "test": {}} for h in horizons
    }

    for risk in base_risks:
        events = ds.events[f"{risk}_event"].reset_index(drop=True)

        for horizon in horizons:
            key = f"{risk}_h{horizon}"
            y = ds.labels[key].reset_index(drop=True).fillna(0).astype(int).to_numpy()
            tag = f"{RISK_LABELS_KO[risk]} {horizon}시간"

            if (y[test_idx] >= 1).sum() == 0:
                print(f"  [건너뜀] {tag}: 시험셋에 위험사례 없음")
                continue

            # 1) 단순 기준값 규칙 — 현재 상태등급을 그대로 예측으로 쓴다
            pred_rule = RuleBaseline().predict(states[risk].iloc[test_idx])

            # 2) 로지스틱 회귀 — 현재값만
            logistic = LogisticBaseline().fit(X.iloc[train_idx], y[train_idx])
            pred_logit = logistic.predict(X.iloc[test_idx])

            # 3) LightGBM — 변화추세·지속시간 포함 전체 피처
            model = weather_risk.train_one(
                X, y, train_idx, valid_idx, risk=risk, horizon=horizon
            )
            pred_ai = model.predict(X.iloc[test_idx])

            y_test = y[test_idx]
            s_rule = metrics.score(y_test, pred_rule)
            s_logit = metrics.score(y_test, pred_logit)
            s_ai = metrics.score(y_test, pred_ai)

            # 조치 단위 평가 — 주의와 경계가 같은 조치를 내는 유형은 2등급으로 잰다
            op_rule, unit = metrics.operational_score(y_test, pred_rule, risk)
            op_ai, _ = metrics.operational_score(y_test, pred_ai, risk)

            # 2등급 유형은 조치 단위로 **직접 학습한** 모델도 함께 잰다.
            # 3등급 모델의 예측을 접는 것과 다르다 — 맞혀야 할 대상이 다르면
            # 학습도 그 대상으로 해야 한다.
            op_direct = None
            level_ai = pred_ai
            if unit.startswith("2등급"):
                binary_y = (y >= 1).astype(int)
                # train_one 은 num_class 를 3 으로 고정한다. 라벨이 0/1 뿐이라
                # 2번 등급 확률은 0 에 가깝고, 판정은 P(주의 이상)=p1+p2 로 한다.
                # 전용학습 = 학습+검증 5겹 교차검증의 접힘 모델 앙상블.
                # 경계를 교차검증 예측에서 고르므로, 판정도 그 접힘 모델들의
                # 평균으로 한다(weather_risk.ensemble_risk_probability).
                oof, members = weather_risk.oof_risk_proba(
                    X, binary_y, dev_idx, group_arr,
                    risk=risk, horizon=horizon, return_models=True,
                )
                threshold = weather_risk.tune_risk_threshold(oof[dev_idx], binary_y[dev_idx])
                print(f"    [경계] {tag} 전용학습 P(위험) >= {threshold:.2f} "
                      f"(교차검증 {len(dev_idx):,}시간에서 선택)")
                p_test = weather_risk.ensemble_risk_probability(members, X.iloc[test_idx])
                pred_direct = (p_test >= threshold).astype(int)
                if risk in ("rain_wet", "frost"):
                    compound_parts[horizon]["oof"][risk] = oof
                    compound_parts[horizon]["test"][risk] = p_test
                op_direct = metrics.binary_score(binary_y[test_idx], pred_direct)
                for stale in out_dir.glob(f"model_{key}_binary.txt"):
                    stale.unlink()
                weather_risk.save_ensemble(
                    members, out_dir, f"model_{key}_binary", risk_threshold=threshold
                )
                # 현장 판정(cli.judge)과 같은 규칙 — 위험 여부는 전용학습,
                # 주의·경계 구분은 3등급 모델. 복합위험 조합도 이 등급을 쓴다.
                level_ai = weather_risk.combine_binary(pred_direct, pred_ai)

            # 놓침방지·오경보·사전알림은 **현장이 실제로 내는 판정**(level_ai)으로
            # 잰다. 전용학습이 있는 유형에서 3등급 모델 값을 쓰면 F1 과 재현율이
            # 서로 다른 모델의 수치가 된다.
            s_dep = metrics.score(y_test, level_ai)
            results["단순 기준값 규칙"][tag] = s_rule
            results["로지스틱 회귀(현재값)"][tag] = s_logit
            results["LightGBM(AI)"][tag] = s_dep

            gain = metrics.improvement(s_rule, s_dep)
            detection = metrics.event_detection(y_test, level_ai, events.iloc[test_idx])
            lead = metrics.lead_time_minutes(
                meta.iloc[test_idx]["ts"], y_test, level_ai, events.iloc[test_idx]
            )

            rows.append(
                {
                    "위험유형": RISK_LABELS_KO[risk],
                    "시계(h)": horizon,
                    "시험 표본": s_ai.n_samples,
                    "위험 표본": s_ai.n_risk,
                    "규칙 MacroF1": round(s_rule.macro_f1, 3),
                    "로지스틱 MacroF1": round(s_logit.macro_f1, 3),
                    "3등급 MacroF1": round(s_ai.macro_f1, 3),
                    "AI MacroF1": round(s_dep.macro_f1, 3),
                    "평가단위": unit.split("(")[0],
                    "규칙 조치단위F1": round(op_rule.macro_f1, 3),
                    "AI 조치단위F1": round(op_ai.macro_f1, 3),
                    "전용학습 조치단위F1": round(op_direct.macro_f1, 3) if op_direct else None,
                    # 목표 판정에 쓰는 값 — 현장 판정(level_ai)의 조치단위 F1
                    "판정 조치단위F1": round((op_direct or op_ai).macro_f1, 3),
                    "조치단위 개선(%p)": round(
                        ((op_direct or op_ai).macro_f1 - op_rule.macro_f1) * 100, 1
                    ),
                    "AI 놓침방지율": round(s_dep.risk_recall, 3),
                    "규칙 놓침방지율": round(s_rule.risk_recall, 3),
                    "AI 오경보율": round(s_dep.false_alarm_rate, 3),
                    "MacroF1 개선(%p)": round(gain["macro_f1_gain_pp"], 1),
                    "놓침방지 개선(%p)": round(gain["risk_recall_gain_pp"], 1),
                    "이벤트 탐지율": round(detection["detection_rate"], 3),
                    "사전알림(분)": round(lead["mean_minutes"], 0) if lead["n"] else None,
                }
            )

            component_preds[horizon][risk] = level_ai
            if risk == "disease":
                # 복합위험 점수에 들어가는 병해 확률도 같은 이유로 접힘 앙상블을 쓴다.
                d_oof, d_members = weather_risk.oof_risk_proba(
                    X, y, dev_idx, group_arr, risk=risk, horizon=horizon, return_models=True,
                )
                compound_parts[horizon]["oof"][risk] = d_oof
                compound_parts[horizon]["test"][risk] = weather_risk.ensemble_risk_probability(
                    d_members, X.iloc[test_idx]
                )
                weather_risk.save_ensemble(d_members, out_dir, f"model_{key}_risk")

            weather_risk.save(model, out_dir / f"model_{key}.txt")
            explanations[key] = weather_risk.feature_importance(model).to_dict("records")
            direct_text = f" / 전용학습 {op_direct.macro_f1:.3f}" if op_direct else ""
            print(f"  [완료] {tag}: 3등급 F1 {s_ai.macro_f1:.3f} / "
                  f"조치단위 F1 {op_ai.macro_f1:.3f}{direct_text} "
                  f"({unit.split('(')[0].strip()}) / 놓침방지 {s_dep.risk_recall:.3f}")

    # ---- 복합위험: 구성 위험 예측 조합 ----
    for horizon in horizons:
        parts = component_preds[horizon]
        if not {"rain_wet", "disease", "frost"} <= parts.keys():
            continue
        y_test = ds.labels[f"compound_h{horizon}"].reset_index(drop=True).fillna(0).astype(int).to_numpy()[test_idx]
        if (y_test >= 1).sum() == 0:
            continue

        probs = compound_parts[horizon]
        scored = {"rain_wet", "disease", "frost"} <= probs["oof"].keys()
        if scored:
            y_all = ds.labels[f"compound_h{horizon}"].reset_index(drop=True).fillna(0).astype(int).to_numpy()
            oof_score = weather_risk.compound_score(
                probs["oof"]["rain_wet"], probs["oof"]["disease"], probs["oof"]["frost"]
            )
            threshold = weather_risk.tune_risk_threshold(
                oof_score[dev_idx], (y_all[dev_idx] >= 1).astype(int)
            )
            weather_risk.save_compound_threshold(out_dir, horizon, threshold)
            print(f"    [경계] 복합위험 {horizon}시간 점수 >= {threshold:.2f} (교차검증에서 선택)")
            test_score = weather_risk.compound_score(
                probs["test"]["rain_wet"], probs["test"]["disease"], probs["test"]["frost"]
            )
            pred_ai = weather_risk.compound_level(
                test_score, threshold, parts["rain_wet"], parts["disease"], parts["frost"]
            )
        else:
            pred_ai = compose_compound(parts["rain_wet"], parts["disease"], parts["frost"])
        pred_rule = states["compound"].iloc[test_idx].to_numpy()

        s_rule = metrics.score(y_test, pred_rule)
        s_ai = metrics.score(y_test, pred_ai)
        op_rule, unit = metrics.operational_score(y_test, pred_rule, "compound")
        op_ai, _ = metrics.operational_score(y_test, pred_ai, "compound")
        tag = f"{RISK_LABELS_KO['compound']} {horizon}시간"
        results["단순 기준값 규칙"][tag] = s_rule
        results["LightGBM(AI)"][tag] = s_ai

        events = ds.events["compound_event"].reset_index(drop=True)
        gain = metrics.improvement(s_rule, s_ai)
        detection = metrics.event_detection(y_test, pred_ai, events.iloc[test_idx])
        lead = metrics.lead_time_minutes(meta.iloc[test_idx]["ts"], y_test, pred_ai, events.iloc[test_idx])
        rows.append({
            "위험유형": RISK_LABELS_KO["compound"] + ("(점수)" if scored else "(조합)"),
            "시계(h)": horizon,
            "시험 표본": s_ai.n_samples, "위험 표본": s_ai.n_risk,
            "규칙 MacroF1": round(s_rule.macro_f1, 3), "로지스틱 MacroF1": None,
            "3등급 MacroF1": None,
            "AI MacroF1": round(s_ai.macro_f1, 3),
            "평가단위": unit.split("(")[0],
            "규칙 조치단위F1": round(op_rule.macro_f1, 3),
            "AI 조치단위F1": round(op_ai.macro_f1, 3),
            "전용학습 조치단위F1": None,
            "판정 조치단위F1": round(op_ai.macro_f1, 3),
            "조치단위 개선(%p)": round((op_ai.macro_f1 - op_rule.macro_f1) * 100, 1),
            "AI 놓침방지율": round(s_ai.risk_recall, 3), "규칙 놓침방지율": round(s_rule.risk_recall, 3),
            "AI 오경보율": round(s_ai.false_alarm_rate, 3),
            "MacroF1 개선(%p)": round(gain["macro_f1_gain_pp"], 1),
            "놓침방지 개선(%p)": round(gain["risk_recall_gain_pp"], 1),
            "이벤트 탐지율": round(detection["detection_rate"], 3),
            "사전알림(분)": round(lead["mean_minutes"], 0) if lead["n"] else None,
        })
        print(f"  [완료] {tag}(조합): AI MacroF1 {s_ai.macro_f1:.3f} (규칙 {s_rule.macro_f1:.3f})")

    table = pd.DataFrame(rows)
    table.to_csv(out_dir / "performance.csv", index=False, encoding="utf-8-sig")
    (out_dir / "feature_importance.json").write_text(
        json.dumps(explanations, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    pd.set_option("display.width", 250)
    print("\n===== 성능 비교 =====")
    print(table.to_string(index=False))
    print(f"\n산출물: {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
