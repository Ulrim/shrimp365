"""STA 시험용 — 시험 데이터 한 건마다 AI 판단 시간을 재고 시작·종료 시각을 남긴다.

사용 예::

    python scripts/sta_time_testset.py \
        --cache artifacts/dataset.pkl --models artifacts/weather \
        --testset sta_ai노지/01_시험데이터/시험셋.csv --out sta_ai노지_판단시간 --recompute

`sta_evaluate.py` 와 같은 함수·같은 씨앗으로 분할을 다시 만들어 **시험 데이터 전체**
(시각 × 지점 한 건이 한 번의 판단)를 순서대로 판단한다. 판단은 현장 제어기가 쓰는
함수(`ofdf.cli.judge_all`, `decide`, `Journal.append`)를 그대로 부른다 — 판단 코드는
고치지 않는다.

판단 1회에서 재는 구간(이 순서로 이어서 실행하고, 구간 사이에 빈틈이 없다)

    ① 입력 변수 계산      build_features(그 지점의 직전 48시간 + 그 시각)
    ② 위험 판단           모델 추론(1시간·3시간 전체 모델) + 복합위험 + 판단근거 추출
    ③ 조치 결정           decide
    ④ 이력 기록           Journal.append

    전체(ms) = 종료시각 − 시작시각 = ① + ② + ③ + ④

②의 모델 추론과 판단근거 추출은 판단 함수 안에서 함께 이뤄져 한 구간으로 잰다.
재는 구간에 넣지 않는 것: 프로그램 시작, 모델 파일 읽기, 데이터셋 읽기, 입력 창을
자료에서 잘라내는 일, 결과 CSV 쓰기.

시각은 시계 하나로 적는다. 프로그램을 시작할 때 벽시계 시각을 한 번 읽고, 그 뒤로는
단조 시계(`time.perf_counter_ns`)의 경과를 더해 마이크로초 단위로 적는다. 그래서
「종료시각 − 시작시각」, 「구간의 합」, 「전체(ms)」가 같은 값이다.

산출물(`--out` 아래 — 평가 결과 폴더와 따로 두어 시험 당일 파일을 건드리지 않는다)

    07_판단시간_데이터별.csv        시험 데이터 한 건 × 1회가 한 줄(--repeats 200 이면 건마다 200줄)
    07_판단시간_데이터별.요약.json  건수·평균·중앙값·p95·최대·판정, 시험셋 sha256, 실행 환경
    07_판단시간_이력.jsonl          ④에서 실제로 쓴 이력 기록
    07_실행로그.txt                 화면 출력
    07_재계산_결과.txt              (--recompute) CSV 만으로 다시 계산해 대조한 결과

종료 코드: 0 기준 충족 / 1 기준 미달 / 2 실행 불가(해시 불일치 등)
"""

from __future__ import annotations

import argparse
import contextlib
import csv
import datetime
import json
import math
import pickle
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import sta_common  # noqa: E402
from ofdf import __version__, cli  # noqa: E402
from ofdf.action.journal import Journal, RiskJudgement, record_from_decision  # noqa: E402
from ofdf.action.recommend import decide  # noqa: E402
from ofdf.features.weather import build_features  # noqa: E402
from ofdf.labels.risk import compound_reasons  # noqa: E402
from ofdf.models import weather_risk  # noqa: E402

