"""AI trainer tooling: import-safety without the ml extra installed."""
from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
TRAIN = BACKEND / "ai" / "trainer" / "train.py"
EXTRACT = BACKEND / "ai" / "trainer" / "extract_frames.py"
PREPARE = BACKEND / "ai" / "trainer" / "prepare_dataset.py"
EXPORT = BACKEND / "ai" / "trainer" / "export_edge.py"
EVAL = BACKEND / "ai" / "trainer" / "eval_count.py"
ALL_SCRIPTS = (TRAIN, EXTRACT, PREPARE, EXPORT, EVAL)


def test_trainer_scripts_parse():
    for script in ALL_SCRIPTS:
        ast.parse(script.read_text(encoding="utf-8"), filename=str(script))


def test_every_trainer_cli_shows_help_without_ml_deps():
    """--help 은 무거운 임포트 전에 떠야 하고, %-서식 사고로 죽어서도 안 된다.

    한글 도움말에 '±20%' 같은 조각이 들어가면 argparse 가 %-서식으로 해석해
    --help 가 ValueError 로 죽는다. 도구가 늘어날 때마다 같은 실수를 하므로
    전부 한 번에 확인한다.
    """
    for script in ALL_SCRIPTS:
        proc = subprocess.run(
            [sys.executable, str(script), "--help"],
            capture_output=True,
            text=True,
            cwd=BACKEND,
            timeout=60,
        )
        assert proc.returncode == 0, f"{script.name}: {proc.stderr}"
        assert "usage:" in proc.stdout
        assert "%%" not in proc.stdout, f"{script.name} 도움말에 %% 가 그대로 보인다"


def test_export_edge_without_ultralytics_exits_with_friendly_message():
    proc = subprocess.run(
        [sys.executable, str(EXPORT), "--weights", "best.pt", "--format", "onnx"],
        capture_output=True,
        text=True,
        cwd=BACKEND,
        timeout=60,
    )
    assert proc.returncode == 1
    assert "ultralytics" in proc.stderr


def test_train_without_ultralytics_exits_with_friendly_message(tmp_path):
    # The test venv has no ml extra -> ultralytics import must fail cleanly.
    proc = subprocess.run(
        [sys.executable, str(TRAIN), "--epochs", "1", "--project", str(tmp_path)],
        capture_output=True,
        text=True,
        cwd=BACKEND,
        timeout=60,
    )
    assert proc.returncode == 1
    assert "ultralytics" in proc.stderr
    assert "pip install" in proc.stderr


def test_extract_frames_without_cv2_exits_with_friendly_message(tmp_path):
    proc = subprocess.run(
        [
            sys.executable,
            str(EXTRACT),
            "--source",
            "nonexistent.mp4",
            "--out",
            str(tmp_path),
        ],
        capture_output=True,
        text=True,
        cwd=BACKEND,
        timeout=60,
    )
    assert proc.returncode == 1
    assert "opencv" in proc.stderr
    assert "pip install" in proc.stderr


def test_train_help_runs_without_ml_deps():
    # argparse --help must work before any heavy import is attempted.
    proc = subprocess.run(
        [sys.executable, str(TRAIN), "--help"],
        capture_output=True,
        text=True,
        cwd=BACKEND,
        timeout=60,
    )
    assert proc.returncode == 0
    for flag in ("--data", "--base-model", "--epochs", "--imgsz", "--batch", "--device"):
        assert flag in proc.stdout
