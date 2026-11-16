#!/usr/bin/env python3
"""STA 시험 묶음을 만들고 재실행한다 — 윈도우·맥·리눅스 어디서나 같은 명령으로.

왜 따로 있나
------------
시험 PC가 윈도우일 수 있다. bash 와 `sha256sum` 이 없어도 돌아야 하므로 순서를
파이썬으로 적었다. 여기에는 **측정 로직이 없다** — `prepare_dataset.py`,
`eval_detect.py`, `recompute_detect.py` 를 차례로 부르고, 화면에 나온 것을
`05_실행로그.txt` 에 그대로 남길 뿐이다.

쓰는 법  (vision/ 또는 꾸러미의 프로그램/ 에서)
-------
    python ai/trainer/sta_run.py rehearsal
        원본 데이터셋 없이 설치와 흐름만 확인한다. 저장소의 수조 사진 12장을 쓴다.
        **수치는 성적이 아니다.** 묶음: sta_리허설/

    python ai/trainer/sta_run.py prepare <shrimp_cf 폴더> <Counting PL 폴더>
        전날: 학습 때와 같은 방식으로 다시 나눠 test 445장을 만들고(씨앗 20260101,
        --on-leakage regroup), 묶음에 복사해 sha256 으로 고정한 뒤 사전 측정한다.
        test 가 445장·정답 3,699개가 아니면 **멈춘다.**

    python ai/trainer/sta_run.py rerun
        시험 당일: 고정해 둔 시험 데이터를 sha256 으로 대조하고, 다시 재고,
        로그만으로 다시 계산한다.

    판정 기준 등 eval_detect.py 인자는 `--` 뒤에 적는다.
        python ai/trainer/sta_run.py rerun -- --count-judge both --pass-count-within 0.8

묶음 (기본 sta_블루스타트업/)
    README_읽는법.txt  00_시험대상_해시.txt  01_시험데이터/(test, sha256sums.txt, 통계.txt)
    02_예측별_결과.csv  02_정답별_결과.csv  02_이미지별_결과.csv
    03_최종결과.json   04_재계산_결과.txt   05_실행로그.txt

환경변수(선택): STA=<묶음 폴더>  WEIGHTS=<모델>  CONF=0.25  WORK=<분할 작업 폴더>
"""
from __future__ import annotations

import argparse
import hashlib
import os
import shlex
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
VISION = HERE.parent.parent
ROOT = VISION.parent
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
RESULT_GLOBS = ("00_*", "02_*", "03_*", "04_*", "05_*", "README_*")


