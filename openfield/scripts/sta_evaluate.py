"""STA 시험용 — 고정 모델로 봉인 시험셋을 평가하고 데이터별 결과를 남긴다(학습 없음).

사용 예::

    python scripts/sta_evaluate.py \
        --cache artifacts/dataset.pkl \
        --models artifacts/weather \
        --out sta_ai노지 --seed 42

하는 일

1. 모델 묶음의 sha256 을 `reports/시험의뢰/모델해시.md` 와 대조한다. 하나라도 다르면 멈춘다.
2. `train_weather.py` 와 **같은 함수**(`weather_risk.shared_group_keys`, `split_by_event`)로
   공통 분할을 만들어 시험 인덱스만 쓴다. 학습·검증 자료는 쓰지 않는다.
3. 저장된 모델·판정 가중치·경계 파일을 `train_weather.py` 가 성능평가서 수치를 낼 때와
   같은 판정 경로(`decide_levels` → `ensemble_risk_probability` → `combine_binary`,
   복합위험은 `compound_score` → `compound_level`)로 불러 예측한다.
4. 시점 한 건마다(`02_시점별_결과.csv`), 위험사례 한 건마다(`02_사례별_결과.csv`) 결과를
   적고, 항목별 최종값을 `03_최종결과.json` 으로 낸다.
5. 최종값이 모델 묶음의 `performance.csv` 와 소수 셋째 자리까지 같은지 대조한다.

이 스크립트는 판단 코드(`src/ofdf`)를 고치지 않는다. 지표는 `ofdf.evaluation.metrics`
의 함수로 계산하고, 사례별 값은 여기서 건별로 만든 뒤 그 합계가 `metrics` 함수의
결과와 같은지 실행 중에 확인한다(다르면 멈춘다).

종료 코드: 0 정상 / 1 성능평가서(performance.csv)와 불일치 / 2 시험 대상 확인 실패
(해시·코드·모델 파일) / 3 내부 대조 실패.
"""

from __future__ import annotations

import argparse
import datetime
import json
import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import sta_common  # noqa: E402
from ofdf.evaluation import metrics  # noqa: E402
from ofdf.labels.risk import RISK_LABELS_KO, RISK_TYPES, compose_compound  # noqa: E402
from ofdf.models import weather_risk  # noqa: E402

#: 시험신청서의 기준값. 「결정 필요」 항목이라 설정값으로 둔다(--f1-target, --miss-target).
DEFAULT_F1_TARGET = 0.80
DEFAULT_MISS_TARGET = 0.85

#: STA 조건 「시험 항목별 데이터 30건 이상」
MIN_CASES = 30

MISS_UNIT_KO = {"case": "사례 단위", "hour": "시간 단위"}
TS_FORMAT = "%Y-%m-%d %H:%M"

POINT_COLUMNS = [
    "판정항목", "위험유형", "시계(h)", "시각", "관측지점", "평가단위",
    "정답등급(0·1·2)", "예측등급(0·1·2)", "정답_평가단위", "예측_평가단위", "일치(0/1)",
    "위험사례ID", "확률_정상", "확률_주의", "확률_경계", "판정점수", "판정경계",
]
CASE_COLUMNS = [
    "판정항목", "사례ID", "관측지점", "시작시각", "종료시각", "지속(h)", "탐지(0/1)",
    "첫 탐지 시각", "사전알림(분)", "시작 전 탐지(0/1)",
]


class StopTest(Exception):
    """시험을 계속하면 안 되는 상태."""

    def __init__(self, message: str, code: int = 2):
        super().__init__(message)
        self.code = code


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--cache", required=True, help="작기 데이터셋 캐시 pickle (train_weather.py --cache 와 같은 파일)")
    p.add_argument("--year-round-cache", default=None,
                   help="받기만 하고 쓰지 않는다 — 연중 자료는 학습에만 쓰였다")
    p.add_argument("--aaos-dir", default=None, help="캐시가 없을 때만: 농업기상 월별 파일 디렉터리")
    p.add_argument("--agera5", default=None, help="캐시가 없을 때만: AgERA5 일자료 CSV")
    p.add_argument("--season", default="9,10,11", help="캐시가 없을 때만: 대상 월")
    p.add_argument("--models", required=True, help="고정 모델 묶음 디렉터리 (artifacts/weather)")
    p.add_argument("--out", default="sta_ai노지", help="결과 묶음 디렉터리")
    p.add_argument("--seed", type=int, default=42, help="분할 씨앗 (성능평가서는 42)")
    p.add_argument("--horizons", default="1,3", help="예측시계(시간), 쉼표 구분")
    p.add_argument("--hash-list", default=str(sta_common.DEFAULT_HASH_LIST),
                   help="모델·경계 파일 sha256 목록")
    p.add_argument("--miss-unit", choices=("case", "hour"), default="case",
                   help="놓침 방지율 판정에 쓸 셈법 — case: 사례 단위, hour: 시간 단위. "
                        "세 값(조치단위 F1·사례 단위·시간 단위)은 어느 쪽이든 모두 출력한다")
    p.add_argument("--f1-target", type=float, default=DEFAULT_F1_TARGET, help="종합점수 기준값")
    p.add_argument("--miss-target", type=float, default=DEFAULT_MISS_TARGET, help="놓침 방지율 기준값")
    p.add_argument("--check-only", action="store_true",
                   help="코드·모델 해시만 확인하고 끝낸다(평가하지 않고 결과 파일도 만들지 않는다)")
    p.add_argument("--expect-testset-sha256", default=None,
                   help="봉인한 시험셋(01_시험데이터/시험셋.csv)의 sha256. 다르면 종료 코드 2")
    return p.parse_args(argv)


