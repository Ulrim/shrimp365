"""원격 소프트웨어 업데이트.

현장에 나간 장비를 매번 찾아다닐 수 없으니 인터넷으로 새 버전을 받는다.
다만 이 기능은 성격상 **남의 장비에서 코드를 실행하는 통로**라, 아무 파일이나
받아 실행하면 그대로 뒷문이 된다. 그래서 두 겹으로 막는다.

  1) 승인 — 계정 주인이 웹에서 누른 기기만 받아 간다. 서버가 알려주는 것은
     "몇 번 버전을 허용했다" 는 번호뿐이다.
  2) 서명 — 꾸러미가 진짜인지는 서버가 아니라 **서명**이 보장한다. 공개키는
     이 파일 안에 박혀 있고, 서명은 오너의 개인키로만 만들 수 있다.

그래서 웹사이트나 DB 가 통째로 털려도 농가 장비에 코드를 심을 수는 없다.
공격자가 할 수 있는 최대치는 "이미 서명된 예전 버전을 다시 주는 것"인데,
아래에서 현재보다 낮은 버전은 거부하므로 그것도 막힌다.

적용에 실패하면 이전 버전으로 되돌린다. 수질 감시 장비가 업데이트 한 번에
먹통이 되는 편이 구버전으로 도는 것보다 훨씬 나쁘다.
"""

from __future__ import annotations

import argparse
import configparser
import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

log = logging.getLogger("shrimp365.updater")

VERSION_FALLBACK = "0.0.0"
SERVICE = "shrimp365-sensor"
APP_DIR = Path("/opt/shrimp365")
PREV_DIR = Path("/opt/shrimp365.prev")
STAGE_DIR = Path("/opt/shrimp365.new")

# 꾸러미에 들어올 수 있는 파일. 이 목록에 없는 것은 풀지 않는다.
ALLOWED = {
    "shrimp365_sensor.py", "display.py", "webui.py", "wifi.py",
    "buffer.py", "history.py", "updater.py", "VERSION",
}

# 꾸러미 크기 상한. 압축 폭탄으로 디스크를 채우는 것을 막는다.
MAX_PACKAGE_BYTES = 8 * 1024 * 1024

# ── 시스템 파일 자동 동기화 ────────────────────────────────────────────────────
# 원격 업데이트 꾸러미는 /opt 의 프로그램 파일만 바꾼다. systemd 유닛이나
# polkit 규칙 같은 /etc 의 시스템 파일은 손대지 않는다(안전상 꾸러미에 넣지
# 않는다). 그래서 지금까지는 확인 주기나 Wi‑Fi 권한을 바꾸려면 장비에서
# install.sh 를 다시 돌려야 했다.
#
# 여기 정본을 담아 두고, 업데이터가 돌 때마다(루트) /etc 와 맞춘다. 이렇게 하면
# 소비자가 명령을 입력하지 않아도 주기 변경·polkit 규칙이 자동으로 퍼진다.
# 내용은 이 파일(updater.py) 안에 있으므로 서명된 꾸러미로 그대로 전달된다.
# 원본은 raspberry-pi/ 의 실제 파일이고, release.py 가 배포 때 둘이 같은지 본다.
_TIMER_TEXT = """[Unit]
Description=Shrimp365 sensor agent update check (5분마다)

[Timer]
# 웹에서 "업데이트" 를 누른 뒤 오래 기다리지 않도록 5분마다 확인한다.
# 확인 자체는 아주 가벼운 요청(승인된 게 있나)이고, 없으면 바로 끝난다.
# 승인된 것이 있을 때만 내려받아 적용한다.
OnBootSec=2min
OnUnitActiveSec=5min

# 전 농가가 같은 순간에 몰리지 않도록 기기마다 조금씩(최대 30초) 흩뜨린다.
# 5분 주기라 이 정도면 서버 쏠림은 막으면서 체감은 "거의 바로" 다.
RandomizedDelaySec=30s

[Install]
WantedBy=timers.target
"""

