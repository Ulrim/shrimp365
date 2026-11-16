"""STA 시험용 — 시험 전 준비 점검과 데이터셋 캐시 만들기.

사용 예(시험 PC, openfield/ 에서)::

    python scripts/sta_prepare.py
    python scripts/sta_prepare.py --model-zip ~/Downloads/OFDF_시험대상_5ff054f.zip

시험에 필요한 것이 제자리에 있는지 하나씩 확인하고, 없는 것을 「남은 일」로 알려 준다.

    1. 실행 환경        Python 3.11 이상, 필요한 패키지
    2. 판단 코드        src/ofdf 가 시험 대상 커밋 5ff054f 와 같은가
    3. 원천자료         AAOS 월별 파일(기상 데이터_YYYYMM.xls), AgERA5 일자료 CSV
    4. 데이터셋 캐시    artifacts/dataset.pkl — 없으면 원천자료에서 만든다(학습 때와 같은 build 함수)
    5. 고정 모델 묶음   artifacts/weather — sha256 을 모델해시.md 와 대조

**학습은 하지 않는다.** 모델 묶음이 없거나 해시가 다르면 다시 학습하지 말고 보관본을 찾는다.
종료 코드: 0 모두 준비됨 / 1 남은 일이 있음.
"""

from __future__ import annotations

import argparse
import pickle
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import sta_common  # noqa: E402

ROOT = sta_common.ROOT
DEFAULT_AAOS = "data/raw/aaos"
DEFAULT_AGERA5 = "data/raw/AgERA5_Naju-Daegyo_2x2mean_daily_2015-2026.csv"
REQUIRED = [("numpy", "numpy"), ("pandas", "pandas"), ("scikit-learn", "sklearn"),
            ("lightgbm", "lightgbm"), ("lxml", "lxml")]
#: 모델해시.md 에 적힌 학습 환경
TRAINED_WITH = {"lightgbm": "4.7.0"}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--aaos-dir", default=DEFAULT_AAOS, help="농업기상 월별 파일(.xls) 디렉터리")
    p.add_argument("--agera5", default=DEFAULT_AGERA5, help="AgERA5 일자료 CSV")
    p.add_argument("--cache", default="artifacts/dataset.pkl")
    p.add_argument("--models", default="artifacts/weather")
    p.add_argument("--model-zip", default=None,
                   help="고정 모델 묶음 zip (OFDF_시험대상_5ff054f.zip). 주면 --models 에 푼다")
    p.add_argument("--hash-list", default=str(sta_common.DEFAULT_HASH_LIST))
    p.add_argument("--rebuild-cache", action="store_true", help="캐시가 있어도 원천자료에서 다시 만든다")
    return p.parse_args(argv)


class Checklist:
    def __init__(self) -> None:
        self.todo: list[str] = []

    def ok(self, text: str) -> None:
        print(f"  [준비됨] {text}")

    def warn(self, text: str) -> None:
        print(f"  [주의]   {text}")

    def miss(self, text: str, todo: str) -> None:
        print(f"  [없음]   {text}")
        self.todo.append(todo)


def resolve(path: str) -> Path:
    p = Path(path).expanduser()
    return p if p.is_absolute() else ROOT / p


def check_environment(check: Checklist) -> bool:
    print("\n1. 실행 환경")
    usable = True
    if sys.version_info >= (3, 11):
        check.ok(f"Python {sys.version.split()[0]}")
    else:
        check.miss(f"Python {sys.version.split()[0]} — 3.11 이상이 필요", "Python 3.11 이상 설치")
        usable = False
    for label, module in REQUIRED:
        try:
            version = __import__(module).__version__
        except ImportError:
            check.miss(f"{label} 미설치", f"pip install -r requirements.txt ({label})")
            usable = False
            continue
        want = TRAINED_WITH.get(module)
        if want and version != want:
            check.warn(f"{label} {version} — 모델 학습 환경은 {want}. 평가값이 performance.csv 와 "
                       "다르게 나오면 이 버전으로 맞춘다")
        else:
            check.ok(f"{label} {version}")
    env = sta_common.environment()
    print(f"  OS {env['OS']} / CPU {env['CPU']} ({env['CPU 코어 수']}코어) / RAM {env['RAM(GB)']}GB")
    return usable


def check_code(check: Checklist) -> None:
    print("\n2. 판단 코드 (src/ofdf = 시험 대상 커밋 5ff054f)")
    git = sta_common.git_state()
    if git["판단코드_해시대조"] is True:
        check.ok(f"해시 목록과 일치 ({sta_common.CODE_HASH_LIST.name})")
    elif git["판단코드_해시대조"] is False:
        for line in git.get("판단코드_해시대조_문제", []):
            print(f"           {line}")
        check.miss("판단 코드가 해시 목록과 다름", "src/ofdf 를 시험 대상 커밋 상태로 되돌린다")
    if git["판단코드_동일"] is True:
        check.ok(f"git 비교: 시험 대상 커밋과 같음 (현재 커밋 {str(git['현재 커밋'])[:7]})")
    elif git["판단코드_동일"] is False:
        check.miss("git diff 5ff054f -- src/ofdf 가 비어 있지 않음", "src/ofdf 변경을 되돌린다")
    else:
        check.warn("git 비교 불가(git 저장소가 아니거나 커밋 없음) — 해시 목록 대조로 갈음한다")


