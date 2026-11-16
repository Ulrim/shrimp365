"""STA 시험용 평가·재계산 스크립트.

작은 합성 자료를 **실제 학습 스크립트(train_weather.py)** 로 학습시켜 모델 묶음과
performance.csv 를 만든 뒤, 고정 모델 평가(sta_evaluate.py)가 같은 수치를 내는지,
로그만으로 다시 계산(sta_recompute.py)해도 같은지 본다.
"""

from __future__ import annotations

import csv
import importlib.util
import json
import pickle
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from ofdf.data.dataset import Dataset
from ofdf.labels.risk import EVENT_GAP_HOURS, compose_compound, event_ids, future_labels
from ofdf.models import weather_risk

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def _load(name: str):
    if str(SCRIPTS) not in sys.path:
        sys.path.insert(0, str(SCRIPTS))
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


sta_evaluate = _load("sta_evaluate")
sta_recompute = _load("sta_recompute")
sta_common = sys.modules["sta_common"]


# --------------------------------------------------------------------------- 합성 자료

def _synthetic_dataset(days: int = 240, seed: int = 7) -> Dataset:
    """위험 5종이 사흘에 한 번꼴로 걸리는 2지점 시간자료."""
    rng = np.random.default_rng(seed)
    index = pd.date_range("2024-09-01", periods=days * 24, freq="h")
    hour, day = index.hour.to_numpy(), np.arange(len(index)) // 24
    parts = {k: [] for k in ("features", "labels", "states", "events", "meta")}

    for shift, station in enumerate(("가 지점", "나 지점")):
        kind = np.where(day % 3 == 0, (day // 3) % 6, -1)
        h = (hour - shift) % 24

        def span(kinds, lo, hi, peak_lo, peak_hi):
            on = np.isin(kind, kinds) & (h >= lo) & (h <= hi)
            return on.astype(int) + (on & (h >= peak_lo) & (h <= peak_hi)).astype(int)

        states = pd.DataFrame({
            "heat_dry": span([0], 11, 16, 13, 14),
            "rain_wet": span([1, 3, 5], 8, 15, 11, 12),
            "disease": span([1, 4], 9, 18, 13, 15),
            "frost": span([2, 3], 2, 7, 4, 5),
        }, index=index)
        states["compound"] = compose_compound(states["rain_wet"], states["disease"], states["frost"])

        def ahead(col):                      # 앞으로 3시간 안의 최고 등급 — 선행 신호 흉내
            s = states[col]
            return pd.concat([s.shift(-i) for i in range(0, 4)], axis=1).max(axis=1).fillna(0)

        noise = lambda scale: rng.normal(0.0, scale, len(index))     # noqa: E731
        features = pd.DataFrame({
            "t_air": ahead("heat_dry") + noise(0.45),
            "rain": ahead("rain_wet") + noise(0.45),
            "rh": ahead("disease") + noise(0.45),
            "dew_point": ahead("frost") + noise(0.45),
            "cur_heat": states["heat_dry"] + noise(0.3),
            "cur_rain": states["rain_wet"] + noise(0.3),
            "cur_disease": states["disease"] + noise(0.3),
            "cur_frost": states["frost"] + noise(0.3),
            "hour_sin": np.sin(hour / 24 * 2 * np.pi),
            "noise": noise(1.0),
        }, index=index)
        events = pd.DataFrame({
            f"{r}_event": event_ids(states[r], EVENT_GAP_HOURS[r]).map(
                lambda i, st=station: f"{st}#{i}" if i >= 0 else None)
            for r in states.columns
        }, index=index)

        parts["features"].append(features)
        parts["labels"].append(future_labels(states, (1, 3)))
        parts["states"].append(states)
        parts["events"].append(events)
        parts["meta"].append(pd.DataFrame({"station": station, "ts": index}, index=index))
    return Dataset(**{k: pd.concat(v) for k, v in parts.items()})


def _write_hash_list(model_dir: Path, path: Path) -> None:
    lines = [f"{sta_common.sha256_file(p)}  {p.name}" for p in sorted(model_dir.iterdir()) if p.is_file()]
    path.write_text("# 합성 모델 해시\n\n```\n" + "\n".join(lines) + "\n```\n", encoding="utf-8")


@pytest.fixture(scope="module")
def bundle(tmp_path_factory):
    """합성 자료 → train_weather.py 학습 → 모델 묶음·performance.csv·해시 목록."""
    work = tmp_path_factory.mktemp("sta")
    cache = work / "dataset.pkl"
    cache.write_bytes(pickle.dumps(_synthetic_dataset()))
    models = work / "weather"

    train_weather = _load("train_weather")
    with pytest.MonkeyPatch.context() as patch:
        # 학습을 빠르게 — 판정 경로(가중치·경계·앙상블 파일)는 그대로 지나간다
        patch.setitem(weather_risk.DEFAULT_PARAMS, "num_leaves", 15)
        patch.setitem(weather_risk.DEFAULT_PARAMS, "learning_rate", 0.2)
        patch.setitem(weather_risk.DEFAULT_PARAMS, "min_data_in_leaf", 20)
        patch.setitem(weather_risk.DEFAULT_PARAMS, "num_threads", 1)
        patch.setitem(weather_risk.DEFAULT_PARAMS, "seed", 1)
        patch.setattr(weather_risk, "tune_decision_weights", lambda proba, y, **_: [1.0, 1.3, 0.9])
        patch.setattr(sys, "argv", [
            "train_weather.py", "--aaos-dir", "unused", "--agera5", "unused",
            "--cache", str(cache), "--out", str(models), "--seed", "42",
        ])
        assert train_weather.main() == 0

    hash_list = work / "모델해시.md"
    _write_hash_list(models, hash_list)
    return {"work": work, "cache": cache, "models": models, "hash_list": hash_list}


def _evaluate(bundle, out: Path, *extra: str, models: Path | None = None) -> int:
    return sta_evaluate.main([
        "--cache", str(bundle["cache"]), "--models", str(models or bundle["models"]),
        "--out", str(out), "--seed", "42", "--hash-list", str(bundle["hash_list"]), *extra,
    ])


@pytest.fixture(scope="module")
def result(bundle):
    out = bundle["work"] / "sta_ai노지"
    code = _evaluate(bundle, out)
    return {"code": code, "out": out}


def _rows(path: Path) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


# --------------------------------------------------------------------------- 평가

def test_evaluation_matches_training_performance_csv(bundle, result):
    """고정 모델 평가의 최종값 = 학습 스크립트가 낸 performance.csv."""
    assert result["code"] == 0
    final = json.loads((result["out"] / "03_최종결과.json").read_text(encoding="utf-8"))
    assert final["성능평가서 대조"]["결과"] == "일치"

    table = pd.read_csv(bundle["models"] / "performance.csv", encoding="utf-8-sig")
    assert len(final["항목별"]) == len(table) == 10
    for item, (_, ref) in zip(final["항목별"], table.iterrows()):
        assert round(item["판정 조치단위F1"], 3) == pytest.approx(ref["판정 조치단위F1"])
        assert round(item["사례 단위 놓침 방지율"], 3) == pytest.approx(ref["이벤트 탐지율"])
        assert round(item["시간 단위 재현율(참고)"], 3) == pytest.approx(ref["AI 놓침방지율"])
        assert item["사례 수"] == ref["사례 수"]


def test_point_csv_has_one_row_per_test_sample_and_item(bundle, result):
    ds = pickle.loads(bundle["cache"].read_bytes())
    meta, states = ds.meta.reset_index(drop=True), ds.states.reset_index(drop=True)
    _, _, test_idx = weather_risk.split_by_event(weather_risk.shared_group_keys(meta, states), seed=42)

    points = _rows(result["out"] / "02_시점별_결과.csv")
    final = json.loads((result["out"] / "03_최종결과.json").read_text(encoding="utf-8"))
    assert len(points) == len(test_idx) * len(final["항목별"])
    assert list(points[0]) == sta_evaluate.POINT_COLUMNS
    assert {r["평가단위"] for r in points} == {"2등급", "3등급"}

    testset = _rows(result["out"] / "01_시험데이터" / "시험셋.csv")
    assert len(testset) == len(test_idx)
    assert (result["out"] / "01_시험데이터" / "통계.txt").read_text(encoding="utf-8").count("시간") >= 10


def test_outputs_are_utf8_bom_and_bundle_is_complete(result):
    for name in ("02_시점별_결과.csv", "02_사례별_결과.csv"):
        assert (result["out"] / name).read_bytes().startswith(b"\xef\xbb\xbf")
    for name in ("00_시험대상_해시.txt", "01_시험데이터/sha256.txt", "03_최종결과.json", "05_실행로그.txt"):
        assert (result["out"] / name).exists()
    final = json.loads((result["out"] / "03_최종결과.json").read_text(encoding="utf-8"))
    assert final["실행 환경"]["Python"] and final["실행 환경"]["LightGBM"]
    assert final["sha256"]["시험데이터"]["01_시험데이터/시험셋.csv"] == sta_common.sha256_file(
        result["out"] / "01_시험데이터" / "시험셋.csv")


def test_same_input_gives_same_logs(bundle, result):
    again = bundle["work"] / "again"
    assert _evaluate(bundle, again) == 0
    for name in ("02_시점별_결과.csv", "02_사례별_결과.csv", "01_시험데이터/시험셋.csv"):
        assert sta_common.sha256_file(again / name) == sta_common.sha256_file(result["out"] / name)


def test_miss_unit_is_a_setting(bundle):
    out = bundle["work"] / "hour"
    _evaluate(bundle, out, "--miss-unit", "hour", "--miss-target", "0.999")
    final = json.loads((out / "03_최종결과.json").read_text(encoding="utf-8"))
    assert final["기준"]["놓침 방지율"]["셈법"] == "시간 단위"
    for item in final["항목별"]:
        assert item["판정"]["놓침 방지율 판정에 쓴 값"] == item["시간 단위 재현율(참고)"]
    assert sta_recompute.main(["--dir", str(out)]) == 0


def test_stops_when_model_hash_differs(bundle):
    tampered = bundle["work"] / "tampered"
    shutil.copytree(bundle["models"], tampered)
    victim = tampered / "model_frost_h1_binary.weights.json"
    victim.write_text(json.dumps({"members": 5, "risk_threshold": 0.5}), encoding="utf-8")

    out = bundle["work"] / "stopped"
    assert _evaluate(bundle, out, models=tampered) == 2
    assert not (out / "02_시점별_결과.csv").exists()
    assert "해시 다름: model_frost_h1_binary.weights.json" in (out / "05_실행로그.txt").read_text(encoding="utf-8")


def test_check_only_verifies_hashes_without_writing_results(bundle, capsys):
    out = bundle["work"] / "check_only"
    assert _evaluate(bundle, out, "--check-only") == 0
    assert not out.exists()
    assert "model_frost_h3_binary_cv4.txt" in capsys.readouterr().out


def test_sealed_testset_hash_is_checked(bundle, result):
    sealed = sta_common.sha256_file(result["out"] / "01_시험데이터" / "시험셋.csv")
    assert _evaluate(bundle, bundle["work"] / "sealed_ok", "--expect-testset-sha256", sealed) == 0
    assert _evaluate(bundle, bundle["work"] / "sealed_bad", "--expect-testset-sha256", "0" * 64) == 2


def test_stops_when_extra_ensemble_member_is_present(bundle):
    extra = bundle["work"] / "extra"
    shutil.copytree(bundle["models"], extra)
    shutil.copy(extra / "model_frost_h1_binary_cv0.txt", extra / "model_frost_h1_binary_cv9.txt")
    assert _evaluate(bundle, bundle["work"] / "stopped2", models=extra) == 2


# --------------------------------------------------------------------------- 재계산

def test_recompute_from_logs_matches_final_json(result):
    assert sta_recompute.main(["--dir", str(result["out"])]) == 0
    text = (result["out"] / "04_재계산_결과.txt").read_text(encoding="utf-8")
    assert "[일치]" in text and "불일치" not in text


def test_recompute_formulas_agree_with_sklearn(result):
    from sklearn.metrics import f1_score

    points = _rows(result["out"] / "02_시점별_결과.csv")
    for tag in {r["판정항목"] for r in points}:
        rows = [r for r in points if r["판정항목"] == tag]
        size = 2 if rows[0]["평가단위"] == "2등급" else 3
        true = [int(r["정답_평가단위"]) for r in rows]
        pred = [int(r["예측_평가단위"]) for r in rows]
        mine = sta_recompute.macro_f1(sta_recompute.per_class(sta_recompute.confusion_matrix(rows, size)))
        assert mine == pytest.approx(
            f1_score(true, pred, labels=list(range(size)), average="macro", zero_division=0), abs=1e-12)


def test_recompute_reads_logs_only_and_needs_no_third_party_package(bundle, result):
    """모델·원천자료 없이, 표준 라이브러리만으로 돈다."""
    alone = bundle["work"] / "alone"
    alone.mkdir()
    for name in ("02_시점별_결과.csv", "02_사례별_결과.csv", "03_최종결과.json"):
        shutil.copy(result["out"] / name, alone / name)
    done = subprocess.run(
        [sys.executable, "-I", "-S", str(SCRIPTS / "sta_recompute.py"), "--dir", str(alone)],
        capture_output=True, text=True, encoding="utf-8",
    )
    assert done.returncode == 0, done.stdout + done.stderr


@pytest.mark.parametrize("column", ["예측등급(0·1·2)", "예측_평가단위"])
def test_recompute_fails_when_a_point_row_is_changed(bundle, result, column):
    broken = bundle["work"] / f"broken_{column[:4]}"
    shutil.copytree(result["out"], broken)
    path = broken / "02_시점별_결과.csv"
    rows = _rows(path)
    target = next(r for r in rows if r["위험사례ID"] and r["예측등급(0·1·2)"] != "0")
    target[column] = "0"
    with open(path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    assert sta_recompute.main(["--dir", str(broken)]) == 1


def test_recompute_fails_when_final_value_is_changed(bundle, result):
    broken = bundle["work"] / "broken_json"
    shutil.copytree(result["out"], broken)
    path = broken / "03_최종결과.json"
    final = json.loads(path.read_text(encoding="utf-8"))
    final["항목별"][0]["판정 조치단위F1"] += 0.001
    path.write_text(json.dumps(final, ensure_ascii=False), encoding="utf-8")
    assert sta_recompute.main(["--dir", str(broken)]) == 1


# --------------------------------------------------------------------------- 판단시간

def test_per_run_timing_csv_recomputes_to_same_summary(bundle, result):
    benchmark = _load("benchmark_inference")
    rng = np.random.default_rng(3)
    per_run = {stage: list(rng.uniform(0.001, 0.05, 200)) for _, stage in benchmark.PER_RUN_COLUMNS}

    out = bundle["work"] / "timing"
    shutil.copytree(result["out"], out)
    path = out / "06_판단시간_회차별.csv"
    summary = benchmark.write_per_run(path, per_run, sta_common.environment())

    rows = _rows(path)
    assert len(rows) == 200 and list(rows[0]) == ["회차"] + sta_recompute.STAGE_COLUMNS
    assert summary["판정"] == "적합" and summary["실행 환경"]["CPU 코어 수"]
    assert summary["단계별"]["끝에서 끝까지(ms)"]["평균(ms)"] == pytest.approx(
        np.mean(per_run["끝에서 끝까지"]) * 1000)
    assert sta_recompute.main(["--dir", str(out)]) == 0

    rows[10]["끝에서 끝까지(ms)"] = "99999"
    with open(path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    assert sta_recompute.main(["--dir", str(out)]) == 1


# --------------------------------------------------------------------------- 한 번에 실행

def test_run_all_runs_every_step_and_writes_prerun_log(bundle):
    run_all = _load("sta_run_all")
    out = bundle["work"] / "run_all"
    log = bundle["work"] / "사전실행로그.md"
    code = run_all.main([
        "--cache", str(bundle["cache"]), "--models", str(bundle["models"]), "--out", str(out),
        "--hash-list", str(bundle["hash_list"]), "--prerun-log", str(log),
        "--skip-benchmark",          # 합성 자료에는 판단시간 측정에 쓸 원시 관측 열이 없다
    ])
    assert code == 0
    text = log.read_text(encoding="utf-8")
    assert "전 단계 통과" in text and "시험셋.csv sha256" in text and "복합위험 3시간" in text
    assert (out / "04_재계산_결과.txt").exists()
    assert list(bundle["work"].glob("run_all_*.zip"))


def test_run_all_stops_at_first_failure(bundle):
    run_all = _load("sta_run_all")
    log = bundle["work"] / "실패로그.md"
    code = run_all.main([
        "--cache", str(bundle["cache"]), "--models", str(bundle["work"] / "없는폴더"),
        "--out", str(bundle["work"] / "run_fail"), "--hash-list", str(bundle["hash_list"]),
        "--prerun-log", str(log), "--skip-benchmark",
    ])
    assert code == 1
    assert "실패" in log.read_text(encoding="utf-8")
    assert not (bundle["work"] / "run_fail" / "02_시점별_결과.csv").exists()


def test_cpu_name_is_not_a_bare_number():
    assert not str(sta_common.environment()["CPU"]).isdigit()