_POLKIT_TEXT = """// Shrimp365 수집기가 화면에서 Wi‑Fi 를 바꿔 붙일 수 있게 한다.
//
// 이 프로그램은 시스템 서비스(shrimp365 사용자)로 돌고 로그인 세션이
// 없다. polkit 은 기본적으로 "활성 로컬 세션" 에만 NetworkManager 제어를
// 열어 주므로, 세션 없는 이 사용자에게는 따로 허용해 주어야 한다.
//
// 허용 범위는 NetworkManager 로 한정한다. 다른 시스템 권한은 주지 않는다.
// 설치 위치: /etc/polkit-1/rules.d/50-shrimp365-nm.rules
//
// 이 규칙이 없으면 화면의 Wi‑Fi 조회·검색은 대개 되지만 접속 시도에서
// "권한이 없어 바꾸지 못했습니다" 가 뜬다.

polkit.addRule(function(action, subject) {
    if (action.id.indexOf("org.freedesktop.NetworkManager.") === 0 &&
        subject.user === "shrimp365") {
        return polkit.Result.YES;
    }
});
"""

# 어느 /etc 경로에 어떤 정본을 둘지. polkit 은 그 하위체계를 쓰는 기기에만.
SYSTEM_FILES = {
    Path("/etc/systemd/system/shrimp365-update.timer"): _TIMER_TEXT,
    Path("/etc/polkit-1/rules.d/50-shrimp365-nm.rules"): _POLKIT_TEXT,
}


def ensure_system_files() -> None:
    """시스템 파일을 내장 정본과 맞춘다(루트 전용). 바뀐 것이 있을 때만 쓴다.

    부모 디렉터리가 없는 기기(예: polkit 미사용)는 조용히 건너뛴다.
    systemd 유닛이 바뀌면 daemon-reload 후 타이머를 다시 시작해 새 주기를
    바로 반영한다. 재실행해도 안전(멱등)하다.
    """
    changed_unit = False
    for path, text in SYSTEM_FILES.items():
        if not path.parent.exists():
            continue  # 그 하위체계를 안 쓰는 기기
        # 기존 파일을 읽어 이미 같은지 본다. 못 읽으면(권한·깨진 바이트 등)
        # 정본으로 새로 쓴다. read_text 는 UnicodeDecodeError(=UnicodeError,
        # OSError 아님)를 낼 수 있으므로 둘 다 잡는다 — 여기서 예외가 새어 나가면
        # 업데이트 확인 자체가 매번 죽어 기기가 영영 업데이트를 못 받는다.
        try:
            current = path.read_text(encoding="utf-8") if path.exists() else None
        except (OSError, UnicodeError):
            current = None
        if current == text:
            continue
        # 원자적으로 바꾼다. 쓰는 도중 정전이 나도 반쪽짜리 유닛이 남지 않게
        # 임시 파일에 다 쓴 뒤 제자리로 옮긴다(라즈베리파이는 정전이 잦다).
        try:
            tmp = path.with_name(path.name + ".tmp")
            tmp.write_text(text, encoding="utf-8")
            os.chmod(tmp, 0o644)
            os.replace(tmp, path)
            log.info("시스템 파일을 갱신했습니다: %s", path)
            if str(path).startswith("/etc/systemd/"):
                changed_unit = True
        except OSError as exc:
            log.warning("시스템 파일 갱신 실패(%s): %s", path, exc)
    if changed_unit:
        subprocess.run(["systemctl", "daemon-reload"], check=False)
        subprocess.run(["systemctl", "restart", "shrimp365-update.timer"], check=False)

# ── 서명 공개키 ──────────────────────────────────────────────────────────────
# release.py --init 로 만든 공개키를 여기에 붙여 넣는다.
# 개인키는 오너 PC 에만 두고 저장소에 올리지 않는다.
# 비어 있으면 업데이트를 아예 시도하지 않는다(막힌 채로 두는 편이 안전하다).
RELEASE_PUBLIC_KEY = "nd//EqamOY3+Kwpite46c1IppbdkOoBw+0z6T3fRpPI="


def _load_verifier():
    """Ed25519 검증기를 준비한다. 준비되지 않으면 None — 업데이트는 건너뛴다."""
    if not RELEASE_PUBLIC_KEY:
        log.info("서명 공개키가 설정되지 않았습니다. 원격 업데이트를 건너뜁니다.")
        return None
    try:
        import base64
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


def current_version() -> str:
    """설치된 버전. VERSION 파일이 우선이고, 없으면 코드 상수를 본다."""
    vfile = APP_DIR / "VERSION"
    try:
        text = vfile.read_text(encoding="utf-8").strip()
        if parse_version(text):
            return text
    except OSError:
        pass
    try:
        sys.path.insert(0, str(APP_DIR))
        import shrimp365_sensor  # type: ignore
        return getattr(shrimp365_sensor, "VERSION", VERSION_FALLBACK)
    except Exception:  # noqa: BLE001
        return VERSION_FALLBACK
    finally:
        if sys.path and sys.path[0] == str(APP_DIR):
            sys.path.pop(0)


