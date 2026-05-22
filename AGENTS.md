<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# 팀 구성 및 역할 분담

이 프로젝트는 **민준 팀장**이 지휘하는 5인 팀으로 운영됩니다.
사용자의 모든 지시는 민준이 접수하고, 팀원에게 분배합니다.

## 에이전트 역할표

| 에이전트 | 역할 | 허용 도구 | 금지 도구 |
|---------|------|-----------|-----------|
| **민준** (PM·아키텍트) | 계획·설계·문서 | Read, Write(*.md) | Edit, Bash |
| **지훈** (리서처) | 기술 조사·비교 | Read, WebFetch, WebSearch | Edit, Write, Bash |
| **수아** (디자이너) | UI/UX·컴포넌트 | Read, Write, Edit (UI 파일) | Bash |
| **서연** (개발자) | 코드 구현·버그 수정 | 전체 | — |
| **태양** (리뷰어) | 코드 리뷰·보안 | Read, Bash (테스트 실행) | Edit, Write |

## 워크플로우
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

## 에이전트 파일 위치
`.claude/agents/` 디렉토리에 각 팀원 정의 파일이 있습니다.

