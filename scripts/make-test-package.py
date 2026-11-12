#!/usr/bin/env python3
"""시험기관에 보낼 꾸러미를 만든다 — 의뢰서 + 돌아가는 프로그램 + 예제.

왜 스크립트인가. 모델이나 측정 코드가 바뀌면 꾸러미도 바뀌어야 한다. 손으로
모으면 어느 판이 나갔는지 알 수 없게 되고, 시험기관이 받은 것과 저장소에 있는
것이 달라진다. 한 번에 다시 만든다.

    python scripts/make-test-package.py -o out/시험의뢰_shrimp365.zip

zip 은 **파이썬으로** 만든다. `zip` 명령은 파일 이름에 UTF-8 표시를 남기지
않아, 윈도우에서 한글 폴더 이름이 깨진다.
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
DOCS = ROOT / "docs" / "result-03-bluestartup"
MODEL = VISION / "ai" / "models" / "shrimp_yolov8n_416.onnx"

PROGRAMS = ("eval_detect.py", "draw_detections.py", "prepare_dataset.py",
            "export_edge.py", "run_test_eval.sh", "fetch_roboflow.py")


def hwpx(src: Path, dest: Path) -> None:
    subprocess.run([sys.executable, str(ROOT / "scripts" / "md-to-hwpx.py"),
                    str(src), "-o", str(dest)], check=True,
                   stdout=subprocess.DEVNULL)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default="out/시험의뢰_shrimp365.zip")
    ap.add_argument("--samples", default=None,
                    help="설치 확인용 예제 폴더(images/ labels/). 없으면 뺀다")
    args = ap.parse_args()

    if not MODEL.exists():
        sys.exit(f"[오류] 모델이 없습니다: {MODEL}")

    with tempfile.TemporaryDirectory() as tmp:
        pkg = Path(tmp) / "시험의뢰_shrimp365"
        (pkg / "모델").mkdir(parents=True)
        (pkg / "프로그램" / "ai" / "trainer").mkdir(parents=True)
        (pkg / "프로그램" / "tests").mkdir(parents=True)

        shutil.copy(MODEL, pkg / "모델" / MODEL.name)
        digest = hashlib.sha256(MODEL.read_bytes()).hexdigest()
        (pkg / "모델" / "sha256.txt").write_text(f"{digest}  {MODEL.name}\n",
                                                encoding="utf-8")

        shutil.copytree(VISION / "app", pkg / "프로그램" / "app",
                        ignore=shutil.ignore_patterns("__pycache__"))
        for name in PROGRAMS:
            shutil.copy(VISION / "ai" / "trainer" / name,
                        pkg / "프로그램" / "ai" / "trainer" / name)
        shutil.copy(VISION / "tests" / "test_eval_detect.py",
                    pkg / "프로그램" / "tests" / "test_eval_detect.py")
        shutil.copy(VISION / "pyproject.toml", pkg / "프로그램" / "pyproject.toml")

        for name, src in (("시험의뢰_패키지", DOCS / "시험의뢰_패키지.md"),
                          ("00_읽어주세요", DOCS / "시험기관_안내.md")):
            shutil.copy(src, pkg / f"{name}.md")
            hwpx(src, pkg / f"{name}.hwpx")

        if args.samples:
            sample = Path(args.samples)
            shutil.copytree(sample, pkg / "예제_15장",
                            ignore=shutil.ignore_patterns("__pycache__"))

        dest = Path(args.out)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.unlink(missing_ok=True)
        with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
            for path in sorted(pkg.rglob("*")):
                if path.is_file() and "__pycache__" not in path.parts:
                    zf.write(path, str(Path(pkg.name) / path.relative_to(pkg)))

    with zipfile.ZipFile(dest) as zf:
        infos = zf.infolist()
        assert all(i.flag_bits & 0x800 for i in infos), "UTF-8 표시가 빠졌습니다"
    print(f"만들었습니다: {dest}  ({dest.stat().st_size / 1024 / 1024:.1f} MB,"
          f" 항목 {len(infos)}개)")
    print(f"  모델 sha256 {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