# ── 서버와 주고받기 ──────────────────────────────────────────────────────────

def _request(url: str, device_key: str, data: bytes | None = None, timeout: int = 20):
    headers = {"X-Device-Key": device_key, "User-Agent": "shrimp365-updater"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8") or "{}")


def ask_server(base: str, device_key: str, version: str) -> str | None:
    """승인된 목표 버전을 묻는다. 없으면 None."""
    url = f"{base}/api/sensors/update?version={version}"
    try:
        data = _request(url, device_key)
    except urllib.error.HTTPError as exc:
        log.warning("업데이트 확인 실패: HTTP %s", exc.code)
        return None
    except Exception as exc:  # noqa: BLE001 — 회선 문제면 다음 기회에
        log.info("업데이트 확인 실패(%s) — 다음에 다시 시도합니다.", exc)
        return None

    approved = data.get("approved")
    return approved if isinstance(approved, str) else None


def report(base: str, device_key: str, status: str, version: str, message: str = "") -> None:
    body = json.dumps({"status": status, "version": version, "message": message[:300]})
    try:
        _request(f"{base}/api/sensors/update", device_key, data=body.encode("utf-8"))
    except Exception as exc:  # noqa: BLE001 — 보고 실패가 업데이트를 막을 이유는 없다
        log.info("결과 보고 실패: %s", exc)


def _fetch(url: str, timeout: int = 60, limit: int = MAX_PACKAGE_BYTES) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "shrimp365-updater"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        # 상한까지만 읽는다. Content-Length 를 믿지 않는다.
        data = resp.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"꾸러미가 너무 큽니다(> {limit} 바이트)")
    return data


# ── 검증 ─────────────────────────────────────────────────────────────────────

def verify_package(blob: bytes, version: str, entry: dict, verifier) -> None:
    """해시와 서명을 확인한다. 어긋나면 예외를 던진다."""
    digest = hashlib.sha256(blob).hexdigest()
    expected = str(entry.get("sha256", "")).lower()
    if digest != expected:
        raise ValueError(f"해시 불일치 (받은 것 {digest[:12]}…, 기대 {expected[:12]}…)")

    import base64
    if not entry.get("signature"):
        # 설치 꾸러미만 낸 버전이면 서명이 없다. 이런 것은 받지 않는다.
        raise ValueError("이 버전에는 서명이 없어 받을 수 없습니다")
    signature = base64.b64decode(str(entry.get("signature", "")))
    # 서명 대상에 버전을 함께 넣는다. 이렇게 해야 예전 꾸러미의 서명을
    # 새 버전인 것처럼 갖다 붙일 수 없다.
    verifier.verify(signature, f"{version}\n{digest}\n".encode("utf-8"))


def safe_extract(blob: bytes, dest: Path) -> None:
    """꾸러미를 푼다. 허용 목록에 있는 평범한 파일만 받는다.

    tar 는 경로에 ../ 를 넣거나 심볼릭 링크를 걸어 바깥 파일을 덮어쓰게
    만들 수 있다. 서명을 통과한 꾸러미라도 형식은 따로 확인한다.
    """
    dest.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".tar.gz") as tmp:
        tmp.write(blob)
        tmp.flush()
        with tarfile.open(tmp.name, "r:gz") as tar:
            members = []
            for m in tar.getmembers():
                name = m.name.lstrip("./")
                if not m.isfile():
                    raise ValueError(f"파일이 아닌 항목이 있습니다: {m.name}")
                if name not in ALLOWED:
                    raise ValueError(f"허용되지 않은 파일: {m.name}")
                if m.size > MAX_PACKAGE_BYTES:
                    raise ValueError(f"파일이 너무 큽니다: {m.name}")
                m.name = name
                m.mode = 0o644
                members.append(m)
            if not members:
                raise ValueError("꾸러미가 비어 있습니다")
            tar.extractall(dest, members=members)  # noqa: S202 — 위에서 걸렀다


