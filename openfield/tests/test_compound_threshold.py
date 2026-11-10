"""복합위험 점수 판정과 2등급 위험 경계 — 학습 평가와 현장 판정이 같은 규칙인지.

성능평가서의 목표 판정은 전용학습 모델과 교차검증에서 고른 경계로 잰다.
현장 장비(cli.judge)가 다른 규칙으로 돌면 시험에서 잰 성능이 현장 성능이
아니게 된다. 이 시험은 그 둘이 어긋나지 않게 묶는다.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ofdf import cli
from ofdf.models import weather_risk as wr


def test_wilson_lower_is_below_point_estimate_and_tightens_with_n():
    assert wr.wilson_lower(85, 100) < 0.85
    assert wr.wilson_lower(850, 1000) > wr.wilson_lower(85, 100)
    assert wr.wilson_lower(0, 0) == 0.0


def test_tune_risk_threshold_keeps_recall_lower_bound():
    rng = np.random.default_rng(0)
    y = np.r_[np.ones(300, int), np.zeros(3000, int)]
    score = np.r_[rng.uniform(0.3, 1.0, 300), rng.uniform(0.0, 0.7, 3000)]
    t = wr.tune_risk_threshold(score, y)
    pred = (score >= t).astype(int)
    assert wr.wilson_lower(int(pred[y == 1].sum()), 300) >= wr.RISK_RECALL_FLOOR


def test_compound_level_needs_score_and_escalates_on_component_warning():
    score = np.array([0.1, 0.6, 0.6])
    out = wr.compound_level(score, 0.5, [0, 1, 2], [0, 1, 1], [0, 0, 0])
    assert out.tolist() == [0, 1, 2]


class _Booster:
    """cli.judge 가 쓰는 만큼만 흉내 낸 LightGBM 부스터."""

    def __init__(self, proba):
        self._p = np.asarray(proba, dtype=float)

    def feature_name(self):
        return ["x"]

    def predict(self, row, pred_contrib=False):
        if pred_contrib:
            return np.zeros((1, 3 * 2))
        return self._p.reshape(1, -1)


def _models(threshold=None):
    bucket = {
        "heat_dry": (_Booster([0.9, 0.08, 0.02]), None),
        "rain_wet": (_Booster([0.7, 0.2, 0.1]), None),          # 3등급만 보면 정상
        "disease": (_Booster([0.2, 0.7, 0.1]), None),
        "frost": (_Booster([0.95, 0.04, 0.01]), None),
        f"rain_wet{cli.BINARY_SUFFIX}": (_Booster([0.4, 0.6, 0.0]), None, 0.5),
        f"frost{cli.BINARY_SUFFIX}": (_Booster([0.9, 0.1, 0.0]), None, 0.5),
    }
    if threshold is not None:
        bucket[cli.COMPOUND_THRESHOLD_KEY] = threshold
    return bucket


def test_judge_uses_dedicated_binary_threshold_and_compound_score():
    features = pd.DataFrame({"x": [1.0]})
    levels, confidences, evidence = cli.judge(_models(threshold=0.3), features)
    # 전용학습이 P(위험) 0.6 >= 0.5 → 3등급이 정상이어도 최소 주의
    assert levels["rain_wet"] == 1
    assert levels["frost"] == 0
    # 복합 점수 0.6 x max(0.8, 0.1) = 0.48 >= 0.3 → 주의
    assert levels["compound"] == 1
    assert abs(evidence["compound"][0]["value"] - 0.48) < 1e-9
    # 점수는 자동 실행 신뢰도에 섞이지 않는다
    assert "compound" not in confidences


def test_judge_without_compound_threshold_falls_back_to_level_rule():
    features = pd.DataFrame({"x": [1.0]})
    levels, _, _ = cli.judge(_models(threshold=None), features)
    assert levels["compound"] == 1          # 과습 주의 + 병해 주의
    levels_hi, _, _ = cli.judge(_models(threshold=0.9), features)
    assert levels_hi["compound"] == 0       # 점수 0.48 < 0.9


def test_judge_confidence_comes_from_the_model_that_decided():
    features = pd.DataFrame({"x": [1.0]})
    _, confidences, _ = cli.judge(_models(threshold=0.3), features)
    # 강우·과습은 전용학습 P(위험) 0.6 으로 위험 판정 → 신뢰도 0.6 (3등급 p1 0.2 아님)
    assert abs(confidences["rain_wet"] - 0.6) < 1e-9
    # 저온·서리는 전용학습 P(위험) 0.1 로 정상 판정 → 신뢰도 0.9
    assert abs(confidences["frost"] - 0.9) < 1e-9
    # 전용학습이 없는 유형은 3등급 모델 확률 그대로
    assert abs(confidences["disease"] - 0.7) < 1e-9


def test_partial_deploy_without_binary_models_does_not_use_score_threshold():
    features = pd.DataFrame({"x": [1.0]})
    bucket = _models(threshold=0.9)
    del bucket[f"frost{cli.BINARY_SUFFIX}"]
    levels, _, _ = cli.judge(bucket, features)
    # 경계 0.9 를 3등급 확률에 쓰지 않고 등급 조합으로 물러난다(과습 주의+병해 주의)
    assert levels["compound"] == 1
