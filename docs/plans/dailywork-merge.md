# DailyWork 병합 설계서 — 컬리버 스마트팜 통합 현장관리를 Farm365에

- 작성: 민준 (PM·아키텍트)
- 작성일: 2026-11-24
- 상태: **구현 완료, SQL 미실행(사람 몫)** — 코드와 SQL 파일 준비까지가 된 일이다. 실제 Supabase 에서는 아무것도 실행·확인하지 않았다(8·9장)
- 선례 문서: `docs/mrv-platform.md`(MRV 이식), `docs/plans/openfield-merge.md`(OFDF 병합)
- 짝 문서: `docs/plans/dailywork-merge-ui.md`(수아 — 색·컴포넌트 대응표)
- 원본 저장소: `Ulrim/DailyWork` (커밋 `348652e`, 읽기 전용 clone `/home/user/ulrim/dailywork` — 참조만, 수정 금지)
- 원본 설계서: 원본 저장소의 `docs/superpowers/specs/2026-11-24-culiver-field-management-design.md`
- 작업 브랜치: `claude/dreamy-rubin-69q8bj`

원본은 "CULIVER 스마트팜 통합 현장관리 시스템"이다. 현장 작업자가 개인 계정으로 작업일보를 쓰고 제출하면
관리자가 검토·승인하고, 업무 배정·캘린더·공정 간트·통합일보·보고서·알림·변경 이력·계정/사업장 관리를
한 곳에서 본다. 독립 Next.js 앱(자체 로그인, 자체 Supabase 프로젝트)이던 것을 shrimp365 의 스마트팜
화면(Farm365, `/farm365/**`) 안으로 들여왔다.

이 문서는 확정된 결정과 구현 결과를 옮겨 적은 것이다. 여기 적힌 이름과 경로는 여러 파일이 서로 맞물리는
지점이므로 담당자가 임의로 바꾸지 않는다.

## 1. 사용자 결정 (확정)

1. **전체 이식** — 작업일보·검토함·업무·캘린더·공정·통합일보·보고서·알림·변경 이력·관리 화면을 모두 옮긴다. 일부만 골라 옮기지 않는다.
2. **shrimp365 계정 + 초대제** — 별도 로그인을 두지 않는다. shrimp365 계정으로 들어오되, 현장관리는 초대받은 계정만 쓴다(5장).
3. **사업장(project)은 농장(farm)과 독립** — `dw_projects` 는 shrimp365 의 농장·베드 테이블과 외래 키로 묶지 않는다. 현장관리의 사업장은 구축·운영 현장 단위이고, Farm365 의 농장과 1:1 이 아니다.

## 2. 조사에서 확인된 사실

| 사실 | 함의 |
|---|---|
| 원본은 Next.js 16.4.6, 이 저장소는 16.2.4 | 코드 쓰기 전 `node_modules/next/dist/docs/` 의 해당 가이드를 읽는다(AGENTS.md). 원본 코드를 그대로 붙이면 안 되는 곳이 있다(9-1) |
| 원본은 `src/proxy.ts`, 이 저장소는 루트 `middleware.ts` | `proxy.ts` 는 옮기지 않는다. 세션 갱신은 기존 `middleware.ts` 가 한다 |
| 원본은 서버 컴포넌트 + 서버 액션 + 사용자 세션(RLS) 구조. 권한의 최종 기준이 PostgreSQL RLS | 구조를 그대로 유지한다. shrimp365 도 `@supabase/ssr` 쿠키 세션이라 서버에서 그대로 읽힌다. MRV 이식(service-role + 앱 계층 스코프)과는 다른 길이다 |
| 원본 마이그레이션은 4개 파일(schema·functions·rls·storage)이고 테이블 이름이 `profiles`, `projects`, `notifications` 등 일반 명사 | shrimp365 운영 스키마에 이미 `profiles` 가 있다. 접두사 없이는 못 들어온다(4장) |
| 원본 RLS 파일에 `revoke all on all tables in schema public …` 같은 스키마 전체 권한 문장이 있다 | 그대로 실행하면 shrimp365 기존 테이블의 권한이 깨진다. 금지(4-3) |
| 원본은 `auth.users` 가입 트리거(`on_auth_user_created`)로 프로필을 만든다 | shrimp365 가입 흐름에 끼어든다. 금지(4-3). 프로필은 초대 수락 때 만든다 |
| 원본은 한국어 전용 | 화면 문구는 한국어만 둔다. 4개 언어는 Farm365 메뉴 라벨 한 줄뿐 |
| 에이전트 세션에 운영 Supabase 키가 없다 | 에이전트는 SQL 을 실행할 수 없다. 실행은 사람이 한다(8장). 런타임 서버에는 `SUPABASE_SERVICE_ROLE_KEY` 가 필요하다(5-5) |

