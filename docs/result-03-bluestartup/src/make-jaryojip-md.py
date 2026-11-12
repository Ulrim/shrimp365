#!/usr/bin/env python3
"""자료집 마크다운을 만든다 — 그림 목록은 build-pdf.mjs 에서 읽어 온다.

왜 읽어 오나. 그림 13장과 캡션은 `build-pdf.mjs` 안에 있다. 한글 파일을 만들려고
그 목록을 여기 다시 적으면, 한쪽만 고쳤을 때 PDF 와 한글 문서가 서로 다른 말을
하게 된다. 목록은 한 곳에 둔다.

    python docs/result-03-bluestartup/src/make-jaryojip-md.py -o out/자료집.md
    python scripts/md-to-hwpx.py out/자료집.md -o out/자료집.hwpx
"""
from __future__ import annotations

import argparse
import os
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = HERE.parent

ENTRY = re.compile(r'\[\s*"([^"]+)",\s*"([^"]+)",\s*\n?\s*"([^"]+)"\s*\]', re.S)


def group(source: str, name: str) -> list[tuple[str, str, str]]:
    m = re.search(rf"const {name} = \[(.*?)\n\]", source, re.S)
    if not m:
        raise SystemExit(f"[오류] build-pdf.mjs 에서 {name} 를 찾지 못했습니다.")
    return ENTRY.findall(m.group(1))


def readme_section(title: str) -> str:
    text = (BASE / "README.md").read_text(encoding="utf-8")
    start = text.find(f"## {title}")
    if start < 0:
        return ""
    nxt = text.find("\n## ", start + 1)
    return text[start:nxt if nxt > 0 else len(text)].rstrip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", required=True)
    args = ap.parse_args()

    # 그림 경로는 **만들어지는 .md 위치 기준**으로 계산한다. 경로를 박아 두면
    # 다른 폴더에 만들 때 조용히 깨져 그림 없는 문서가 나온다.
    out_dir = Path(args.out).resolve().parent
    assets = os.path.relpath(BASE / "assets", out_dir).replace(os.sep, "/")

    src = (HERE / "build-pdf.mjs").read_text(encoding="utf-8")
    out: list[str] = [
        "# 03 블루스타트업 — 결과보고서 자료집",
        "",
        "**과제** 수중 카메라 AI 를 이용한 양식 개체수·성장 계측 (종료 2026. 11. 30.)",
        "",
        "**대상 저장소** `ulrim/shrimp365` — 비전 서비스 `vision/`, 웹 `/vision`",
        "",
        "그림은 모두 **실제로 돌아가는 화면**에서 떴고, 수치는 실행 기록에서 나왔다.",
        "시안을 그려 넣지 않는다 — 그리는 순간 실물과 어긋나고, 점검위원이 화면을",
        "열어 보면 다른 그림이 나온다.",
        "",
        "---",
        "",
    ]

    for heading, name in (("1. 설계·구조", "DIAGRAMS"),
                          ("2. 웹 화면 (shrimp365.kr /vision)", "WEB"),
                          ("3. 현장 장비 화면 (7인치 터치스크린)", "DEVICE")):
        out += [f"## {heading}", ""]
        for file, title, caption in group(src, name):
            out += [f"![{title} — {caption}]({assets}/{file})", ""]
        out += ["---", ""]

    out += ["## 4. 시험 결과", "",
            "| 무엇을 | 결과 | 내용 |", "|---|---|---|"]
    for _file, what, result, detail in re.findall(
            r'\[\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*\n?\s*"([^"]+)"\s*\]', src, re.S):
        out.append(f"| {what} | {result} | {detail} |")
    out += ["", "증빙 원문은 `docs/result-03-bluestartup/evidence/` 에 있다.", "",
            "---", ""]

    limits = readme_section("4. 아직 증빙이 안 되는 것 — 보고서에 쓰기 전에 읽을 것")
    if limits:
        out += [limits.replace("## 4.", "## 5.", 1), ""]

    dest = Path(args.out)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text("\n".join(out), encoding="utf-8")
    print(f"만들었습니다: {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