#: 사업계획서 정량 목표(초) — benchmark_inference.py 와 같은 값
TARGET_SECONDS = 30.0
TS_FORMAT = "%Y-%m-%d %H:%M"
STAGES = ["입력 변수 계산(ms)", "위험 판단(ms)", "조치 결정(ms)", "이력 기록(ms)"]
TOTAL = "전체(ms)"
COLUMNS = ["번호", "회차", "시각", "관측지점", "시작시각", "종료시각", *STAGES, TOTAL]
CSV_NAME = "07_판단시간_데이터별.csv"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--cache", required=True, help="작기 데이터셋 캐시 pickle (평가에 쓴 것과 같은 파일)")
    p.add_argument("--models", required=True, help="고정 모델 묶음 디렉터리")
    p.add_argument("--out", default="sta_ai노지_판단시간", help="이 측정의 결과 디렉터리(평가 결과 폴더와 따로 둔다)")
    p.add_argument("--testset", default=None,
                   help="평가 때 내보낸 시험셋.csv (예: result/testday/01_시험데이터/시험셋.csv). "
                        "주면 같은 건·같은 순서인지 대조하고 sha256 을 적는다")
    p.add_argument("--eval-dir", default=None,
                   help="평가 결과 폴더(예: result/testday). 주면 그 안의 01_시험데이터/시험셋.csv 를 --testset 으로 쓴다")
    p.add_argument("--recompute", action="store_true",
                   help="끝난 뒤 sta_recompute.py --per-data-csv 로 결과 CSV 를 다시 계산해 대조한다")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--window", type=int, default=cli.WINDOW_HOURS, help="입력으로 쓰는 과거 시간")
    p.add_argument("--hash-list", default=str(sta_common.DEFAULT_HASH_LIST))
    p.add_argument("--repeats", type=int, default=1,
                   help="시험 데이터 한 건을 몇 번씩 잴지. 200 이면 한 건마다 200줄(건수 × 200줄)이 나온다")
    p.add_argument("--limit", type=int, default=None, help="점검용 — 앞의 N건만 잰다(시험에는 쓰지 않는다)")
    p.add_argument("--log", default=None, help="콘솔 출력을 남길 파일. 기본: <out>/07_실행로그.txt")
    return p.parse_args(argv)


@contextlib.contextmanager
def booster_from_text():
    """`cli.load_models` 가 한글 경로에서도 모델을 읽게 한다(파일 내용을 문자열로 넘긴다)."""
    import lightgbm as lgb
    original = lgb.Booster

    class TextBooster(original):
        def __init__(self, *args, model_file=None, **kwargs):
            if model_file is not None:
                kwargs["model_str"] = Path(model_file).read_text(encoding="utf-8")
            super().__init__(*args, **kwargs)

    lgb.Booster = TextBooster
    try:
        yield
    finally:
        lgb.Booster = original


class Clock:
    """벽시계 시각을 한 번 읽고 단조 시계의 경과를 더한다. 값은 에포크 기준 마이크로초(정수)."""

    def __init__(self) -> None:
        self._wall_ns = time.time_ns()
        self._mono_ns = time.perf_counter_ns()

    def now_us(self) -> int:
        return (self._wall_ns + time.perf_counter_ns() - self._mono_ns) // 1000


