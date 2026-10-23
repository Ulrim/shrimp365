#!/usr/bin/env python3
"""비전 장비 원격 업데이트 — 농장에 찾아가지 않고 새 버전을 올린다.

왜 필요한가
-----------
파이가 열 대를 넘고 남의 농장에도 있다. 고칠 때마다 SSH 로 들어가는 방식은
오래 가지 못한다 — 한 대라도 빠지면 그 농장만 옛 코드로 돌고, 어느 농장이
어느 버전인지 아무도 모르게 된다.

무엇을 믿고 있나 — 숨기지 말 것
-------------------------------
**이 기능은 남의 장비에서 코드를 실행하는 통로다.** 그 믿음의 경계가 어디인지
분명히 적어 둔다.

  믿는 것      https 로 받은 www.shrimp365.kr 의 파일. 곧 **저장소에 쓸 수
               있는 사람**이다(Vercel 이 저장소의 public/ 를 그대로 서빙한다).
  안 믿는 것   회선 중간, 그리고 꾸러미의 **내용과 모양**. 목록에 적힌 해시와
               한 바이트라도 다르면 버리고, 허용한 모양의 파일만 푼다.

**서명은 쓰지 않는다.** 한때 넣었다가 뺐다. 서명이 지켜 주는 것은 "저장소가
털려도 코드를 못 심는다" 하나인데, 그러려면 개인키가 저장소 밖 — 오너의 PC —
에 있어야 하고, 그러면 버전을 낼 수 있는 사람도 그 PC 앞에 앉은 사람뿐이다.
이 저장소는 그렇게 굴러가지 않는다(변경과 배포가 전부 저장소 쪽에서 난다).
키를 저장소나 CI 에 두면 지키려던 대상에게 열쇠를 맡기는 셈이라 아무것도
막지 못한다 — 편하다는 이유로 그렇게 해 두고 "서명이 있으니 안전하다" 고
말하는 것이 가장 나쁘다.

그래서 **GitHub 계정이 곧 신뢰의 경계다.** 거기에 2단계 인증을 걸어 두는 것이
이 장비들의 실질적인 자물쇠다. 거꾸로, 회선 중간에서 바꿔치기하거나 깨진 채
받아 오는 것은 아래 해시 확인이 막는다.

해시가 막지 못하는 것은 목록 자체가 바뀐 경우다(같은 사람이 둘 다 쓸 수 있다).
그 선을 넘은 상대에게는 이 코드가 할 수 있는 것이 없다.

무너지지 않게 한 것
-------------------
적용에 실패하면 이전 버전으로 되돌린다. 수조를 지켜보는 장비가 업데이트 한
번에 먹통이 되는 것은, 구버전으로 도는 것보다 훨씬 나쁘다. 되돌린 꾸러미는
기억해 두었다가 다시 받지 않는다 — 그러지 않으면 나쁜 버전 하나가 전 농장을
매시간 흔든다.

승인 절차가 없는 이유
---------------------
센서 파이는 웹에서 농가가 "업데이트" 를 눌러야 받아 간다. 비전 파이는 그
단계를 두지 않았다 — **목록에 올리는 것 자체가 승인**이다. 단계를 하나 더
두면 서버에 "허용 버전" 을 적는 자리가 생기는데, 그 자리를 쓸 수 있는 사람은
이미 꾸러미도 올릴 수 있는 사람이라 막아 주는 것이 없다.

    sudo python3 updater.py              # 한 번 확인하고 적용
    python3 updater.py --dry-run         # 받아서 확인까지만, 적용 안 함
"""

from __future__ import annotations

