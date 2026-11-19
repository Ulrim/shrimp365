"""STA 제출용 — 학습·검증(·시험) 데이터를 CSV 로 내보낸다.

사용 예::

    python scripts/sta_export_data.py --cache artifacts/dataset.pkl --out sta_학습데이터 --zip

`train_weather.py`·`sta_evaluate.py` 와 **같은 함수·같은 씨앗**으로 분할을 다시 만들어
(`weather_risk.shared_group_keys` → `split_by_event`, 씨앗 42) 분할별로 한 파일씩 적는다.
읽기만 한다 — 모델·시험 결과·데이터셋 캐시를 바꾸지 않는다.

    학습데이터.csv      한 줄 = 한 관측지점의 한 시각. 시각·지점·기상사례블록·입력 변수·항목별 정답등급
    검증데이터.csv      같은 형식 (조기종료·판정 가중치 선택에 쓴 자료)
    시험데이터.csv      --parts 에 test 를 넣었을 때만 (평가 결과 묶음의 시험셋.csv 와 같은 시각)
    학습보강_작기밖.csv  --with-off-season 을 줬을 때만 (고온·건조, 병해 유리환경, 저온·서리의
                        3등급 모델 학습에만 더한 작기 밖 자료)
    통계.txt            분할별 건수·기간, 항목별 위험 표본 수, 분할이 겹치지 않는다는 확인
    sha256.txt          위 파일들의 sha256
"""

from __future__ import annotations

import argparse
import importlib.util
import pickle
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import sta_common  # noqa: E402
from ofdf.labels.risk import RISK_LABELS_KO, RISK_TYPES  # noqa: E402
from ofdf.models import weather_risk  # noqa: E402

PART_NAMES = {"train": "학습데이터", "valid": "검증데이터", "test": "시험데이터"}
TS_FORMAT = "%Y-%m-%d %H:%M"
YEAR_ROUND_RISKS = ("heat_dry", "disease", "frost")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--cache", default="artifacts/dataset.pkl", help="작기 데이터셋 캐시")
    p.add_argument("--year-round-cache", default=None, help="연중 데이터셋 캐시. 기본: 캐시 옆 dataset_all.pkl")
    p.add_argument("--out", default="sta_학습데이터")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--horizons", default="1,3")
    p.add_argument("--parts", default="train,valid", help="내보낼 분할(쉼표 구분): train, valid, test")
    p.add_argument("--with-off-season", action="store_true",
                   help="작기 밖 학습 보강 자료도 CSV 로 내보낸다(수백 MB)")
    p.add_argument("--zip", action="store_true", help="결과 폴더를 zip 으로도 묶는다")
    return p.parse_args(argv)


def resolve(path: str) -> Path:
    p = Path(path).expanduser()
    return p if p.is_absolute() else sta_common.ROOT / p


def label_columns(labels: pd.DataFrame, horizons: list[int]) -> pd.DataFrame:
    out = {}
    for risk in RISK_TYPES:
        for h in horizons:
            key = f"{risk}_h{h}"
            if key in labels.columns:
                out[f"정답등급_{RISK_LABELS_KO[risk]} {h}시간"] = labels[key].fillna(0).astype(int).to_numpy()
    return pd.DataFrame(out)


def frame_for(meta, features, labels, horizons, extra: dict | None = None) -> pd.DataFrame:
    head = {"시각": pd.to_datetime(meta["ts"]).dt.strftime(TS_FORMAT).to_numpy(),
            "관측지점": meta["station"].to_numpy(), **(extra or {})}
    return pd.concat([pd.DataFrame(head), features.reset_index(drop=True),
                      label_columns(labels.reset_index(drop=True), horizons)], axis=1)


