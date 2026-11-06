"use client"

/**
 * 공개 데모 — 로그인 없이 보는 읽기 전용 시연.
 *
 * 외부에 플랫폼을 보여 줄 때 "로그인 없이 열어 달라" 는 요청에 대한 답이다. 앱 화면을 익명에
 * 여는 대신, 저장소에 든 시연 자료(lib/mrv/demo)만으로 같은 컴포넌트를 그린다:
 *   - KPI 카드 · 시계열 차트는 앱 화면과 **같은 컴포넌트**다(KpiCard · ReadingTimeSeriesChartView).
 *     다른 그림을 그리면 데모가 실제보다 좋아 보일 수 있어 하나로 둔다.
 *   - 비교표 · 리포트 · 실험은 같은 뷰모델·메타(comparison-view-model · mrv-meta)로 그린다.
 *   - 어떤 API 도 부르지 않는다(이 파일에 fetch 가 없다). 그래서 미들웨어가 /mrv/demo 만 보호에서 뺀다.
 *
 * 절대 규칙: 화면은 재계산하지 않는다. 모든 숫자는 픽스처(= 산식 엔진 출력)를 그대로 보인다.
 */

import Link from "next/link"
import { useMemo } from "react"
import { DEMO_FIXTURE } from "@/lib/mrv/demo/fixture"
import { METRIC_META, METRIC_ORDER } from "@/lib/mrv/ui/metric-meta"
import { READING_TYPE_META } from "@/lib/mrv/ui/reading-meta"
import { isoDay } from "@/lib/mrv/ui/period"
import { formatIsoLocal } from "@/lib/mrv/ui/datetime"
import { toComparisonViewModel } from "@/lib/mrv/ui/comparison-view-model"
import { MRV_METRIC_ROWS, formatMrvNumber } from "@/lib/mrv/ui/mrv-meta"
import { templateShowsMetric } from "@/lib/mrv/report-template"
import { isProvisionalMetric, PROVISIONAL_METRIC_MARK } from "@/lib/mrv/metric-provenance"
import { RECIPE_TYPE_LABEL, RECIPE_TYPE_ORDER, formatRecommendedValue } from "@/lib/mrv/ui/recommend-meta"
import {
  ALERT_SEVERITY_BADGE_CLASS,
  ALERT_SEVERITY_LABEL,
  ALERT_STATUS_LABEL,
  ALERT_TYPE_LABEL,
  summarizeAlertPayload,
} from "@/lib/mrv/ui/alert-meta"
import {
  CONTROL_ACTION_STATUS_BADGE_CLASS,
  CONTROL_ACTION_STATUS_LABEL,
} from "@/lib/mrv/ui/control-console-meta"
import { mapWireReadings, type SiteReadingsSeriesResult } from "@/lib/mrv/ui/use-site-readings"
import { KpiCard } from "@/components/mrv/kpi-card"
import { ReadingTimeSeriesChartView } from "@/components/mrv/reading-time-series-chart"
import { Badge, Card, formatNumber } from "@/components/mrv/ui"
import type { ComparisonViewModel, KpiCardProps, ReadingMeterType } from "@/lib/mrv/api-types"

/** 증빙 사슬 — 이 데모가 보여 주는 순서이자 플랫폼의 핵심 가치. */
const CHAIN: { step: string; title: string; anchor: string }[] = [
  { step: "①", title: "수집 · KPI", anchor: "kpi" },
  { step: "②", title: "기준선 대비 전·후", anchor: "comparison" },
  { step: "③", title: "추천 → 승인 제어", anchor: "control" },
  { step: "④", title: "알림", anchor: "alerts" },
  { step: "⑤", title: "비교실험(A/B)", anchor: "experiment" },
  { step: "⑥", title: "MRV 리포트", anchor: "report" },
]

function SectionTitle({
  id,
  step,
  title,
  description,
}: {
  id: string
  step: string
  title: string
  description: string
}) {
  return (
    <div id={id} className="flex flex-col gap-1 scroll-mt-20">
      <h2 className="text-lg font-semibold text-mrv-fg">
        <span className="mr-2 text-mrv-primary">{step}</span>
        {title}
      </h2>
      <p className="text-sm text-mrv-muted">{description}</p>
    </div>
  )
}

