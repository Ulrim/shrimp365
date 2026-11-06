/**
 * KPI 산식 설정 — 조회(GET)와 새 version 등록(POST).
 *
 * 원본에는 이 창구가 없다(원본 엔드포인트 41개에 kpi_config 조회/수정이 없었다).
 * 설정 화면(MASTER 4장 화면 #15)이 「KPI 산식 파라미터」를 보여 주려면 지금 어떤 값이
 * 판정에 쓰이는지 읽을 길이 필요해서 GET 을 더했다.
 *
 * ── 왜 POST 가 생겼는가 ─────────────────────────────────────────────────────
 * 전에는 **쓰기 창구를 일부러 두지 않았다.** KPI 는 요청 시점의 활성 설정으로 계산되므로,
 * 파라미터를 바꾸면 이미 지나간 기간의 신호등 판정까지 소급해서 달라진다. 그 결정은
 * 과제 책임자의 승인 절차에 속한다.
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
 *   - **호출자의 org_id 를 박아 넣는다.** 다른 org 의 설정을 만들 길은 없다.
 *   - append-only. 기존 행을 고치지 않고 새 version 행을 추가한다. 과거 스냅샷이 어떤
 *     파라미터로 산출됐는지(`mrv_kpi_snapshots.config_version`) 추적 가능해야 한다.
 *   - 거부(422): 모르는 최상위 블록 이름, 목록 자리의 모양 오류, 모르는 플래그 값,
 *     모르는 지표명, 빈 산입 목록, 엔진이 읽지 못하는 문서, 쓰일 수 없는 effective_from.
 *   - 허용하되 기록(201 + 감사 로그 + 화면 경고): suspect/bad 를 포함하는 산입 목록.
 *
 * ── org 범위 (2026-10-19) ───────────────────────────────────────────────────
 * 이 표에는 `org_id` 가 없었고 활성 설정 선택에도 org 조건이 없었다. 그래서 **A사 owner
 * 가 새 version 을 넣으면 그 행이 플랫폼 전체 org 의 활성 설정이 됐다** — B사의 EI·
 * Scope2·신호등·알림 임계값·급이 추천이 A사 운영자의 입력으로 소급해 바뀌고 B사 감사
 * 로그에는 아무것도 남지 않는, CLAUDE Hard Rule 4(멀티테넌시 누수 금지) 위반이다.
 *
 *   · 열 추가: supabase/migrations/mrv_kpi_config_org_scope.sql (`org_id` nullable,
 *     null = 「플랫폼 기본값」. 기존 행은 null 로 남는다 — 어느 한 조직의 것이 아니다.)
 *   · 선택 규칙: lib/mrv/kpi-config-source.ts (org 행 우선 · 없으면 null 행). GET 의
 *     `active_version` 도 그 함수를 쓴다 — 화면이 "지금 쓰이는 값" 이라고 적는 자리이므로
 *     판정이 둘로 갈리면 화면이 거짓말을 한다.
 *   · 목록도 org 로 좁힌다. 남의 조직 파라미터를 보여 줄 이유가 없다.
 *   · **플랫폼 기본값(null) 행을 만드는 창구는 두지 않는다.** 그 행을 쓰는 것은 모든
 *     조직의 판정을 바꾸는 일이라 API 요청이 아니라 마이그레이션의 일이다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireOwner } from "@/lib/mrv/auth"
import { HttpError, handleRoute, parseInstant } from "@/lib/mrv/http"
import { T, fetchAll, newId } from "@/lib/mrv/db"
import { recordAudit } from "@/lib/mrv/audit"
import {
  KPI_CONFIG_COLUMNS,
  type KpiConfigRow,
  kpiConfigScope,
  latestOrgKpiConfigRow,
  loadActiveKpiConfigRow,
} from "@/lib/mrv/kpi-config-source"
import {
  assertEffectiveFrom,
  validateKpiParamsJson,
} from "@/lib/mrv/kpi-config-validate"

const UNIQUE_VIOLATION = "23505"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const auth = await authorizeMrv(req)

    /**
     * 목록은 「내 조직의 행 + 플랫폼 기본값(null) 행」이다. 남의 조직 파라미터는 빼고,
     * 기본값은 보여 준다 — 조직 전용 행이 없을 때 실제로 쓰이는 값이 그것이다.
     *
     * 두 질의로 나눈 이유: PostgREST 의 `.or()` 는 필터를 **문자열로** 조립하므로
     * org_id 를 그 문자열에 끼워 넣어야 하고, 그 값에 쉼표나 괄호가 섞이는 날 필터가
     * 다른 뜻이 된다. 범위가 둘뿐이라 질의를 나누는 편이 안전하고 규칙도 그대로 읽힌다.
     */
    const [orgRows, defaultRows] = await Promise.all([
      fetchAll<KpiConfigRow>((f, t) =>
        auth.db
          .from(T.kpiConfig)
          .select(KPI_CONFIG_COLUMNS)
          .eq("org_id", auth.orgId)
          .order("effective_from", { ascending: false })
          .order("version", { ascending: false })
          .range(f, t),
      ),
      fetchAll<KpiConfigRow>((f, t) =>
        auth.db
          .from(T.kpiConfig)
          .select(KPI_CONFIG_COLUMNS)
          .is("org_id", null)
          .order("effective_from", { ascending: false })
          .order("version", { ascending: false })
          .range(f, t),
      ),
    ])

    // 합친 뒤의 정렬도 결정론적이어야 한다(화면이 "이전 version" 목록을 그대로 그린다).
    const rows = [...orgRows, ...defaultRows].sort((a, b) => {
      if (a.effective_from !== b.effective_from) {
        return a.effective_from < b.effective_from ? 1 : -1
      }
      if (a.version !== b.version) return a.version < b.version ? 1 : -1
      return 0
    })

    // 활성 행은 목록에서 다시 고르지 않는다 — 산출 경로와 **같은 함수**로 고른다.
    const active = await loadActiveKpiConfigRow(auth.db, auth.orgId)

    return NextResponse.json({
      items: rows,
      /** 지금 KPI 판정에 쓰이는 버전. */
      active_version: active?.version ?? null,
      /**
       * 그 버전이 이 조직 전용 설정인가, 플랫폼 기본값인가.
       * 화면이 "기본값을 쓰고 있다" 를 글자로 적을 수 있어야 한다 — 조직 전용 행이 있는
       * 줄 알았는데 기본값이었던 경우와 그 반대를 숫자만 보고는 구분할 수 없다.
       */
      active_scope: active === null ? null : kpiConfigScope(active),
    })
  })
}

