/**
 * 전력 배출계수 목록/등록.
 * 원본: apps/api/app/routers/emission_factors.py
 *
 * 배출계수를 코드에 박지 않는 이유가 이 테이블이다 — 출처·연도·버전을 함께 저장해
 * 리포트에 명시하고 제3자가 검증할 수 있게 한다.
 *
 * append-only: 수정/삭제 경로를 두지 않는다. 과거 리포트가 참조한 값이 사후에 바뀌면
 * 증빙 무결성이 깨지므로, 값이 갱신되면 새 version 행을 추가한다.
 * 등록은 owner 전용이다(조직 전역 설정이라 operator 까지 열지 않는다).
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireOwner } from "@/lib/mrv/auth"
import { HttpError, handleRoute, parseInstant } from "@/lib/mrv/http"
import { T, fetchAll, newId } from "@/lib/mrv/db"
import { recordAudit } from "@/lib/mrv/audit"

const UNIQUE_VIOLATION = "23505"

/**
 * 응답에 싣는 열. `created_at` 이 들어 있는 것은 장식이 아니다 — 배출계수를 **언제
 * 등록했는지**가 증빙의 일부다(계수가 바뀐 시점과 리포트 생성 시점의 선후를 제3자가
 * 확인한다). 예전에는 이 열을 빼고 보내면서 타입(`EmissionFactor`)에는 필수로 적어 두어,
 * 화면이 `created_at` 을 읽으면 타입은 string 인데 런타임은 undefined 였다.
 */
const EMISSION_FACTOR_COLUMNS =
  "id, factor_tco2e_per_mwh, source, year, version, effective_from, created_at, deprecated_at, " +
  "gas_scope, basis_from_year, basis_to_year, document_name, issuing_body, published_on, " +
  "source_url, method"

/** 온실가스 범위. 같은 승인분이 CO2e 판과 CO2 판으로 둘 다 공표되므로 섞이면 안 된다. */
const GAS_SCOPES = new Set(["CO2e", "CO2"])
/** GHG Protocol Scope 2 산정 방식. */
const METHODS = new Set(["location_based", "market_based"])

/** 비어 있지 않은 문자열만 통과시킨다. 공백만 적힌 출처는 적지 않은 것과 같다. */
function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") throw new HttpError(422, `${field} must be a string`)
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

