"use client";

import { Search, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  cancelInvite, inviteMember, setGlobalRole, setProjectRole, setUserActive, updateUser,
} from "@/app/(dashboard)/farm365/work/(app)/admin/users/actions";
import { Badge } from "@/components/work/ui/badge";
import { Button } from "@/components/work/ui/button";
import { Card, CardHeader } from "@/components/work/ui/card";
import { Dialog, DialogContent } from "@/components/work/ui/dialog";
import { Field, FormError, FormNotice, Input, Select } from "@/components/work/ui/form";
import { EmptyState } from "@/components/work/ui/misc";
import { GLOBAL_ROLE_LABEL, ROLE_LABEL, type Tone } from "@/lib/work/constants";
import type { ActionResult, GlobalRole, ProjectRole } from "@/lib/work/types";

export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  company: string | null;
  position: string | null;
  global_role: GlobalRole | null;
  is_active: boolean;
  project_role: ProjectRole | null;
}

/** 대기 중인 초대 한 건. 전사 역할 초대는 global_role, 사업장 초대는 role 이 채워진다. */
export interface InviteRow {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  company: string | null;
  position: string | null;
  role: ProjectRole | null;
  global_role: GlobalRole | null;
  /** 서버에서 만든 표시용 초대 시각 */
  invited_at: string;
}

const ROLE_TONE: Record<string, Tone> = {
  chairman: "purple", ceo: "purple", site_manager: "green", site_worker: "blue", partner: "amber",
};

function roleBadge(user: { global_role: GlobalRole | null; project_role: ProjectRole | null }) {
  if (user.global_role) return <Badge tone={ROLE_TONE[user.global_role]}>{GLOBAL_ROLE_LABEL[user.global_role]}</Badge>;
  if (user.project_role) return <Badge tone={ROLE_TONE[user.project_role]}>{ROLE_LABEL[user.project_role]}</Badge>;
  return <Badge>미소속</Badge>;
}

/** 서버 액션 실행 공통 처리 */
function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  function run(action: () => Promise<ActionResult<unknown>>, success?: string | (() => void)) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setNotice(null);
        return setError(result.error);
      }
      setError(null);
      if (typeof success === "function") success();
      else setNotice(success ?? null);
      router.refresh();
    });
  }
  const reset = () => {
    setError(null);
    setNotice(null);
  };
  return { pending, error, notice, run, reset, setError };
}