def check_raw(check: Checklist, aaos: Path, agera5: Path, needed: bool) -> bool:
    print("\n3. 원천자료" + ("" if needed else " (캐시가 이미 있어 없어도 된다)"))
    have = True
    if not needed:
        # 캐시가 있으면 원천자료는 참고 확인만 한다 — 없다고 남은 일로 세지 않는다
        quiet = Checklist()
        quiet.miss = lambda text, _todo: check.warn(text)       # type: ignore[method-assign]
        quiet.ok, quiet.warn = check.ok, check.warn             # type: ignore[method-assign]
        check = quiet
    files = sorted(aaos.glob("*.xls")) if aaos.is_dir() else []
    if files:
        months = sorted({m.group(1) for f in files if (m := re.search(r"(\d{6})", f.name))})
        gaps = []
        if months:
            y, mth = int(months[0][:4]), int(months[0][4:])
            while f"{y}{mth:02d}" <= months[-1]:
                if f"{y}{mth:02d}" not in months:
                    gaps.append(f"{y}{mth:02d}")
                y, mth = (y + 1, 1) if mth == 12 else (y, mth + 1)
        check.ok(f"AAOS 월별 파일 {len(files)}개 ({months[0] if months else '?'} ~ "
                 f"{months[-1] if months else '?'}) — {aaos}")
        if gaps:
            check.warn(f"빠진 달 {len(gaps)}개: {', '.join(gaps[:12])}{' …' if len(gaps) > 12 else ''}")
    else:
        have = False
        check.miss(f"AAOS 월별 파일(.xls) 없음 — {aaos}",
                   f"드라이브 「02. AI 노지 농업_대파 › 01. 기상데이터_나주_201601~202608」의 xls 를 {aaos} 에 받는다")
    if agera5.is_file():
        check.ok(f"AgERA5 일자료 — {agera5.name} ({agera5.stat().st_size / 1024:.0f}KB)")
    else:
        have = False
        check.miss(f"AgERA5 일자료 CSV 없음 — {agera5}",
                   "드라이브 「260929_AI 노지 농업 기상 데이터_AgERA5」의 "
                   f"AgERA5_Naju-Daegyo_2x2mean_daily_2015-2026.csv 를 {agera5.parent} 에 받는다")
    return have


def check_cache(check: Checklist, cache: Path, aaos: Path, agera5: Path, have_raw: bool,
                rebuild: bool) -> None:
    print("\n4. 데이터셋 캐시")
    if cache.exists() and not rebuild:
        ds = pickle.loads(cache.read_bytes())
    elif have_raw:
        from ofdf.data.dataset import build

        print("  원천자료에서 만드는 중 … (수 분 걸린다. train_weather.py 와 같은 build 함수, 작기 9~11월)")
        ds = build(aaos, agera5)
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(pickle.dumps(ds))
    else:
        check.miss(f"캐시 없음 — {cache}", "원천자료를 받은 뒤 이 스크립트를 다시 실행한다(캐시를 만든다)")
        return
    ts = ds.meta["ts"]
    check.ok(f"{cache.name}: {len(ds):,}시간 × {ds.features.shape[1]} 피처, "
             f"{ts.min():%Y-%m-%d} ~ {ts.max():%Y-%m-%d}, 지점 {ds.meta['station'].nunique()}곳")
    print(f"           sha256 {sta_common.sha256_file(cache)}")


def extract_models(archive: Path, model_dir: Path, hash_list: Path) -> int:
    """zip 안의 모델·경계 파일을 폴더 구조와 상관없이 이름으로 찾아 푼다."""
    wanted = set(sta_common.read_hash_list(hash_list))
    model_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(archive) as bundle:
        for info in bundle.infolist():
            name = Path(info.filename).name
            if not info.is_dir() and name in wanted:
                (model_dir / name).write_bytes(bundle.read(info))
                count += 1
    return count


def check_models(check: Checklist, model_dir: Path, hash_list: Path, archive: Path | None) -> None:
    print("\n5. 고정 모델 묶음")
    if archive:
        if archive.is_file():
            print(f"  {archive.name} 에서 {extract_models(archive, model_dir, hash_list)}개 파일을 풀었다 → {model_dir}")
        else:
            check.miss(f"zip 없음 — {archive}", "고정 모델 묶음 zip 경로를 확인한다")
    if not model_dir.is_dir() or not any(model_dir.iterdir()):
        check.miss(f"모델 폴더가 비어 있음 — {model_dir}",
                   "보관한 OFDF_시험대상_5ff054f.zip 을 찾아 --model-zip 으로 넘긴다. "
                   "찾지 못하면 다시 학습하지 말고 멈춘다(모델 파일이 달라진다)")
        return
    actual, problems = sta_common.verify_model_hashes(model_dir, hash_list)
    if problems:
        for line in problems[:12]:
            print(f"           {line}")
        check.miss(f"모델 묶음이 해시 목록과 다름({len(problems)}건)",
                   "보관한 고정 모델 묶음으로 바꾼다. 다시 학습한 모델은 쓸 수 없다")
    else:
        check.ok(f"모델·경계 파일 {len(actual)}개 모두 {hash_list.name} 과 일치")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    aaos, agera5 = resolve(args.aaos_dir), resolve(args.agera5)
    cache, model_dir = resolve(args.cache), resolve(args.models)
    with sta_common.Tee(cache.parent / "sta_준비점검.txt"):
        print("AI 노지 STA 시험 — 준비 점검")
        check = Checklist()
        usable = check_environment(check)
        check_code(check)
        have_raw = check_raw(check, aaos, agera5, needed=args.rebuild_cache or not cache.exists())
        if usable:
            check_cache(check, cache, aaos, agera5, have_raw, args.rebuild_cache)
        check_models(check, model_dir, Path(args.hash_list),
                     Path(args.model_zip).expanduser() if args.model_zip else None)
        print()
        if check.todo:
            print(f"남은 일 {len(check.todo)}건")
            for i, line in enumerate(check.todo, 1):
                print(f"  {i}. {line}")
            return 1
        print("모두 준비됐습니다. 다음: 예행연습 (sta_2_rehearsal)")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
