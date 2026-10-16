# 관리자 콘솔 분리 설계서

- 작성: 민준 (PM·아키텍트)
- 작성일: 2026-10-16
- 상태: 설계 확정 → 서연(구현) → 태양(검수)

## 1. 배경

관리자 기능이 농가용 메뉴 안에 섞여 있다.

| 지금 위치 | 내용 | 접근 |
|---|---|---|
| `/control` (`app/(dashboard)/control/page.tsx`) | 관제센터: 전체 농장 지도·통계·미처리 알림 + 매니저 선임 패널(`ManagerPanel`) | manager·admin, 선임 패널은 총관리자(이메일) |
| `/admin` (`app/(dashboard)/admin/page.tsx`) | 시스템 모니터링: 통계 타일·수조 상태·요금제 분포·사용자 표(최근 접속일)·최근 알림·진단 | admin·총관리자·모니터 계정 |
| `/api/admin/diag`, `/api/admin/ai-diag` | 센서 기록·AI 연결 진단 JSON | admin·총관리자. **화면 없음** — 주소를 직접 열어야 함 |

사이드바·하단 메뉴는 양식장·스마트팜 두 모드 모두 이 두 항목을 공통 메뉴로 붙인다.

사용자 지시: **관리자 페이지를 따로 만든다(관제센터, 시스템 모니터링 등).**

## 2. 결정

1. **URL 은 `/admin/**` 하나로 모은다.** 새 route group `app/(admin)/admin/` 에 **자체 layout**(관리자 셸)을 둔다. 농가 셸(사이드바·하단 메뉴·모드 스위치·brand 테마)은 쓰지 않는다.
2. **농가 메뉴에서는 관리자 항목을 빼고 "관리자 콘솔" 링크 하나만** 남긴다(manager 이상에게만, 사이드바 하단·더보기 시트 하단 — 도움말 위).
3. **옛 주소는 살린다.** `/control` → `/admin/control` 영구 리다이렉트(무안군 담당자에게 안내된 주소가 깨지지 않게).
4. 관리자 콘솔은 **한국어 전용**(내부 운영 도구). 기존 관제센터가 이미 한국어 하드코딩이다.
5. **서버 권한 확인은 지금 그대로**(`lib/control-auth.ts`, `api/admin/*`의 이메일+role 검사). 화면 가드는 편의일 뿐이다.

## 3. 페이지와 접근 권한

| 경로 | 화면 | manager | admin | 총관리자(이메일) | 모니터·테스트 계정 |
|---|---|---|---|---|---|
| `/admin` | **개요(시스템 모니터링)** — 통계 타일, 수조 상태, 요금제 분포, 최근 알림, 최근 진단 | → `/admin/control` 로 | ✅ | ✅ | ✅(목데이터, 지금처럼) |
| `/admin/users` | **사용자** — 사용자 표(이름·이메일·역할 배지·요금제·농장 수·가입일·최근 접속일), 검색·역할 필터 | ✗ | ✅ | ✅ | ✅(목데이터) |
| `/admin/readings` | **수질 기록** — 전체 회원의 수질 기록을 사용자·농장·수조·출처(수기/센서)·기간으로 걸러 보기, CSV(최대 5,000건). 출처는 `water_quality_readings.source`(wq_source.sql), 칸이 없거나 NULL 이면 `device_id` 유무로 판정(`lib/wq-source.ts`). 읽기 전용. (2026-10-16 추가) | ✗ | ✅ | ✅ | ✅(목데이터) |
| `/admin/control` | **관제센터** — 지금 `/control` 의 지도·통계·알림(선임 패널 제외) | ✅ | ✅ | ✅ | ✗ |
| `/admin/managers` | **매니저 관리** — 지금 `ManagerPanel` | ✗ | ✗ | ✅ | ✗ |
| `/admin/diagnostics` | **시스템 진단** — `/api/admin/diag`·`/api/admin/ai-diag` 를 버튼으로 실행하고 결과를 읽기 좋게(요약 줄 + 접이식 JSON) | ✗ | ✅ | ✅ | ✗ |

- 권한 없는 페이지는 메뉴에서 숨기고, 주소로 들어오면 권한 있는 첫 페이지로(그것도 없으면 `/home`).
- 판정 함수는 한 곳: `lib/admin-access.ts` — `adminAccess(user): { console: boolean; overview: boolean; users: boolean; control: boolean; managers: boolean; diagnostics: boolean }`. 총관리자 이메일은 `NEXT_PUBLIC_SUPER_ADMIN_EMAIL || "kjs100184@gmail.com"`(지금 admin 페이지와 같은 기준), 모니터 계정은 `isMonitorAccount`, 테스트 계정은 `isTestAccount`.

## 4. 관리자 셸 (`components/admin/admin-shell.tsx`)

