"use client"

/**
 * 기준선 잠금 전 입력 충분성 보고.
 *
 * 되돌릴 수 없는 동작 앞이므로 **숫자를 숨기지 않는다.** 항목마다 무엇을 봤고(관측값),
 * 기준이 얼마였는지(임계값)를 그대로 적는다. 통과/미달은 색이 아니라 **기호 + 글자**로
 * 먼저 전달한다(색만으로 의미를 전달하지 않는다는 규칙).
 *
 * 판정 자체는 서버가 한다 — 이 컴포넌트는 받은 결과를 그리기만 하고 어떤 기준도 다시
 * 적용하지 않는다. 화면이 따로 판정하면 "미리보기는 통과라는데 잠금은 거부한다" 가 생긴다.
 */

import type { BaselineReadinessCheck, BaselineReadinessResponse } from "@/lib/mrv/api-types"

type Presentation = { icon: string; label: string; textClass: string; bgClass: string }

const PASSED: Presentation = {
  icon: "●",
  label: "충족",
  textClass: "text-mrv-green",
  bgClass: "bg-mrv-green-bg",
}
const FAILED_BLOCKING: Presentation = {
  icon: "■",
  label: "미달",
  textClass: "text-mrv-red",
  bgClass: "bg-mrv-red-bg",
}
const FAILED_WARNING: Presentation = {
  icon: "▲",
  label: "주의",
  textClass: "text-mrv-amber",
  bgClass: "bg-mrv-amber-bg",
}
const INFO: Presentation = {
  icon: "–",
  label: "참고",
  textClass: "text-mrv-na",
  bgClass: "bg-mrv-na-bg",
}

function presentationFor(check: BaselineReadinessCheck): Presentation {
  if (check.severity === "info") return INFO
  if (check.passed) return PASSED
  return check.severity === "blocking" ? FAILED_BLOCKING : FAILED_WARNING
}

function CheckRow({ check }: { check: BaselineReadinessCheck }) {
  const p = presentationFor(check)
  const showNumbers =
    check.observed !== null &&
    check.observed !== undefined &&
    check.threshold !== null &&
    check.threshold !== undefined
  return (
    <li className="flex items-start gap-2 border-b border-mrv-border py-2 last:border-0">
      <span
        className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${p.bgClass} ${p.textClass}`}
      >
        <span aria-hidden="true">{p.icon}</span>
        <span>{p.label}</span>
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm text-mrv-fg">{check.message}</p>
        {showNumbers && (
          <p className="text-[11px] tabular-nums text-mrv-muted">
            관측 {check.observed} · 기준 {check.threshold}
          </p>
        )}
      </div>
    </li>
  )
}

export function BaselineReadinessReport({
  readiness,
}: {
  readiness: BaselineReadinessResponse
}) {
  const blockingFailed = readiness.checks.filter(
    (c) => c.severity === "blocking" && !c.passed,
  )

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-mrv-border bg-mrv-surface p-5"
      aria-label="기준선 입력 충분성 점검"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-mrv-fg">입력 충분성 점검</h2>
        <span
          role="status"
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            readiness.ok ? `${PASSED.bgClass} ${PASSED.textClass}` : `${FAILED_BLOCKING.bgClass} ${FAILED_BLOCKING.textClass}`
          }`}
        >
          <span aria-hidden="true">{readiness.ok ? PASSED.icon : FAILED_BLOCKING.icon}</span>
          <span>{readiness.ok ? "잠글 수 있습니다" : `미달 ${blockingFailed.length}건`}</span>
        </span>
      </header>

      {/* 어느 기간을 판정한 결과인지 반드시 보인다. 응답에 이미 들어 있는 값이고,
          이게 없으면 기간을 바꾼 직후의 화면에서 어느 기간의 숫자인지 알 수 없다. */}
      <p className="text-xs tabular-nums text-mrv-fg">
        판정 기간 {readiness.period.from.slice(0, 10)} ~ {readiness.period.to.slice(0, 10)}
      </p>

      <p className="text-xs text-mrv-muted">
        잠긴 기준선은 되돌릴 수 없고 이후 모든 전·후 비교와 Scope2 감축량의 원점이 됩니다.
        그래서 잠그기 전에 이 기간의 입력이 충분한지 먼저 확인합니다.
      </p>

      <ul className="flex flex-col">
        {readiness.checks.map((c) => (
          <CheckRow key={c.id} check={c} />
        ))}
      </ul>

      <footer className="flex flex-col gap-0.5 border-t border-mrv-border pt-2 text-[11px] leading-tight text-mrv-muted">
        <span>
          판정 기준 출처:{" "}
          {readiness.policy_source === "kpi_config"
            ? `kpi_config ${readiness.config_version}`
            : `코드 기본값 (kpi_config 에 baseline 설정 없음 · 산식 버전 ${readiness.config_version})`}
        </span>
        <span>
          최소 {readiness.policy.min_period_days}일 · 전력 계측값 하루 계측기당{" "}
          {readiness.policy.min_readings_per_meter_day}건 · 급이 기록{" "}
          {readiness.policy.min_feed_logs}건 · 제외율 상한{" "}
          {(readiness.policy.max_excluded_reading_ratio * 100).toFixed(0)}%
        </span>
      </footer>
    </section>
  )
}
