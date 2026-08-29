"""AI trainer tooling: import-safety without the ml extra installed."""
from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
TRAIN = BACKEND / "ai" / "trainer" / "train.py"
EXTRACT = BACKEND / "ai" / "trainer" / "extract_frames.py"


def test_trainer_scripts_parse():
    for script in (TRAIN, EXTRACT):
        ast.parse(script.read_text(encoding="utf-8"), filename=str(script))


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
