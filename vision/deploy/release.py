#!/usr/bin/env python3
"""비전 장비의 새 버전을 만들고 서명하는 도구. **오너 PC 에서만** 실행한다.

원격 업데이트의 안전은 전적으로 개인키 관리에 달려 있다. 이 키를 가진 사람은
모든 농장의 카메라 파이에서 원하는 코드를 실행할 수 있다.

    # 처음 한 번 — 열쇠 만들기
    python3 deploy/release.py init

    # 새 버전 낼 때마다
    python3 deploy/release.py build 1.1.0 --notes "수조 사진 밀어 올리기"
    git add public/updates/vision && git commit && git push

배포는 파일을 저장소에 올리는 것으로 끝난다. 웹사이트가 그대로 서빙하고,
장비들이 한 시간 안에 받아 간다.

**개인키는 저장소에 넣지 않는다.** `vision/deploy/secrets/` 는 .gitignore 에
걸려 있다. 한때 센서 파이의 개인키를 저장소에 함께 두었다 — 비공개 저장소를
전제로 한 것이었는데, 공개로 바뀌면서 그대로 노출됐다. 공개된 키는 되돌릴 수
없다(git 기록에 남는다). 그래서 비전 장비는 **센서와 다른 열쇠**를 쓴다.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import io
import json
import re
import sys
import tarfile
from datetime import UTC, datetime
from pathlib import Path

try:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
except ImportError:
    sys.exit("cryptography 가 필요합니다:  pip install cryptography")

HERE = Path(__file__).resolve().parent          # vision/deploy
VISION = HERE.parent                            # vision
REPO = VISION.parent                            # 저장소 뿌리
OUT_DIR = REPO / "public" / "updates" / "vision"
KEY_PATH = HERE / "secrets" / "release-key.pem"
UPDATER = HERE / "updater.py"

#: 꾸러미에 담을 것. 업데이터의 허용 규칙(ALLOWED_PATH·ALLOWED_EXTRA)과
#: 짝이 맞아야 한다 — 어긋나면 현장 장비가 꾸러미 **전체**를 거부한다.
#:
#: 모델(.onnx)은 넣지 않는다. 6 MB 가 넘어 농장 회선에 부담이고, 코드와 달리
#: 자주 바뀌지 않는다. 모델을 바꿀 때는 사람이 간다.
#: `deploy/updater.py` 가 들어 있는 것이 중요하다 — 업데이터가 자기 자신을
#: 고칠 수 있어야 한다. 없으면 업데이터에 결함이 하나 나오는 순간 모든 농장에
#: 사람이 가야 하고, 그것이 이 기능이 없애려던 일이다.
EXTRA_FILES = ["VERSION", "pyproject.toml", "deploy/updater.py"]


def iter_payload() -> list[Path]:
    """app/ 아래의 파이썬 파일 전부(캐시 제외), 경로 순으로."""
    files = [
        p for p in sorted(VISION.glob("app/**/*.py"))
        if "__pycache__" not in p.parts
    ]
    if not files:
        sys.exit("app/ 에서 파이썬 파일을 찾지 못했습니다. vision/ 안에서 실행하세요.")
    return files


# ── 열쇠 ─────────────────────────────────────────────────────────────────────

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
    print("이 키는 이 PC 에만 있습니다 — 저장소에 올라가지 않습니다(.gitignore).")
    print("백업해 두세요. 잃으면 현장 장비는 더 이상 새 업데이트를 받지 못합니다")
    print("(개체수 측정은 그대로 계속됩니다). 다시 만들려면 모든 장비가 한 번은")
    print("사람 손을 거쳐야 합니다.")
    print()
    print("아래 한 줄을 vision/deploy/updater.py 의 RELEASE_PUBLIC_KEY 에 넣으세요.")
    print()
    print(f'RELEASE_PUBLIC_KEY = "{pub}"')
    return 0


def load_private() -> Ed25519PrivateKey:
    if not KEY_PATH.exists():
        sys.exit("열쇠가 없습니다. 먼저 실행하세요:  python3 deploy/release.py init")
    key = serialization.load_pem_private_key(KEY_PATH.read_bytes(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        sys.exit("열쇠 형식이 Ed25519 가 아닙니다.")
    return key


def check_pubkey_matches(private: Ed25519PrivateKey) -> None:
    """updater.py 에 박힌 공개키가 이 개인키의 짝인지 본다.

    어긋난 채로 배포하면 **모든 장비가 꾸러미를 거부한다.** 배포한 사람은
    올렸다고 생각하고, 장비는 조용히 옛 버전으로 돈다 — 알아채기까지 한참
    걸리는 종류의 사고다. 여기서 멈추는 편이 낫다.
    """
    pub = base64.b64encode(private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )).decode()
    text = UPDATER.read_text(encoding="utf-8")
    match = re.search(r'^RELEASE_PUBLIC_KEY\s*=\s*"([^"]*)"', text, re.MULTILINE)
    if match is None:
        sys.exit("updater.py 에서 RELEASE_PUBLIC_KEY 를 찾지 못했습니다.")
    embedded = match.group(1)
    if not embedded:
        sys.exit(
            "updater.py 의 RELEASE_PUBLIC_KEY 가 비어 있습니다.\n"
            f"아래 한 줄을 넣고 다시 실행하세요:\n\n"
            f'    RELEASE_PUBLIC_KEY = "{pub}"\n'
        )
    if embedded != pub:
        sys.exit(
            "updater.py 의 공개키가 이 개인키의 짝이 아닙니다.\n"
            "이대로 내면 현장 장비가 꾸러미를 전부 거부합니다.\n\n"
            f"  박혀 있는 것: {embedded}\n"
            f"  이 개인키   : {pub}\n"
        )


# ── 버전 ─────────────────────────────────────────────────────────────────────

def check_version(version: str) -> None:
    if not re.fullmatch(r"\d{1,3}\.\d{1,3}\.\d{1,3}", version):
        sys.exit(f"버전은 1.2.3 모양이어야 합니다: {version!r}")


def bump_source_version(version: str) -> None:
    """VERSION·pyproject.toml·app/version.py 를 한꺼번에 맞춘다.

    세 곳이 어긋나면 장비가 보고하는 버전과 실제가 달라진다. 배포할 때 손으로
    맞추게 두면 언젠가 하나를 빠뜨린다.
    """
    (VISION / "VERSION").write_text(version + "\n", encoding="utf-8")

    pyproject = VISION / "pyproject.toml"
    text = pyproject.read_text(encoding="utf-8")
    new, count = re.subn(r'^version\s*=\s*"[^"]*"', f'version = "{version}"',
                         text, count=1, flags=re.MULTILINE)
    if count != 1:
        sys.exit("pyproject.toml 에서 version 줄을 찾지 못했습니다.")
    pyproject.write_text(new, encoding="utf-8")

    vpy = VISION / "app" / "version.py"
    text = vpy.read_text(encoding="utf-8")
    new, count = re.subn(r'^FALLBACK\s*=\s*"[^"]*"', f'FALLBACK = "{version}"',
                         text, count=1, flags=re.MULTILINE)
    if count != 1:
        sys.exit("app/version.py 에서 FALLBACK 줄을 찾지 못했습니다.")
    vpy.write_text(new, encoding="utf-8")


def check_payload_allowed(names: list[str]) -> None:
    """현장 장비가 받아 줄 모양인지 미리 본다.

    꾸러미를 검사하는 것은 **장비가 지금 가진 updater.py** 다. 여기서 같은
    규칙으로 먼저 보면, 받아 주지 않을 꾸러미를 내보내는 일을 막을 수 있다.
    """
    sys.path.insert(0, str(HERE))
    try:
        import updater  # type: ignore
    finally:
        sys.path.pop(0)
    bad = [n for n in names if not updater.allowed_path(n)]
    if bad:
        sys.exit(
            "업데이터가 받아 주지 않는 경로가 있습니다:\n  "
            + "\n  ".join(bad)
            + "\n\nupdater.py 의 ALLOWED_PATH 를 먼저 넓히고, 그 updater 가 깔린"
              " 장비에만 배포하세요."
        )


# ── 꾸러미 ───────────────────────────────────────────────────────────────────

def check_size(blob: bytes, unpacked: bytes) -> None:
    """현장 장비가 받아 줄 크기인지 본다.

    넘기면 **모든 장비가 "꾸러미가 너무 큽니다" 로 거부**하는데, 배포한
    사람은 올렸다고 생각한다. 그 어긋남은 한참 뒤에야 드러난다.
    """
    sys.path.insert(0, str(HERE))
    try:
        import updater  # type: ignore
    finally:
        sys.path.pop(0)
    if len(blob) > updater.MAX_PACKAGE_BYTES:
        sys.exit(f"꾸러미가 너무 큽니다({len(blob):,} > {updater.MAX_PACKAGE_BYTES:,} 바이트). "
                 "장비가 거부합니다 — 넣을 것을 줄이거나 updater 의 상한을 먼저 올리세요.")
    if len(unpacked) > updater.MAX_UNPACKED_BYTES:
        sys.exit(f"푼 크기가 너무 큽니다"
                 f"({len(unpacked):,} > {updater.MAX_UNPACKED_BYTES:,} 바이트).")


def cmd_build(args) -> int:
    version = args.version
    check_version(version)
    private = load_private()
    check_pubkey_matches(private)

    bump_source_version(version)

    payload = iter_payload()
    names = [str(p.relative_to(VISION)) for p in payload] + EXTRA_FILES
    check_payload_allowed(names)

    # 같은 소스에서 같은 바이트가 나오게 한다. 시각·소유자·권한을 고정하지
    # 않으면 빌드할 때마다 해시가 달라져, 꾸러미가 진짜 바뀐 것인지 알 수 없다.
    def reset(info: tarfile.TarInfo) -> tarfile.TarInfo:
        info.uid = info.gid = 0
        info.uname = info.gname = ""
        info.mtime = 0
        info.mode = 0o644
        return info

    # tar 를 먼저 만들고, 압축은 따로 건다.
    #
    # `tarfile.open(mode="w:gz")` 는 gzip 머리말에 **지금 시각**을 적는다. 그래서
    # 같은 소스로 두 번 만들어도 바이트가 달라지고, 해시도 달라진다. 그러면
    # "올라가 있는 꾸러미가 이 소스에서 나온 것이 맞나" 를 확인할 길이 없다 —
    # 서명이 지켜 주는 것은 "오너가 만들었다" 까지고, 무엇으로 만들었는지는
    # 아니다. mtime=0 으로 직접 압축해 둘을 모두 고정한다.
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w") as tar:
        for path in payload:
            tar.add(path, arcname=str(path.relative_to(VISION)), filter=reset)
        for extra in EXTRA_FILES:
            src = VISION / extra
            if not src.is_file():
                sys.exit(f"꾸러미에 넣을 파일이 없습니다: {extra}")
            tar.add(src, arcname=extra, filter=reset)

    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=9, mtime=0) as gz:
        gz.write(raw.getvalue())
    blob = buf.getvalue()

    digest = hashlib.sha256(blob).hexdigest()
    # 서명 대상에 버전을 함께 넣는다 — updater.verify_package 와 같은 모양.
    signature = base64.b64encode(
        private.sign(f"{version}\n{digest}\n".encode())
    ).decode()

    check_size(blob, raw.getvalue())

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    name = f"shrimp365-vision-{version}.tar.gz"
    (OUT_DIR / name).write_bytes(blob)

    manifest_path = OUT_DIR / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        manifest = {"latest": version, "releases": {}}
    manifest.setdefault("releases", {})[version] = {
        "file": name,
        "sha256": digest,
        "size": len(blob),
        "signature": signature,
        "notes": args.notes,
        "released_at": datetime.now(UTC).strftime("%Y-%m-%d"),
    }
    # latest 는 **가장 높은 버전**으로 둔다. 되돌리려고 낮은 번호를 다시 내도
    # 장비는 어차피 받지 않으므로(되감기 방지), 여기서도 올리지 않는다.
    # 버전 모양이 아닌 키가 섞여 있어도 터지지 않는다. 여기서 예외가 나면
    # tar.gz 는 이미 써졌고 소스 버전도 올라간 뒤라 어중간한 상태가 남는다.
    numbered = [v for v in manifest["releases"] if re.fullmatch(r"\d{1,3}(\.\d{1,3}){2}", v)]
    if not numbered:
        sys.exit("목록에 쓸 수 있는 버전이 없습니다 — manifest.json 을 확인하세요.")
    manifest["latest"] = max(numbered, key=lambda v: tuple(int(x) for x in v.split(".")))
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    print(f"꾸러미: public/updates/vision/{name}  ({len(blob):,} 바이트)")
    print(f"해시  : {digest}")
    print(f"최신  : {manifest['latest']}")
    print()
    print("이제 저장소에 올리면 장비들이 받아 갑니다:")
    print("  git add public/updates/vision vision/VERSION vision/pyproject.toml \\")
    print("          vision/app/version.py")
    print(f'  git commit -m "비전 장비 {version} 배포"')
    print("  git push")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Shrimp365 비전 장비 배포 도구")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_init = sub.add_parser("init", help="서명 열쇠 만들기(처음 한 번)")
    p_init.add_argument("--force", action="store_true", help="기존 열쇠를 덮어씀")
    p_init.set_defaults(func=cmd_init)

    p_build = sub.add_parser("build", help="새 버전 꾸러미를 만들고 서명")
    p_build.add_argument("version", help="예: 1.1.0")
    p_build.add_argument("--notes", default="", help="변경 내용 한 줄")
    p_build.set_defaults(func=cmd_build)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
