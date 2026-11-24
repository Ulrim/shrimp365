import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATION_FILE } from "./global-setup";
import { asUser, createAuthUser, createFixture, pool, sql, type Fixture } from "./helpers";

let f: Fixture;
beforeAll(async () => {
  f = await createFixture();
});
afterAll(() => pool.end());

const uniqueEmail = (label: string) => `${label}-${Math.random().toString(36).slice(2, 10)}@invite.test`;

const invite = (
  caller: string | null,
  project: string,
  email: string,
  role: string,
  extra: { name?: string; phone?: string; company?: string; position?: string } = {},
) =>
  asUser(caller, async (q) => {
    const [row] = await q("select dw_invite_member($1, $2, $3, $4, $5, $6, $7) as result", [
      project,
      email,
      role,
      extra.name ?? null,
      extra.phone ?? null,
      extra.company ?? null,
      extra.position ?? null,
    ]);
    return row.result as string;
  });

const accept = (userId: string) =>
  asUser(userId, async (q) => {
    const [row] = await q("select dw_accept_invites() as n");
    return row.n as number;
  });

describe("초대와 수락", () => {
  it("가입만으로는 현장관리 프로필이 생기지 않는다", async () => {
    const id = await createAuthUser(uniqueEmail("signup"));
    expect(await sql("select id from dw_profiles where id = $1", [id])).toHaveLength(0);
    expect(await accept(id)).toBe(0);
    expect(await sql("select id from dw_profiles where id = $1", [id])).toHaveLength(0);
    // 프로필이 없는 계정은 사업장 데이터를 볼 수 없다
    expect(await asUser(id, (q) => q("select id from dw_projects"))).toHaveLength(0);
  });

  it("초대 → 수락으로 프로필과 사업장 소속이 만들어지고 초대는 지워진다", async () => {
    const email = uniqueEmail("worker");
    const result = await invite(f.manager, f.projectA, `  ${email.toUpperCase()} `, "site_worker", {
      name: "신규 팀원",
      phone: "010-1111-2222",
      company: "컬리버",
      position: "사원",
    });
    expect(result).toBe("invited");
    const [pending] = await sql("select email, role, invited_by from dw_invites where email = $1", [email]);
    expect(pending).toEqual({ email, role: "site_worker", invited_by: f.manager });

    const id = await createAuthUser(email);
    expect(await accept(id)).toBe(1);
    const [profile] = await sql(
      "select email, full_name, phone, company, position, global_role, is_active from dw_profiles where id = $1",
      [id],
    );
    expect(profile).toEqual({
      email,
      full_name: "신규 팀원",
      phone: "010-1111-2222",
      company: "컬리버",
      position: "사원",
      global_role: null,
      is_active: true,
    });
    const members = await sql("select project_id, role from dw_project_members where user_id = $1", [id]);
    expect(members).toEqual([{ project_id: f.projectA, role: "site_worker" }]);
    expect(await sql("select id from dw_invites where email = $1", [email])).toHaveLength(0);
    // 수락한 사용자는 소속 사업장만 본다
    const projects = await asUser(id, (q) => q("select id from dw_projects"));
    expect(projects.map((p) => p.id)).toEqual([f.projectA]);
    // 다시 불러도 안전하다
    expect(await accept(id)).toBe(0);
  });

  it("이름 없이 초대하면 이메일 @ 앞부분이 이름이 된다", async () => {
    const email = uniqueEmail("noname");
    await invite(f.ceo, f.projectA, email, "partner");
    const id = await createAuthUser(email);
    expect(await accept(id)).toBe(1);
    const [profile] = await sql("select full_name from dw_profiles where id = $1", [id]);
    expect(profile.full_name).toBe(email.split("@")[0]);
  });

  it("이메일 인증을 마치지 않은 계정은 초대를 수락할 수 없다", async () => {
    const email = uniqueEmail("unconfirmed");
    await invite(f.manager, f.projectA, email, "site_worker");
    const id = await createAuthUser(email, { confirmed: false });
    expect(await accept(id)).toBe(0);
    expect(await sql("select id from dw_profiles where id = $1", [id])).toHaveLength(0);
    expect(await sql("select id from dw_invites where email = $1", [email])).toHaveLength(1);
    // 인증을 마치면 수락된다
    await sql("update auth.users set email_confirmed_at = now() where id = $1", [id]);
    expect(await accept(id)).toBe(1);
    expect(await sql("select id from dw_profiles where id = $1", [id])).toHaveLength(1);
  });

  it("다른 사람 앞으로 온 초대는 수락되지 않는다", async () => {
    const email = uniqueEmail("target");
    await invite(f.manager, f.projectA, email, "site_worker");
    const stranger = await createAuthUser(uniqueEmail("stranger"));
    expect(await accept(stranger)).toBe(0);
    expect(await sql("select id from dw_invites where email = $1", [email])).toHaveLength(1);
    await expect(asUser(null, (q) => q("select dw_accept_invites()"))).rejects.toThrow(/permission denied/);
  });

  it("현장관리자는 현장관리자를 초대할 수 없고 회장·대표이사는 할 수 있다", async () => {
    const email = uniqueEmail("manager");
    await expect(invite(f.manager, f.projectA, email, "site_manager")).rejects.toThrow(/회장·대표이사만/);
    expect(await invite(f.ceo, f.projectA, email, "site_manager")).toBe("invited");
    // 현장관리자는 회장·대표이사가 넣은 현장관리자 초대를 낮추거나 취소할 수 없다
    await expect(invite(f.manager, f.projectA, email, "site_worker")).rejects.toThrow(/회장·대표이사만/);
    const deleted = await asUser(f.manager, (q) => q("delete from dw_invites where email = $1 returning id", [email]));
    expect(deleted).toHaveLength(0);
    const id = await createAuthUser(email);
    expect(await accept(id)).toBe(1);
    const [member] = await sql("select role from dw_project_members where user_id = $1", [id]);
    expect(member.role).toBe("site_manager");
  });

  it("현장팀·협력업체·비활성 계정·타 사업장 관리자는 초대할 수 없다", async () => {
    const email = uniqueEmail("denied");
    for (const caller of [f.worker, f.partner, f.inactive, f.managerB]) {
      await expect(invite(caller, f.projectA, email, "site_worker")).rejects.toThrow(/초대할 권한이 없습니다/);
    }
    await expect(invite(null, f.projectA, email, "site_worker")).rejects.toThrow(/permission denied/);
    expect(await sql("select id from dw_invites where email = $1", [email])).toHaveLength(0);
  });

  it("초대 테이블에는 직접 넣거나 고칠 수 없다", async () => {
    await expect(
      asUser(f.ceo, (q) =>
        q("insert into dw_invites (email, project_id, role) values ($1, $2, 'site_manager')", [
          uniqueEmail("direct"),
          f.projectA,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(f.manager, (q) => q("update dw_invites set role = 'site_manager'"))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("잘못된 이메일·역할은 거부한다", async () => {
    await expect(invite(f.ceo, f.projectA, "not-an-email", "site_worker")).rejects.toThrow(/이메일 형식/);
    await expect(invite(f.ceo, f.projectA, uniqueEmail("role"), "ceo")).rejects.toThrow(/잘못된 역할/);
  });

  it("이미 구성원인 이메일은 초대 없이 바로 사업장에 추가된다('added')", async () => {
    const [{ email }] = await sql("select email from auth.users where id = $1", [f.managerB]);
    // managerB 는 사업장 B 의 현장관리자다. A 의 현장관리자가 A 에 현장팀으로 추가한다.
    expect(await invite(f.manager, f.projectA, email, "site_worker")).toBe("added");
    const rows = await sql("select role from dw_project_members where project_id = $1 and user_id = $2", [
      f.projectA,
      f.managerB,
    ]);
    expect(rows).toEqual([{ role: "site_worker" }]);
    expect(await sql("select id from dw_invites where email = $1", [email])).toHaveLength(0);
    // 이미 소속이면 역할을 갱신한다
    expect(await invite(f.manager, f.projectA, email, "partner")).toBe("added");
    const [after] = await sql("select role from dw_project_members where project_id = $1 and user_id = $2", [
      f.projectA,
      f.managerB,
    ]);
    expect(after.role).toBe("partner");
    await sql("delete from dw_project_members where project_id = $1 and user_id = $2", [f.projectA, f.managerB]);
  });

  it("바로 추가할 때도 원본 소속 규칙을 지킨다", async () => {
    const emailOf = async (id: string) => (await sql("select email from auth.users where id = $1", [id]))[0].email;
    // 현장관리자는 다른 현장관리자의 역할을 바꿀 수 없다
    const second = await sql(
      "insert into dw_project_members (project_id, user_id, role) values ($1, $2, 'site_manager') returning user_id",
      [f.projectA, f.managerB],
    );
    expect(second).toHaveLength(1);
    await expect(invite(f.manager, f.projectA, await emailOf(f.managerB), "site_worker")).rejects.toThrow(
      /회장·대표이사만/,
    );
    await sql("delete from dw_project_members where project_id = $1 and user_id = $2", [f.projectA, f.managerB]);
    // 비활성 계정과 회장·대표이사는 사업장에 추가하지 않는다
    await expect(invite(f.ceo, f.projectB, await emailOf(f.inactive), "site_worker")).rejects.toThrow(/사용이 중지된/);
    await expect(invite(f.ceo, f.projectB, await emailOf(f.chairman), "site_worker")).rejects.toThrow(
      /추가할 필요가 없습니다/,
    );
  });

  it("타 사업장 관리자는 남의 사업장 초대를 보지도 지우지도 못한다", async () => {
    const email = uniqueEmail("isolated");
    await invite(f.manager, f.projectA, email, "site_worker");
    const seenByB = await asUser(f.managerB, (q) => q("select id from dw_invites where email = $1", [email]));
    expect(seenByB).toHaveLength(0);
    const deletedByB = await asUser(f.managerB, (q) => q("delete from dw_invites where email = $1 returning id", [email]));
    expect(deletedByB).toHaveLength(0);
    // 현장팀도 보지 못한다
    expect(await asUser(f.worker, (q) => q("select id from dw_invites"))).toHaveLength(0);
    await expect(asUser(null, (q) => q("select id from dw_invites"))).rejects.toThrow(/permission denied/);
    // 그 사업장의 관리자와 회장·대표이사는 보고, 취소할 수 있다
    expect(await asUser(f.ceo, (q) => q("select id from dw_invites where email = $1", [email]))).toHaveLength(1);
    const deleted = await asUser(f.manager, (q) => q("delete from dw_invites where email = $1 returning id", [email]));
    expect(deleted).toHaveLength(1);
  });

  it("한 이메일이 여러 사업장에서 초대받으면 한 번에 모두 수락한다", async () => {
    const email = uniqueEmail("multi");
    await invite(f.manager, f.projectA, email, "site_worker", { name: "겸직자" });
    await invite(f.managerB, f.projectB, email, "partner");
    // 같은 사업장에 다시 초대하면 건수가 늘지 않고 갱신된다
    await invite(f.manager, f.projectA, email, "partner");
    expect(await sql("select id from dw_invites where email = $1", [email])).toHaveLength(2);
    const id = await createAuthUser(email);
    expect(await accept(id)).toBe(2);
    const members = await sql("select project_id, role from dw_project_members where user_id = $1 order by role", [id]);
    expect(members).toHaveLength(2);
    expect(members.every((m) => m.role === "partner")).toBe(true);
    // 프로필이 이미 있는 사용자가 받은 추가 초대도 수락된다
    await sql("delete from dw_project_members where project_id = $1 and user_id = $2", [f.projectB, id]);
    await sql("insert into dw_invites (email, project_id, role) values ($1, $2, 'site_worker')", [email, f.projectB]);
    expect(await accept(id)).toBe(1);
    const [again] = await sql("select role from dw_project_members where project_id = $1 and user_id = $2", [
      f.projectB,
      id,
    ]);
    expect(again.role).toBe("site_worker");
    const [profile] = await sql("select full_name from dw_profiles where id = $1", [id]);
    expect(profile.full_name).toBe("겸직자");
  });
});

describe("전사 역할 초대와 최초 관리자 지정", () => {
  const inviteExecutive = (caller: string, email: string, role: string, name: string | null = null) =>
    asUser(caller, async (q) => {
      const [row] = await q("select dw_invite_executive($1, $2, $3) as result", [email, role, name]);
      return row.result as string;
    });

  it("전사 역할 초대는 회장·대표이사만 할 수 있고, 수락하면 전사 역할을 갖는다", async () => {
    const email = uniqueEmail("exec");
    await expect(inviteExecutive(f.manager, email, "ceo")).rejects.toThrow(/회장·대표이사만/);
    await expect(inviteExecutive(f.ceo, email, "site_manager")).rejects.toThrow(/잘못된 역할/);
    expect(await inviteExecutive(f.chairman, email, "ceo", "새 대표")).toBe("invited");
    const id = await createAuthUser(email);
    expect(await accept(id)).toBe(1);
    const [profile] = await sql("select full_name, global_role from dw_profiles where id = $1", [id]);
    expect(profile).toEqual({ full_name: "새 대표", global_role: "ceo" });
    const projects = await asUser(id, (q) => q("select id from dw_projects where id in ($1, $2)", [f.projectA, f.projectB]));
    expect(projects).toHaveLength(2);
  });

  it("이미 구성원인 계정은 전사 역할을 바로 받고, 본인 역할은 바꿀 수 없다", async () => {
    const [{ email }] = await sql("select email from auth.users where id = $1", [f.worker2]);
    expect(await inviteExecutive(f.ceo, email, "chairman")).toBe("added");
    const [row] = await sql("select global_role from dw_profiles where id = $1", [f.worker2]);
    expect(row.global_role).toBe("chairman");
    await sql("update dw_profiles set global_role = null where id = $1", [f.worker2]);
    const [{ email: own }] = await sql("select email from auth.users where id = $1", [f.ceo]);
    await expect(inviteExecutive(f.ceo, own, "chairman")).rejects.toThrow(/본인의 전사 역할/);
  });

  it("프로필이 있는 사용자가 전사 역할 초대를 수락해도 보호 트리거에 막히지 않는다", async () => {
    const id = await createAuthUser(uniqueEmail("promote"));
    const [{ email }] = await sql("select email from auth.users where id = $1", [id]);
    await sql("insert into dw_profiles (id, email, full_name) values ($1, $2, '승진 대상')", [id, email]);
    await sql("insert into dw_invites (email, global_role) values ($1, 'ceo')", [email]);
    // 직접 바꾸는 것은 여전히 막힌다
    await expect(
      asUser(id, (q) => q("update dw_profiles set global_role = 'ceo' where id = $1", [id])),
    ).rejects.toThrow(/관리자만 변경/);
    expect(await accept(id)).toBe(1);
    const [row] = await sql("select global_role, full_name from dw_profiles where id = $1", [id]);
    expect(row).toEqual({ global_role: "ceo", full_name: "승진 대상" });
  });

  it("dw_bootstrap_executive 는 로그인 사용자·비로그인 사용자가 실행할 수 없다", async () => {
    const call = (q: (text: string, params?: unknown[]) => Promise<unknown>) =>
      q("select dw_bootstrap_executive($1, 'ceo', '침입자')", [uniqueEmail("hijack")]);
    for (const caller of [f.worker, f.manager, f.ceo, null]) {
      await expect(asUser(caller, call)).rejects.toThrow(/permission denied for function dw_bootstrap_executive/);
    }
  });

  it("dw_bootstrap_executive: 인증된 계정이 있으면 바로 지정하고, 없으면 초대를 넣는다", async () => {
    const existing = uniqueEmail("boot");
    const id = await createAuthUser(existing);
    const [added] = await sql("select dw_bootstrap_executive($1, 'ceo', '최초 관리자') as result", [existing.toUpperCase()]);
    expect(added.result).toBe("added");
    const [profile] = await sql("select email, full_name, global_role from dw_profiles where id = $1", [id]);
    expect(profile).toEqual({ email: existing, full_name: "최초 관리자", global_role: "ceo" });

    const later = uniqueEmail("boot-later");
    const [invited] = await sql("select dw_bootstrap_executive($1, 'chairman') as result", [later]);
    expect(invited.result).toBe("invited");
    // 두 번 실행해도 초대는 1건이다
    await sql("select dw_bootstrap_executive($1, 'chairman')", [later]);
    expect(await sql("select id from dw_invites where email = $1", [later])).toHaveLength(1);
    // 인증 전 계정은 바로 지정하지 않고 초대로 남긴다
    const unconfirmed = uniqueEmail("boot-unconfirmed");
    const pendingId = await createAuthUser(unconfirmed, { confirmed: false });
    const [pending] = await sql("select dw_bootstrap_executive($1, 'ceo') as result", [unconfirmed]);
    expect(pending.result).toBe("invited");
    expect(await sql("select id from dw_profiles where id = $1", [pendingId])).toHaveLength(0);

    const laterId = await createAuthUser(later);
    expect(await accept(laterId)).toBe(1);
    const [row] = await sql("select global_role from dw_profiles where id = $1", [laterId]);
    expect(row.global_role).toBe("chairman");
    await expect(sql("select dw_bootstrap_executive($1, 'site_manager')", [later])).rejects.toThrow(/잘못된 역할/);
  });
});

describe("다른 사업장 현장관리자 여부(dw_is_site_manager_elsewhere)", () => {
  const ask = (caller: string, user: string, project: string) =>
    asUser(caller, async (q) => {
      const [row] = await q("select dw_is_site_manager_elsewhere($1, $2) as result", [user, project]);
      return row.result as boolean;
    });

  it("자기 사업장 구성원에 대해 답하고, 권한이 없으면 거부한다", async () => {
    expect(await ask(f.manager, f.worker, f.projectA)).toBe(false);
    // worker2 를 사업장 B 의 현장관리자로도 둔다
    await sql("insert into dw_project_members (project_id, user_id, role) values ($1, $2, 'site_manager')", [
      f.projectB,
      f.worker2,
    ]);
    expect(await ask(f.manager, f.worker2, f.projectA)).toBe(true);
    expect(await ask(f.ceo, f.worker2, f.projectA)).toBe(true);
    // 그 사업장 안에서의 현장관리자 역할은 '다른 사업장'이 아니다
    expect(await ask(f.ceo, f.manager, f.projectA)).toBe(false);
    await sql("delete from dw_project_members where project_id = $1 and user_id = $2", [f.projectB, f.worker2]);

    await expect(ask(f.worker, f.worker2, f.projectA)).rejects.toThrow(/권한이 없습니다/);
    await expect(ask(f.managerB, f.worker, f.projectA)).rejects.toThrow(/권한이 없습니다/);
    // 현장관리자는 자기 사업장 구성원이 아닌 계정에 대해서는 물을 수 없다
    await expect(ask(f.manager, f.managerB, f.projectA)).rejects.toThrow(/권한이 없습니다/);
  });
});

describe("멱등 재실행", () => {
  it("마이그레이션 파일을 한 번 더 적용해도 성공하고 데이터·권한이 그대로다", async () => {
    const count = async () => {
      const [row] = await sql(
        `select (select count(*) from dw_profiles)::int as profiles,
                (select count(*) from dw_project_members)::int as members,
                (select count(*) from dw_audit_logs)::int as audits,
                (select count(*) from pg_policies where policyname like 'dw\\_%')::int as policies,
                (select count(*) from pg_trigger where tgname like 'dw\\_%' and not tgisinternal)::int as triggers`,
      );
      return row;
    };
    const before = await count();
    const migration = fs.readFileSync(MIGRATION_FILE, "utf8");
    await sql(migration);
    await sql(migration);
    expect(await count()).toEqual(before);
    // 다시 적용한 뒤에도 권한 규칙이 그대로 동작한다
    await expect(asUser(null, (q) => q("select * from dw_projects"))).rejects.toThrow(/permission denied/);
    const projects = await asUser(f.worker, (q) => q("select id from dw_projects"));
    expect(projects.map((p) => p.id)).toEqual([f.projectA]);
    await expect(asUser(f.manager, (q) => q("delete from dw_audit_logs"))).rejects.toThrow(/permission denied/);
  });
});