## 3. 경로 대응

| 원본 | 이식본 |
|---|---|
| `src/app/(app)/<x>/**` | `app/(dashboard)/farm365/work/(app)/<x>/**` → URL `/farm365/work/<x>` |
| `src/app/(app)/layout.tsx` | `app/(dashboard)/farm365/work/(app)/layout.tsx` |
| `src/app/(app)/no-project` | `app/(dashboard)/farm365/work/(app)/no-project` |
| `src/app/(app)/actions.ts` | `app/(dashboard)/farm365/work/(app)/actions.ts` (export 이름 유지) |
| (신규) 초대 없음 안내 | `app/(dashboard)/farm365/work/not-invited/page.tsx` — **`(app)` 그룹 밖** |
| (신규) 진입 | `app/(dashboard)/farm365/work/page.tsx` → `/farm365/work/dashboard` 로 redirect |
| `src/lib/*` | `lib/work/*` (`lib/work/supabase/server.ts` 포함) |
| `src/components/<x>/*` | `components/work/<x>/*` (`ui`, `layout` 포함) |
| `tests/unit`, `tests/db` | `tests/work/unit`, `tests/work/db` |
| `src/app/login/**`, `src/app/page.tsx`, `src/app/layout.tsx`, `manifest.ts`, `src/proxy.ts`, `(app)/menu` | 옮기지 않는다(7장) |

- `not-invited` 를 `(app)` 그룹 밖에 두는 이유: `(app)/layout.tsx` 가 세션을 확인하고 프로필이 없으면 `not-invited` 로 보낸다. 안내 화면이 같은 레이아웃을 타면 무한 redirect 가 된다.
- import 별칭은 `@/lib/work/...`, `@/components/work/...` 다. shrimp365 의 `@/*` 는 `src/` 가 아니라 저장소 루트를 가리킨다.
- 화면 안의 모든 링크·`redirect()`·`revalidatePath()` 에는 `/farm365/work` 접두사가 붙는다. 문자열을 흩뿌리지 않고 `lib/work/constants.ts` 의 `export const WORK_BASE = "/farm365/work"` 와 `export function workHref(path: string): string`(예: `workHref("/reports/new")`)을 쓴다.
- `supabase/admin.ts` 는 만들지 않았다. service_role 이 꼭 필요한 곳은 기존 `@/lib/supabase-server` 의 `createAdminClient` 를 쓴다(5-5).

## 4. DB — 전부 `dw_` 접두사

### 4-1. 이유
현장관리 테이블은 별도 프로젝트가 아니라 shrimp365 의 운영 Supabase(public 스키마)에 함께 들어간다.
원본 이름(`profiles`, `projects`, `tasks`, `notifications` …)은 기존 테이블과 충돌하거나, 충돌하지 않더라도
어느 기능의 것인지 알 수 없게 운영 스키마를 오염시킨다. MRV 이식이 `mrv_` 를 붙인 것과 같은 판단이다.

### 4-2. 이름 규칙

