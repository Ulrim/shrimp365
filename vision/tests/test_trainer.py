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
PSEUDO = BACKEND / "ai" / "trainer" / "pseudo_label.py"
NOTEBOOK = BACKEND / "ai" / "trainer" / "colab_train_shrimp.ipynb"
ALL_SCRIPTS = (TRAIN, EXTRACT, PREPARE, EXPORT, EVAL, PSEUDO)


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


def test_colab_notebook_is_valid_and_wired_to_the_trainer_scripts():
    """노트북이 깨진 JSON 이거나 셀 코드가 문법적으로 틀리면 Colab 에서 열어 본 뒤에야
    안다. 여기서 미리 막는다(실행은 GPU 가 필요해 할 수 없다)."""
    import json

    notebook = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    assert notebook["nbformat"] == 4
    code_cells = [c for c in notebook["cells"] if c["cell_type"] == "code"]
    assert len(code_cells) >= 10

    for index, cell in enumerate(code_cells):
        body = "\n".join(
            line
            for line in cell["source"].splitlines()
            if not line.lstrip().startswith(("!", "%"))
        )
        ast.parse(body, filename=f"{NOTEBOOK.name}#code[{index}]")

    joined = "\n".join(c["source"] for c in notebook["cells"])
    for script in ("prepare_dataset.py", "train.py", "eval_count.py", "export_edge.py"):
        assert script in joined, f"노트북이 {script} 를 쓰지 않는다"
    # 드라이브의 실제 폴더 이름(공백·한글 포함)이 그대로 들어가 있어야 한다.
    assert "01. 흰다리새우 학습 데이터" in joined


def test_train_exposes_resume_for_interrupted_runs():
    """CPU 장시간 학습과 Colab 세션 끊김을 복구하는 경로. 플래그가 사라지면
    긴 학습을 처음부터 다시 돌려야 한다."""
    proc = subprocess.run(
        [sys.executable, str(TRAIN), "--help"],
        capture_output=True,
        text=True,
        cwd=BACKEND,
        timeout=60,
    )
    assert proc.returncode == 0
    assert "--resume" in proc.stdout