# --------------------------------------------------------------------------- 자료

def load_dataset(args: argparse.Namespace):
    cache = Path(args.cache)
    if cache.exists():
        print(f"[데이터] 캐시 사용: {cache}")
        return pickle.loads(cache.read_bytes())
    if not (args.aaos_dir and args.agera5):
        raise StopTest(f"데이터셋 캐시가 없습니다: {cache} (--aaos-dir, --agera5 를 주면 원본에서 만듭니다)")
    from ofdf.data.dataset import build

    months = None if args.season == "all" else tuple(int(m) for m in args.season.split(","))
    print("[데이터] 원본에서 생성 중 ... (train_weather.py 와 같은 build 함수)")
    ds = build(args.aaos_dir, args.agera5, season_months=months)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(pickle.dumps(ds))
    return ds


# --------------------------------------------------------------------------- 모델

def _load_member(path: Path, risk: str, horizon: int) -> weather_risk.TrainedRisk:
    """저장된 모델 파일을 학습 때와 같은 자료형(TrainedRisk)으로 읽는다.

    저장할 때 최적 반복 수까지만 잘라 저장하므로(`save`, `save_ensemble`)
    ``best_iteration=0`` (전체 사용)이 학습 때의 예측과 같다.
    """
    import lightgbm as lgb

    booster = sta_common.load_booster(path)
    return weather_risk.TrainedRisk(
        risk=risk, horizon=horizon, booster=booster,
        columns=list(booster.feature_name()), best_iteration=0,
    )


def _need(columns: list[str], X: pd.DataFrame, name: str) -> None:
    missing = [c for c in columns if c not in X.columns]
    if missing:
        raise StopTest(f"{name}: 시험셋에 없는 입력 변수 {missing[:5]} (모델과 데이터셋이 짝이 아님)")


