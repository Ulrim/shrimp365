"""STA 시험용 — 당일 실행 순서(1~6단계)를 한 번에 돌리고 사전실행로그를 남긴다.

사용 예(시험 PC, openfield/ 에서)::

    python scripts/sta_run_all.py \
        --cache artifacts/dataset.pkl --models artifacts/weather --out sta_ai노지

`docs/STA-시험당일-실행순서.md` 의 명령을 순서대로 부르기만 한다(판정·측정은 각 스크립트가 한다).
단계마다 소요시간과 종료 코드를 재고, 하나라도 실패하면 거기서 멈춘다. 끝나면

* 결과 묶음을 `<out>_<날짜>.zip` 으로 압축하고
* `reports/시험의뢰/STA평가_사전실행로그.md` 에 실행 환경·단계별 소요시간·항목별 결과·
  시험셋 sha256(당일 `--expect-testset-sha256` 에 넣을 값)을 적는다.

전날 예행연습용이다. 시험 당일에는 문서의 명령을 하나씩 쳐도 되고 이 스크립트를 써도 된다.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sta_common  # noqa: E402

SCRIPTS = Path(__file__).resolve().parent
ROOT = sta_common.ROOT
DEFAULT_LOG = ROOT / "reports" / "시험의뢰" / "STA평가_사전실행로그.md"
LIMIT_MINUTES = 30


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--cache", default="artifacts/dataset.pkl")
    p.add_argument("--models", default="artifacts/weather")
    p.add_argument("--mode", choices=("rehearsal", "testday"), default="rehearsal",
                   help="rehearsal: 예행연습 — 끝나면 시험셋 sha256 을 봉인 파일에 적는다. "
                        "testday: 시험 당일 — 봉인 파일의 sha256 과 다르면 멈춘다")
    p.add_argument("--out", default=None, help="결과 묶음 디렉터리. 기본: 예행 sta_ai노지_예행 / 당일 sta_ai노지")
    p.add_argument("--seal-file", default="artifacts/sta_봉인_시험셋.sha256")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--miss-unit", choices=("case", "hour"), default="case")
    p.add_argument("--hash-list", default=str(sta_common.DEFAULT_HASH_LIST))
    p.add_argument("--expect-testset-sha256", default=None)
    p.add_argument("--aaos-dir", default=None, help="캐시가 없을 때만: 농업기상 월별 파일 디렉터리")
    p.add_argument("--agera5", default=None, help="캐시가 없을 때만: AgERA5 일자료 CSV")
    p.add_argument("--skip-benchmark", action="store_true", help="판단시간 측정을 건너뛴다")
    p.add_argument("--no-zip", action="store_true")
    p.add_argument("--prerun-log", default=None,
                   help="실행 기록(.md) 경로. 기본: 예행 STA평가_사전실행로그.md / 당일 STA평가_당일실행로그.md. "
                        "빈 문자열이면 쓰지 않는다")
    args = p.parse_args(argv)
    if args.out is None:
        args.out = "sta_ai노지_예행" if args.mode == "rehearsal" else "sta_ai노지"
    if args.prerun_log is None:
        args.prerun_log = str(DEFAULT_LOG if args.mode == "rehearsal"
                              else DEFAULT_LOG.with_name("STA평가_당일실행로그.md"))
    return args


def run_step(name: str, command: list[str], steps: list[dict], env: dict | None = None) -> bool:
    print(f"\n{'=' * 78}\n[{len(steps) + 1}] {name}\n$ {' '.join(command)}\n{'=' * 78}", flush=True)
    begin = time.perf_counter()
    done = subprocess.run(command, cwd=ROOT, env=env)
    took = time.perf_counter() - begin
    steps.append({"단계": name, "명령": " ".join(command), "소요(초)": round(took, 1),
                  "종료 코드": done.returncode})
    print(f"→ 종료 코드 {done.returncode}, {took:.1f}초", flush=True)
    return done.returncode == 0


def disk_gb(path: Path) -> str:
    try:
        usage = shutil.disk_usage(path)
    except OSError:
        return "확인 불가"
    return f"전체 {usage.total / 2**30:.0f}GB / 여유 {usage.free / 2**30:.0f}GB"


def write_log(path: Path, args: argparse.Namespace, steps: list[dict], ok: bool,
              started: datetime.datetime, archive: Path | None) -> None:
    out = ROOT / args.out if not Path(args.out).is_absolute() else Path(args.out)
    env = sta_common.environment()
    git = sta_common.git_state()
    total = sum(s["소요(초)"] for s in steps)
    lines = [
        f"# STA 평가 {'사전실행' if args.mode == 'rehearsal' else '당일실행'} 로그 — AI 노지",
        "",
        "`scripts/sta_run_all.py` 가 자동으로 쓴 파일이다. 당일 실행 순서를 끝까지 돌린 기록.",
        "",
        f"- 실행 시각 : {started:%Y-%m-%d %H:%M:%S %z}",
        f"- 결과 : **{'전 단계 통과' if ok else '실패 — 아래 단계에서 멈춤'}**",
        f"- 총 소요 : {total:.0f}초 ({total / 60:.1f}분) — 기준 {LIMIT_MINUTES}분 이내 "
        f"{'충족' if total <= LIMIT_MINUTES * 60 else '초과'}",
        f"- 현재 커밋 : `{git['현재 커밋']}` / 시험 대상 커밋 `{git['시험 대상 커밋']}`",
        f"- 판단 코드(src/ofdf) 동일 여부 : {git['판단코드_동일']}",
        "",
        "## 실행 환경 (STA 신청서 「시험환경」 칸에 옮겨 적는다)",
        "",
        "| 항목 | 값 |",
        "|---|---|",
    ]
    lines += [f"| {k} | {v} |" for k, v in env.items()]
    lines += [f"| HDD | {disk_gb(ROOT)} |", "| GPU | 사용 안 함 |", "",
              "## 단계별 소요시간", "", "| # | 단계 | 소요(초) | 종료 코드 |", "|---|---|---|---|"]
    lines += [f"| {i} | {s['단계']} | {s['소요(초)']} | {s['종료 코드']} |" for i, s in enumerate(steps, 1)]

    final_path = out / "03_최종결과.json"
    if final_path.exists():
        final = json.loads(final_path.read_text(encoding="utf-8"))
        total_ = final["종합"]
        testset = final["sha256"]["시험데이터"].get("01_시험데이터/시험셋.csv")
        lines += [
            "", "## 항목별 결과", "",
            f"- performance.csv(성능평가서 수치) 대조 : **{final['성능평가서 대조']['결과']}**",
            f"- 종합점수(판정 조치단위 Macro F1) ≥ {final['기준']['종합점수']['기준값']} : "
            f"{total_['종합점수 적합 항목 수']}/{total_['항목 수']} 항목, 최저 {total_['종합점수 최저']:.3f}",
            f"- 놓침 방지율({final['기준']['놓침 방지율']['셈법']}) ≥ {final['기준']['놓침 방지율']['기준값']} : "
            f"{total_['놓침 방지율 적합 항목 수']}/{total_['항목 수']} 항목",
            f"- (참고) 시간 단위 재현율 0.85 이상 : {total_['시간 단위 0.85 이상 항목 수(참고)']}/{total_['항목 수']} 항목",
            f"- 사례 30건 미만 항목 : {', '.join(total_['사례 30건 미만 항목']) or '없음'}",
            f"- **시험셋.csv sha256** (당일 `--expect-testset-sha256` 에 넣는다) : `{testset}`",
            "",
            "| 판정항목 | 평가단위 | 표본 | 위험 표본 | 사례 | 탐지 | 판정 조치단위F1 | 사례 단위 놓침 방지율 | 시간 단위 재현율(참고) | 판정(F1/놓침) |",
            "|---|---|---|---|---|---|---|---|---|---|",
        ]

        def f3(v):
            return "-" if v is None else f"{v:.3f}"

        lines += [
            f"| {s['판정항목']} | {s['평가단위']} | {s['표본 수']:,} | {s['위험 표본 수']:,} | {s['사례 수']} | "
            f"{s['탐지 사례 수']} | {f3(s['판정 조치단위F1'])} | {f3(s['사례 단위 놓침 방지율'])} | "
            f"{f3(s['시간 단위 재현율(참고)'])} | {s['판정']['종합점수']}/{s['판정']['놓침 방지율']} |"
            for s in final["항목별"]
        ]
    timing = out / "06_판단시간_회차별.요약.json"
    if timing.exists():
        summary = json.loads(timing.read_text(encoding="utf-8"))
        stage = summary["단계별"]["끝에서 끝까지(ms)"]
        lines += ["", "## 판단시간", "",
                  f"- 반복 {summary['반복 횟수']}회, 끝에서 끝까지 평균 {stage['평균(ms)']:.2f}ms / "
                  f"중앙값 {stage['중앙값(ms)']:.2f}ms / p95 {stage['p95(ms)']:.2f}ms / 최대 {stage['최대(ms)']:.2f}ms",
                  f"- 기준 평균 30초 이내 → **{summary['판정']}**"]
    recompute = out / "04_재계산_결과.txt"
    if recompute.exists():
        tail = recompute.read_text(encoding="utf-8").strip().splitlines()[-2:]
        lines += ["", "## 로그만으로 재계산", "", "```", *tail, "```"]
    if archive:
        lines += ["", f"제출 묶음 : `{archive.name}` ({archive.stat().st_size / 2**20:.1f}MB)"]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n사전실행로그: {path}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    started = datetime.datetime.now().astimezone()
    py = sys.executable
    out = Path(args.out)
    steps: list[dict] = []
    seal = Path(args.seal_file)
    seal = seal if seal.is_absolute() else ROOT / seal
    if args.mode == "testday" and not args.expect_testset_sha256:
        if not seal.exists():
            print(f"[중단] 봉인 파일이 없습니다: {seal}\n       예행연습(--mode rehearsal)을 먼저 끝내야 합니다")
            return 2
        args.expect_testset_sha256 = seal.read_text(encoding="utf-8").split()[0]
        print(f"[봉인] 시험셋 sha256 {args.expect_testset_sha256} ({seal.name})")
    common = ["--cache", args.cache, "--models", args.models, "--hash-list", args.hash_list]
    evaluate = [py, str(SCRIPTS / "sta_evaluate.py"), *common, "--out", args.out,
                "--seed", str(args.seed), "--miss-unit", args.miss_unit]
    if args.expect_testset_sha256:
        evaluate += ["--expect-testset-sha256", args.expect_testset_sha256]
    if args.aaos_dir and args.agera5:
        evaluate += ["--aaos-dir", args.aaos_dir, "--agera5", args.agera5]
    recompute = [py, str(SCRIPTS / "sta_recompute.py"), "--dir", args.out]
    one_thread = {**os.environ, "OMP_NUM_THREADS": "1"}

    plan = []
    if sta_common.git_state()["판단코드_동일"] is not None:
        plan.append(("코드 확인 (git diff 5ff054f -- src/ofdf)",
                     ["git", "diff", "--exit-code", "--stat", sta_common.TARGET_COMMIT, "--", "src/ofdf"],
                     None))
    else:
        print("[안내] git 저장소가 아니어서 git diff 는 건너뛴다 — 판단 코드는 해시 목록으로 대조한다")
    plan += [
        ("코드·모델 해시 확인", [py, str(SCRIPTS / "sta_evaluate.py"), *common, "--check-only"], None),
        ("고정 모델 평가", evaluate, None),
        ("로그만으로 재계산", recompute, None),
    ]
    if not args.skip_benchmark:
        plan += [
            ("판단시간 200회 측정",
             [py, str(SCRIPTS / "benchmark_inference.py"), "--cache", args.cache, "--models", args.models,
              "--out", str(out / "06_판단시간"), "--per-run-csv", str(out / "06_판단시간_회차별.csv"),
              "--log", str(out / "05_실행로그.txt")], one_thread),
            ("재계산(판단시간 포함)", recompute, None),
        ]

    ok = True
    for name, command, env in plan:
        if not run_step(name, command, steps, env):
            ok = False
            break

    if ok and args.mode == "rehearsal":
        base = ROOT / out if not out.is_absolute() else out
        final = json.loads((base / "03_최종결과.json").read_text(encoding="utf-8"))
        digest = final["sha256"]["시험데이터"]["01_시험데이터/시험셋.csv"]
        seal.parent.mkdir(parents=True, exist_ok=True)
        seal.write_text(f"{digest}  01_시험데이터/시험셋.csv\n", encoding="utf-8")
        print(f"\n[봉인] 시험셋 sha256 을 적었다: {seal}")

    archive = None
    if ok and not args.no_zip:
        begin = time.perf_counter()
        base = ROOT / out if not out.is_absolute() else out
        archive = base.with_name(f"{base.name}_{started:%Y%m%d}.zip")
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for file in sorted(base.rglob("*")):
                if file.is_file():
                    bundle.write(file, Path(base.name) / file.relative_to(base))
        steps.append({"단계": "결과 묶음 압축", "명령": f"zip {archive.name}",
                      "소요(초)": round(time.perf_counter() - begin, 1), "종료 코드": 0})
        print(f"\n제출 묶음: {archive}")

    total = sum(s["소요(초)"] for s in steps)
    print(f"\n{'=' * 78}\n{'전 단계 통과' if ok else '실패'} — 총 {total:.0f}초 ({total / 60:.1f}분)")
    for i, s in enumerate(steps, 1):
        print(f"  {i}. {s['단계']:<40} {s['소요(초)']:>7.1f}초  종료 코드 {s['종료 코드']}")
    if args.prerun_log:
        write_log(Path(args.prerun_log), args, steps, ok, started, archive)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