| 대상 | 규칙 |
|---|---|
| 테이블(16개) | `dw_profiles, dw_projects, dw_project_members, dw_processes, dw_process_progress_logs, dw_tasks, dw_schedule_events, dw_daily_reports, dw_report_items, dw_report_photos, dw_report_reviews, dw_change_requests, dw_consolidated_reports, dw_notifications, dw_audit_logs` + 신규 `dw_invites` |
| 뷰 | `dw_process_status` |
| 함수(RPC·트리거 함수·권한 함수 전부) | `dw_` + 원래 이름. 예: `dw_kst_today`, `dw_is_executive`, `dw_project_role`, `dw_is_project_manager`, `dw_can_edit_report`, `dw_submit_report`, `dw_review_report`, `dw_save_report`, `dw_save_consolidated_report`, `dw_submission_status` |
| 신규 함수(7개) | `dw_invite_member`, `dw_invite_executive`, `dw_accept_invites`, `dw_bootstrap_executive`(5-3), `dw_is_site_manager_elsewhere`(5-5), `dw_anonymize_member`·내부용 `dw_snapshot_without_member`(5-6) |
| 함수 시그니처 | **매개변수 이름(`p_report` 등)과 반환 형태는 원본 그대로.** 화면 코드 이식이 이름 치환만으로 끝나게 하기 위해서다 |
| `search_path` | security definer 함수는 `public, pg_temp`(임시 스키마를 맨 뒤로 고정) |
| 트리거·인덱스·정책 | `dw_` 접두사 |
| 제약 | 테이블 이름에서 자동 생성되는 형태를 따른다. 예: `dw_daily_reports_project_id_author_id_work_date_key`, `dw_projects_code_key`, `dw_processes_project_id_name_key` |
| 저장소 버킷 | `dw-report-photos`. 경로 규칙 `{project_id}/{report_id}/{파일명}` 유지. storage 정책 이름은 `dw_report_photos_object_*` |
| `dw_audit_logs.table_name` 값 | **접두사 없는 원래 이름**을 저장한다(`TG_TABLE_NAME` 에서 `dw_` 를 떼어 기록) |

- 제약 이름을 굳이 고정하는 이유: `lib/work/errors.ts` 가 제약 이름으로 사용자에게 보일 오류 문구를 고른다. 이름이 어긋나면 "같은 날짜의 작업일보가 이미 있습니다" 대신 일반 오류가 나온다.
- 변경 이력에 원래 테이블 이름을 저장하는 이유: `components/work/history/labels.ts` 의 화면 라벨 코드를 원본 그대로 쓸 수 있다.
- **`dw_profiles.id` 는 auth uid 값이지만 `auth.users` 외래 키가 없다.** 이유와 탈퇴 처리는 5-6.

### 4-3. 마이그레이션 파일과 금지 사항

- `supabase/migrations/dailywork.sql` **한 파일**. 원본의 4개 파일을 합쳤다. 달라진 점 10가지가 파일 머리말에 적혀 있다.
- **재실행 안전(멱등)**: `create table if not exists`, `create or replace function`, `drop trigger if exists … ; create trigger`, `drop policy if exists … ; create policy` 로만 이루어진다. 이 저장소의 관례다(`supabase/migrations/mrv_platform.sql` 머리말 참고). 데이터는 지우지 않는다.
- **금지 1 — 스키마 전체 권한 문장.** 원본 RLS 파일의 `revoke all on all tables in schema public …` / `grant … on all tables in schema public …` / `alter default privileges …` 는 옮기지 않았다. shrimp365 기존 테이블의 권한을 깨뜨린다. `dw_` 테이블·함수 **각각에만** revoke/grant 한다.
- **금지 2 — `auth.users` 트리거.** `on_auth_user_created` / `handle_new_user` 를 만들지 않았다. shrimp365 가입 흐름에 끼어들지 않는다.

## 5. 계정·권한 — shrimp365 계정 + 초대

### 5-1. 원본과 달라진 점
원본은 관리자가 계정을 직접 발급했고 자가 가입이 없었다. shrimp365 는 누구나 가입할 수 있으므로,
"계정이 있다"와 "현장관리 구성원이다"를 분리한다. `dw_profiles` 행이 있어야 구성원이고, 그 행은
**초대를 수락할 때에만** 생긴다. 가입만으로는 생기지 않는다. `dw_profiles.email` 은 수락 시 `auth.users` 에서 복사한다.

역할 체계는 원본 그대로다. 전사 역할(`dw_profiles.global_role`)은 `chairman`·`ceo`, 사업장 역할
(`dw_project_members.role`)은 `site_manager`·`site_worker`·`partner` 이고, 기능별 권한 표는 원본 설계서 3장을 따른다.

### 5-2. `dw_invites`

| 칸 | 내용 |
|---|---|
| `id` | uuid pk |
| `email` | text not null — 소문자로 정규화 |
| `full_name`, `phone`, `company`, `position` | 수락 시 프로필에 채울 값(선택) |
| `project_id` | uuid null → `dw_projects` on delete cascade |
| `role` | text null, `site_manager` / `site_worker` / `partner` |
| `global_role` | text null, `chairman` / `ceo` |
| `invited_by`, `created_at` | 초대한 사람(uuid null), 시각(timestamptz) |

