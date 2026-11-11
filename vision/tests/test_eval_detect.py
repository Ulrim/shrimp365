"""mAP·Precision·Recall·F1 계산이 맞는지 — 답을 아는 경우로 확인한다.

**왜 시험이 필요한가.** 이 숫자는 공인 시험성적서에 올라간다. 한 번 틀리면
그대로 제출되고, 나중에 재계산해서야 드러난다. 그래서 손으로 답을 알 수 있는
경우를 만들어 맞춰 본다. 추론은 쓰지 않는다 — 지표 계산만 본다.
"""
from __future__ import annotations

import numpy as np
import pytest

from ai.trainer.eval_detect import (
    average_precision,
    count_error,
    iou_matrix,
    match_one_image,
    read_gt,
)


def box(x1, y1, x2, y2):
    return np.asarray([[x1, y1, x2, y2]], dtype=np.float32)


# ── IoU ────────────────────────────────────────────────────────────────────
def test_iou_identical_boxes_is_one():
    a = box(0, 0, 10, 10)
    assert iou_matrix(a, a)[0, 0] == pytest.approx(1.0)


def test_iou_disjoint_boxes_is_zero():
    assert iou_matrix(box(0, 0, 10, 10), box(20, 20, 30, 30))[0, 0] == 0.0


def test_iou_half_overlap():
    """가로로 절반 겹친 같은 크기 박스 둘 — 교집합 50, 합집합 150 → 1/3."""
    got = iou_matrix(box(0, 0, 10, 10), box(5, 0, 15, 10))[0, 0]
    assert got == pytest.approx(1 / 3, abs=1e-6)


# ── 매칭 ───────────────────────────────────────────────────────────────────
def test_one_gt_matches_only_the_best_prediction():
    """같은 자리에 예측이 둘이면 신뢰도 높은 쪽만 TP, 나머지는 FP 다."""
    preds = np.asarray([[0, 0, 10, 10], [0, 0, 10, 10]], dtype=np.float32)
    scores = np.asarray([0.9, 0.8], dtype=np.float32)
    tp = match_one_image(preds, scores, box(0, 0, 10, 10), 0.5)
    assert tp.tolist() == [1.0, 0.0]


def test_prediction_below_iou_threshold_is_fp():
    tp = match_one_image(box(0, 0, 10, 10), np.asarray([0.9], np.float32),
                         box(9, 9, 19, 19), 0.5)
    assert tp.tolist() == [0.0]


def test_no_ground_truth_means_everything_is_fp():
    tp = match_one_image(box(0, 0, 10, 10), np.asarray([0.9], np.float32),
                         np.zeros((0, 4), np.float32), 0.5)
    assert tp.tolist() == [0.0]


# ── AP ─────────────────────────────────────────────────────────────────────
def test_perfect_detection_gives_ap_one():
    tp = np.ones(5, dtype=np.float32)
    scores = np.linspace(0.9, 0.5, 5, dtype=np.float32)
    assert average_precision(tp, scores, n_gt=5) == pytest.approx(1.0, abs=1e-6)


def test_missing_everything_gives_ap_zero():
    assert average_precision(np.zeros(0), np.zeros(0), n_gt=5) == 0.0


def test_half_recall_with_perfect_precision():
    """정답 10개 중 5개만 찾았고 오검출이 없으면 AP 는 재현율 상한 0.5 에서 끊긴다.

    101점 보간이므로 recall 0~0.5 구간의 51점만 정밀도 1 이고 나머지는 0 →
    51/101 ≈ 0.5050.
    """
    tp = np.ones(5, dtype=np.float32)
    scores = np.linspace(0.9, 0.5, 5, dtype=np.float32)
    assert average_precision(tp, scores, n_gt=10) == pytest.approx(51 / 101, abs=1e-4)


def test_false_positives_lower_ap():
    good = average_precision(np.ones(5, np.float32),
                             np.linspace(0.9, 0.5, 5, dtype=np.float32), 5)
    tp = np.asarray([1, 0, 1, 0, 1, 0, 1, 0, 1, 0], dtype=np.float32)
    scores = np.linspace(0.95, 0.5, 10, dtype=np.float32)
    worse = average_precision(tp, scores, 5)
    assert worse < good


def test_ap_is_nan_when_there_is_nothing_to_find():
    """정답이 0개인 집합의 AP 는 정의되지 않는다 — 0 으로 적으면 평균이 왜곡된다."""
    assert np.isnan(average_precision(np.zeros(3, np.float32),
                                      np.asarray([0.9, 0.8, 0.7], np.float32), n_gt=0))


# ── 라벨 읽기 ──────────────────────────────────────────────────────────────
def test_reads_yolo_box_label(tmp_path):
    p = tmp_path / "a.txt"
    p.write_text("0 0.5 0.5 0.2 0.4\n")
    got = read_gt(p, width=100, height=50)
    # cx=50, cy=25, w=20, h=20 → (40, 15, 60, 35)
    assert got.tolist() == [[40.0, 15.0, 60.0, 35.0]]


