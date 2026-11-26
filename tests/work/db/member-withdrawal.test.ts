import fs from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { MIGRATION_FILE } from "./global-setup";
import { asUser, createAuthUser, createFixture, createReport, pool, review, sql, submit, type Query } from "./helpers";

afterAll(() => pool.end());

// shrimp365 회원 탈퇴(app/api/account/delete)는 service_role 로 dw_anonymize_member 를 부른 뒤
// auth.users 행을 지운다. 여기서는 shim 의 auth.users 를 직접 지워 그 흐름을 재현한다.

/** 서버(service_role 키)로 부르는 것과 같은 권한으로 실행한다. sub 를 주면 로그인 사용자의 토큰을 흉내 낸다. */
async function asServiceRole<T>(fn: (q: Query) => Promise<T>, sub: string | null = null): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(sub ? { sub, role: "service_role" } : { role: "service_role" }),
    ]);
    const result = await fn(async (text, params) => (await client.query(text, params as unknown[])).rows);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

const anonymize = (userId: string) =>
  asServiceRole(async (q) => (await q("select dw_anonymize_member($1) as done", [userId]))[0].done as boolean);

const deleteAuthUser = (userId: string) => sql("delete from auth.users where id = $1 returning id", [userId]);

const hasAuthFk = async () =>
  (await sql("select 1 from pg_constraint where conname = 'dw_profiles_id_fkey' and conrelid = 'public.dw_profiles'::regclass"))
    .length > 0;

