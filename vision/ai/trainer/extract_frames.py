"""학습 데이터셋 구축용 프레임 추출 도구 (plan §8.2).

동영상 파일 또는 RTSP 스트림에서 일정 간격으로 프레임을 추출해 JPEG로
저장합니다. 추출된 images/ 디렉터리는 Roboflow / Label Studio에 올려
라벨링한 뒤 data.yaml 데이터셋으로 사용합니다.

Usage (ml extra required for OpenCV: `pip install -e ".[ml]"`):

    python ai/trainer/extract_frames.py --source tank1.mp4 --out datasets/raw
    python ai/trainer/extract_frames.py --source rtsp://cam/stream \
        --out datasets/raw --every-seconds 5 --limit 500
"""
from __future__ import annotations

import argparse
import sys
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
    return parser.parse_args(argv)


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
    stem = Path(str(args.source)).stem or "frame"

    saved = 0
    index = 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if index % frame_step == 0:
                path = out_dir / f"{stem}_{saved:06d}.jpg"
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
