#!/usr/bin/env python3
"""public/updates 에서 최신 버전만 남기고 정리한다.

release.py build 를 여러 번 돌리면 이전 버전 꾸러미가 쌓인다. 배포한 적 없는
중간 버전을 남겨 두면 목록에는 있는데 체크섬에는 없는 어정쩡한 상태가 되고,
결함이 있는 버전을 누군가 내려받을 수도 있다.

경로를 이 파일 기준으로 잡는다 — 어느 디렉터리에서 실행하든 같게 동작해야 한다.
(상대 경로로 두었다가 raspberry-pi 안에서 실행해 두 번 헛돌았다.)

    python3 raspberry-pi/prune-releases.py          # 최신만 남김
    python3 raspberry-pi/prune-releases.py --keep 3 # 최근 3개 남김
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "updates"


def version_key(text: str) -> tuple:
    try:
        return tuple(int(p) for p in text.split("."))
    except ValueError:
        return (0,)


def main() -> int:
    parser = argparse.ArgumentParser(description="배포 폴더에서 옛 버전 정리")
    parser.add_argument("--keep", type=int, default=1, help="남길 최신 버전 개수 (기본 1)")
    args = parser.parse_args()

    manifest_path = OUT_DIR / "manifest.json"
    if not manifest_path.exists():
        sys.exit(f"목록이 없습니다: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    versions = sorted(manifest.get("releases", {}), key=version_key, reverse=True)
    keep, drop = versions[: args.keep], versions[args.keep :]

    for version in drop:
        entry = manifest["releases"].pop(version)
        for section in (entry, entry.get("setup") or {}):
            name = section.get("file")
            if name:
                target = OUT_DIR / name
                if target.exists():
                    target.unlink()
                    print(f"  지움  {name}")
    manifest["latest"] = keep[0] if keep else None
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # 남은 파일로 체크섬을 다시 쓴다. 목록과 어긋나면 안 된다.
    lines = []
    for path in sorted(OUT_DIR.iterdir()):
        if path.suffix == ".gz":
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            lines.append(f"{digest}  {path.name}\n")
    (OUT_DIR / "SHA256SUMS").write_text("".join(lines), encoding="utf-8")

    print(f"  남김  {', '.join(keep) or '(없음)'}")
    print(f"  파일  {', '.join(sorted(p.name for p in OUT_DIR.iterdir()))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
