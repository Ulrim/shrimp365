/**
 * POST /api/mrv/sites/{siteId}/baseline/lock — 기준선 잠금.
 * 원본: apps/api/app/routers/baseline.py::lock_baseline
 *
 * 순서: 소유권 확인 → 기존 잠금 확인(409) → 4종 KPI 산출 → **입력 충분성 판정** →
 *       스냅샷 영속화 → locked 행 삽입 → 감사 로그.
 *
 * **충분성 판정은 원본에 없던 단계다.** 잠긴 기준선은 불변이고(API 에 수정 경로가 없고 DB
 * 트리거가 UPDATE/DELETE 를 거부한다) 이후 모든 전·후 비교와 Scope2 감축량의 원점이
 * 되는데, 원본도 이식본도 기간 유효성만 보고 잠갔다 — **계측값 세 건으로 계산된 기준선도
 * 그대로, 영구히 박혔다.** 되돌릴 수 없는 결정에 입력 가드가 없는 것이 가장 큰 구멍이라
 * 여기서 막는다. 판정 규칙은 `lib/mrv/baseline-readiness.ts` 한 곳에 있고 미리보기 창구
 * (`GET .../baseline/readiness`)가 같은 함수를 쓴다.
 *
 * 강행(`acknowledge_insufficient`)을 남겨 둔 이유: 시범 사이트처럼 기준에 못 미쳐도
 * 잠가야 하는 경우가 실제로 있다. 대신 **사유 문자열을 요구하고 판정 결과 전체를 감사
 * 로그에 남긴다** — 심사위원이 "이 기준선은 무엇을 무시하고 잠갔나"를 되짚을 수 있어야
 * 하기 때문이다. 단 '5종 지표가 전부 산출 불가'는 강행으로도 넘기지 못한다. 비교의
 * 원점으로 쓸 수 없는 값을 영구히 박는 일이라 판단의 문제가 아니다.
 *
 * 원본은 이 전체를 한 트랜잭션으로 묶었다. PostgREST 에는 그런 트랜잭션 경계가 없으므로,
 * 대신 부분 유니크 인덱스(사이트당 잠긴 기준선 1개)를 최종 방어선으로 삼는다 — 사전
 * 조회와 삽입 사이에 다른 요청이 끼어들어도 DB 가 두 번째 잠금을 거부하고, 그 오류를
 * 원본과 같은 409 로 되돌린다. 스냅샷 행이 먼저 만들어졌다가 잠금이 실패하면 고아
 * 스냅샷이 하나 남지만, 스냅샷은 append-only 기록이라 남아 있어도 해가 없다
 * (어떤 산출도 스냅샷 개수에 의존하지 않는다).
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireWriter } from "@/lib/mrv/auth"
import { HttpError, handleRoute, parseInstant } from "@/lib/mrv/http"
import { T, newId } from "@/lib/mrv/db"
import { resolveSiteForOrg } from "@/lib/mrv/tenancy"
import { computeSiteKpiResults } from "@/lib/mrv/kpi-service"
import { persistKpiSnapshot } from "@/lib/mrv/snapshots"
import { recordAudit } from "@/lib/mrv/audit"
import { baselineRowToResponse, type BaselineRow } from "@/lib/mrv/baseline"
import {
  assessBaselineReadiness,
  failedBlockingSummary,
} from "@/lib/mrv/baseline-readiness"

/** Postgres 유니크 위반. 사이트당 잠긴 기준선이 이미 있다는 뜻이다. */
const UNIQUE_VIOLATION = "23505"

