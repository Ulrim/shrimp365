/**
 * 활성 KPI 설정을 고르는 **유일한 자리.**
 *
 * ── 왜 한 곳에 모았는가 ─────────────────────────────────────────────────────
 * 같은 선택 규칙이 네 곳에 각자 적혀 있었다 — `kpi-service.ts`(화면·리포트·기준선),
 * `alert-jobs.ts`(알림 배치), `recommendation-service.ts`(급이 추천),
 * `app/api/mrv/kpi-config/route.ts`(설정 화면이 "지금 쓰이는 값" 이라고 적는 버전).
 * 한 곳만 안 고치면 **화면과 알림이 서로 다른 파라미터로 판정**하고, 그 불일치는 아무
 * 오류도 내지 않는다. 그래서 규칙을 함수 하나로 못 박고 네 곳이 그것만 부른다.
 *
 * ── 선택 규칙 ───────────────────────────────────────────────────────────────
 *   ① 호출자 org 의 행 중 `effective_from <= asOf` 인 가장 늦은 행.
 *   ② 없으면 `org_id is null` (= 플랫폼 기본값) 중 같은 조건의 가장 늦은 행.
 *   ③ 둘 다 없으면 null → 호출자가 엔진 기본값으로 동작한다.
 *
 * **후보 둘을 각각 가져와 코드에서 고른다**(`pickActiveKpiConfig`). PostgREST 정렬 한
 * 줄로 "org 행이 있으면 그것, 없으면 null 행" 을 억지로 표현하면(예: org_id nulls last)
 * 규칙이 질의 문법 속에 숨어 읽히지 않고, 단위로 검사할 수도 없다. 질의 하나가 둘로
 * 늘어나는 비용은 설정 행 하나를 집는 질의라 무시할 수 있다.
 *
 * ★ `org_id is null` 이 「플랫폼 기본값」인 이유는 마이그레이션에 적어 두었다
 *   (supabase/migrations/mrv_kpi_config_org_scope.sql). 기존 행은 어느 한 조직의 것이
 *   아니므로 null 로 남아 있고, 그 값을 조직별 행이 **덮는다.**
 *
 * ── `effective_from <= asOf` 가 새로 생긴 조건이다 ──────────────────────────
 * 전에는 이 조건이 없어서 `effective_from` 에 2030 년을 적은 행이 **지금 당장** 활성이
 * 됐다. 이름이 말하는 것과 반대다. 이 조건이 들어오면서 선택은 시계를 보게 되는데,
 * CLAUDE Rule 6(결정론)과 어긋나지 않는다 — 시계가 들어가는 자리는 **어느 행을
 * 고르는가**(데이터 선택)이고 산식은 그대로이며, 산출 결과에는 고른 행의 `version` 이
 * 함께 실려 나가므로(`kpi_config.version` → 스냅샷·리포트) 어떤 파라미터로 나온
 * 값인지는 나중에도 확정된다. `asOf` 를 인자로 받는 이유도 그것이다 — 알림 배치는
 * 자기 평가 시각(`evaluatedAt`)을 넘겨 한 번의 배치 안에서 같은 설정을 쓴다.
 */

import { DEFAULT_CONFIG_VERSION } from "./kpi"
import type { ParamsJson } from "./kpi"
import { T, type MrvDb } from "./db"

/**
 * 설정 행에서 읽는 열.
 *
 * ⚠ `org_id`/`created_at`/`created_by`/`note` 는
 * `supabase/migrations/mrv_kpi_config_org_scope.sql` 이 더하는 열이다. 그 마이그레이션을
 * 돌리기 전에는 이 질의가 실패하고, 그러면 `/kpi`·리포트·알림·추천이 전부 멈춘다.
 * 마이그레이션 실행이 배포의 선행 조건이다(장비 키 폐기 때와 같은 규약).
 */
export const KPI_CONFIG_COLUMNS =
  "id, org_id, version, params_json, effective_from, created_at, created_by, note"

export type KpiConfigRow = {
  id: string
  /** null = 플랫폼 기본값. */
  org_id: string | null
  version: string
  params_json: ParamsJson | null
  effective_from: string
  /** 등록 시각. 쓰기 창구 이전에 SQL 로 들어간 행은 null 이다(추정으로 메우지 않는다). */
  created_at: string | null
  created_by: string | null
  note: string | null
}

/** 활성 설정이 조직 전용 행인지 플랫폼 기본값인지. 화면이 그대로 적는다. */
export type KpiConfigScope = "org" | "platform_default"

export function kpiConfigScope(row: KpiConfigRow): KpiConfigScope {
  return row.org_id === null ? "platform_default" : "org"
}

