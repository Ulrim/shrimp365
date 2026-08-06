"""새 장비 버전을 만들고 서명하는 도구. **오너 PC 에서만** 실행한다.

원격 업데이트의 안전은 전적으로 개인키가 오너에게만 있다는 데 달려 있다.
개인키가 새어 나가면 그 순간부터 누구든 농가 장비에 코드를 심을 수 있다.
그래서 이 파일은 개인키를 저장소에 쓰지 않고, 홈 디렉터리에 600 으로 둔다.

    # 처음 한 번 — 열쇠 만들기
    python3 release.py init

    # 새 버전 낼 때마다
    python3 release.py build 1.1.0
    git add public/updates && git commit && git push

배포는 파일을 저장소에 올리는 것으로 끝난다. 웹사이트가 그대로 서빙한다.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import tarfile
import time
from pathlib import Path

try:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PrivateKey, Ed25519PublicKey,
    )
except ImportError:
    sys.exit("cryptography 가 필요합니다:  pip install cryptography")

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
OUT_DIR = REPO / "public" / "updates"
KEY_PATH = Path.home() / ".shrimp365" / "release-key.pem"

# 업데이트 꾸러미에 담을 파일. updater.py 의 허용 목록과 같아야 한다.
# 이미 설치된 장비의 코드만 바꾸는 것이므로 프로그램 파일만 들어간다.
PAYLOAD = [
    "shrimp365_sensor.py", "display.py", "webui.py",
    "buffer.py", "history.py", "updater.py",
]

# 설치 꾸러미에 담을 파일. 빈 라즈베리파이에 처음 설치할 때 필요한 전부다.
# 저장소를 받지 않고도(토큰·브랜치 지정 없이) 설치할 수 있게 하려는 것이다.
SETUP_PAYLOAD = PAYLOAD + [
    "install.sh", "setup-kiosk.sh", "config.example.ini",
    "shrimp365-sensor.service", "shrimp365-update.service", "shrimp365-update.timer",
    "requirements.txt", "README.md", "INSTALL.md",
]

# 풀었을 때 이 폴더가 생긴다. 홈 디렉터리에 파일이 흩어지지 않게 한다.
SETUP_DIR_NAME = "shrimp365-setup"

# 실행 권한이 필요한 파일. USB·Windows 를 거치면 권한이 날아가는데,
# tar 안에 넣어 두면 풀자마자 바로 실행할 수 있다.
EXECUTABLE = {"install.sh", "setup-kiosk.sh"}


def cmd_init(args) -> int:
    if KEY_PATH.exists() and not args.force:
        print(f"이미 열쇠가 있습니다: {KEY_PATH}")
        print("정말 새로 만들려면 --force. 단, 기존 열쇠로 서명한 꾸러미는")
        print("현장 장비가 더 이상 받아들이지 않게 됩니다.")
        return 1

    KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    private = Ed25519PrivateKey.generate()
    KEY_PATH.write_bytes(private.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ))
    KEY_PATH.chmod(0o600)

    pub = base64.b64encode(private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )).decode()

    print(f"개인키를 만들었습니다: {KEY_PATH}  (권한 600)")
    print()
    print("이 PC 밖으로 내보내지 마세요. 저장소에도 올리지 마세요.")
    print("PC 를 바꾸실 거면 이 파일을 안전하게 옮기시고, 잃어버리면")
    print("현장 장비들은 더 이상 새 업데이트를 받지 못합니다(측정은 계속됩니다).")
    print()
    print("아래 공개키를 raspberry-pi/updater.py 의 RELEASE_PUBLIC_KEY 에 붙여 넣으세요.")
    print()
    print(f'RELEASE_PUBLIC_KEY = "{pub}"')
    return 0


def load_private() -> Ed25519PrivateKey:
    if not KEY_PATH.exists():
        sys.exit(f"열쇠가 없습니다. 먼저 실행하세요:  python3 {Path(__file__).name} init")
    key = serialization.load_pem_private_key(KEY_PATH.read_bytes(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        sys.exit("열쇠 형식이 Ed25519 가 아닙니다.")
    return key


def check_pubkey_matches(private: Ed25519PrivateKey) -> None:
    """updater.py 에 박힌 공개키가 이 개인키의 짝인지 본다.

    짝이 아니면 서명해 봐야 장비가 거부한다. 배포하고 나서 아는 것보다
    여기서 막는 편이 낫다.
    """
    text = (HERE / "updater.py").read_text(encoding="utf-8")
    marker = 'RELEASE_PUBLIC_KEY = "'
    start = text.find(marker)
    if start < 0:
        sys.exit("updater.py 에서 RELEASE_PUBLIC_KEY 를 찾지 못했습니다.")
    embedded = text[start + len(marker):text.find('"', start + len(marker))]

    mine = base64.b64encode(private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )).decode()

    if not embedded:
        sys.exit("updater.py 의 RELEASE_PUBLIC_KEY 가 비어 있습니다.\n"
                 f"붙여 넣으세요:\n\nRELEASE_PUBLIC_KEY = \"{mine}\"\n")
    if embedded != mine:
        sys.exit("updater.py 의 공개키가 이 개인키의 짝이 아닙니다.\n"
                 "다른 열쇠로 서명하면 현장 장비가 거부합니다.")
    # 짝이 맞는지 실제로 서명·검증까지 해 본다.
    probe = b"shrimp365"
    Ed25519PublicKey.from_public_bytes(base64.b64decode(embedded)).verify(
        private.sign(probe), probe)


def bump_source_version(version: str) -> None:
    """shrimp365_sensor.py 의 VERSION 을 맞춘다. 꾸러미 버전과 어긋나면
    장비가 업데이트 후에도 옛 번호를 보고해 계속 다시 받으려 든다."""
    path = HERE / "shrimp365_sensor.py"
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    for i, line in enumerate(lines):
        if line.startswith("VERSION = "):
            lines[i] = f'VERSION = "{version}"\n'
            path.write_text("".join(lines), encoding="utf-8")
            return
    sys.exit("shrimp365_sensor.py 에서 VERSION 을 찾지 못했습니다.")


def cmd_build(args) -> int:
    version = args.version
    if not all(p.isdigit() and len(p) <= 3 for p in version.split(".")) \
            or version.count(".") != 2:
        sys.exit(f"버전은 1.2.3 형태여야 합니다: {version!r}")

    private = load_private()
    check_pubkey_matches(private)
    bump_source_version(version)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # 같은 입력이면 같은 파일이 나오도록 시각과 소유자를 고정한다.
    # 그래야 "내가 만든 그 꾸러미가 맞나" 를 나중에 다시 확인할 수 있다.
    def reset(info: tarfile.TarInfo) -> tarfile.TarInfo:
        info.uid = info.gid = 0
        info.uname = info.gname = "root"
        info.mtime = 0
        base = info.name.rsplit("/", 1)[-1]
        info.mode = 0o755 if base in EXECUTABLE else 0o644
        return info

    def pack(out: Path, files: list[str], prefix: str = "") -> bytes:
        with tarfile.open(out, "w:gz", compresslevel=9) as tar:
            for fname in files:
                src = HERE / fname
                if not src.exists():
                    sys.exit(f"파일이 없습니다: {src}")
                arc = f"{prefix}/{fname}" if prefix else fname
                tar.add(src, arcname=arc, filter=reset)
        return out.read_bytes()

    def sign(kind: str, digest: str) -> str:
        # 서명 대상에 종류와 버전을 함께 넣는다. 예전 꾸러미의 서명을 새 버전인
        # 것처럼, 또는 설치 꾸러미의 서명을 업데이트용으로 갖다 붙이지 못하게 한다.
        payload = f"{version}\n{digest}\n" if kind == "agent" else f"{kind} {version}\n{digest}\n"
        return base64.b64encode(private.sign(payload.encode("utf-8"))).decode()

    # ── 업데이트 꾸러미 — 이미 설치된 장비가 받아 가는 것 ────────────────────
    agent_name = f"shrimp365-agent-{version}.tar.gz"
    agent_blob = pack(OUT_DIR / agent_name, PAYLOAD)
    agent_digest = hashlib.sha256(agent_blob).hexdigest()

    # ── 설치 꾸러미 — 빈 파이에 처음 설치할 때 받는 것 ───────────────────────
    setup_name = f"shrimp365-setup-{version}.tar.gz"
    setup_blob = pack(OUT_DIR / setup_name, SETUP_PAYLOAD, prefix=SETUP_DIR_NAME)
    setup_digest = hashlib.sha256(setup_blob).hexdigest()
    # 버전을 몰라도 받을 수 있도록 고정 이름으로도 둔다. 현장에서 안내문을
    # 그대로 따라 칠 수 있어야 한다.
    (OUT_DIR / "shrimp365-setup-latest.tar.gz").write_bytes(setup_blob)

    manifest_path = OUT_DIR / "manifest.json"
    manifest = {"latest": None, "releases": {}}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    manifest["releases"][version] = {
        "file": agent_name,
        "sha256": agent_digest,
        "size": len(agent_blob),
        "signature": sign("agent", agent_digest),
        "notes": args.notes or "",
        "released_at": time.strftime("%Y-%m-%d"),
        # 설치 꾸러미는 updater 가 쓰지 않는다. 사람이 받아 확인할 때 쓴다.
        "setup": {
            "file": setup_name,
            "sha256": setup_digest,
            "size": len(setup_blob),
            "signature": sign("setup", setup_digest),
        },
    }
    manifest["latest"] = version
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # 현장에서 sha256sum -c 로 바로 확인할 수 있게 해 둔다.
    (OUT_DIR / "SHA256SUMS").write_text(
        f"{agent_digest}  {agent_name}\n"
        f"{setup_digest}  {setup_name}\n"
        f"{setup_digest}  shrimp365-setup-latest.tar.gz\n", encoding="utf-8")

    print(f"업데이트 꾸러미: public/updates/{agent_name}  ({len(agent_blob):,} 바이트)")
    print(f"설치   꾸러미: public/updates/{setup_name}  ({len(setup_blob):,} 바이트)")
    print(f"                 + shrimp365-setup-latest.tar.gz (같은 내용, 고정 이름)")
    print()
    print("이제 저장소에 올리면 배포됩니다.")
    print("  git add public/updates raspberry-pi/shrimp365_sensor.py")
    print(f"  git commit -m '장비 {version} 배포'")
    print("  git push")
    print()
    print("현장 설치 (토큰·git 불필요):")
    print("  curl -fsSLO https://www.shrimp365.kr/updates/shrimp365-setup-latest.tar.gz")
    print("  tar xzf shrimp365-setup-latest.tar.gz")
    print(f"  cd {SETUP_DIR_NAME} && sudo ./install.sh")
    print()
    print("이미 설치된 장비는 웹의 기기 카드에서 [업데이트] 를 누르면 받아 갑니다.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Shrimp365 장비 버전 배포 도구")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_init = sub.add_parser("init", help="서명 열쇠 만들기 (처음 한 번)")
    p_init.add_argument("--force", action="store_true", help="기존 열쇠를 덮어씀")
    p_init.set_defaults(func=cmd_init)

    p_build = sub.add_parser("build", help="꾸러미를 만들고 서명")
    p_build.add_argument("version", help="예: 1.1.0")
    p_build.add_argument("--notes", default="", help="변경 내용 한 줄")
    p_build.set_defaults(func=cmd_build)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
