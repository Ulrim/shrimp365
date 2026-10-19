/**
 * KPI 산식 설정 — 조회(GET)와 새 version 등록(POST).
 *
 * 원본에는 이 창구가 없다(원본 엔드포인트 41개에 kpi_config 조회/수정이 없었다).
 * 설정 화면(MASTER 4장 화면 #15)이 「KPI 산식 파라미터」를 보여 주려면 지금 어떤 값이
 * 판정에 쓰이는지 읽을 길이 필요해서 GET 을 더했다.
 *
 * ── 왜 POST 가 생겼는가 ─────────────────────────────────────────────────────
 * 전에는 **쓰기 창구를 일부러 두지 않았다.** KPI 는 요청 시점의 활성 설정(= `effective_from`
 * 이 가장 늦은 행)으로 계산되므로, 파라미터를 바꾸면 이미 지나간 기간의 신호등 판정까지
 * 소급해서 달라진다. 그 결정은 과제 책임자의 승인 절차에 속한다.
 *
 * 그런데 창구가 없다는 것이 **변경이 없다는 뜻은 아니었다.** 창구가 없는 동안 이 표를
 * 바꾸는 유일한 길은 SQL 직접 수정이었고, 그 경로에는 검증도 감사 로그도 없다.
 * 특히 `included_quality_flags` 가 그렇다 — 엔진의 `strList()`(lib/mrv/kpi/config.ts)는
 * 어떤 문자열 배열이든 그대로 받으므로, 누군가 `["ok","suspect"]` 로 바꾸면 적산 원값
 * (12,000 kWh 같은 값)이 EI 분자에 통째로 들어가고 화면에는 아무 신호도 남지 않는다.
 *
 * 그래서 전에 이 파일에 적어 둔 조건(「추가한다면 배출계수와 같은 append-only + 새
 * version + 감사 로그 형태여야 한다」)을 그대로 지켜 창구를 만들고, **그 창구가 검증을
 * 수행하는 자리**로 삼는다. 화면에서 아무 때나 바꿀 수 있게 하려는 것이 아니다 —
 * 설정 화면은 여전히 읽기 전용이며(app/mrv/settings/page.tsx), 이 창구는 SQL 직접 수정을
 * 대체해 **검증과 기록을 통과하는 경로**를 만드는 데 있다.
 *
 * ★ 검증을 엔진(`lib/mrv/kpi/`)에 넣지 않은 이유: 그 모듈들은 원본 Python 과 차분검증
 *   되어 있다(scripts/mrv/verify-config.mjs). 거기에 화이트리스트를 더하면 원본과 갈라져
 *   차분검증이 깨진다. 막을 자리는 엔진이 아니라 쓰기 경계다.
 *
 * ── POST 의 규약 ────────────────────────────────────────────────────────────
 *   - owner 전용. 조직 전역 설정이라 operator 까지 열지 않는다(배출계수와 같은 기준).
 *   - append-only. 기존 행을 고치지 않고 새 version 행을 추가한다. 과거 스냅샷이 어떤
 *     파라미터로 산출됐는지(`mrv_kpi_snapshots.config_version`) 추적 가능해야 한다.
 *   - 거부(422): 엔진이 읽지 못하는 문서, 모르는 플래그 값, 빈 산입 목록.
 *   - 허용하되 기록(201 + 감사 로그 + 화면 경고): suspect/bad 를 포함하는 산입 목록.
 *
 * 이 테이블은 조직 전역 설정이다(`mrv_kpi_config` 에 org_id 가 없다). 그래서 GET 응답을
 * org 로 좁히지 않는다 — `/emission-factors` 와 같은 자리다. 다만 로그인은 요구한다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireOwner } from "@/lib/mrv/auth"
import { HttpError, handleRoute, parseInstant } from "@/lib/mrv/http"
import { T, fetchAll, newId } from "@/lib/mrv/db"
import { recordAudit } from "@/lib/mrv/audit"
import {
  EMPTY_QUALITY_FLAG_LIST_REASON,
  QUALITY_FLAGS,
  collectQualityFlagRisks,
  inspectQualityFlagLists,
  qualityFlagRiskText,
  type QualityFlag,
} from "@/lib/mrv/quality-flags"
import {
  alertingConfigFromParams,
  eiConfigFromParams,
  fcrConfigFromParams,
  mortalityConfigFromParams,
  oeiConfigFromParams,
  recommendConfigFromParams,
} from "@/lib/mrv/kpi/config"

const UNIQUE_VIOLATION = "23505"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const auth = await authorizeMrv(req)

    // 활성 설정 판정 규칙을 kpi-service 와 똑같이 둔다 — effective_from 내림차순 첫 행.
    // 여기서 다르게 정렬하면 화면이 "판정에 쓰이는 값" 이라고 거짓말을 한다.
    const rows = await fetchAll<{
      id: string
      version: string
      params_json: Record<string, unknown>
      effective_from: string
    }>((f, t) =>
      auth.db
        .from(T.kpiConfig)
        .select("id, version, params_json, effective_from")
        .order("effective_from", { ascending: false })
        .range(f, t),
    )

    return NextResponse.json({
      items: rows,
      /** 지금 KPI 판정에 쓰이는 버전. 목록 첫 행과 같되, 화면이 다시 고르지 않게 못 박는다. */
      active_version: rows[0]?.version ?? null,
    })
  })
}