def evaluate(ds, model_dir: Path, horizons: list[int], seed: int) -> tuple[np.ndarray, list[dict]]:
    """고정 모델로 시험셋을 판정한다. ``(시험 인덱스, 항목별 결과)`` 를 돌려준다.

    순서와 규칙은 `train_weather.py` 의 평가 부분과 같다. 학습(`train_one`,
    `oof_risk_proba`)과 경계 선택(`tune_*`)만 없고, 그 자리에서 저장된 파일을 읽는다.
    """
    X = ds.features.reset_index(drop=True)
    meta = ds.meta.reset_index(drop=True)
    states = ds.states.reset_index(drop=True)

    # train_weather.py 와 같은 함수·같은 씨앗으로 공통 분할을 만든다
    shared_groups = weather_risk.shared_group_keys(meta, states)
    train_idx, valid_idx, test_idx = weather_risk.split_by_event(shared_groups, seed=seed)
    print(f"[분할] 학습 {len(train_idx):,} / 검증 {len(valid_idx):,} / 시험 {len(test_idx):,} "
          f"(기상사례 블록 {shared_groups.nunique():,}개 단위, 씨앗 {seed}) — 시험만 쓴다")
    X_test = X.iloc[test_idx]

    base_risks = [r for r in RISK_TYPES if r != "compound"]
    component_preds: dict[int, dict[str, np.ndarray]] = {h: {} for h in horizons}
    compound_probs: dict[int, dict[str, np.ndarray]] = {h: {} for h in horizons}
    items: list[dict] = []

    for risk in base_risks:
        events = ds.events[f"{risk}_event"].reset_index(drop=True)
        for horizon in horizons:
            key = f"{risk}_h{horizon}"
            tag = f"{RISK_LABELS_KO[risk]} {horizon}시간"
            y = ds.labels[key].reset_index(drop=True).fillna(0).astype(int).to_numpy()
            y_test = y[test_idx]
            if (y_test >= 1).sum() == 0:
                print(f"  [건너뜀] {tag}: 시험셋에 위험사례 없음")
                continue

            # 3등급 모델 + 검증셋에서 고른 판정 가중치
            path = model_dir / f"model_{key}.txt"
            if not path.exists():
                raise StopTest(f"모델 없음: {path.name}")
            model = _load_member(path, risk, horizon)
            weight = weather_risk.load_decision_weight(path)
            if weight is None:
                raise StopTest(f"판정 가중치 없음: {path.with_suffix('.weights.json').name}")
            model.decision_weight = weight
            _need(model.columns, X, path.name)
            proba = model.predict_proba(X_test)
            pred_ai = weather_risk.decide_levels(proba, model.decision_weight)

            _, unit = metrics.operational_score(y_test, pred_ai, risk)
            level_ai, decision_score, threshold = pred_ai, None, None
            if unit.startswith("2등급"):
                # 2등급 전용학습 — 교차검증 접힘 모델 평균 확률과 교차검증에서 고른 경계
                stem = f"model_{key}_binary"
                members = [_load_member(p, risk, horizon)
                           for p in weather_risk.ensemble_paths(model_dir, stem)]
                threshold = weather_risk.load_risk_threshold(model_dir / f"{stem}.txt")
                if not members or threshold is None:
                    raise StopTest(f"2등급 전용학습 모델 또는 경계 없음: {stem}")
                for m in members:
                    _need(m.columns, X, stem)
                p_test = weather_risk.ensemble_risk_probability(members, X_test)
                pred_direct = (p_test >= threshold).astype(int)
                if risk in ("rain_wet", "frost"):
                    compound_probs[horizon][risk] = p_test
                # 현장 판정(cli.judge)과 같은 규칙 — 위험 여부는 전용학습, 등급은 3등급 모델
                level_ai = weather_risk.combine_binary(pred_direct, pred_ai)
                decision_score = p_test

            component_preds[horizon][risk] = level_ai
            if risk == "disease":
                members = [_load_member(p, risk, horizon)
                           for p in weather_risk.ensemble_paths(model_dir, f"model_{key}_risk")]
                if members:
                    compound_probs[horizon][risk] = weather_risk.ensemble_risk_probability(
                        members, X_test
                    )

            items.append(_item(risk, horizon, tag, unit, y_test, level_ai, proba,
                               decision_score, threshold, events.iloc[test_idx], meta.iloc[test_idx]))

    # ---- 복합위험: 구성 위험 확률 점수(없으면 등급 조합) ----
    for horizon in horizons:
        parts = component_preds[horizon]
        if not {"rain_wet", "disease", "frost"} <= parts.keys():
            continue
        y_test = (ds.labels[f"compound_h{horizon}"].reset_index(drop=True)
                  .fillna(0).astype(int).to_numpy()[test_idx])
        if (y_test >= 1).sum() == 0:
            continue
        probs = compound_probs[horizon]
        decision_score = threshold = None
        if {"rain_wet", "disease", "frost"} <= probs.keys():
            threshold = weather_risk.load_compound_threshold(model_dir, horizon)
            if threshold is None:
                raise StopTest(f"복합위험 경계 없음: compound_h{horizon}.json")
            decision_score = weather_risk.compound_score(
                probs["rain_wet"], probs["disease"], probs["frost"]
            )
            pred_ai = weather_risk.compound_level(
                decision_score, threshold, parts["rain_wet"], parts["disease"], parts["frost"]
            )
        else:
            pred_ai = compose_compound(parts["rain_wet"], parts["disease"], parts["frost"])
        _, unit = metrics.operational_score(y_test, pred_ai, "compound")
        events = ds.events["compound_event"].reset_index(drop=True)
        tag = f"{RISK_LABELS_KO['compound']} {horizon}시간"
        items.append(_item("compound", horizon, tag, unit, y_test, pred_ai, None,
                           decision_score, threshold, events.iloc[test_idx], meta.iloc[test_idx]))
    return test_idx, items


def _item(risk, horizon, tag, unit, y_test, level, proba, decision_score, threshold,
          events: pd.Series, meta: pd.DataFrame) -> dict:
    """항목 하나의 판정 결과와 지표(기존 metrics 함수로 계산)를 묶는다."""
    op, _ = metrics.operational_score(y_test, level, risk)
    hourly = metrics.score(y_test, level)
    detection = metrics.event_detection(y_test, level, events)
    pre = metrics.pre_onset_detection(meta["ts"], meta["station"], level, events, horizon)
    lead = metrics.lead_time_minutes(meta["ts"], y_test, level, events)
    return {
        "risk": risk, "horizon": horizon, "tag": tag, "unit": unit.split("(")[0].strip(),
        "y": np.asarray(y_test, dtype=int), "level": np.asarray(level, dtype=int),
        "proba": proba, "score": decision_score, "threshold": threshold,
        "events": events.to_numpy(dtype=object),
        "ts": pd.to_datetime(meta["ts"]).to_numpy(), "station": meta["station"].to_numpy(dtype=object),
        "op": op, "hourly": hourly, "detection": detection, "pre": pre, "lead": lead,
    }


# --------------------------------------------------------------------------- 건별 기록

def to_unit(grade: np.ndarray, unit: str) -> np.ndarray:
    """등급(0·1·2)을 평가단위 값으로 바꾼다. 2등급이면 주의·경계를 1(위험)로 합친다."""
    grade = np.asarray(grade, dtype=int)
    return (grade >= 1).astype(int) if unit.startswith("2등급") else grade


