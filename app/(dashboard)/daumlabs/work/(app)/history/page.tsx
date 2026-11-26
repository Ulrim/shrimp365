import type { Metadata } from "next";
import Link from "next/link";
import { ACTION_LABEL, FIELD_LABEL, HIDDEN_FIELDS, PERSON_FIELDS, TABLE_LABEL, enumLabel } from "@/components/work/history/labels";
import { Badge, StatusBadge } from "@/components/work/ui/badge";
import { Button } from "@/components/work/ui/button";
import { Card, CardBody } from "@/components/work/ui/card";
import { Field, Input, Select } from "@/components/work/ui/form";
import { EmptyState, PageHeader } from "@/components/work/ui/misc";
import { workHref } from "@/lib/work/constants";
import { formatDateTime, isDateString } from "@/lib/work/dates";
import { requireManager } from "@/lib/work/session";

export const metadata: Metadata = { title: "변경 이력" };

const PAGE_SIZE = 50;

interface AuditLog {
  id: number;
  project_id: string | null;
  table_name: string;
  record_id: string | null;
  action: "INSERT" | "UPDATE" | "DELETE";
  actor_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_fields: string[] | null;
  created_at: string;
}

type Params = { table?: string; action?: string; from?: string; to?: string; page?: string; global?: string };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await requireManager();
  const { supabase, project, isExecutive } = session;
  const params = await searchParams;
  const table = params.table && TABLE_LABEL[params.table] ? params.table : "";
  const action = params.action && ACTION_LABEL[params.action] ? params.action : "";
  const from = isDateString(params.from) ? params.from : "";
  const to = isDateString(params.to) ? params.to : "";
  const includeGlobal = isExecutive && params.global === "1";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  let query = supabase.from("dw_audit_logs").select("*", { count: "exact" });
  query = includeGlobal ? query.or(`project_id.eq.${project.id},project_id.is.null`) : query.eq("project_id", project.id);
  if (table) query = query.eq("table_name", table);
  if (action) query = query.eq("action", action);
  if (from) query = query.gte("created_at", `${from}T00:00:00+09:00`);
  if (to) query = query.lte("created_at", `${to}T23:59:59.999+09:00`);
  const { data, count } = await query
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    .returns<AuditLog[]>();
  const logs = data ?? [];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 식별자를 이름으로 바꾸기 위한 조회
  const personIds = new Set<string>();
  const processIds = new Set<string>();
  const taskIds = new Set<string>();
  for (const log of logs) {
    if (log.actor_id) personIds.add(log.actor_id);
    for (const row of [log.old_data, log.new_data]) {
      if (!row) continue;
      for (const field of PERSON_FIELDS) if (typeof row[field] === "string") personIds.add(row[field] as string);
      if (typeof row.process_id === "string") processIds.add(row.process_id);
      if (typeof row.task_id === "string") taskIds.add(row.task_id);
    }
  }
  const [people, processes, tasks] = await Promise.all([
    personIds.size ? supabase.from("dw_profiles").select("id, full_name").in("id", [...personIds]) : null,
    processIds.size ? supabase.from("dw_processes").select("id, name").in("id", [...processIds]) : null,
    taskIds.size ? supabase.from("dw_tasks").select("id, title").in("id", [...taskIds]) : null,
  ]);
  const personName = new Map((people?.data ?? []).map((p) => [p.id as string, p.full_name as string]));
  const processName = new Map((processes?.data ?? []).map((p) => [p.id as string, p.name as string]));
  const taskTitle = new Map((tasks?.data ?? []).map((t) => [t.id as string, t.title as string]));

  function show(tableName: string, field: string, value: unknown): string {
    if (value === null || value === undefined || value === "") return "없음";
    if (typeof value === "boolean") return value ? "예" : "아니오";
    if (typeof value === "string") {
      if (PERSON_FIELDS.has(field)) return personName.get(value) ?? "(알 수 없는 사용자)";
      if (field === "process_id") return processName.get(value) ?? "(삭제된 공정)";
      if (field === "task_id") return taskTitle.get(value) ?? "(삭제된 업무)";
      const label = enumLabel(tableName, field, value);
      if (label) return label;
      if (field.endsWith("_at")) return formatDateTime(value);
      if (/^\d{2}:\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
      return value.length > 120 ? `${value.slice(0, 120)}…` : value;
    }
    if (typeof value === "object") return "(상세 데이터)";
    return String(value);
  }

  function subject(log: AuditLog): string {
    const row = log.new_data ?? log.old_data ?? {};
    if (log.table_name === "daily_reports") {
      const author = typeof row.author_id === "string" ? personName.get(row.author_id) : null;
      return `${row.work_date ?? ""} ${author ?? ""}`.trim();
    }
    if (log.table_name === "project_members") {
      return typeof row.user_id === "string" ? (personName.get(row.user_id) ?? "") : "";
    }
    if (log.table_name === "consolidated_reports") return String(row.report_date ?? "");
    for (const key of ["title", "name", "full_name", "content", "reason", "caption"]) {
      const v = row[key];
      if (typeof v === "string" && v) return v.length > 60 ? `${v.slice(0, 60)}…` : v;
    }
    return "";
  }

  function reportLink(log: AuditLog): string | null {
    if (log.action === "DELETE" && log.table_name === "daily_reports") return null;
    if (log.table_name === "daily_reports" && log.record_id) return workHref(`/reports/${log.record_id}`);
    const reportId = (log.new_data ?? log.old_data)?.report_id;
    return typeof reportId === "string" ? workHref(`/reports/${reportId}`) : null;
  }

  const href = (patch: Partial<Params>) => {
    const next: Params = { table, action, from, to, global: includeGlobal ? "1" : "", page: "1", ...patch };
    const qs = Object.entries(next)
      .filter(([k, v]) => v && !(k === "page" && v === "1"))
      .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
      .join("&");
    return qs ? `${workHref("/history")}?${qs}` : workHref("/history");
  };

  return (
    <>
      <PageHeader title="변경 이력" description={`${project.name} · 데이터 등록·수정·삭제 및 승인 기록 (총 ${total.toLocaleString("ko-KR")}건)`} />

      <Card className="mb-4">
        <CardBody>
          <form method="get" action={workHref("/history")} className="grid grid-cols-2 gap-3 md:grid-cols-6 md:items-end">
            <Field label="대상" htmlFor="table">
              <Select id="table" name="table" defaultValue={table}>
                <option value="">전체</option>
                {Object.entries(TABLE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </Field>
            <Field label="구분" htmlFor="action">
              <Select id="action" name="action" defaultValue={action}>
                <option value="">전체</option>
                {Object.entries(ACTION_LABEL).map(([value, { label }]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </Field>
            <Field label="시작일" htmlFor="from">
              <Input id="from" name="from" type="date" defaultValue={from} />
            </Field>
            <Field label="종료일" htmlFor="to">
              <Input id="to" name="to" type="date" defaultValue={to} />
            </Field>
            {isExecutive ? (
              <label className="col-span-2 flex h-11 items-center gap-2 text-sm text-foreground md:col-span-1 md:h-10">
                <input type="checkbox" name="global" value="1" defaultChecked={includeGlobal} className="size-5 accent-brand" />
                계정 변경 포함
              </label>
            ) : (
              <span className="hidden md:block" />
            )}
            <div className="col-span-2 flex gap-2 md:col-span-1">
              <Button type="submit" className="flex-1">조회</Button>
              <Button variant="outline" asChild>
                <Link href={workHref("/history")}>초기화</Link>
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        {logs.length === 0 ? (
          <EmptyState title="변경 이력이 없습니다" description="조건에 맞는 기록이 없습니다." />
        ) : (
          <ul className="divide-y divide-border" data-testid="history-list">
            {logs.map((log) => {
              const link = reportLink(log);
              const title = subject(log);
              const fields = (log.changed_fields ?? []).filter((f) => !HIDDEN_FIELDS.has(f));
              return (
                <li key={log.id} className="px-4 py-3.5" data-table={log.table_name} data-action={log.action}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <StatusBadge map={ACTION_LABEL} value={log.action} />
                    <Badge>{TABLE_LABEL[log.table_name] ?? log.table_name}</Badge>
                    {title && <span className="min-w-0 break-words text-[15px] font-medium text-foreground">{title}</span>}
                    {link && (
                      <Link href={link} className="text-sm font-semibold text-brand-fg underline underline-offset-2">
                        작업일보 보기
                      </Link>
                    )}
                  </div>
                  {log.action === "UPDATE" && fields.length > 0 && (
                    <dl className="mt-2 space-y-1 rounded-lg bg-muted px-3 py-2 text-sm">
                      {fields.map((field) => (
                        <div key={field} className="flex flex-col gap-0.5 md:flex-row md:gap-3">
                          <dt className="shrink-0 text-muted-foreground md:w-36">{FIELD_LABEL[field] ?? field}</dt>
                          <dd className="min-w-0 break-words text-foreground">
                            <span className="text-muted-foreground line-through decoration-muted-foreground">{show(log.table_name, field, log.old_data?.[field])}</span>
                            <span className="mx-1.5 text-muted-foreground" aria-label="에서">→</span>
                            <span className="font-medium">{show(log.table_name, field, log.new_data?.[field])}</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {formatDateTime(log.created_at)} · {log.actor_id ? (personName.get(log.actor_id) ?? "(알 수 없는 사용자)") : "시스템"}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-3" aria-label="페이지">
          {page > 1 ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={href({ page: String(page - 1) })}>이전</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>이전</Button>
          )}
          <span className="text-sm text-foreground">
            {page} / {pages}
          </span>
          {page < pages ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={href({ page: String(page + 1) })}>다음</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>다음</Button>
          )}
        </nav>
      )}
    </>
  );
}
