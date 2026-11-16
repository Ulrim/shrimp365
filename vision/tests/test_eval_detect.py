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
    bootstrap_ci,
    count_error,
    exact_lower_bound,
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


# ── 채널 순서 ──────────────────────────────────────────────────────────────
def test_frame_we_hand_the_detector_stays_rgb():
    """배포 검출기를 거친 뒤에도 R 과 B 가 맞바뀌지 않아야 한다.

    `detect()` 는 ndarray 를 BGR 로 간주해 뒤집는다(현장 스트림이 BGR 이다).
    그래서 RGB ndarray 를 넘기면 채널이 맞바뀐 그림이 모델에 들어가고, 성적서에
    실제보다 낮은 수치가 올라간다. 눈에 띄는 오류가 없어 놓치기 쉬운 종류다.
    """
    from PIL import Image

    from ai.trainer.eval_detect import frame_for_detector
    from app.services.detector_onnx import _as_rgb

    # 빨강과 파랑이 분명히 다른 그림 — 뒤집히면 값이 바뀐다
    src = Image.new("RGB", (4, 3), (200, 50, 10))
    seen_by_model = _as_rgb(frame_for_detector(src))
    assert seen_by_model.shape == (3, 4, 3)
    assert tuple(seen_by_model[0, 0]) == (200, 50, 10), "채널이 뒤집혔습니다"


# ── 신뢰구간 ───────────────────────────────────────────────────────────────
def test_bootstrap_interval_contains_the_point_estimate():
    """완벽한 탐지 10장이면 구간도 1.0 에 붙어 있어야 한다."""
    tp = [np.ones(2, np.float32)] * 10
    sc = [np.asarray([0.9, 0.8], np.float32)] * 10
    got = bootstrap_ci(tp, sc, [2] * 10, rounds=200)
    assert got["하한_2.5%"] == pytest.approx(1.0, abs=1e-6)
    assert got["상한_97.5%"] == pytest.approx(1.0, abs=1e-6)


def test_bootstrap_interval_widens_when_images_disagree():
    """절반은 다 맞고 절반은 다 놓쳤다면 구간이 넓어야 한다 — 좁으면 거짓 정밀도다."""
    tp = [np.ones(2, np.float32)] * 5 + [np.zeros(0, np.float32)] * 5
    sc = [np.asarray([0.9, 0.8], np.float32)] * 5 + [np.zeros(0, np.float32)] * 5
    got = bootstrap_ci(tp, sc, [2] * 10, rounds=500)
    assert got["상한_97.5%"] - got["하한_2.5%"] > 0.2


def test_bootstrap_is_reproducible():
    """같은 입력이면 같은 구간이 나와야 한다 — 보고서 숫자가 실행마다 바뀌면 안 된다."""
    tp = [np.ones(1, np.float32), np.zeros(1, np.float32), np.ones(1, np.float32)]
    sc = [np.asarray([0.9], np.float32)] * 3
    a = bootstrap_ci(tp, sc, [1, 1, 1], rounds=100)
    b = bootstrap_ci(tp, sc, [1, 1, 1], rounds=100)
    assert a == b


def test_bootstrap_needs_at_least_two_images():
    assert bootstrap_ci([np.ones(1, np.float32)], [np.asarray([0.9], np.float32)], [1]) is None


# ── 표본이 작을 때의 하한 ──────────────────────────────────────────────────
def test_perfect_small_sample_is_not_certainty():
    """16개를 모두 맞혀도 '100%' 라고 말할 수는 없다 — 하한은 0.79 다.

    부트스트랩 구간은 이 경우 1.000~1.000 으로 붙어 버려 확신을 과장한다.
    이 하한이 그 자리를 메운다. 0.025^(1/16) = 0.7941.
    """
    assert exact_lower_bound(16, 16) == pytest.approx(0.025 ** (1 / 16), abs=1e-6)
    assert exact_lower_bound(16, 16) < 0.80


def test_more_samples_raise_the_floor():
    """같은 100% 라도 표본이 크면 더 강하게 말할 수 있다."""
    assert exact_lower_bound(16, 16) < exact_lower_bound(100, 100)
    assert exact_lower_bound(100, 100) < exact_lower_bound(445, 445)


def test_missing_everything_has_zero_floor():
    assert exact_lower_bound(0, 5) == 0.0