def point_rows(item: dict) -> pd.DataFrame:
    """`02_시점별_결과.csv` 의 한 항목분 — 시험셋의 한 시각이 한 줄."""
    n = len(item["y"])
    true_u, pred_u = to_unit(item["y"], item["unit"]), to_unit(item["level"], item["unit"])
    proba = item["proba"]
    frame = pd.DataFrame({
        "판정항목": item["tag"],
        "위험유형": RISK_LABELS_KO[item["risk"]],
        "시계(h)": item["horizon"],
        "시각": pd.to_datetime(item["ts"]).strftime(TS_FORMAT),
        "관측지점": item["station"],
        "평가단위": item["unit"],
        "정답등급(0·1·2)": item["y"],
        "예측등급(0·1·2)": item["level"],
        "정답_평가단위": true_u,
        "예측_평가단위": pred_u,
        "일치(0/1)": (true_u == pred_u).astype(int),
        "위험사례ID": pd.Series(item["events"]).where(pd.notna(item["events"]), ""),
        # 3등급 모델이 낸 등급별 확률(가중치 적용 전). 복합위험은 따로 학습한 모델이 없어 빈칸
        "확률_정상": np.round(proba[:, 0], 6) if proba is not None else [""] * n,
        "확률_주의": np.round(proba[:, 1], 6) if proba is not None else [""] * n,
        "확률_경계": np.round(proba[:, 2], 6) if proba is not None else [""] * n,
        # 위험 여부를 정한 값 — 2등급 유형은 전용학습 앙상블의 P(위험), 복합위험은 구성 확률 점수
        "판정점수": np.round(item["score"], 6) if item["score"] is not None else [""] * n,
        "판정경계": item["threshold"] if item["threshold"] is not None else "",
    })
    return frame[POINT_COLUMNS]


def case_rows(item: dict) -> pd.DataFrame:
    """`02_사례별_결과.csv` 의 한 항목분 — 위험사례 한 건이 한 줄.

    * 사례 = 위험 상태가 이어진 구간(`ofdf.labels.risk.event_ids`). 시험셋에 든 시각만 센다.
    * 탐지 = 사례 구간의 시각 가운데 한 번이라도 예측등급 >= 1 (`metrics.event_detection`).
    * 시작 전 탐지 = 사례 시작 직전 `시계` 시간 안(같은 지점)에 예측등급 >= 1 이 있었는가.
      그 구간이 시험셋에 없으면 빈칸(평가 제외) (`metrics.pre_onset_detection`).
    * 사전알림(분) = 사례 안에서 정답등급 >= 1 인 첫 시각(기준시각)에서, 그 앞 6시간 안의
      첫 경보 시각을 뺀 값. 경보가 없으면 빈칸 (`metrics.lead_time_minutes`).
    """
    frame = pd.DataFrame({
        "ts": item["ts"], "st": item["station"], "true": item["y"], "pred": item["level"],
        "event": item["events"],
    })
    look = frame.set_index(["st", "ts"])["pred"]
    look = look[~look.index.duplicated()]
    alerts = np.sort(frame.loc[frame["pred"] >= 1, "ts"].to_numpy())
    rows = []
    for event, group in frame.dropna(subset=["event"]).groupby("event"):
        group = group.sort_values("ts")
        start, end = group["ts"].iloc[0], group["ts"].iloc[-1]
        station = group["st"].iloc[0]
        hits = group.loc[group["pred"] >= 1, "ts"]

        before = [look.get((station, start - pd.Timedelta(hours=k)))
                  for k in range(1, item["horizon"] + 1)]
        before = [v for v in before if v is not None]
        pre = int(max(before) >= 1) if before else ""

        lead = ""
        onset = group.loc[group["true"] >= 1, "ts"]
        if not onset.empty:
            base = onset.min()
            lo = np.searchsorted(alerts, np.datetime64(base - pd.Timedelta(hours=6)), side="left")
            hi = np.searchsorted(alerts, np.datetime64(base), side="right")
            if hi > lo:
                lead = (base - pd.Timestamp(alerts[lo])).total_seconds() / 60.0
        rows.append({
            "판정항목": item["tag"], "사례ID": event, "관측지점": station,
            "시작시각": start.strftime(TS_FORMAT), "종료시각": end.strftime(TS_FORMAT),
            "지속(h)": len(group), "탐지(0/1)": int(not hits.empty),
            "첫 탐지 시각": hits.min().strftime(TS_FORMAT) if not hits.empty else "",
            "사전알림(분)": lead, "시작 전 탐지(0/1)": pre,
        })
    out = pd.DataFrame(rows, columns=CASE_COLUMNS)
    return out.sort_values(["시작시각", "사례ID"], kind="stable").reset_index(drop=True)


def check_cases(item: dict, cases: pd.DataFrame) -> None:
    """건별로 만든 사례 표의 합계가 기존 metrics 함수의 값과 같은지 본다."""
    det, pre, lead = item["detection"], item["pre"], item["lead"]
    pre_rows = cases[cases["시작 전 탐지(0/1)"] != ""]
    lead_rows = cases[cases["사전알림(분)"] != ""]
    got = {
        "사례 수": (len(cases), det["n_events"]),
        "탐지 사례": (int(cases["탐지(0/1)"].sum()) if len(cases) else 0, det["detected"]),
        "시작 전 평가 사례": (len(pre_rows), pre["n_events"]),
        "시작 전 탐지": (int(pre_rows["시작 전 탐지(0/1)"].sum()) if len(pre_rows) else 0,
                      pre["detected"]),
        "사전알림 사례": (len(lead_rows), lead["n"]),
    }
    bad = [f"{k}: 건별 {a} / metrics {b}" for k, (a, b) in got.items() if a != b]
    if lead["n"] and len(lead_rows):
        mine = float(lead_rows["사전알림(분)"].astype(float).mean())
        if abs(mine - lead["mean_minutes"]) > 1e-6:
            bad.append(f"평균 사전알림: 건별 {mine} / metrics {lead['mean_minutes']}")
    if bad:
        raise StopTest(f"{item['tag']}: 사례별 기록이 metrics 함수와 다름 — " + "; ".join(bad), code=3)


