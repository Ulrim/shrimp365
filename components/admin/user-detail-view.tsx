"use client"

// 사용자 상세(/admin/users/[id]) — 사용자 표에서 한 명을 눌러 들어오는 읽기 전용 화면.
//
// 데이터는 /api/admin/users/[id] 가 admin·총관리자 확인 뒤 준다. 테스트·모니터 계정은
// 사용자 목록과 마찬가지로 API 를 부르지 않고 목데이터(mock-user-*)를 보여 준다.
// 역할 변경·삭제 같은 쓰기 기능은 여기 두지 않는다 — 역할은 매니저 관리에서 바꾼다.
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft, RefreshCw, UserRound, Activity, Building2, Cpu, Bell, Eye,
  ShieldCheck, XCircle, AlertCircle, Info, CheckCircle2, Droplets, ArrowRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"
import { adminAccess } from "@/lib/admin-access"
import { isMonitorAccount, isTestAccount } from "@/lib/mock-data"
import { cn } from "@/lib/utils"
import type { AdminUserDetail } from "@/components/admin/user-detail/types"
import { buildMockUserDetail } from "@/components/admin/user-detail/mock"
import { DEFAULT_READINGS_FILTER, type AdminReadingRow } from "@/lib/admin-readings"
import { mockReadingsResponse } from "@/components/admin/readings/mock"
import { LateEntryMark, RecordedAt, SourceBadge, WqValue, unitOf } from "@/components/admin/readings/parts"
import { problemOf, type LoadProblem } from "@/components/admin/stats-status"
import {
  CopyButton, Dot, Empty, Field, NeutralBadge, Section, StatusChip, TONE_TEXT,
  absDate, absTime, planLabel, providerLabel, relTime, roleLabel, uiModeLabel,
} from "@/components/admin/user-detail/parts"

// ─── 불러오기 ────────────────────────────────────────────────────────────────

type LoadError = 401 | 403 | 404 | 500 | 503

function useUserDetail(id: string) {
  const { user } = useAuth()
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [error, setError] = useState<LoadError | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const isMock = isMonitorAccount(user?.email) || isTestAccount(user?.email)

  const load = useCallback(async () => {
    if (isMock) {
      const mock = buildMockUserDetail(id)
      setDetail(mock)
      setError(mock ? null : 404)
      setLoading(false)
      return
    }
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, { cache: "no-store" })
      if (!res.ok) {
        const s = res.status
        setError(s === 401 || s === 403 || s === 404 || s === 503 ? s : 500)
        setDetail(null)
        return
      }
      setDetail(await res.json() as AdminUserDetail)
      setError(null)
    } catch {
      setError(500)
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [id, isMock])

  useEffect(() => {
    if (!user) return
    // setState 가 effect 본문에서 동기로 불리지 않도록 한 틱 미룬다(admin-stats 와 같은 방식).
    const t = setTimeout(() => { load() }, 0)
    return () => clearTimeout(t)
  }, [user, load])

  async function refresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  return { detail, error, loading, refreshing, refresh }
}

// ─── 화면 ────────────────────────────────────────────────────────────────────

function BackLink() {
  return (
    <Link
      href="/admin/users"
      className="inline-flex items-center gap-1.5 min-h-[44px] text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="w-4 h-4" aria-hidden="true" /> 사용자 목록
    </Link>
  )
}