function optionalYear(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isInteger(value)) throw new HttpError(422, `${field} must be an integer year`)
  return value as number
}

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const auth = await authorizeMrv(req)
    const rows = await fetchAll((f, t) =>
      auth.db
        .from(T.emissionFactors)
        .select(EMISSION_FACTOR_COLUMNS)
        .order("effective_from", { ascending: false })
        .range(f, t),
    )
    return NextResponse.json({ items: rows })
  })
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const auth = requireOwner(await authorizeMrv(req))

    const body = (await req.json()) as {
      factor_tco2e_per_mwh?: number
      source?: string
      year?: number
      version?: string
      effective_from?: string
      gas_scope?: unknown
      basis_from_year?: unknown
      basis_to_year?: unknown
      document_name?: unknown
      issuing_body?: unknown
      published_on?: unknown
      source_url?: unknown
      method?: unknown
    }
    // 배출계수는 0 이하일 수 없다. 0 을 받아들이면 감축량이 언제나 0 으로 나온다.
    if (typeof body.factor_tco2e_per_mwh !== "number" || !(body.factor_tco2e_per_mwh > 0)) {
      throw new HttpError(422, "factor_tco2e_per_mwh must be greater than 0")
    }
    if (!body.source) throw new HttpError(422, "source is required")
    if (!Number.isInteger(body.year)) throw new HttpError(422, "year must be an integer")
    if (!body.version) throw new HttpError(422, "version is required")
    if (!body.effective_from) throw new HttpError(422, "effective_from is required")
    const effectiveFrom = parseInstant(body.effective_from, "effective_from")
    // year 와 effective_from 은 다른 것이다. year 는 계수가 **설명하는 데이터 연도**,
    // effective_from 은 이 플랫폼이 **새 리포트에 쓰기 시작하는 시점**이다. 계수는 해당
    // 연도가 끝난 뒤 집계·심의를 거쳐 공표되므로, 데이터 연도가 적용 시점보다 뒤일 수
    // 없다. 이 검사가 없어서 `0.4594` 가 2024년 값으로 등록되는 사고가 났다.
    if ((body.year as number) > effectiveFrom.getUTCFullYear()) {
      throw new HttpError(
        422,
        `year (${body.year}) must not be later than the year of effective_from ` +
          `(${effectiveFrom.getUTCFullYear()}) — year is the data year the factor describes, ` +
          "effective_from is when this platform starts applying it",
      )
    }

    // ── 출처 칸 ───────────────────────────────────────────────────────────
    // 전부 선택이다. 비워 둘 수 있게 한 것은 **추측으로 채우는 것보다 비는 쪽이 낫기
    // 때문**이다 — 검증기관은 빈 칸을 "아직 못 댄 근거" 로 읽지만, 틀린 문서명은
    // 산정 전체의 신뢰를 깬다. 대신 적었으면 형식은 엄격히 본다.
    const gasScope = body.gas_scope === undefined ? "CO2e" : body.gas_scope
    if (typeof gasScope !== "string" || !GAS_SCOPES.has(gasScope)) {
      throw new HttpError(422, "gas_scope must be one of CO2e, CO2")
    }
    const method = body.method === undefined ? "location_based" : body.method
    if (typeof method !== "string" || !METHODS.has(method)) {
      throw new HttpError(422, "method must be one of location_based, market_based")
    }

    const basisFrom = optionalYear(body.basis_from_year, "basis_from_year")
    const basisTo = optionalYear(body.basis_to_year, "basis_to_year")
    // 한쪽만 적힌 기준 기간은 단년도인지 평균인지 알 수 없어 적지 않은 것과 같다.
    if ((basisFrom === null) !== (basisTo === null)) {
      throw new HttpError(
        422,
        "basis_from_year and basis_to_year must be given together (single-year factors " +
          "set both to the same year; multi-year averages set a range)",
      )
    }
    if (basisFrom !== null && basisTo !== null && basisFrom > basisTo) {
      throw new HttpError(422, `basis_from_year (${basisFrom}) must not exceed basis_to_year (${basisTo})`)
    }
    // 기준 기간은 적용 시점보다 뒤일 수 없다 — 계수는 그 기간이 끝난 뒤 집계·공표된다.
    if (basisTo !== null && basisTo > effectiveFrom.getUTCFullYear()) {
      throw new HttpError(
        422,
        `basis_to_year (${basisTo}) must not be later than the year of effective_from ` +
          `(${effectiveFrom.getUTCFullYear()})`,
      )
    }

    let publishedOn: string | null = null
    if (body.published_on !== undefined && body.published_on !== null) {
      if (typeof body.published_on !== "string") {
        throw new HttpError(422, "published_on must be a YYYY-MM-DD string")
      }
      // date 열이므로 날짜만 받는다. 시각까지 받으면 DB 가 조용히 잘라 버려
      // 보낸 값과 저장된 값이 달라진다.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.published_on)) {
        throw new HttpError(422, `published_on must be YYYY-MM-DD, got '${body.published_on}'`)
      }
      publishedOn = body.published_on
    }

    const sourceUrl = optionalText(body.source_url, "source_url")
    // 출처 URL 은 리포트에 인쇄되어 검증자가 따라가는 주소다. 스킴을 보지 않으면
    // `javascript:` 같은 것이 인쇄물에 실린다.
    if (sourceUrl !== null && !/^https?:\/\//.test(sourceUrl)) {
      throw new HttpError(422, "source_url must start with http:// or https://")
    }

    const row = {
      id: newId("ef"),
      factor_tco2e_per_mwh: body.factor_tco2e_per_mwh,
      source: body.source,
      year: body.year as number,
      version: body.version,
      effective_from: effectiveFrom.toISOString(),
      gas_scope: gasScope,
      basis_from_year: basisFrom,
      basis_to_year: basisTo,
      document_name: optionalText(body.document_name, "document_name"),
      issuing_body: optionalText(body.issuing_body, "issuing_body"),
      published_on: publishedOn,
      source_url: sourceUrl,
      method,
    }
    // 저장된 행을 그대로 돌려받는다 — created_at 은 DB 기본값이 채우므로, 보내 준 값을
    // 되돌려 주면 응답에 그 열이 빠진다(위 주석의 그 불일치가 여기서 생겼다).
    const { data: stored, error } = await auth.db
      .from(T.emissionFactors)
      .insert(row)
      .select(EMISSION_FACTOR_COLUMNS)
      .single()
    if (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new HttpError(409, "an emission factor with this version already exists")
      }
      throw error
    }

    // 배출계수 자체는 조직 전역 설정이지만, 누가 등록했는지는 요청자의 org 로 남긴다.
    await recordAudit(auth.db, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entity: "emission_factors",
      entityId: row.id,
      action: "create",
      diff: { before: null, after: row },
    })

    return NextResponse.json(stored, { status: 201 })
  })
}
