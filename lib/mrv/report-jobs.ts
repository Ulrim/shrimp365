/**
 * 리포트 주간/월간 자동 생성 + 이메일 발송 배치. (사양서 화면 6번)
 *
 * ── 원본은 어떻게 했나 ─────────────────────────────────────────────────────
 * 원본에는 리포트 자동 생성이 없었다. 알림 배치(`alert-jobs.ts`)만 있었고, 이 배치는
 * 그 모양을 그대로 따른다 — 사이트 단위 실패는 배치를 멈추지 않고 `failures` 에 모아
 * 돌려주며, 호출부(스케줄 라우트)가 로그로 남긴다.
 *
 * ── 기간 규칙 — 같은 기간을 두 번 만들지 않는다 ────────────────────────────
 *   weekly  : 매주 월요일 00:00 UTC 에 **직전 월~일** (7일)
 *   monthly : 매월 1일 00:00 UTC 에 **직전 달**
 *
 * 일정은 `last_period_end` 를 들고 있다. 다음 실행은 거기서 이어진다. 그래서 cron 이
 * 하루에 한 번 두드려도(Vercel Hobby 는 하루 1회가 상한) 월요일/1일에만 새 기간이 생기고,
 * 그 밖의 날에는 "아직 때가 아니다" 로 아무것도 만들지 않는다. **중복 발행은 증빙에서
 * 특히 나쁘다** — 같은 기간에 리포트가 둘이면 어느 쪽이 근거인지 사람이 고르게 된다.
 *
 * cron 이 며칠 멈췄다 돌아오면 밀린 기간을 **한 번에 하나씩** 만든다(실행당 일정마다
 * 최대 한 건). 밀린 걸 한꺼번에 다 만들면 한 번의 실행이 길어져 시간 제한에 걸리고,
 * 다음 날 다시 돌면 어차피 이어진다.
 *
 * ── 기준선이 없는 사이트는 건너뛰고 그 사실을 적는다 ─────────────────────
 * MRV 리포트는 잠긴 기준선이 있어야 만들어진다(`generateMrvReport`). 없는 사이트의
 * 일정은 실패가 아니라 **아직 조건이 안 된 것**이고, `last_status` 에 그렇게 적는다.
 * 사람이 기준선을 잠그면 다음 실행부터 저절로 만들어진다.
 *
 * ── 보냈다는 사실이 증빙이다 ──────────────────────────────────────────────
 * 수신자마다 `mrv_report_deliveries` 에 한 줄을 남긴다 — 성공·실패·보내지 않음 전부.
 * 발송기가 꺼져 있으면(log 모드) 'skipped' 로 남는다. 안 보낸 사실도 기록이어야 "왜
 * 안 왔나" 에 답할 수 있다.
 */

import { T, fetchAll, newId, type MrvDb } from "./db"
import { generateMrvReport } from "./mrv-report-service"
import { recordAudit } from "./audit"
import { mailTransportFromEnv, type MailTransport } from "./mailer"
import type { SiteRow } from "./tenancy"

export type ReportCadence = "weekly" | "monthly"

export type ReportScheduleRow = {
  id: string
  site_id: string
  org_id: string
  cadence: ReportCadence
  enabled: boolean
  recipients: string[]
  template_id: string | null
  last_period_end: string | null
  last_run_at: string | null
  last_status: string | null
  last_error: string | null
  created_by: string
}

/** 날짜만 쓰는 UTC 자정. */
function utcMidnight(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d))
}

/**
 * 이번 실행에서 만들어야 할 기간. **순수 함수** — `now` 와 `lastPeriodEnd` 만 본다.
 *
 * 반환이 null 이면 "아직 때가 아니다". 밀린 기간이 여럿이면 **가장 오래된 하나**를
 * 돌려준다(다음 실행이 이어 받는다).
 */