/**
 * 선택 규칙 그 자체. 후보 둘을 받아 하나를 고른다.
 *
 * 조직 전용 행이 있으면 **날짜를 비교하지 않고** 그것이 이긴다. 플랫폼 기본값이 더 늦은
 * `effective_from` 을 갖고 있어도 그렇다 — 기본값은 "조직이 자기 값을 갖기 전까지 쓰는
 * 값" 이고, 나중에 기본값을 올렸다고 조직이 정한 파라미터가 뒤집히면 그것이 바로 이번에
 * 막으려는 테넌트 경계 침범이다.
 */
export function pickActiveKpiConfig(
  orgRow: KpiConfigRow | null,
  platformDefaultRow: KpiConfigRow | null,
): KpiConfigRow | null {
  return orgRow ?? platformDefaultRow
}

/**
 * 한 범위(조직 전용 / 플랫폼 기본값)에서 활성 후보 한 행.
 *
 * 정렬이 세 단계인 이유는 **결정론**이다. `effective_from` 하나로는 같은 시각에 두 행이
 * 있을 때 어느 것이 활성인지 Postgres 실행 계획에 달린다(같은 질의가 날마다 다른 답을
 * 낼 수 있다는 뜻이다).
 *   ① effective_from desc — 적용 시작이 늦은 쪽.
 *   ② created_at desc (nulls last) — 같은 시각이면 **나중에 등록한** 쪽. 운영자가 두
 *      번째로 넣은 행이 그 시각에 대한 최종 의사다. 쓰기 창구 이전의 행은 이 칸이
 *      null 이므로 값이 있는 행에 밀린다(그쪽이 더 최근에 등록된 행이다).
 *   ③ version desc — ①②가 모두 같을 때의 마지막 결정자. `version` 은 not null 이고
 *      플랫폼 전역 유일이라 반드시 동률을 깬다.
 */
async function latestCandidate(
  db: MrvDb,
  asOfIso: string,
  scope: KpiConfigScope,
  orgId: string,
): Promise<KpiConfigRow | null> {
  const base = db
    .from(T.kpiConfig)
    .select(KPI_CONFIG_COLUMNS)
    .lte("effective_from", asOfIso)
  const scoped = scope === "org" ? base.eq("org_id", orgId) : base.is("org_id", null)
  const { data, error } = await scoped
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as KpiConfigRow | null) ?? null
}

/** 활성 설정 행. 없으면 null(호출자가 엔진 기본값으로 동작한다). */
export async function loadActiveKpiConfigRow(
  db: MrvDb,
  orgId: string,
  asOf: Date = new Date(),
): Promise<KpiConfigRow | null> {
  const asOfIso = asOf.toISOString()
  const [orgRow, platformDefaultRow] = await Promise.all([
    latestCandidate(db, asOfIso, "org", orgId),
    latestCandidate(db, asOfIso, "platform_default", orgId),
  ])
  return pickActiveKpiConfig(orgRow, platformDefaultRow)
}

/**
 * 활성 설정의 version + params. 행이 없으면 엔진 기본값 + `DEFAULT_CONFIG_VERSION`
 * 으로 동작한다(빈 DB 에서도 산출은 된다).
 */
export async function loadActiveKpiConfig(
  db: MrvDb,
  orgId: string,
  asOf: Date = new Date(),
): Promise<{ version: string; params: ParamsJson; row: KpiConfigRow | null }> {
  const row = await loadActiveKpiConfigRow(db, orgId, asOf)
  if (row === null) return { version: DEFAULT_CONFIG_VERSION, params: {}, row: null }
  return { version: row.version, params: row.params_json ?? {}, row }
}

/**
 * 그 조직의 행 중 `effective_from` 이 가장 늦은 행. **미래 날짜도 포함한다.**
 *
 * 쓰기 경계가 "이 새 행이 활성이 될 수 있는가" 를 판정하는 데 쓴다. 활성 후보(위 함수)와
 * 달리 `asOf` 로 자르지 않는 이유는, SQL 로 들어간 미래 날짜 행이 있을 때 그보다 과거인
 * 새 행을 받아 주면 **언젠가는** 그 미래 행에 가려 영원히 안 쓰이는 행이 되기 때문이다.
 */
export async function latestOrgKpiConfigRow(
  db: MrvDb,
  orgId: string,
): Promise<KpiConfigRow | null> {
  const { data, error } = await db
    .from(T.kpiConfig)
    .select(KPI_CONFIG_COLUMNS)
    .eq("org_id", orgId)
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as KpiConfigRow | null) ?? null
}