/**
 * 엔진이 이 문서를 읽을 수 있는지 미리 확인한다.
 *
 * 6종 파서를 전부 돌리는 이유: 엔진의 `rejectUnknown` 은 오탈자 하나에도
 * `KpiValueError` 를 던지고, 그러면 **그 org 의 `/kpi`·리포트·알림이 통째로 422 가 된다**
 * (lib/mrv/kpi/config.ts 의 EXTENSION_KEYS 주석이 설명하는 그 사고다). 저장 뒤에 그걸
 * 알게 되면 되돌릴 행이 이미 활성 설정이므로, 저장 전에 같은 파서로 확인한다.
 *
 * KpiValueError 는 handleRoute 가 422 로 옮긴다(lib/mrv/http.ts).
 */
function assertEngineCanRead(params: Record<string, unknown>): void {
  eiConfigFromParams(params)
  fcrConfigFromParams(params)
  oeiConfigFromParams(params)
  mortalityConfigFromParams(params)
  alertingConfigFromParams(params)
  recommendConfigFromParams(params)
}

/** 감사 로그에 남길 위험 산입 기록. */
type QualityFlagRisk = { path: string; flags: QualityFlag[]; effect: string }

/**
 * 플래그 산입 목록을 검사한다.
 *
 * 거부/경고의 갈림:
 *   - 모르는 플래그 값 → **거부(422).** 수집 정규화는 ok/suspect/bad 세 값만 만든다
 *     (lib/mrv/ingestion.ts). 그 밖의 값은 어떤 계측값에도 맞지 않으므로, 적힌 의도가
 *     무엇이었든 결과는 "그 지표를 조용히 빈 목록으로 돌리는 것"이다. 오탈자(`"OK"`,
 *     `"okay"`)가 전부 여기로 온다.
 *   - 배열이 아님 → **거부(422).** 엔진의 `strList` 는 배열이 아닌 값에
 *     `.map` 을 불러 TypeError(500)를 낸다.
 *   - 빈 배열 → **거부(422).** 아래 주석 참조.
 *   - suspect/bad 포함 → **허용.** 정당한 이유가 있을 수 있다(계량기 교체 구간을 수기로
 *     보정해 두고 원값 건까지 포함해 재산출하는 등). 대신 감사 로그에 무엇을 포함했고
 *     그것이 어떤 결과를 내는지까지 남기고, 설정 화면이 경고를 띄운다.
 *
 * ★ 빈 배열을 거부하는 판단의 근거는 "조용히 null 이 되는가" 가 아니다.
 *   `lib/mrv/kpi/energy.ts` 에서 null 은 Δbiomass 가 임계 이하일 때만 나오고, 포함 건이
 *   0 건이면 분자는 그냥 `0.0` 이다. 즉 빈 목록은 EI 를 산출 불가로 만들지 않고
 *   **EI 0 kWh/kg · Scope2 0 tCO2e** 로 만든다 — 감축량이 기준선 전량으로 잡히는,
 *   조용한 null 보다 나쁜 결과다. 그래서 경고가 아니라 거부다.
 */