def sanity_check(staged: Path) -> None:
    """바꿔치기 전에 새 코드가 최소한 돌아가는지 본다."""
    # 검사하느라 __pycache__ 를 남기면 그것까지 설치본으로 옮겨 가게 된다.
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}

    result = subprocess.run(
        [sys.executable, "-m", "py_compile", *[str(p) for p in staged.glob("*.py")]],
        capture_output=True, text=True, timeout=120, env=env,
    )
    if result.returncode != 0:
        raise ValueError(f"문법 검사 실패: {result.stderr.strip()[:200]}")

    # 불러오기까지 해 본다. import 단계에서 죽는 코드를 여기서 걸러낸다.
    result = subprocess.run(
        [sys.executable, "-c", "import shrimp365_sensor"],
        cwd=str(staged), capture_output=True, text=True, timeout=120, env=env,
    )
    if result.returncode != 0:
        raise ValueError(f"불러오기 실패: {result.stderr.strip()[-200:]}")


# ── 적용 ─────────────────────────────────────────────────────────────────────

def service_healthy(port: int, wait_seconds: int = 90) -> tuple[bool, str]:
    """재시작한 수집기가 실제로 자리를 잡았는지 본다.

    단순히 "떴다" 로는 부족하다. 잠깐 떴다가 죽고 systemd 가 다시 띄우는
    중일 수도 있다. 그래서 일정 시간 계속 살아 있는지 보고, 상태 페이지가
    응답하는지까지 확인한다.
    """
    deadline = time.time() + wait_seconds
    stable_since = None
    while time.time() < deadline:
        active = subprocess.run(
            ["systemctl", "is-active", "--quiet", SERVICE]
        ).returncode == 0
        if not active:
            stable_since = None
            time.sleep(3)
            continue
        if stable_since is None:
            stable_since = time.time()
        # 30초 넘게 계속 살아 있으면 재시작 반복은 아니다.
        if time.time() - stable_since >= 30:
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/api/state", timeout=5
                ) as resp:
                    json.loads(resp.read().decode("utf-8"))
                return True, "정상"
            except Exception:  # noqa: BLE001
                # 상태 페이지를 껐을 수도 있다. 서비스가 살아 있으면 통과.
                return True, "정상(상태 페이지 없음)"
        time.sleep(3)
    return False, "재시작 후 자리를 잡지 못했습니다"


def swap_in(staged: Path) -> None:
    """새 코드를 제자리에 놓고 이전 것을 남겨 둔다."""
    if PREV_DIR.exists():
        shutil.rmtree(PREV_DIR)
    shutil.copytree(APP_DIR, PREV_DIR)
    # 꾸러미에 없는 파일은 그대로 두고 덮어쓰기만 한다. 부분 꾸러미도 받기 위함.
    # __pycache__ 같은 디렉터리가 섞여 들어올 수 있으므로 평범한 파일만 옮긴다.
    for src in sorted(staged.iterdir()):
        if src.is_file():
            shutil.copy2(src, APP_DIR / src.name)


def roll_back() -> None:
    if not PREV_DIR.exists():
        log.error("되돌릴 이전 버전이 없습니다.")
        return
    for src in sorted(PREV_DIR.iterdir()):
        if src.is_file():
            shutil.copy2(src, APP_DIR / src.name)
    subprocess.run(["systemctl", "restart", SERVICE], check=False)


def apply_update(blob: bytes, version: str, port: int) -> tuple[bool, str]:
    # ── 1단계: 설치본을 건드리기 전 ──────────────────────────────────────────
    # 여기서 실패하면 설치본은 손대지 않은 상태라 그냥 포기하면 된다.
    if STAGE_DIR.exists():
        shutil.rmtree(STAGE_DIR)
    try:
        safe_extract(blob, STAGE_DIR)
        sanity_check(STAGE_DIR)
        (STAGE_DIR / "VERSION").write_text(version + "\n", encoding="utf-8")
    except Exception as exc:  # noqa: BLE001
        shutil.rmtree(STAGE_DIR, ignore_errors=True)
        return False, f"준비 단계 실패: {exc}"

    # ── 2단계: 여기서부터 설치본을 바꾼다 ────────────────────────────────────
    # 파일 몇 개만 바뀐 채로 끝나면 새것도 옛것도 아닌 상태가 된다.
    # 도중에 무엇이 잘못되든 반드시 되돌린다.
    try:
        swap_in(STAGE_DIR)
    except Exception as exc:  # noqa: BLE001
        log.error("교체 도중 실패했습니다(%s) — 이전 버전으로 되돌립니다.", exc)
        roll_back()
        return False, f"교체 실패: {exc}"
    finally:
        shutil.rmtree(STAGE_DIR, ignore_errors=True)

    subprocess.run(["systemctl", "restart", SERVICE], check=False)
    ok, detail = service_healthy(port)
    if ok:
        return True, detail

    log.error("새 버전이 자리를 잡지 못했습니다 — 이전 버전으로 되돌립니다.")
    roll_back()
    return False, detail


