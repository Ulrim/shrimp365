-- ---------------------------------------------------------------------------
-- mrv_readings.source — 계측값의 출처를 DB 에 못박는다.
--
-- 왜 필요한가. 전력(kWh)은 이 운영에서 **사람이 수기로 입력한다.** 전력 계측값은 EI·폭기
-- EI·Scope2·기준선·전후 비교의 유일한 근거이고, 기준선은 한번 잠기면 불변이다(ADR 0002).
-- 그런데 지금 mrv_readings 에는 출처 열이 없어서 **수기로 적은 kWh 와 게이트웨이가 올린
-- kWh 가 DB 에서 구분되지 않는다.** 심사 때 "이 기준선의 전력 근거는 계측기 값인가 사람이
-- 적은 값인가" 에 답할 수 없다는 뜻이다. 둘 다 유효한 증빙이지만 같은 증빙은 아니다.
--
-- 모양은 mrv_feed_logs.source 선례를 그대로 따른다(같은 집합, 같은 CHECK).
-- 기본값만 다르다: feed_logs 는 수기 입력이 기본이지만 readings 는 게이트웨이가 기본이다.
-- 그래서 이미 쌓여 있는 행은 모두 'device' 가 되는데, 이 열이 생기기 전의 계측값은 전부
-- 게이트웨이 수집 경로(POST /api/mrv/ingest/readings, X-API-Key)로만 들어왔으므로 사실과
-- 맞는다 — 수기 경로가 아예 없었다.
--
-- ⚠ 실행 순서. 이 마이그레이션을 **배포 전에** 돌려야 한다. 코드는 저장할 때 source 를
-- 함께 보내므로, 열이 없는 DB 에 새 코드를 띄우면 PostgREST 가 그 열을 모른다며 수집
-- 요청을 거절한다(수기 입력도, 게이트웨이 수집도 함께 막힌다). 조용히 넘어가도록 만들지
-- 않은 것은 의도다 — 출처 없이 저장된 계측값은 나중에 되짚을 수 없고, 그 사실이 조용히
-- 묻히는 쪽이 요청 하나가 실패하는 쪽보다 훨씬 비싸다.
--
-- 되돌리기: alter table public.mrv_readings drop column if exists source;
-- (열을 지우면 그때까지 기록한 출처 구분이 사라진다.)
-- ---------------------------------------------------------------------------

alter table public.mrv_readings
  add column if not exists source text not null default 'device';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_mrv_readings_source'
  ) then
    alter table public.mrv_readings
      add constraint ck_mrv_readings_source
      check (source in ('manual', 'csv', 'device'));
  end if;
end $$;

-- 출처별 조회(증빙 집계: "이 기간 전력 근거 중 수기 입력이 몇 건인가")를 위한 색인.
-- readings 는 시계열이라 행이 많다. 출처만으로 전수 조회하는 일은 없고 항상 기간과 함께
-- 보므로 (org_id, source, time) 복합으로 둔다.
create index if not exists ix_mrv_readings_org_source_time
  on public.mrv_readings (org_id, source, "time");