def stamp(us: int) -> str:
    moment = datetime.datetime.fromtimestamp(us // 1_000_000).astimezone()
    return f"{moment:%Y-%m-%d %H:%M:%S}.{us % 1_000_000:06d}{moment:%z}"


def percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * q / 100.0
    lower = math.floor(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def summarise(values: list[float]) -> dict:
    return {"평균(ms)": math.fsum(values) / len(values), "중앙값(ms)": percentile(values, 50),
            "p95(ms)": percentile(values, 95), "최대(ms)": max(values), "최소(ms)": min(values)}


def judge_once(models: dict, window: pd.DataFrame, journal: Journal, station: str, clock: Clock) -> list[int]:
    """판단 1회. 구간 경계의 시각 5개(마이크로초)를 돌려준다. `cli.run_once` 와 같은 순서다."""
    t0 = clock.now_us()
    features = build_features(window)
    now = pd.Timestamp(features.index[-1])
    t1 = clock.now_us()
    by_horizon = cli.judge_all(models, features)
    t2 = clock.now_us()
    levels, confidences, evidence = by_horizon[max(by_horizon)]
    reasons = compound_reasons(levels.get("rain_wet", 0), levels.get("disease", 0), levels.get("frost", 0))
    if levels.get("compound", 0) > 0 and not reasons:
        reasons = [f"강우·과습과 병해 유리환경·저온·서리 위험이 함께 높아지는 중"
                   f" (복합 점수 {evidence.get('compound', [{}])[0].get('value', 0):.2f})"]
    sensors = cli.sensors_from(window, now)
    decision = decide(levels, sensors, confidence=confidences, compound_reasons=reasons)
    t3 = clock.now_us()
    judgements = [
        RiskJudgement(risk_type=risk, horizon_hours=cli.HORIZON, level=level,
                      level_name=cli.LEVEL_NAMES[level], confidence=confidences.get(risk, 1.0),
                      expected_onset=cli.earliest_onset(by_horizon, risk, now),
                      evidence=evidence.get(risk, []))
        for risk, level in levels.items() if level > 0
    ]
    journal.append(record_from_decision(
        now.to_pydatetime(), station, f"ofdf-weather-{__version__}",
        {k: float(window.iloc[-1][k]) for k in ("t_air", "rh") if k in window.columns
         and pd.notna(window.iloc[-1][k])},
        judgements, decision,
    ))
    t4 = clock.now_us()
    return [t0, t1, t2, t3, t4]


def check_testset(path: Path | None, keys: list[tuple[str, str]]) -> dict:
    """평가 때 내보낸 시험셋과 같은 건·같은 순서인지 본다. 시험셋 파일의 sha256 을 돌려준다."""
    if path is None:
        return {"시험셋 대조": "--testset 을 주지 않아 대조하지 않음"}
    if not path.exists():
        raise SystemExit(f"[중단] 시험셋 파일이 없습니다: {path}")
    with open(path, encoding="utf-8-sig", newline="") as handle:
        theirs = [(row["시각"], row["관측지점"]) for row in csv.DictReader(handle)]
    if theirs != keys:
        raise SystemExit(f"[중단] 시험셋.csv({len(theirs):,}건)와 다시 만든 시험 분할({len(keys):,}건)이 다릅니다")
    return {"시험셋 대조": f"{path.name} 와 건수·순서 일치",
            "시험셋 파일": path.name, "시험셋 sha256": sta_common.sha256_file(path)}


def run(args: argparse.Namespace) -> int:
    out, model_dir = Path(args.out), Path(args.models)
    out.mkdir(parents=True, exist_ok=True)

    _, problems = sta_common.verify_model_hashes(model_dir, args.hash_list)
    if problems:
        print(f"[중단] 모델 묶음이 해시 목록과 다릅니다({len(problems)}건): {problems[0]}")
        return 2
    code = sta_common.verify_code_hashes()
    if code is None or code[1]:
        print("[중단] 판단 코드(src/ofdf)가 시험 대상 커밋과 같은지 확인되지 않습니다")
        return 2
    print(f"[해시] 모델·경계 파일과 판단 코드 {code[0]}개 일치")

    ds = pickle.loads(Path(args.cache).read_bytes())
    X = ds.features.reset_index(drop=True)
    meta = ds.meta.reset_index(drop=True)
    states = ds.states.reset_index(drop=True)
    groups = weather_risk.shared_group_keys(meta, states)
    _, _, test_idx = weather_risk.split_by_event(groups, seed=args.seed)
    ts = pd.to_datetime(meta["ts"])
    keys = [(ts.iloc[i].strftime(TS_FORMAT), str(meta["station"].iloc[i])) for i in test_idx]
    testset = check_testset(Path(args.testset) if args.testset else None, keys)
    print(f"[데이터] 시험 데이터 {len(test_idx):,}건 — {testset['시험셋 대조']}")

    with booster_from_text():
        models = cli.load_models(model_dir)
    n_files = len(list(model_dir.glob("model_*.txt")))
    print(f"[모델] 예측시계 {sorted(models)} / 모델 파일 {n_files}개")

    # 지점별 시간순 자료 — 판단마다 직전 window 시간을 잘라 입력으로 준다
    by_station = {}
    for station, index in meta.groupby("station").groups.items():
        frame = X.loc[index].copy()
        frame.index = pd.DatetimeIndex(ts.loc[index])
        by_station[str(station)] = frame.sort_index()

    journal_path = out / "07_판단시간_이력.jsonl"
    journal_path.unlink(missing_ok=True)
    journal = Journal(journal_path)
    targets = list(test_idx[: args.limit]) if args.limit else list(test_idx)
    environment = sta_common.environment()
    clock = Clock()
    started = clock.now_us()
    print(f"[측정] {len(targets):,}건 × {args.repeats}회 = {len(targets) * args.repeats:,}줄, 과거 창 {args.window}시간 — 시작 {stamp(started)}", flush=True)

    from array import array
    measured = {name: array("d") for name in STAGES + [TOTAL]}
    n_rows, total_rows = 0, len(targets) * args.repeats
    with open(out / CSV_NAME, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(COLUMNS)
        for number, i in enumerate(targets, start=1):
            station, moment = str(meta["station"].iloc[i]), ts.iloc[i]
            window = by_station[station].loc[moment - pd.Timedelta(hours=args.window): moment]
            label = moment.strftime(TS_FORMAT)
            for repeat in range(1, args.repeats + 1):
                t = judge_once(models, window, journal, station, clock)
                parts = [f"{(t[k + 1] - t[k]) / 1000.0:.3f}" for k in range(4)]
                total = f"{(t[4] - t[0]) / 1000.0:.3f}"
                writer.writerow([number, repeat, label, station, stamp(t[0]), stamp(t[4]), *parts, total])
                for name, value in zip(STAGES + [TOTAL], parts + [total]):
                    measured[name].append(float(value))
                n_rows += 1
            if number % 500 == 0:
                handle.flush()
                elapsed = (clock.now_us() - started) / 1e6
                left = elapsed / n_rows * (total_rows - n_rows)
                print(f"  {number:,} / {len(targets):,}건 ({n_rows:,}줄) — 경과 {elapsed / 3600:.2f}시간, "
                      f"남은 시간 약 {left / 3600:.2f}시간", flush=True)
    finished = clock.now_us()

    totals = measured[TOTAL]
    mean_ms = math.fsum(totals) / len(totals)
    verdict = "적합" if mean_ms <= TARGET_SECONDS * 1000.0 else "부적합"
    summary = {
        "측정 대상": "시험 데이터 전체(시각 × 지점 한 건이 판단 1회)",
        "측정 건수": n_rows, "데이터 건수": len(targets), "데이터당 반복 횟수": args.repeats, **testset,
        "측정 시작": stamp(started), "측정 종료": stamp(finished),
        "측정 구간": "입력 변수 계산 → 위험 판단(모델 추론·복합위험·판단근거) → 조치 결정 → 이력 기록",
        "입력": f"그 지점의 직전 {args.window}시간과 그 시각의 관측",
        "모델 파일 수": n_files, "예측시계": sorted(models),
        "기준": {"평균(초) 이내": TARGET_SECONDS, "대상 열": TOTAL},
        "단계별": {name: summarise(list(measured[name])) for name in STAGES + [TOTAL]},
        "판정": verdict, "결과 파일 sha256": sta_common.sha256_file(out / CSV_NAME),
        "실행 환경": environment,
    }
    (out / CSV_NAME).with_suffix(".요약.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    stage = summary["단계별"][TOTAL]
    print(f"\n판단 1회 전체: 평균 {stage['평균(ms)']:.3f}ms / 중앙값 {stage['중앙값(ms)']:.3f}ms / "
          f"p95 {stage['p95(ms)']:.3f}ms / 최대 {stage['최대(ms)']:.3f}ms ({len(targets):,}건 × {args.repeats}회 = {n_rows:,}줄)")
    for name in STAGES:
        print(f"  {name:<16} 평균 {summary['단계별'][name]['평균(ms)']:.3f}ms")
    print(f"기준 평균 {TARGET_SECONDS:.0f}초({TARGET_SECONDS * 1000:,.0f}ms) 이내 → {verdict}")
    print(f"산출물: {out / CSV_NAME}")
    if args.recompute:
        import subprocess
        print("\n$ python scripts/sta_recompute.py --per-data-csv ...", flush=True)
        checked = subprocess.run([sys.executable, str(Path(__file__).with_name("sta_recompute.py")),
                                  "--per-data-csv", str(out / CSV_NAME)]).returncode
        if checked != 0:
            return 2
    return 0 if verdict == "적합" else 1


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    if args.eval_dir and not args.testset:
        args.testset = str(Path(args.eval_dir) / "01_시험데이터" / "시험셋.csv")
    with sta_common.Tee(args.log or Path(args.out) / "07_실행로그.txt"):
        return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
