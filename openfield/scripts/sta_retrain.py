"""STA 시험용 — 고정 모델 묶음을 **잃어버렸을 때만**: 다시 학습해 새 시험 대상으로 고정한다.

사용 예(시험 PC, openfield/ 에서)::

    python scripts/sta_retrain.py \
        --aaos-dir data/raw/aaos \
        --agera5 data/raw/AgERA5_Naju-Daegyo_2x2mean_daily_2015-2026.csv \
        --cache artifacts/dataset.pkl --models artifacts/weather

보관한 묶음(`OFDF_시험대상_5ff054f.zip`)이 있으면 이 스크립트를 쓰지 않는다. 다시 학습하면
성능 수치는 같아도 모델 파일이 비트 단위로 달라지기 때문이다. 묶음이 아예 없을 때는 새로
학습한 묶음이 유일한 시험 대상이 되므로, 아래를 한 번에 해서 정식으로 바꾼다.

1. 판단 코드(src/ofdf)가 시험 대상 커밋과 같은지 확인한다(다르면 멈춘다).
2. `train_weather.py` 를 `모델해시.md` 에 적힌 것과 같은 설정으로 돌린다
   (--year-round-train heat_dry,disease,frost --seed 42).
3. 새 `performance.csv` 를 `reports/성능평가서.md` 의 표와 견준다.
4. 새 묶음의 sha256 으로 해시 목록(`모델해시.md`)을 다시 쓴다. 옛 목록은 `.이전` 으로 남긴다.
5. 새 묶음을 zip 으로 보관한다 — **이번에는 잃어버리지 않게 따로 복사해 둔다.**

종료 코드: 0 수치가 성능평가서와 같음 / 3 묶음은 고정했으나 수치가 성능평가서와 다름
(성능평가서를 새 값으로 다시 내야 한다) / 2 시작할 수 없음.
"""

from __future__ import annotations

import argparse
import datetime
import importlib.util
import shutil
import sys
import zipfile
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import sta_common  # noqa: E402

ROOT = sta_common.ROOT
YEAR_ROUND = "heat_dry,disease,frost"
COMPARE = ["시험 표본", "위험 표본", "규칙 조치단위F1", "AI 조치단위F1", "전용학습 조치단위F1",
           "판정 조치단위F1", "이벤트 탐지율", "AI 놓침방지율", "규칙 놓침방지율", "AI 오경보율",
           "사전알림(분)"]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--aaos-dir", default="data/raw/aaos")
    p.add_argument("--agera5", default="data/raw/AgERA5_Naju-Daegyo_2x2mean_daily_2015-2026.csv")
    p.add_argument("--cache", default="artifacts/dataset.pkl", help="작기 데이터셋 캐시")
    p.add_argument("--year-round-cache", default=None, help="연중 데이터셋 캐시. 기본: 캐시 옆 dataset_all.pkl")
    p.add_argument("--models", default="artifacts/weather", help="새 모델 묶음을 둘 폴더")
    p.add_argument("--hash-list", default=str(sta_common.DEFAULT_HASH_LIST))
    p.add_argument("--reference", default=str(ROOT / "reports" / "성능평가서.md"))
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--force", action="store_true",
                   help="모델 폴더에 해시 목록과 일치하는 묶음이 있어도 다시 학습한다")
    return p.parse_args(argv)


def resolve(path: str) -> Path:
    p = Path(path).expanduser()
    return p if p.is_absolute() else ROOT / p


def reference_table(path: Path) -> pd.DataFrame:
    """성능평가서의 「기상 기반 위험판단 성능」 표를 읽는다."""
    lines = path.read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines)
                 if line.startswith("|") and "위험유형" in line and "판정 조치단위F1" in line)
    header = [c.strip() for c in lines[start].strip().strip("|").split("|")]
    rows = []
    for line in lines[start + 2:]:
        if not line.startswith("|"):
            break
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        rows.append(dict(zip(header, cells)))
    table = pd.DataFrame(rows)
    for column in table.columns:
        if column not in ("위험유형", "평가단위"):
            table[column] = pd.to_numeric(table[column].replace("", None), errors="coerce")
    return table


def compare(performance: Path, reference: Path) -> tuple[list[str], int]:
    """새 performance.csv 와 성능평가서 표를 견준다. ``(다른 값 설명, 견준 값 수)``."""
    new = pd.read_csv(performance, encoding="utf-8-sig")
    old = reference_table(reference)
    differences, checked = [], 0
    if len(new) != len(old):
        differences.append(f"항목 수: 성능평가서 {len(old)} / 이번 {len(new)}")
    for _, ref in old.iterrows():
        row = new[(new["위험유형"] == ref["위험유형"]) & (new["시계(h)"] == ref["시계(h)"])]
        tag = f"{ref['위험유형']} {int(ref['시계(h)'])}시간"
        if len(row) != 1:
            differences.append(f"{tag}: 이번 결과에 없음")
            continue
        for column in COMPARE:
            if column not in old.columns or column not in new.columns:
                continue
            want, got = ref[column], row.iloc[0][column]
            checked += 1
            both_empty = pd.isna(want) and pd.isna(got)
            if not both_empty and (pd.isna(want) or pd.isna(got) or abs(float(want) - float(got)) > 5e-7):
                differences.append(f"{tag} {column}: 성능평가서 {want} / 이번 {got}")
    return differences, checked


