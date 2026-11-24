import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createFixture, createReport, pool, review, sql, submit, type Fixture } from "./helpers";

let f: Fixture;
beforeAll(async () => {
  f = await createFixture();
});
afterAll(() => pool.end());

const insertReport = (f: Fixture, user: string, date: string, start: string, end: string, brk: number) =>
  asUser(user, (q) =>
    q(
      `insert into dw_daily_reports (project_id, author_id, work_date, start_time, end_time, break_minutes)
       values ($1, $2, $3, $4, $5, $6) returning id, work_minutes, status`,
      [f.projectA, user, date, start, end, brk],
    ),
  );

describe("입력 검증", () => {
  it("실제 작업시간 = 종료 - 시작 - 휴게", async () => {
    const [row] = await insertReport(f, f.worker, "2026-03-02", "08:00", "17:30", 60);
    expect(row.work_minutes).toBe(510);
    expect(row.status).toBe("draft");
  });

  it("종료시간이 시작시간보다 빠르거나 휴게시간이 근무시간 이상이면 저장할 수 없다", async () => {
    await expect(insertReport(f, f.worker, "2026-03-03", "17:00", "08:00", 0)).rejects.toThrow(/check constraint/);
    await expect(insertReport(f, f.worker, "2026-03-03", "08:00", "09:00", 60)).rejects.toThrow(/check constraint/);
    await expect(insertReport(f, f.worker, "2026-03-03", "08:00", "17:00", -10)).rejects.toThrow(/check constraint/);
  });

  it("작업내용이 비어 있거나 실적률이 범위를 벗어나면 저장할 수 없다", async () => {
    const id = await createReport(f, f.worker, "2026-03-04", null);
    const add = (cols: string, vals: string, params: unknown[]) =>
      asUser(f.worker, (q) =>
        q(`insert into dw_report_items (report_id, project_id, ${cols}) values ($1, $2, ${vals})`, [
          id,
          f.projectA,
          ...params,
        ]),
      );
    await expect(add("content", "$3", ["   "])).rejects.toThrow(/check constraint/);
    await expect(add("content, process_progress", "$3, $4", ["작업", 120])).rejects.toThrow(/check constraint/);
    await expect(add("content, quantity", "$3, $4", ["작업", -1])).rejects.toThrow(/check constraint/);
    await expect(add("content, status", "$3, $4", ["작업", "unknown"])).rejects.toThrow(/check constraint/);
    await expect(add("content, process_id", "$3, $4", ["작업", f.processB1])).rejects.toThrow(/다른 사업장의 공정/);
  });

  it("작성자가 상태를 승인으로 직접 바꿀 수 없다", async () => {
    const id = await createReport(f, f.worker, "2026-03-05");
    await expect(
      asUser(f.worker, (q) => q("update dw_daily_reports set status = 'approved' where id = $1", [id])),
    ).rejects.toThrow(/제출·승인 절차를 통해서만/);
    const [forced] = await asUser(f.worker2, (q) =>
      q(
        `insert into dw_daily_reports (project_id, author_id, work_date, start_time, end_time, status, approved_at)
         values ($1, $2, '2026-03-05', '08:00', '17:00', 'approved', now()) returning status, approved_at`,
        [f.projectA, f.worker2],
      ),
    );
    expect(forced).toMatchObject({ status: "draft", approved_at: null });
  });
});

describe("중복 제출", () => {
  it("같은 사업장·작성자·작업일의 작업일보는 1건만 만들 수 있다", async () => {
    await createReport(f, f.worker, "2026-03-10");
    await expect(createReport(f, f.worker, "2026-03-10")).rejects.toThrow(/duplicate key/);
    // 다른 사람은 같은 날짜에 작성할 수 있다
    await expect(createReport(f, f.worker2, "2026-03-10")).resolves.toBeTruthy();
  });

  it("이미 제출한 작업일보는 다시 제출할 수 없다", async () => {
    const id = await createReport(f, f.worker, "2026-03-11");
    await submit(f.worker, id);
    await expect(submit(f.worker, id)).rejects.toThrow(/이미 제출된 작업일보/);
    const reviews = await sql("select action from dw_report_reviews where report_id = $1", [id]);
    expect(reviews).toHaveLength(1);
  });

  it("작업내역이 없거나 미래 날짜이면 제출할 수 없다", async () => {
    const empty = await createReport(f, f.worker, "2026-03-12", null);
    await expect(submit(f.worker, empty)).rejects.toThrow(/작업내역을 1건 이상/);
    const future = await createReport(f, f.worker, "2999-01-01");
    await expect(submit(f.worker, future)).rejects.toThrow(/미래 날짜/);
  });

  it("타인의 작업일보는 제출할 수 없다", async () => {
    const id = await createReport(f, f.worker, "2026-03-13");
    await expect(submit(f.worker2, id)).rejects.toThrow(/본인의 작업일보만/);
  });
});