```
┌──────────────┬─────────────────────────────────────────────┐
│ 🛡 Shrimp365  │  개요                       kjs…@gmail.com   │
│   ADMIN      │                             [총관리자]        │
│──────────────│─────────────────────────────────────────────│
│ ▣ 개요        │                                             │
│ 👥 사용자      │   (페이지 본문)                              │
│ 📡 관제센터    │                                             │
│ 👤 매니저 관리  │                                             │
│ 🩺 시스템 진단  │                                             │
│──────────────│                                             │
│ ← 서비스로     │                                             │
│ ⎋ 로그아웃     │                                             │
└──────────────┴─────────────────────────────────────────────┘
```

- 데스크톱(lg↑): 왼쪽 사이드바 w-56. 모바일: 상단바 + 가로 스크롤 탭(메뉴 항목 그대로).
- 색: 새 색 금지. 농가 brand 토큰(파랑/녹색)을 쓰지 않고 **중립(slate·foreground)** + 활성 항목 `bg-foreground text-background`. 농가 화면과 한눈에 구별되게.
- 머리: `ShieldCheck` + "Shrimp365" + 작은 "ADMIN". 우측에 이메일·역할 배지(총관리자/관리자/매니저).
- "서비스로 돌아가기": `user.ui_mode === "agriculture"` 면 `/daumlabs/home`, 아니면 `/home`.
- 인증 가드: 지금 `(dashboard)/layout.tsx` 와 같은 방식(로딩 스피너 → 비로그인 `/login`). 권한 가드는 3장.
- 인쇄: 지금처럼 크롬은 `print:hidden`.

## 5. 파일 이동·변경

| 작업 | 파일 |
|---|---|
| 신규 | `app/(admin)/layout.tsx` 또는 `app/(admin)/admin/layout.tsx`(Next 16 문서 확인 후 결정), `app/(admin)/admin/{page,users/page,control/page,managers/page,diagnostics/page}.tsx`, `components/admin/{admin-shell,admin-nav,...}.tsx`, `lib/admin-access.ts` |
| 이동·분할 | `app/(dashboard)/admin/page.tsx` → 개요 + 사용자(뷰 컴포넌트로 `components/admin/` 에), `app/(dashboard)/control/page.tsx` → 관제센터 + 매니저 관리 |
| 삭제 | `app/(dashboard)/admin/` (같은 URL 이 두 route group 에 있으면 빌드 에러) |
| 리다이렉트 | `app/(dashboard)/control/page.tsx` → `redirect("/admin/control")` 한 줄(또는 `next.config` redirects — 문서 보고 결정, 영구 308) |
| 농가 메뉴 | `components/layout/sidebar.tsx`·`bottom-nav.tsx`: `SHARED_NAV` 에서 `/control`·`/admin` 제거, 하단에 "관리자 콘솔" 링크(`canControl` 일 때). `header.tsx` 제목표에서 `/admin` 제거 |
| 사전 | `t.nav.adminConsole` 4개 언어 + 농업 `nav.adminConsole` 4개 언어(농가 메뉴의 링크 라벨만 — 콘솔 안은 한국어) |
| 보호 | `middleware.ts` `PROTECTED_PATHS` 에 `"/admin"`, `"/control"` 추가(비로그인 → `/login`). 그 외 줄 금지 |

## 6. 하지 말 것

- `app/api/admin/**`, `app/api/control/**`, `lib/control-auth.ts` 의 권한 로직 변경 금지(화면만 옮긴다).
- 관제센터·시스템 모니터링의 **데이터·계산 로직 변경 금지** — 파일을 옮기고 쪼갤 뿐이다. 새 기능은 사용자 표의 검색·역할 필터, 진단 화면 둘뿐.
- 농가 화면 회귀 0: 메뉴 두 항목이 링크 하나로 바뀌는 것 외 변화 없음.
- 진단 결과에 키·토큰이 섞여 보이지 않게 — API 가 이미 가리지만 화면에서도 `key`/`token`/`secret` 이 든 필드 값은 앞 4글자만.

## 7. 검수 (태양)

1. `npm run build` — `/admin`, `/admin/users`, `/admin/control`, `/admin/managers`, `/admin/diagnostics` 존재, `/control` 리다이렉트.
2. 3장 표의 권한 매트릭스를 코드로 확인(메뉴 노출·주소 직접 진입 둘 다).
3. 농가 사이드바·더보기에 관리자 항목 2개가 없고 "관리자 콘솔" 링크 1개(manager 이상만).
4. 이동한 화면의 데이터 로직 diff 가 "이동·분할"뿐인지.
5. `api/admin/**`·`api/control/**`·`lib/control-auth.ts` diff 0.

## 8. 사람 몫

- 무안군 담당자 안내 주소: `https://www.shrimp365.kr/admin/control` (옛 `/control` 도 자동으로 넘어간다).