export function UserManager({
  users,
  invites,
  me,
  isExecutive,
  hasProject,
}: {
  users: UserRow[];
  invites: InviteRow[];
  me: string;
  isExecutive: boolean;
  hasProject: boolean;
}) {
  const [keyword, setKeyword] = useState("");
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = users.find((u) => u.id === selectedId) ?? null;
  // 현장관리자는 사업장이 있어야 초대할 수 있다. 회장·대표이사는 사업장이 없어도 전사 역할을 초대할 수 있다.
  const canInvite = hasProject || isExecutive;

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return users;
    return users.filter((u) => [u.full_name, u.email, u.company, u.position].some((v) => v?.toLowerCase().includes(k)));
  }, [users, keyword]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-48">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="구성원 검색" placeholder="이름, 이메일, 소속 검색" className="pl-9" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </div>
        {canInvite && (
          <Button
            onClick={() => {
              setNotice(null);
              setInviting(true);
            }}
          >
            <UserPlus /> 구성원 초대
          </Button>
        )}
      </div>

      <FormNotice message={notice} />

      <Card>
        {filtered.length === 0 ? (
          <EmptyState title="구성원이 없습니다" description={keyword ? "검색 조건에 맞는 구성원이 없습니다." : "구성원 초대로 첫 구성원을 등록해 주세요."} />
        ) : (
          <ul className="divide-y divide-border" data-testid="user-list">
            {filtered.map((user) => (
              <li key={user.id} className="flex items-center gap-3 px-4 py-3.5" data-email={user.email}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[15px] font-semibold text-foreground">{user.full_name}</span>
                    {roleBadge(user)}
                    {!user.is_active && <Badge tone="red">사용 중지</Badge>}
                    {user.id === me && <Badge tone="gray">본인</Badge>}
                  </div>
                  <p className="mt-0.5 break-all text-sm text-muted-foreground">{user.email}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[user.company, user.position, user.phone].filter(Boolean).join(" · ") || "소속 정보 없음"}
                  </p>
                </div>
                {user.id !== me && (isExecutive || user.project_role === "site_worker" || user.project_role === "partner") && (
                  <Button variant="outline" size="sm" onClick={() => setSelectedId(user.id)} aria-label={`${user.full_name} 관리`}>
                    관리
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canInvite && <InviteList invites={invites} isExecutive={isExecutive} />}

      <Dialog open={inviting} onOpenChange={setInviting}>
        {inviting && (
          <InviteDialog
            isExecutive={isExecutive}
            hasProject={hasProject}
            onDone={(message) => {
              setNotice(message);
              setInviting(false);
            }}
          />
        )}
      </Dialog>
      <Dialog open={selected !== null} onOpenChange={(v) => !v && setSelectedId(null)}>
        {selected && <ManageDialog key={selected.id} user={selected} isExecutive={isExecutive} hasProject={hasProject} />}
      </Dialog>
    </div>
  );
}

function roleOptions(isExecutive: boolean, hasProject: boolean) {
  const options: { value: string; label: string }[] = [];
  if (hasProject) {
    options.push({ value: "site_worker", label: "현장팀" }, { value: "partner", label: "협력업체" });
    if (isExecutive) options.push({ value: "site_manager", label: "현장관리자" });
  }
  if (isExecutive) options.push({ value: "ceo", label: "대표이사" }, { value: "chairman", label: "회장" });
  return options;
}

function InviteDialog({
  isExecutive,
  hasProject,
  onDone,
}: {
  isExecutive: boolean;
  hasProject: boolean;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const options = roleOptions(isExecutive, hasProject);
  const [form, setForm] = useState({
    email: "", full_name: "", phone: "", company: "", position: "", role: options[0]?.value ?? "",
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const isGlobal = form.role === "ceo" || form.role === "chairman";

  return (
    <DialogContent
      title="구성원 초대"
      description="초대한 이메일로 Shrimp365 에 가입(이메일 인증)해 로그인하면 현장관리를 사용할 수 있습니다. 초대 메일은 발송되지 않으니 당사자에게 직접 알려 주세요."
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const result = await inviteMember(form);
            if (!result.ok) return setError(result.error);
            const email = form.email.trim().toLowerCase();
            onDone(
              result.data === "added"
                ? isGlobal
                  ? `${email} 은(는) 이미 현장관리 구성원이어서 전사 역할을 바로 지정했습니다.`
                  : `${email} 은(는) 이미 현장관리 구성원이어서 현재 사업장에 바로 추가했습니다.`
                : `${email} 을(를) 초대했습니다. 이 이메일로 Shrimp365 에 로그인하면 현장관리에 참여합니다.`,
            );
            router.refresh();
          });
        }}
      >
        <Field label="이메일 (Shrimp365 계정)" htmlFor="new-email" required>
          <Input id="new-email" type="email" inputMode="email" autoComplete="off" value={form.email} onChange={set("email")} required />
        </Field>
        <Field label="역할" htmlFor="new-role" required hint={hasProject ? "사업장 역할은 현재 선택된 사업장에 적용됩니다. 이미 이 사업장 소속인 구성원의 역할은 목록에서 변경해 주세요." : undefined}>
          <Select id="new-role" value={form.role} onChange={set("role")}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="이름" htmlFor="new-name" hint="비워 두면 이메일 앞부분이 이름으로 쓰입니다. 이미 구성원인 계정의 정보는 바뀌지 않습니다.">
          <Input id="new-name" value={form.full_name} onChange={set("full_name")} maxLength={50} />
        </Field>
        {!isGlobal && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="소속" htmlFor="new-company">
                <Input id="new-company" value={form.company} onChange={set("company")} maxLength={100} />
              </Field>
              <Field label="직책" htmlFor="new-position">
                <Input id="new-position" value={form.position} onChange={set("position")} maxLength={50} />
              </Field>
            </div>
            <Field label="연락처" htmlFor="new-phone">
              <Input id="new-phone" type="tel" inputMode="tel" value={form.phone} onChange={set("phone")} maxLength={30} />
            </Field>
          </>
        )}
        <FormError message={error} />
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? "초대하는 중…" : "초대하기"}
        </Button>
      </form>
    </DialogContent>
  );
}