function validateQualityFlags(params: Record<string, unknown>): QualityFlagRisk[] {
  for (const issue of inspectQualityFlagLists(params)) {
    switch (issue.kind) {
      case "not_a_list":
        throw new HttpError(
          422,
          `params_json.${issue.path} must be an array of quality flags ` +
            `(${QUALITY_FLAGS.join(", ")})`,
        )
      case "empty":
        throw new HttpError(
          422,
          `params_json.${issue.path} must not be empty. ${EMPTY_QUALITY_FLAG_LIST_REASON}`,
        )
      case "unknown_flags":
        throw new HttpError(
          422,
          `params_json.${issue.path} has unknown quality flags ` +
            `${JSON.stringify(issue.flags)}; allowed values are ` +
            `${JSON.stringify([...QUALITY_FLAGS])} — 수집 정규화가 만드는 값은 이 셋뿐이고, ` +
            "그 밖의 값은 어떤 계측값에도 맞지 않아 해당 지표가 조용히 0 으로 산출됩니다",
        )
      case "risky_flags":
        // 거부하지 않는다. 기록만 모아 두고 저장을 계속한다.
        break
    }
  }

  // 경고 대상은 화면과 같은 판정을 쓴다(lib/mrv/quality-flags.ts) — 저장이 통과시킨
  // 것과 화면이 경고하는 것이 갈리지 않게 하려고 거르는 함수를 공유한다.
  return collectQualityFlagRisks(params).map((risk) => ({
    path: risk.path,
    flags: risk.flags,
    effect: risk.flags.map((flag) => qualityFlagRiskText(flag)).join(" "),
  }))
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const auth = requireOwner(await authorizeMrv(req))

    const body = (await req.json()) as {
      version?: unknown
      params_json?: unknown
      effective_from?: unknown
      note?: unknown
    }

    if (typeof body.version !== "string" || body.version.trim() === "") {
      throw new HttpError(422, "version is required")
    }
    const version = body.version.trim()
    if (typeof body.effective_from !== "string" || body.effective_from === "") {
      throw new HttpError(422, "effective_from is required")
    }
    const effectiveFrom = parseInstant(body.effective_from, "effective_from")

    // 배열도 null 도 객체가 아니다. 엔진은 최상위를 레코드로 읽으므로 여기서 걸러 낸다.
    if (
      body.params_json === null ||
      typeof body.params_json !== "object" ||
      Array.isArray(body.params_json)
    ) {
      throw new HttpError(422, "params_json must be a JSON object")
    }
    const paramsJson = body.params_json as Record<string, unknown>

    /**
     * ★ 순서가 중요하다 — 플래그 **모양** 검사가 엔진 확인보다 먼저다.
     *
     * 엔진의 `strList` 는 `(v as unknown[]).map(String)` 이라, 목록 자리에 문자열이
     * 적혀 있으면(`"included_quality_flags": "ok"`) `.map` 이 없어 TypeError 를 던진다.
     * 그건 HttpError 도 KpiValueError 도 아니므로 handleRoute 가 **500** 으로 내보낸다 —
     * 고칠 자리를 알려 주지 않는 응답이다. 모양을 먼저 보고 422 로 거부해야 한다.
     * (실제로 엔진을 먼저 돌렸을 때 이 입력이 500 이 났다.)
     *
     * 두 검사 모두 insert 앞에서 끝난다. 순서가 바뀌는 것은 어느 오류를 먼저
     * 보여 주는가일 뿐이고, 어느 쪽도 통과하지 못한 문서는 저장되지 않는다.
     */
    const risks = validateQualityFlags(paramsJson)
    assertEngineCanRead(paramsJson)

    const note =
      typeof body.note === "string" && body.note.trim() !== ""
        ? body.note.trim().slice(0, 500)
        : null

    const row = {
      id: newId("kpicfg"),
      version,
      params_json: paramsJson,
      effective_from: effectiveFrom.toISOString(),
    }
    const { data: stored, error } = await auth.db
      .from(T.kpiConfig)
      .insert(row)
      .select("id, version, params_json, effective_from")
      .single()
    if (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new HttpError(409, `a kpi_config with version '${version}' already exists`)
      }
      throw error
    }

    /**
     * 감사 로그.
     *
     * `quality_flag_risks` 를 **별도 칸으로** 남긴다. `params_json` 전문도 함께 남지만,
     * 감사 로그를 읽는 사람이 60줄짜리 JSON 에서 `"suspect"` 한 단어를 찾아내기를 기대할
     * 수는 없다. 무엇을 포함했는지와 그것이 어떤 결과를 내는지를 **문장으로** 꺼내 둔다 —
     * 이 설정으로 산출된 리포트가 나중에 심사 대상이 되었을 때 읽히는 칸이 여기다.
     *
     * 조직 전역 설정이지만 누가 바꿨는지는 요청자의 org 로 남긴다(배출계수와 같은 자리).
     */
    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "kpi_config",
      entityId: row.id,
      action: "create",
      diff: {
        before: null,
        after: {
          version: row.version,
          effective_from: row.effective_from,
          params_json: paramsJson,
          quality_flag_risks: risks.length > 0 ? risks : null,
        },
      },
      note,
    })

    // 위험 산입이 있으면 응답에도 실어 보낸다 — 저장한 사람의 화면이 "저장됐습니다" 만
    // 띄우고 끝나면, 경고는 다음에 설정 화면을 여는 사람에게만 닿는다.
    return NextResponse.json(
      { ...(stored as Record<string, unknown>), quality_flag_risks: risks },
      { status: 201 },
    )
  })
}
