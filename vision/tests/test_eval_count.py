"""eval_count.py — 계수 오차율 판정 로직.

수행계획서의 합격 기준(±20%, 탁도·겹침 ±30%)을 이 계산이 결정하므로,
지표 계산과 임계값 추천을 직접 검증한다.
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
MODULE_PATH = BACKEND / "ai" / "trainer" / "eval_count.py"

_spec = importlib.util.spec_from_file_location("eval_count", MODULE_PATH)
ec = importlib.util.module_from_spec(_spec)
sys.modules["eval_count"] = ec
_spec.loader.exec_module(ec)


# ---------------------------------------------------------------------------
# 오차율
# ---------------------------------------------------------------------------


def test_error_rate_is_relative_to_ground_truth():
    assert ec.error_rate(80, 100) == 0.2
    assert ec.error_rate(120, 100) == 0.2
    assert ec.error_rate(100, 100) == 0.0


def test_error_rate_on_empty_frames():
    # 새우가 없는 장면: 0 을 맞히면 오차 0, 하나라도 잘못 찾으면 100%
    assert ec.error_rate(0, 0) == 0.0
    assert ec.error_rate(3, 0) == 1.0


def test_sample_counts_boxes_above_threshold():
    sample = ec.Sample(name="a.jpg", gt=3, scores=[0.9, 0.5, 0.3, 0.1])
    assert sample.predicted(0.25) == 3
    assert sample.predicted(0.6) == 1
    assert sample.predicted(0.95) == 0


# ---------------------------------------------------------------------------
# 요약 지표
# ---------------------------------------------------------------------------


def _sample(gt: int, scores: list[float], hard: bool = False) -> ec.Sample:
    return ec.Sample(name=f"{gt}.jpg", gt=gt, scores=scores, hard=hard)


def test_summarize_reports_error_bias_and_pass_ratio():
    samples = [
        _sample(10, [0.9] * 10),  # 정확
        _sample(10, [0.9] * 8),  # 20% 누락 (기준 경계 안)
        _sample(10, [0.9] * 15),  # 50% 과다
    ]
    row = ec.summarize(samples, conf=0.25)

    assert row["n"] == 3
    assert row["error_rate_mean"] == round((0.0 + 0.2 + 0.5) / 3, 4)
    assert row["error_rate_median"] == 0.2
    assert row["within_20pct"] == round(2 / 3, 4)  # 0% 와 20% 는 통과
    assert row["mae"] == round((0 + 2 + 5) / 3, 3)
    assert row["bias"] == round((0 - 2 + 5) / 3, 3)  # +면 과다검출 경향
    assert row["gt_total"] == 30
    assert row["pred_total"] == 33


def test_summarize_on_empty_list():
    assert ec.summarize([], conf=0.25) == {"n": 0}


def test_density_breakdown_splits_by_ground_truth_count():
    samples = [_sample(5, [0.9] * 5), _sample(40, [0.9] * 40), _sample(0, [])]
    rows = {row["band"]: row for row in ec.density_breakdown(samples, conf=0.25)}
    assert "1~10마리" in rows
    assert "31~60마리" in rows
    assert "0마리(배경)" in rows
    assert rows["1~10마리"]["n"] == 1


def test_best_threshold_prefers_the_lowest_mean_error():
    # 정답 2마리인데 낮은 점수의 오검출이 하나 섞여 있다 -> conf 를 올리면 맞는다.
    samples = [_sample(2, [0.9, 0.8, 0.2]), _sample(2, [0.95, 0.85, 0.15])]
    conf, row = ec.best_threshold(samples)
    assert conf >= 0.25
    assert row["error_rate_mean"] == 0.0


def test_best_threshold_is_stable_when_several_tie():
    # 모두 정확하면 가장 낮은(= 가장 관대한) 임계값을 고른다.
    samples = [_sample(1, [0.99])]
    conf, _ = ec.best_threshold(samples)
    assert conf == min(ec.SWEEP_THRESHOLDS)


# ---------------------------------------------------------------------------
# 데이터셋 경로 / 정답 개수
# ---------------------------------------------------------------------------


def test_label_path_for_swaps_images_dir():
    image = Path("/data/shrimp/valid/images/a_jpg.rf.abc.jpg")
    assert ec.label_path_for(image) == Path("/data/shrimp/valid/labels/a_jpg.rf.abc.txt")


def test_label_path_uses_the_last_images_component():
    image = Path("/images/shrimp/train/images/b.png")
    assert ec.label_path_for(image) == Path("/images/shrimp/train/labels/b.txt")


def test_ground_truth_count_counts_label_lines(tmp_path):
    (tmp_path / "images").mkdir()
    (tmp_path / "labels").mkdir()
    image = tmp_path / "images" / "x.jpg"
    image.write_bytes(b"x")
    (tmp_path / "labels" / "x.txt").write_text("0 .5 .5 .1 .1\n0 .2 .2 .1 .1\n\n")
    assert ec.ground_truth_count(image) == 2


def test_ground_truth_count_is_zero_without_a_label(tmp_path):
    (tmp_path / "images").mkdir()
    image = tmp_path / "images" / "x.jpg"
    image.write_bytes(b"x")
    assert ec.ground_truth_count(image) == 0


def test_split_images_dir_resolves_absolute_path(tmp_path):
    (tmp_path / "valid" / "images").mkdir(parents=True)
    yaml_path = tmp_path / "data.yaml"
    yaml_path.write_text(
        f"path: {tmp_path}\ntrain: train/images\nval: valid/images\nnc: 1\nnames: ['shrimp']\n",
        encoding="utf-8",
    )
    assert ec.split_images_dir(yaml_path, "valid") == (tmp_path / "valid" / "images").resolve()


def test_split_images_dir_without_path_key_uses_yaml_location(tmp_path):
    (tmp_path / "test" / "images").mkdir(parents=True)
    yaml_path = tmp_path / "data.yaml"
    yaml_path.write_text("train: train/images\ntest: test/images\n", encoding="utf-8")
    assert ec.split_images_dir(yaml_path, "test") == (tmp_path / "test" / "images").resolve()


def test_split_images_dir_reports_missing_split(tmp_path):
    yaml_path = tmp_path / "data.yaml"
    yaml_path.write_text("train: train/images\n", encoding="utf-8")
    try:
        ec.split_images_dir(yaml_path, "test")
    except SystemExit as exc:
        assert "test:" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("없는 분할인데 통과했다")


# ---------------------------------------------------------------------------
# CLI 안전장치 (ml 의존성 없이도 도움말은 떠야 한다)
# ---------------------------------------------------------------------------


def test_help_runs_without_ml_deps():
    proc = subprocess.run(
        [sys.executable, str(MODULE_PATH), "--help"],
        capture_output=True,
        text=True,
        cwd=BACKEND,
        timeout=60,
    )
    assert proc.returncode == 0
    for flag in ("--weights", "--data", "--split", "--conf", "--hard-list", "--strict"):
        assert flag in proc.stdout


def test_missing_ultralytics_exits_with_friendly_message(tmp_path):
    (tmp_path / "valid" / "images").mkdir(parents=True)
    (tmp_path / "valid" / "images" / "a.jpg").write_bytes(b"x")
    yaml_path = tmp_path / "data.yaml"
    yaml_path.write_text(f"path: {tmp_path}\nval: valid/images\n", encoding="utf-8")

    proc = subprocess.run(
        [
            sys.executable,
            str(MODULE_PATH),
            "--weights",
            "best.pt",
            "--data",
            str(yaml_path),
        ],
        capture_output=True,
        text=True,
        cwd=BACKEND,
        timeout=60,
    )
    assert proc.returncode == 1
    assert "ultralytics" in proc.stderr


def test_help_does_not_leak_escaped_percent_signs():
    # argparse 는 help 문자열에 %-서식을 적용하므로 '%' 를 '%%' 로 써야 한다.
    # 그런데 description 은 서식을 타지 않아 '%%' 가 그대로 보인다. 둘을 혼동하면
    # --help 가 죽거나 화면에 '%%' 가 나오므로 양쪽을 한 번에 확인한다.
    proc = subprocess.run(
        [sys.executable, str(MODULE_PATH), "--help"],
        capture_output=True,
        text=True,
        cwd=BACKEND,
        timeout=60,
    )
    assert proc.returncode == 0
    assert "±20%" in proc.stdout
    assert "%%" not in proc.stdout


# ---------------------------------------------------------------------------
# 전체 경로 (가짜 모델)
# ---------------------------------------------------------------------------


class _FakeBox:
    def __init__(self, conf: float) -> None:
        self.conf = [conf]


class _FakeResult:
    def __init__(self, confs: list[float]) -> None:
        self.boxes = [_FakeBox(c) for c in confs]


class _FakeModel:
    """이미지 이름별로 정해진 신뢰도 목록을 돌려주는 ultralytics 대역."""

    def __init__(self, per_image: dict[str, list[float]]) -> None:
        self.per_image = per_image
        self.calls: list[str] = []

    def predict(self, path, **_kwargs):  # noqa: ANN001, ANN201
        name = Path(path).name
        self.calls.append(name)
        return [_FakeResult(self.per_image[name])]


def _dataset(tmp_path: Path, spec: dict[str, int]) -> Path:
    images = tmp_path / "valid" / "images"
    labels = tmp_path / "valid" / "labels"
    images.mkdir(parents=True)
    labels.mkdir(parents=True)
    for name, gt in spec.items():
        (images / name).write_bytes(b"x")
        (labels / f"{Path(name).stem}.txt").write_text(
            "".join("0 0.5 0.5 0.1 0.1\n" for _ in range(gt)), encoding="utf-8"
        )
    yaml_path = tmp_path / "data.yaml"
    yaml_path.write_text(
        f"path: {tmp_path}\ntrain: train/images\nval: valid/images\nnc: 1\nnames: ['shrimp']\n",
        encoding="utf-8",
    )
    return yaml_path


def test_main_writes_a_json_verdict(tmp_path, monkeypatch, capsys):
    yaml_path = _dataset(tmp_path, {"a.jpg": 10, "b.jpg": 10, "c.jpg": 0})
    fake = _FakeModel(
        {
            "a.jpg": [0.9] * 10,  # 정확
            "b.jpg": [0.9] * 9 + [0.1],  # conf 0.25 에서 9개 -> 10% 오차
            "c.jpg": [],  # 배경
        }
    )
    monkeypatch.setattr(ec, "_load_yolo", lambda _weights: fake)
    out_json = tmp_path / "report.json"

    code = ec.main(
        [
            "--weights",
            "fake.pt",
            "--data",
            str(yaml_path),
            "--split",
            "valid",
            "--json",
            str(out_json),
            "--strict",
        ]
    )

    assert code == 0  # 평균 오차 3.3% -> 기준 통과
    assert sorted(fake.calls) == ["a.jpg", "b.jpg", "c.jpg"]

    import json

    payload = json.loads(out_json.read_text(encoding="utf-8"))
    assert payload["pass"] is True
    assert payload["overall"]["n"] == 3
    assert payload["overall"]["gt_total"] == 20
    assert payload["overall"]["pred_total"] == 19
    assert payload["recommended_conf"] in ec.SWEEP_THRESHOLDS
    assert "0.25" in payload["sweep"]

    printed = capsys.readouterr().out
    assert "판정" in printed
    assert "통과" in printed


def test_main_strict_fails_when_error_is_too_large(tmp_path, monkeypatch):
    yaml_path = _dataset(tmp_path, {"a.jpg": 10})
    fake = _FakeModel({"a.jpg": [0.9] * 4})  # 60% 누락
    monkeypatch.setattr(ec, "_load_yolo", lambda _weights: fake)

    code = ec.main(["--weights", "fake.pt", "--data", str(yaml_path), "--strict"])
    assert code == 2


def test_main_applies_the_relaxed_target_to_the_hard_subset(tmp_path, monkeypatch, capsys):
    yaml_path = _dataset(tmp_path, {"clear.jpg": 10, "turbid.jpg": 10})
    fake = _FakeModel({"clear.jpg": [0.9] * 10, "turbid.jpg": [0.9] * 8})  # 탁한 쪽 20% 누락
    monkeypatch.setattr(ec, "_load_yolo", lambda _weights: fake)
    hard_list = tmp_path / "hard.txt"
    hard_list.write_text("turbid.jpg\n", encoding="utf-8")

    code = ec.main(
        [
            "--weights",
            "fake.pt",
            "--data",
            str(yaml_path),
            "--hard-list",
            str(hard_list),
            "--strict",
        ]
    )
    assert code == 0
    printed = capsys.readouterr().out
    assert "탁도·겹침 오차율 ±30%" in printed
    assert "일반" in printed
