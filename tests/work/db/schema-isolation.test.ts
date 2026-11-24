import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { MIGRATION_FILE } from "./global-setup";
import { asUser, pool, sql } from "./helpers";

afterAll(() => pool.end());

// supabase-shim.sql 이 마이그레이션보다 먼저 public.profiles(더미) · legacy_seq · legacy_public_fn 을 만들고
// Supabase 기본값처럼 anon/authenticated 권한을 열어 둔다. 현장관리 마이그레이션이 스키마 전체
// grant/revoke 를 했다면 이 권한들이 사라진다.
describe("스키마 오염 없음", () => {
  it("dw_ 가 아닌 기존 테이블·시퀀스·함수의 권한이 그대로 남아 있다", async () => {
    const [row] = await sql(
      `select has_table_privilege('authenticated', 'public.profiles', 'select') as auth_select,
              has_table_privilege('anon', 'public.profiles', 'select') as anon_select,
              has_table_privilege('authenticated', 'public.profiles', 'insert') as auth_insert,
              has_sequence_privilege('authenticated', 'public.legacy_seq', 'usage') as auth_seq,
              has_function_privilege('anon', 'public.legacy_public_fn()', 'execute') as anon_fn,
              has_function_privilege('authenticated', 'public.legacy_public_fn()', 'execute') as auth_fn`,
    );
    expect(row).toEqual({
      auth_select: true,
      anon_select: true,
      auth_insert: true,
      auth_seq: true,
      anon_fn: true,
      auth_fn: true,
    });
    // 실제로도 읽힌다
    const anonRows = await asUser(null, (q) => q("select role from public.profiles"));
    expect(anonRows).toEqual([{ role: "admin" }]);
    const [fn] = await asUser(null, (q) => q("select public.legacy_public_fn() as v"));
    expect(fn.v).toBe(42);
  });

  it("기존 profiles 테이블의 구조·정책·트리거를 건드리지 않는다", async () => {
    const columns = await sql(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'profiles' order by ordinal_position",
    );
    expect(columns.map((c) => c.column_name)).toEqual(["id", "role"]);
    const policies = await sql("select policyname from pg_policies where schemaname = 'public' and tablename = 'profiles'");
    expect(policies.map((p) => p.policyname)).toEqual(["profiles_read"]);
    const triggers = await sql(
      "select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal",
    );
    expect(triggers).toHaveLength(0);
  });

  it("security definer 함수는 모두 search_path 를 public, pg_temp 로 고정한다", async () => {
    const rows = await sql(
      `select p.proname, p.proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'dw\\_%' and p.prosecdef`,
    );
    expect(rows.length).toBeGreaterThan(20);
    const loose = rows.filter((r) => !(r.proconfig ?? []).includes("search_path=public, pg_temp"));
    expect(loose.map((r) => r.proname)).toEqual([]);
  });

  it("dw_profiles 는 auth.users 에 외래 키를 걸지 않는다(회원 탈퇴를 막지 않는다)", async () => {
    const rows = await sql(
      `select conname from pg_constraint
       where contype = 'f' and confrelid = 'auth.users'::regclass and conrelid::regclass::text like 'dw\\_%'`,
    );
    expect(rows).toEqual([]);
  });

  it("auth.users 에 트리거를 걸지 않는다", async () => {
    const triggers = await sql("select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal");
    expect(triggers).toHaveLength(0);
  });

  it("마이그레이션이 만든 public 객체는 모두 dw_ 접두사를 갖는다", async () => {
    const relations = await sql(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'v', 'S') and c.relname not like 'dw\\_%'
       order by c.relname`,
    );
    expect(relations.map((r) => r.relname)).toEqual(["legacy_seq", "profiles"]);
    const functions = await sql(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname not like 'dw\\_%'`,
    );
    expect(functions.map((r) => r.proname)).toEqual(["legacy_public_fn"]);
    const policies = await sql(
      "select policyname from pg_policies where schemaname in ('public', 'storage') and policyname not like 'dw\\_%'",
    );
    expect(policies.map((p) => p.policyname)).toEqual(["profiles_read"]);
  });

  it("마이그레이션 파일에 스키마 전체 권한 문장이 없다", () => {
    const body = fs
      .readFileSync(MIGRATION_FILE, "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(body).not.toMatch(/\bin\s+schema\s+public\b/i);
    expect(body).not.toMatch(/alter\s+default\s+privileges/i);
    expect(body).not.toMatch(/on\s+auth\.users\s+for\s+each/i);
    expect(body).not.toMatch(/handle_new_user|on_auth_user_created/);
  });
});