export function AdminUserDetailView({ id }: { id: string }) {
  const { user } = useAuth()
  const isSuperViewer = adminAccess(user).managers
  const { detail, error, loading, refreshing, refresh } = useUserDetail(id)

  if (loading) return <DetailSkeleton />
  if (error || !detail) return <DetailError code={error ?? 500} onRetry={refresh} retrying={refreshing} />

  const { account } = detail
  const hasViewerLinks = !!detail.viewer_links && detail.viewer_links.length > 0

  return (
    <div className="space-y-4 animate-fade-in">
      <BackLink />

      {/* 머리 — 이름·역할·요금제·이메일 */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-foreground break-words">{account.name}</h2>
            <NeutralBadge strong={account.role === "admin"}>{roleLabel(account.role)}</NeutralBadge>
            <NeutralBadge>{planLabel(account.plan)}</NeutralBadge>
            {account.is_super_admin && (
              <NeutralBadge strong>
                <ShieldCheck className="w-3 h-3" aria-hidden="true" /> 총관리자
              </NeutralBadge>
            )}
          </div>
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-sm text-muted-foreground break-all">{account.email || "이메일 없음"}</span>
            {account.email && <CopyButton value={account.email} label="이메일 복사" />}
          </div>
          {isSuperViewer && (
            <p className="text-xs text-muted-foreground">
              역할 변경은{" "}
              <Link href="/admin/managers" className="underline underline-offset-2 hover:text-foreground">
                매니저 관리
              </Link>
              에서 합니다.
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          aria-label="사용자 정보 새로고침"
          className="self-start border-border text-muted-foreground hover:text-foreground gap-2 min-h-[44px] shrink-0"
        >
          <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} aria-hidden="true" />
          새로고침
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AccountCard detail={detail} />
        <ActivityCard detail={detail} />
        <FarmsCard detail={detail} />
        <DevicesCard detail={detail} />
        <RecentReadingsCard userId={account.id} />
        {hasViewerLinks ? (
          <>
            <AlertsCard detail={detail} />
            <ViewerLinksCard links={detail.viewer_links!} />
          </>
        ) : (
          <AlertsCard detail={detail} className="lg:col-span-2" />
        )}
      </div>
    </div>
  )
}

// ─── 카드들 ──────────────────────────────────────────────────────────────────

function TimeWithAbs({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-muted-foreground">—</span>
  return (
    <span className="tabular-nums">
      {relTime(iso)}
      <span className="block text-xs text-muted-foreground">{absTime(iso)}</span>
    </span>
  )
}

function AccountCard({ detail }: { detail: AdminUserDetail }) {
  const a = detail.account
  return (
    <Section icon={UserRound} title="계정">
      <dl className="divide-y divide-border">
        <Field label="가입일"><TimeWithAbs iso={a.created_at} /></Field>
        <Field label="최근 접속">
          {a.last_sign_in_at ? <TimeWithAbs iso={a.last_sign_in_at} /> : <span className="text-muted-foreground">접속 기록 없음</span>}
        </Field>
        <Field label="이메일 인증">
          {a.email_confirmed
            ? <span className={cn("inline-flex items-center gap-1", TONE_TEXT.ok)}><CheckCircle2 className="w-4 h-4" aria-hidden="true" />인증됨</span>
            : <span className={cn("inline-flex items-center gap-1", TONE_TEXT.warn)}><AlertCircle className="w-4 h-4" aria-hidden="true" />미인증</span>}
        </Field>
        <Field label="로그인 방식">
          {a.providers.length > 0
            ? <span className="inline-flex flex-wrap justify-end gap-1">{a.providers.map(p => <NeutralBadge key={p}>{providerLabel(p)}</NeutralBadge>)}</span>
            : <span className="text-muted-foreground">—</span>}
        </Field>
        <Field label="기본 화면 모드">{uiModeLabel(a.ui_mode)}</Field>
      </dl>
    </Section>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: keyof typeof TONE_TEXT }) {
  return (
    <div className="rounded-lg border border-border p-3 min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums mt-0.5", tone ? TONE_TEXT[tone] : "text-foreground")}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5 tabular-nums truncate">{sub}</p>}
    </div>
  )
}

function ActivityCard({ detail }: { detail: AdminUserDetail }) {
  const tanks = detail.farms.reduce((n, f) => n + f.tanks.total, 0)
  const online = detail.devices.filter(d => d.online).length
  const open = detail.alerts.open_count
  const act = detail.activity
  const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("ko-KR"))
  return (
    <Section icon={Activity} title="활동 요약">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Stat label="농장" value={detail.farms.length} />
        <Stat label="수조·베드" value={tanks} />
        <Stat label="장비 (온라인/전체)" value={<>{online}<span className="text-muted-foreground font-normal">/{detail.devices.length}</span></>} />
        <Stat label="미해결 알림" value={fmt(open)} tone={open ? "danger" : undefined} />
        <Stat
          label="30일 수질 기록"
          value={fmt(act.readings_30d)}
          sub={act.readings_30d === null ? "확인 불가" : `마지막 ${relTime(act.last_reading_at)}`}
        />
        <Stat
          label="일지"
          value={fmt(act.journal_count)}
          sub={act.journal_count === null ? "확인 불가" : `마지막 ${act.last_journal_date ? absDate(act.last_journal_date) : "—"}`}
        />
      </div>
    </Section>
  )
}