/** 기준선 비교와 실험 결과가 같은 표를 쓴다 — 앱 화면(/mrv/comparison)과 같은 열 구성이다. */
function ComparisonTable({
  vm,
  beforeLabel,
  afterLabel,
}: {
  vm: ComparisonViewModel
  beforeLabel: string
  afterLabel: string
}) {
  const naRows = vm.rows.filter((r) => r.baselineValue === null || r.currentValue === null)
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-xl border border-mrv-border bg-mrv-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mrv-border bg-mrv-bg text-mrv-muted">
              <th className="px-4 py-2 text-left font-medium">지표</th>
              <th className="px-4 py-2 text-right font-medium">{beforeLabel}</th>
              <th className="px-4 py-2 text-right font-medium">{afterLabel}</th>
              <th className="px-4 py-2 text-right font-medium">변화량</th>
              <th className="px-4 py-2 text-right font-medium">개선율</th>
            </tr>
          </thead>
          <tbody>
            {vm.rows.map((row) => (
              <tr key={row.key} className="border-b border-mrv-border last:border-0">
                <td className="px-4 py-2 text-mrv-fg">
                  {row.label}
                  <span className="ml-1 text-xs text-mrv-muted">
                    ({row.direction === "lower_is_better" ? "낮을수록 좋음" : "높을수록 좋음"})
                  </span>
                  {isProvisionalMetric(row.key) && (
                    <span className="ml-1 rounded border border-mrv-amber bg-mrv-amber-bg px-1 py-0.5 text-[11px] font-medium text-mrv-fg">
                      {PROVISIONAL_METRIC_MARK}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNumber(row.baselineValue)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNumber(row.currentValue)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNumber(row.deltaValue)}</td>
                <td
                  className={`px-4 py-2 text-right tabular-nums font-medium ${
                    row.improvementPct === null
                      ? "text-mrv-muted"
                      : row.improvementPct >= 0
                        ? "text-mrv-green"
                        : "text-mrv-red"
                  }`}
                >
                  {row.improvementPct === null
                    ? "산출 불가"
                    : `${row.improvementPct >= 0 ? "+" : ""}${row.improvementPct.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {naRows.length > 0 && (
        <p className="text-xs text-mrv-muted">
          「산출 불가」는 0 이 아니라 빈 값이다 — 그 구간에 지표를 낼 입력(예: 생산량 기록 두 점)이
          없었다는 뜻이고, 앱 화면은 지표마다 사유와 할 일을 적는다.
        </p>
      )}
    </div>
  )
}

export default function MrvDemoPage() {
  const f = DEMO_FIXTURE
  const { from, to } = f.period

  // 차트 시리즈 — 앱 화면의 useSiteReadings 가 돌려주는 모양을 픽스처로 그대로 만든다.
  const seriesByType = useMemo(() => {
    const map = new Map<ReadingMeterType, SiteReadingsSeriesResult[]>()
    for (const m of f.meters.items) {
      const wire = f.readings[m.id]
      if (!wire) continue
      const type = m.type as ReadingMeterType
      const target = { key: `${type}:${m.id}`, meterId: m.id, label: m.label ?? m.id }
      const list = map.get(type) ?? []
      list.push({
        key: target.key,
        label: target.label,
        target,
        data: mapWireReadings(wire),
        isLoading: false,
        isError: false,
        error: null,
      })
      map.set(type, list)
    }
    return map
  }, [f.meters.items, f.readings])
  const chartTypes = (["power", "do"] as ReadingMeterType[]).filter((t) => seriesByType.has(t))

  const comparisonVm = useMemo(() => toComparisonViewModel(f.comparison), [f.comparison])
  const experimentVm = useMemo(() => toComparisonViewModel(f.experiment.result), [f.experiment.result])
  const report = f.report
  const reportRows = MRV_METRIC_ROWS.filter((row) => templateShowsMetric(report.template, row.key))
  const recommendations = RECIPE_TYPE_ORDER.map((t) => f.recommendations.items.find((i) => i.type === t)).filter(
    (i): i is NonNullable<typeof i> => Boolean(i),
  )

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 p-6">
      {/* 머리말 */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold tracking-wide text-mrv-primary">공개 데모 · 로그인 불필요</p>
          <h1 className="text-2xl font-bold text-mrv-fg">
            기준선 → 추천/제어 → 로그 → 전후비교 → MRV 증빙, 한 줄로 이어지는 플랫폼
          </h1>
          <p className="text-sm text-mrv-muted">
            {f.site.name}
            {f.site.region ? ` · ${f.site.region}` : ""} · 기간 {isoDay(from)} ~ {isoDay(to)} · 수조{" "}
            {new Set(f.meters.items.map((m) => m.tank_id).filter(Boolean)).size}개 · 계측기 {f.meters.items.length}대
          </p>
        </div>
        <div
          role="note"
          className="rounded-xl border border-mrv-amber bg-mrv-amber-bg p-4 text-sm text-mrv-fg"
        >
          <b>시연 자료입니다.</b> 가상 양식장 30일치 계측값으로 실제 산식 엔진이 낸 결과를 그대로 보입니다.
          실제 고객 자료가 아니며 값의 크기에는 의미가 없습니다. 이 화면은 데이터베이스나 API 를 부르지
          않습니다 — 로그인 없이 열리는 화면이 조직 자료에 닿으면 안 되기 때문입니다.
        </div>
        <nav aria-label="데모 순서" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {CHAIN.map((c) => (
            <a
              key={c.anchor}
              href={`#${c.anchor}`}
              className="rounded-lg border border-mrv-border bg-mrv-surface px-3 py-2 text-xs text-mrv-fg hover:bg-mrv-bg"
            >
              <span className="mr-1 text-mrv-primary">{c.step}</span>
              {c.title}
            </a>
          ))}
        </nav>
      </section>

      {/* ① KPI */}
      <section className="flex flex-col gap-4" aria-label="핵심 지표(KPI)">
        <SectionTitle
          id="kpi"
          step="①"
          title="수집 · KPI 5종"
          description="전력·DO·급이·폐사·생산량 기록에서 산식 엔진이 낸 값. 산출 불가는 0 이 아니라 빈 값으로 두고 사유를 적는다. OEI 는 산식이 미확정이라 「잠정 지표」로 표시한다."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {METRIC_ORDER.map((key) => {
            const meta = METRIC_META[key]
            const props: KpiCardProps = {
              title: meta.title,
              metricKey: key,
              metric: f.kpi.metrics[key],
              configVersion: f.kpi.kpi_config.version,
              period: { from: f.kpi.period.from, to: f.kpi.period.to },
              betterWhen: meta.betterWhen,
              unavailabilityEvidence: f.kpi.unavailability?.evidence,
            }
            return <KpiCard key={key} {...props} />
          })}
        </div>
        <div className="flex flex-col gap-4">
          {chartTypes.map((type) => (
            <ReadingTimeSeriesChartView
              key={type}
              type={type}
              from={from}
              to={to}
              granularity="daily"
              series={seriesByType.get(type) ?? []}
              isLoading={false}
              isError={false}
              isEmpty={false}
              hasNoTarget={false}
              noMeterNotice={`${READING_TYPE_META[type].label} 계측기가 등록되어 있지 않습니다.`}
            />
          ))}
        </div>
      </section>

      {/* ② 전·후 비교 */}
      <section className="flex flex-col gap-4" aria-label="전·후 비교">
        <SectionTitle
          id="comparison"
          step="②"
          title="잠긴 기준선 대비 전·후 비교"
          description="기준선은 잠그기 전에 입력 충분성을 판정하고, 잠근 뒤에는 DB 트리거가 변경을 거부한다. 개선율은 지표 방향을 보정한 값이라 양수면 나아진 것이다."
        />
        <p className="text-sm text-mrv-muted">
          기준선 {isoDay(comparisonVm.baselinePeriod.from)} ~ {isoDay(comparisonVm.baselinePeriod.to)}
          {" · "}현재 {isoDay(comparisonVm.currentPeriod.from)} ~ {isoDay(comparisonVm.currentPeriod.to)}
          {" · "}산식 버전 {comparisonVm.baselineConfigVersion} → {comparisonVm.currentConfigVersion}
        </p>
        <ComparisonTable vm={comparisonVm} beforeLabel="기준선(Before)" afterLabel="현재(After)" />
      </section>

      {/* ③ 추천 → 승인 제어 */}
      <section className="flex flex-col gap-4" aria-label="추천과 승인형 제어">
        <SectionTitle
          id="control"
          step="③"
          title="추천 → 승인 → 적용 → 결과 기록"
          description="추천값은 설비에 자동 적용되지 않는다. 운영자가 승인하고 현장에서 반영한 뒤 그 사실을 기록하며, 모든 전이는 감사 로그에 남는다."
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {recommendations.map((item) => (
            <Card key={item.type} className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-mrv-fg">{RECIPE_TYPE_LABEL[item.type]}</span>
                <Badge className="bg-mrv-na-bg text-mrv-fg">v{item.current_version}</Badge>
              </div>
              <p className="text-2xl font-bold tabular-nums text-mrv-fg">
                {formatRecommendedValue(item.type, item.params) ?? "—"}
              </p>
              <p className="text-xs text-mrv-muted">{item.rationale}</p>
              <p className="text-[11px] text-mrv-muted">산식 버전 {item.config_version}</p>
            </Card>
          ))}
        </div>
        <div className="overflow-x-auto rounded-xl border border-mrv-border bg-mrv-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-mrv-border bg-mrv-bg text-mrv-muted">
                <th className="px-4 py-2 text-left font-medium">수조</th>
                <th className="px-4 py-2 text-left font-medium">제안 파라미터</th>
                <th className="px-4 py-2 text-left font-medium">상태</th>
                <th className="px-4 py-2 text-left font-medium">승인 · 적용</th>
              </tr>
            </thead>
            <tbody>
              {f.control_actions.items.map((a) => (
                <tr key={a.id} className="border-b border-mrv-border last:border-0 align-top">
                  <td className="px-4 py-2 text-mrv-fg">{a.tank_id}</td>
                  <td className="px-4 py-2">
                    <code className="text-xs text-mrv-fg">{JSON.stringify(a.recommended_json)}</code>
                  </td>
                  <td className="px-4 py-2">
                    <Badge className={CONTROL_ACTION_STATUS_BADGE_CLASS[a.status]}>
                      {CONTROL_ACTION_STATUS_LABEL[a.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-mrv-muted">
                    {a.approved_at ? `승인 ${formatIsoLocal(a.approved_at)}` : "승인 대기"}
                    {a.applied_at ? ` · 적용 ${formatIsoLocal(a.applied_at)}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ④ 알림 */}
      <section className="flex flex-col gap-4" aria-label="알림">
        <SectionTitle
          id="alerts"
          step="④"
          title="알림 — DO 저하 · 폐사 급증 · KPI 위험"
          description="일일 배치가 평가해 만든다. 미확정 지표(OEI)는 기본 감시 목록에서 빼 두어, 승인되지 않은 기준으로 빨간 알림이 나가지 않는다."
        />
        <div className="flex flex-col gap-2">
          {f.alerts.items.length === 0 && (
            <Card className="text-sm text-mrv-muted">이 기간에 만들어진 알림이 없습니다.</Card>
          )}
          {f.alerts.items.map((a) => (
            <Card key={a.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={ALERT_SEVERITY_BADGE_CLASS[a.severity]}>{ALERT_SEVERITY_LABEL[a.severity]}</Badge>
                <span className="text-sm font-semibold text-mrv-fg">{ALERT_TYPE_LABEL[a.type]}</span>
                <Badge className="bg-mrv-na-bg text-mrv-fg">{ALERT_STATUS_LABEL[a.status]}</Badge>
              </div>
              <p className="text-sm text-mrv-muted">{summarizeAlertPayload(a.type, a.payload)}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ⑤ 비교실험 */}
      <section className="flex flex-col gap-4" aria-label="비교실험(A/B)">
        <SectionTitle
          id="experiment"
          step="⑤"
          title="비교실험(A/B) — 무엇을 바꿔 보았는가"
          description="대조군·처리군 두 구간을 실험이 직접 들고 있고, 결과는 조회 때마다 라이브로 산출한다. 기준선 비교와 같은 표로 그린다. 구간은 겹칠 수 없고 결론에는 사유가 필수다."
        />
        <Card className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-mrv-fg">{f.experiment.name}</span>
            <Badge className="bg-mrv-amber-bg text-mrv-amber">
              {f.experiment.status === "running" ? "진행 중" : f.experiment.status}
            </Badge>
          </div>
          {f.experiment.hypothesis && <p className="text-sm text-mrv-muted">{f.experiment.hypothesis}</p>}
          <p className="text-xs text-mrv-muted">
            대조군 {isoDay(f.experiment.control_from)} ~ {isoDay(f.experiment.control_to)} · 처리군{" "}
            {isoDay(f.experiment.treatment_from)} ~ {isoDay(f.experiment.treatment_to)}
          </p>
        </Card>
        <ComparisonTable vm={experimentVm} beforeLabel="대조군" afterLabel="처리군" />
      </section>

      {/* ⑥ MRV 리포트 */}
      <section className="flex flex-col gap-4" aria-label="MRV 리포트">
        <SectionTitle
          id="report"
          step="⑥"
          title="MRV 리포트 — Scope 2 location · market-based 병기"
          description="배출계수와 출처는 발행 시점에 얼려 저장되고, 산식 전문이 대입값까지 인쇄된다. 계약 전력 증서(REC·PPA)가 있으면 market-based 가 location-based 옆에 나란히 실린다."
        />
        <Card className="flex flex-col gap-1 border-mrv-green bg-mrv-green-bg">
          <span className="text-xs text-mrv-muted">감축량 (Scope 2 Reduction) · 기준선 대비</span>
          <span className="text-3xl font-bold tabular-nums text-mrv-fg">
            {formatMrvNumber(report.reduction_tco2e, 4)} tCO2e
          </span>
          <span className="text-xs text-mrv-muted">
            적용 배출계수 {report.emission_factor.version} · {report.emission_factor.source} · {report.emission_factor.year}년
            {report.template ? ` · 서식 「${report.template.name}」` : ""}
          </span>
        </Card>
        <div className="overflow-x-auto rounded-xl border border-mrv-border bg-mrv-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-mrv-border bg-mrv-bg text-mrv-muted">
                <th className="px-4 py-2 text-left font-medium">지표</th>
                <th className="px-4 py-2 text-right font-medium">Before(기준선)</th>
                <th className="px-4 py-2 text-right font-medium">After(현재)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-mrv-border">
                <td className="px-4 py-2 text-mrv-fg">기간</td>
                <td className="px-4 py-2 text-right text-mrv-fg">
                  {isoDay(report.before.period.from)} ~ {isoDay(report.before.period.to)}
                </td>
                <td className="px-4 py-2 text-right text-mrv-fg">
                  {isoDay(report.after.period.from)} ~ {isoDay(report.after.period.to)}
                </td>
              </tr>
              {reportRows.map((row) => (
                <tr key={row.key} className="border-b border-mrv-border last:border-0">
                  <td className="px-4 py-2 text-mrv-fg">
                    {row.label} <span className="text-xs text-mrv-muted">({row.unit})</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-mrv-fg">
                    {formatMrvNumber(row.getValue(report.before), 4)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-mrv-fg">
                    {formatMrvNumber(row.getValue(report.after), 4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Card className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-mrv-fg">산식 전문 (재현 가능)</h3>
          <pre className="whitespace-pre-wrap break-words rounded-md bg-mrv-bg p-3 font-mono text-xs text-mrv-fg">
            {report.formula_text}
          </pre>
        </Card>
        {report.market_based && (
          <Card className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-mrv-fg">Scope 2 market-based</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col">
                <span className="text-xs text-mrv-muted">location-based (계통 평균)</span>
                <span className="text-xl font-bold tabular-nums text-mrv-fg">
                  {report.market_based.locationBasedTco2e} tCO2e
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-mrv-muted">market-based (계약 전력 반영)</span>
                <span className="text-xl font-bold tabular-nums text-mrv-fg">
                  {report.market_based.marketBasedTco2e} tCO2e
                </span>
              </div>
            </div>
            <p className="text-xs text-mrv-muted">
              총 {report.market_based.totalMwh} MWh = 계약 {report.market_based.contractualMwh} MWh + 잔여{" "}
              {report.market_based.residualMwh} MWh · 적용 증서 {report.market_based.applied.length}건
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-mrv-fg">
              {report.market_based.caveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* 맺음 */}
      <section className="flex flex-col gap-3 rounded-xl border border-mrv-border bg-mrv-surface p-6">
        <h2 className="text-lg font-semibold text-mrv-fg">실제 플랫폼은 조직 초대제입니다</h2>
        <p className="text-sm text-mrv-muted">
          여기서 본 모든 화면은 로그인 뒤 조직 단위로 격리되어 돌아갑니다. 입력 · 승인 · 무효 처리 · 기준선
          잠금은 전부 행위자와 함께 감사 로그에 남고, 리포트는 발행 시점의 계수 · 서식 · 근거 ID 를 얼려
          둡니다. 그래서 어느 숫자든 원천 계측값까지 역추적할 수 있습니다.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/login"
            className="rounded-md bg-mrv-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            로그인해서 실제 플랫폼 열기
          </Link>
          <a
            href="#kpi"
            className="rounded-md border border-mrv-border px-4 py-2 text-sm font-medium text-mrv-fg hover:bg-mrv-bg"
          >
            처음으로
          </a>
        </div>
      </section>
    </div>
  )
}
