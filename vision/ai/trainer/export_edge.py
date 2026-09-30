"""학습한 가중치를 라즈베리파이 4 에 바로 올릴 형태로 내보내고, 파이에서
실제 처리 시간을 재는 도구.

왜 필요한가. `best.pt` 를 그대로 파이에 올리면 torch 를 깔아야 하고, 640
해상도에서 한 장에 2초 안팎이 걸려 수행계획서의 처리 시간(1~3초) 여유가
거의 없다. ONNX 로 내보내면 onnxruntime 만 설치해서(토치 없이) 돌릴 수 있고,
해상도를 416/320 으로 줄이면 시간이 크게 줄어든다.

내보내기(성능 좋은 PC 나 Colab 에서):

    python ai/trainer/export_edge.py --weights runs/shrimp_yolov8/weights/best.pt \
        --format onnx --imgsz 512 --install

파이에서 실제 시간 측정(여기서 재는 숫자가 진짜다):

    python ai/trainer/export_edge.py --weights ai/models/shrimp_yolov8n.onnx \
        --bench --runs 30 --image /tmp/tank.jpg

형식 선택 기준
- `onnx`    기본값. `pip install onnxruntime` 만 필요하고 이 저장소의
            OnnxShrimpDetector 가 바로 읽는다. 파이 4 에서 가장 손이 덜 간다.
- `ncnn`    보통 가장 빠르지만 `pip install ncnn` 과 ultralytics 가 필요하다.
            MODEL_PATH 에 `*_ncnn_model` 디렉터리를 그대로 적는다.
- `openvino`/`tflite`/`torchscript` 도 통과만 시켜 준다(운영 기본 경로는 아니다).
"""
from __future__ import annotations

import argparse
import shutil
import statistics
import sys
import time
from pathlib import Path

_HERE = Path(__file__).resolve().parent
VISION_ROOT = _HERE.parents[1]
MODELS_DIR = VISION_ROOT / "ai" / "models"
INSTALL_STEM = "shrimp_yolov8n"
TARGET_LATENCY_MS = 3000  # 수행계획서 처리 시간 상한
GOOD_LATENCY_MS = 1000

MISSING_ULTRALYTICS_MSG = (
    "[오류] ultralytics 패키지가 설치되어 있지 않습니다.\n"
    "내보내기에는 ml 의존성이 필요합니다(파이가 아니라 학습한 PC/Colab 에서 실행하세요):\n"
    '    pip install -e ".[ml]"'
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="라즈베리파이 배포용 모델 내보내기 + 처리 시간 측정",
    )
    parser.add_argument("--weights", required=True, help="best.pt 또는 이미 내보낸 모델 경로")
    parser.add_argument(
        "--format",
        default="onnx",
        choices=("onnx", "ncnn", "openvino", "tflite", "torchscript"),
    )
    parser.add_argument(
        "--imgsz", type=int, default=640, help="고정 추론 해상도(파이는 416~512 권장)"
    )
    parser.add_argument("--half", action="store_true", help="FP16 (파이 CPU 에서는 이득이 없다)")
    parser.add_argument("--int8", action="store_true", help="INT8 양자화(정확도 확인 필수)")
    parser.add_argument("--no-simplify", action="store_true", help="ONNX 단순화를 건너뛴다")
    parser.add_argument(
        "--install",
        action="store_true",
        help=f"내보낸 파일을 {MODELS_DIR} 로 복사하고 설정값을 안내한다",
    )
    parser.add_argument("--bench", action="store_true", help="내보내기 대신 처리 시간만 측정한다")
    parser.add_argument("--runs", type=int, default=20, help="측정 횟수")
    parser.add_argument("--image", default=None, help="측정에 쓸 이미지(없으면 합성 프레임)")
    parser.add_argument("--conf", type=float, default=0.25, help="측정 시 신뢰도 임계값")
    return parser.parse_args(argv)


# ---------------------------------------------------------------------------
# 내보내기
# ---------------------------------------------------------------------------


def export(args: argparse.Namespace) -> Path:
    try:
        from ultralytics import YOLO  # noqa: PLC0415 - 무거운 지연 임포트
    except ImportError:
        print(MISSING_ULTRALYTICS_MSG, file=sys.stderr)
        raise SystemExit(1) from None

    model = YOLO(args.weights)
    kwargs: dict = {"format": args.format, "imgsz": args.imgsz}
    if args.format == "onnx":
        kwargs["simplify"] = not args.no_simplify
        kwargs["opset"] = 12  # 파이의 onnxruntime 구버전까지 안전한 범위
        kwargs["dynamic"] = False
    if args.half:
        kwargs["half"] = True
    if args.int8:
        kwargs["int8"] = True

    print(f"[내보내기] {args.weights} -> {args.format} (imgsz={args.imgsz})")
    out = model.export(**kwargs)
    path = Path(out)
    print(f"[완료] {path}")
    return path