function InviteList({ invites, isExecutive }: { invites: InviteRow[]; isExecutive: boolean }) {
  const { pending, error, run } = useAction();
  return (
    <Card>
      <CardHeader title="대기 중인 초대" description="초대받은 이메일로 Shrimp365 에 로그인하면 자동으로 수락되어 목록에서 사라집니다." />
      {error && (
        <div className="px-4 pt-3">
          <FormError message={error} />
        </div>
      )}
      {invites.length === 0 ? (
        <EmptyState title="대기 중인 초대가 없습니다" />
      ) : (
        <ul className="divide-y divide-border" data-testid="invite-list">
          {invites.map((invite) => (
            <li key={invite.id} className="flex items-center gap-3 px-4 py-3.5" data-email={invite.email}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="break-all text-[15px] font-semibold text-foreground">{invite.email}</span>
                  {roleBadge({ global_role: invite.global_role, project_role: invite.role })}
                  <Badge tone="gray">수락 대기</Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[invite.full_name, invite.company, invite.position, invite.phone].filter(Boolean).join(" · ") || "입력된 정보 없음"}
                  {" · "}
                  {invite.invited_at} 초대
                </p>
              </div>
              {/* 현장관리자·전사 역할 초대는 회장·대표이사만 취소할 수 있다 (DB 도 같은 규칙으로 막는다) */}
              {(isExecutive || invite.role === "site_worker" || invite.role === "partner") && (
                <Button
                  variant="dangerOutline"
                  size="sm"
                  disabled={pending}
                  aria-label={`${invite.email} 초대 취소`}
                  onClick={() => confirm(`${invite.email} 초대를 취소할까요?`) && run(() => cancelInvite(invite.id))}
                >
                  초대 취소
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-4 first:border-0 first:pt-0">
      <h3 className="mb-2.5 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function ManageDialog({ user, isExecutive, hasProject }: { user: UserRow; isExecutive: boolean; hasProject: boolean }) {
  const { pending, error, notice, run } = useAction();
  const [profile, setProfile] = useState({
    full_name: user.full_name, phone: user.phone ?? "", company: user.company ?? "", position: user.position ?? "",
  });
  const [projectRole, setProjectRoleValue] = useState<string>(user.project_role ?? "");
  const [globalRole, setGlobalRoleValue] = useState<string>(user.global_role ?? "");
  const set = (key: keyof typeof profile) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setProfile((p) => ({ ...p, [key]: e.target.value }));

  return (
    <DialogContent title={`${user.full_name} 구성원 관리`} description={user.email}>
      <div className="space-y-4">
        <FormError message={error} />
        {!error && <FormNotice message={notice} />}

        <Section title="기본 정보">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => updateUser(user.id, profile), "기본 정보를 저장했습니다.");
            }}
          >
            <Field label="이름" htmlFor="edit-name" required>
              <Input id="edit-name" value={profile.full_name} onChange={set("full_name")} maxLength={50} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="소속" htmlFor="edit-company">
                <Input id="edit-company" value={profile.company} onChange={set("company")} maxLength={100} />
              </Field>
              <Field label="직책" htmlFor="edit-position">
                <Input id="edit-position" value={profile.position} onChange={set("position")} maxLength={50} />
              </Field>
            </div>
            <Field label="연락처" htmlFor="edit-phone">
              <Input id="edit-phone" type="tel" inputMode="tel" value={profile.phone} onChange={set("phone")} maxLength={30} />
            </Field>
            <Button type="submit" variant="secondary" className="w-full" disabled={pending}>기본 정보 저장</Button>
          </form>
        </Section>

        {hasProject && !user.global_role && (
          <Section title="현재 사업장 역할">
            <div className="flex gap-2">
              <Select aria-label="사업장 역할" value={projectRole} onChange={(e) => setProjectRoleValue(e.target.value)}>
                <option value="">미소속 (사업장에서 제외)</option>
                <option value="site_worker">현장팀</option>
                <option value="partner">협력업체</option>
                {isExecutive && <option value="site_manager">현장관리자</option>}
              </Select>
              <Button
                variant="secondary"
                className="shrink-0"
                disabled={pending || projectRole === (user.project_role ?? "")}
                onClick={() => {
                  if (!projectRole && !confirm("이 사업장에서 제외할까요? 제외하면 이 사업장의 데이터를 볼 수 없습니다.")) return;
                  run(() => setProjectRole(user.id, projectRole || null), "사업장 역할을 변경했습니다.");
                }}
              >
                변경
              </Button>
            </div>
          </Section>
        )}

        {isExecutive && (
          <Section title="전사 역할">
            <div className="flex gap-2">
              <Select aria-label="전사 역할" value={globalRole} onChange={(e) => setGlobalRoleValue(e.target.value)}>
                <option value="">없음</option>
                <option value="ceo">대표이사</option>
                <option value="chairman">회장</option>
              </Select>
              <Button
                variant="secondary"
                className="shrink-0"
                disabled={pending || globalRole === (user.global_role ?? "")}
                onClick={() => {
                  if (!confirm(globalRole ? "전사 역할을 부여하면 모든 사업장의 데이터에 접근할 수 있습니다. 계속할까요?" : "전사 역할을 해제할까요?")) return;
                  run(() => setGlobalRole(user.id, globalRole || null), "전사 역할을 변경했습니다.");
                }}
              >
                변경
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">회장·대표이사는 모든 사업장을 조회하고 관리합니다.</p>
          </Section>
        )}

        <Section title="현장관리 사용 상태">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {user.is_active
                ? "현장관리를 사용 중입니다."
                : "현장관리 사용이 중지되었습니다. 현장관리 화면에 들어올 수 없습니다."}
            </p>
            {user.is_active ? (
              <Button
                variant="dangerOutline"
                className="shrink-0"
                disabled={pending}
                onClick={() =>
                  confirm("이 구성원의 현장관리 사용을 중지할까요? 중지하면 모든 사업장의 현장관리 화면과 데이터 조회가 차단됩니다. Shrimp365 계정 자체는 그대로입니다.") &&
                  run(() => setUserActive(user.id, false), "현장관리 사용을 중지했습니다.")
                }
              >
                사용 중지
              </Button>
            ) : (
              <Button className="shrink-0" disabled={pending} onClick={() => run(() => setUserActive(user.id, true), "현장관리를 다시 사용할 수 있습니다.")}>
                사용 재개
              </Button>
            )}
          </div>
        </Section>
      </div>
    </DialogContent>
  );
}
