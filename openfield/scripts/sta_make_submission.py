"""STA 회신용 — 모델·학습 데이터·시험 데이터를 각각 압축하고 SHA-256 해시값을 적는다.

사용 예::

    python scripts/sta_make_submission.py \
        --cache artifacts/dataset.pkl --models artifacts/weather --out sta_제출

시험기관은 파일 자체가 아니라 **압축 파일의 해시값**을 받는다. 구분마다 압축 파일 하나를 만든다.

    nozi_model.zip        모델·판정 경계 파일 + 판단 코드(src/ofdf) + 실행 스크립트 + 해시 목록
    nozi_train_data.zip   학습데이터.csv · 검증데이터.csv · (학습보강_작기밖.csv) · 통계.txt
    nozi_test_data.zip    시험데이터.csv · 통계.txt
    해시값.txt            위 세 파일의 SHA-256, 크기, 안에 든 파일과 건수

읽기만 한다 — 모델·시험 결과·데이터셋 캐시를 바꾸지 않는다. 분할은 학습·평가와 같은
함수·같은 씨앗(42)으로 다시 만든다(`sta_export_data.py`).
"""

from __future__ import annotations

import argparse
import datetime
import shutil
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sta_common  # noqa: E402
import sta_export_data  # noqa: E402

ROOT = sta_common.ROOT


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--cache", default="artifacts/dataset.pkl")
    p.add_argument("--year-round-cache", default=None, help="기본: 캐시 옆 dataset_all.pkl")
    p.add_argument("--models", default="artifacts/weather")
    p.add_argument("--out", default="sta_제출")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--no-off-season", action="store_true",
                   help="작기 밖 학습 보강 자료를 학습 데이터 압축에 넣지 않는다(건수만 통계에 적힌다)")
    return p.parse_args(argv)


def resolve(path: str) -> Path:
    p = Path(path).expanduser()
    return p if p.is_absolute() else ROOT / p


def make_zip(archive: Path, files: list[tuple[Path, str]]) -> list[str]:
    """``(파일, 압축 안 이름)`` 을 이름순으로 넣는다. 넣은 이름 목록을 돌려준다."""
    names = []
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for path, name in sorted(files, key=lambda pair: pair[1]):
            bundle.write(path, name)
            names.append(name)
    return names


def count_rows(path: Path) -> int:
    with open(path, "rb") as handle:
        return max(sum(1 for _ in handle) - 1, 0)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    cache, model_dir, out = resolve(args.cache), resolve(args.models), resolve(args.out)
    out.mkdir(parents=True, exist_ok=True)
    started = datetime.datetime.now().astimezone()

    # 시험 대상 그대로인지 먼저 확인한다
    hash_list = sta_common.DEFAULT_HASH_LIST
    _, problems = sta_common.verify_model_hashes(model_dir, hash_list)
    if problems:
        print(f"[중단] 모델 묶음이 해시 목록과 다릅니다({len(problems)}건): {problems[0]}")
        return 2
    code = sta_common.verify_code_hashes()
    if code is None or code[1]:
        print("[중단] 판단 코드(src/ofdf)가 시험 대상 커밋과 같은지 확인되지 않습니다")
        return 2

    # 1) 학습·검증·시험 데이터를 CSV 로 내보낸다
    work = out / "_data"
    export_args = ["--cache", str(cache), "--out", str(work), "--seed", str(args.seed),
                   "--parts", "train,valid,test"]
    if args.year_round_cache:
        export_args += ["--year-round-cache", str(resolve(args.year_round_cache))]
    if not args.no_off_season:
        export_args.append("--with-off-season")
    if sta_export_data.main(export_args) != 0:
        return 2

    # 2) 구분마다 압축 파일 하나
    train_files = [(work / n, n) for n in ("학습데이터.csv", "검증데이터.csv", "학습보강_작기밖.csv", "통계.txt")
                   if (work / n).exists()]
    test_files = [(work / n, n) for n in ("시험데이터.csv", "통계.txt")]
    model_files = [(p, f"model/{p.name}") for p in model_dir.iterdir()
                   if p.is_file() and p.suffix in (".txt", ".json", ".csv")]
    model_files += [(p, "program/" + p.relative_to(ROOT).as_posix())
                    for p in sorted((ROOT / "src").rglob("*.py")) + sorted((ROOT / "scripts").glob("*.py"))]
    model_files += [(p, f"program/reports/시험의뢰/{p.name}")
                    for p in (hash_list, sta_common.CODE_HASH_LIST) if p.exists()]
    if (ROOT / "requirements.txt").exists():
        model_files.append((ROOT / "requirements.txt", "program/requirements.txt"))
    model_files += [(p, p.name) for p in sorted(ROOT.parent.glob("*.bat")) + sorted(ROOT.parent.glob("*.sh"))
                    if p.name[:1].isdigit()]                      # 꾸러미의 실행 파일(1_setup ~ 4_test)

    bundles = [
        ("모델(실행 파일 포함)", out / "nozi_model.zip", model_files),
        ("학습 데이터", out / "nozi_train_data.zip", train_files),
        ("시험(테스트) 데이터", out / "nozi_test_data.zip", test_files),
    ]
    lines = ["AI 노지(노지 대파 재해위험 판단 AI 모델) — 제출 자료 해시값",
             f"만든 시각: {started:%Y-%m-%d %H:%M:%S %z}",
             f"시험 대상: 판단 코드 커밋 {sta_common.TARGET_COMMIT}, 모델·경계 파일은 {hash_list.name} 과 일치",
             "해시 방식: SHA-256 (압축 파일 전체)", ""]
    for label, archive, files in bundles:
        print(f"  압축하는 중: {archive.name} ...", flush=True)
        names = make_zip(archive, files)
        digest = sta_common.sha256_file(archive)
        lines += [f"[{label}]", f"  파일명 : {archive.name}", f"  SHA-256: {digest}",
                  f"  크기   : {archive.stat().st_size:,} 바이트", f"  안에 든 파일: {len(names)}개"]
        for path, name in files:
            if name.endswith(".csv") and "/" not in name:
                lines.append(f"    {name}: {count_rows(path):,}건")
        lines.append("")
    lines += ["확인 방법 (Windows): certutil -hashfile <파일명> SHA256",
              "확인 방법 (macOS·Linux): shasum -a 256 <파일명>", "",
              "---- 데이터 통계 ----", (work / "통계.txt").read_text(encoding="utf-8")]
    (out / "해시값.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    shutil.rmtree(work)

    print("\n" + "\n".join(lines[:24]))
    print(f"\n산출물: {out}")
    for item in sorted(out.iterdir()):
        print(f"  {item.name}  ({item.stat().st_size / 2**20:.1f}MB)")
    print("시험기관에는 해시값.txt 의 파일명과 SHA-256 을 적어 보낸다. 압축 파일은 지우지 말고 보관한다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
