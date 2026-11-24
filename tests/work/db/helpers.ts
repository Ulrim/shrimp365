import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { TEST_DATABASE_URL } from "./global-setup";

export const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });

// pg 가 돌려주는 행은 질의마다 모양이 달라 값 타입을 좁히지 않는다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
export type Query = (sql: string, params?: unknown[]) => Promise<Row[]>;

/** 관리자(슈퍼유저) 권한으로 실행. 테스트 데이터 준비·검증용. */
export const sql: Query = async (text, params) => (await pool.query(text, params as unknown[])).rows;

/** 로그인 사용자 권한(RLS 적용)으로 한 트랜잭션을 실행한다. userId 가 null 이면 비로그인(anon). */
export async function asUser<T>(userId: string | null, fn: (q: Query) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${userId ? "authenticated" : "anon"}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      userId ? JSON.stringify({ sub: userId, role: "authenticated" }) : "",
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

/** auth.users 에 계정만 만든다(shrimp365 가입에 해당). 현장관리 프로필은 생기지 않는다. */
export async function createAuthUser(
  email: string = `${randomUUID()}@test.local`,
  opts: { confirmed?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await sql("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)", [
    id,
    email,
    opts.confirmed === false ? null : new Date(),
  ]);
  return id;
}

/**
 * 현장관리 구성원을 만든다. 원본은 auth.users 트리거(handle_new_user)가 프로필을 만들었지만
 * 이식본에는 그 트리거가 없으므로 프로필을 직접 넣는다(초대·수락 경로는 invites.test.ts 가 검증한다).
 */
export async function createUser(
  name: string,
  opts: { globalRole?: "chairman" | "ceo"; active?: boolean; company?: string } = {},
): Promise<string> {
  const email = `${randomUUID()}@test.local`;
  const id = await createAuthUser(email);
  await sql(
    "insert into dw_profiles (id, email, full_name, company, global_role, is_active) values ($1, $2, $3, $4, $5, $6)",
    [id, email, name, opts.company ?? "컬리버", opts.globalRole ?? null, opts.active !== false],
  );
  return id;
}

export interface Fixture {
  projectA: string;
  projectB: string;
  chairman: string;
  ceo: string;
  manager: string;
  managerB: string;
  worker: string;
  worker2: string;
  partner: string;
  inactive: string;
  processA1: string; // 가중치 30
  processA2: string; // 가중치 70
  processB1: string;
  taskWorker: string;
  taskPartner: string;
}

/** 사업장 A/B 와 역할별 사용자를 새로 만든다. 호출할 때마다 독립된 데이터가 생긴다. */
export async function createFixture(): Promise<Fixture> {
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const [a] = await sql(
    "insert into dw_projects (code, name, start_date, end_date) values ($1, '고흥 스마트팜 A', '2026-01-01', '2026-12-31') returning id",
    [`A-${tag}`],
  );
  const [b] = await sql("insert into dw_projects (code, name) values ($1, '타 사업장 B') returning id", [`B-${tag}`]);
  const f = {
    projectA: a.id,
    projectB: b.id,
    chairman: await createUser("회장", { globalRole: "chairman" }),
    ceo: await createUser("대표이사", { globalRole: "ceo" }),
    manager: await createUser("현장관리자"),
    managerB: await createUser("B현장관리자"),
    worker: await createUser("현장팀원1"),
    worker2: await createUser("현장팀원2"),
    partner: await createUser("협력업체", { company: "협력사" }),
    inactive: await createUser("퇴사자", { active: false }),
  };
  await sql(
    `insert into dw_project_members (project_id, user_id, role) values
      ($1, $3, 'site_manager'), ($1, $5, 'site_worker'), ($1, $6, 'site_worker'),
      ($1, $7, 'partner'), ($1, $8, 'site_worker'), ($2, $4, 'site_manager')`,
    [f.projectA, f.projectB, f.manager, f.managerB, f.worker, f.worker2, f.partner, f.inactive],
  );
  const [p1] = await sql(
    "insert into dw_processes (project_id, name, sort_order, weight, planned_start, planned_end) values ($1, '토목공사', 1, 30, '2026-01-01', '2026-03-31') returning id",
    [f.projectA],
  );
  const [p2] = await sql(
    "insert into dw_processes (project_id, name, sort_order, weight, planned_start, planned_end) values ($1, '온실 골조', 2, 70, '2026-04-01', '2026-09-30') returning id",
    [f.projectA],
  );
  const [pb] = await sql(
    "insert into dw_processes (project_id, name, weight, planned_start, planned_end) values ($1, 'B공정', 1, '2026-01-01', '2026-12-31') returning id",
    [f.projectB],
  );
  const [t1] = await sql(
    "insert into dw_tasks (project_id, process_id, title, assignee_id) values ($1, $2, '기초 터파기', $3) returning id",
    [f.projectA, p1.id, f.worker],
  );
  const [t2] = await sql(
    "insert into dw_tasks (project_id, process_id, title, assignee_id) values ($1, $2, '전기 배관', $3) returning id",
    [f.projectA, p2.id, f.partner],
  );
  return {
    ...f,
    processA1: p1.id,
    processA2: p2.id,
    processB1: pb.id,
    taskWorker: t1.id,
    taskPartner: t2.id,
  };
}

/** 작성자 권한으로 작업일보(작성중)와 작업내역 1건을 만든다. */
export async function createReport(
  f: Fixture,
  authorId: string,
  workDate: string,
  item: Record<string, unknown> | null = { content: "터파기 작업", process_id: null },
): Promise<string> {
  return asUser(authorId, async (q) => {
    const [r] = await q(
      `insert into dw_daily_reports (project_id, author_id, work_date, start_time, end_time, break_minutes)
       values ($1, $2, $3, '08:00', '17:00', 60) returning id`,
      [f.projectA, authorId, workDate],
    );
    if (item) {
      await q(
        `insert into dw_report_items (report_id, project_id, process_id, task_id, content, status, task_progress, process_progress)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          r.id,
          f.projectA,
          item.process_id ?? null,
          item.task_id ?? null,
          item.content ?? "작업",
          item.status ?? "in_progress",
          item.task_progress ?? null,
          item.process_progress ?? null,
        ],
      );
    }
    return r.id as string;
  });
}

export const submit = (userId: string, reportId: string) =>
  asUser(userId, (q) => q("select dw_submit_report($1)", [reportId]));

export const review = (userId: string, reportId: string, decision: string, comment: string | null = null) =>
  asUser(userId, (q) => q("select dw_review_report($1, $2, $3)", [reportId, decision, comment]));