class Stop(Exception):
    """측정하지 않고 멈춘다."""


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Console:
    """화면에 찍으면서 실행 로그에도 같은 줄을 남긴다."""

    def __init__(self) -> None:
        self.log: Path | None = None

    def say(self, text: str = "") -> None:
        print(text, flush=True)
        if self.log:
            with self.log.open("a", encoding="utf-8") as fh:
                fh.write(text + "\n")

    def run(self, *args: str) -> int:
        """파이썬 스크립트를 돌리고 출력을 한 줄씩 그대로 옮긴다."""
        env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
        proc = subprocess.Popen([sys.executable, "-u", *args], cwd=VISION, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        assert proc.stdout is not None
        for raw in proc.stdout:
            self.say(raw.decode("utf-8", errors="replace").rstrip("\r\n"))
        return proc.wait()


def count_split(base: Path) -> tuple[int, int]:
    """이미지 장수와 정답 박스 수 — 측정 프로그램과 같은 규칙(값 5개 이상인 줄)."""
    images = [p for p in (base / "images").rglob("*") if p.suffix.lower() in IMAGE_EXT]
    boxes = 0
    for image in images:
        label = (base / "labels" / image.relative_to(base / "images")).with_suffix(".txt")
        if label.exists():
            boxes += sum(1 for line in label.read_text(encoding="utf-8", errors="replace")
                         .splitlines() if len(line.split()) >= 5)
    return len(images), boxes


def require_expected(out: Console, base: Path, images: int, boxes: int, check: bool) -> None:
    n_img, n_box = count_split(base)
    out.say(f"  test 분할  이미지 {n_img} 장 · 정답 박스 {n_box} 개")
    if check and (n_img, n_box) != (images, boxes):
        raise Stop(f"학습 기록의 test 분할(이미지 {images} 장 · 정답 {boxes} 개)과 다릅니다.\n"
                   "       받은 원본 데이터셋의 판(version)이 그때와 같은지 확인하세요. "
                   "측정하지 않습니다.")


def verify_sums(out: Console, test: Path, sums: Path) -> None:
    """고정해 둔 sha256 목록과 시험 데이터를 한 파일씩 견준다(sha256sum -c 와 같은 일)."""
    out.say("  시험 데이터 sha256 대조")
    bad = 0
    lines = sums.read_text(encoding="utf-8").splitlines()
    for line in lines:
        digest, rel = line.split("  ", 1)
        path = test / rel
        if not path.exists() or sha256_of(path) != digest:
            out.say(f"    불일치: {rel}")
            bad += 1
    if bad:
        raise Stop(f"시험 데이터가 고정된 목록과 다릅니다({bad}개 파일). 측정하지 않습니다.")
    out.say(f"  → {len(lines):,}개 파일 모두 일치")


def git_commit() -> str:
    try:
        r = subprocess.run(["git", "-C", str(VISION), "rev-parse", "HEAD"],
                           capture_output=True, text=True, timeout=20, check=False)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    stamp = VISION / "GIT_COMMIT"
    return (stamp.read_text(encoding="utf-8").strip() + " (꾸러미에 적힌 값)"
            if stamp.exists() else "확인 불가")


def clear_results(sta: Path) -> None:
    for pattern in RESULT_GLOBS:
        for path in sta.glob(pattern):
            if path.is_file():
                path.unlink()


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):          # 윈도우 콘솔(cp949)에서 죽지 않게
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    argv = list(sys.argv[1:] if argv is None else argv)
    eval_args = shlex.split(os.environ.get("EVAL_ARGS", ""))
    if "--" in argv:
        cut = argv.index("--")
        argv, eval_args = argv[:cut], eval_args + argv[cut + 1:]

    p = argparse.ArgumentParser(description="STA 시험 묶음 만들기·재실행",
                                epilog="자세한 설명은 이 파일 머리말을 보세요.")
    sub = p.add_subparsers(dest="mode", required=True)
    sub.add_parser("rehearsal", help="원본 데이터셋 없이 설치·흐름 확인(성적 아님)")
    sub.add_parser("rerun", help="시험 당일: 고정한 시험 데이터로 다시 재고 다시 계산")
    pp = sub.add_parser("prepare", help="전날: test 445장 생성 → 묶음 → 사전 측정")
    pp.add_argument("shrimp_cf", nargs="?", help="shrimp_cf YOLOv8 내보내기 폴더")
    pp.add_argument("counting_pl", help="Counting PL YOLOv8 내보내기 폴더")
    pp.add_argument("--from-roboflow", action="store_true",
                    help="shrimp_cf 를 Roboflow 에서 받는다(ROBOFLOW_API_KEY 환경변수)")
    args = p.parse_args(argv)

    weights = Path(os.environ.get("WEIGHTS", VISION / "ai/models/shrimp_yolov8n_416.onnx"))
    work = Path(os.environ.get("WORK", VISION / "datasets/shrimp")).resolve()
    evid = Path(os.environ.get("EVID", ROOT / "docs/result-03-bluestartup/evidence"))
    conf = os.environ.get("CONF", "0.25")
    expect = (int(os.environ.get("EXPECT_IMAGES", "445")),
              int(os.environ.get("EXPECT_BOXES", "3699")))
    rehearsal = args.mode == "rehearsal"
    default_sta = VISION / ("sta_리허설" if rehearsal else "sta_블루스타트업")
    sta = default_sta if rehearsal else Path(os.environ.get("STA", default_sta)).resolve()
    test = sta / "01_시험데이터" / "test"
    sums = sta / "01_시험데이터" / "sha256sums.txt"
    out = Console()

    try:
        if not weights.exists():
            raise Stop(f"모델이 없습니다: {weights}")

        if rehearsal:
            out.say("== 리허설 — 설치와 흐름 확인용. 여기서 나온 수치는 성적이 아닙니다 ==")
            src = VISION / "data" / "tank" / "labeled"
            if not (src / "images").is_dir():
                raise Stop(f"리허설 자료가 없습니다: {src}")
            shutil.rmtree(sta, ignore_errors=True)
            test.mkdir(parents=True)
            for name in ("images", "labels"):
                shutil.copytree(src / name, test / name)
        elif args.mode == "prepare":
            if args.from_roboflow:
                cf = VISION / "data" / "shrimp_cf"
                if out.run("-I", "ai/trainer/fetch_roboflow.py", "--out", str(cf)):
                    raise Stop("shrimp_cf 를 받지 못했습니다.")
            elif args.shrimp_cf:
                cf = Path(args.shrimp_cf).expanduser().resolve()
            else:
                raise Stop("shrimp_cf 폴더를 주거나 --from-roboflow 를 쓰세요.")
            pl = Path(args.counting_pl).expanduser().resolve()
            for d in (cf, pl):
                if not (d / "data.yaml").exists():
                    raise Stop(f"{d} 안에 data.yaml 이 없습니다 "
                               "(Roboflow YOLOv8 내보내기 폴더를 주세요).")
            out.say("== 1/4  분할 재현 ==================================================")
            out.say(f"  shrimp_cf    {cf}")
            out.say(f"  counting_pl  {pl}")
            if out.run("ai/trainer/prepare_dataset.py",
                       "--source", f"shrimp_cf={cf}", "--source", f"counting_pl={pl}",
                       "--out", str(work), "--on-leakage", "regroup",
                       "--report", str(work / "준비보고.json")):
                raise Stop("분할을 만들지 못했습니다(위 메시지 참고).")
            out.say()
            require_expected(out, work / "test", *expect, check=True)
            out.say()
            out.say("== 2/4  시험 데이터 고정 ===========================================")
            # 새로 나눴으므로 이전 묶음의 시험 데이터·목록·결과는 지우고 다시 만든다.
            shutil.rmtree(sta / "01_시험데이터", ignore_errors=True)
            sta.mkdir(parents=True, exist_ok=True)
            clear_results(sta)
            test.mkdir(parents=True)
            for name in ("images", "labels"):
                shutil.copytree(work / "test" / name, test / name)
            out.say(f"  복사  {test}")
        else:
            if not ((test / "images").is_dir() and sums.exists()):
                raise Stop(f"고정해 둔 시험 데이터가 없습니다: {test}\n"
                           "       먼저 원본 데이터셋으로 묶음을 만드세요(prepare).")
            # 전날 결과가 오늘 결과와 섞이지 않게 지운다(시험 데이터와 고정 목록은 그대로).
            clear_results(sta)

        out.log = sta / "05_실행로그.txt"
        out.log.unlink(missing_ok=True)
        if rehearsal:
            out.say("※ 리허설 — 수조 사진 12장. 이 로그의 수치와 판정은 성적이 아닙니다.")
        out.say("== 시험 대상 확인 =================================================")
        out.say(f"  실행 시각   {datetime.now().astimezone():%Y-%m-%d %H:%M:%S %Z}")
        out.say(f"  git 커밋    {git_commit()}")
        out.say(f"  모델 sha256 {sha256_of(weights)}")
        require_expected(out, test, *expect, check=not rehearsal)
        if args.mode == "rerun":
            verify_sums(out, test, sums)

        out.say()
        out.say("== 3/4  배포본 성능 측정 ===========================================")
        extra: list[str] = []
        if args.mode == "prepare" and evid.parent.is_dir():   # 사전 측정은 증빙 폴더에도 남긴다
            evid.mkdir(parents=True, exist_ok=True)
            extra = ["--json", str(evid / "08_탐지성능_test분할.json"),
                     "--csv", str(evid / "08_탐지성능_test분할_이미지별.csv")]
        if out.run("ai/trainer/eval_detect.py", "--weights", str(weights),
                   "--images", str(test / "images"), "--labels", str(test / "labels"),
                   "--conf", conf, "--bootstrap", "2000",
                   "--log-dir", str(sta), *extra, *eval_args):
            raise Stop("측정이 끝까지 돌지 않았습니다(위 메시지 참고).")

        out.say()
        out.say("== 4/4  로그만으로 다시 계산 =======================================")
        code = out.run("ai/trainer/recompute_detect.py", "--dir", str(sta))
        out.say(f"재계산 종료 코드 {code}")
    except Stop as stop:
        out.say(f"[중단] {stop}")
        return 1

    print()
    print("== 끝났습니다 ======================================================")
    print(f"  제출 묶음  {sta}")
    print(f"  실행 로그  {out.log}")
    print()
    if code:
        print("  ⚠ 재계산이 최종결과와 다릅니다. 이 묶음은 보내지 마세요.")
    elif rehearsal:
        print("  리허설이 끝까지 돌았습니다 — 이 PC 에서 측정·재계산이 됩니다.")
        print("  위 수치와 판정은 수조 사진 12장의 것이라 성적이 아닙니다. "
              "이 묶음은 보내지 마세요.")
    elif args.mode == "prepare":
        print("  1) 03_최종결과.json 의 판정과 "
              "04_재계산_결과.txt 의 '모두 일치'를 확인하세요.")
        print("  2) 시험 당일에는 같은 묶음으로:  python ai/trainer/sta_run.py rerun")
    else:
        print("  묶음 폴더를 압축해 당일 오후 시험기관에 보냅니다.")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