def write_hash_list(model_dir: Path, path: Path, command: str, started: datetime.datetime) -> int:
    env = sta_common.environment()
    files = sorted(p for p in model_dir.iterdir()
                   if p.is_file() and p.suffix in (".txt", ".json", ".csv"))
    if path.exists():
        shutil.copy2(path, path.with_name(path.name + ".이전"))
    lines = [
        "# 모델·판정 경계 파일 해시 목록", "",
        f"- 시험 대상 커밋 : {sta_common.TARGET_COMMIT} (판단 코드. 해시 목록 대조로 확인)",
        f"- 생성일 : {started:%Y-%m-%d %H:%M} / 실행 환경 : Python {env['Python']} / "
        f"LightGBM {env['LightGBM']} / {env['아키텍처']} / {env['OS']}",
        f"- 학습 명령 : {command}",
        f"- 대상 : 모델 묶음의 파일 {len(files)}개",
        "- 경위 : 2026-11-12 에 만든 묶음을 찾지 못해 같은 코드·같은 설정으로 다시 학습했다. "
        "이 목록의 파일 묶음이 시험 대상이다(`scripts/sta_retrain.py`).",
        "", "```",
        *[f"{sta_common.sha256_file(f)}  {f.name}" for f in files],
        "```", "",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
    return len(files)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    model_dir, cache = resolve(args.models), resolve(args.cache)
    aaos, agera5 = resolve(args.aaos_dir), resolve(args.agera5)
    year_round = resolve(args.year_round_cache) if args.year_round_cache else cache.with_name("dataset_all.pkl")
    hash_list = Path(args.hash_list)
    started = datetime.datetime.now().astimezone()

    with sta_common.Tee(model_dir.parent / f"{model_dir.name}_학습로그.txt"):
        print(f"[시작] {started:%Y-%m-%d %H:%M:%S %z} — 고정 모델 묶음 다시 만들기")
        checked = sta_common.verify_code_hashes()
        if checked is None or checked[1]:
            print("[중단] 판단 코드(src/ofdf)가 시험 대상 커밋과 같은지 확인되지 않습니다")
            return 2
        print(f"[코드] 판단 코드 {checked[0]}개 파일이 시험 대상 커밋 {sta_common.TARGET_COMMIT} 과 일치")

        if model_dir.is_dir() and hash_list.exists() and not args.force:
            _, problems = sta_common.verify_model_hashes(model_dir, hash_list)
            if not problems:
                print(f"[중단] {model_dir} 에 해시 목록과 일치하는 묶음이 이미 있습니다. "
                      "다시 학습할 까닭이 없습니다(그래도 하려면 --force)")
                return 2
        if not (cache.exists() or (aaos.is_dir() and agera5.is_file())):
            print(f"[중단] 데이터셋 캐시({cache})도 원천자료({aaos}, {agera5.name})도 없습니다")
            return 2
        if not year_round.exists() and not (aaos.is_dir() and agera5.is_file()):
            print(f"[중단] 연중 자료가 필요합니다 — 원천자료({aaos}, {agera5.name}) 또는 {year_round}")
            return 2

        # 옛 파일이 섞이지 않게 모델 폴더의 모델·경계 파일을 비운다(안내 파일 등은 둔다)
        model_dir.mkdir(parents=True, exist_ok=True)
        for old in model_dir.iterdir():
            if old.is_file() and (old.name.startswith(("model_", "compound_"))
                                  or old.name in ("performance.csv", "feature_importance.json")):
                old.unlink()

        train_args = ["--aaos-dir", str(aaos), "--agera5", str(agera5), "--cache", str(cache),
                      "--year-round-train", YEAR_ROUND, "--year-round-cache", str(year_round),
                      "--out", str(model_dir), "--seed", str(args.seed)]
        command = "scripts/train_weather.py " + " ".join(
            a if not Path(a).is_absolute() else Path(a).name for a in train_args)
        print(f"[학습] {command}\n       (수십 분 걸릴 수 있다 — 끝날 때까지 창을 닫지 않는다)")
        spec = importlib.util.spec_from_file_location("train_weather", Path(__file__).with_name("train_weather.py"))
        train_weather = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(train_weather)
        saved = sys.argv
        sys.argv = ["train_weather.py", *train_args]
        try:
            code = train_weather.main()
        finally:
            sys.argv = saved
        if code != 0 or not (model_dir / "performance.csv").exists():
            print("[중단] 학습이 끝나지 않았습니다")
            return 2

        count = write_hash_list(model_dir, hash_list, command, started)
        print(f"\n[해시] 새 묶음 {count}개 파일의 sha256 을 적었다: {hash_list}")

        archive = model_dir.parent / f"OFDF_시험대상_{sta_common.TARGET_COMMIT}_{started:%Y%m%d}.zip"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for f in sorted(model_dir.iterdir()):
                if f.is_file() and f.suffix in (".txt", ".json", ".csv"):
                    bundle.write(f, f.name)
            bundle.write(hash_list, hash_list.name)
        print(f"[보관] {archive} ({archive.stat().st_size / 2**20:.1f}MB) — 다른 곳에도 복사해 둔다")

        differences, n = compare(model_dir / "performance.csv", Path(args.reference))
        took = (datetime.datetime.now().astimezone() - started).total_seconds()
        print(f"\n[대조] 성능평가서({Path(args.reference).name})의 표와 {n}개 값 비교 — 소요 {took / 60:.1f}분")
        if differences:
            for line in differences:
                print(f"  다름: {line}")
            print(f"[주의] {len(differences)}개 값이 성능평가서와 다릅니다. 새 묶음은 시험 대상으로 고정했지만, "
                  "성능평가서를 이 묶음의 performance.csv 로 다시 내야 합니다(원천자료가 그때와 같은지도 확인).")
            return 3
        print("[완료] 모든 값이 성능평가서와 같습니다. 다음: 준비 점검 → 예행연습")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