def confusion(item: dict) -> list[list[int]]:
    """평가단위 혼동행렬 — 행: 정답, 열: 예측."""
    size = 2 if item["unit"].startswith("2등급") else 3
    true_u, pred_u = to_unit(item["y"], item["unit"]), to_unit(item["level"], item["unit"])
    matrix = np.zeros((size, size), dtype=int)
    np.add.at(matrix, (true_u, pred_u), 1)
    return matrix.tolist()


# --------------------------------------------------------------------------- 최종값

def _num(value: float) -> float | None:
    return None if value is None or (isinstance(value, float) and np.isnan(value)) else float(value)


def summarise(item: dict, args: argparse.Namespace) -> dict:
    det, pre, lead = item["detection"], item["pre"], item["lead"]
    f1 = float(item["op"].macro_f1)
    by_case = _num(det["detection_rate"])
    by_hour = _num(item["hourly"].risk_recall)
    miss = by_case if args.miss_unit == "case" else by_hour
    f1_ok = f1 >= args.f1_target
    miss_ok = miss is not None and miss >= args.miss_target
    return {
        "판정항목": item["tag"],
        "위험유형": RISK_LABELS_KO[item["risk"]],
        "시계(h)": item["horizon"],
        "평가단위": item["unit"],
        "표본 수": int(len(item["y"])),
        "위험 표본 수": int((item["y"] >= 1).sum()),
        "사례 수": int(det["n_events"]),
        "탐지 사례 수": int(det["detected"]),
        "판정 조치단위F1": f1,
        "사례 단위 놓침 방지율": by_case,
        "시간 단위 재현율(참고)": by_hour,
        "시작 전 평가 사례 수(참고)": int(pre["n_events"]),
        "시작 전 탐지 사례 수(참고)": int(pre["detected"]),
        "시작 전 탐지율(참고)": _num(pre["rate"]),
        "사전알림 사례 수(참고)": int(lead["n"]),
        "평균 사전알림(분)(참고)": _num(lead["mean_minutes"]) if lead["n"] else None,
        "혼동행렬(행 정답·열 예측)": confusion(item),
        "판정경계": item["threshold"],
        "판정": {
            "종합점수": "적합" if f1_ok else "부적합",
            "놓침 방지율": "적합" if miss_ok else "부적합",
            "놓침 방지율 판정에 쓴 값": miss,
        },
        "사례 30건 이상": bool(det["n_events"] >= MIN_CASES),
    }


def compare_performance(summaries: list[dict], model_dir: Path) -> tuple[list[dict], bool]:
    """최종값을 모델 묶음의 performance.csv(성능평가서 수치)와 소수 셋째 자리로 대조한다."""
    path = model_dir / "performance.csv"
    if not path.exists():
        raise StopTest(f"performance.csv 없음: {path}")
    table = pd.read_csv(path, encoding="utf-8-sig")
    table["_유형"] = table["위험유형"].str.replace(r"\(.*\)$", "", regex=True)
    pairs = [
        ("시험 표본", "표본 수", None), ("위험 표본", "위험 표본 수", None),
        ("사례 수", "사례 수", None), ("탐지 사례", "탐지 사례 수", None),
        ("판정 조치단위F1", "판정 조치단위F1", 3), ("이벤트 탐지율", "사례 단위 놓침 방지율", 3),
        ("AI 놓침방지율", "시간 단위 재현율(참고)", 3), ("시작 전 탐지율", "시작 전 탐지율(참고)", 3),
        ("시작 전 평가 사례", "시작 전 평가 사례 수(참고)", None),
        ("사전알림(분)", "평균 사전알림(분)(참고)", 0),
    ]
    rows, all_same = [], True
    if len(table) != len(summaries):
        all_same = False
        rows.append({"판정항목": "(항목 수)", "지표": "항목 수", "performance.csv": len(table),
                     "이번 실행": len(summaries), "일치": "불일치"})
    for s in summaries:
        ref = table[(table["_유형"] == s["위험유형"]) & (table["시계(h)"] == s["시계(h)"])]
        if len(ref) != 1:
            all_same = False
            rows.append({"판정항목": s["판정항목"], "지표": "(행)", "performance.csv": "없음",
                         "이번 실행": "", "일치": "불일치"})
            continue
        ref = ref.iloc[0]
        for ref_col, key, digits in pairs:
            if ref_col not in table.columns:
                continue
            want, got = ref[ref_col], s[key]
            want = None if pd.isna(want) else float(want)
            got = None if got is None else float(round(got, digits) if digits is not None else got)
            same = (want is None and got is None) or (
                want is not None and got is not None and abs(want - got) < 5e-7
            )
            all_same &= same
            rows.append({"판정항목": s["판정항목"], "지표": ref_col, "performance.csv": want,
                         "이번 실행": got, "일치": "일치" if same else "불일치"})
    return rows, all_same


