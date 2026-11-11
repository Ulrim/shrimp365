#!/usr/bin/env python3
"""Roboflow 공개 데이터셋을 YOLOv8 형식으로 내려받아 압축을 푼다.

왜 필요한가. 성적서 수치는 **test 445장**으로 받아야 하고, 그 445장은
`prepare_dataset.py` 가 원본 데이터셋 전체를 다시 섞어 만든다. 즉 일부가 아니라
**원본 전체**가 있어야 한다. shrimp_cf 는 공개(CC BY 4.0)라 키만 있으면 받는다.

    https://universe.roboflow.com/ktteam/shrimp_cf-qffxh

키는 **명령줄에 적지 않는다** — 셸 기록에 남는다. 환경변수로 준다.

    export ROBOFLOW_API_KEY='...'        # Roboflow → Account → Roboflow Keys
    python ai/trainer/fetch_roboflow.py --out data/shrimp_cf

브라우저에서 직접 받아도 된다(Universe → Download Dataset → YOLOv8 → zip).
그 경우 이 스크립트는 필요 없고, 압축을 푼 폴더를 그대로 쓰면 된다.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

API = "https://api.roboflow.com"
UA = "shrimp365-vision/1.1.2"


def _get(url: str, key: str) -> bytes:
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {key}",
        "User-Agent": UA,
    })
    with urllib.request.urlopen(req, timeout=120) as resp:   # noqa: S310
        return resp.read()


def export_link(workspace: str, project: str, version: int, key: str) -> str:
    """내려받기 링크를 얻는다. 응답 모양이 바뀌어도 어디가 틀렸는지 보이게 한다."""
    url = f"{API}/{workspace}/{project}/{version}/yolov8"
    try:
        payload = json.loads(_get(url, key))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:400]
        sys.exit(f"[오류] Roboflow 가 {exc.code} 을 돌려줬습니다.\n{body}\n"
                 "키가 맞는지, 그 키로 이 데이터셋을 볼 수 있는지 확인하세요.")
    except urllib.error.URLError as exc:
        sys.exit(f"[오류] api.roboflow.com 에 닿지 못했습니다: {exc.reason}")

    for path in (("export", "link"), ("export", "zip"), ("link",)):
        node = payload
        for step in path:
            node = node.get(step) if isinstance(node, dict) else None
        if isinstance(node, str) and node.startswith("http"):
            return node
    sys.exit("[오류] 응답에서 내려받기 링크를 찾지 못했습니다. 받은 내용:\n"
             + json.dumps(payload, ensure_ascii=False)[:600]
             + "\n브라우저에서 직접 내려받아 --out 폴더에 풀어 주세요.")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Roboflow YOLOv8 내보내기를 받아 푼다")
    p.add_argument("--workspace", default="ktteam")
    p.add_argument("--project", default="shrimp_cf-qffxh")
    p.add_argument("--version", type=int, default=1)
    p.add_argument("--out", required=True, help="압축을 풀 폴더")
    args = p.parse_args(argv)

    key = os.environ.get("ROBOFLOW_API_KEY", "").strip()
    if not key:
        sys.exit("[오류] ROBOFLOW_API_KEY 가 비어 있습니다.\n"
                 "    export ROBOFLOW_API_KEY='...'   (Roboflow → Account → Roboflow Keys)\n"
                 "키를 명령줄 인자로 주지 마세요 — 셸 기록에 남습니다.")

    out = Path(args.out)
    if (out / "data.yaml").exists():
        print(f"이미 받아 둔 것이 있습니다: {out}")
        return 0

    print(f"{args.workspace}/{args.project} v{args.version} 내려받기 링크를 요청합니다…")
    link = export_link(args.workspace, args.project, args.version, key)
    print("압축 파일을 받는 중…")
    req = urllib.request.Request(link, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=600) as resp:   # noqa: S310
        blob = resp.read()
    print(f"  {len(blob) / 1024 / 1024:.1f} MB")

    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        for name in zf.namelist():          # zip 안의 ../ 를 막는다
            if Path(name).is_absolute() or ".." in Path(name).parts:
                sys.exit(f"[오류] 압축 안에 수상한 경로가 있습니다: {name}")
        zf.extractall(out)

    if not (out / "data.yaml").exists():
        sys.exit(f"[오류] {out} 에 data.yaml 이 없습니다. 내보내기 형식을 확인하세요.")
    counts = {s: len(list((out / s / "images").glob("*")))
              for s in ("train", "valid", "test") if (out / s / "images").is_dir()}
    print(f"풀었습니다: {out}  {counts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