def test_bound_sits_below_the_observed_rate():
    for k, n in [(8, 10), (45, 50), (1, 3)]:
        assert 0.0 < exact_lower_bound(k, n) < k / n


def test_bound_is_undefined_without_trials():
    assert exact_lower_bound(0, 0) is None
    assert exact_lower_bound(5, 3) is None


# ── 시험기관 제출용 로그(--log-dir)와 로그만으로의 재계산 ─────────────────
# 추론은 가짜 검출기로 바꾼다 — 여기서 보는 것은 "로그에 적힌 것만으로 같은
# 최종값이 다시 나오는가"이지 모델이 아니다.
import csv  # noqa: E402
import json  # noqa: E402

from ai.trainer import eval_detect, recompute_detect  # noqa: E402
from ai.trainer.eval_detect import match_one_image_detail  # noqa: E402
from app.services.detector import BBox, DetectionResult  # noqa: E402

SIZE = 100          # 합성 이미지 한 변(px). 라벨은 0~1 정규화이므로 ×100 이 픽셀이다.


def _old_match_one_image(pred_boxes, pred_scores, gt, thr):
    """매칭을 확장하기 **전**의 구현을 그대로 옮겨 둔 것 — 판정이 안 바뀌었는지 견준다."""
    order = np.argsort(-pred_scores)
    tp = np.zeros(len(pred_boxes), dtype=np.float32)
    if len(gt) == 0:
        return tp
    ious = iou_matrix(pred_boxes, gt)
    used = np.zeros(len(gt), dtype=bool)
    for i in order:
        if ious.shape[1] == 0:
            break
        candidates = np.where(~used, ious[i], -1.0)
        best = int(np.argmax(candidates))
        if candidates[best] >= thr:
            tp[i] = 1.0
            used[best] = True
    return tp


def _synthetic_scene(rng, n_gt, n_extra):
    """정답 n_gt 개와, 그 근처로 흔들린 예측 + 엉뚱한 예측 n_extra 개."""
    gt = []
    for _ in range(n_gt):
        x, y = rng.uniform(0, 70, size=2)
        w, h = rng.uniform(10, 25, size=2)
        gt.append([x, y, x + w, y + h])
    preds = []
    for g in gt:
        if rng.random() < 0.85:                      # 일부는 아예 놓친다
            jitter = rng.normal(0, rng.choice([0.5, 2.0, 5.0]), size=4)
            preds.append((*np.clip(np.asarray(g) + jitter, 0, SIZE),
                          float(rng.uniform(0.05, 0.99))))
    for _ in range(n_extra):
        x, y = rng.uniform(0, 80, size=2)
        preds.append((x, y, x + rng.uniform(5, 20), y + rng.uniform(5, 20),
                      float(rng.uniform(0.002, 0.6))))
    return gt, preds


@pytest.fixture
def synthetic_run(tmp_path, monkeypatch):
    """합성 시험셋을 만들고 가짜 검출기를 끼운다. 반환: 실행 함수와 정답 자료."""
    from PIL import Image

    rng = np.random.default_rng(7)
    images_dir, labels_dir = tmp_path / "test" / "images", tmp_path / "test" / "labels"
    images_dir.mkdir(parents=True)
    labels_dir.mkdir()
    # 0: 평범 … 5: 정답 0마리 + 헛검출, 6: 정답도 예측도 없음, 7: 정답만 있고 예측 없음
    plan = [(4, 3), (6, 5), (1, 0), (9, 8), (3, 2), (0, 4), (0, 0), (2, 0)]
    scenes = {}
    for index, (n_gt, n_extra) in enumerate(plan):
        gt, preds = _synthetic_scene(rng, n_gt, n_extra)
        if index == 7:
            preds = []
        if index == 1 and preds:                      # 다른 이미지와 신뢰도 동점을 만든다
            preds[0] = (*preds[0][:4], 0.5)
        if index == 3 and preds:
            preds[0] = (*preds[0][:4], 0.5)
        name = f"img_{index:02d}"
        Image.new("RGB", (SIZE, SIZE), (index, 0, 0)).save(images_dir / f"{name}.png")
        if n_gt:                                      # 정답 0마리는 라벨 파일 자체가 없다
            (labels_dir / f"{name}.txt").write_text("".join(
                f"0 {(x1 + x2) / 2 / SIZE} {(y1 + y2) / 2 / SIZE}"
                f" {(x2 - x1) / SIZE} {(y2 - y1) / SIZE}\n" for x1, y1, x2, y2 in gt))
        scenes[index] = (gt, preds)
    weights = tmp_path / "model.onnx"
    weights.write_bytes(b"not a real model")

    class FakeDetector:
        imgsz = 416

        def __init__(self, **_kwargs):
            pass

        def detect(self, frame):
            _gt, preds = scenes[frame.getpixel((0, 0))[0]]
            boxes = [BBox(*p) for p in preds]
            return DetectionResult(count=len(boxes), bboxes=boxes)

    monkeypatch.setattr("app.services.detector_onnx.OnnxShrimpDetector", FakeDetector)
    log_dir = tmp_path / "log"

    def run(*extra):
        return eval_detect.main([
            "--weights", str(weights), "--images", str(images_dir),
            "--labels", str(labels_dir), "--progress", "0",
            "--log-dir", str(log_dir), *extra])

    return run, log_dir, scenes, labels_dir