def write_csv(frame: pd.DataFrame, path: Path) -> None:
    frame.to_csv(path, index=False, encoding="utf-8-sig", lineterminator="\n", float_format="%.6g")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    cache, out = resolve(args.cache), resolve(args.out)
    horizons = [int(h) for h in args.horizons.split(",")]
    parts = [p.strip() for p in args.parts.split(",") if p.strip()]
    if not cache.exists():
        print(f"[중단] 데이터셋 캐시가 없습니다: {cache}")
        return 2
    out.mkdir(parents=True, exist_ok=True)

    ds = pickle.loads(cache.read_bytes())
    X = ds.features.reset_index(drop=True)
    meta = ds.meta.reset_index(drop=True)
    states = ds.states.reset_index(drop=True)
    labels = ds.labels.reset_index(drop=True)
    groups = weather_risk.shared_group_keys(meta, states)
    train_idx, valid_idx, test_idx = weather_risk.split_by_event(groups, seed=args.seed)
    index = {"train": train_idx, "valid": valid_idx, "test": test_idx}
    print(f"[데이터] {len(ds):,}건 x {X.shape[1]} 입력 변수")
    print(f"[분할] 학습 {len(train_idx):,} / 검증 {len(valid_idx):,} / 시험 {len(test_idx):,} "
          f"(기상사례 블록 {groups.nunique():,}개 단위, 씨앗 {args.seed})")

    block = {name: set(groups.iloc[idx]) for name, idx in index.items()}
    overlap = {f"{a}∩{b}": len(block[a] & block[b])
               for a, b in (("train", "valid"), ("train", "test"), ("valid", "test"))}

    lines = [
        "AI 노지 — 학습·검증·시험 데이터 통계",
        f"전체 {len(ds):,}건(시각 × 관측지점), 입력 변수 {X.shape[1]}개, 관측지점 {meta['station'].nunique()}곳",
        f"분할: 기상사례 블록 {groups.nunique():,}개 단위, 씨앗 {args.seed} "
        "(train_weather.py · sta_evaluate.py 와 같은 함수)",
        "",
        f"{'분할':<6}{'건수':>10}{'블록 수':>9}  기간",
    ]
    for name in ("train", "valid", "test"):
        ts = pd.to_datetime(meta["ts"].iloc[index[name]])
        lines.append(f"{PART_NAMES[name][:2]:<6}{len(index[name]):>10,}{len(block[name]):>9,}  "
                     f"{ts.min():%Y-%m-%d} ~ {ts.max():%Y-%m-%d}")
    lines += ["", "분할 사이에 겹치는 기상사례 블록 수 (모두 0 이어야 한다)",
              *[f"  {k}: {v}" for k, v in overlap.items()],
              "", "판정 항목별 위험 표본 수(정답등급 1 이상)",
              f"{'판정항목':<16}{'학습':>9}{'검증':>9}{'시험':>9}"]
    answers = label_columns(labels, horizons)
    for column in answers.columns:
        risk = (answers[column].to_numpy() >= 1)
        lines.append(f"{column.replace('정답등급_', ''):<16}"
                     + "".join(f"{int(risk[index[n]].sum()):>9,}" for n in ("train", "valid", "test")))

    written: list[Path] = []
    for name in parts:
        if name not in index:
            print(f"[건너뜀] 알 수 없는 분할: {name}")
            continue
        idx = index[name]
        path = out / f"{PART_NAMES[name]}.csv"
        print(f"  쓰는 중: {path.name} ({len(idx):,}줄) ...", flush=True)
        write_csv(frame_for(meta.iloc[idx], X.iloc[idx], labels.iloc[idx], horizons,
                            {"기상사례블록": groups.iloc[idx].to_numpy()}), path)
        written.append(path)

    # 작기 밖 학습 보강 — 건수는 항상 적고, 파일은 요청했을 때만 쓴다
    year_round = resolve(args.year_round_cache) if args.year_round_cache else cache.with_name("dataset_all.pkl")
    names = ", ".join(RISK_LABELS_KO[r] for r in YEAR_ROUND_RISKS)
    lines += ["", f"작기 밖 학습 보강 ({names} 의 3등급 모델 학습에만 더함. 검증·시험에는 쓰지 않음)"]
    if year_round.exists():
        al = pickle.loads(year_round.read_bytes())
        ts = al.meta["ts"].reset_index(drop=True)
        mon, day = ts.dt.month, ts.dt.day
        season = sorted(set(pd.to_datetime(meta["ts"]).dt.month))
        off = ~mon.isin(season)
        edge = ((mon == min(season) - 1) & (day >= 29)) | ((mon == max(season) + 1) & (day <= 3))
        keep = (off & ~edge).to_numpy()
        lines.append(f"  {int(keep.sum()):,}건 (연중 자료 {len(al):,}건에서 작기와 작기 경계 3일을 뺀 것) — {year_round.name}")
        print(f"[학습 보강] 작기 밖 {int(keep.sum()):,}건")
        if args.with_off_season:
            path = out / "학습보강_작기밖.csv"
            print(f"  쓰는 중: {path.name} ({int(keep.sum()):,}줄) ...", flush=True)
            write_csv(frame_for(al.meta.reset_index(drop=True)[keep],
                                al.features.reset_index(drop=True)[keep][list(X.columns)],
                                al.labels.reset_index(drop=True)[keep], horizons), path)
            written.append(path)
        else:
            lines.append("  (CSV 로는 내보내지 않았다 — --with-off-season 을 주면 내보낸다)")
    else:
        lines.append(f"  연중 캐시가 없어 건수를 세지 못했다: {year_round.name}")

    lines += ["", "열 구성: 시각, 관측지점, 기상사례블록, 입력 변수, 정답등급_<판정항목>(0 정상·1 주의·2 경계)",
              "정답등급은 그 시각 뒤 1시간·3시간 안의 최고 위험등급이다. 실수는 유효숫자 6자리로 적었다."]
    (out / "통계.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    hashes = [f"{sta_common.sha256_file(p)}  {p.name}" for p in written]
    hashes.append(f"{sta_common.sha256_file(cache)}  (데이터셋 캐시) {cache.name}")
    (out / "sha256.txt").write_text("\n".join(hashes) + "\n", encoding="utf-8")

    print("\n" + "\n".join(lines[:12]))
    print(f"\n산출물: {out}")
    for p in [*written, out / "통계.txt", out / "sha256.txt"]:
        print(f"  {p.name}  ({p.stat().st_size / 2**20:.1f}MB)")
    if args.zip:
        archive = out.with_suffix(".zip")
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for p in sorted(out.iterdir()):
                if p.is_file():
                    bundle.write(p, f"{out.name}/{p.name}")
        print(f"zip: {archive}  ({archive.stat().st_size / 2**20:.1f}MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