describe("승인 및 보완 요청", () => {
  it("제출 후에는 작성자가 내용을 수정할 수 없다", async () => {
    const id = await createReport(f, f.worker, "2026-04-01");
    await submit(f.worker, id);
    const updated = await asUser(f.worker, (q) =>
      q("update dw_daily_reports set notes = '변경' where id = $1 returning id", [id]),
    );
    expect(updated).toHaveLength(0);
    await expect(
      asUser(f.worker, (q) =>
        q("insert into dw_report_items (report_id, project_id, content) values ($1, $2, '추가')", [id, f.projectA]),
      ),
    ).rejects.toThrow(/row-level security/);
    const deleted = await asUser(f.worker, (q) => q("delete from dw_daily_reports where id = $1 returning id", [id]));
    expect(deleted).toHaveLength(0);
  });

  it("현장팀은 승인할 수 없고, 관리자도 본인 일보는 승인할 수 없다", async () => {
    const id = await createReport(f, f.worker, "2026-04-02");
    await submit(f.worker, id);
    await expect(review(f.worker2, id, "approved")).rejects.toThrow(/검토할 권한이 없습니다/);
    await expect(review(f.worker, id, "approved")).rejects.toThrow(/검토할 권한이 없습니다/);

    const own = await createReport(f, f.manager, "2026-04-02");
    await submit(f.manager, own);
    await expect(review(f.manager, own, "approved")).rejects.toThrow(/본인이 작성한 작업일보/);
    await review(f.ceo, own, "approved");
    const [row] = await sql("select status, approved_by from dw_daily_reports where id = $1", [own]);
    expect(row).toMatchObject({ status: "approved", approved_by: f.ceo });
  });

  it("작성중인 일보는 검토할 수 없다", async () => {
    const id = await createReport(f, f.worker, "2026-04-03");
    await expect(review(f.manager, id, "approved")).rejects.toThrow(/제출 상태의 작업일보만/);
  });

  it("보완 요청은 사유가 필요하고, 보완 후 재제출하면 다시 검토할 수 있다", async () => {
    const id = await createReport(f, f.worker, "2026-04-06");
    await submit(f.worker, id);
    await expect(review(f.manager, id, "revision_requested", " ")).rejects.toThrow(/보완 요청 사유/);
    await review(f.manager, id, "revision_requested", "작업 수량을 기재해 주세요");

    const edited = await asUser(f.worker, (q) =>
      q("update dw_daily_reports set notes = '수량 보완' where id = $1 returning status", [id]),
    );
    expect(edited[0].status).toBe("revision_requested");
    await submit(f.worker, id);
    await review(f.manager, id, "approved", "확인");

    const actions = await sql("select action from dw_report_reviews where report_id = $1 order by created_at", [id]);
    expect(actions.map((a) => a.action)).toEqual(["submitted", "revision_requested", "resubmitted", "approved"]);
    const notes = await sql("select type from dw_notifications where user_id = $1 and link = $2 order by created_at", [
      f.worker,
      `/reports/${id}`,
    ]);
    expect(notes.map((n) => n.type)).toEqual(["report_revision_requested", "report_approved"]);
    const managerNotes = await sql(
      "select count(*)::int as n from dw_notifications where user_id = $1 and type = 'report_submitted' and link = $2",
      [f.manager, `/reports/${id}`],
    );
    expect(managerNotes[0].n).toBe(2);
  });

  it("승인하면 연결된 업무와 공정 실적에 반영된다", async () => {
    const id = await createReport(f, f.worker, "2026-04-07", {
      content: "터파기 60% 완료",
      process_id: f.processA1,
      task_id: f.taskWorker,
      task_progress: 60,
      process_progress: 45,
    });
    await submit(f.worker, id);
    await review(f.manager, id, "approved");
    const [task] = await sql("select status, progress from dw_tasks where id = $1", [f.taskWorker]);
    expect(task).toMatchObject({ status: "in_progress", progress: 60 });
    const [proc] = await sql("select progress::float, actual_start::text from dw_processes where id = $1", [f.processA1]);
    expect(proc).toMatchObject({ progress: 45, actual_start: "2026-04-07" });
    const [log] = await sql(
      "select log_date::text, progress::float, source_report_id from dw_process_progress_logs where process_id = $1",
      [f.processA1],
    );
    expect(log).toMatchObject({ log_date: "2026-04-07", progress: 45, source_report_id: id });
  });

  it("이전 작업일의 일보를 나중에 승인해도 최신 공정 실적률을 덮어쓰지 않는다", async () => {
    const older = await createReport(f, f.worker2, "2026-04-01", {
      content: "이전 실적",
      process_id: f.processA1,
      process_progress: 20,
    });
    await submit(f.worker2, older);
    await review(f.manager, older, "approved");
    const [proc] = await sql("select progress::float, actual_start::text from dw_processes where id = $1", [f.processA1]);
    expect(proc).toMatchObject({ progress: 45, actual_start: "2026-04-01" });
  });

  it("완료로 보고한 작업내역은 업무를 완료 처리한다", async () => {
    const id = await createReport(f, f.partner, "2026-04-08", {
      content: "배관 완료",
      task_id: f.taskPartner,
      status: "completed",
    });
    await submit(f.partner, id);
    await review(f.manager, id, "approved");
    const [task] = await sql("select status, progress, completed_at from dw_tasks where id = $1", [f.taskPartner]);
    expect(task.status).toBe("done");
    expect(task.progress).toBe(100);
    expect(task.completed_at).not.toBeNull();
  });
});