- check: 전사 역할 초대(`global_role` 있음, `project_id`·`role` 없음)이거나 사업장 초대(`global_role` 없음, `project_id`·`role` 있음) 둘 중 하나.
- 유일: `(lower(email), project_id)`. 전사 역할 초대는 `project_id is null` 인 행에 대해 `lower(email)` 유일.
- RLS: select 는 회장·대표이사 또는 그 사업장의 관리자. 다만 현장관리자는 `site_manager` 초대를 **볼 수는 있어도 취소할 수 없다**(취소는 경영진만). insert/update 는 RPC 로만 한다(authenticated 에서 revoke).
- **초대 메일은 발송되지 않는다.** 초대한 사람이 당사자에게 직접 알려야 한다. 초대에는 만료가 없다.

### 5-3. RPC 4종

| 함수 | 권한 | 동작 |
|---|---|---|
| `dw_invite_member(p_project uuid, p_email text, p_role text, p_full_name text default null, p_phone text default null, p_company text default null, p_position text default null) returns text` | security definer. 회장·대표이사, 또는 해당 사업장 현장관리자. 단 `site_manager` 지정은 회장·대표이사만 | 그 이메일의 계정이 이미 구성원이면 `dw_project_members` 에 바로 넣고 `'added'`. 아니면 `dw_invites` 에 넣고(있으면 갱신) `'invited'`. **이미 그 사업장 소속이면 거절**(P0001, "이미 이 사업장에 소속된 구성원입니다…") — 초대로 역할을 바꿀 수 없다. 비활성 계정, 회장·대표이사 대상도 거절 |
| `dw_invite_executive(p_email text, p_global_role text, p_full_name text default null) returns text` | 회장·대표이사만 | 프로필이 있으면 `global_role` 갱신 `'added'`, 없으면 초대 `'invited'`. 본인의 전사 역할은 못 바꾼다 |
| `dw_accept_invites() returns integer` | security definer. 로그인 사용자 본인 | `auth.uid()` 의 이메일을 `auth.users` 에서 읽되 **`email_confirmed_at is not null` 일 때만** 진행. `lower(email)` 이 일치하는 초대를 모두 수락: `dw_profiles` upsert, `dw_project_members` 삽입(on conflict 무시), 수락한 초대 삭제. 수락 건수 반환. 수락할 수 없는 경우 예외 대신 **0 을 반환**한다 |
| `dw_bootstrap_executive(p_email text, p_global_role text, p_full_name text default null) returns text` | **authenticated·anon 실행 권한 revoke.** SQL Editor(postgres)에서 실행 | 그 이메일로 가입하고 **이메일 인증을 마친** 계정이 있으면 프로필을 만들고 `global_role` 부여(`'added'`). 계정이 없거나 미인증이면 바로 지정하지 않고 전사 역할 초대로 남긴다(`'invited'`) |

- 이메일 대조는 `dw_profiles.email` 이 아니라 **`auth.users.email`** 로 한다.
- `dw_accept_invites` 가 이메일 인증을 요구하는 이유: 인증되지 않은 이메일로 가입해 남의 초대를 가로채지 못하게 한다. 이 방어는 Supabase 의 인증 설정과 소셜 로그인의 이메일 확인에 기대고 있다(8장 a·b).
- 수락 시 `full_name` 은 초대에 적힌 이름, 없으면 이메일의 @ 앞부분. 전사 역할 초대면 `global_role` 도 설정한다. 이미 프로필이 있는 사용자가 불러도 안전하다(추가 초대 수락).
- `dw_bootstrap_executive` 는 원본 `scripts/create-admin.mjs` 를 대신한다. 사용법은 8장.

### 5-4. 세션 흐름 — `lib/work/session.ts` 의 `getSession`

1. 로그인 사용자 없음 → `redirect("/login")` (shrimp365 로그인 화면).
2. `dw_profiles` 조회 자체가 실패(SQL 미실행으로 테이블이 없는 경우 포함) → `not-invited?reason=unavailable`. "초대받지 않음"으로 오해하지 않게 사유를 붙인다.
3. `dw_profiles` 행 없음 → `rpc("dw_accept_invites")` 호출 후 다시 조회 → 그래도 없으면 `not-invited`.
4. `is_active = false` → `not-invited?reason=inactive`. **shrimp365 세션을 signOut 하지 않는다.** 원본은 로그아웃시켰지만, 여기서는 현장관리만 막을 뿐 Farm365 의 다른 화면은 계속 쓸 수 있어야 한다.
5. 이후는 원본과 같다(사업장 목록·역할·쿠키로 고른 사업장). 다만 소속 사업장이 0개이고 전사 역할도 없으면 `dw_accept_invites` 를 한 번 더 불러 본다.

