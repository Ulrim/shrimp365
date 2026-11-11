"""기상 기반 농지위험 판단 모델.

위험유형 x 예측시계(1시간/3시간)마다 LightGBM 다중분류기를 하나씩 학습해
정상/주의/경계를 판정한다. 사업계획서가 '현장 적용이 쉬운 모델 우선'으로
LightGBM·XGBoost를 1순위 후보로 둔 설계를 따른다.

위험사례가 전체의 몇 %뿐이라 클래스 가중치를 넣고, 성능은 정확도가 아니라
위험유형별 Macro F1과 위험 놓침 방지율로 본다.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupShuffleSplit

try:
    import lightgbm as lgb
except ImportError:  # pragma: no cover
    lgb = None


DEFAULT_PARAMS = {
    "objective": "multiclass",
    "num_class": 3,
    "learning_rate": 0.05,
    "num_leaves": 63,
    "min_data_in_leaf": 50,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 1.0,
    "verbose": -1,
    "num_threads": 0,
}


@dataclass
class TrainedRisk:
    """위험유형 x 시계 하나에 대한 학습 결과."""

    risk: str
    horizon: int
    booster: object
    columns: list[str]
    best_iteration: int
    class_weight: dict[int, float] = field(default_factory=dict)
    #: 판정 시 등급별 확률에 곱하는 값. 검증셋에서 고른다.
    decision_weight: list[float] = field(default_factory=lambda: [1.0, 1.0, 1.0])
    #: 2등급 전용학습 모델의 위험 판정 경계(P(위험) >= 경계 이면 위험).
    #: 학습+검증 교차검증 예측에서 고른다(:func:`tune_risk_threshold`).
    #: 있으면 ``decision_weight`` 대신 이것으로 판정한다.
    risk_threshold: float | None = None

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        proba = self.predict_proba(X)
        if self.risk_threshold is not None:
            return decide_risk(proba, self.risk_threshold)
        return decide_levels(proba, self.decision_weight)

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        return self.booster.predict(
            X[self.columns], num_iteration=self.best_iteration or None
        )


def group_keys(meta: pd.DataFrame, events: pd.Series) -> pd.Series:
    """누수 없는 분할을 위한 그룹 키를 만든다.

    사업계획서의 '학습·검증·시험 데이터는 날짜가 아닌 개별 기상사례 단위로
    분리' 규칙이다. 위험 구간은 이벤트 번호로, 평상 구간은 (지점, 날짜)
    블록으로 묶는다. 같은 기상사례가 학습셋과 시험셋에 쪼개져 들어가면
    성능이 부풀려진다.
    """
    normal_key = meta["station"] + "#평상#" + meta["ts"].dt.date.astype(str)
    return events.where(events.notna(), normal_key)


def shared_group_keys(
    meta: pd.DataFrame,
    states: pd.DataFrame,
    *,
    risks: list[str] | None = None,
    gap_hours: int = 12,
) -> pd.Series:
    """위험유형·**지점** 전체에 공통으로 쓸 그룹 키를 만든다.

    어느 유형이든, **어느 지점이든** 위험이 걸린 시각을 합집합으로 묶어
    하나의 기상사례 블록으로 보고, 그 블록 단위로 나눈다. 키에 지점 이름이
    들어가지 않는다 — 같은 시각의 모든 지점 행이 같은 블록에 들어간다.

    예전에는 지점별로 블록을 만들었다. 그런데 관측 지점들이 서로 가까워
    (나주 5개 지점) 같은 비가 거의 동시에 내린다. 지점별로 나누면 같은
    강우의 A지점 기록이 학습에, B지점 기록이 시험에 들어가 성능이 부풀려진다.
    학습+검증 교차검증으로 재면 강우·과습 3시간 F1 이 지점 블록 0.840,
    시간 블록 0.733 이었다(다른 유형은 차이 0.012 이하). 사업계획서의
    '동일 강우·폭염 구간이 서로 다른 분석용 데이터에 중복되는 것을 방지'
    하려면 시간으로 나눠야 한다.

    블록 앞뒤 ``gap_hours`` 시간은 같은 블록에 포함시킨다. 사건 직전·직후의
    평상 시간이 다른 분할로 새어 나가면 선행 신호가 누수되기 때문이다.
    평상 구간은 날짜 단위로 묶는다(지점 구분 없음).
    """
    from ofdf.labels.risk import RISK_TYPES

    targets = risks or [r for r in RISK_TYPES if r in states.columns]
    ts = pd.to_datetime(meta["ts"])

    # 시각별로 '어느 지점이든 위험' 여부를 모은 뒤 빈 시각을 메운다
    active = (states[targets] > 0).any(axis=1).groupby(ts.to_numpy()).any().sort_index()
    grid = pd.date_range(active.index.min(), active.index.max(), freq="h")
    active = active.reindex(grid, fill_value=False)

    # 사건 전후 gap_hours 를 같은 블록으로 끌어들인다(팽창)
    padded = active.rolling(2 * gap_hours + 1, center=True, min_periods=1).max().astype(bool)
    block = (padded & ~padded.shift(fill_value=False)).cumsum()
    key = pd.Series(
        np.where(padded.to_numpy(), "사례" + block.astype(str), "평상" + grid.strftime("%Y-%m-%d")),
        index=grid,
    )
    return pd.Series(key.reindex(ts.to_numpy()).to_numpy(), index=meta.index, dtype=object)


def split_by_event(
    groups: pd.Series, *, test_size: float = 0.2, valid_size: float = 0.2, seed: int = 42
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """그룹 단위로 학습/검증/시험 인덱스를 나눈다."""
    idx = np.arange(len(groups))
    g = groups.to_numpy()

    outer = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=seed)
    rest_idx, test_idx = next(outer.split(idx, groups=g))

    inner = GroupShuffleSplit(n_splits=1, test_size=valid_size, random_state=seed)
    train_rel, valid_rel = next(inner.split(rest_idx, groups=g[rest_idx]))
    return rest_idx[train_rel], rest_idx[valid_rel], test_idx


#: 판정 가중치를 고를 때 지켜야 할 놓침 방지율 하한.
#: 사업계획서가 1순위로 둔 지표가 이것이므로, F1 을 올리려고 이 값을
#: 깎는 선택은 애초에 후보에서 뺀다.
RISK_RECALL_FLOOR = 0.85


def decide_levels(proba: np.ndarray, weight: Sequence[float] | None = None) -> np.ndarray:
    """등급별 확률에서 최종 등급을 고른다."""
    if weight is None:
        return proba.argmax(axis=1)
    w = np.asarray(weight, dtype=float)[: proba.shape[1]]
    return (proba * w).argmax(axis=1)


def risk_probability(proba: np.ndarray) -> np.ndarray:
    """등급별 확률에서 '주의 이상'일 확률을 낸다."""
    proba = np.asarray(proba, dtype=float)
    return proba[:, 1:].sum(axis=1)


def decide_risk(proba: np.ndarray, threshold: float) -> np.ndarray:
    """P(주의 이상) 이 경계 이상이면 1(위험), 아니면 0."""
    return (risk_probability(proba) >= threshold).astype(int)


def wilson_lower(hits: int, total: int, z: float = 1.96) -> float:
    """비율의 95% 윌슨 신뢰하한."""
    if total <= 0:
        return 0.0
    p = hits / total
    denom = 1 + z * z / total
    centre = p + z * z / (2 * total)
    margin = z * np.sqrt(p * (1 - p) / total + z * z / (4 * total * total))
    return float((centre - margin) / denom)


def tune_risk_threshold(
    score: np.ndarray,
    y_risk: np.ndarray,
    *,
    recall_floor: float = RISK_RECALL_FLOOR,
) -> float:
    """위험 판정 경계를 고른다 — 놓침 방지율 **신뢰하한**이 하한 이상인 것 중
    Macro F1 이 가장 높은 경계.

    점추정 재현율을 0.85 에 맞추면 시험셋에서 표본 오차만큼 아래로 떨어진다
    (강우·과습 3시간이 교차검증 0.850 → 시험 0.842 였다). 재해 경보에서
    놓침 방지율은 1순위 지표이므로, 표본 크기를 반영한 95% 하한으로 지킨다.
    ``score`` 는 **시험셋이 아닌** 예측(교차검증 등)이어야 한다.
    """
    from sklearn.metrics import f1_score

    y_risk = np.asarray(y_risk, dtype=int)
    score = np.asarray(score, dtype=float)
    total = int(y_risk.sum())
    best_t, best_f = None, -1.0
    for t in np.linspace(0.02, 0.98, 97):
        pred = (score >= t).astype(int)
        if pred.sum() == 0:
            continue
        if wilson_lower(int(pred[y_risk == 1].sum()), total) < recall_floor:
            continue
        f = f1_score(y_risk, pred, average="macro", zero_division=0)
        if f > best_f:
            best_t, best_f = float(t), f
    # 하한을 지키는 경계가 없으면 가장 민감한 경계를 쓴다(놓침 방지 우선)
    return best_t if best_t is not None else 0.02


def compound_score(p_wet: np.ndarray, p_disease: np.ndarray, p_frost: np.ndarray) -> np.ndarray:
    """복합위험 점수 — P(과습) x max(P(병해 유리), P(서리)).

    복합위험은 '강우·과습 + 병해 유리환경' 또는 '과습 + 저온·서리'가 겹친
    상태다(:func:`ofdf.labels.risk.compose_compound`). 구성 위험의 **등급**을
    AND 로 묶으면 각 구성의 놓침이 곱해져 복합의 놓침 방지율이 떨어진다.
    확률로 묶고 경계를 따로 고르면 그 손실을 되찾는다.
    """
    return np.asarray(p_wet) * np.maximum(np.asarray(p_disease), np.asarray(p_frost))


def compound_level(
    score: np.ndarray, threshold: float,
    wet: np.ndarray, disease: np.ndarray, frost: np.ndarray,
) -> np.ndarray:
    """복합위험 등급 — 점수가 경계 이상이면 주의, 구성 중 경계가 있으면 경계."""
    from ofdf.labels.risk import CAUTION, WARNING

    hit = np.asarray(score) >= threshold
    escalate = (
        (np.asarray(wet) >= WARNING) | (np.asarray(disease) >= WARNING) | (np.asarray(frost) >= WARNING)
    )
    out = np.zeros(len(hit), dtype=int)
    out[hit] = CAUTION
    out[hit & escalate] = WARNING
    return out


def oof_risk_proba(
    X: pd.DataFrame,
    y: np.ndarray,
    dev_idx: np.ndarray,
    groups: np.ndarray,
    *,
    risk: str,
    horizon: int,
    params: dict | None = None,
    n_splits: int = 5,
    return_models: bool = False,
):
    """학습+검증(``dev_idx``) 안에서 기상사례 블록 단위 교차검증 예측을 낸다.

    판정 경계를 고를 표본을 늘리려는 것이다. 검증셋 하나는 위험 사례가 수십
    건뿐이라 경계가 흔들린다. **시험셋은 쓰지 않는다.** 각 접힘 모델의
    조기종료도 접힘 학습분 안에서 다시 나눈 검증분으로 한다.
    반환값은 ``len(X)`` 길이이고 ``dev_idx`` 밖은 NaN 이다.
    """
    from sklearn.model_selection import GroupKFold, GroupShuffleSplit

    out = np.full(len(X), np.nan)
    g = np.asarray(groups)
    members: list[TrainedRisk] = []
    folds = GroupKFold(n_splits=n_splits).split(dev_idx, groups=g[dev_idx])
    for k, (fit_rel, hold_rel) in enumerate(folds):
        fit, hold = dev_idx[fit_rel], dev_idx[hold_rel]
        inner = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=k)
        f_tr, f_va = next(inner.split(fit, groups=g[fit]))
        model = train_one(X, y, fit[f_tr], fit[f_va], risk=risk, horizon=horizon, params=params)
        out[hold] = risk_probability(model.predict_proba(X.iloc[hold]))
        members.append(model)
    return (out, members) if return_models else out


def ensemble_risk_probability(members: Sequence[TrainedRisk], X: pd.DataFrame) -> np.ndarray:
    """접힘 모델들의 P(주의 이상) 평균 — 교차검증 앙상블.

    판정 경계는 접힘 모델의 교차검증 예측에서 고른다. 그 경계를 **다른**
    모델(전체 학습분으로 따로 학습한 모델)에 쓰면 확률 눈금이 달라 판정이
    무너질 수 있다 — 실제로 강우·과습 3시간에서 따로 학습한 모델이 23그루에서
    조기종료해 확률 최솟값(0.091)이 경계(0.09)보다 높았고, 모든 시각을
    위험으로 불렀다. 그래서 경계를 고른 바로 그 접힘 모델들을 배포하고
    평균으로 판정한다.
    """
    return np.mean([risk_probability(m.predict_proba(X)) for m in members], axis=0)


def save_ensemble(
    members: Sequence[TrainedRisk], model_dir: str | Path, stem: str,
    *, risk_threshold: float | None = None,
) -> None:
    """접힘 모델을 ``{stem}_cv{k}.txt`` 로, 경계를 ``{stem}.weights.json`` 으로 저장한다."""
    import json

    model_dir = Path(model_dir)
    model_dir.mkdir(parents=True, exist_ok=True)
    for old in model_dir.glob(f"{stem}_cv*.txt"):
        old.unlink()
    for k, m in enumerate(members):
        m.booster.save_model(
            str(model_dir / f"{stem}_cv{k}.txt"), num_iteration=m.best_iteration or None
        )
    side: dict = {"members": len(members)}
    if risk_threshold is not None:
        side["risk_threshold"] = float(risk_threshold)
    (model_dir / f"{stem}.weights.json").write_text(json.dumps(side), encoding="utf-8")


def ensemble_paths(model_dir: str | Path, stem: str) -> list[Path]:
    return sorted(Path(model_dir).glob(f"{stem}_cv*.txt"))


def combine_binary(binary: np.ndarray, levels: np.ndarray) -> np.ndarray:
    """2등급 유형의 최종 등급 — 위험 여부는 전용학습, 등급은 3등급 모델.

    주의와 경계가 같은 조치를 내는 유형(강우·과습, 저온·서리)은 정상 대
    위험을 직접 학습한 모델이 더 잘 가른다. 그 모델이 위험이라 하면 3등급
    모델이 고른 등급을 쓰되 최소 주의로 올리고, 정상이라 하면 정상으로 둔다.
    결과의 '주의 이상' 여부는 전용학습 판정과 정확히 같으므로 조치단위
    성능도 전용학습 모델의 것과 같다. 학습 평가(train_weather)와 현장
    판정(cli.judge)이 이 함수 하나를 같이 쓴다.
    """
    b = np.asarray(binary, dtype=int)
    lv = np.asarray(levels, dtype=int)
    return np.where(b >= 1, np.maximum(lv, 1), 0)


def tune_decision_weights(
    proba: np.ndarray,
    y: np.ndarray,
    *,
    recall_floor: float = RISK_RECALL_FLOOR,
) -> list[float]:
    """검증셋에서 등급별 판정 가중치를 고른다.

    argmax 는 등급이 심하게 불균형할 때 최적이 아니다. 고온·건조 3시간이
    그 예다 — 주의 등급은 실제 300건인데 argmax 가 정상 540건을 주의로
    불러, 주의 F1 0.42 하나가 Macro F1 을 0.80 아래로 끌어내렸다.

    그래서 등급별 확률에 곱할 값을 검증셋에서 고른다. **시험셋은 보지
    않는다.** 고른 값은 모델과 함께 저장되어 제어기도 같은 규칙으로
    판정한다 — 시험한 것과 현장에서 도는 것이 달라서는 안 된다.

    놓침 방지율은 하한을 두고 그 아래로 내려가는 후보를 제외한다.
    F1 을 올리자고 위험을 더 놓치는 것은 재해 경보에서 옳은 교환이 아니다.
    """
    from sklearn.metrics import f1_score

    grid = np.concatenate([np.linspace(0.05, 1.0, 20), np.linspace(1.1, 3.0, 20)])
    risk = y >= 1
    base = [1.0, 1.0, 1.0]
    best_score = f1_score(y, decide_levels(proba), average="macro")
    best = base

    if not risk.any():
        return best

    for w1 in grid:
        for w2 in grid:
            pred = decide_levels(proba, [1.0, w1, w2])
            if float((pred[risk] >= 1).mean()) < recall_floor:
                continue
            score = f1_score(y, pred, average="macro")
            if score > best_score:
                best_score, best = score, [1.0, float(w1), float(w2)]
    return best


def balanced_weights(y: np.ndarray) -> dict[int, float]:
    """클래스 가중치 — 드문 위험등급에 비중을 준다."""
    classes, counts = np.unique(y, return_counts=True)
    total = counts.sum()
    return {int(c): float(total / (len(classes) * n)) for c, n in zip(classes, counts)}


def train_one(
    X: pd.DataFrame,
    y: np.ndarray,
    train_idx: np.ndarray,
    valid_idx: np.ndarray,
    *,
    risk: str,
    horizon: int,
    params: dict | None = None,
    num_boost_round: int = 600,
    early_stopping_rounds: int = 50,
) -> TrainedRisk:
    """위험유형 하나, 시계 하나에 대한 모델을 학습한다."""
    if lgb is None:
        raise ImportError("lightgbm 이 필요합니다: pip install lightgbm")

    columns = list(X.columns)
    weights = balanced_weights(y[train_idx])

    settings = {**DEFAULT_PARAMS, **(params or {})}
    # 실제로 나타난 클래스 수에 맞춘다(드문 등급이 아예 없는 분할 대비)
    settings["num_class"] = 3

    train_set = lgb.Dataset(
        X.iloc[train_idx][columns],
        label=y[train_idx],
        weight=np.array([weights.get(int(v), 1.0) for v in y[train_idx]]),
    )
    valid_set = lgb.Dataset(
        X.iloc[valid_idx][columns],
        label=y[valid_idx],
        weight=np.array([weights.get(int(v), 1.0) for v in y[valid_idx]]),
        reference=train_set,
    )

    booster = lgb.train(
        settings,
        train_set,
        num_boost_round=num_boost_round,
        valid_sets=[valid_set],
        callbacks=[
            lgb.early_stopping(early_stopping_rounds, verbose=False),
            lgb.log_evaluation(0),
        ],
    )
    model = TrainedRisk(
        risk=risk,
        horizon=horizon,
        booster=booster,
        columns=columns,
        best_iteration=booster.best_iteration,
        class_weight=weights,
    )
    # 판정 가중치는 검증셋에서만 고른다. 시험셋은 보지 않는다.
    model.decision_weight = tune_decision_weights(
        model.predict_proba(X.iloc[valid_idx]), y[valid_idx]
    )
    return model


def feature_importance(model: TrainedRisk, top: int = 15) -> pd.DataFrame:
    """판단근거 화면에 올릴 주요 영향변수를 뽑는다.

    사업계획서는 '주요 판단근거 3개 이상 화면·로그 표시'를 요구한다.
    전역 중요도는 모델 설명서용이고, 개별 판단의 근거는 SHAP 등으로
    따로 뽑는다(:func:`explain_one`).
    """
    gain = model.booster.feature_importance(importance_type="gain")
    return (
        pd.DataFrame({"feature": model.columns, "gain": gain})
        .sort_values("gain", ascending=False)
        .head(top)
        .reset_index(drop=True)
    )


def explain_one(model: TrainedRisk, X: pd.DataFrame, row: int, top: int = 3) -> pd.DataFrame:
    """개별 판단의 주요 근거를 기여도 순으로 뽑는다.

    LightGBM 의 ``pred_contrib`` 로 각 변수가 예측 확률에 얼마나 기여했는지
    계산한다(SHAP 값). 예측된 등급 쪽 기여도 상위 ``top`` 개를 돌려준다.
    """
    contrib = model.booster.predict(
        X.iloc[[row]][model.columns], num_iteration=model.best_iteration or None,
        pred_contrib=True,
    )
    n_features = len(model.columns)
    predicted = int(model.predict(X.iloc[[row]])[0])

    # pred_contrib 은 클래스마다 (n_features + 1) 길이로 이어 붙어 나온다
    start = predicted * (n_features + 1)
    values = np.asarray(contrib).reshape(-1)[start : start + n_features]

    frame = pd.DataFrame(
        {
            "feature": model.columns,
            "contribution": values,
            "value": X.iloc[row][model.columns].to_numpy(),
        }
    )
    frame["abs"] = frame["contribution"].abs()
    return frame.sort_values("abs", ascending=False).head(top).drop(columns="abs").reset_index(drop=True)


def save(model: TrainedRisk, path: str | Path) -> None:
    """모델을 텍스트 포맷으로 저장한다(버전 관리·재현 목적).

    판정 가중치는 모델 파일 옆에 ``.weights.json`` 으로 함께 둔다. 이것이
    없으면 제어기가 argmax 로 판정해 시험한 것과 다르게 동작한다.
    """
    import json

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    model.booster.save_model(str(path), num_iteration=model.best_iteration or None)
    side = {"decision_weight": list(model.decision_weight)}
    if model.risk_threshold is not None:
        side["risk_threshold"] = float(model.risk_threshold)
    path.with_suffix(".weights.json").write_text(json.dumps(side), encoding="utf-8")


def load_decision_weight(path: str | Path) -> list[float] | None:
    """모델 파일 경로에 딸린 판정 가중치를 읽는다. 없으면 ``None``."""
    import json

    side = Path(path).with_suffix(".weights.json")
    if not side.exists():
        return None
    try:
        got = json.loads(side.read_text(encoding="utf-8"))["decision_weight"]
    except (ValueError, KeyError):
        return None
    return [float(v) for v in got] or None


def load_risk_threshold(path: str | Path) -> float | None:
    """모델 파일 경로에 딸린 위험 판정 경계를 읽는다. 없으면 ``None``."""
    import json

    side = Path(path).with_suffix(".weights.json")
    if not side.exists():
        return None
    try:
        got = json.loads(side.read_text(encoding="utf-8")).get("risk_threshold")
    except ValueError:
        return None
    return None if got is None else float(got)


def compound_threshold_path(model_dir: str | Path, horizon: int) -> Path:
    return Path(model_dir) / f"compound_h{horizon}.json"


def save_compound_threshold(model_dir: str | Path, horizon: int, threshold: float) -> None:
    import json

    compound_threshold_path(model_dir, horizon).write_text(
        json.dumps({"threshold": float(threshold)}), encoding="utf-8"
    )


def load_compound_threshold(model_dir: str | Path, horizon: int) -> float | None:
    import json

    path = compound_threshold_path(model_dir, horizon)
    if not path.exists():
        return None
    try:
        return float(json.loads(path.read_text(encoding="utf-8"))["threshold"])
    except (ValueError, KeyError):
        return None
