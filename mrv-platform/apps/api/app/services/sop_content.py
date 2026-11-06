"""SOP 정적 콘텐츠 로더 — phase-3.md 2.1절.

SOP 문서(제목/카테고리/요약/체크리스트 정의/본문)는 사용자별 커스터마이즈 요구가 없으므로
DB 테이블이 아니라 정적 파일(`apps/api/app/content/sop/manifest.json` + `{id}.md`)로
관리한다. 이 모듈은 그 파일을 읽어 라우터가 소비할 수 있는 형태로 변환한다.

콘텐츠는 프로세스 생애주기 동안 재배포 전까지 바뀌지 않으므로 `lru_cache`로 캐시한다
(매 요청 파일 IO를 피한다 — kpi_config 활성 버전 로드와 달리 이건 완전히 정적이므로
캐시 무효화 전략이 불필요).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_CONTENT_DIR = Path(__file__).resolve().parent.parent / "content" / "sop"


@dataclass(frozen=True)
class SopChecklistItem:
    id: str
    label: str


@dataclass(frozen=True)
class SopSummary:
    """GET /sop 목록 응답 투영."""

    id: str
    title: str
    category: str
    summary: str


@dataclass(frozen=True)
class SopDetail:
    """GET /sop/{id} 상세 응답 투영."""

    id: str
    title: str
    category: str
    summary: str
    body_markdown: str
    checklist_items: list[SopChecklistItem]


@lru_cache
def _load_manifest() -> dict[str, dict]:
    """manifest.json 을 1회 읽어 id → 메타 dict 로 인덱싱."""
    manifest_path = _CONTENT_DIR / "manifest.json"
    with manifest_path.open("r", encoding="utf-8") as f:
        items = json.load(f)
    return {item["id"]: item for item in items}


def list_sop_summaries() -> list[SopSummary]:
    """manifest 순서 그대로 목록 반환(화면8, GET /sop)."""
    manifest = _load_manifest()
    return [
        SopSummary(
            id=meta["id"],
            title=meta["title"],
            category=meta["category"],
            summary=meta["summary"],
        )
        for meta in manifest.values()
    ]


def sop_exists(sop_id: str) -> bool:
    """checklist-run 생성 시 sop_id 유효성 확인(느슨한 참조, 2.2절)."""
    return sop_id in _load_manifest()


def get_sop_detail(sop_id: str) -> SopDetail | None:
    """manifest 메타 + `{id}.md` 본문을 합쳐 상세 반환. 메타/본문 중 하나라도 없으면 None(→404)."""
    manifest = _load_manifest()
    meta = manifest.get(sop_id)
    if meta is None:
        return None

    md_path = _CONTENT_DIR / f"{sop_id}.md"
    try:
        body_markdown = md_path.read_text(encoding="utf-8")
    except OSError:
        # manifest 에는 있으나 본문 파일이 없는 콘텐츠 배포 오류 — 404 로 취급(2절 계약).
        return None

    return SopDetail(
        id=meta["id"],
        title=meta["title"],
        category=meta["category"],
        summary=meta["summary"],
        body_markdown=body_markdown,
        checklist_items=[
            SopChecklistItem(id=item["id"], label=item["label"])
            for item in meta.get("checklist_items", [])
        ],
    )