안내 화면(`not-invited/page.tsx`)의 분기는 순서대로 다음과 같다.

| 조건 | 안내 |
|---|---|
| `reason=unavailable` | 현장관리를 지금 사용할 수 없음(준비되지 않았거나 일시 오류) |
| `reason=inactive` | 사용이 중지된 계정 — 현장관리자·경영진에게 문의 |
| 계정에 이메일이 없음(카카오 등) | 이메일 계정으로 가입하라는 안내 |
| 그 외 | 로그인 이메일로 초대를 요청하라는 일반 안내. 이메일 미인증이면 인증 안내를 덧붙인다 |

**제약: 카카오처럼 이메일 없이 가입한 계정은 현장관리를 쓸 수 없다.** 초대가 이메일로 걸리기 때문이다.

### 5-5. 관리 화면과 service_role

- **계정 관리(`admin/users`)**: 원본의 "계정 생성·비밀번호 초기화"가 **"구성원 초대"**(이메일·역할·이름·연락처·소속·직위)와 **대기 중 초대 목록·취소**로 바뀌었다. 역할 변경·사업장에서 제외·비활성화(`is_active`)는 유지한다.
- 원본이 service_role 로 조회하던 "대상이 다른 사업장의 현장관리자인가"는 `dw_is_site_manager_elsewhere(p_user uuid, p_project uuid) returns boolean` 로 옮겼다. 호출자에게 권한이 없으면 42501 예외를 낸다.
- **런타임에 `SUPABASE_SERVICE_ROLE_KEY` 가 필요한 곳은 두 군데다.** ① 현장관리자가 남의 구성원 프로필을 수정·사용 중지할 때(`admin/users/actions.ts`, `canManage` 확인 뒤 `createAdminClient`) ② 회원 탈퇴 API(5-6). ① 경로의 변경 이력은 수행자가 비어 "시스템"으로 남는다(원본과 같다).
- **내 계정(`admin/account`)**: 현장관리 프로필(이름·연락처·소속·직위)만 고친다. 비밀번호 변경은 뺐다 — shrimp365 설정에서 한다.

### 5-6. 회원 탈퇴와 익명화

- **`dw_profiles.id` 에 `auth.users` 외래 키를 걸지 않았다.** 원본처럼 걸면, 일보를 쓴 구성원이 shrimp365 회원 탈퇴를 할 때 기록 보존용 `on delete restrict`(`dw_daily_reports.author_id` 등)에 걸려 탈퇴 자체가 실패한다(리뷰에서 재현한 회귀).
- 방침: **탈퇴는 항상 성공하고, 현장 기록은 익명 프로필과 함께 보존한다.**
- `app/api/account/delete/route.ts` 가 `deleteUser` 전에 `dw_anonymize_member` 를 부른다. 함수가 없는 경우(PGRST202·42883, SQL 미실행)는 무시하고, 그 외 오류가 나도 탈퇴를 막지 않는다.
- `dw_anonymize_member(p_user uuid) returns boolean` — service_role·postgres 전용, security definer, 멱등. 하는 일:
  - 프로필을 `is_active=false, full_name='탈퇴한 사용자', email=''` 로, 연락처·소속·직위·전사 역할은 null 로 바꾼다.
  - 소속(`dw_project_members`), 그 이메일의 초대, 알림을 지운다.
  - 통합일보 스냅샷과 관리자 알림 본문의 이름을 바꾼다(스냅샷은 내부 함수 `dw_snapshot_without_member`).
  - 계정 이력(audit)의 행은 남기되 이름·이메일·전화·소속·직위 값만 뺀다.
- 익명 프로필의 표식: `email = '' and is_active = false`.
- 한계:
  - 스냅샷의 일부 항목은 이름으로 찾는다. 동명이인이 같은 날 같은 사업장에 있으면 함께 익명화된다.
  - 작업일보 본문·사진·검토 코멘트·개인 일정은 지우지 않는다.
  - 익명화가 실패했거나 Supabase 대시보드에서 계정을 직접 지운 경우, 사람이 SQL Editor 에서 `select public.dw_anonymize_member('<uid>');` 를 실행해야 한다.
  - 구성원이 아닌 계정이 탈퇴해도 그 이메일의 대기 초대는 남는다.

