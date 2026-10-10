"""SOP 정적 콘텐츠를 TypeScript 모듈로 굽는다.

원본(`mrv-platform/apps/api/app/content/sop/`)의 manifest.json + {id}.md 를 읽어
`lib/mrv/sop-content.ts` 를 생성한다. 런타임 파일 읽기를 없애 배포 형태(서버리스)의
번들 추적 문제를 피하기 위함이며, SOP 내용은 재배포 전까지 바뀌지 않으므로 잃는 것이 없다.

실행: python3 scripts/mrv/gen-sop-content.py
"""

from __future__ import annotations

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "mrv-platform" / "apps" / "api" / "app" / "content" / "sop"
OUT = ROOT / "lib" / "mrv" / "sop-content.ts"

HEADER = '''/**
 * SOP 정적 콘텐츠 — 원본 `apps/api/app/content/sop/` (manifest.json + {id}.md)의 이식본.
 *
 * SOP 문서는 사용자별 커스터마이즈 요구가 없어 원본도 DB 가 아닌 정적 파일로 관리했다.
 * 이식본은 한 걸음 더 가서 **TypeScript 모듈로 굽는다** — 배포 형태(서버리스)에서는
 * 런타임 파일 읽기가 번들 추적에 의존해 깨지기 쉬운데, 모듈이면 그 문제 자체가 없다.
 * 내용이 바뀌는 시점은 어차피 재배포뿐이므로 잃는 것도 없다.
 *
 * ⚠ 이 파일은 `scripts/mrv/gen-sop-content.py` 가 원본에서 생성한다. 직접 고치지 말고
 *    원본(mrv-platform/apps/api/app/content/sop/)을 고친 뒤 다시 생성할 것.
 */

export type SopChecklistItem = {
  id: string
  label: string
}

export type SopSummary = {
  id: string
  title: string
  category: string
  summary: string
}

export type SopDetail = SopSummary & {
  body_markdown: string
  checklist_items: SopChecklistItem[]
}

const SOP_DETAILS: SopDetail[] = ['''

FOOTER = ''']

const BY_ID = new Map(SOP_DETAILS.map((s) => [s.id, s]))

/** manifest 순서 그대로의 목록(본문 제외). */
export function listSopSummaries(): SopSummary[] {
  return SOP_DETAILS.map(({ id, title, category, summary }) => ({
    id,
    title,
    category,
    summary,
  }))
}

/** 체크리스트 실행 기록을 만들 때 sop_id 가 실재하는지 확인한다(느슨한 참조 검증). */
export function sopExists(sopId: string): boolean {
  return BY_ID.has(sopId)
}

/** 상세(본문 마크다운 + 체크리스트 정의). 없으면 null → 라우터가 404. */
export function getSopDetail(sopId: string): SopDetail | null {
  return BY_ID.get(sopId) ?? null
}
'''


def ts_literal(s: str) -> str:
    """마크다운 본문을 템플릿 리터럴로. 백틱/역슬래시/${ 만 이스케이프하면 원문이 보존된다."""
    return "`" + s.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${") + "`"


def main() -> None:
    manifest = json.loads((SRC / "manifest.json").read_text(encoding="utf-8"))
    parts = [HEADER]
    for meta in manifest:
        body = (SRC / f"{meta['id']}.md").read_text(encoding="utf-8")
        items = ",\n".join(
            f'      {{ id: {json.dumps(i["id"], ensure_ascii=False)}, '
            f'label: {json.dumps(i["label"], ensure_ascii=False)} }}'
            for i in meta["checklist_items"]
        )
        parts.append(
            f"""  {{
    id: {json.dumps(meta['id'], ensure_ascii=False)},
    title: {json.dumps(meta['title'], ensure_ascii=False)},
    category: {json.dumps(meta['category'], ensure_ascii=False)},
    summary: {json.dumps(meta['summary'], ensure_ascii=False)},
    checklist_items: [
{items},
    ],
    body_markdown: {ts_literal(body)},
  }},"""
        )
    parts.append(FOOTER)
    OUT.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(manifest)} SOPs)")


if __name__ == "__main__":
    main()