def test_polygon_label_becomes_bounding_box(tmp_path):
    """shrimp_cf 원본은 폴리곤이다. 외접 박스로 접어야 한다."""
    p = tmp_path / "a.txt"
    p.write_text("0 0.1 0.1 0.3 0.1 0.3 0.5 0.1 0.5\n")
    got = read_gt(p, width=100, height=100)
    assert got.tolist() == [[10.0, 10.0, 30.0, 50.0]]


def test_missing_label_file_means_zero_objects(tmp_path):
    assert read_gt(tmp_path / "없음.txt", 100, 100).shape == (0, 4)


def test_blank_lines_are_ignored(tmp_path):
    p = tmp_path / "a.txt"
    p.write_text("\n0 0.5 0.5 0.2 0.2\n\n")
    assert read_gt(p, 100, 100).shape == (1, 4)


# ── 전체 조합 ──────────────────────────────────────────────────────────────
def test_precision_recall_f1_hand_computed():
    """정답 4개, 예측 3개 중 2개 적중 → P=2/3, R=2/4=0.5, F1=0.5714"""
    preds = np.asarray([[0, 0, 10, 10], [20, 20, 30, 30], [90, 90, 99, 99]],
                       dtype=np.float32)
    scores = np.asarray([0.9, 0.8, 0.7], dtype=np.float32)
    gt = np.asarray([[0, 0, 10, 10], [20, 20, 30, 30], [50, 50, 60, 60],
                     [70, 70, 80, 80]], dtype=np.float32)
    tp = match_one_image(preds, scores, gt, 0.5)
    tp_n = int(tp.sum())
    fp_n = len(tp) - tp_n
    fn_n = len(gt) - tp_n
    precision = tp_n / (tp_n + fp_n)
    recall = tp_n / (tp_n + fn_n)
    f1 = 2 * precision * recall / (precision + recall)
    assert (tp_n, fp_n, fn_n) == (2, 1, 2)
    assert precision == pytest.approx(2 / 3)
    assert recall == pytest.approx(0.5)
    assert f1 == pytest.approx(0.5714, abs=1e-4)


# ── 계수 오차율 ────────────────────────────────────────────────────────────
def test_count_error_is_zero_when_counts_match():
    got = count_error([(10, 10), (3, 3)])
    assert got["평균_오차율"] == 0.0
    assert got["±20%_이내_비율"] == 1.0
    assert got["대상_이미지_수"] == 2


def test_count_error_boundary_is_inclusive():
    """10마리를 12마리로 세면 오차 20% — 허용 경계는 포함한다."""
    got = count_error([(10, 12)])
    assert got["평균_오차율"] == pytest.approx(0.20)
    assert got["±20%_이내_비율"] == 1.0


def test_count_error_just_outside_boundary_fails():
    got = count_error([(10, 13)])
    assert got["평균_오차율"] == pytest.approx(0.30)
    assert got["±20%_이내_비율"] == 0.0


def test_count_error_undercount_counts_the_same():
    """덜 센 것도 오차다 — 절댓값이므로 8마리나 12마리나 20%."""
    assert count_error([(10, 8)])["평균_오차율"] == pytest.approx(0.20)


def test_count_error_mixed_set_hand_computed():
    """오차 0% 와 30% 가 한 장씩 → 평균 15%, 최대 30%, 이내 비율 1/2"""
    got = count_error([(10, 10), (10, 13)])
    assert got["평균_오차율"] == pytest.approx(0.15)
    assert got["중앙값_오차율"] == pytest.approx(0.15)
    assert got["최대_오차율"] == pytest.approx(0.30)
    assert got["±20%_이내_비율"] == 0.5


def test_background_images_are_counted_separately_not_dropped():
    """정답 0마리 이미지는 오차율 분모가 없다 — 빼지 말고 따로 센다."""
    got = count_error([(10, 10), (0, 0), (0, 2)])
    assert got["대상_이미지_수"] == 1          # 오차율은 10마리 한 장으로만
    assert got["배경이미지_수"] == 2
    assert got["배경_오검출_평균"] == 1.0      # (0 + 2) / 2
    assert got["배경_오검출_0건_비율"] == 0.5


def test_count_error_without_any_labelled_object_reports_no_rate():
    """셀 것이 없으면 오차율 항목을 아예 넣지 않는다 — 0% 로 적으면 거짓이 된다."""
    got = count_error([(0, 0)])
    assert "평균_오차율" not in got
    assert got["대상_이미지_수"] == 0


def test_count_tolerance_is_configurable():
    assert count_error([(10, 11)], tolerance=0.05)["±5%_이내_비율"] == 0.0
    assert count_error([(10, 11)], tolerance=0.10)["±10%_이내_비율"] == 1.0
