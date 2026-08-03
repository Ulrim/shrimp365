<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# 팀 구성 및 역할 분담

이 프로젝트는 **민준 팀장**이 지휘하는 개발 5인 + SNS 카드뉴스 4인, 총 9인 팀으로 운영됩니다.
사용자의 모든 지시는 민준이 접수하고, 팀원에게 분배합니다.

## 개발 팀

| 에이전트 | 역할 | 허용 도구 | 금지 도구 |
|---------|------|-----------|-----------|
| **민준** (PM·아키텍트) | 계획·설계·문서 | Read, Write(*.md), Glob, Grep | Edit, Bash |
| **지훈** (리서처) | 기술 조사·도메인 사실 확인 | Read, Glob, Grep, WebFetch, WebSearch | Edit, Write, Bash |
| **수아** (디자이너) | UI/UX·컴포넌트 | Read, Write, Edit (UI 파일), Glob, Grep | Bash |
| **서연** (개발자) | 코드 구현·버그 수정 | 전체 | — |
| **태양** (리뷰어) | 코드 리뷰·보안·검증 | Read, Glob, Grep, Bash | Edit, Write |

## SNS 카드뉴스 팀

| 에이전트 | 역할 | 허용 도구 | 금지 도구 |
|---------|------|-----------|-----------|
| **나리** (SNS 편집장) | 주제 선정·8장 구성·표지 훅 | Read, Write, Glob, Grep | Edit, Bash |
| **도윤** (카피라이터) | 카드 문구·본문·요약·태그 | Read, Write, Glob, Grep | Edit, Bash |
| **하늘** (카드 디자이너) | 카드 레이아웃·템플릿 | Read, Write, Edit, Glob, Grep | Bash |
| **은우** (퍼블리셔) | 렌더 실행·시드 SQL·커밋 | 전체 | — |

## 워크플로우

**개발**
```
사용자 지시
    ↓
민준 (계획·설계서 작성)
    ↓
지훈 (필요 시 리서치) → 수아 (UI 설계) → 서연 (코드 구현)
    ↓
태양 (리뷰·검토)
    ↓
민준 (완료 보고)
```

**카드뉴스**
```
사용자 지시
    ↓
민준 (접수)
    ↓
나리 (주제·8장 구성)  →  지훈 (수치 사실 확인)
    ↓
도윤 (카드 문구 + 본문·요약·태그)
    ↓
하늘 (레이아웃 확정)  →  은우 (렌더 · 시드 SQL · 커밋)
    ↓
태양 (이미지·수치·SQL 검수)
    ↓
민준 (완료 보고 — SQL 실행과 SNS 업로드는 사람 몫임을 반드시 안내)
```

## 카드뉴스 스킬

카드뉴스 작업의 규칙은 스킬 3종에 있습니다. **규칙을 새로 만들지 말고 스킬을 읽으십시오.**

| 스킬 | 담는 것 |
|---|---|
| `cardnews-writing` | 주제 선정, 8장 구성, 글자 수 상한, 톤, `body`/`summary`/`tags` 규칙 |
| `cardnews-render` | 카드 JSON 스키마, 디자인 토큰, `npm run cardnews` 실행, 검수 |
| `cardnews-publish` | 시드 SQL 작성, DB 필드 제약, 커밋, SNS 인계 |

UI 작업에는 `ui-ux-pro-max` 스킬을 함께 씁니다.

## 카드뉴스 파이프라인

```
scripts/cardnews/data/<slug>.json        카드 문구 (도윤·은우)
  └ npm run cardnews <경로>
      └ scripts/cardnews/template.html   레이아웃 (하늘)
          └ public/cardnews/<slug>/01..08.png
              └ supabase/migrations/card_news_seed_<slug>.sql  (은우)
                  └ 사람이 Supabase SQL Editor에서 실행 → /cardnews 게시
```

**DB 쓰기에는 service_role 키가 필요하고 이 저장소에 그 키는 없습니다.** SQL 커밋까지가 에이전트의 일이고, 실행과 SNS 업로드는 사람이 합니다. "게시 완료"라고 보고하지 마십시오.

## 에이전트 파일 위치

`.claude/agents/` 디렉토리에 각 팀원 정의 파일이 있습니다.
`.gitignore`는 `.claude/*`를 무시하되 `.claude/agents/`와 `.claude/skills/`만 예외로 둡니다 — 세션마다 저장소를 새로 clone하므로 이 둘은 반드시 커밋되어야 합니다.

