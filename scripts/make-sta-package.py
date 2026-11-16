#!/usr/bin/env python3
"""STA 입회시험용 꾸러미를 만든다 — 프로그램 + 리허설 자료 + 절차서.

시험 PC에 이 zip 하나를 풀면 설치 → 리허설 → 사전 측정 → 시험 당일 실행까지
절차서대로 할 수 있다. 저장소(git) 없이도 돈다.

    python scripts/make-sta-package.py -o out/STA_블루스타트업_시험꾸러미.zip

들어가지 않는 것: 원본 데이터셋(shrimp_cf, Counting PL). 용량·라이선스 때문에
저장소에 없다 — 구글 드라이브에서 받아 꾸러미의 `원본데이터/` 에 둔다.

zip 은 파이썬으로 만든다(`zip` 명령은 UTF-8 표시를 남기지 않아 윈도우에서
한글 이름이 깨진다).
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VISION = ROOT / "vision"
NAME = "STA_블루스타트업_시험꾸러미"
TRAINER = ("sta_run.py", "eval_detect.py", "recompute_detect.py", "prepare_dataset.py",
           "fetch_roboflow.py", "run_test_eval.sh")
REQUIREMENTS = """# STA 시험에 필요한 것 — GPU·torch 는 필요 없다. 파이썬 3.11 이상.
numpy>=1.26
onnxruntime>=1.17
pillow>=10.0
pydantic>=2.7
pydantic-settings>=2.3
pytest>=8.2
"""
DATA_README = """원본 데이터셋 2종을 여기에 둔다 (구글 드라이브 `01. 흰다리새우 학습 데이터`)

  원본데이터/shrimp_cf.v1i.yolov8/      ← 03. shrimp_cf/shrimp_cf.v1i.yolov8
  원본데이터/Counting PL.v1i.yolov8/    ← 04. Counting PL/Counting PL.v1i.yolov8

각 폴더 바로 아래에 data.yaml, train/, valid/, test/ 가 보여야 한다.
yolov11·coco 판이 아니라 yolov8 판이다. 순서는 00_절차서 3·4단계.
"""


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default=f"out/{NAME}.zip")
    args = ap.parse_args()

    dirty = subprocess.run(["git", "-C", str(ROOT), "status", "--porcelain",
                            "--untracked-files=no", "--", "vision"],
                           capture_output=True, text=True, check=True).stdout.strip()
    if dirty:
        sys.exit("[오류] vision/ 에 커밋되지 않은 변경이 있습니다. 커밋한 뒤 만드세요 — "
                 "꾸러미에 적는 git 커밋과 내용이 달라집니다.")
    commit = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"],
                            capture_output=True, text=True, check=True).stdout.strip()

    ignore = shutil.ignore_patterns("__pycache__", "*.pyc")
    with tempfile.TemporaryDirectory() as tmp:
        pkg = Path(tmp) / NAME
        prog = pkg / "프로그램"
        (prog / "ai" / "trainer").mkdir(parents=True)
        (prog / "ai" / "models").mkdir()
        (prog / "tests").mkdir()

        shutil.copytree(VISION / "app", prog / "app", ignore=ignore)
        for name in TRAINER:
            shutil.copy(VISION / "ai" / "trainer" / name, prog / "ai" / "trainer" / name)
        shutil.copy(VISION / "ai" / "models" / "shrimp_yolov8n_416.onnx", prog / "ai" / "models")
        for name in ("__init__.py", "test_eval_detect.py"):
            shutil.copy(VISION / "tests" / name, prog / "tests" / name)
        for name in ("pyproject.toml", "VERSION"):
            shutil.copy(VISION / name, prog / name)
        (prog / "requirements-sta.txt").write_text(REQUIREMENTS, encoding="utf-8")
        (prog / "GIT_COMMIT").write_text(commit + "\n", encoding="utf-8")

        # 리허설 자료 — sta_run.py rehearsal 이 찾는 자리에 그대로 둔다
        tank = VISION / "data" / "tank" / "labeled"
        for name in ("images", "labels"):
            shutil.copytree(tank / name, prog / "data" / "tank" / "labeled" / name, ignore=ignore)

        (pkg / "원본데이터").mkdir()
        (pkg / "원본데이터" / "여기에_데이터셋을_둡니다.txt").write_text(DATA_README, encoding="utf-8")

        docs = VISION / "docs"
        shutil.copy(docs / "STA-시험-절차서.md", pkg / "00_절차서.md")
        shutil.copy(docs / "STA-시험준비-체크리스트.md", pkg / "01_준비_체크리스트.md")
        if shutil.which("pandoc"):                    # 워드로도 넣는다(인쇄·열람용)
            subprocess.run(["pandoc", str(pkg / "00_절차서.md"), "-f", "gfm",
                            "-o", str(pkg / "00_절차서.docx")], check=True)
        else:
            print("  (pandoc 이 없어 00_절차서.docx 는 넣지 않았습니다)")

        files = sorted(p for p in pkg.rglob("*") if p.is_file())
        (pkg / "sha256sums.txt").write_text(
            "".join(f"{sha256_of(p)}  {p.relative_to(pkg).as_posix()}\n" for p in files),
            encoding="utf-8")

        dest = Path(args.out)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.unlink(missing_ok=True)
        with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
            for path in sorted(pkg.rglob("*")):
                if path.is_file():
                    zf.write(path, str(Path(NAME) / path.relative_to(pkg)))

    with zipfile.ZipFile(dest) as zf:
        infos = zf.infolist()
        assert all(i.flag_bits & 0x800 for i in infos if not i.filename.isascii()), \
            "UTF-8 표시가 빠졌습니다"
    print(f"만들었습니다: {dest}  ({dest.stat().st_size / 1024 / 1024:.1f} MB, 항목 {len(infos)}개)")
    print(f"  git 커밋 {commit}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