/**
 * ★ `params_json` 검증과 `effective_from` 검증은 `lib/mrv/kpi-config-validate.ts` 에 있다.
 *
 * 라우트 안에 두지 않은 이유는 **검사 순서가 규약**이기 때문이다 — 순서가 어긋나면 응답이
 * 422 가 아니라 500 이 되고, 그 사고가 이미 두 번 났다. 라우트는 `next/server`·인증·DB 를
 * 끌고 들어와 단독으로 돌릴 수 없어 순서를 검사할 길이 없었다. 순수 함수로 꺼낸 지금은
 * `scripts/mrv/verify-kpi-config-write.mjs` 가 순서까지 고정한다.
 */

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const auth = requireOwner(await authorizeMrv(req))
    const now = new Date()

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

    // 검사 순서(모양 → 값 → 지표명 → 엔진)는 validateKpiParamsJson 안에 있다.
    // 통과하지 못한 문서는 저장되지 않는다.
    const risks = validateKpiParamsJson(paramsJson)

    /**
     * 이 행이 활성이 될 수 있는 시각인지 본다(판정은 kpi-config-validate.ts).
     *
     * 읽고 나서 넣는 사이에 다른 요청이 같은 effective_from 으로 들어오는 경합은 남는다.
     * 그 경우를 제약으로 막지 않는 이유는 **결과가 비결정적이지 않기** 때문이다 —
     * 동률은 선택 규칙의 2·3차 정렬 키(created_at, version)가 깬다
     * (lib/mrv/kpi-config-source.ts). 여기서 거부하는 것은 운영자가 **예측할 수 없는
     * 결과**를 만들지 않기 위한 것이고, 경합으로 생긴 동률도 그 정렬 키로 설명된다.
     */
    const latestOrgRow = await latestOrgKpiConfigRow(auth.db, auth.orgId)
    assertEffectiveFrom(effectiveFrom, now, latestOrgRow)

    const note =
      typeof body.note === "string" && body.note.trim() !== ""
        ? body.note.trim().slice(0, 500)
        : null

    /**
     * `created_at`/`created_by`/`note` 를 **행에도** 적는다.
     *
     * `effective_from` 은 사람이 임의로 적는 「적용 시작 시각」이라 "언제 등록됐는가" 를
     * 답하지 못한다. 그 기록이 감사 로그 하나뿐이면 감사 로그 조회가 ENTERPRISE 전용인
     * 이상 START/PRO 조직은 자기 조직의 산식 파라미터가 언제·누구에 의해 바뀌었는지
     * 되짚을 길이 없다. `mrv_api_key_revocation.sql` 이 `revoked_by` 에 대해 적어 둔
     * 것과 같은 기준이다 — 행 자체가 들고 있어야 한다.
     */
    const row = {
      id: newId("kpicfg"),
      org_id: auth.orgId,
      version,
      params_json: paramsJson,
      effective_from: effectiveFrom.toISOString(),
      created_at: now.toISOString(),
      created_by: auth.userId,
      note,
    }
    const { data: stored, error } = await auth.db
      .from(T.kpiConfig)
      .insert(row)
      .select(KPI_CONFIG_COLUMNS)
      .single()
    if (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        // 어느 org 가 그 문자열을 썼는지는 말하지 않는다 — version 은 플랫폼 전역
        // 유일이고(마이그레이션 주석 참조) 존재 사실만 알리면 충분하다.
        throw new HttpError(
          409,
          `version '${version}' 은 이미 쓰이고 있습니다. version 문자열은 플랫폼 전역 ` +
            "유일입니다 — 리포트·스냅샷에 적히는 `config_version` 이 org 수식어 없는 맨 " +
            "문자열이라, 같은 문자열이 둘을 뜻하면 그 리포트가 어떤 파라미터로 산출됐는지 " +
            "확정할 수 없습니다. 조직을 구분하는 문자열(예: 2026.2.0-ourfarm)을 쓰십시오.",
        )
      }
      throw error
    }
    const storedRow = stored as KpiConfigRow

    /**
     * **이 행이 실제로 활성이 됐는지 확인한다.** 추측하지 않는다.
     *
     * 지금까지는 저장만 하고 201 을 돌려주었고, 그 응답은 "무엇이 바뀌었는가" 를 말하지
     * 않았다. 활성 판정이 선택 규칙(org 행 우선 · effective_from <= now)에 달려 있으므로,
     * 같은 함수를 한 번 더 돌려 결과를 응답에 싣는다 — 시계 오차 허용 폭 안에서 등록된
     * 행이 몇 초 뒤부터 활성인 경우가 유일하게 `active: false` 로 나오는 자리다.
     */
    const activeNow = await loadActiveKpiConfigRow(auth.db, auth.orgId)
    const active = activeNow?.id === storedRow.id

    /**
     * 감사 로그.
     *
     * `quality_flag_risks` 를 **별도 칸으로** 남긴다. `params_json` 전문도 함께 남지만,
     * 감사 로그를 읽는 사람이 60줄짜리 JSON 에서 `"suspect"` 한 단어를 찾아내기를 기대할
     * 수는 없다. 무엇을 포함했는지와 그것이 어떤 결과를 내는지를 **문장으로** 꺼내 둔다 —
     * 이 설정으로 산출된 리포트가 나중에 심사 대상이 되었을 때 읽히는 칸이 여기다.
     *
     * ── 기록 실패 시 무엇이 참인가 ──────────────────────────────────────────
     * 설정 행은 **이미 커밋됐다.** 그래서 감사 로그 실패를 그대로 던지면 응답은 500 이
     * 되고 화면은 "저장 실패" 를 띄우는데, 다시 누르면 같은 version 이라 409 가 난다 —
     * 운영자는 저장이 안 됐다고 믿고, 실제로는 됐다. 그 거짓말을 하지 않는다.
     *
     * 참인 것: **새 설정 행은 저장됐고 활성 여부는 응답의 `active` 가 말한다.** 감사
     * 로그 한 줄은 없을 수 있다. 그래서 (1) 서버 로그에 남기고 (2) 응답에
     * `audit_recorded: false` 를 실어 **화면이 "기록이 남지 않았다" 를 말할 수 있게**
     * 한다. 기록이 증빙의 일부인 시스템에서 그 사실을 숨기는 것이 가장 나쁜 선택이다.
     * 행 자체가 `created_at`/`created_by`/`note` 를 들고 있으므로 "누가 언제 무엇을"
     * 은 감사 로그 없이도 남는다 — 그것이 그 세 열을 행에 둔 또 하나의 이유다.
     */
    let auditRecorded = true
    try {
      await recordAudit(auth.db, {
        orgId: auth.orgId,
        actorId: auth.userId,
        entity: "kpi_config",
        entityId: row.id,
        action: "create",
        diff: {
          before: null,
          after: {
            org_id: auth.orgId,
            version: row.version,
            effective_from: row.effective_from,
            params_json: paramsJson,
            quality_flag_risks: risks.length > 0 ? risks : null,
            active,
          },
        },
        note,
      })
    } catch (err) {
      auditRecorded = false
      console.error("[mrv] kpi_config saved but audit log failed", row.id, err)
    }

    // 위험 산입이 있으면 응답에도 실어 보낸다 — 저장한 사람의 화면이 "저장됐습니다" 만
    // 띄우고 끝나면, 경고는 다음에 설정 화면을 여는 사람에게만 닿는다.
    return NextResponse.json(
      {
        ...(storedRow as unknown as Record<string, unknown>),
        quality_flag_risks: risks,
        active,
        active_version: activeNow?.version ?? null,
        audit_recorded: auditRecorded,
      },
      { status: 201 },
    )
  })
}