# --------------------------------------------------------------------------- 출력

def write_csv(frame: pd.DataFrame, path: Path) -> None:
    """엑셀에서 바로 열리는 UTF-8(BOM) CSV. 줄바꿈은 OS 와 무관하게 LF 로 고정한다."""
    frame.to_csv(path, index=False, encoding="utf-8-sig", lineterminator="\n")


def write_testset(ds, test_idx: np.ndarray, items: list[dict], out_dir: Path,
                  args: argparse.Namespace, summaries: list[dict]) -> dict[str, str]:
    """`01_시험데이터/` — 시험셋 한 시각이 한 줄(시각·지점·입력 변수·항목별 정답등급·사례ID)."""
    data_dir = out_dir / "01_시험데이터"
    data_dir.mkdir(parents=True, exist_ok=True)
    meta = ds.meta.reset_index(drop=True).iloc[test_idx]
    frame = pd.DataFrame({
        "시각": pd.to_datetime(meta["ts"]).dt.strftime(TS_FORMAT).to_numpy(),
        "관측지점": meta["station"].to_numpy(),
    })
    features = ds.features.reset_index(drop=True).iloc[test_idx].reset_index(drop=True)
    answers = pd.DataFrame({f"정답등급_{it['tag']}": it["y"] for it in items})
    seen: dict[str, np.ndarray] = {}
    for it in items:
        seen.setdefault(f"위험사례ID_{RISK_LABELS_KO[it['risk']]}",
                        pd.Series(it["events"]).where(pd.notna(it["events"]), "").to_numpy())
    frame = pd.concat([frame, features, answers, pd.DataFrame(seen)], axis=1)
    write_csv(frame, data_dir / "시험셋.csv")

    ts = pd.to_datetime(meta["ts"])
    stations = sorted(meta["station"].unique())
    lines = [
        "AI 노지 — 봉인 시험셋 통계",
        f"시험 표본(시각 × 지점): {len(test_idx):,}건",
        f"기간: {ts.min():%Y-%m-%d %H:%M} ~ {ts.max():%Y-%m-%d %H:%M}",
        f"관측지점 {len(stations)}곳: {', '.join(stations)}",
        f"입력 변수 {features.shape[1]}개 / 분할 씨앗 {args.seed} / 기상사례 블록(±12시간) 단위 분할",
        "",
        "판정항목별 건수 (STA 조건: 시험 항목별 데이터 30건 이상)",
        f"{'판정항목':<16}{'시점 표본':>10}{'위험 표본':>10}{'사례 수':>8}  비고",
    ]
    for s in summaries:
        note = "" if s["사례 30건 이상"] else f"⚠ 사례 수 {MIN_CASES}건 미만 (시점 표본은 {MIN_CASES}건 이상)"
        lines.append(f"{s['판정항목']:<16}{s['표본 수']:>10,}{s['위험 표본 수']:>10,}{s['사례 수']:>8,}  {note}")
    if args.aaos_dir and Path(args.aaos_dir).is_dir():
        files = sorted(p.name for p in Path(args.aaos_dir).iterdir() if p.is_file())
        lines += ["", f"원천자료(AAOS 월별 파일): {len(files)}개"]
        if files:
            lines.append(f"  처음 {files[0]} / 마지막 {files[-1]}")
    (data_dir / "통계.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

    hashes = {"01_시험데이터/시험셋.csv": sta_common.sha256_file(data_dir / "시험셋.csv")}
    cache = Path(args.cache)
    if cache.exists():
        hashes[f"(데이터셋 캐시) {cache.name}"] = sta_common.sha256_file(cache)
    (data_dir / "sha256.txt").write_text(
        "".join(f"{v}  {k}\n" for k, v in hashes.items()), encoding="utf-8"
    )
    return hashes


def print_table(summaries: list[dict], args: argparse.Namespace) -> None:
    print("\n===== 항목별 결과 =====")
    print(f"{'판정항목':<14}{'단위':<6}{'표본':>7}{'위험':>6}{'사례':>5}{'탐지':>5}"
          f"{'조치단위F1':>10}{'사례단위':>9}{'시간단위(참고)':>13}  판정(F1/놓침)")
    for s in summaries:
        case = "-" if s["사례 단위 놓침 방지율"] is None else f"{s['사례 단위 놓침 방지율']:.3f}"
        hour = "-" if s["시간 단위 재현율(참고)"] is None else f"{s['시간 단위 재현율(참고)']:.3f}"
        flag = "" if s["사례 30건 이상"] else "  ⚠사례<30"
        print(f"{s['판정항목']:<14}{s['평가단위']:<6}{s['표본 수']:>7,}{s['위험 표본 수']:>6,}"
              f"{s['사례 수']:>5}{s['탐지 사례 수']:>5}{s['판정 조치단위F1']:>10.3f}{case:>9}{hour:>13}"
              f"  {s['판정']['종합점수']}/{s['판정']['놓침 방지율']}{flag}")
    n = len(summaries)
    f1_ok = sum(s["판정"]["종합점수"] == "적합" for s in summaries)
    miss_ok = sum(s["판정"]["놓침 방지율"] == "적합" for s in summaries)
    print(f"\n종합점수(판정 조치단위 Macro F1) >= {args.f1_target}: {f1_ok}/{n} 항목, "
          f"최저 {min(s['판정 조치단위F1'] for s in summaries):.3f}")
    print(f"놓침 방지율({MISS_UNIT_KO[args.miss_unit]}) >= {args.miss_target}: {miss_ok}/{n} 항목 "
          f"[--miss-unit {args.miss_unit}]")
    hour_ok = sum((s["시간 단위 재현율(참고)"] or 0) >= args.miss_target for s in summaries)
    case_ok = sum((s["사례 단위 놓침 방지율"] or 0) >= args.miss_target for s in summaries)
    print(f"  사례 단위 {case_ok}/{n} · 시간 단위(참고) {hour_ok}/{n}")
    short = [s["판정항목"] for s in summaries if not s["사례 30건 이상"]]
    if short:
        print(f"⚠ 사례 수 {MIN_CASES}건 미만 항목: {', '.join(short)} — 그대로 보고한다(시점 표본은 모두 {MIN_CASES}건 이상)")


def run(args: argparse.Namespace) -> int:
    out_dir = Path(args.out)
    if not args.check_only:
        out_dir.mkdir(parents=True, exist_ok=True)
    model_dir = Path(args.models)
    horizons = [int(h) for h in args.horizons.split(",")]
    started = datetime.datetime.now().astimezone()
    print(f"[시작] {started:%Y-%m-%d %H:%M:%S %z} — AI 노지 고정 모델 평가(학습 없음)")

    # 1) 시험 대상 고정 — 코드, 모델
    git = sta_common.git_state()
    print(f"[코드] 현재 커밋 {git['현재 커밋']} / 시험 대상 커밋 {git['시험 대상 커밋']}")
    if git["판단코드_동일"] is False or git["판단코드_해시대조"] is False:
        for line in git.get("판단코드_해시대조_문제", []):
            print(f"  [코드] {line}")
        raise StopTest(f"판단 코드(src/ofdf)가 시험 대상 커밋 {git['시험 대상 커밋']} 과 다릅니다")
    print("[코드] 판단 코드(src/ofdf) git 비교: "
          + ("시험 대상 커밋과 같음" if git["판단코드_동일"] else "비교 불가(git 저장소가 아니거나 커밋 없음)"))
    print("[코드] 판단 코드(src/ofdf) 해시 목록 대조: "
          + {True: f"일치 ({sta_common.CODE_HASH_LIST.name})", None: "목록 없음"}[git["판단코드_해시대조"]])
    if git["판단코드_동일"] is None and git["판단코드_해시대조"] is None:
        raise StopTest("판단 코드가 시험 대상 커밋과 같은지 확인할 방법이 없습니다(git 도 해시 목록도 없음)")

    model_hashes, problems = sta_common.verify_model_hashes(model_dir, args.hash_list)
    if problems:
        for line in problems:
            print(f"  [해시] {line}")
        raise StopTest(f"모델 묶음이 해시 목록과 다릅니다({len(problems)}건) — 시험을 멈춥니다. "
                       "다시 학습하지 말고 보관한 고정 모델 묶음을 쓰십시오")
    print(f"[해시] 모델·경계 파일 {len(model_hashes)}개 모두 해시 목록과 일치 ({Path(args.hash_list).name})")
    if args.check_only:
        for name, digest in model_hashes.items():
            print(f"  일치  {digest}  {name}")
        cache = Path(args.cache)
        if cache.exists():
            print(f"[해시] 데이터셋 캐시 {cache.name}: {sta_common.sha256_file(cache)}")
        print("[완료] 확인만 했습니다(--check-only)")
        return 0

    # 2) 평가
    ds = load_dataset(args)
    print(f"[데이터] {len(ds):,} 시간 x {ds.features.shape[1]} 피처")
    test_idx, items = evaluate(ds, model_dir, horizons, args.seed)
    if not items:
        raise StopTest("평가할 항목이 없습니다")

    # 3) 건별 기록
    points, cases = [], []
    for item in items:
        points.append(point_rows(item))
        one = case_rows(item)
        check_cases(item, one)
        cases.append(one)
    write_csv(pd.concat(points, ignore_index=True), out_dir / "02_시점별_결과.csv")
    write_csv(pd.concat(cases, ignore_index=True), out_dir / "02_사례별_결과.csv")

    # 4) 최종값
    summaries = [summarise(item, args) for item in items]
    print_table(summaries, args)
    data_hashes = write_testset(ds, test_idx, items, out_dir, args, summaries)
    testset_sha = data_hashes["01_시험데이터/시험셋.csv"]
    print(f"\n[해시] 시험셋.csv sha256 {testset_sha}")
    sealed_ok = True
    if args.expect_testset_sha256:
        sealed_ok = testset_sha == args.expect_testset_sha256.strip().lower()
        print("[해시] 봉인한 시험셋 해시와 " + ("일치" if sealed_ok else
              f"다름 — 기대 {args.expect_testset_sha256}"))
    result_hashes = {
        name: sta_common.sha256_file(out_dir / name)
        for name in ("02_시점별_결과.csv", "02_사례별_결과.csv")
    }

    rows, same = compare_performance(summaries, model_dir)
    bad = [r for r in rows if r["일치"] != "일치"]
    print(f"\n[대조] performance.csv(성능평가서 수치)와 {len(rows)}개 값 비교 → "
          + ("모두 일치" if same else f"불일치 {len(bad)}건"))
    for r in bad:
        print(f"  불일치: {r['판정항목']} {r['지표']} — performance.csv {r['performance.csv']} / 이번 {r['이번 실행']}")

    n = len(summaries)
    final = {
        "시험명": "노지 대파 재해위험 판단 AI 모델 — 고정 모델 봉인 시험셋 평가",
        "실행 시각": started.isoformat(timespec="seconds"),
        "커밋": git,
        "설정": {"분할 씨앗": args.seed, "예측시계(h)": horizons, "miss-unit": args.miss_unit},
        "봉인 시험셋 대조": ({"기대 sha256": args.expect_testset_sha256,
                         "결과": "일치" if sealed_ok else "불일치"}
                        if args.expect_testset_sha256 else "미지정"),
        "기준": {
            "종합점수": {"지표": "판정 조치단위 Macro F1 (시점 표본)", "기준값": args.f1_target,
                       "비교": "이상"},
            "놓침 방지율": {"셈법": MISS_UNIT_KO[args.miss_unit], "기준값": args.miss_target,
                         "비교": "이상",
                         "비고": "셈법·기준값은 설정값이다(--miss-unit, --miss-target). "
                                "사례 단위·시간 단위 값을 모두 싣는다"},
            "항목별 최소 데이터 건수": MIN_CASES,
        },
        "종합": {
            "항목 수": n,
            "종합점수 적합 항목 수": sum(s["판정"]["종합점수"] == "적합" for s in summaries),
            "종합점수 최저": min(s["판정 조치단위F1"] for s in summaries),
            "놓침 방지율 적합 항목 수": sum(s["판정"]["놓침 방지율"] == "적합" for s in summaries),
            "놓침 방지율 최저(판정에 쓴 값)": min(
                (s["판정"]["놓침 방지율 판정에 쓴 값"] for s in summaries
                 if s["판정"]["놓침 방지율 판정에 쓴 값"] is not None), default=None),
            "사례 단위 0.85 이상 항목 수": sum(
                (s["사례 단위 놓침 방지율"] or 0) >= args.miss_target for s in summaries),
            "시간 단위 0.85 이상 항목 수(참고)": sum(
                (s["시간 단위 재현율(참고)"] or 0) >= args.miss_target for s in summaries),
            "사례 30건 미만 항목": [s["판정항목"] for s in summaries if not s["사례 30건 이상"]],
        },
        "항목별": summaries,
        "성능평가서 대조": {"대상": "performance.csv", "자릿수": "소수 셋째 자리",
                        "결과": "일치" if same else "불일치", "불일치": bad},
        "sha256": {"모델·경계 파일": model_hashes, "시험데이터": data_hashes, "결과 로그": result_hashes},
        "실행 환경": sta_common.environment(),
    }
    (out_dir / "03_최종결과.json").write_text(
        json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    lines = ["AI 노지 — 시험 대상 해시", f"실행 시각: {final['실행 시각']}",
             f"현재 커밋: {git['현재 커밋']}", f"시험 대상 커밋(판단 코드): {git['시험 대상 커밋']}",
             f"판단 코드(src/ofdf) 동일 여부: {git['판단코드_동일']}", "",
             f"[모델·판정 경계 파일] {model_dir} — {Path(args.hash_list).name} 과 대조 일치"]
    lines += [f"{v}  {k}" for k, v in model_hashes.items()]
    lines += ["", "[시험데이터]"] + [f"{v}  {k}" for k, v in data_hashes.items()]
    lines += ["", "[결과 로그]"] + [f"{v}  {k}" for k, v in result_hashes.items()]
    lines += ["", "[실행 코드]"] + [f"{v}  {k}" for k, v in sta_common.code_hashes().items()]
    (out_dir / "00_시험대상_해시.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

    took = (datetime.datetime.now().astimezone() - started).total_seconds()
    print(f"\n산출물: {out_dir}  (소요 {took:.1f}초)")
    for name in ("00_시험대상_해시.txt", "01_시험데이터/", "02_시점별_결과.csv", "02_사례별_결과.csv",
                 "03_최종결과.json", "05_실행로그.txt"):
        print(f"  {name}")
    if not sealed_ok:
        print("[중단] 시험셋이 봉인한 것과 다릅니다 — 결과를 쓰지 마십시오")
        return 2
    if not same:
        print("[실패] performance.csv 와 다릅니다 — 원인을 찾기 전에는 끝난 것으로 보지 않습니다")
        return 1
    print("[완료] 다음: python scripts/sta_recompute.py --dir " + str(out_dir))
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    def guarded() -> int:
        print("$ python scripts/sta_evaluate.py " + " ".join(argv if argv is not None else sys.argv[1:]))
        try:
            return run(args)
        except StopTest as stop:
            print(f"[중단] {stop}")
            return stop.code

    if args.check_only:
        return guarded()
    with sta_common.Tee(Path(args.out) / "05_실행로그.txt"):
        return guarded()


if __name__ == "__main__":
    raise SystemExit(main())
