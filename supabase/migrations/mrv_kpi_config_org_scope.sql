-- ---------------------------------------------------------------------------
-- MRV KPI 설정의 org 범위 — 한 조직의 파라미터 변경이 플랫폼 전체를 바꾸지 않게 한다.
--
-- ── 왜 ───────────────────────────────────────────────────────────────────────
-- `mrv_kpi_config` 는 `id, version, params_json, effective_from` 네 열뿐이었고 org_id 가
-- 없었다. 활성 설정 판정도 「effective_from 이 가장 늦은 행」 하나뿐이어서 org 조건이
-- 들어갈 자리가 없었다(lib/mrv/kpi-service.ts · alert-jobs.ts · recommendation-service.ts).
--
-- 그 결과가 멀티테넌시 누수다. **A사 owner 가 POST /api/mrv/kpi-config 로 새 version 을
-- 넣으면 그 행이 플랫폼 전체 org 의 활성 설정이 된다.** B사의 EI·Scope2·신호등 판정·알림
-- 임계값·급이 추천이 A사 운영자의 입력으로 소급해 바뀌고, B사의 감사 로그에는 아무것도
-- 남지 않는다(감사 로그는 바꾼 사람의 org 에 남는다). CLAUDE Hard Rule 4 위반이다.
--
-- ── 이 마이그레이션이 더하는 것 ─────────────────────────────────────────────
--   org_id     : 이 설정이 누구 것인가. **nullable 이고, null 은 「플랫폼 기본값」이다.**
--   created_at : 이 행을 **언제 등록했는가**.
--   created_by : 누가 등록했는가(mrv_users.id).
--   note       : 왜 바꿨는가.
--
-- ★ `effective_from` 은 사람이 임의로 적는 값이라 「언제 등록됐는가」를 답하지 못한다.
--   그 기록이 지금까지 감사 로그 하나뿐이었는데, 감사 로그 조회는 ENTERPRISE 플랜
--   전용이다(app/api/mrv/audit-logs). 즉 START/PRO 조직은 자기 조직의 KPI 파라미터가
--   언제·누구에 의해 바뀌었는지 되짚을 길이 없었다. `mrv_api_key_revocation.sql` 이
--   `revoked_by` 에 대해 적어 둔 것과 같은 기준이다 — "행 자체가 들고 있어야 감사 로그
--   열람 권한이 없는 조직도 되짚을 수 있다".
--
-- ── 기존 행은 어떻게 되는가 ─────────────────────────────────────────────────
-- `org_id` 는 **null 로 남는다.** 그것이 의도다. 지금 있는 행(mrv_platform.sql 의
-- `kpicfg-2026-1-0` 시드와, SQL 직접 수정으로 들어간 행들)은 어느 한 조직의 것이 아니라
-- 플랫폼 전체가 쓰던 값이다. 아무 org 를 골라 박아 넣으면 **없는 사실을 만들어 내는
-- 것**이고, 나머지 org 는 그 순간 설정을 잃는다. 그래서 null = 「플랫폼 기본값」이라는
-- 뜻을 그대로 둔다. 활성 설정 선택은 「호출자 org 의 행이 있으면 그것, 없으면 null 행」
-- 이다(lib/mrv/kpi-config-source.ts — 그 규칙이 적힌 유일한 자리).
--
-- `created_at` 에도 **default 를 걸지 않는다.** PostgreSQL 11+ 에서
-- `add column ... default now()` 는 기존 행까지 그 값으로 채운다 — 2026-01-01 에 들어간
-- 시드 행이 "오늘 등록됨" 으로 기록되는 것이고, 증빙 시스템에서 그것은 빈 칸보다 나쁘다.
-- 새 행의 이 칸은 쓰기 경계(app/api/mrv/kpi-config/route.ts)가 명시적으로 적는다.
--
-- ── version 의 unique 제약은 건드리지 않는다 (판단) ─────────────────────────
-- `version text not null unique` 는 **플랫폼 전역 유일**로 그대로 둔다. org 별 유일
-- (`unique (org_id, version)`)로 바꾸면 A사와 B사가 같은 `2026.2.0` 을 서로 다른
-- params_json 으로 가질 수 있게 되는데, `mrv_kpi_snapshots.config_version` ·
-- `mrv_baselines.config_version` · MRV 리포트의 「적용 kpi_config 버전」은 **org 수식어가
-- 없는 맨 문자열**이다. 같은 문자열이 둘을 뜻하게 되는 순간 리포트에 적힌 버전이 어떤
-- 파라미터였는지 제3자가 확정할 수 없다 — 증빙의 식별자가 깨진다.
--
-- 대가는 분명하다. B사가 이미 쓰인 version 문자열을 다시 쓰려 하면 409 다. 그래서 쓰기
-- 경계의 409 문구는 **어느 org 가 그 문자열을 썼는지 말하지 않는다**(존재 사실만 알린다).
-- 조직마다 `2026.2.0-<조직 약칭>` 처럼 구분되는 문자열을 쓰면 되고, 그렇게 쓰면 리포트에
-- 적힌 버전이 곧 파라미터 집합을 가리킨다.
--
-- 이 결정의 부수 효과: mrv_platform.sql 의 시드가 쓰는 `on conflict (version)` 이 그대로
-- 유효하다(부분 unique 인덱스로 바꾸면 그 추론이 깨져 기본 마이그레이션을 다시 실행할 수
-- 없게 된다).
--
-- 멱등이다. 여러 번 실행해도 안전하다.
-- ---------------------------------------------------------------------------