function FarmsCard({ detail }: { detail: AdminUserDetail }) {
  return (
    <Section icon={Building2} title="농장" aside={<span className="text-xs text-muted-foreground tabular-nums">{detail.farms.length}곳</span>} className="lg:col-span-2">
      {detail.farms.length === 0 ? (
        <Empty>등록한 농장이 없습니다</Empty>
      ) : (
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-muted-foreground text-xs border-b border-border">
                <th className="text-left pb-2 font-medium">이름</th>
                <th className="text-left pb-2 font-medium">유형</th>
                <th className="text-left pb-2 font-medium">주소</th>
                <th className="text-left pb-2 font-medium">수조 상태</th>
                <th className="text-right pb-2 font-medium">등록일</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {detail.farms.map(f => {
                const unit = f.farm_type === "agriculture" ? "베드" : "수조"
                return (
                  <tr key={f.id}>
                    <td className="py-2.5 pr-3 font-medium text-foreground">{f.name}</td>
                    <td className="py-2.5 pr-3">
                      <NeutralBadge>{f.farm_type === "agriculture" ? "스마트팜" : "양식장"}</NeutralBadge>
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      <span className="block max-w-[220px] truncate" title={f.location || undefined}>{f.location || "—"}</span>
                      {f.has_coords === false && <span className="text-xs">좌표 없음</span>}
                    </td>
                    <td className="py-2.5 pr-3">
                      {f.tanks.total === 0 ? (
                        <span className="text-xs text-muted-foreground">{unit} 없음</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          <span className="text-xs text-muted-foreground tabular-nums self-center mr-0.5">{unit} {f.tanks.total}</span>
                          <StatusChip tone="ok" label="정상" count={f.tanks.active} />
                          <StatusChip tone="warn" label="주의" count={f.tanks.warning} />
                          <StatusChip tone="danger" label="위험" count={f.tanks.danger} />
                          <StatusChip tone="idle" label="비활성" count={f.tanks.inactive} />
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 text-right text-xs text-muted-foreground tabular-nums whitespace-nowrap">{absDate(f.created_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function DevicesCard({ detail }: { detail: AdminUserDetail }) {
  const online = detail.devices.filter(d => d.online).length
  return (
    <Section
      icon={Cpu}
      title="장비"
      aside={<span className="text-xs text-muted-foreground tabular-nums">온라인 {online} / {detail.devices.length}</span>}
      className="lg:col-span-2"
    >
      {detail.devices.length === 0 ? (
        <Empty>연결된 장비가 없습니다</Empty>
      ) : (
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-muted-foreground text-xs border-b border-border">
                <th className="text-left pb-2 font-medium">이름</th>
                <th className="text-left pb-2 font-medium">농장 / 수조</th>
                <th className="text-left pb-2 font-medium">버전</th>
                <th className="text-right pb-2 font-medium">마지막 수신</th>
                <th className="text-right pb-2 font-medium">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {detail.devices.map(d => {
                const state = !d.active ? { tone: "idle" as const, label: "비활성" }
                  : d.online ? { tone: "ok" as const, label: "온라인" }
                  : { tone: "danger" as const, label: "끊김" }
                return (
                  <tr key={d.id}>
                    <td className="py-2.5 pr-3">
                      <p className="font-medium text-foreground">{d.name}</p>
                      {d.serial && <p className="text-xs text-muted-foreground font-mono">{d.serial}</p>}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      {d.farm_name || "—"}<span className="text-muted-foreground/70"> / </span>{d.tank_name || "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground font-mono text-xs">{d.version || "—"}</td>
                    <td className="py-2.5 pr-3 text-right text-xs whitespace-nowrap">
                      <span className="text-foreground tabular-nums">{relTime(d.last_seen_at)}</span>
                      {d.last_seen_at && <span className="block text-muted-foreground tabular-nums">{absTime(d.last_seen_at)}</span>}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", TONE_TEXT[state.tone])}>
                        <Dot tone={state.tone} />{state.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

// 최근 수질 기록 — /api/admin/readings?user=<id>&page=1(기본 최근 30일)의 앞 5건.
// 사용자 상세 API 와 따로 불러, 이 카드가 실패해도 상세 화면은 그대로 보인다.
function RecentReadingsCard({ userId }: { userId: string }) {
  const { user } = useAuth()
  const isMock = isMonitorAccount(user?.email) || isTestAccount(user?.email)
  const [rows, setRows] = useState<AdminReadingRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [problem, setProblem] = useState<LoadProblem | null>(null)

  useEffect(() => {
    if (!user) return
    let alive = true
    const t = setTimeout(async () => {
      try {
        if (isMock) {
          const { response } = mockReadingsResponse({ ...DEFAULT_READINGS_FILTER, user: userId }, Date.now())
          if (!alive) return
          setRows(response.rows.slice(0, 5)); setTotal(response.total); setProblem(null)
          return
        }
        const res = await fetch(`/api/admin/readings?user=${encodeURIComponent(userId)}&page=1`, { cache: "no-store" })
        if (!alive) return
        if (!res.ok) { setProblem(problemOf(res.status)); setRows(null); return }
        const body = await res.json() as { total: number; rows: AdminReadingRow[] }
        if (!alive) return
        setRows(body.rows.slice(0, 5)); setTotal(body.total); setProblem(null)
      } catch {
        if (alive) { setProblem("failed"); setRows(null) }
      }
    }, 0)
    return () => { alive = false; clearTimeout(t) }
  }, [user, isMock, userId])

  const base = `/admin/readings?user=${encodeURIComponent(userId)}`
  const linkCls = "inline-flex items-center gap-1 min-h-[44px] px-1 text-sm text-muted-foreground hover:text-foreground underline-offset-2 hover:underline rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

  return (
    <Section
      icon={Droplets}
      title="최근 수질 기록"
      className="lg:col-span-2"
      aside={rows && <span className="text-xs text-muted-foreground tabular-nums">최근 30일 {total.toLocaleString("ko-KR")}건</span>}
    >
      {problem ? (
        <Empty>
          {problem === "forbidden" ? "수질 기록을 볼 권한이 없습니다"
            : problem === "service_key" ? "서비스 롤 키가 없어 수질 기록을 조회할 수 없습니다"
            : "수질 기록을 불러오지 못했습니다"}
        </Empty>
      ) : rows === null ? (
        <div className="space-y-2" role="status" aria-label="수질 기록 불러오는 중">
          {[0, 1, 2].map(i => <div key={i} className="h-5 bg-muted rounded animate-pulse" />)}
        </div>
      ) : rows.length === 0 ? (
        <Empty>최근 30일 수질 기록이 없습니다</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map(r => (
            <li key={r.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 text-sm">
              <div className="flex items-center gap-2 min-w-0 sm:w-[19rem] shrink-0">
                <span className="text-foreground"><RecordedAt row={r} /></span>
                <SourceBadge kind={r.source_kind} deviceName={r.device_name} compact />
                <LateEntryMark row={r} />
              </div>
              <span className="text-muted-foreground truncate min-w-0 flex-1">
                {r.farm_name} · {unitOf(r.farm_type)} {r.tank_name}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                수온 <WqValue v={r.values.temperature} /> · pH <WqValue v={r.values.ph} /> · DO <WqValue v={r.values.do_level} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap justify-end gap-x-4 mt-1">
        <Link href={`${base}&source=manual`} className={linkCls}>
          수기 기록만 <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
        <Link href={base} className={linkCls}>
          전체 보기 <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>
    </Section>
  )
}

function AlertIcon({ type }: { type: string }) {
  if (type === "danger") return <XCircle className={cn("w-4 h-4 shrink-0", TONE_TEXT.danger)} aria-label="위험" />
  if (type === "warning") return <AlertCircle className={cn("w-4 h-4 shrink-0", TONE_TEXT.warn)} aria-label="주의" />
  return <Info className="w-4 h-4 shrink-0 text-muted-foreground" aria-label="안내" />
}

function AlertsCard({ detail, className }: { detail: AdminUserDetail; className?: string }) {
  const { open_count, recent } = detail.alerts
  return (
    <Section
      icon={Bell}
      title="최근 알림"
      className={className}
      aside={open_count !== null && (
        <span className="text-xs text-muted-foreground tabular-nums">
          미해결 <span className={cn("font-semibold", open_count > 0 ? TONE_TEXT.danger : "text-foreground")}>{open_count}</span>
        </span>
      )}
    >
      {recent.length === 0 ? (
        <Empty>최근 알림이 없습니다</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {recent.map(a => (
            <li key={a.id} className="py-2.5 flex items-start gap-2.5">
              <AlertIcon type={a.type} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground break-words">{a.message}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {[a.farm_name, a.tank_name].filter(Boolean).join(" · ") || "—"}
                  {a.parameter && <> · {a.parameter}</>}
                  {a.resolved && <> · 해결됨</>}
                </p>
              </div>
              <time dateTime={a.created_at} title={absTime(a.created_at)} className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                {relTime(a.created_at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function ViewerLinksCard({ links }: { links: NonNullable<AdminUserDetail["viewer_links"]> }) {
  return (
    <Section icon={Eye} title="열람 연결">
      <p className="text-xs text-muted-foreground mb-1">이 사용자가 열람자로 연결된 다른 사람의 농장입니다.</p>
      <ul className="divide-y divide-border">
        {links.map(l => (
          <li key={l.farm_id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-foreground truncate">{l.farm_name}</span>
            <span className="text-muted-foreground shrink-0">소유자 {l.owner_name}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ─── 로딩·오류 ───────────────────────────────────────────────────────────────

function DetailSkeleton() {
  const bar = "bg-muted rounded animate-pulse"
  return (
    <div className="space-y-4" role="status" aria-label="사용자 정보를 불러오는 중">
      <div className={cn(bar, "h-5 w-24")} />
      <div className="space-y-2">
        <div className={cn(bar, "h-7 w-48")} />
        <div className={cn(bar, "h-4 w-64 max-w-full")} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={cn("rounded-xl border border-border p-4 space-y-3", i >= 2 && "lg:col-span-2")}>
            <div className={cn(bar, "h-4 w-20")} />
            <div className={cn(bar, "h-4 w-full")} />
            <div className={cn(bar, "h-4 w-5/6")} />
            <div className={cn(bar, "h-4 w-2/3")} />
          </div>
        ))}
      </div>
    </div>
  )
}

const ERROR_TEXT: Record<LoadError, { title: string; body: string }> = {
  401: { title: "로그인이 필요합니다", body: "세션이 만료되었습니다. 다시 로그인한 뒤 시도해 주세요." },
  403: { title: "볼 권한이 없습니다", body: "사용자 상세는 관리자와 총관리자만 볼 수 있습니다." },
  404: { title: "사용자를 찾을 수 없습니다", body: "삭제되었거나 주소가 잘못되었을 수 있습니다." },
  500: { title: "정보를 불러오지 못했습니다", body: "잠시 뒤 다시 시도해 주세요. 계속되면 시스템 진단을 확인해 주세요." },
  503: { title: "서비스 롤 키 미설정", body: "서버에 SUPABASE_SERVICE_ROLE_KEY 가 없어 사용자 정보를 조회할 수 없습니다." },
}

function DetailError({ code, onRetry, retrying }: { code: LoadError; onRetry: () => void; retrying: boolean }) {
  const t = ERROR_TEXT[code]
  return (
    <div className="space-y-4">
      <BackLink />
      <div className="flex flex-col items-center justify-center text-center gap-3 py-16 px-4 rounded-xl border border-border bg-card" role="alert">
        <AlertCircle className="w-10 h-10 text-muted-foreground" aria-hidden="true" />
        <p className="font-semibold text-foreground">{t.title}</p>
        <p className="text-sm text-muted-foreground max-w-sm">{t.body}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={retrying}
          className="border-border gap-2 min-h-[44px]"
        >
          <RefreshCw className={cn("w-4 h-4", retrying && "animate-spin")} aria-hidden="true" />
          다시 시도
        </Button>
      </div>
    </div>
  )
}