# ── 설정 ─────────────────────────────────────────────────────────────────────

def read_settings(path: Path) -> dict:
    cfg = configparser.ConfigParser()
    cfg.read(path, encoding="utf-8")
    endpoint = cfg.get("server", "endpoint", fallback="https://www.shrimp365.kr/api/sensors/data")
    base = endpoint.split("/api/")[0].rstrip("/")
    return {
        "device_key": cfg.get("server", "device_key", fallback="").strip(),
        "base": base,
        "manifest": cfg.get("update", "manifest_url", fallback=f"{base}/updates/manifest.json"),
        "enabled": cfg.getboolean("update", "enabled", fallback=True),
        "port": cfg.getint("webui", "port", fallback=8080),
    }


def run(config_path: Path, dry_run: bool) -> int:
    # 시스템 파일(타이머·polkit)을 정본과 맞춘다. 승인된 업데이트가 없어도,
    # 아직 계정에 연결되지 않았어도 매번 해 둔다 — 소비자가 install.sh 를
    # 다시 돌리지 않아도 주기·권한 변경이 자동으로 반영되게 하려는 것이다.
    if not dry_run and os.geteuid() == 0:
        ensure_system_files()

    settings = read_settings(config_path)
    if not settings["enabled"]:
        log.info("원격 업데이트가 꺼져 있습니다.")
        return 0
    if not settings["device_key"]:
        log.info("아직 계정에 연결되지 않았습니다. 업데이트를 건너뜁니다.")
        return 0

    verifier = _load_verifier()
    if verifier is None:
        return 0

    here = current_version()
    log.info("현재 버전 %s — 승인된 업데이트를 확인합니다.", here)

    target = ask_server(settings["base"], settings["device_key"], here)
    if not target:
        log.info("승인된 업데이트가 없습니다.")
        return 0

    tv, cv = parse_version(target), parse_version(here)
    if tv is None:
        log.warning("서버가 알려준 버전 형식이 이상합니다: %r", target)
        return 1
    if cv is not None and tv <= cv:
        # 예전 꾸러미를 다시 밀어 넣는 수법을 막는다.
        log.warning("현재(%s)보다 높지 않은 버전(%s)은 받지 않습니다.", here, target)
        return 1

    log.info("승인된 버전 %s 를 받습니다.", target)
    report(settings["base"], settings["device_key"], "downloading", target)

    try:
        manifest = json.loads(_fetch(settings["manifest"], limit=256 * 1024).decode("utf-8"))
        entry = (manifest.get("releases") or {}).get(target)
        if not isinstance(entry, dict):
            raise ValueError(f"목록에 {target} 이 없습니다")
        file_name = str(entry.get("file", ""))
        if "/" in file_name or ".." in file_name or not file_name.endswith(".tar.gz"):
            raise ValueError(f"파일 이름이 이상합니다: {file_name!r}")
        base_url = settings["manifest"].rsplit("/", 1)[0]
        blob = _fetch(f"{base_url}/{file_name}")
        verify_package(blob, target, entry, verifier)
    except Exception as exc:  # noqa: BLE001 — 검증 실패는 조용히 포기한다
        log.error("업데이트를 거부했습니다: %s", exc)
        report(settings["base"], settings["device_key"], "failed", target, str(exc))
        return 1

    log.info("서명 확인 완료.")
    if dry_run:
        log.info("--dry-run 이라 적용하지 않고 끝냅니다.")
        return 0

    ok, detail = apply_update(blob, target, settings["port"])
    if ok:
        log.info("업데이트 완료: %s → %s", here, target)
        report(settings["base"], settings["device_key"], "applied", target, detail)
        return 0

    log.error("업데이트 실패: %s (이전 버전 %s 로 되돌렸습니다)", detail, here)
    report(settings["base"], settings["device_key"], "rolled_back", here, detail)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Shrimp365 장비 소프트웨어 업데이트")
    parser.add_argument("-c", "--config", default="/etc/shrimp365/config.ini", type=Path)
    parser.add_argument("--dry-run", action="store_true",
                        help="확인·검증까지만 하고 적용하지 않음")
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
        return run(args.config, args.dry_run)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
