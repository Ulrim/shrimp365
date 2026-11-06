#!/usr/bin/env python3
"""배포 중인 계수 모델의 사양을 **파일에서 직접 읽어** 적는다.

왜 이 스크립트가 있나
---------------------
결과보고서에 적히는 모델 수치는 지금까지 문서 서술뿐이었다(개발진척점검 ② 참고).
문서는 고쳐 적을 수 있고, 고쳐 적어도 아무도 모른다. 여기서 뽑는 값은 전부
**파일에서 계산**한 것이라 누구든 같은 명령으로 다시 확인할 수 있다.

적는 것과 적지 않는 것
----------------------
적는 것 : 확정 모델과의 일치 여부, sha256, 용량, 입력·출력 모양, opset, 클래스 수,
          이 기계에서 잰 추론 시간
적지 않는 것 : mAP·계수 오차율. **학습·평가 데이터셋이 저장소에 없어 재계산할
              수 없다.** 그 숫자를 여기서 베껴 적으면 "문서 한 곳에만 있는 숫자"를
              한 곳 더 늘릴 뿐이다. 데이터셋을 받으면 vision/ai/trainer/eval_count.py
              를 돌려 그 출력을 이 폴더에 넣는 것이 맞다.

실행 (저장소 뿌리에서):

    vision/.venv/bin/python docs/result-03-bluestartup/src/model-spec.py
"""
from __future__ import annotations

import hashlib
import platform
import statistics
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MODEL = ROOT / "vision" / "ai" / "models" / "shrimp_yolov8n_416.onnx"

#: 결과보고서에 보고하기로 확정한 모델의 지문(모델_확정.md).
#:
#: 여기에 적어 두는 이유: 모델을 조용히 바꿔 끼우면 보고서의 성능 수치가 그
#: 순간 무효가 되는데, 파일을 눈으로 봐서는 알 수 없다. 이 스크립트를 돌릴
#: 때마다 대조해서, 다른 모델이면 수치를 쓰기 전에 알아차리게 한다.
DECIDED_SHA256 = "ae95071c7e53df7e828e0faf51a54e0f7c5bb3010312b1d305949af12d533804"

#: 추론 시간을 재는 횟수. 처음 몇 번은 버린다(워밍업).
WARMUP, RUNS = 5, 30


def git(*args: str) -> str:
    try:
        return subprocess.run(
            ["git", *args], cwd=ROOT, capture_output=True, text=True, check=True
        ).stdout.strip()
    except Exception:  # noqa: BLE001
        return "(알 수 없음)"


def main() -> int:
    if not MODEL.exists():
        print(f"모델 파일이 없습니다: {MODEL}", file=sys.stderr)
        return 1

    blob = MODEL.read_bytes()
    digest = hashlib.sha256(blob).hexdigest()

    import numpy as np  # noqa: PLC0415
    import onnx  # noqa: PLC0415
    import onnxruntime as ort  # noqa: PLC0415

    model = onnx.load(str(MODEL))
    opset = ", ".join(f"{o.domain or 'ai.onnx'} v{o.version}" for o in model.opset_import)

    sess = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    inp = sess.get_inputs()[0]
    outs = sess.get_outputs()

    shape = [d if isinstance(d, int) else 1 for d in inp.shape]
    dummy = np.random.rand(*shape).astype(np.float32)

    for _ in range(WARMUP):
        sess.run(None, {inp.name: dummy})
    times = []
    for _ in range(RUNS):
        start = time.perf_counter()
        sess.run(None, {inp.name: dummy})
        times.append((time.perf_counter() - start) * 1000)

    out_shape = outs[0].shape
    # YOLOv8 출력은 (1, 4+클래스수, 후보수). 클래스 수를 거기서 되읽는다.
    classes = (out_shape[1] - 4) if isinstance(out_shape[1], int) else "(동적)"

    decided = digest == DECIDED_SHA256
    print("배포 중인 계수 모델 사양")
    print("=" * 56)
    if decided:
        print("확정 모델과 일치 — 이 수치를 보고에 쓸 수 있습니다.")
    else:
        print("⚠ 불일치 — 배포본이 확정된 모델이 아닙니다.")
        print(f"  확정(모델_확정.md): {DECIDED_SHA256}")
        print("  보고서의 성능 수치는 이 상태에서 쓸 수 없습니다.")
        print("  모델을 되돌리거나, 바꾼 것이 맞다면 모델_확정.md 를 먼저 고치십시오.")
    print("-" * 56)
    print(f"파일          : {MODEL.relative_to(ROOT)}")
    print(f"sha256        : {digest}")
    print(f"용량          : {len(blob):,} 바이트 ({len(blob)/1024/1024:.2f} MB)")
    print(f"저장소 커밋   : {git('rev-parse', 'HEAD')}")
    print(f"파일 최종 변경: {git('log', '-1', '--format=%cI', '--', str(MODEL))}")
    print()
    print(f"입력          : {inp.name} {inp.shape} ({inp.type})")
    for o in outs:
        print(f"출력          : {o.name} {o.shape} ({o.type})")
    print(f"클래스 수     : {classes}  (새우 1종)")
    print(f"opset         : {opset}")
    print(f"ONNX IR       : {model.ir_version}")
    print()
    print("추론 시간 (이 기계, CPU 1장 기준)")
    print(f"  중앙값      : {statistics.median(times):.1f} ms")
    print(f"  평균        : {statistics.fmean(times):.1f} ms")
    print(f"  최소 / 최대 : {min(times):.1f} / {max(times):.1f} ms")
    print(f"  측정        : 워밍업 {WARMUP}회 후 {RUNS}회")
    print(f"  기계        : {platform.processor() or platform.machine()},"
          f" {platform.system()} {platform.release()}")
    print(f"  onnxruntime : {ort.__version__}")
    print()
    print("※ 위 추론 시간은 **이 개발 기계**의 값이다. 현장 장비(라즈베리파이)는")
    print("   같은 모델에서 5~10배가 걸린다. 장비 실측값은 count_records.inference_ms")
    print("   열에 매 기록마다 저장되므로, 현장 수치는 그 열에서 뽑아야 한다.")
    print()
    print("※ mAP·계수 오차율은 여기 적지 않는다 — 평가 데이터셋이 저장소에 없어")
    print("   재계산할 수 없다. docs/result-03-bluestartup/모델_확정.md 5장 참고.")
    print()
    print("※ 위 추론 시간은 참고용이다. 보고에 쓸 계수 오차율은 **조건이 두 가지**이고")
    print("   섞어 쓰면 안 된다 — 모델_확정.md 4장을 반드시 읽을 것.")
    # 다른 모델이면 0 이 아닌 값으로 끝낸다. collect-evidence.sh 가 실패로 잡아
    # "전부 통과" 속에 묻히지 않게 한다.
    return 0 if decided else 2


if __name__ == "__main__":
    raise SystemExit(main())