def install(path: Path, imgsz: int) -> Path:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    if path.is_dir():
        target = MODELS_DIR / f"{INSTALL_STEM}_{path.name.split('_', 1)[-1]}"
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(path, target)
    else:
        target = MODELS_DIR / f"{INSTALL_STEM}{path.suffix}"
        shutil.copy2(path, target)
    rel = f"./ai/models/{target.name}"
    print(f"[설치] {target}")
    print("\n파이의 /etc/shrimp365-vision/env 에 다음을 넣으세요:")
    print(f"    MODEL_PATH={rel}")
    print(f"    MODEL_IMGSZ={imgsz}")
    if target.suffix == ".onnx":
        print("    # ultralytics/torch 는 필요 없습니다:  pip install onnxruntime")
    print("    # 적용:  sudo systemctl restart shrimp365-vision")
    return target


# ---------------------------------------------------------------------------
# 측정
# ---------------------------------------------------------------------------


def _load_frame(path: str | None, imgsz: int):  # noqa: ANN202
    import numpy as np  # noqa: PLC0415

    if path:
        from PIL import Image  # noqa: PLC0415

        rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.uint8)
        return np.ascontiguousarray(rgb[:, :, ::-1])  # 스트림과 같은 BGR 로 넘긴다
    rng = np.random.default_rng(7)
    return rng.integers(0, 255, size=(720, 1280, 3), dtype=np.uint8)


def _build_detector(weights: str, conf: float):  # noqa: ANN202
    sys.path.insert(0, str(VISION_ROOT))
    if weights.lower().endswith(".onnx"):
        from app.services.detector_onnx import OnnxShrimpDetector  # noqa: PLC0415

        return OnnxShrimpDetector(model_path=weights, conf_threshold=conf), "onnxruntime"
    from app.services.detector import ShrimpDetector  # noqa: PLC0415

    return ShrimpDetector(model_path=weights, conf_threshold=conf), "ultralytics"


def bench(args: argparse.Namespace) -> int:
    detector, backend = _build_detector(args.weights, args.conf)
    frame = _load_frame(args.image, args.imgsz)
    size = f"{frame.shape[1]}x{frame.shape[0]}"
    print(f"[측정] {args.weights} ({backend}), {args.runs}회, 프레임 {size}")

    if not args.image:
        print(
            "  참고: --image 로 실제 수조 사진을 주는 편이 정확합니다. 합성 프레임은",
            "검출이 거의 없어 후처리(NMS) 비용이 실제보다 싸게 나옵니다.",
        )
    try:
        first = detector.detect(frame)  # 첫 회는 모델 적재 포함이라 따로 본다
    except RuntimeError as exc:
        print(f"{exc}", file=sys.stderr)
        return 1
    except ImportError:
        # .pt 를 파이에서 직접 돌리려는 경우. ONNX 를 쓰면 필요 없다.
        print(
            "[오류] 이 가중치를 읽는 데 ultralytics(torch)가 필요합니다.\n"
            "파이에서는 ONNX 로 내보낸 모델을 쓰세요(docs/VISION_MODEL_TRAINING.md):\n"
            '    pip install -e ".[edge]"  그리고  --weights ai/models/shrimp_yolov8n.onnx',
            file=sys.stderr,
        )
        return 1
    print(f"  첫 회(모델 적재 포함) {first.inference_ms}ms, 검출 {first.count}개")

    times: list[float] = []
    for _ in range(max(1, args.runs)):
        start = time.perf_counter()
        result = detector.detect(frame)
        times.append((time.perf_counter() - start) * 1000)
    times.sort()
    median = statistics.median(times)
    p95 = times[min(len(times) - 1, int(0.95 * len(times)))]
    print(
        f"  중앙 {median:.0f}ms  p95 {p95:.0f}ms  최소 {times[0]:.0f}ms  최대 {times[-1]:.0f}ms"
    )
    print(f"  마지막 검출 수 {result.count}개, 최대 처리율 약 {1000 / max(median, 1):.2f} fps")

    if p95 <= GOOD_LATENCY_MS:
        verdict = "여유 있음"
    elif p95 <= TARGET_LATENCY_MS:
        verdict = "기준(1~3초) 안에 들어옴"
    else:
        verdict = "기준 초과 — imgsz 를 줄이거나 ncnn 으로 내보내세요"
    print(f"  판정: {verdict}")
    print(
        "  참고: INFERENCE_FPS=1 이면 1초에 한 장만 처리하므로 "
        "p95 가 1000ms 를 넘어도 동작은 합니다."
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.bench:
        return bench(args)
    path = export(args)
    if args.install:
        install(path, args.imgsz)
    else:
        print(f"\n설치까지 하려면 --install 을 붙이거나 직접 복사하세요: {MODELS_DIR}")
    print("\n다음 단계: 이 모델로 계수 오차율을 다시 재세요(양자화로 숫자가 바뀔 수 있습니다).")
    print(f"    python ai/trainer/eval_count.py --weights {path} --data datasets/shrimp/data.yaml")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