export function duePeriod(
  cadence: ReportCadence,
  now: Date,
  lastPeriodEnd: Date | null,
): { from: Date; to: Date } | null {
  // 지금 시각 기준으로 **완전히 끝난** 가장 최근 기간의 끝.
  const latestEnd =
    cadence === "weekly"
      ? (() => {
          // 이번 주 월요일 00:00 UTC 가 "끝난 주" 의 끝이다.
          const d = utcMidnight(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
          const dow = (d.getUTCDay() + 6) % 7 // 월=0 … 일=6
          return new Date(d.getTime() - dow * 86_400_000)
        })()
      : utcMidnight(now.getUTCFullYear(), now.getUTCMonth(), 1)

  const span = (end: Date): Date =>
    cadence === "weekly"
      ? new Date(end.getTime() - 7 * 86_400_000)
      : utcMidnight(end.getUTCFullYear(), end.getUTCMonth() - 1, 1)

  if (lastPeriodEnd === null) {
    // 첫 실행: 가장 최근에 끝난 기간 하나.
    const from = span(latestEnd)
    return { from, to: latestEnd }
  }
  if (lastPeriodEnd.getTime() >= latestEnd.getTime()) return null // 이미 만들었다.

  // 밀린 것 중 가장 오래된 하나 — 마지막으로 만든 기간의 끝에서 이어지는 기간.
  const from = lastPeriodEnd
  const to =
    cadence === "weekly"
      ? new Date(from.getTime() + 7 * 86_400_000)
      : utcMidnight(from.getUTCFullYear(), from.getUTCMonth() + 1, 1)
  if (to.getTime() > latestEnd.getTime()) return null
  return { from, to }
}

export type ReportJobOutcome = {
  scheduleId: string
  siteId: string
  cadence: ReportCadence
  /** generated | not_due | no_baseline | failed */
  status: string
  reportId: string | null
  period: { from: string; to: string } | null
  deliveries: { recipient: string; status: string }[]
  error: string | null
}

export type ReportJobResult = {
  evaluatedSchedules: number
  generated: number
  outcomes: ReportJobOutcome[]
  failures: string[]
}

const TITLE_PREFIX: Record<ReportCadence, string> = { weekly: "주간", monthly: "월간" }

function mailText(params: {
  siteName: string
  cadence: ReportCadence
  from: Date
  to: Date
  reportId: string
  reductionTco2e: number | null
  baseUrl: string | null
}): { subject: string; text: string } {
  const period = `${params.from.toISOString().slice(0, 10)} ~ ${params.to.toISOString().slice(0, 10)}`
  const subject = `[컬리버 MRV] ${params.siteName} ${TITLE_PREFIX[params.cadence]} 리포트 (${period})`
  const link = params.baseUrl
    ? `${params.baseUrl.replace(/\/$/, "")}/mrv/mrv-reports/${encodeURIComponent(params.reportId)}`
    : `리포트 ID ${params.reportId}`
  const reduction =
    params.reductionTco2e === null
      ? "산출 불가 — 리포트의 「산출 불가 사유」 절을 보십시오"
      : `${params.reductionTco2e.toFixed(4)} tCO2e`
  const text = [
    `${params.siteName} 의 ${TITLE_PREFIX[params.cadence]} MRV 리포트가 자동 생성되었습니다.`,
    "",
    `기간(After): ${period}`,
    `감축량(Scope 2): ${reduction}`,
    `리포트: ${link}`,
    "",
    "이 메일은 자동 생성 일정에 따라 발송되었습니다. 수치의 근거(산식 전문·측정경계·",
    "배출계수 출처)는 리포트 본문에 있습니다. 리포트는 발행 후 바뀌지 않습니다.",
  ].join("\n")
  return { subject, text }
}

/**
 * 모든 조직의 켜진 일정을 돌며 때가 된 기간의 리포트를 만들고 보낸다.
 *
 * `db` 는 service_role 클라이언트여야 한다(모든 조직을 돈다). 호출부가 CRON_SECRET 으로
 * 닫혀 있는 이유다.
 */
export async function jobGenerateReports(
  db: MrvDb,
  options: { now?: Date; transport?: MailTransport; baseUrl?: string | null } = {},
): Promise<ReportJobResult> {
  const now = options.now ?? new Date()
  const transport = options.transport ?? mailTransportFromEnv()
  const baseUrl = options.baseUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? null

  const schedules = await fetchAll<ReportScheduleRow>((f, t) =>
    db
      .from(T.reportSchedules)
      // 한 줄 리터럴이어야 한다 — 문자열 연결을 넘기면 Supabase 의 열 목록 타입 파서가
      // 리터럴 유니온을 해석하지 못해 행 타입이 GenericStringError 로 깨진다(kpi-service 와 같다).
      .select("id, site_id, org_id, cadence, enabled, recipients, template_id, last_period_end, last_run_at, last_status, last_error, created_by")
      .eq("enabled", true)
      .order("id", { ascending: true })
      .range(f, t),
  )

  const outcomes: ReportJobOutcome[] = []
  const failures: string[] = []
  let generated = 0

  for (const sch of schedules) {
    const base = { scheduleId: sch.id, siteId: sch.site_id, cadence: sch.cadence }
    try {
      const period = duePeriod(
        sch.cadence,
        now,
        sch.last_period_end ? new Date(sch.last_period_end) : null,
      )
      if (period === null) {
        outcomes.push({ ...base, status: "not_due", reportId: null, period: null, deliveries: [], error: null })
        continue
      }

      const { data: siteData, error: siteErr } = await db
        .from(T.sites)
        .select("id, org_id, name, region, ras_type, alert_enabled_types")
        .eq("id", sch.site_id)
        .maybeSingle()
      if (siteErr) throw siteErr
      const site = siteData as SiteRow | null
      if (!site) throw new Error(`site not found: ${sch.site_id}`)

      // 기준선이 없으면 "아직 조건이 안 됐다". 실패로 세지 않고 그렇게 적는다.
      const { data: bsl, error: bslErr } = await db
        .from(T.baselines)
        .select("id")
        .eq("site_id", sch.site_id)
        .eq("status", "locked")
        .maybeSingle()
      if (bslErr) throw bslErr
      if (!bsl) {
        await db
          .from(T.reportSchedules)
          .update({
            last_run_at: now.toISOString(),
            last_status: "no_baseline",
            last_error: "잠긴 기준선이 없어 리포트를 만들 수 없습니다. 기준선을 잠그면 다음 실행부터 만들어집니다.",
          })
          .eq("id", sch.id)
        outcomes.push({
          ...base, status: "no_baseline", reportId: null,
          period: { from: period.from.toISOString(), to: period.to.toISOString() },
          deliveries: [], error: null,
        })
        continue
      }

      const result = await generateMrvReport({
        db,
        site,
        orgId: sch.org_id,
        userId: `schedule:${sch.id}`,
        afterPeriodFrom: period.from,
        afterPeriodTo: period.to,
        emissionFactorId: null,
        templateId: sch.template_id,
      })
      generated += 1

      // 발송 — 수신자마다 기록 한 줄.
      const { subject, text } = mailText({
        siteName: site.name,
        cadence: sch.cadence,
        from: period.from,
        to: period.to,
        reportId: result.report.id,
        reductionTco2e: result.report.reduction_tco2e,
        baseUrl,
      })
      const deliveries: { recipient: string; status: string }[] = []
      for (const recipient of sch.recipients ?? []) {
        const sent = await transport.send({ to: recipient, subject, text })
        deliveries.push({ recipient, status: sent.status })
        const { error: delErr } = await db.from(T.reportDeliveries).insert({
          id: newId("dlv"),
          report_id: result.report.id,
          org_id: sch.org_id,
          channel: "email",
          recipient,
          status: sent.status,
          provider: sent.provider,
          error:
            sent.status === "failed" ? sent.error : sent.status === "skipped" ? sent.reason : null,
          attempted_at: new Date().toISOString(),
        })
        if (delErr) throw delErr
      }

      await db
        .from(T.reportSchedules)
        .update({
          last_period_end: period.to.toISOString(),
          last_run_at: now.toISOString(),
          last_status: "generated",
          last_error: null,
        })
        .eq("id", sch.id)

      await recordAudit(db, {
        orgId: sch.org_id,
        actorId: `schedule:${sch.id}`,
        entity: "mrv_reports",
        entityId: result.report.id,
        action: "auto_generate",
        diff: {
          before: null,
          after: {
            schedule_id: sch.id,
            cadence: sch.cadence,
            period: { from: period.from.toISOString(), to: period.to.toISOString() },
            recipients: sch.recipients ?? [],
            deliveries,
          },
        },
        note: `${TITLE_PREFIX[sch.cadence]} 자동 생성`,
      })

      outcomes.push({
        ...base, status: "generated", reportId: result.report.id,
        period: { from: period.from.toISOString(), to: period.to.toISOString() },
        deliveries, error: null,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failures.push(`schedule ${sch.id} (site ${sch.site_id}): ${message}`)
      outcomes.push({ ...base, status: "failed", reportId: null, period: null, deliveries: [], error: message })
      // 실패도 일정에 적는다 — 화면이 "마지막 실행이 왜 안 됐는가" 를 보여 줄 수 있게.
      await db
        .from(T.reportSchedules)
        .update({ last_run_at: now.toISOString(), last_status: "failed", last_error: message.slice(0, 500) })
        .eq("id", sch.id)
        .then(() => undefined, () => undefined)
    }
  }

  return { evaluatedSchedules: schedules.length, generated, outcomes, failures }
}