def _read(path):
    with path.open(newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def test_matching_detail_keeps_the_old_tp_verdicts():
    """매칭이 '무엇과 맞았는지'까지 돌려주게 됐어도 TP 판정은 한 글자도 안 바뀐다."""
    rng = np.random.default_rng(3)
    for _ in range(200):
        gt, preds = _synthetic_scene(rng, int(rng.integers(0, 12)), int(rng.integers(0, 12)))
        boxes = np.asarray([p[:4] for p in preds], dtype=np.float32).reshape(-1, 4)
        scores = np.asarray([p[4] for p in preds], dtype=np.float32)
        gt_arr = np.asarray(gt, dtype=np.float32).reshape(-1, 4)
        for thr in (0.5, 0.75, 0.95):
            old = _old_match_one_image(boxes, scores, gt_arr, thr)
            tp, matched, ious = match_one_image_detail(boxes, scores, gt_arr, thr)
            assert tp.tolist() == old.tolist()
            assert match_one_image(boxes, scores, gt_arr, thr).tolist() == old.tolist()
            hit = matched[matched >= 0]
            assert len(set(hit.tolist())) == len(hit), "한 정답이 두 예측에 쓰였습니다"
            assert ((matched >= 0) == (tp == 1)).all()
            assert (ious[tp == 1] >= thr).all()


def test_log_has_one_row_per_prediction_ground_truth_and_image(synthetic_run):
    run, log_dir, scenes, _ = synthetic_run
    assert run() == 0
    n_pred = sum(len(p) for _, p in scenes.values())
    n_gt = sum(len(g) for g, _ in scenes.values())
    assert len(_read(log_dir / "02_예측별_결과.csv")) == n_pred
    assert len(_read(log_dir / "02_정답별_결과.csv")) == n_gt
    assert len(_read(log_dir / "02_이미지별_결과.csv")) == len(scenes)
    for name in ("02_예측별_결과.csv", "02_정답별_결과.csv", "02_이미지별_결과.csv"):
        assert (log_dir / name).read_bytes().startswith(b"\xef\xbb\xbf"), "BOM 이 없습니다"
    final = json.loads((log_dir / "03_최종결과.json").read_text(encoding="utf-8"))
    assert final["이미지_수"] == len(scenes) and final["정답_박스_수"] == n_gt
    assert set(final["로그_sha256"]) == {"02_예측별_결과.csv", "02_정답별_결과.csv",
                                         "02_이미지별_결과.csv"}
    assert (log_dir / "00_시험대상_해시.txt").exists()
    assert (log_dir / "01_시험데이터" / "통계.txt").exists()
    sums = (log_dir / "01_시험데이터" / "sha256sums.txt").read_text().splitlines()
    assert len(sums) == len(scenes) + sum(1 for g, _ in scenes.values() if g)
    assert all(line.split("  ", 1)[1].startswith(("images/", "labels/")) for line in sums)


def test_recompute_from_logs_equals_evaluate(synthetic_run):
    """로그 두 개만 읽어 낸 값이 측정 프로그램의 최종값과 같다."""
    run, log_dir, _, _ = synthetic_run
    assert run("--bootstrap", "50") == 0
    final = json.loads((log_dir / "03_최종결과.json").read_text(encoding="utf-8"))
    got = recompute_detect.recompute(log_dir)
    assert round(got["mAP@0.5"], 4) == final["mAP@0.5"]
    assert round(got["mAP@0.5:0.95"], 4) == final["mAP@0.5:0.95"]
    assert {k: round(v, 4) for k, v in got["IoU별_AP"].items()} == final["IoU별_AP"]
    assert (got["TP"], got["FP"], got["FN"]) == (final["TP"], final["FP"], final["FN"])
    for key in ("Precision", "Recall", "F1"):
        assert round(got[key], 4) == final[key]
    c = final["계수_오차율"]
    assert round(got["평균_오차율"], 4) == c["평균_오차율"]
    assert round(got["중앙값_오차율"], 4) == c["중앙값_오차율"]
    assert round(got["최대_오차율"], 4) == c["최대_오차율"]
    assert round(got["이내_비율"], 4) == c["±20%_이내_비율"]
    assert 0 < final["mAP@0.5"] < 1, "합성 자료가 너무 쉽거나 어려워 검산이 헐겁습니다"
    assert recompute_detect.main(["--dir", str(log_dir)]) == 0
    assert "모두 일치" in (log_dir / "04_재계산_결과.txt").read_text(encoding="utf-8")


def test_recompute_does_not_use_eval_detect():
    """독립 검산이다 — 측정 프로그램의 함수를 불러 쓰면 같은 실수를 같이 한다."""
    source = (eval_detect.HERE / "recompute_detect.py").read_text(encoding="utf-8")
    assert "import eval_detect" not in source and "from eval_detect" not in source
    assert "ai.trainer" not in source and "from app" not in source


def test_image_without_ground_truth_in_logs(synthetic_run):
    """정답 0마리 이미지: AP 는 빈칸, 오차율도 빈칸, 헛검출 수는 적는다."""
    run, log_dir, scenes, _ = synthetic_run
    assert run() == 0
    rows = {r["이미지"]: r for r in _read(log_dir / "02_이미지별_결과.csv")}
    ghost = rows["img_05.png"]
    op = sum(1 for p in scenes[5][1] if np.float32(p[4]) >= np.float32(0.25))
    assert ghost["AP@0.5(이미지 단독)"] == "" and ghost["계수오차율(비율)"] == ""
    assert ghost["헛검출(정답 0마리 이미지)(개)"] == str(op)
    assert rows["img_06.png"]["헛검출(정답 0마리 이미지)(개)"] == "0"
    assert rows["img_00.png"]["헛검출(정답 0마리 이미지)(개)"] == ""
    assert rows["img_00.png"]["AP@0.5(이미지 단독)"] != ""
    assert rows["img_07.png"]["AP@0.5(이미지 단독)"] == "0.000000"   # 정답은 있는데 예측이 없다
    final = json.loads((log_dir / "03_최종결과.json").read_text(encoding="utf-8"))
    assert final["계수_오차율"]["배경이미지_수"] == 2
    got = recompute_detect.recompute(log_dir)
    assert got["배경이미지_수"] == 2 and got["이미지_수"] == len(scenes)
    # 정답 0마리 이미지의 예측은 어느 IoU 기준에서도 TP 가 될 수 없다
    for r in _read(log_dir / "02_예측별_결과.csv"):
        if r["이미지"] == "img_05.png":
            assert r["TP@0.50(0/1)"] == "0" and r["매칭정답번호@0.50"] == ""


def test_ground_truth_log_points_at_the_detecting_prediction(synthetic_run):
    """정답별 로그의 '탐지한_예측번호' 가 예측별 로그의 그 줄과 맞물린다."""
    run, log_dir, _, _ = synthetic_run
    assert run() == 0
    preds = {(r["이미지"], r["예측번호"]): r for r in _read(log_dir / "02_예측별_결과.csv")}
    hits = 0
    for g in _read(log_dir / "02_정답별_결과.csv"):
        if g["운영임계값에서_탐지(0/1)"] == "1":
            p = preds[(g["이미지"], g["탐지한_예측번호"])]
            assert p["운영임계값_이상(0/1)"] == "1"
            assert p["매칭정답번호@0.50"] == g["정답번호"]
            hits += 1
        else:
            assert g["탐지한_예측번호"] == ""
    assert hits > 0


def test_recompute_notices_a_tampered_log(synthetic_run):
    """로그를 한 칸 고치면 재계산이 0이 아닌 코드로 끝난다."""
    run, log_dir, _, _ = synthetic_run
    assert run() == 0
    path = log_dir / "02_예측별_결과.csv"
    lines = path.read_bytes().split(b"\r\n")
    cells = lines[1].split(b",")
    cells[9] = b"0" if cells[9] == b"1" else b"1"     # 첫 예측의 TP@0.50 을 뒤집는다
    lines[1] = b",".join(cells)
    path.write_bytes(b"\r\n".join(lines))
    assert recompute_detect.main(["--dir", str(log_dir)]) == 1
    assert "불일치" in (log_dir / "04_재계산_결과.txt").read_text(encoding="utf-8")


def test_changed_test_data_stops_the_run(synthetic_run):
    """sha256 목록을 고정한 뒤 시험 데이터가 바뀌면 측정 결과를 쓰지 않고 멈춘다."""
    run, _, _, labels_dir = synthetic_run
    assert run() == 0
    label = labels_dir / "img_00.txt"
    label.write_text(label.read_text() + "0 0.5 0.5 0.1 0.1\n")
    with pytest.raises(SystemExit) as stopped:
        run()
    assert "고정된 목록과 다릅니다" in str(stopped.value)


def test_log_dir_refuses_tiled_inference(synthetic_run):
    run, _, _, _ = synthetic_run
    with pytest.raises(SystemExit):
        run("--tile", "320")


def test_pass_criteria_are_settings_not_constants(synthetic_run):
    """판정 기준은 명령줄 설정값이다 — 코드에 굳혀 두지 않는다."""
    run, log_dir, _, _ = synthetic_run
    assert run("--pass-map50", "0.0", "--count-judge", "both",
               "--pass-count-mean", "9", "--pass-count-within", "0.0") == 0
    verdicts = json.loads((log_dir / "03_최종결과.json").read_text(encoding="utf-8"))["판정"]
    assert [v["판정"] for v in verdicts] == ["적합", "적합", "적합"]
    assert run("--pass-map50", "1.01", "--count-judge", "within",
               "--pass-count-within", "1.01") == 0
    verdicts = json.loads((log_dir / "03_최종결과.json").read_text(encoding="utf-8"))["판정"]
    assert [v["판정"] for v in verdicts] == ["부적합", "부적합"]
    with pytest.raises(SystemExit):
        run("--count-judge", "within")                # 기준값 없이 판정하지 않는다


def test_changed_test_data_stops_before_measuring(synthetic_run, capsys):
    """바뀐 데이터로 잰 수치가 화면에 나오면 안 된다 — 재기 전에 멈춘다."""
    run, log_dir, _, labels_dir = synthetic_run
    assert run() == 0
    before = (log_dir / "03_최종결과.json").read_bytes()
    capsys.readouterr()
    (labels_dir / "img_00.txt").write_text("0 0.5 0.5 0.1 0.1\n")
    with pytest.raises(SystemExit):
        run()
    assert "mAP@0.5" not in capsys.readouterr().out
    assert (log_dir / "03_최종결과.json").read_bytes() == before


def test_recompute_agrees_when_there_is_nothing_to_find(tmp_path, monkeypatch):
    """정답이 하나도 없으면 AP 는 양쪽 다 '정의되지 않음' — 그것도 일치다."""
    from PIL import Image

    images_dir = tmp_path / "test" / "images"
    images_dir.mkdir(parents=True)
    (tmp_path / "test" / "labels").mkdir()
    for i in range(3):
        Image.new("RGB", (SIZE, SIZE), (i, 0, 0)).save(images_dir / f"bg_{i}.png")
    (tmp_path / "m.onnx").write_bytes(b"x")

    class FakeDetector:
        imgsz = 416

        def __init__(self, **_kwargs):
            pass

        def detect(self, frame):
            boxes = [BBox(1, 1, 20, 20, 0.6)] if frame.getpixel((0, 0))[0] == 1 else []
            return DetectionResult(count=len(boxes), bboxes=boxes)

    monkeypatch.setattr("app.services.detector_onnx.OnnxShrimpDetector", FakeDetector)
    log_dir = tmp_path / "log"
    with pytest.warns(RuntimeWarning):                 # 기존 동작: nan 들의 평균
        assert eval_detect.main(["--weights", str(tmp_path / "m.onnx"), "--images",
                                 str(images_dir), "--progress", "0",
                                 "--log-dir", str(log_dir)]) == 0
    assert recompute_detect.main(["--dir", str(log_dir)]) == 0