describe("회원 탈퇴와 현장 기록", () => {
  // 이 테스트는 고아 프로필이 생기기 전에(파일의 첫 테스트로) 돌아야 한다 — 외래 키를 되살려야 하므로.
  it("옛 판의 auth.users 외래 키는 탈퇴를 막았고, 마이그레이션을 다시 적용하면 걷힌다(3회 멱등)", async () => {
    const f = await createFixture();
    await createReport(f, f.worker, "2026-11-02");
    expect(await hasAuthFk()).toBe(false);

    // 이전 판을 적용한 DB 를 재현한다
    await sql(
      "alter table dw_profiles add constraint dw_profiles_id_fkey foreign key (id) references auth.users (id) on delete cascade",
    );
    await expect(deleteAuthUser(f.worker)).rejects.toThrow(/violates foreign key constraint/);

    const migration = fs.readFileSync(MIGRATION_FILE, "utf8");
    await sql(migration);
    await sql(migration);
    await sql(migration);
    expect(await hasAuthFk()).toBe(false);
    expect(await deleteAuthUser(f.worker)).toHaveLength(1);
  });

  it("익명화 없이 auth.users 만 지워도 삭제는 성공하고 기록은 남는다. 익명화는 나중에 해도 된다", async () => {
    const f = await createFixture();
    const reportId = await createReport(f, f.worker, "2026-11-03");
    expect(await deleteAuthUser(f.worker)).toHaveLength(1);

    expect(await sql("select id from dw_daily_reports where id = $1", [reportId])).toHaveLength(1);
    expect(await sql("select id from dw_tasks where id = $1", [f.taskWorker])).toHaveLength(1);
    const [orphan] = await sql("select full_name, is_active from dw_profiles where id = $1", [f.worker]);
    expect(orphan).toEqual({ full_name: "현장팀원1", is_active: true });

    // 고아 프로필(계정이 이미 없는 경우)도 익명화된다
    expect(await anonymize(f.worker)).toBe(true);
    const [after] = await sql("select full_name, email, is_active from dw_profiles where id = $1", [f.worker]);
    expect(after).toEqual({ full_name: "탈퇴한 사용자", email: "", is_active: false });
  });

  it("익명화 후 탈퇴: 일보·업무는 남고 작성자는 익명, 소속·초대·알림은 지워진다", async () => {
    const f = await createFixture();
    const [{ email }] = await sql("select email from auth.users where id = $1", [f.worker]);
    await sql("update dw_profiles set phone = '010-1234-5678', position = '반장' where id = $1", [f.worker]);

    // 승인된 일보(통합일보 스냅샷에 이름이 들어간다), 제출 알림(관리자에게 이름이 간다), 작성중 일보
    const approved = await createReport(f, f.worker, "2026-11-04", { content: "터파기", process_id: f.processA1 });
    await asUser(f.worker, (q) =>
      q("update dw_daily_reports set notes = '지반 약함', support_request = '장비 지원', next_day_plan = '되메우기' where id = $1", [approved]),
    );
    await submit(f.worker, approved);
    await review(f.manager, approved, "approved");
    const draft = await createReport(f, f.worker, "2026-11-05");
    // 통합일보 확정본에도 이름이 들어 있다
    await asUser(f.manager, (q) => q("select dw_save_consolidated_report($1, '2026-11-04', '맑음', '이상 없음', true)", [f.projectA]));
    // 다른 사업장에서 온 대기 중 초대, 본인이 받은 알림(승인 알림)
    // (이미 구성원인 계정은 dw_invite_member 가 바로 추가하므로 대기 중 초대는 직접 넣는다)
    await sql("insert into dw_invites (email, project_id, role) values ($1, $2, 'site_worker')", [email, f.projectB]);
    expect((await sql("select id from dw_notifications where user_id = $1", [f.worker])).length).toBeGreaterThan(0);
    const [before] = await sql("select snapshot::text as text from dw_consolidated_reports where project_id = $1 and report_date = '2026-11-04'", [f.projectA]);
    expect(before.text).toContain("현장팀원1");

    expect(await anonymize(f.worker)).toBe(true);
    expect(await deleteAuthUser(f.worker)).toHaveLength(1);

    // 프로필: 개인정보 없음
    const [profile] = await sql("select * from dw_profiles where id = $1", [f.worker]);
    expect(profile).toMatchObject({
      full_name: "탈퇴한 사용자", email: "", phone: null, company: null, position: null, global_role: null, is_active: false,
    });
    // 기록은 남는다
    expect(await sql("select status from dw_daily_reports where id = any($1) order by work_date", [[approved, draft]])).toEqual([
      { status: "approved" },
      { status: "draft" },
    ]);
    expect(await sql("select assignee_id from dw_tasks where id = $1", [f.taskWorker])).toEqual([{ assignee_id: f.worker }]);
    expect((await sql("select id from dw_report_reviews where report_id = $1", [approved])).length).toBeGreaterThan(0);
    // 소속·초대·받은 알림은 지워진다
    expect(await sql("select 1 from dw_project_members where user_id = $1", [f.worker])).toHaveLength(0);
    expect(await sql("select 1 from dw_invites where email = $1", [email])).toHaveLength(0);
    expect(await sql("select 1 from dw_notifications where user_id = $1", [f.worker])).toHaveLength(0);

    // 이름이 복사되어 있던 곳: 관리자 알림 본문, 통합일보 스냅샷(확정본), 계정 변경 이력
    const notices = await sql("select body from dw_notifications where link = $1 and type = 'report_submitted'", [`/reports/${approved}`]);
    expect(notices).toEqual([{ body: "탈퇴한 사용자 · 2026-11-04" }]);
    const [consolidated] = await sql(
      "select snapshot, snapshot::text as text, is_finalized from dw_consolidated_reports where project_id = $1 and report_date = '2026-11-04'",
      [f.projectA],
    );
    expect(consolidated.is_finalized).toBe(true);
    expect(consolidated.text).not.toContain("현장팀원1");
    expect(consolidated.snapshot.reports).toHaveLength(1);
    expect(consolidated.snapshot.reports[0]).toMatchObject({ author_id: f.worker, author_name: "탈퇴한 사용자", company: null });
    expect(consolidated.snapshot.reports[0].items).toHaveLength(1);
    expect(consolidated.snapshot.by_process[0].items[0]).toMatchObject({ author_name: "탈퇴한 사용자", content: "터파기" });
    expect(consolidated.snapshot.issues).toEqual([{ author_name: "탈퇴한 사용자", text: "지반 약함" }]);
    expect(consolidated.snapshot.support_requests).toEqual([{ author_name: "탈퇴한 사용자", text: "장비 지원" }]);
    expect(consolidated.snapshot.next_day_plans).toEqual([{ author_name: "탈퇴한 사용자", text: "되메우기" }]);
    const audits = await sql(
      "select action, coalesce(old_data::text, '') || coalesce(new_data::text, '') as text from dw_audit_logs where table_name = 'profiles' and record_id = $1",
      [f.worker],
    );
    expect(audits.length).toBeGreaterThanOrEqual(2); // 등록 + 수정(익명화 포함). 행은 남고 값만 빠진다
    for (const row of audits) {
      for (const pii of ["현장팀원1", email, "010-1234-5678", "반장", "컬리버", "full_name", "phone"]) {
        expect(row.text).not.toContain(pii);
      }
    }
    // 개인정보가 다른 dw_ 테이블 어디에도 남지 않았다(이메일·전화로 전수 확인)
    const [leak] = await sql(
      `select (select count(*) from dw_audit_logs where old_data::text like $1 or new_data::text like $1 or old_data::text like $2 or new_data::text like $2)::int as audits,
              (select count(*) from dw_invites where email = $3)::int as invites`,
      [`%${email}%`, "%010-1234-5678%", email],
    );
    expect(leak).toEqual({ audits: 0, invites: 0 });

    // 화면이 쓰는 조회: 현장관리자·현장팀에게 작성자 이름이 익명으로 보인다
    for (const viewer of [f.manager, f.worker2, f.ceo]) {
      const rows = await asUser(viewer, (q) => q("select full_name, email, company from dw_profiles where id = $1", [f.worker]));
      expect(rows).toEqual([{ full_name: "탈퇴한 사용자", email: "", company: null }]);
    }
    // 현장관리 구성원이 아닌 shrimp365 계정에게는 보이지 않는다
    const outsider = await createAuthUser();
    expect(await asUser(outsider, (q) => q("select id from dw_profiles where id = $1", [f.worker]))).toHaveLength(0);
    // 구성원 목록(계정 관리): 회장·대표이사의 전체 목록에서도 빠진다 — 화면은 email <> '' 로 거른다
    const listed = await asUser(f.ceo, (q) => q("select id from dw_profiles where email <> ''"));
    expect(listed.map((r) => r.id)).not.toContain(f.worker);
    // 제출 현황에서도 빠진다
    const status = await asUser(f.manager, (q) => q("select user_id from dw_submission_status($1, '2026-11-04')", [f.projectA]));
    expect(status.map((r) => r.user_id)).not.toContain(f.worker);

    // 다시 불러도 같다. 프로필이 없는 사용자는 false
    expect(await anonymize(f.worker)).toBe(true);
    expect(await anonymize(await createAuthUser())).toBe(false);
  });

  it("같은 날 다른 작성자의 통합일보 내용은 건드리지 않는다", async () => {
    const f = await createFixture();
    for (const author of [f.worker, f.worker2]) {
      const id = await createReport(f, author, "2026-11-06", { content: `${author} 작업`, process_id: f.processA1 });
      await submit(author, id);
      await review(f.manager, id, "approved");
    }
    expect(await anonymize(f.worker)).toBe(true);
    const [{ snapshot }] = await sql(
      "select snapshot from dw_consolidated_reports where project_id = $1 and report_date = '2026-11-06'",
      [f.projectA],
    );
    const names = (snapshot.reports as { author_id: string; author_name: string; company: string | null }[])
      .map((r) => [r.author_id, r.author_name, r.company]);
    expect(names).toContainEqual([f.worker, "탈퇴한 사용자", null]);
    expect(names).toContainEqual([f.worker2, "현장팀원2", "컬리버"]);
    expect(snapshot.worker_count).toBe(2);
    expect((snapshot.by_process[0].items as { author_name: string }[]).map((i) => i.author_name).sort()).toEqual(
      ["탈퇴한 사용자", "현장팀원2"].sort(),
    );
  });

  it("전사 역할이던 구성원도 익명화되면 역할을 잃고 목록에서 빠진다", async () => {
    const f = await createFixture();
    expect(await anonymize(f.chairman)).toBe(true);
    expect(await deleteAuthUser(f.chairman)).toHaveLength(1);
    const [profile] = await sql("select global_role, is_active, email from dw_profiles where id = $1", [f.chairman]);
    expect(profile).toEqual({ global_role: null, is_active: false, email: "" });
    // 업무 담당자 후보(전사 역할·활성)와 계정 관리 목록 어디에도 나오지 않는다
    const executives = await asUser(f.ceo, (q) => q("select id from dw_profiles where global_role is not null and is_active"));
    expect(executives.map((r) => r.id)).not.toContain(f.chairman);
    // 전사 역할 변경 기록은 남는다(값에서 개인정보만 빠진다)
    const [audit] = await sql(
      "select old_data, changed_fields from dw_audit_logs where table_name = 'profiles' and record_id = $1 and action = 'UPDATE' order by id desc limit 1",
      [f.chairman],
    );
    expect(audit.old_data.global_role).toBe("chairman");
    expect(audit.old_data).not.toHaveProperty("full_name");
    expect(audit.changed_fields).toContain("global_role");
  });

  it("dw_anonymize_member 는 로그인 사용자·비로그인 사용자가 실행할 수 없다", async () => {
    const f = await createFixture();
    for (const caller of [f.ceo, f.manager, f.worker, null]) {
      await expect(asUser(caller, (q) => q("select dw_anonymize_member($1)", [f.worker2]))).rejects.toThrow(/permission denied/);
    }
    await expect(
      asUser(f.ceo, (q) => q("select dw_snapshot_without_member('{}'::jsonb, $1, 'x')", [f.worker2])),
    ).rejects.toThrow(/permission denied/);
    // 서버 권한이라도 로그인 사용자의 토큰(sub)이 실려 있으면 본문에서 거절한다
    await expect(
      asServiceRole((q) => q("select dw_anonymize_member($1)", [f.worker2]), f.ceo),
    ).rejects.toThrow(/서버에서만 실행/);
    const [untouched] = await sql("select full_name, is_active from dw_profiles where id = $1", [f.worker2]);
    expect(untouched).toEqual({ full_name: "현장팀원2", is_active: true });
  });

  it("탈퇴 후 같은 이메일로 다시 가입해도 옛 프로필·기록에 이어 붙지 않는다", async () => {
    const f = await createFixture();
    const [{ email }] = await sql("select email from auth.users where id = $1", [f.worker]);
    const reportId = await createReport(f, f.worker, "2026-11-07");
    expect(await anonymize(f.worker)).toBe(true);
    expect(await deleteAuthUser(f.worker)).toHaveLength(1);

    // 재가입은 새 uid 다. 초대 없이는 구성원이 아니다
    const rejoined = await createAuthUser(email);
    expect(rejoined).not.toBe(f.worker);
    expect(await asUser(rejoined, async (q) => (await q("select dw_accept_invites() as n"))[0].n)).toBe(0);
    expect(await sql("select 1 from dw_profiles where id = $1", [rejoined])).toHaveLength(0);

    // 그 이메일을 초대하면 옛 프로필에 바로 붙지('added') 않고 새 초대가 된다
    const outcome = await asUser(f.manager, async (q) =>
      (await q("select dw_invite_member($1, $2, 'site_worker') as r", [f.projectA, email]))[0].r,
    );
    expect(outcome).toBe("invited");
    expect(await asUser(rejoined, async (q) => (await q("select dw_accept_invites() as n"))[0].n)).toBe(1);

    const [fresh] = await sql("select email, full_name, is_active from dw_profiles where id = $1", [rejoined]);
    expect(fresh).toEqual({ email, full_name: email.split("@")[0], is_active: true });
    const [old] = await sql("select email, full_name, is_active from dw_profiles where id = $1", [f.worker]);
    expect(old).toEqual({ email: "", full_name: "탈퇴한 사용자", is_active: false });
    expect(await sql("select user_id from dw_project_members where project_id = $1 and user_id = any($2)", [f.projectA, [f.worker, rejoined]])).toEqual([
      { user_id: rejoined },
    ]);
    // 옛 일보는 옛(익명) 작성자의 것이고, 새 계정의 '내 작업일보'에는 나오지 않는다
    expect(await sql("select author_id from dw_daily_reports where id = $1", [reportId])).toEqual([{ author_id: f.worker }]);
    const mine = await asUser(rejoined, (q) => q("select id from dw_daily_reports where author_id = $1", [rejoined]));
    expect(mine).toHaveLength(0);
    const visible = await asUser(rejoined, (q) => q("select id from dw_daily_reports where id = $1", [reportId]));
    expect(visible).toHaveLength(0); // 작성중 일보는 작성자와 관리자만 본다
  });
});

