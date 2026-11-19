"""STA 시험 꾸러미 만들기 — 시험 PC 에 가져갈 폴더(와 zip)를 조립한다.

사용 예::

    python scripts/sta_make_kit.py --out dist/STA_AI_nozi_test_kit --zip

만들어지는 모양(블루스타트업 꾸러미와 같은 짜임)::

    읽어_주세요.md            한 장짜리 안내 (docs/STA-시험-절차서.md)
    1_setup  2_check  3_rehearsal  4_test    실행 파일 (.bat / .sh)
    9_train_model                            모델 묶음을 잃어버렸을 때만
    model/      고정 모델 묶음을 넣는 곳 (비어 있음)
    data/       dataset.pkl 또는 원천자료를 넣는 곳 (비어 있음)
    program/    평가·재계산·판단시간 측정 프로그램 (판단 코드 src/ofdf 포함)
    result/     실행 결과
    reference/  명령 상세, 신청서 정정안, 성능평가서, 모델 설명서

모델·자료는 넣지 않는다(저장소에 없고, 올리지도 않는다).
폴더·실행 파일 이름을 영문으로 둔 것은 Windows 배치 파일이 한글 경로를 코드페이지에
따라 다르게 읽기 때문이다. 배치 파일 내용도 ASCII 뿐이다.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PROGRAM_SCRIPTS = [
    "sta_common.py", "sta_evaluate.py", "sta_recompute.py", "sta_prepare.py", "sta_run_all.py", "sta_retrain.py",
    "sta_export_data.py", "sta_make_submission.py",
    "benchmark_inference.py", "train_weather.py", "experiment_hourly_recall.py",
]
PROGRAM_FILES = [
    "requirements.txt", "pyproject.toml", "tests/test_sta_evaluate.py",
    "reports/시험의뢰/모델해시.md", "reports/시험의뢰/판단코드해시_5ff054f.txt",
    "reports/성능평가서.md",
]
REFERENCE = [
    "docs/STA-시험당일-실행순서.md", "docs/STA-신청서-정정안.md",
    "reports/성능평가서.md", "reports/AI모델설명서.md",
]
AGERA5 = "AgERA5_Naju-Daegyo_2x2mean_daily_2015-2026.csv"

#: 실행 파일 — (이름, 설명, 프로그램 인자). {kit} 은 꾸러미 폴더로 바뀐다
PATHS = ["--cache", "{kit}data{sep}dataset.pkl", "--models", "{kit}model"]
STEPS = [
    ("1_setup", "install packages and run the self-test", None),
    ("2_check", "check model, data and environment",
     ["sta_prepare.py", *PATHS, "--aaos-dir", "{kit}data{sep}aaos",
      "--agera5", "{kit}data{sep}" + AGERA5]),
    ("3_rehearsal", "rehearsal: run every step and seal the test set",
     ["sta_run_all.py", "--mode", "rehearsal", *PATHS, "--out", "{kit}result{sep}rehearsal",
      "--seal-file", "{kit}result{sep}sealed_testset.sha256",
      "--prerun-log", "{kit}result{sep}rehearsal_log.md"]),
    ("4_test", "test day: run every step against the sealed test set",
     ["sta_run_all.py", "--mode", "testday", *PATHS, "--out", "{kit}result{sep}testday",
      "--seal-file", "{kit}result{sep}sealed_testset.sha256",
      "--prerun-log", "{kit}result{sep}testday_log.md"]),
    ("5_submission", "after the test: zip model / training data / test data and write SHA-256",
     ["sta_make_submission.py", *PATHS, "--out", "{kit}result{sep}submission"]),
    # 고정 모델 묶음을 끝내 찾지 못했을 때만 쓴다
    ("9_train_model", "ONLY IF THE MODEL BUNDLE IS LOST: retrain and fix a new bundle",
     ["sta_retrain.py", *PATHS, "--aaos-dir", "{kit}data{sep}aaos",
      "--agera5", "{kit}data{sep}" + AGERA5]),
]


def launcher_bat(name: str, title: str, args: list[str] | None) -> str:
    lines = ["@echo off", f"rem STA AI nozi - {title}", "chcp 65001 >nul", "set PYTHONUTF8=1",
             "set PYTHONIOENCODING=utf-8", 'cd /d "%~dp0"', f"echo === {name}: {title} ==="]
    if args is None:
        lines += [
            "python -m venv program\\.venv", "if errorlevel 1 goto done",
            "call program\\.venv\\Scripts\\activate.bat",
            "python -m pip install --upgrade pip",
            "python -m pip install -r program\\requirements.txt pytest", "if errorlevel 1 goto done",
            "python -m pytest program\\tests\\test_sta_evaluate.py -q -p no:cacheprovider",
        ]
    else:
        quoted = " ".join(
            f'"{a.format(kit="%~dp0", sep=chr(92))}"' if "{kit}" in a else a for a in args[1:]
        )
        lines += [
            "if exist program\\.venv\\Scripts\\activate.bat call program\\.venv\\Scripts\\activate.bat",
            f"python program\\scripts\\{args[0]} {quoted} %*",
        ]
    lines += [":done", "set CODE=%ERRORLEVEL%", "echo.", "echo [exit code %CODE%]", "pause",
              "exit /b %CODE%", ""]
    return "\r\n".join(lines)


def launcher_sh(name: str, title: str, args: list[str] | None) -> str:
    lines = ["#!/usr/bin/env bash", f"# STA AI nozi - {title}", "set -u",
             'KIT="$(cd "$(dirname "$0")" && pwd)/"', 'cd "$KIT"', "export PYTHONUTF8=1",
             f'echo "=== {name}: {title} ==="']
    if args is None:
        lines += [
            "python3 -m venv program/.venv && . program/.venv/bin/activate \\",
            "  && python -m pip install --upgrade pip \\",
            "  && python -m pip install -r program/requirements.txt pytest \\",
            "  && python -m pytest program/tests/test_sta_evaluate.py -q -p no:cacheprovider",
        ]
    else:
        quoted = " ".join(
            f'"{a.format(kit="${KIT}", sep="/")}"' if "{kit}" in a else a for a in args[1:]
        )
        lines += ["[ -f program/.venv/bin/activate ] && . program/.venv/bin/activate",
                  f'python program/scripts/{args[0]} {quoted} "$@"']
    lines += ["code=$?", 'echo; echo "[exit code $code]"', "exit $code", ""]
    return "\n".join(lines)


def to_pdf(markdown: Path) -> Path | None:
    """pandoc·LibreOffice 가 있으면 PDF 로도 떠 둔다(없으면 건너뛴다)."""
    if not (shutil.which("pandoc") and shutil.which("soffice")):
        return None
    docx = markdown.with_suffix(".docx")
    try:
        subprocess.run(["pandoc", str(markdown), "-o", str(docx)], check=True, timeout=120)
        subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir",
                        str(markdown.parent), str(docx)], check=True, timeout=180,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    finally:
        docx.unlink(missing_ok=True)
    pdf = markdown.with_suffix(".pdf")
    return pdf if pdf.exists() else None


def build(out: Path, *, pdf: bool = True) -> Path:
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"비어 있지 않은 폴더입니다: {out} (다른 --out 을 주거나 직접 비우십시오)")
    program = out / "program"
    ignore = shutil.ignore_patterns("__pycache__", "*.pyc")
    shutil.copytree(ROOT / "src", program / "src", ignore=ignore)
    shutil.copytree(ROOT / "configs", program / "configs", ignore=ignore)
    (program / "scripts").mkdir(parents=True)
    for name in PROGRAM_SCRIPTS:
        shutil.copy2(ROOT / "scripts" / name, program / "scripts" / name)
    for rel in PROGRAM_FILES:
        (program / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / rel, program / rel)

    reference = out / "reference"
    reference.mkdir()
    for rel in REFERENCE:
        target = reference / Path(rel).name
        shutil.copy2(ROOT / rel, target)
        if pdf and rel.startswith("docs/"):
            to_pdf(target)

    readme = out / "읽어_주세요.md"
    shutil.copy2(ROOT / "docs" / "STA-시험-절차서.md", readme)
    if pdf:
        to_pdf(readme)

    notes = {
        "model": "여기에 고정 모델 묶음을 넣는다.\n\n"
                 "- OFDF_시험대상_5ff054f.zip 을 그대로 넣거나, 풀어서 파일 56개를 넣는다.\n"
                 "- 다시 학습한 모델은 쓸 수 없다(해시가 달라 시험이 멈춘다).\n",
        "data": "여기에 시험 자료를 넣는다.\n\n"
                "- dataset.pkl (학습 때 만든 데이터셋 캐시)\n"
                f"- dataset.pkl 이 없으면: aaos/ 폴더에 기상 데이터_YYYYMM.xls 전부, 이 폴더에 {AGERA5}\n",
        "result": "실행 결과가 여기에 쌓인다.\n\n"
                  "- rehearsal/ , rehearsal_log.md — 예행연습\n"
                  "- testday/ , testday_<날짜>.zip — 시험 당일(이 zip 을 STA 에 보낸다)\n",
    }
    for folder, text in notes.items():
        (out / folder).mkdir()
        (out / folder / "여기는.md").write_text(text, encoding="utf-8")
    (out / "data" / "aaos").mkdir()

    for name, title, args in STEPS:
        (out / f"{name}.bat").write_bytes(launcher_bat(name, title, args).encode("ascii"))
        script = out / f"{name}.sh"
        script.write_bytes(launcher_sh(name, title, args).encode("ascii"))
        script.chmod(0o755)
    return out


def make_zip(folder: Path) -> Path:
    """한글 파일 이름에 UTF-8 표시가 붙도록 파이썬 zipfile 로 묶는다(Windows 탐색기 호환)."""
    archive = folder.with_suffix(".zip")
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(folder.rglob("*")):
            if "__pycache__" in path.parts or ".venv" in path.parts:
                continue
            arcname = (Path(folder.name) / path.relative_to(folder)).as_posix()
            if path.is_dir():
                if not any(path.iterdir()):
                    bundle.writestr(arcname + "/", "")
            else:
                bundle.write(path, arcname)
    return archive


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", default="dist/STA_AI_nozi_test_kit")
    p.add_argument("--zip", action="store_true", help="같은 이름의 zip 도 만든다")
    p.add_argument("--no-pdf", action="store_true", help="PDF 변환을 건너뛴다")
    args = p.parse_args(argv)
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    build(out, pdf=not args.no_pdf)
    print(f"꾸러미: {out}")
    for item in sorted(out.iterdir()):
        print(f"  {item.name}{'/' if item.is_dir() else ''}")
    if args.zip:
        archive = make_zip(out)
        print(f"zip: {archive} ({archive.stat().st_size / 2**20:.1f}MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
