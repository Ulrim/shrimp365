import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createFixture, createReport, pool, review, sql, submit, type Fixture, type Query } from "./helpers";

let f: Fixture;
let approvedReport: string;
let draftReport: string;

beforeAll(async () => {
  f = await createFixture();
  approvedReport = await createReport(f, f.worker, "2026-05-11");
  await submit(f.worker, approvedReport);
  await review(f.manager, approvedReport, "approved");
  draftReport = await createReport(f, f.worker, "2026-05-12");
});
afterAll(() => pool.end());

describe("역할별 접근 권한", () => {
  it("비로그인 사용자는 어떤 데이터도 조회할 수 없다", async () => {
    await expect(asUser(null, (q) => q("select * from dw_projects"))).rejects.toThrow(/permission denied/);
    await expect(asUser(null, (q) => q("select * from dw_daily_reports"))).rejects.toThrow(/permission denied/);
  });

  it("회장·대표이사는 모든 사업장을 조회한다", async () => {
    for (const user of [f.chairman, f.ceo]) {
      const rows = await asUser(user, (q) =>
        q("select id from dw_projects where id in ($1, $2)", [f.projectA, f.projectB]),
      );
      expect(rows).toHaveLength(2);
    }
  });

  it("현장팀은 소속 사업장만 조회한다", async () => {
    const projects = await asUser(f.worker, (q) => q("select id from dw_projects"));
    expect(projects.map((p) => p.id)).toEqual([f.projectA]);
    const processes = await asUser(f.worker, (q) => q("select id from dw_processes where id = $1", [f.processB1]));
    expect(processes).toHaveLength(0);
  });

  it("타 사업장 현장관리자는 이 사업장의 작업일보를 보거나 승인할 수 없다", async () => {
    const rows = await asUser(f.managerB, (q) => q("select id from dw_daily_reports where project_id = $1", [f.projectA]));
    expect(rows).toHaveLength(0);
    const pending = await createReport(f, f.worker2, "2026-05-11");
    await submit(f.worker2, pending);
    await expect(review(f.managerB, pending, "approved")).rejects.toThrow(/검토할 권한이 없습니다/);
  });

  it("현장팀은 타인의 승인된 일보만 볼 수 있고 작성중 일보는 볼 수 없다", async () => {
    const rows = await asUser(f.worker2, (q) =>
      q("select id from dw_daily_reports where id in ($1, $2)", [approvedReport, draftReport]),
    );
    expect(rows.map((r) => r.id)).toEqual([approvedReport]);
  });

  it("협력업체는 배정된 업무와 본인 일보만 본다", async () => {
    const tasks = await asUser(f.partner, (q) => q("select id from dw_tasks where project_id = $1", [f.projectA]));
    expect(tasks.map((t) => t.id)).toEqual([f.taskPartner]);
    const reports = await asUser(f.partner, (q) => q("select id from dw_daily_reports"));
    expect(reports).toHaveLength(0);
    const consolidated = await asUser(f.partner, (q) => q("select id from dw_consolidated_reports"));
    expect(consolidated).toHaveLength(0);
    await expect(
      asUser(f.partner, (q) => q("select * from dw_submission_status($1, '2026-05-11')", [f.projectA])),
    ).rejects.toThrow(/권한이 없습니다/);
  });

  it("협력업체도 본인 작업일보는 작성할 수 있다", async () => {
    const id = await createReport(f, f.partner, "2026-05-11", { content: "배관 작업", task_id: f.taskPartner });
    await submit(f.partner, id);
    const [row] = await sql("select status from dw_daily_reports where id = $1", [id]);
    expect(row.status).toBe("submitted");
  });

  it("현장팀은 업무 배정·공정 등록을 할 수 없고 현장관리자는 할 수 있다", async () => {
    const insertTask = (q: Query) =>
      q("insert into dw_tasks (project_id, title, assignee_id) values ($1, '신규 업무', $2) returning id", [
        f.projectA,
        f.worker2,
      ]);
    await expect(asUser(f.worker, insertTask)).rejects.toThrow(/row-level security/);
    await expect(
      asUser(f.worker, (q) =>
        q(
          "insert into dw_processes (project_id, name, planned_start, planned_end) values ($1, '임의 공정', '2026-01-01', '2026-02-01')",
          [f.projectA],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const created = await asUser(f.manager, insertTask);
    expect(created).toHaveLength(1);
    const notes = await sql("select type from dw_notifications where user_id = $1 and type = 'task_assigned'", [f.worker2]);
    expect(notes).toHaveLength(1);
  });

  it("현장팀은 타인의 업무를 수정할 수 없고 본인 업무 진행상태만 갱신한다", async () => {
    const updated = await asUser(f.worker, (q) =>
      q("update dw_tasks set title = '변조' where id = $1 returning id", [f.taskWorker]),
    );
    expect(updated).toHaveLength(0);
    await asUser(f.worker, (q) => q("select dw_update_my_task($1, 'in_progress', 40)", [f.taskWorker]));
    const [task] = await sql("select status, progress from dw_tasks where id = $1", [f.taskWorker]);
    expect(task).toMatchObject({ status: "in_progress", progress: 40 });
    await expect(
      asUser(f.worker2, (q) => q("select dw_update_my_task($1, 'done', 100)", [f.taskWorker])),
    ).rejects.toThrow(/본인에게 배정된 업무만/);
  });

  it("다른 사업장 구성원을 담당자로 지정할 수 없다", async () => {
    await expect(
      asUser(f.manager, (q) =>
        q("insert into dw_tasks (project_id, title, assignee_id) values ($1, '외부 배정', $2)", [f.projectA, f.managerB]),
      ),
    ).rejects.toThrow(/사업장 구성원이어야/);
  });

  it("일반 사용자는 자신의 역할·활성 여부를 바꿀 수 없다", async () => {
    await expect(
      asUser(f.worker, (q) => q("update dw_profiles set global_role = 'ceo' where id = $1", [f.worker])),
    ).rejects.toThrow(/관리자만 변경/);
    await asUser(f.worker, (q) => q("update dw_profiles set phone = '010-0000-0000' where id = $1", [f.worker]));
    const others = await asUser(f.worker, (q) =>
      q("update dw_profiles set full_name = '변조' where id = $1 returning id", [f.worker2]),
    );
    expect(others).toHaveLength(0);
  });

  it("현장관리자 지정은 회장/대표이사만 할 수 있다", async () => {
    await expect(
      asUser(f.manager, (q) =>
        q("update dw_project_members set role = 'site_manager' where project_id = $1 and user_id = $2 returning role", [
          f.projectA,
          f.worker2,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    const rows = await asUser(f.ceo, (q) =>
      q("update dw_project_members set role = 'site_worker' where project_id = $1 and user_id = $2 returning role", [
        f.projectA,
        f.worker2,
      ]),
    );
    expect(rows).toHaveLength(1);
    await expect(
      asUser(f.worker, (q) =>
        q("insert into dw_project_members (project_id, user_id, role) values ($1, $2, 'site_worker')", [
          f.projectB,
          f.worker,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("비활성 사용자는 소속 사업장 데이터도 볼 수 없다", async () => {
    const projects = await asUser(f.inactive, (q) => q("select id from dw_projects"));
    expect(projects).toHaveLength(0);
    await expect(
      asUser(f.inactive, (q) =>
        q(
          "insert into dw_daily_reports (project_id, author_id, work_date, start_time, end_time) values ($1, $2, '2026-05-11', '08:00', '17:00')",
          [f.projectA, f.inactive],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("타인 명의로 작업일보를 작성할 수 없다", async () => {
    await expect(
      asUser(f.worker2, (q) =>
        q(
          "insert into dw_daily_reports (project_id, author_id, work_date, start_time, end_time) values ($1, $2, '2026-05-20', '08:00', '17:00')",
          [f.projectA, f.worker],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("변경 이력은 관리자만 조회하고 누구도 직접 수정할 수 없다", async () => {
    const workerLogs = await asUser(f.worker, (q) => q("select id from dw_audit_logs"));
    expect(workerLogs).toHaveLength(0);
    const managerLogs = await asUser(f.manager, (q) => q("select id from dw_audit_logs where project_id = $1", [f.projectA]));
    expect(managerLogs.length).toBeGreaterThan(0);
    await expect(asUser(f.manager, (q) => q("delete from dw_audit_logs"))).rejects.toThrow(/permission denied/);
    await expect(
      asUser(f.manager, (q) =>
        q("insert into dw_report_reviews (report_id, project_id, action) values ($1, $2, 'approved')", [
          draftReport,
          f.projectA,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("알림은 본인 것만 조회한다", async () => {
    const rows = await asUser(f.worker2, (q) => q("select user_id from dw_notifications"));
    expect(rows.every((r) => r.user_id === f.worker2)).toBe(true);
    const mine = await asUser(f.worker, (q) => q("select type from dw_notifications where type = 'report_approved'"));
    expect(mine).toHaveLength(1);
  });

  it("사진 저장소: 본인의 작성중 일보에만 올릴 수 있다", async () => {
    const path = `${f.projectA}/${draftReport}/a.jpg`;
    const upload = (q: Query) => q("insert into storage.objects (bucket_id, name) values ('dw-report-photos', $1)", [path]);
    await expect(asUser(f.worker2, upload)).rejects.toThrow(/row-level security/);
    await asUser(f.worker, upload);
    await asUser(f.worker, (q) =>
      q("insert into dw_report_photos (report_id, project_id, storage_path) values ($1, $2, $3)", [
        draftReport,
        f.projectA,
        path,
      ]),
    );
    // 다른 현장팀원은 작성중 일보의 사진을 볼 수 없고, 관리자는 볼 수 있다
    expect(await asUser(f.worker2, (q) => q("select id from storage.objects where name = $1", [path]))).toHaveLength(0);
    expect(await asUser(f.manager, (q) => q("select id from storage.objects where name = $1", [path]))).toHaveLength(1);
    // 승인된 일보에는 추가 업로드 불가
    await expect(
      asUser(f.worker, (q) =>
        q("insert into storage.objects (bucket_id, name) values ('dw-report-photos', $1)", [
          `${f.projectA}/${approvedReport}/b.jpg`,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    // 경로가 일보와 맞지 않으면 사진 기록을 남길 수 없다
    await expect(
      asUser(f.worker, (q) =>
        q("insert into dw_report_photos (report_id, project_id, storage_path) values ($1, $2, $3)", [
          draftReport,
          f.projectA,
          `${f.projectB}/${draftReport}/c.jpg`,
        ]),
      ),
    ).rejects.toThrow(/사진 경로가 올바르지 않습니다/);
  });
});