alter table public.mrv_kpi_config
  add column if not exists org_id     text;

alter table public.mrv_kpi_config
  add column if not exists created_at timestamptz;

alter table public.mrv_kpi_config
  add column if not exists created_by text;

alter table public.mrv_kpi_config
  add column if not exists note       text;

-- 외래키는 따로 건다 — `add column if not exists` 에 references 를 붙이면 열이 이미
-- 있을 때 제약만 따로 붙일 길이 없다(mrv_api_key_revocation.sql 과 같은 형태).
--
-- ★ org_id 는 `on delete cascade` 다. `set null` 이면 조직을 지우는 순간 그 조직의
--   파라미터가 **플랫폼 기본값으로 승격**되어 남은 모든 조직의 KPI 판정을 바꾼다.
--   조직이 사라지면 그 조직의 설정도 사라지는 것이 맞다.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'mrv_kpi_config_org_id_fkey'
       and conrelid = 'public.mrv_kpi_config'::regclass
  ) then
    alter table public.mrv_kpi_config
      add constraint mrv_kpi_config_org_id_fkey
      foreign key (org_id) references public.mrv_organizations(id) on delete cascade;
  end if;
end
$$;

-- created_by 는 `on delete set null` 이다 — 사용자를 지웠다고 설정 행이 사라지면
-- 그 설정으로 산출된 과거 스냅샷의 근거가 끊긴다(누가 넣었는지는 감사 로그에 남는다).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'mrv_kpi_config_created_by_fkey'
       and conrelid = 'public.mrv_kpi_config'::regclass
  ) then
    alter table public.mrv_kpi_config
      add constraint mrv_kpi_config_created_by_fkey
      foreign key (created_by) references public.mrv_users(id) on delete set null;
  end if;
end
$$;

-- 활성 설정 선택 질의의 모양이 그대로 인덱스가 된다 — org 후보와 기본값 후보를 각각
-- `effective_from desc` 로 한 행만 집는다(lib/mrv/kpi-config-source.ts).
create index if not exists ix_mrv_kpi_config_org_effective
  on public.mrv_kpi_config (org_id, effective_from desc);

comment on column public.mrv_kpi_config.org_id is
  '이 설정을 쓰는 조직. null 은 「플랫폼 기본값」이며, 조직 전용 행이 없을 때만 쓰인다 '
  '(활성 설정 선택: lib/mrv/kpi-config-source.ts). 이 마이그레이션 이전에 들어간 행은 '
  '어느 한 조직의 것이 아니므로 null 로 남아 있다 — 추정으로 메우지 않는다.';

comment on column public.mrv_kpi_config.created_at is
  '이 행을 등록한 시각. effective_from 은 사람이 적는 「적용 시작 시각」이라 등록 시점을 '
  '답하지 못한다. 비어 있으면 쓰기 창구(POST /api/mrv/kpi-config) 이전에 SQL 직접 '
  '수정으로 들어간 행이라는 뜻이다(추정값으로 메우지 않는다).';

comment on column public.mrv_kpi_config.created_by is
  '이 행을 등록한 mrv_users.id. 감사 로그에도 남지만, 감사 로그 조회는 ENTERPRISE '
  '전용이므로 행 자체가 들고 있어야 나머지 조직도 되짚을 수 있다.';

comment on column public.mrv_kpi_config.note is
  '왜 이 파라미터로 바꿨는가. 감사 로그 note 와 같은 값을 행에도 남긴다(위와 같은 이유).';