describe("dw_ 객체의 권한", () => {
  it("비로그인(anon)은 dw_ 테이블·뷰·함수 어느 것에도 권한이 없다", async () => {
    const tables = await sql(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'v') and c.relname like 'dw\\_%'
         and has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')`,
    );
    expect(tables).toEqual([]);
    const functions = await sql(
      `select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'dw\\_%' and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(functions).toEqual([]);
    const total = await sql(
      `select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'dw\\_%'`,
    );
    expect(total[0].n).toBe(16);
  });

  it("모든 dw_ 테이블에 RLS 가 켜져 있다", async () => {
    const off = await sql(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'dw\\_%' and not c.relrowsecurity`,
    );
    expect(off).toEqual([]);
  });

  it("로그인 사용자는 select/insert/update/delete 밖의 권한(truncate 등)이 없다", async () => {
    const extra = await sql(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'dw\\_%'
         and has_table_privilege('authenticated', c.oid, 'truncate, references, trigger')`,
    );
    expect(extra).toEqual([]);
  });

  it("함수·트리거로만 기록하는 테이블에는 로그인 사용자가 직접 쓸 수 없다", async () => {
    const writable = await sql(
      `select t.name, has_table_privilege('authenticated', 'public.' || t.name, 'insert') as ins,
              has_table_privilege('authenticated', 'public.' || t.name, 'update') as upd,
              has_table_privilege('authenticated', 'public.' || t.name, 'delete') as del
       from unnest(array['dw_audit_logs', 'dw_report_reviews', 'dw_change_requests', 'dw_process_progress_logs',
                         'dw_consolidated_reports', 'dw_notifications', 'dw_profiles', 'dw_invites']) as t(name)
       order by t.name`,
    );
    expect(writable).toEqual([
      { name: "dw_audit_logs", ins: false, upd: false, del: false },
      { name: "dw_change_requests", ins: false, upd: false, del: false },
      { name: "dw_consolidated_reports", ins: false, upd: false, del: false },
      { name: "dw_invites", ins: false, upd: false, del: true },
      { name: "dw_notifications", ins: false, upd: true, del: false },
      { name: "dw_process_progress_logs", ins: false, upd: false, del: false },
      { name: "dw_profiles", ins: false, upd: true, del: false },
      { name: "dw_report_reviews", ins: false, upd: false, del: false },
    ]);
  });

  it("내부 전용 함수·트리거 함수는 로그인 사용자가 실행할 수 없다", async () => {
    const rows = await sql(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'dw\\_%' and not has_function_privilege('authenticated', p.oid, 'execute')
       order by p.proname`,
    );
    expect(rows.map((r) => r.proname)).toEqual([
      "dw_anonymize_member",
      "dw_audit_row",
      "dw_bootstrap_executive",
      "dw_build_consolidated_snapshot",
      "dw_daily_reports_guard",
      "dw_notify",
      "dw_notify_managers",
      "dw_processes_log_progress",
      "dw_profiles_guard",
      "dw_refresh_consolidated_report",
      "dw_report_items_guard",
      "dw_report_photos_guard",
      "dw_set_updated_at",
      "dw_snapshot_without_member",
      "dw_tasks_before_write",
      "dw_tasks_notify",
    ]);
    // 권한 목록에서 빠진 dw_ 함수가 없다(새 함수를 추가하고 권한 절을 잊으면 여기서 걸린다)
    const leaked = await sql(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'dw\\_%'
         and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)`,
    );
    expect(leaked).toEqual([]);
  });

  it("변경 이력에는 접두사를 뗀 테이블 이름이 기록된다", async () => {
    const [project] = await sql("insert into dw_projects (code, name) values ($1, '이력 확인') returning id", [
      `H-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    ]);
    const logs = await sql("select table_name, project_id from dw_audit_logs where record_id = $1", [project.id]);
    expect(logs).toEqual([{ table_name: "projects", project_id: project.id }]);
    const prefixed = await sql("select 1 from dw_audit_logs where table_name like 'dw\\_%' limit 1");
    expect(prefixed).toHaveLength(0);
  });
});
