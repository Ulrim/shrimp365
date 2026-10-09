"""이 장비가 돌고 있는 프로그램의 버전 — **한 곳에서만 정한다.**

왜 파일에서 읽나
----------------
예전에는 네 곳(main·kiosk·camera_manager·sync_service)에 `"1.0.0"` 이 따로
박혀 있었다. 원격 업데이트가 들어오면 그 방식은 바로 깨진다 — 업데이트는
`app/` 의 파일을 바꾸는데, 서버에 보고되는 버전은 장비가 **코드 안에서**
읽은 값이라, 네 곳 중 하나만 어긋나도 화면에 뜨는 버전이 실제와 달라진다.
버전이 틀리면 "이 농장 파이는 올라갔나"를 아무도 믿을 수 없게 되고, 그것이
원격 업데이트에서 가장 먼저 필요한 정보다.

읽는 순서
---------
1. 설치 자리의 `VERSION` 파일 — 업데이터가 적는 자리다. 이것이 정답이다.
2. 없으면 아래 `FALLBACK` — 저장소에서 바로 띄운 개발·시험 환경이다.

pyproject.toml 의 version 과 FALLBACK 은 같아야 한다. 배포 도구
(deploy/release.py) 가 버전을 낼 때 둘 다 올리고, 어긋나 있으면 멈춘다.
"""
from __future__ import annotations

from pathlib import Path

#: 저장소에서 바로 띄웠을 때 쓰는 값. release.py 가 pyproject 와 함께 올린다.
FALLBACK = "1.0.0"


def _read_version_file() -> str | None:
    """설치 자리의 VERSION 파일. `app/` 바로 위에 둔다.

    업데이터가 꾸러미를 풀면서 같은 자리에 적으므로, 설치본과 꾸러미가
    따로 놀 수 없다 — 코드와 버전이 한 번에 바뀐다.
    """
    path = Path(__file__).resolve().parent.parent / "VERSION"
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return text if is_valid(text) else None


def is_valid(text: str) -> bool:
    """`1.2.3` 모양인가. 업데이터와 같은 기준으로 본다.

    아무 문자열이나 받으면 서버에 쓰레기가 올라가고, 버전 비교
    (되감기 막기)도 무너진다.
    """
    parts = text.strip().split(".")
    if len(parts) != 3:
        return False
    try:
        return all(0 <= int(p) <= 999 for p in parts)
    except ValueError:
        return False


VERSION: str = _read_version_file() or FALLBACK
