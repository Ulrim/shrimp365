"""학습 데이터셋 구축용 프레임 추출 도구 (plan §8.2).

동영상 파일 또는 RTSP 스트림에서 일정 간격으로 프레임을 추출해 JPEG로
저장합니다. 추출된 images/ 디렉터리는 Roboflow / Label Studio에 올려
라벨링한 뒤 data.yaml 데이터셋으로 사용합니다.

Usage (ml extra required for OpenCV: `pip install -e ".[ml]"`):

    python ai/trainer/extract_frames.py --source tank1.mp4 --out datasets/raw
    python ai/trainer/extract_frames.py --source rtsp://cam/stream \
        --out datasets/raw --every-seconds 5 --limit 500

파일 이름은 `<회차>.rf.<번호>.jpg` 다 (`stream-20261112-093000.rf.000001.jpg`).

두 가지를 동시에 노린 이름이다.

* **회차**가 들어가므로 다른 날 찍은 프레임끼리 이름이 겹치지 않는다.
* `.rf.` 앞부분이 같으면 `prepare_dataset.py` 가 **한 묶음**으로 보고 train/valid/
  test 중 한 곳에 통째로 넣는다. 5분 간격으로 찍어도 같은 회차 프레임은 물 색·
  조명·개체 배치가 거의 같아서, 흩어지면 학습 데이터가 평가 쪽으로 샌다.

그래서 **한 번 길게 찍는 것보다 여러 회차로 나눠 찍는 편이 낫다.** 회차가
묶음의 단위이므로, 회차가 서너 개뿐이면 분할 비율을 맞출 수 없다.
회차 이름을 직접 정하려면 `--prefix tank1-야간` 처럼 준다.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

MISSING_CV2_MSG = (
    "[오류] opencv-python(cv2) 패키지가 설치되어 있지 않습니다.\n"
    "프레임 추출에는 ml 의존성이 필요합니다. backend 디렉터리에서 다음을 실행하세요:\n"
    '    pip install -e ".[ml]"'
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract labeling frames from a video file / RTSP stream",
    )
    parser.add_argument(
        "--source",
        required=True,
        help="video file path, rtsp:// / http:// URL, or USB device index",
    )
    parser.add_argument("--out", default="./images", help="output directory for JPEG frames")
    parser.add_argument(
        "--every-seconds",
        type=float,
        default=1.0,
        help="interval between saved frames (seconds of video time)",
    )
    parser.add_argument(
        "--limit", type=int, default=0, help="max frames to save (0 = unlimited)"
    )
    parser.add_argument(
        "--prefix",
        default=None,
        help=(
            "파일 이름 앞에 붙일 촬영 회차 이름. 생략하면 <소스이름>-<날짜시각> 이 붙는다. "
            "회차가 섞이면 분할이 망가지므로 비워 두지 말 것(아래 설명 참고)"
        ),
    )
    return parser.parse_args(argv)


def session_prefix(source: str, now: datetime | None = None) -> str:
    """촬영 회차를 파일 이름에 박는다 — 이게 없으면 분할이 조용히 망가진다.

    RTSP 로 받으면 소스 이름이 늘 같다(`rtsp://cam/stream` -> `stream`). 그대로
    두면 어제 찍은 `stream_000000.jpg` 와 오늘 찍은 `stream_000000.jpg` 가
    같은 이름이 된다. 덮어써서 자료를 잃는 것도 문제지만, 더 나쁜 일이 뒤에서
    일어난다 — `prepare_dataset.py` 는 파일 이름 앞부분으로 "같은 원본 프레임"을
    묶으므로, **다른 날 찍은 남남을 한 묶음으로 보고** train/valid 에 함께 넣지
    않으려 애쓴다. 그 결과 분할 비율이 틀어지고, 반대로 1초 간격으로 찍어 거의
    같은 두 장은 묶이지 않아 학습 데이터가 평가 쪽으로 샌다.

    그래서 회차마다 다른 이름을 준다: `stream-20261112-0930`.
    """
    base = Path(source).stem or "frame"
    base = "".join(c if c.isalnum() or c in "-_" else "-" for c in base).strip("-") or "frame"
    stamp = (now or datetime.now()).strftime("%Y%m%d-%H%M%S")
    return f"{base}-{stamp}"


def _load_cv2():
    try:
        import cv2  # noqa: PLC0415 - lazy heavy import
    except ImportError:
        print(MISSING_CV2_MSG, file=sys.stderr)
        raise SystemExit(1) from None
    return cv2


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    cv2 = _load_cv2()

    source: str | int = args.source
    if isinstance(source, str) and source.isdigit():
        source = int(source)  # USB device index

    capture = cv2.VideoCapture(source)
    if not capture.isOpened():
        print(f"[오류] 소스를 열 수 없습니다: {args.source}", file=sys.stderr)
        return 1

    fps = capture.get(cv2.CAP_PROP_FPS) or 0.0
    if fps <= 0 or fps > 240:
        fps = 30.0  # 라이브 스트림 등 FPS 미보고 시 보수적 기본값
    frame_step = max(1, int(round(fps * max(args.every_seconds, 0.01))))

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = args.prefix or session_prefix(str(args.source))

    saved = 0
    index = 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if index % frame_step == 0:
                # `.rf.` 앞을 한 묶음으로 보는 규칙에 맞춘다(아래 설명).
                path = out_dir / f"{stem}.rf.{saved:06d}.jpg"
                cv2.imwrite(str(path), frame)
                saved += 1
                if saved % 50 == 0:
                    print(f"... {saved}장 저장")
                if args.limit and saved >= args.limit:
                    break
            index += 1
    finally:
        capture.release()

    print(f"[완료] {saved}장 저장됨 -> {out_dir.resolve()}")
    print("다음 단계: Roboflow / Label Studio에 업로드해 'shrimp' 클래스 라벨링을 진행하세요.")
    return 0 if saved > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