## 6. UI

- 현장관리 화면은 shrimp365 `(dashboard)` 셸(사이드바·헤더·하단 내비, `data-mode="agriculture"`) **안에** 그린다. 원본의 Sidebar·Topbar·BottomNav 는 옮기지 않았다.
- 대신 `(app)/layout.tsx` 가 본문 맨 위에 **현장관리 서브 내비**를 둔다: 사업장 선택 + 메뉴 탭 + 알림/검토 건수 배지.
- "현장관리" 메뉴는 Farm365 사이드바와 하단 더보기에 **모든 사용자에게** 노출된다 → `/farm365/work`. 초대받지 않은 계정은 안내 화면을 본다. 의도된 현재 동작이고, 구성원에게만 노출할지는 후속 결정 사항이다(10장). 4개 언어 번역은 이 라벨 한 줄뿐이고, 화면 안 문구는 한국어 전용이다.
- 색·컴포넌트 규칙은 `docs/plans/dailywork-merge-ui.md` 를 따른다. 원본의 `brand-NNN`/`gray-NNN`/`bg-white` 하드코딩을 shrimp365 토큰으로 대응시키는 표가 그 문서에 있다. 이 문서에서 색을 따로 정하지 않는다.
- 공통 UI 원시 컴포넌트는 `components/work/ui/{badge,button,card,dialog,form,misc}.tsx`. **원본과 같은 export 이름·props** 를 유지한다. 화면 코드 이식이 기계적이 되게 하기 위해서다.
- 서브 내비 계약: `components/work/layout/work-nav.tsx` 가 아래를 내보낸다(클라이언트 컴포넌트).

  ```ts
  export function WorkNav(props: {
    items: NavItem[];
    counts: Record<string, number>;
    projects: { id: string; name: string }[];
    currentProjectId: string | null;
    canWrite: boolean;
  })
  ```

  `NavItem` 은 `@/lib/work/nav` 의 타입이다(원본 `src/lib/nav.ts` 와 같은 모양, `href` 는 `/farm365/work/...` 전체 경로). 사업장 전환은 `(app)/actions.ts` 로 옮긴 서버 액션을 호출한다.
- 인쇄(보고서·통합일보)용 클래스 `no-print`, `print-plain`, `avoid-break` 는 `app/globals.css` 끝의 "현장관리" 블록에 같은 이름으로 추가했다.

## 7. 원본과 달라진 점, 옮기지 않은 것

### 7-1. 달라진 점

| 항목 | 원본 | 이식본 |
|---|---|---|
| URL | `/<x>` | `/farm365/work/<x>` |
| 소스 위치 | `src/app`, `src/lib`, `src/components` | `app/(dashboard)/farm365/work`, `lib/work`, `components/work` |
| DB 객체 이름 | 접두사 없음 | 전부 `dw_`, 버킷은 `dw-report-photos` |
| 마이그레이션 | 4개 파일, 전용 프로젝트 | `dailywork.sql` 한 파일, 멱등, shrimp365 운영 DB 에 공존 |
| 권한 문장 | 스키마 전체 revoke/grant | `dw_` 객체별 revoke/grant |
| 프로필 생성 | `auth.users` 가입 트리거 | 초대 수락(`dw_accept_invites`) |
| 프로필과 계정의 연결 | `auth.users` 외래 키(cascade) | 외래 키 없음. 탈퇴 시 익명화(5-6) |
| 계정 | 관리자 발급, 자가 가입 없음 | shrimp365 계정 + 초대(`dw_invites`) |
| 최초 관리자 | `scripts/create-admin.mjs` | SQL Editor 에서 `dw_bootstrap_executive` |
| 비활성 계정 | 로그아웃 | 안내 화면으로 보냄, shrimp365 세션 유지 |
| 화면 틀 | 자체 Sidebar·Topbar·BottomNav | Farm365 셸 + 서브 내비 |
| 색 | `brand-NNN`·`gray-NNN` 하드코딩 | shrimp365 토큰(`dailywork-merge-ui.md`) |
| 세션 갱신 | `src/proxy.ts` | 기존 `middleware.ts` |