describe("승인 완료 후 수정 요청과 변경 이력", () => {
  it("수정 요청 → 승인 → 수정 → 재승인 과정이 이력에 남는다", async () => {
    const id = await createReport(f, f.worker, "2026-04-20");
    await submit(f.worker, id);

    await expect(
      asUser(f.worker, (q) => q("select dw_request_report_change($1, '오타 수정')", [id])),
    ).rejects.toThrow(/승인 완료된 작업일보만/);
    await review(f.manager, id, "approved");

    // 승인된 일보는 직접 수정 불가
    const direct = await asUser(f.worker, (q) =>
      q("update dw_daily_reports set notes = '몰래 수정' where id = $1 returning id", [id]),
    );
    expect(direct).toHaveLength(0);

    await expect(asUser(f.worker, (q) => q("select dw_request_report_change($1, '')", [id]))).rejects.toThrow(/사유/);
    await expect(
      asUser(f.worker2, (q) => q("select dw_request_report_change($1, '대리 요청')", [id])),
    ).rejects.toThrow(/본인의 작업일보만/);
    const [{ dw_request_report_change: requestId }] = await asUser(f.worker, (q) =>
      q("select dw_request_report_change($1, '작업 수량 오기재')", [id]),
    );
    await expect(
      asUser(f.worker, (q) => q("select dw_request_report_change($1, '중복 요청')", [id])),
    ).rejects.toThrow(/이미 처리 대기 중/);

    await expect(
      asUser(f.worker, (q) => q("select dw_review_change_request($1, true)", [requestId])),
    ).rejects.toThrow(/권한이 없습니다/);
    await asUser(f.manager, (q) => q("select dw_review_change_request($1, true, '수정하세요')", [requestId]));
    await expect(
      asUser(f.manager, (q) => q("select dw_review_change_request($1, true)", [requestId])),
    ).rejects.toThrow(/이미 처리된/);

    const [reopened] = await sql("select status, approved_at from dw_daily_reports where id = $1", [id]);
    expect(reopened).toMatchObject({ status: "revision_requested", approved_at: null });

    await asUser(f.worker, (q) => q("update dw_daily_reports set notes = '수량 정정' where id = $1", [id]));
    await submit(f.worker, id);
    await review(f.manager, id, "approved");

    const actions = await sql("select action from dw_report_reviews where report_id = $1 order by created_at", [id]);
    expect(actions.map((a) => a.action)).toEqual([
      "submitted",
      "approved",
      "change_requested",
      "change_approved",
      "resubmitted",
      "approved",
    ]);

    const audit = await sql(
      `select old_data ->> 'notes' as old_notes, new_data ->> 'notes' as new_notes, actor_id
       from dw_audit_logs
       where table_name = 'daily_reports' and record_id = $1 and 'notes' = any(changed_fields)`,
      [id],
    );
    expect(audit).toEqual([{ old_notes: null, new_notes: "수량 정정", actor_id: f.worker }]);
    const statusAudit = await sql(
      `select new_data ->> 'status' as status from dw_audit_logs
       where table_name = 'daily_reports' and record_id = $1 and 'status' = any(changed_fields) order by id`,
      [id],
    );
    expect(statusAudit.map((s) => s.status)).toEqual([
      "submitted",
      "approved",
      "revision_requested",
      "submitted",
      "approved",
    ]);
  });

  it("수정 요청을 반려하면 승인 상태가 유지된다", async () => {
    const id = await createReport(f, f.worker, "2026-04-21");
    await submit(f.worker, id);
    await review(f.manager, id, "approved");
    const [{ dw_request_report_change: requestId }] = await asUser(f.worker, (q) =>
      q("select dw_request_report_change($1, '내용 변경 희망')", [id]),
    );
    await asUser(f.manager, (q) => q("select dw_review_change_request($1, false, '변경 불필요')", [requestId]));
    const [row] = await sql("select status from dw_daily_reports where id = $1", [id]);
    expect(row.status).toBe("approved");
    const [cr] = await sql("select status, reviewer_id from dw_change_requests where id = $1", [requestId]);
    expect(cr).toMatchObject({ status: "rejected", reviewer_id: f.manager });
  });
});

