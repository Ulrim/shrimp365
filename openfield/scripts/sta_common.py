"""STA 시험용 스크립트 공통 도구 — 해시, 실행 환경, 콘솔 출력 기록.

`sta_evaluate.py` 와 `benchmark_inference.py` 가 같이 쓴다.
`sta_recompute.py` 는 STA 가 혼자 돌려 볼 수 있도록 이 파일을 쓰지 않는다
(파이썬 표준 라이브러리만 쓴다).
"""

from __future__ import annotations

import hashlib
import os
import platform
import re
import subprocess
import sys
from pathlib import Path

#: openfield/ 디렉터리
ROOT = Path(__file__).resolve().parents[1]

#: 시험 대상 커밋(판단 코드 기준). `reports/시험의뢰/모델해시.md` 와 같다.
TARGET_COMMIT = "5ff054f"

#: 모델·판정 경계 파일 해시 목록
DEFAULT_HASH_LIST = ROOT / "reports" / "시험의뢰" / "모델해시.md"

#: 시험 대상 커밋의 판단 코드(src/ofdf) sha256 목록 — git 이 없는 사본(압축 묶음)에서도 대조한다
CODE_HASH_LIST = ROOT / "reports" / "시험의뢰" / "판단코드해시_5ff054f.txt"

_HASH_LINE = re.compile(r"^([0-9a-f]{64})\s+(\S.*?)\s*$")


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(path: str | Path) -> str:
    """줄바꿈을 LF 로 맞춘 내용의 sha256 — Windows 에서 CRLF 로 받아도 같은 값이 나온다."""
    return hashlib.sha256(Path(path).read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def code_files() -> list[Path]:
    return sorted(p for p in (ROOT / "src" / "ofdf").rglob("*.py"))


def verify_code_hashes(hash_list: str | Path = CODE_HASH_LIST) -> tuple[int, list[str]] | None:
    """판단 코드(src/ofdf/**/*.py)를 시험 대상 커밋의 해시 목록과 대조한다.

    ``(대조한 파일 수, 문제 목록)`` 을 돌려준다. 목록 파일이 없으면 ``None``.
    """
    if not Path(hash_list).exists():
        return None
    expected = read_hash_list(hash_list)
    actual = {p.relative_to(ROOT).as_posix(): sha256_text(p) for p in code_files()}
    problems = [f"없음: {name}" for name in sorted(expected.keys() - actual.keys())]
    problems += [f"목록에 없는 파일: {name}" for name in sorted(actual.keys() - expected.keys())]
    problems += [f"해시 다름: {name}" for name in sorted(expected.keys() & actual.keys())
                 if expected[name] != actual[name]]
    return len(expected), problems


def read_hash_list(path: str | Path) -> dict[str, str]:
    """`<sha256>  <파일명>` 줄을 모아 ``{파일명: sha256}`` 으로 돌려준다."""
    found: dict[str, str] = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        match = _HASH_LINE.match(line.strip())
        if match:
            found[match.group(2)] = match.group(1)
    return found


def verify_model_hashes(model_dir: str | Path, hash_list: str | Path) -> tuple[dict[str, str], list[str]]:
    """모델 묶음의 sha256 을 해시 목록과 대조한다.

    Returns
    -------
    (실제 해시 ``{파일명: sha256}``, 문제 목록). 문제 목록이 비어 있어야 통과다.
    목록에 있는데 없는 파일, 해시가 다른 파일, 목록에 없는 모델·경계 파일
    (판정에 끼어들 수 있다)을 모두 문제로 센다.
    """
    model_dir = Path(model_dir)
    expected = read_hash_list(hash_list)
    problems: list[str] = []
    if not expected:
        return {}, [f"해시 목록이 비어 있음: {hash_list}"]

    actual: dict[str, str] = {}
    for name, want in sorted(expected.items()):
        path = model_dir / name
        if not path.exists():
            problems.append(f"없음: {name}")
            continue
        got = sha256_file(path)
        actual[name] = got
        if got != want:
            problems.append(f"해시 다름: {name} (목록 {want[:12]}… / 실제 {got[:12]}…)")

    # 목록에 없는 모델·경계 파일 — 접힘 모델이 하나 더 있으면 앙상블 평균이 달라진다
    for path in sorted(model_dir.glob("*")):
        if path.is_file() and path.suffix in (".txt", ".json") and path.name not in expected:
            if path.name.startswith(("model_", "compound_")):
                problems.append(f"목록에 없는 파일: {path.name}")
    return actual, problems


def _git(*args: str) -> tuple[int, str]:
    try:
        done = subprocess.run(
            ["git", "-C", str(ROOT), *args], capture_output=True, text=True, timeout=60,
            encoding="utf-8", errors="replace",
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return 127, str(exc)
    return done.returncode, (done.stdout or done.stderr).strip()


def git_state(target_commit: str = TARGET_COMMIT) -> dict:
    """현재 커밋과, 판단 코드(src/ofdf)가 시험 대상 커밋과 같은지를 돌려준다.

    ``판단코드_동일`` 은 True(같음) / False(다름) / None(확인 불가 — git 이 없거나
    시험 대상 커밋이 이 사본에 없음).
    """
    code, head = _git("rev-parse", "HEAD")
    state = {"현재 커밋": head if code == 0 else None, "시험 대상 커밋": target_commit,
             "판단코드_동일": None, "작업본_변경": None, "판단코드_해시대조": None}
    checked = verify_code_hashes()
    if checked is not None:
        state["판단코드_해시대조"] = not checked[1]
        state["판단코드_해시대조_문제"] = checked[1][:10]
    if code != 0:
        return state
    code, _ = _git("cat-file", "-e", f"{target_commit}^{{commit}}")
    if code == 0:
        # 작업본(커밋하지 않은 변경 포함)과 시험 대상 커밋의 src/ofdf 를 견준다
        code, _ = _git("diff", "--quiet", target_commit, "--", "src/ofdf")
        state["판단코드_동일"] = code == 0 if code in (0, 1) else None
    code, dirty = _git("status", "--porcelain", "--", ".")
    if code == 0:
        state["작업본_변경"] = bool(dirty)
    return state


def code_hashes() -> dict[str, str]:
    """판단 코드(src/ofdf)와 시험 스크립트의 sha256."""
    files = sorted((ROOT / "src" / "ofdf").rglob("*.py"))
    files += [ROOT / "scripts" / name for name in (
        "train_weather.py", "sta_common.py", "sta_evaluate.py", "sta_recompute.py",
        "benchmark_inference.py",
    )]
    return {
        path.relative_to(ROOT).as_posix(): sha256_file(path) for path in files if path.exists()
    }


def _cpu_model() -> str:
    try:
        lines = Path("/proc/cpuinfo").read_text(encoding="utf-8", errors="replace").splitlines()
        # x86 은 "model name", 라즈베리파이는 "Model"(보드 이름) — 숫자뿐인 "model : 173" 은 건너뛴다
        for key in ("model name", "model", "hardware"):
            for line in lines:
                name, _, value = line.partition(":")
                if name.strip().lower() == key and not value.strip().isdigit() and value.strip():
                    return value.strip()
    except OSError:
        pass
    if platform.system() == "Windows":
        return os.environ.get("PROCESSOR_IDENTIFIER", "") or platform.processor()
    if platform.system() == "Darwin":
        try:
            return subprocess.run(
                ["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True,
                timeout=10,
            ).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            pass
    return platform.processor() or platform.machine()


def _memory_gb() -> float | None:
    try:
        return round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 2**30, 1)
    except (AttributeError, ValueError, OSError):
        return None


def environment() -> dict:
    """성적서 「시험환경」 칸에 들어갈 실행 환경."""
    env = {
        "OS": platform.platform(),
        "CPU": _cpu_model(),
        "CPU 코어 수": os.cpu_count(),
        "아키텍처": platform.machine(),
        "RAM(GB)": _memory_gb(),
        "Python": platform.python_version(),
    }
    for label, module in (("LightGBM", "lightgbm"), ("numpy", "numpy"), ("pandas", "pandas"),
                          ("scikit-learn", "sklearn")):
        try:
            env[label] = __import__(module).__version__
        except ImportError:
            env[label] = None
    threads = os.environ.get("OMP_NUM_THREADS")
    if threads:
        env["OMP_NUM_THREADS"] = threads
    return env


class Tee:
    """콘솔 출력을 파일에도 그대로 남긴다(`05_실행로그.txt`)."""

    def __init__(self, path: str | Path, *, append: bool = False):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._file = open(path, "a" if append else "w", encoding="utf-8", newline="\n")
        self._stream = sys.stdout

    def write(self, text: str) -> int:
        self._stream.write(text)
        self._file.write(text)
        return len(text)

    def flush(self) -> None:
        self._stream.flush()
        self._file.flush()

    def __enter__(self) -> "Tee":
        sys.stdout = self
        return self

    def __exit__(self, *_exc) -> None:
        sys.stdout = self._stream
        self._file.close()
