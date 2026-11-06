#!/usr/bin/env python3
"""비전 장비의 새 버전을 만든다.

    python3 deploy/release.py build 1.1.0 --notes "수조 사진 밀어 올리기"
    git add public/updates/vision vision/VERSION vision/pyproject.toml \
            vision/app/version.py
    git commit && git push

올리는 것으로 끝이다. Vercel 이 저장소의 `public/` 를 그대로 서빙하고,
현장 장비들이 한 시간 안에 받아 간다.

**서명하지 않는다.** 장비가 믿는 것은 https 로 받은 www.shrimp365.kr 의
파일이고, 그것은 곧 **저장소에 쓸 수 있는 사람**이다. 서명을 넣으려면 개인키가
저장소 밖에 있어야 하는데, 그러면 버전을 낼 수 있는 사람도 그 키를 가진 한
사람뿐이 된다 — 이 저장소는 그렇게 굴러가지 않는다. 키를 저장소나 CI 에 두는
절충은 지키려던 대상에게 열쇠를 맡기는 것이라 아무것도 막지 못한다.

그래서 **GitHub 계정의 2단계 인증이 이 장비들의 실질적인 자물쇠다.**
자세한 것은 deploy/updater.py 머리말.
"""

from __future__ import annotations

import argparse
import contextlib
import gzip
import hashlib
import io
import json
import re
import sys
import tarfile
from datetime import UTC, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent          # vision/deploy
VISION = HERE.parent                            # vision
REPO = VISION.parent                            # 저장소 뿌리
OUT_DIR = REPO / "public" / "updates" / "vision"
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


#: 저장소에 남겨 두는 꾸러미 수.
#:
#: 배포할 때마다 90 KB 쯤이 저장소에 쌓이고, git 은 지워도 기록에서 사라지지
#: 않는다. 장비는 언제나 **최신 하나**로 건너뛰므로 옛 꾸러미는 쓰이지 않는다 —
#: 몇 개만 남기는 것은 "무엇이 올라갔었나" 를 눈으로 보기 위한 것뿐이다.
KEEP_RELEASES = 5


def prune(manifest: dict, keep_name: str) -> None:
    """오래된 꾸러미를 목록과 폴더에서 함께 지운다.

    둘 중 하나만 지우면 어긋난다 — 파일만 지우면 목록이 없는 파일을 가리키고,
    목록만 지우면 아무도 안 쓰는 파일이 남는다.
    """
    releases = manifest.get("releases") or {}
    ordered = sorted(
        (v for v in releases if re.fullmatch(r"\d{1,3}(\.\d{1,3}){2}", v)),
        key=lambda v: tuple(int(x) for x in v.split(".")),
        reverse=True,
    )
    for old_version in ordered[KEEP_RELEASES:]:
        entry = releases.pop(old_version, {})
        file_name = str(entry.get("file", ""))
        # 방금 만든 것은 어떤 경우에도 지우지 않는다.
        if not file_name or file_name == keep_name or "/" in file_name:
            continue
        with contextlib.suppress(OSError):
            (OUT_DIR / file_name).unlink()
        print(f"  오래된 꾸러미 정리: {file_name}")


def cmd_build(args) -> int:
    version = args.version
    check_version(version)
    bump_source_version(version)

    payload = iter_payload()
    names = [str(p.relative_to(VISION)) for p in payload] + EXTRA_FILES
    check_payload_allowed(names)

    # 같은 소스에서 같은 바이트가 나오게 한다. 시각·소유자·권한을 고정하지
    # 않으면 빌드할 때마다 해시가 달라져, 꾸러미가 진짜 바뀐 것인지 알 수 없다.
    # 서명이 없는 구성에서는 이것이 "올라가 있는 것이 이 소스에서 나왔나" 를
    # 확인할 유일한 길이다 — 같은 버전을 다시 빌드해 해시를 맞춰 보면 된다.
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
    # "올라가 있는 꾸러미가 이 소스에서 나온 것이 맞나" 를 확인할 길이 없다.
    # mtime=0 으로 직접 압축해 gzip 머리말의 시각까지 고정한다.
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
    prune(manifest, name)

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

    p_build = sub.add_parser("build", help="새 버전 꾸러미를 만든다")
    p_build.add_argument("version", help="예: 1.1.0")
    p_build.add_argument("--notes", default="", help="변경 내용 한 줄")
    p_build.set_defaults(func=cmd_build)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