작업일보 상태 전환, 중복 제출 차단, 작업시간·공정률 산식, 지연 판정, 통합일보 취합 등 업무 규칙(원본 설계서 5장)은 **바꾸지 않았다.**

### 7-2. 옮기지 않은 것

| 대상 | 이유 |
|---|---|
| 로그인 화면(`src/app/login/**`), 루트 `page.tsx`·`layout.tsx` | shrimp365 로그인·셸을 쓴다 |
| PWA `manifest.ts` | shrimp365 에 이미 앱 manifest 가 있다. 둘을 둘 수 없다 |
| `src/proxy.ts` | 이 저장소는 `middleware.ts` 를 쓴다 |
| `(app)/menu`(모바일 전체 메뉴) | 서브 내비가 대신한다 |
| 원본 Sidebar·Topbar·BottomNav | Farm365 셸이 대신한다 |
| `scripts/dev-stack`(Docker 없는 로컬 백엔드) | 원본 전용 개발 환경이다. DB 테스트는 로컬 PostgreSQL 16 으로 돌린다(9장) |
| 백업·복원 스크립트(`backup-db.sh`, `backup-photos.mjs` 등) | 운영 DB 가 shrimp365 Supabase 로 합쳐졌으므로 그쪽 운영 절차를 따른다 |
| 비밀번호 초기화·변경, 계정 직접 생성 | 계정은 shrimp365 가 관리한다 |
| `scripts/create-admin.mjs` | `dw_bootstrap_executive` 가 대신한다 |
| `auth.users` 트리거, 스키마 전체 권한 문장 | 4-3 의 금지 사항 |
| E2E(Playwright) 스펙 | 저장소에 넣지 않았다(10장) |

## 8. 역할 분담

| 담당 | 일 |
|---|---|
| 수아 | `docs/plans/dailywork-merge-ui.md`(색·컴포넌트 대응표), 공통 컴포넌트 `components/work/ui/*`, 서브 내비 `components/work/layout/work-nav.tsx`, Farm365 메뉴 항목 |
| 서연 | ① DB 마이그레이션 `supabase/migrations/dailywork.sql` ② 기반 — `lib/work/*`, 세션, `(app)/layout.tsx`·`actions.ts`, `not-invited`, 진입 redirect ③ 화면 3묶음 이식 |
| 태양 | 리뷰 — 금지 사항 준수(4-3), RLS·RPC 권한, 초대 가로채기 방지, 9장 검증 실행 |
| 민준 | 이 문서, 완료 보고 |

### 사람이 할 일

**에이전트는 SQL 을 실행하지 않았다.** 에이전트 세션에는 운영 Supabase 키가 없어 실행할 수 없고, 에이전트의 일은
코드·SQL 파일 준비와 로컬 검증까지다. 아래 c·d 를 사람이 하기 전에는 `/farm365/work` 가 안내 화면
("지금 사용할 수 없습니다")만 보여 준다. 순서대로 한다.

a. Supabase 대시보드 Authentication 설정에서 **"Confirm email"** 과 **"Secure email change"** 가 켜져 있는지 확인한다. 꺼져 있으면 남의 이메일로 가입·변경해 초대를 가로챌 수 있다.

b. 네이버 로그인(`app/auth/naver/callback/route.ts`)이 넘겨받는 이메일이 네이버에서 소유 확인된 주소인지 확인한다 — **미확인 상태다.** 확인 전에는 전사 역할을 이미 가입·인증된 계정에만 부여한다.

c. SQL Editor 에서 `supabase/migrations/dailywork.sql` 전체를 실행한다. 멱등이므로 다시 실행해도 된다.

d. 같은 SQL Editor 에서 최초 관리자를 지정한다. 회장은 `'ceo'` 자리에 `'chairman'` 을 쓴다.

   ```sql
   select public.dw_bootstrap_executive('이메일', 'ceo', '이름');
   ```

   반환이 `'added'` 인지 확인한다. `'invited'` 면 그 이메일로 가입·인증한 뒤 현장관리에 접속할 때 수락된다.
   이 함수는 로그인 사용자가 호출할 수 없으므로 화면에서는 할 수 없다.

e. 서버 환경변수 `SUPABASE_SERVICE_ROLE_KEY` 가 있는지 확인한다(5-5).

