#!/usr/bin/env python3
"""비전 장비 원격 업데이트 — 농장에 찾아가지 않고 새 버전을 올린다.

왜 필요한가
-----------
파이가 열 대를 넘고 남의 농장에도 있다. 고칠 때마다 SSH 로 들어가는 방식은
오래 가지 못한다 — 한 대라도 빠지면 그 농장만 옛 코드로 돌고, 어느 농장이
어느 버전인지 아무도 모르게 된다.

**이 기능은 성격상 남의 장비에서 코드를 실행하는 통로다.** 아무 파일이나
받아 넣으면 그대로 뒷문이 된다. 그래서 무엇을 믿고 무엇을 안 믿는지 분명히
적어 둔다.

  믿지 않는 것   웹사이트, DB, 목록 파일(manifest), 회선. 전부 털릴 수 있다.
  믿는 것        **서명 하나.** 꾸러미가 진짜인지는 오너의 개인키로만 만들 수
                 있는 서명이 보장한다. 공개키는 이 파일 안에 박혀 있다.

그래서 서버가 통째로 털려도 농가 장비에 코드를 심을 수는 없다. 공격자가 할 수
있는 최대치는 "이미 서명된 예전 버전을 다시 주는 것"인데, 아래에서 지금보다
낮거나 같은 버전은 거부하므로 그것도 막힌다.

적용에 실패하면 이전 버전으로 되돌린다. 수조를 지켜보는 장비가 업데이트 한
번에 먹통이 되는 것은, 구버전으로 도는 것보다 훨씬 나쁘다.

수질 센서 파이(raspberry-pi/updater.py)와 같은 구조지만 **열쇠는 따로 쓴다.**
한쪽 개인키가 새도 다른 쪽은 멀쩡해야 한다. 비전 파이는 카메라가 달려 있어
잃었을 때의 손해가 더 크다.

승인 절차가 없는 이유
---------------------
센서 파이는 웹에서 농가가 "업데이트" 를 눌러야 받아 간다. 비전 파이는 그
단계를 두지 않았다 — **목록에 올리는 것 자체가 승인**이다. 새 버전을 서명해
목록에 올릴 수 있는 사람은 개인키를 가진 오너뿐이고, 그 사람이 곧 승인하는
사람이다. 단계를 하나 더 두면 서버에 "허용 버전" 을 적는 자리가 생기는데,
그 자리는 털릴 수 있는 반면 막아 주는 것은 없다.

    sudo python3 updater.py              # 한 번 확인하고 적용
    python3 updater.py --dry-run         # 받아서 검증까지만, 적용 안 함
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

log = logging.getLogger("shrimp365.vision.updater")

SERVICE = "shrimp365-vision"
APP_DIR = Path("/opt/shrimp365-vision")
PREV_DIR = Path("/opt/shrimp365-vision.prev")
STAGE_DIR = Path("/opt/shrimp365-vision.new")
CONF = Path("/etc/shrimp365-vision/env")

#: 마지막 결과를 적어 두는 자리. 장비 화면이 이것을 읽어 "올라갔나" 를 보여 준다.
#: SSH 없이 확인할 수 있는 유일한 길이라 반드시 적는다.
STATE_DIR = Path("/var/lib/shrimp365-vision")
RESULT_PATH = STATE_DIR / "update-result.json"

DEFAULT_MANIFEST = "https://www.shrimp365.kr/updates/vision/manifest.json"

# ── 서명 공개키 ──────────────────────────────────────────────────────────────
#
# **비어 있으면 아무것도 받지 않는다.** 이것이 기본값인 것은 실수가 아니다.
#
# 열쇠는 `deploy/release.py init` 로 **오너 PC 에서** 만들고, 거기서 나온
# 공개키를 여기에 붙여 넣는다. 개인키는 저장소에 넣지 않는다 — 한때 센서
# 파이의 개인키를 저장소에 두었다가 저장소가 공개로 바뀌면서 그대로 노출됐다.
# 공개된 키는 되돌릴 수 없다(git 기록에 남는다). 폐기하고 새로 만드는 길뿐이다.
#
# 센서 파이의 키를 그대로 가져다 쓰지 않는다. 그 키는 이미 노출됐고, 붙이는
# 순간 그것을 가진 사람이 모든 농장의 카메라 파이에 코드를 심을 수 있다.
RELEASE_PUBLIC_KEY = ""

# 꾸러미에 들어올 수 있는 것.
#
# 비전 프로그램은 `app/` 아래 여러 묶음으로 나뉘어 있어(services·api·models…)
# 센서 파이처럼 "밑줄과 소문자로 된 .py 한 덩어리" 로는 담을 수 없다. 대신
# **경로의 모양**으로 막는다. 막으려는 것은 애초에 경로다 — tar 는 `../` 나
# 절대경로, 심볼릭 링크로 /opt 바깥을 건드리게 만들 수 있다.
#
# 모델 파일(.onnx)은 일부러 넣지 않는다. 6 MB 가 넘어 농장 회선에 부담이고,
# 코드와 달리 자주 바뀌지도 않는다. 모델을 바꿀 때는 사람이 간다.
ALLOWED_PATH = re.compile(r"^app(/[a-z0-9_]+)*/[a-z0-9_]+\.py$")

#: 꾸러미가 바꿀 수 있는 낱개 파일.
#:
#: `deploy/updater.py` 가 들어 있는 것이 중요하다 — **업데이터가 자기 자신을
#: 고칠 수 있어야** 한다. 없으면 업데이터에 결함이 하나 나오는 순간 모든 농장에
#: 사람이 가야 하고, 그것이 바로 이 기능이 없애려던 일이다.
#:
#: 돌고 있는 업데이터가 바뀌어도 그 실행은 멀쩡하다. 파이썬은 시작할 때
#: 소스를 읽어 두므로, 새 코드는 다음 차례부터 쓰인다.
ALLOWED_EXTRA = {"VERSION", "pyproject.toml", "deploy/updater.py"}

#: 꾸러미가 **통째로** 갈아 끼우는 디렉터리.
#:
#: 파일만 덮어쓰면 지워진 모듈이 설치본에 남아, 새 코드가 옛 모듈을 불러오는
#: 뒤섞인 상태가 된다. 그 상태는 증상이 엉뚱한 곳에서 나온다.
MANAGED_DIRS = ("app",)


def allowed_path(name: str) -> bool:
    return name in ALLOWED_EXTRA or bool(ALLOWED_PATH.match(name))


#: 꾸러미 크기 상한. 압축 폭탄으로 SD 카드를 채우는 것을 막는다.
#: app/ 전체가 300 KB 안쪽이라 4 MB 면 한참 넉넉하다.
MAX_PACKAGE_BYTES = 4 * 1024 * 1024
#: 푼 뒤의 총 크기 상한. 작게 압축된 것이 풀리면서 부푸는 것을 따로 막는다.
MAX_UNPACKED_BYTES = 16 * 1024 * 1024


# ── 버전 ─────────────────────────────────────────────────────────────────────

def parse_version(text: str) -> tuple[int, int, int] | None:
    parts = text.strip().split(".")
    if len(parts) != 3:
        return None
    try:
        nums = tuple(int(p) for p in parts)
    except ValueError:
        return None
    if any(n < 0 or n > 999 for n in nums):
        return None
    return nums  # type: ignore[return-value]


def current_version(app_dir: Path | None = None) -> str:
    """설치된 버전. app/version.py 와 **같은 자리**를 본다.

    둘이 다른 자리를 보면 서버에 보고되는 버전과 업데이터가 판단하는 버전이
    어긋나고, 그러면 되감기 방지가 무너진다.
    """
    # 기본값을 인자에 적지 않는다. 파이썬은 함수를 만들 때 기본값을 한 번
    # 붙박아 두므로, 그렇게 적으면 APP_DIR 을 바꿔도 이 함수만 옛 경로를 본다.
    app_dir = APP_DIR if app_dir is None else app_dir
    try:
        text = (app_dir / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        return "0.0.0"
    return text if parse_version(text) else "0.0.0"


# ── 받아 오기 ────────────────────────────────────────────────────────────────

def _fetch(url: str, timeout: int = 60, limit: int = MAX_PACKAGE_BYTES) -> bytes:
    if not url.startswith("https://"):
        # http 로 받으면 중간에서 바꿔치기할 수 있다. 서명이 막아 주기는 하지만
        # 굳이 그 한 겹에만 기댈 이유가 없다.
        raise ValueError(f"https 주소만 받습니다: {url!r}")
    req = urllib.request.Request(url, headers={"User-Agent": "shrimp365-vision-updater"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 — 위에서 https 확인
        # 상한까지만 읽는다. Content-Length 를 믿지 않는다.
        data = resp.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"꾸러미가 너무 큽니다(> {limit} 바이트)")
    return data


def _load_verifier():
    """Ed25519 검증기. 준비되지 않으면 None — 그러면 아무것도 받지 않는다."""
    if not RELEASE_PUBLIC_KEY:
        log.info(
            "서명 공개키가 없어 원격 업데이트를 건너뜁니다. "
            "deploy/release.py init 로 열쇠를 만들고 공개키를 updater.py 에 넣으세요."
        )
        return None
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    except ImportError:
        log.warning("cryptography 가 없어 서명을 확인할 수 없습니다. "
                    "sudo apt install -y python3-cryptography")
        return None
    try:
        return Ed25519PublicKey.from_public_bytes(base64.b64decode(RELEASE_PUBLIC_KEY))
    except Exception as exc:  # noqa: BLE001 — 키가 깨졌으면 이유를 남기고 포기
        log.error("서명 공개키를 읽을 수 없습니다: %s", exc)
        return None


def verify_package(blob: bytes, version: str, entry: dict, verifier) -> None:
    """해시와 서명을 확인한다. 어긋나면 예외를 던진다."""
    digest = hashlib.sha256(blob).hexdigest()
    expected = str(entry.get("sha256", "")).lower()
    if digest != expected:
        raise ValueError(f"해시 불일치 (받은 것 {digest[:12]}…, 기대 {expected[:12]}…)")
    if not entry.get("signature"):
        raise ValueError("이 버전에는 서명이 없어 받을 수 없습니다")
    signature = base64.b64decode(str(entry["signature"]))
    # 서명 대상에 **버전을 함께** 넣는다. 그래야 예전 꾸러미의 서명을 떼어
    # 새 버전인 것처럼 갖다 붙일 수 없다.
    verifier.verify(signature, f"{version}\n{digest}\n".encode())


def safe_extract(blob: bytes, dest: Path) -> None:
    """꾸러미를 푼다. 허용한 모양의 평범한 파일만 받는다.

    tar 는 경로에 `../` 를 넣거나 심볼릭 링크를 걸어 바깥 파일을 덮어쓰게
    만들 수 있다. 서명을 통과한 꾸러미라도 형식은 따로 본다 — 서명은 "오너가
    만든 것" 만 보장하고, 실수로 잘못 묶인 것까지 막아 주지는 않는다.
    """
    dest.mkdir(parents=True, exist_ok=True)
    total = 0
    with tempfile.NamedTemporaryFile(suffix=".tar.gz") as tmp:
        tmp.write(blob)
        tmp.flush()
        with tarfile.open(tmp.name, "r:gz") as tar:
            members = []
            for m in tar.getmembers():
                name = m.name.lstrip("./")
                if not m.isfile():
                    raise ValueError(f"파일이 아닌 항목이 있습니다: {m.name}")
                if not allowed_path(name):
                    raise ValueError(f"허용되지 않은 경로: {m.name}")
                total += m.size
                if total > MAX_UNPACKED_BYTES:
                    raise ValueError("푼 크기가 상한을 넘었습니다")
                m.name = name
                m.mode = 0o644
                m.uid = m.gid = 0
                members.append(m)
            if not members:
                raise ValueError("꾸러미가 비어 있습니다")
            # filter="data" 는 파이썬이 한 겹 더 거르는 것이다(절대경로·../·
            # 특수 파일·권한). 위에서 이미 막았지만, 두 겹이 서로를 보완한다 —
            # 3.14 부터는 이것이 기본값이다. 옛 파이썬에는 없으므로 있을 때만.
            if hasattr(tarfile, "data_filter"):
                tar.extractall(dest, members=members, filter="data")  # noqa: S202
            else:  # pragma: no cover - 3.11.4 이전
                tar.extractall(dest, members=members)  # noqa: S202 — 위에서 전부 걸렀다


def sanity_check(staged: Path, python: Path) -> None:
    """바꿔치기 전에 새 코드가 최소한 돌아가는지 본다.

    **설치본의 파이썬으로 본다.** 시스템 파이썬에는 onnxruntime·fastapi 가 없어
    무엇을 넣어도 불러오기가 실패한다 — 그러면 검사가 늘 실패하거나, 늘
    건너뛰게 되어 아무것도 막지 못한다.
    """
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    files = sorted(str(p) for p in staged.rglob("*.py"))
    if not files:
        raise ValueError("꾸러미에 파이썬 파일이 없습니다")

    result = subprocess.run(
        [str(python), "-m", "py_compile", *files],
        capture_output=True, text=True, timeout=180, env=env,
    )
    if result.returncode != 0:
        raise ValueError(f"문법 검사 실패: {result.stderr.strip()[:200]}")

    # 불러오기까지 해 본다. import 단계에서 죽는 코드를 여기서 걸러낸다.
    # app.main 은 설정·모델 경로까지 건드리므로 실제 기동에 가장 가깝다.
    result = subprocess.run(
        [str(python), "-c", "import app.main"],
        cwd=str(staged), capture_output=True, text=True, timeout=180, env=env,
    )
    if result.returncode != 0:
        raise ValueError(f"불러오기 실패: {result.stderr.strip()[-200:]}")


# ── 적용 ─────────────────────────────────────────────────────────────────────

def service_healthy(wait_seconds: int = 120) -> tuple[bool, str]:
    """재시작한 서비스가 **자리를 잡았는지** 본다.

    "떴다" 로는 부족하다. 잠깐 떴다가 죽고 systemd 가 다시 띄우는 중일 수도
    있다(Restart=always). 그래서 일정 시간 계속 살아 있는지 보고, 그 다음에
    실제로 응답하는지까지 확인한다. 추론 기동(ONNX 적재)이 느려 넉넉히 준다.
    """
    deadline = time.time() + wait_seconds
    stable_since = None
    while time.time() < deadline:
        active = subprocess.run(
            ["systemctl", "is-active", "--quiet", SERVICE], check=False
        ).returncode == 0
        if not active:
            stable_since = None
            time.sleep(3)
            continue
        if stable_since is None:
            stable_since = time.time()
        if time.time() - stable_since >= 30:
            try:
                with urllib.request.urlopen(  # noqa: S310 — 루프백 고정
                    "http://127.0.0.1:8000/health", timeout=5
                ) as resp:
                    json.loads(resp.read().decode("utf-8"))
                return True, "정상"
            except Exception:  # noqa: BLE001
                return False, "서비스는 떴지만 응답하지 않습니다"
        time.sleep(3)
    return False, "재시작 후 자리를 잡지 못했습니다"


def _copy_managed(src_root: Path, dst_root: Path, *, replace_dirs: bool) -> None:
    """꾸러미가 관리하는 것만 옮긴다. 그 밖의 것은 건드리지 않는다.

    설치본에는 꾸러미에 없는 것도 있다 — 가상환경(.venv), 모델 파일, 설치
    스크립트. 통째로 덮어쓰면 그것들이 날아가고, 장비는 다시 깔아야만 산다.
    """
    for name in MANAGED_DIRS:
        src = src_root / name
        if not src.is_dir():
            continue
        dst = dst_root / name
        if replace_dirs and dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst, dirs_exist_ok=not replace_dirs)
    for name in sorted(ALLOWED_EXTRA):
        src = src_root / name
        if not src.is_file():
            continue
        dst = dst_root / name
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def recover_interrupted(app_dir: Path | None = None) -> bool:
    """갈아 끼우는 도중 전원이 나갔다면 되살린다. 손댄 것이 있으면 True.

    swap_in 은 `app/` 을 옆에 완성해 두고 이름 바꾸기 두 번으로 바꾼다. 그
    사이에 전원이 나가면 `app/` 이 없고 `app.retiring/` 만 남는다 — 서비스가
    못 뜨는 상태다. 매번 시작할 때 한 번 보고 제자리로 돌려놓는다.
    """
    app_dir = APP_DIR if app_dir is None else app_dir
    touched = False
    for name in MANAGED_DIRS:
        live = app_dir / name
        incoming, retiring = app_dir / f"{name}.incoming", app_dir / f"{name}.retiring"
        if not live.exists() and retiring.is_dir():
            os.rename(retiring, live)
            log.warning("지난번 교체가 중간에 끊겼습니다 — %s 를 되살렸습니다.", name)
            touched = True
        # 찌꺼기는 지운다. 남겨 두면 다음 교체 때 혼란스럽고 자리만 먹는다.
        for tmp in (incoming, retiring):
            if tmp.exists() and live.exists():
                shutil.rmtree(tmp, ignore_errors=True)
    return touched


def swap_in(staged: Path, app_dir: Path | None = None, prev_dir: Path | None = None) -> None:
    """새 코드를 제자리에 놓고 이전 것을 남겨 둔다.

    `app/` 은 **통째로 바꾼다.** 파일만 덮어쓰면 지워진 모듈이 설치본에 남아,
    새 코드가 옛 모듈을 불러오는 뒤섞인 상태가 된다. 되돌릴 때를 위해 이전
    `app/` 과 VERSION 을 먼저 옮겨 둔다.
    """
    app_dir = APP_DIR if app_dir is None else app_dir
    prev_dir = PREV_DIR if prev_dir is None else prev_dir
    if prev_dir.exists():
        shutil.rmtree(prev_dir)
    prev_dir.mkdir(parents=True)
    _copy_managed(app_dir, prev_dir, replace_dirs=True)

    # `app/` 은 **이름 바꾸기 두 번**으로 갈아 끼운다.
    #
    # 지우고 복사하면 그 사이(파일 수십 개를 옮기는 1~2초)에 전원이 나갔을 때
    # `app/` 이 아예 없는 장비가 남는다. 서비스는 못 뜨고, 다음 업데이트는
    # 그 망가진 상태를 "이전 버전" 으로 보관해 되돌릴 수조차 없게 된다 —
    # 농장에 사람이 가야만 풀리는, 이 기능이 없애려던 바로 그 상황이다.
    #
    # 옆에 통째로 완성해 두고 이름만 바꾸면 위험한 틈이 1~2초에서 두 번의
    # 메타데이터 연산으로 줄어든다. 그래도 남는 틈은 recover_interrupted 가
    # 다음 실행 때 되살린다.
    for name in MANAGED_DIRS:
        src = staged / name
        if not src.is_dir():
            continue
        live, incoming, retiring = (
            app_dir / name, app_dir / f"{name}.incoming", app_dir / f"{name}.retiring",
        )
        for tmp in (incoming, retiring):
            if tmp.exists():
                shutil.rmtree(tmp)
        shutil.copytree(src, incoming)
        if live.exists():
            os.rename(live, retiring)
        os.rename(incoming, live)
        shutil.rmtree(retiring, ignore_errors=True)

    # 낱개 파일은 작아서 쓰기 한 번으로 끝난다. VERSION 이 뒤에 적히는 것이
    # 중요하다 — 앞서 적고 교체가 실패하면 장비가 자기를 새 버전이라고 믿는다.
    for name in sorted(ALLOWED_EXTRA):
        src = staged / name
        if not src.is_file():
            continue
        dst = app_dir / name
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def roll_back(app_dir: Path | None = None, prev_dir: Path | None = None) -> bool:
    app_dir = APP_DIR if app_dir is None else app_dir
    prev_dir = PREV_DIR if prev_dir is None else prev_dir
    if not prev_dir.exists():
        log.error("되돌릴 이전 버전이 없습니다.")
        return False
    _copy_managed(prev_dir, app_dir, replace_dirs=True)
    subprocess.run(["systemctl", "restart", SERVICE], check=False)
    return True


def _owner_fix(app_dir: Path | None = None) -> None:
    """서비스 계정이 읽을 수 있게 되돌린다. 업데이터는 root 로 돈다."""
    app_dir = APP_DIR if app_dir is None else app_dir
    subprocess.run(["chown", "-R", "shrimp365:video", str(app_dir)], check=False)


def apply_update(blob: bytes, version: str, python: Path) -> tuple[bool, str]:
    # ── 1단계: 설치본을 건드리기 전 ──────────────────────────────────────────
    # 여기서 실패하면 설치본은 손대지 않은 상태라 그냥 포기하면 된다.
    if STAGE_DIR.exists():
        shutil.rmtree(STAGE_DIR)
    try:
        safe_extract(blob, STAGE_DIR)
        (STAGE_DIR / "VERSION").write_text(version + "\n", encoding="utf-8")
        sanity_check(STAGE_DIR, python)
    except Exception as exc:  # noqa: BLE001
        shutil.rmtree(STAGE_DIR, ignore_errors=True)
        return False, f"준비 단계 실패: {exc}"

    # ── 2단계: 여기서부터 설치본을 바꾼다 ────────────────────────────────────
    # 도중에 무엇이 잘못되든 반드시 되돌린다. 반쯤 바뀐 상태로 두면 새것도
    # 옛것도 아니게 되고, 그 상태는 사람이 가야만 풀린다.
    try:
        swap_in(STAGE_DIR)
        _owner_fix()
    except Exception as exc:  # noqa: BLE001
        log.error("교체 도중 실패했습니다(%s) — 이전 버전으로 되돌립니다.", exc)
        roll_back()
        _owner_fix()
        return False, f"교체 실패: {exc}"
    finally:
        shutil.rmtree(STAGE_DIR, ignore_errors=True)

    subprocess.run(["systemctl", "restart", SERVICE], check=False)
    ok, detail = service_healthy()
    if ok:
        return True, detail

    log.error("새 버전이 자리를 잡지 못했습니다 — 이전 버전으로 되돌립니다.")
    roll_back()
    _owner_fix()
    return False, detail


# ── 설정·결과 ────────────────────────────────────────────────────────────────

def read_settings(path: Path | None = None) -> dict:
    """설치 설정(KEY=VALUE 한 줄씩)에서 업데이트 항목만 읽는다."""
    path = CONF if path is None else path
    values: dict[str, str] = {}
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            values[key.strip()] = val.strip().strip('"').strip("'")
    except OSError:
        pass
    enabled = values.get("UPDATE_ENABLED", "true").lower() not in {"false", "0", "no", "off"}
    return {
        "enabled": enabled,
        "manifest": values.get("UPDATE_MANIFEST_URL", "").strip() or DEFAULT_MANIFEST,
    }


def write_result(status: str, version: str, message: str = "") -> None:
    """마지막 결과를 남긴다. 장비 화면이 읽어 사람에게 보여 준다.

    적지 못해도 업데이트를 실패로 만들지 않는다 — 표시용이다.
    """
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        RESULT_PATH.write_text(json.dumps({
            "status": status, "version": version,
            "message": message[:300], "at": int(time.time()),
        }, ensure_ascii=False), encoding="utf-8")
    except OSError as exc:
        log.debug("결과를 적지 못했습니다: %s", exc)


def pick_target(manifest: dict, here: str) -> tuple[str, dict] | None:
    """목록에서 받을 버전을 고른다. 받을 것이 없으면 None.

    `latest` 하나만 본다. 목록에 올리는 것 자체가 승인이므로, 오너가 올린
    가장 높은 버전이 곧 받아야 할 버전이다.
    """
    target = str(manifest.get("latest", "")).strip()
    tv, cv = parse_version(target), parse_version(here)
    if tv is None:
        log.warning("목록의 버전 형식이 이상합니다: %r", target)
        return None
    if cv is not None and tv <= cv:
        # 예전 꾸러미를 다시 밀어 넣는 수법을 막는다. 같은 버전도 받지 않는다 —
        # 받아 봐야 달라지는 것이 없고, 실패하면 멀쩡한 장비만 흔든다.
        log.info("이미 최신입니다(현재 %s, 목록 %s).", here, target)
        return None
    entry = (manifest.get("releases") or {}).get(target)
    if not isinstance(entry, dict):
        log.warning("목록에 %s 의 내용이 없습니다.", target)
        return None
    return target, entry


def run(dry_run: bool) -> int:
    settings = read_settings()
    if not settings["enabled"]:
        log.info("원격 업데이트가 꺼져 있습니다(UPDATE_ENABLED=false).")
        return 0

    if os.geteuid() == 0 and recover_interrupted():
        subprocess.run(["systemctl", "restart", SERVICE], check=False)

    here = current_version()
    log.info("현재 버전 %s — 새 버전을 확인합니다.", here)

    verifier = _load_verifier()
    if verifier is None:
        # 이유는 _load_verifier 가 이미 적었다. 화면에서도 보이게 남긴다.
        write_result("skipped", here, "서명 공개키가 없습니다")
        return 0

    try:
        manifest = json.loads(_fetch(settings["manifest"], limit=256 * 1024).decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 — 회선 문제면 다음 기회에
        log.info("목록을 받지 못했습니다(%s) — 다음에 다시 시도합니다.", exc)
        return 0

    picked = pick_target(manifest, here)
    if picked is None:
        return 0
    target, entry = picked

    log.info("새 버전 %s 를 받습니다.", target)
    try:
        file_name = str(entry.get("file", ""))
        if "/" in file_name or ".." in file_name or not file_name.endswith(".tar.gz"):
            raise ValueError(f"파일 이름이 이상합니다: {file_name!r}")
        base_url = settings["manifest"].rsplit("/", 1)[0]
        blob = _fetch(f"{base_url}/{file_name}")
        verify_package(blob, target, entry, verifier)
    except Exception as exc:  # noqa: BLE001 — 검증 실패는 조용히 포기한다
        log.error("업데이트를 거부했습니다: %s", exc)
        write_result("rejected", here, str(exc))
        return 1

    log.info("서명 확인 완료.")
    if dry_run:
        log.info("--dry-run 이라 적용하지 않고 끝냅니다.")
        return 0

    python = APP_DIR / ".venv" / "bin" / "python"
    if not python.exists():
        log.error("설치본의 파이썬이 없습니다: %s", python)
        write_result("failed", here, "설치본을 찾을 수 없습니다")
        return 1

    ok, detail = apply_update(blob, target, python)
    if ok:
        log.info("업데이트 완료: %s → %s", here, target)
        write_result("applied", target, detail)
        return 0

    log.error("업데이트 실패: %s (이전 버전 %s 로 되돌렸습니다)", detail, here)
    write_result("rolled_back", here, detail)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Shrimp365 비전 장비 원격 업데이트")
    parser.add_argument("--dry-run", action="store_true",
                        help="받아서 검증까지만 하고 적용하지 않음")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    if not args.dry_run and os.geteuid() != 0:
        print("적용하려면 root 여야 합니다: sudo python3 updater.py", file=sys.stderr)
        return 2
    try:
        return run(args.dry_run)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
