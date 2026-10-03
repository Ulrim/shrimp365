/**
 * MRV API 라우트의 공통 오류 표현.
 *
 * 원본은 FastAPI 의 HTTPException(status_code, detail) 로 오류를 던지면 프레임워크가
 * `{"detail": "..."}` 로 직렬화했다. 화면의 api-client 가 그 `detail` 을 읽어 사용자에게
 * 보여 주므로, 이식본도 **같은 형태의 본문**을 낸다. 상태 코드와 문구도 원본 그대로 옮긴다
 * — 코드/문구가 달라지면 화면의 분기(예: 403 → 미초대 안내)가 조용히 어긋난다.
 */

import { NextResponse } from "next/server"

export class HttpError extends Error {
  readonly status: number
  constructor(status: number, detail: string) {
    super(detail)
    this.name = "HttpError"
    this.status = status
  }
}

/** FastAPI 와 같은 `{ detail }` 본문으로 응답한다. */
export function errorResponse(status: number, detail: string): NextResponse {
  return NextResponse.json({ detail }, { status })
}

/**
 * 라우트 핸들러를 감싸 HttpError 를 응답으로 바꾼다.
 *
 * 산식 엔진이 던지는 KpiValueError 는 "입력이 물리적으로 불가능하다"는 뜻이므로 422 로
 * 옮긴다(원본에서 pydantic/엔진 ValueError 가 422 로 나가던 것과 같은 자리). 그 밖의
 * 예외는 500 이며, 원인 문자열을 그대로 흘리지 않는다 — 내부 구조(테이블명·쿼리)가
 * 응답에 새어 나가지 않게 하기 위함이다.
 */
export async function handleRoute(
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err.status, err.message)
    if (err instanceof Error && err.name === "KpiValueError") {
      return errorResponse(422, err.message)
    }
    console.error("[mrv] unhandled route error", err)
    return errorResponse(500, "internal server error")
  }
}

/** 필수 쿼리 파라미터를 읽는다. 없으면 422(원본 pydantic 의 필수 검증과 같은 자리). */
export function requiredParam(url: URL, name: string): string {
  const value = url.searchParams.get(name)
  if (!value) throw new HttpError(422, `missing required query parameter: ${name}`)
  return value
}

/** ISO8601 시각 파싱. 형식이 틀리면 422. */
export function parseInstant(raw: string, label: string): Date {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) {
    throw new HttpError(422, `${label} is not a valid ISO8601 datetime: ${raw}`)
  }
  return d
}

/** 기간 [from, to) 파싱 + 역전 방어(엔진이 던지기 전에 422 로 잡는다). */
export function parsePeriod(url: URL, fromKey = "from", toKey = "to"): {
  from: Date
  to: Date
} {
  const from = parseInstant(requiredParam(url, fromKey), fromKey)
  const to = parseInstant(requiredParam(url, toKey), toKey)
  if (from.getTime() >= to.getTime()) {
    throw new HttpError(422, `${fromKey} must be strictly before ${toKey}`)
  }
  return { from, to }
}