f. 실제 Supabase 에서 확인한다 — 로컬에서 확인하지 못한 것들이다.
   - 사진 업로드·서명 URL 표시·삭제(버킷 `dw-report-photos`)
   - 초대 → 가입 → 자동 수락
   - 농장이 없는 계정이 `/farm365/work` 로 바로 들어왔을 때(셸이 `/onboarding` 으로 보낼 수 있다 — 미확인)
   - 인쇄(보고서·통합일보)

그 뒤의 구성원 초대는 지정된 관리자가 `/farm365/work/admin/users` 화면에서 한다. 초대 메일은 나가지 않으므로 당사자에게 직접 알린다.

## 9. 검증

**실제 Supabase 에서는 아무것도 실행·확인하지 않았다.** 아래는 모두 로컬 결과다.

| 명령·방법 | 결과 |
|---|---|
| `npx tsc --noEmit` | 0건 |
| eslint — 이식 경로 | 오류 0, 경고 4(원본의 `_` 접두 미사용 변수) |
| `npm run lint` — 저장소 전체 | 실패. 이식 이전부터 있던 오류 34건이며 이번 변경과 무관 |
| `npm run work:test:unit` (`tests/work/unit`) | 26건 통과 |
| `npm run work:test:db` (`tests/work/db`) | 89건 통과 |
| `dailywork.sql` 3회 연속 적용 | 오류 없음(멱등) |
| `npm run build` | 통과(Next.js 16.2.4) |
| 로컬 스택(PostgreSQL + PostgREST + GoTrue + 저장소 대체 구현) | 화면 흐름 11종과 탈퇴 흐름 확인 |

- DB 테스트는 로컬 PostgreSQL 16 에서 돈다. 기본 접속은 `postgres://culiver_test:culiver_test@localhost:5432/culiver_test` 이고, **이름이 `_test` 로 끝나는 DB 만** 허용한다.
- 로컬 검증은 `dailywork.sql` 이 문법·규칙상 맞는지를 볼 뿐이다. 운영 Supabase 에 들어갔다는 뜻이 아니다(8장).

### 9-1. 실행 검증에서 고친 4건

| 곳 | 문제와 조치 |
|---|---|
| `lib/work/session.ts` | 초대 수락 뒤의 재조회가 요청 내 fetch 중복 제거(메모이제이션)에 걸려 수락 전의 빈 결과를 받았다. 조회마다 새 `AbortSignal` 을 붙여 대상에서 뺐다 |
| `(app)/reports/new/page.tsx` | 서버 액션 재렌더 때 redirect 로 폼이 날아갔다. 요청의 `next-action` 헤더로 액션 중인지 가린다. **Next 내부 헤더에 의존하므로 Next 를 올릴 때 재확인이 필요하다** |
| `components/work/layout/work-nav.tsx` | 모바일 가로 넘침 |
| 보고서(`outputs`) | 임베드 별칭 누락 |

## 10. 알려진 한계·후속 후보

- **메뉴 노출 범위** — 지금은 모든 사용자에게 보인다. 구성원에게만 노출할지 결정이 필요하다(6장).
- **초대** — 만료가 없다. 전사 역할 초대를 수동 승인으로 바꾸는 것도 후보다. 초대 메일 발송 없음(5-2).
- **`is_active` 가 사업장 단위가 아니라 전역** — 한 사업장의 현장관리자가 다른 사업장에도 속한 현장팀·협력업체를 전역 사용 중지할 수 있다(원본과 같다).
- **service_role 의존** — 현장관리자의 프로필 수정을 security definer RPC 로 옮기면 5-5 의 ① 의존을 없앨 수 있다.
- **이메일 없는 계정**(카카오 등)은 현장관리를 쓸 수 없다(5-4).
- **탈퇴 익명화의 한계**는 5-6 에 적었다.
- **한국어 전용 화면** — 메뉴 라벨만 4개 언어다.
- **다크 모드** — CSS 대비만 해 두었고 실제 검증은 못 했다. 저장소에 `.dark` 를 켜는 코드가 없다.
- **`brand-a*` 틴트** — 기존 Farm365 화면에서 파랑으로 계산되는 기존 문제가 있다. 현장관리 구역은 `.dw-root` 에서 해결했고, 기존 화면은 손대지 않았다.
- **E2E(Playwright)** 스펙은 저장소에 넣지 않았다.
- **`reports/new` 의 `next-action` 헤더 의존** — Next 를 올릴 때 재확인(9-1).