/** 강행 사유의 길이 상한. 감사 로그 diff 에 그대로 실리므로 상한이 필요하다. */
const MAX_ACK_LENGTH = 1000

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  return handleRoute(async () => {
    const { siteId } = await params
    const auth = requireWriter(await authorizeMrv(req))

    const body = (await req.json()) as {
      period?: { from?: string; to?: string }
      /**
       * 충분성 미달을 알고도 잠그겠다는 선언 **겸 그 사유**. 불리언이 아니라 문자열인
       * 것은 의도다 — 체크박스 하나는 아무 설명도 남기지 않지만, 사유는 감사 로그에
       * 남아 나중에 읽힌다.
       */
      acknowledge_insufficient?: unknown
    }
    if (!body.period?.from || !body.period?.to) {
      throw new HttpError(422, "period.from and period.to are required")
    }
    // body 는 검증 없는 캐스팅이므로 타입을 직접 본다. 문자열이 아닌 값에 .trim() 을
    // 부르면 TypeError 가 나고 handleRoute 가 그것을 500 "internal server error" 로
    // 바꾼다 — 입력 오류는 422 로 돌려준다는 이 저장소의 규약과 어긋난다.
    const rawAck = body.acknowledge_insufficient
    if (rawAck !== undefined && rawAck !== null && typeof rawAck !== "string") {
      throw new HttpError(422, "acknowledge_insufficient must be a string")
    }
    // 이 문자열은 그대로 audit_logs 의 diff jsonb 에 들어간다. 상한을 두지 않으면 감사
    // 로그가 임의 길이 본문의 저장소가 된다(사용자 초대의 email 320자 상한과 같은 취지).
    if (typeof rawAck === "string" && rawAck.length > MAX_ACK_LENGTH) {
      throw new HttpError(
        422,
        `acknowledge_insufficient must be at most ${MAX_ACK_LENGTH} characters`,
      )
    }
    const acknowledgement = typeof rawAck === "string" ? rawAck.trim() || null : null
    const periodFrom = parseInstant(body.period.from, "period.from")
    const periodTo = parseInstant(body.period.to, "period.to")
    if (periodFrom.getTime() >= periodTo.getTime()) {
      throw new HttpError(422, "'from' must be strictly before 'to'")
    }

    await resolveSiteForOrg(auth.db, siteId, auth.orgId)

    const { data: existing, error: existingError } = await auth.db
      .from(T.baselines)
      .select("id")
      .eq("site_id", siteId)
      .eq("status", "locked")
      .maybeSingle()
    if (existingError) throw existingError
    if (existing) {
      throw new HttpError(409, "a locked baseline already exists for this site")
    }

    const comp = await computeSiteKpiResults(auth.db, siteId, periodFrom, periodTo)

    // 충분성 판정은 **스냅샷을 쓰기 전에** 한다. 거부할 기준선의 스냅샷을 남기면
    // append-only 기록에 쓰이지 않을 행이 쌓인다.
    const readiness = assessBaselineReadiness(
      comp,
      { from: periodFrom, to: periodTo },
      comp.paramsOut,
    )
    if (readiness.fatal) {
      throw new HttpError(
        422,
        `${failedBlockingSummary(readiness)} 이 항목은 강행할 수 없습니다.`,
      )
    }
    if (!readiness.ok && !acknowledgement) {
      throw new HttpError(
        422,
        `${failedBlockingSummary(readiness)} ` +
          "기간을 다시 고르거나, 그대로 잠그려면 'acknowledge_insufficient' 에 사유를 적어 보내세요.",
      )
    }

    const snapshotId = await persistKpiSnapshot(auth.db, {
      siteId,
      orgId: auth.orgId,
      periodStart: periodFrom,
      periodEnd: periodTo,
      comp,
    })

    const row: BaselineRow = {
      id: newId("bsl"),
      site_id: siteId,
      org_id: auth.orgId,
      period_start: periodFrom.toISOString(),
      period_end: periodTo.toISOString(),
      ei_total: comp.ei.eiTotal,
      ei_aeration: comp.ei.eiAeration,
      oei: comp.oei?.oei ?? null,
      fcr: comp.fcr.fcr,
      mortality_rate: comp.mortality.cumulativeRatePct,
      config_version: comp.configVersion,
      kpi_snapshot_id: snapshotId,
      status: "locked",
      locked_by: auth.userId,
      locked_at: new Date().toISOString(),
    }

    const { error } = await auth.db.from(T.baselines).insert(row)
    if (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new HttpError(409, "a locked baseline already exists for this site")
      }
      throw error
    }

    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "baselines",
      entityId: row.id,
      action: "lock",
      diff: {
        before: null,
        after: {
          id: row.id,
          status: "locked",
          period: { from: row.period_start, to: row.period_end },
          config_version: row.config_version,
          kpi_snapshot_id: snapshotId,
          metrics: {
            ei_total: row.ei_total,
            ei_aeration: row.ei_aeration,
            oei: row.oei,
            fcr: row.fcr,
            mortality_rate: row.mortality_rate,
          },
          /**
           * 잠글 때의 입력 충분성 판정을 통째로 남긴다. 기준선 행 자체에는 이 정보를
           * 담을 열이 없고(스키마 변경은 사람이 SQL 을 돌려야 한다), 감사 로그가 바로
           * 이런 "왜 이렇게 결정했나"를 담는 자리다. 심사위원이 되짚을 수 있어야 한다:
           * 어떤 기준으로(policy·policy_source), 무엇이 걸렸고(failed_blocking·
           * warnings), 걸린 채로 잠갔다면 그 사유가 무엇인가(acknowledged_reason).
           * 통과한 항목의 실측값은 kpi_snapshot_id 로 스냅샷의 inputs_json 을 되짚으면
           * 나오므로 여기에 중복해 싣지 않는다.
           */
          readiness: {
            ok: readiness.ok,
            policy_source: readiness.policySource,
            policy: readiness.policy,
            failed_blocking: readiness.checks
              .filter((c) => c.severity === "blocking" && !c.passed)
              .map((c) => ({ id: c.id, observed: c.observed, threshold: c.threshold })),
            // 경고도 수치를 함께 남긴다 — mortality_no_stock 처럼 "0 이었다"가 의미인
            // 항목은 id 만으로는 나중에 아무것도 되짚을 수 없다.
            warnings: readiness.checks
              .filter((c) => c.severity === "warning" && !c.passed)
              .map((c) => ({ id: c.id, observed: c.observed, threshold: c.threshold })),
            acknowledged_reason: readiness.ok ? null : acknowledgement,
          },
        },
      },
    })

    return NextResponse.json(baselineRowToResponse(row), { status: 201 })
  })
}