describe("작업일보 일괄 저장(save_report)", () => {
  const data = (items: unknown[], extra: Record<string, unknown> = {}) =>
    JSON.stringify({ work_date: "2026-05-06", start_time: "08:00", end_time: "17:00", break_minutes: 60, items, ...extra });
  const item = (content: string, extra: Record<string, unknown> = {}) => ({ content, status: "in_progress", ...extra });

  it("작업일보와 여러 작업내역을 함께 저장하고, 수정 시 추가·변경·삭제를 반영한다", async () => {
    const [{ dw_save_report: id }] = await asUser(f.worker, (q) =>
      q("select dw_save_report($1, null, $2)", [f.projectA, data([item("내역1"), item("내역2", { quantity: 3, unit: "개" })])]),
    );
    const before = await sql("select id, content from dw_report_items where report_id = $1 order by sort_order", [id]);
    expect(before.map((i) => i.content)).toEqual(["내역1", "내역2"]);

    await asUser(f.worker, (q) =>
      q("select dw_save_report($1, $2, $3)", [
        f.projectA,
        id,
        data([item("내역2 수정", { id: before[1].id }), item("내역3")], { notes: "특이사항" }),
      ]),
    );
    const after = await sql("select id, content, sort_order from dw_report_items where report_id = $1 order by sort_order", [id]);
    expect(after.map((i) => i.content)).toEqual(["내역2 수정", "내역3"]);
    expect(after[0].id).toBe(before[1].id);
    const [row] = await sql("select notes, author_id from dw_daily_reports where id = $1", [id]);
    expect(row).toMatchObject({ notes: "특이사항", author_id: f.worker });
  });

  it("작업내역 하나라도 잘못되면 전체 저장이 취소된다", async () => {
    await expect(
      asUser(f.worker2, (q) =>
        q("select dw_save_report($1, null, $2)", [f.projectA, data([item("정상"), item("범위 초과", { process_progress: 150 })])]),
      ),
    ).rejects.toThrow(/check constraint/);
    const rows = await sql("select id from dw_daily_reports where author_id = $1 and work_date = '2026-05-06'", [f.worker2]);
    expect(rows).toHaveLength(0);
  });

  it("타인의 작업일보나 제출된 작업일보는 저장할 수 없다", async () => {
    const [{ dw_save_report: id }] = await asUser(f.worker2, (q) =>
      q("select dw_save_report($1, null, $2)", [f.projectA, data([item("내역")])]),
    );
    await expect(
      asUser(f.worker, (q) => q("select dw_save_report($1, $2, $3)", [f.projectA, id, data([item("변조")])])),
    ).rejects.toThrow(/수정할 수 없는 작업일보/);
    await submit(f.worker2, id);
    await expect(
      asUser(f.worker2, (q) => q("select dw_save_report($1, $2, $3)", [f.projectA, id, data([item("제출 후 수정")])])),
    ).rejects.toThrow(/수정할 수 없는 작업일보/);
    await expect(
      asUser(f.managerB, (q) => q("select dw_save_report($1, null, $2)", [f.projectA, data([item("타 사업장")])])),
    ).rejects.toThrow(/row-level security/);
  });
});
