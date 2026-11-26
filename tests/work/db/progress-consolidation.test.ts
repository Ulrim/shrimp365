import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createFixture, createReport, pool, review, sql, submit, type Fixture, type Row } from "./helpers";

let f: Fixture;
beforeAll(async () => {
  f = await createFixture();
});
afterAll(() => pool.end());

describe("공정률 산출", () => {
  it("계획 공정률은 계획 기간 대비 경과일의 선형 값이다", async () => {
    const [row] = await sql(
      `select dw_planned_progress('2026-01-01', '2026-01-10', '2025-12-31')::float as before,
              dw_planned_progress('2026-01-01', '2026-01-10', '2026-01-01')::float as first_day,
              dw_planned_progress('2026-01-01', '2026-01-10', '2026-01-05')::float as mid,
              dw_planned_progress('2026-01-01', '2026-01-10', '2026-01-10')::float as last_day,
              dw_planned_progress('2026-01-01', '2026-01-10', '2026-02-01')::float as after`,
    );
    expect(row).toEqual({ before: 0, first_day: 10, mid: 50, last_day: 100, after: 100 });
  });

  it("전체 공정률 = Σ(가중치 × 실적률) ÷ Σ가중치", async () => {
    await asUser(f.manager, (q) => q("update dw_processes set progress = 50 where id = $1", [f.processA1]));
    await asUser(f.manager, (q) => q("update dw_processes set progress = 20 where id = $1", [f.processA2]));
    const [row] = await asUser(f.worker, (q) =>
      q("select actual::float, total_weight::float from dw_project_progress($1)", [f.projectA]),
    );
    // (30 × 50 + 70 × 20) ÷ 100 = 29
    expect(row).toEqual({ actual: 29, total_weight: 100 });
  });

  it("계획 공정률도 같은 가중 평균으로 계산한다", async () => {
    // 2026-03-31: 토목(1/1~3/31) 100%, 골조(4/1~9/30) 0% → 30
    const [row] = await asUser(f.worker, (q) =>
      q("select planned::float from dw_project_progress($1, '2026-03-31')", [f.projectA]),
    );
    expect(row.planned).toBe(30);
  });

  it("공정이 없거나 가중치 합이 0이면 0%로 계산한다", async () => {
    const [empty] = await sql("insert into dw_projects (code, name) values ($1, '빈 사업장') returning id", [
      `E-${f.projectA.slice(0, 8).toUpperCase()}`,
    ]);
    const [row] = await sql("select actual::float, planned::float from dw_project_progress($1)", [empty.id]);
    expect(row).toEqual({ actual: 0, planned: 0 });
    await sql(
      "insert into dw_processes (project_id, name, weight, planned_start, planned_end, progress) values ($1, '가중치 없음', 0, '2026-01-01', '2026-01-31', 80)",
      [empty.id],
    );
    const [zero] = await sql("select actual::float from dw_project_progress($1)", [empty.id]);
    expect(zero.actual).toBe(0);
  });

  it("과거 일자 기준 공정률은 실적 기록으로 계산한다", async () => {
    await sql("update dw_process_progress_logs set log_date = '2026-02-01' where process_id = $1", [f.processA1]);
    await sql("update dw_process_progress_logs set log_date = '2026-05-01' where process_id = $1", [f.processA2]);
    const [feb] = await sql("select actual::float from dw_project_progress($1, '2026-02-15')", [f.projectA]);
    expect(feb.actual).toBe(15); // 30 × 50 ÷ 100
    const [jan] = await sql("select actual::float from dw_project_progress($1, '2026-01-15')", [f.projectA]);
    expect(jan.actual).toBe(0);
  });

  it("계획 종료일이 지났거나 계획 대비 10%p 이상 뒤처진 공정은 지연으로 표시한다", async () => {
    const rows = await asUser(f.manager, (q) =>
      q("select id, is_delayed, planned_progress::float from dw_process_status where project_id = $1", [f.projectA]),
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    // 테스트 실행일은 두 공정의 계획 종료일(2026-03-31, 2026-09-30) 이후이다
    expect(byId[f.processA1]).toMatchObject({ is_delayed: true, planned_progress: 100 });
    await asUser(f.manager, (q) => q("update dw_processes set progress = 100 where id = $1", [f.processA1]));
    const [done] = await sql("select is_delayed from dw_process_status where id = $1", [f.processA1]);
    expect(done.is_delayed).toBe(false);
  });

  it("실적률과 가중치는 허용 범위를 벗어날 수 없다", async () => {
    const update = (expr: string) =>
      asUser(f.manager, (q) => q(`update dw_processes set ${expr} where id = $1`, [f.processA2]));
    await expect(update("progress = 101")).rejects.toThrow(/check constraint/);
    await expect(update("weight = -1")).rejects.toThrow(/check constraint/);
    await expect(update("planned_end = planned_start - 1")).rejects.toThrow(/check constraint/);
  });
});

describe("통합 작업일보·보고서 자동 취합", () => {
  const date = "2026-06-15";
  let approved1: string;
  let approved2: string;
  let submittedOnly: string;

  beforeAll(async () => {
    approved1 = await createReport(f, f.worker, date, { content: "골조 조립", process_id: f.processA2 });
    approved2 = await createReport(f, f.worker2, date, { content: "골조 볼트 체결", process_id: f.processA2 });
    submittedOnly = await createReport(f, f.partner, date, { content: "미승인 작업" });
    await asUser(f.worker, (q) =>
      q("update dw_daily_reports set notes = '자재 반입 지연', next_day_plan = '2동 조립' where id = $1", [approved1]),
    );
    for (const [user, id] of [
      [f.worker, approved1],
      [f.worker2, approved2],
      [f.partner, submittedOnly],
    ]) {
      await submit(user, id);
    }
    await review(f.manager, approved1, "approved");
    await review(f.manager, approved2, "approved");
  });

  it("승인된 작업일보만 통합 작업일보에 반영된다", async () => {
    const [row] = await asUser(f.worker, (q) =>
      q("select snapshot from dw_consolidated_reports where project_id = $1 and report_date = $2", [f.projectA, date]),
    );
    const s = row.snapshot;
    expect(s.worker_count).toBe(2);
    expect(s.total_work_minutes).toBe(960);
    expect(s.reports.map((r: Row) => r.author_name)).toEqual(["현장팀원1", "현장팀원2"]);
    expect(JSON.stringify(s)).not.toContain("미승인 작업");
    expect(s.by_process).toHaveLength(1);
    expect(s.by_process[0]).toMatchObject({ process_name: "온실 골조", worker_count: 2 });
    expect(s.by_process[0].items).toHaveLength(2);
    expect(s.issues).toEqual([{ author_name: "현장팀원1", text: "자재 반입 지연" }]);
    expect(s.next_day_plans).toEqual([{ author_name: "현장팀원1", text: "2동 조립" }]);
  });

  it("제출 현황은 미작성·미제출 인원을 구분한다", async () => {
    const rows = await asUser(f.manager, (q) => q("select * from dw_submission_status($1, $2)", [f.projectA, date]));
    const status = Object.fromEntries(rows.map((r) => [r.full_name, r.status]));
    expect(status).toEqual({ 현장관리자: null, 현장팀원1: "approved", 현장팀원2: "approved" });
  });

  it("통합 작업일보 저장·확정은 관리자만 할 수 있다", async () => {
    await expect(
      asUser(f.worker, (q) => q("select dw_save_consolidated_report($1, $2, '맑음', '의견', true)", [f.projectA, date])),
    ).rejects.toThrow(/관리자만/);
    await asUser(f.manager, (q) =>
      q("select dw_save_consolidated_report($1, $2, '맑음', '골조 공정 정상 진행', true)", [f.projectA, date]),
    );
    const [row] = await sql(
      "select weather, summary, is_finalized, finalized_by from dw_consolidated_reports where project_id = $1 and report_date = $2",
      [f.projectA, date],
    );
    expect(row).toMatchObject({ weather: "맑음", summary: "골조 공정 정상 진행", is_finalized: true, finalized_by: f.manager });
  });

  it("확정된 통합 작업일보는 이후 승인으로 바뀌지 않고, 확정 해제 시 다시 취합된다", async () => {
    await review(f.manager, submittedOnly, "approved");
    const [finalized] = await sql(
      "select snapshot from dw_consolidated_reports where project_id = $1 and report_date = $2",
      [f.projectA, date],
    );
    expect(finalized.snapshot.worker_count).toBe(2);
    await asUser(f.manager, (q) =>
      q("select dw_save_consolidated_report($1, $2, '맑음', '재취합', false)", [f.projectA, date]),
    );
    const [reopened] = await sql(
      "select snapshot, is_finalized from dw_consolidated_reports where project_id = $1 and report_date = $2",
      [f.projectA, date],
    );
    expect(reopened.is_finalized).toBe(false);
    expect(reopened.snapshot.worker_count).toBe(3);
  });

  it("수정 요청이 승인되어 승인이 풀린 일보는 통합 작업일보에서 빠진다", async () => {
    const [{ dw_request_report_change: requestId }] = await asUser(f.worker2, (q) =>
      q("select dw_request_report_change($1, '내용 정정')", [approved2]),
    );
    await asUser(f.manager, (q) => q("select dw_review_change_request($1, true)", [requestId]));
    const [row] = await sql("select snapshot from dw_consolidated_reports where project_id = $1 and report_date = $2", [
      f.projectA,
      date,
    ]);
    expect(row.snapshot.worker_count).toBe(2);
    expect(row.snapshot.reports.map((r: Row) => r.author_name)).not.toContain("현장팀원2");
  });
});