describe("담당자가 빠진 업무", () => {
  // 담당자 검증(dw_tasks_before_write)이 모든 UPDATE 에 걸리던 때에는, 담당자가 사업장에서
  // 빠진 뒤 그 업무에 연결된 작업일보를 승인하면 dw_review_report 의 업무 갱신이 막혔다.
  it("담당자가 사업장에서 제외돼도 연결된 작업일보를 승인할 수 있고, 다른 값은 수정된다", async () => {
    const f = await createFixture();
    const reportId = await createReport(f, f.worker, "2026-11-03", {
      content: "터파기 작업",
      process_id: f.processA1,
      task_id: f.taskWorker,
      task_progress: 40,
      process_progress: 10,
    });
    await submit(f.worker, reportId);
    await asUser(f.manager, (q) =>
      q("delete from dw_project_members where project_id = $1 and user_id = $2", [f.projectA, f.worker]),
    );

    await review(f.manager, reportId, "approved");
    const [task] = await sql("select progress, assignee_id from dw_tasks where id = $1", [f.taskWorker]);
    expect(task.progress).toBe(40);
    expect(task.assignee_id).toBe(f.worker);

    await asUser(f.manager, (q) => q("update dw_tasks set title = '기초 터파기(수정)' where id = $1", [f.taskWorker]));
    expect((await sql("select title from dw_tasks where id = $1", [f.taskWorker]))[0].title).toBe("기초 터파기(수정)");
  });

  it("구성원이 아닌 사람에게 새로 배정하거나 담당자를 바꾸는 것은 여전히 막힌다", async () => {
    const f = await createFixture();
    const outsider = await createAuthUser();
    await expect(
      asUser(f.manager, (q) => q("update dw_tasks set assignee_id = $2 where id = $1", [f.taskWorker, outsider])),
    ).rejects.toThrow();
    await expect(
      asUser(f.manager, (q) =>
        q("insert into dw_tasks (project_id, process_id, title, assignee_id) values ($1, $2, '무단 배정', $3)", [
          f.projectA,
          f.processA1,
          outsider,
        ]),
      ),
    ).rejects.toThrow();
  });
});