import argparse
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
    """꾸러미가 이 이름을 가져도 되는가.

    `fullmatch` 다. `match` 는 `$` 가 말미 개행 앞에서도 맞아 `app/main.py\n`
    같은 이름을 통과시켰다 — 그 이름 그대로 파일이 만들어진다.
    """
    return name in ALLOWED_EXTRA or bool(ALLOWED_PATH.fullmatch(name))


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
        # https 만 받는다. 평문으로 받으면 회선 중간에서 목록과 꾸러미를 함께
        # 바꿔치기할 수 있고, 그러면 해시 확인이 아무것도 보장하지 못한다 —
        # 해시를 적은 쪽도 같은 사람이 되기 때문이다.
        raise ValueError(f"https 주소만 받습니다: {url!r}")
    req = urllib.request.Request(url, headers={"User-Agent": "shrimp365-vision-updater"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 — 위에서 https 확인
        # 상한까지만 읽는다. Content-Length 를 믿지 않는다.
        data = resp.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"꾸러미가 너무 큽니다(> {limit} 바이트)")
    return data


def verify_payload(blob: bytes, entry: dict) -> None:
    """받아 온 꾸러미가 목록에 적힌 그것인지 본다. 어긋나면 예외.

    막아 주는 것은 **중간에서 바뀌거나 깨진 것**이다 — 농장 회선에서 내려받기가
    잘리는 일은 흔하고, 잘린 tar 를 그대로 풀면 반쪽짜리 설치본이 된다.

    막아 주지 **못하는** 것은 목록 자체가 바뀐 경우다. 목록과 꾸러미를 같은
    자리에서 받아 오므로, 거기에 쓸 수 있는 사람은 둘 다 고칠 수 있다. 그
    선은 서명으로만 그을 수 있고, 이 저장소는 그러지 않기로 했다(머리말 참고).
    """
    digest = hashlib.sha256(blob).hexdigest()
    expected = str(entry.get("sha256", "")).lower()
    if not expected:
        raise ValueError("목록에 해시가 없어 받을 수 없습니다")
    if digest != expected:
        raise ValueError(f"해시 불일치 (받은 것 {digest[:12]}…, 기대 {expected[:12]}…)")


def safe_extract(blob: bytes, dest: Path) -> None:
    """꾸러미를 푼다. 허용한 모양의 평범한 파일만 받는다.

    tar 는 경로에 `../` 를 넣거나 심볼릭 링크를 걸어 바깥 파일을 덮어쓰게
    만들 수 있다. 해시가 맞는 꾸러미라도 **모양은 따로 본다** — 해시는 "받아 온
    것이 올린 것과 같다" 만 보장하고, 그 안에 무엇이 들었는지는 말해 주지
    않는다. 서명을 쓰지 않는 구성에서는 이 검사가 주된 방어선이다.
    """
    dest.mkdir(parents=True, exist_ok=True)
    total = 0
    with tempfile.NamedTemporaryFile(suffix=".tar.gz") as tmp:
        tmp.write(blob)
        tmp.flush()
        with tarfile.open(tmp.name, "r:gz") as tar:
            members = []
            for m in tar.getmembers():
                # 이름을 **고쳐서 받지 않는다.** 예전에는 `lstrip("./")` 로
                # 앞의 점과 빗금을 떼어 냈는데, 그것은 문자 집합을 떼는 것이라
                # `..././app/main.py` 가 조용히 `app/main.py` 로 개명되어
                # 들어왔다. /opt 밖으로 나가지는 못했지만, 수상한 이름을
                # 고쳐서 받아들이는 것은 이 파일의 성격에 맞지 않는다.
                name = m.name[2:] if m.name.startswith("./") else m.name
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
    last_detail = "재시작 후 자리를 잡지 못했습니다"
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
                # **한 번 못 받았다고 포기하지 않는다.** Type=simple 이라
                # systemd 는 프로세스를 띄우자마자 "살아 있음" 으로 보지만,
                # uvicorn 은 기동 절차(DB 준비·브로드캐스터·카메라 열기·ONNX
                # 세션 생성)가 끝나기 전에는 응답하지 않는다. 파이 4 에서
                # 차가운 SD 카드로 그 합이 35초를 넘는 일이 흔하고, 예전에는
                # 거기서 **멀쩡한 새 버전을 되돌렸다.** 되돌린 뒤에도 목록의
                # latest 는 그대로라 한 시간 뒤 같은 일이 반복된다.
                last_detail = "서비스는 떴지만 아직 응답하지 않습니다"
        time.sleep(3)
    return False, last_detail


def _skip_pycache(_dir: str, names: list[str]) -> set[str]:
    """바이트코드 캐시는 옮기지 않는다.

    검사 단계의 `py_compile` 이 스테이지 폴더에 `__pycache__` 를 남긴다
    (PYTHONDONTWRITEBYTECODE 는 import 할 때만 듣고 py_compile 은 막지
    못한다). 그대로 두면 설치본까지 실려 가는데, install.sh 와 release.py 는
    둘 다 일부러 빼고 있다 — 업데이트 경로만 규칙이 어긋나 있었다.
    """
    return {n for n in names if n == "__pycache__" or n.endswith(".pyc")}


def _replace_file(src: Path, dst: Path) -> None:
    """파일을 **원자적으로** 갈아 끼운다.

    `shutil.copy2` 는 대상을 그 자리에서 비우고 다시 쓴다. 하필 그 순간
    전원이 나가면 반쯤 잘린 파일이 남는다. 다른 파일이면 다음 차례가
    고쳐 주지만, `deploy/updater.py` 가 잘리면 **그 다음 차례가 없다** —
    고치러 농장에 가야 하고, 그것이 이 기능이 없애려던 일이다.

    옆에 다 쓰고 이름만 바꾼다. 이름 바꾸기는 같은 파일 시스템 안에서
    쪼개지지 않으므로, 어느 순간에 끊겨도 옛것이거나 새것이다.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + ".tmp")
    shutil.copy2(src, tmp)
    os.replace(tmp, dst)


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
        shutil.copytree(src, dst, dirs_exist_ok=not replace_dirs, ignore=_skip_pycache)
    for name in sorted(ALLOWED_EXTRA):
        src = src_root / name
        if not src.is_file():
            continue
        _replace_file(src, dst_root / name)


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
        shutil.copytree(src, incoming, ignore=_skip_pycache)
        if live.exists():
            os.rename(live, retiring)
        os.rename(incoming, live)
        shutil.rmtree(retiring, ignore_errors=True)

    # 낱개 파일도 원자적으로 바꾼다. VERSION 이 뒤에 적히는 것이 중요하다 —
    # 앞서 적고 교체가 실패하면 장비가 자기를 새 버전이라고 믿는다.
    for name in sorted(ALLOWED_EXTRA):
        src = staged / name
        if not src.is_file():
            continue
        _replace_file(src, app_dir / name)


def roll_back(app_dir: Path | None = None, prev_dir: Path | None = None) -> bool:
    app_dir = APP_DIR if app_dir is None else app_dir
    prev_dir = PREV_DIR if prev_dir is None else prev_dir

    # **백업이 온전한지 먼저 본다.** 예전에는 바로 복사했는데, 보관하다가
    # 끊긴 반쪽짜리 백업으로 덮으면 **멀쩡하던 설치본까지 깨진다.** 되돌리기는
    # 마지막 보루라, 그것이 상황을 악화시키면 사람이 가는 수밖에 없다.
    if not prev_dir.is_dir():
        log.error("되돌릴 이전 버전이 없습니다.")
        return False
    if not (prev_dir / "app" / "main.py").is_file():
        log.error("보관해 둔 이전 버전이 온전하지 않습니다 — 덮어쓰지 않습니다.")
        return False
    if not parse_version((prev_dir / "VERSION").read_text(encoding="utf-8").strip()
                         if (prev_dir / "VERSION").is_file() else ""):
        log.error("보관해 둔 이전 버전의 VERSION 을 읽을 수 없습니다 — 덮어쓰지 않습니다.")
        return False

    _copy_managed(prev_dir, app_dir, replace_dirs=True)
    _owner_fix(app_dir)
    subprocess.run(["systemctl", "restart", SERVICE], check=False)
    return True


def _owner_fix(app_dir: Path | None = None) -> None:
    """설치본을 **root 소유·모두 읽기**로 되돌린다.

    서비스 계정(shrimp365)의 소유로 두면 안 된다. 이 트리 안에는 root 로
    실행되는 것이 둘 있다 — 업데이트 타이머가 돌리는 `deploy/updater.py` 와,
    그 업데이터가 검사용으로 실행하는 `.venv/bin/python` 이다. 소유자는
    0644 파일을 고쳐 쓸 수 있으므로, 서비스 쪽에 구멍이 하나 나면 거기서
    root 로 올라서는 길이 생긴다(파이썬은 스크립트가 있는 폴더를 import
    경로에 넣으므로 `deploy/json.py` 하나면 된다).

    서비스는 설치본에 **쓰지 않는다** — 기기 키·워터마크·보정값은 전부
    /var/lib/shrimp365-vision 에 적는다. 그래서 읽기만 있으면 충분하다.
    """
    app_dir = APP_DIR if app_dir is None else app_dir
    subprocess.run(["chown", "-R", "root:video", str(app_dir)], check=False)
    # a+rX — 파일은 읽기, 디렉터리는 들어가기. 실행 비트가 붙어 있던 파일은
    # 그대로 두고 아무 파일에나 새로 붙이지는 않는다(X 는 대문자다).
    subprocess.run(["chmod", "-R", "a+rX", str(app_dir)], check=False)


def apply_update(blob: bytes, version: str, python: Path) -> tuple[str, str]:
    """꾸러미를 적용한다. ("applied" | "rolled_back" | "broken" | "failed", 설명)."""
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
        # 아직 설치본을 건드리지 않았다. 그냥 포기하면 된다.
        return "failed", f"준비 단계 실패: {exc}"

    # ── 2단계: 여기서부터 설치본을 바꾼다 ────────────────────────────────────
    # 도중에 무엇이 잘못되든 반드시 되돌린다. 반쯤 바뀐 상태로 두면 새것도
    # 옛것도 아니게 되고, 그 상태는 사람이 가야만 풀린다.
    try:
        swap_in(STAGE_DIR)
        _owner_fix()
    except Exception as exc:  # noqa: BLE001
        log.error("교체 도중 실패했습니다(%s) — 이전 버전으로 되돌립니다.", exc)
        return _undo(f"교체 실패: {exc}")
    finally:
        shutil.rmtree(STAGE_DIR, ignore_errors=True)

    subprocess.run(["systemctl", "restart", SERVICE], check=False)
    ok, detail = service_healthy()
    if ok:
        return "applied", detail

    log.error("새 버전이 자리를 잡지 못했습니다 — 이전 버전으로 되돌립니다.")
    return _undo(detail)


def _undo(detail: str) -> tuple[str, str]:
    """되돌리고, **실제로 되돌아갔는지** 를 돌려준다.

    예전에는 roll_back() 의 결과를 버렸다. 그래서 백업이 없어 되돌리지 못한
    장비도 화면에 "이전 버전으로 되돌렸습니다" 라고 떴다 — 실제로는 반쯤
    바뀐 채 죽어 있는데. 그 화면이 SSH 없이 상태를 아는 유일한 길이라고 이
    코드가 스스로 말하고 있으므로, 거짓말을 하면 안 된다.
    """
    if roll_back():
        ok, detail2 = service_healthy(wait_seconds=90)
        if ok:
            return "rolled_back", detail
        return "broken", f"{detail} / 되돌린 뒤에도 서비스가 뜨지 않습니다: {detail2}"
    return "broken", f"{detail} / 되돌리지 못했습니다(보관된 이전 버전 없음)"


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


def write_result(
    status: str, version: str, message: str = "",
    *, tried: str | None = None, tried_sha: str | None = None,
) -> None:
    """마지막 결과를 남긴다. 두 가지 일을 한다.

    1. 장비 화면이 읽어 사람에게 보여 준다(SSH 없이 아는 유일한 길).
    2. **다음 실행이 같은 실패를 되풀이하지 않게 한다** — 아래 already_failed.

    적지 못해도 업데이트를 실패로 만들지 않는다.
    """
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        RESULT_PATH.write_text(json.dumps({
            "status": status, "version": version,
            "message": message[:300], "at": int(time.time()),
            "tried": tried, "tried_sha256": tried_sha,
        }, ensure_ascii=False), encoding="utf-8")
    except OSError as exc:
        log.debug("결과를 적지 못했습니다: %s", exc)


def read_result() -> dict:
    try:
        data = json.loads(RESULT_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def already_failed(target: str, sha256: str) -> bool:
    """이 꾸러미는 지난번에 적용했다가 되돌린 것인가.

    없으면 **나쁜 릴리스 하나가 전 농장을 영원히 흔든다.** 1.1.0 이 건강
    확인에 실패해 1.0.0 으로 되돌아가도 목록의 latest 는 그대로 1.1.0 이라,
    한 시간 뒤 타이머가 같은 꾸러미를 다시 받아 다시 적용하고 다시 되돌린다.
    매번 서비스가 두 번 재시작하고 그동안 카메라가 멈춘다. 끝이 없다.

    같은 번호로 **고친 꾸러미를 다시 올리면** 해시가 달라지므로 다시 받는다 —
    버전을 올리지 않고 고치는 길을 막지는 않는다.
    """
    last = read_result()
    if last.get("status") not in {"rolled_back", "broken"}:
        return False
    return last.get("tried") == target and last.get("tried_sha256") == sha256


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

    try:
        manifest = json.loads(_fetch(settings["manifest"], limit=256 * 1024).decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 — 회선 문제면 다음 기회에
        log.info("목록을 받지 못했습니다(%s) — 다음에 다시 시도합니다.", exc)
        return 0

    picked = pick_target(manifest, here)
    if picked is None:
        return 0
    target, entry = picked

    # 지난번에 적용했다가 되돌린 바로 그 꾸러미면 다시 받지 않는다.
    # 없으면 나쁜 릴리스 하나가 매시간 전 농장을 흔든다(already_failed 참고).
    entry_sha = str(entry.get("sha256", "")).lower()
    if already_failed(target, entry_sha):
        log.warning(
            "%s 는 지난번에 적용했다가 되돌렸습니다 — 다시 시도하지 않습니다."
            " 고친 꾸러미를 올리거나 다음 버전을 내세요.", target,
        )
        return 0

    log.info("새 버전 %s 를 받습니다.", target)
    try:
        file_name = str(entry.get("file", ""))
        if "/" in file_name or ".." in file_name or not file_name.endswith(".tar.gz"):
            raise ValueError(f"파일 이름이 이상합니다: {file_name!r}")
        base_url = settings["manifest"].rsplit("/", 1)[0]
        blob = _fetch(f"{base_url}/{file_name}")
        verify_payload(blob, entry)
    except Exception as exc:  # noqa: BLE001 — 검증 실패는 조용히 포기한다
        log.error("업데이트를 거부했습니다: %s", exc)
        write_result("rejected", here, str(exc))
        return 1

    log.info("내려받기 확인 완료(해시 일치).")
    if dry_run:
        log.info("--dry-run 이라 적용하지 않고 끝냅니다.")
        return 0

    python = APP_DIR / ".venv" / "bin" / "python"
    if not python.exists():
        log.error("설치본의 파이썬이 없습니다: %s", python)
        write_result("failed", here, "설치본을 찾을 수 없습니다")
        return 1

    status, detail = apply_update(blob, target, python)
    if status == "applied":
        log.info("업데이트 완료: %s → %s", here, target)
        write_result("applied", target, detail)
        return 0

    # 무엇을 시도하다 실패했는지 함께 적는다 — 다음 실행이 같은 꾸러미를
    # 다시 받지 않게 하는 근거이자, 화면에 띄울 사실이다.
    if status == "rolled_back":
        log.error("업데이트 실패: %s (이전 버전 %s 로 되돌렸습니다)", detail, here)
    elif status == "broken":
        # 가장 나쁜 경우다. 사람이 가야 한다 — 그 사실을 숨기지 않는다.
        log.error("업데이트 실패하고 되돌리지도 못했습니다: %s", detail)
    else:
        log.error("업데이트를 적용하지 못했습니다: %s (설치본은 그대로입니다)", detail)
    write_result(status, here, detail, tried=target, tried_sha=entry_sha)
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
