import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase-server"
import { checkThresholds, checkRecipe, hasRecipe, resolvableParameters, parseTrendAlerts, TREND_ALERT_PARAMETERS, MISSING_INPUT_PARAMETER, type TankRecipe, type FarmProfile } from "@/lib/thresholds"
import { sendAlertPush } from "@/lib/push-server"

// In-memory rate limit: max 60 requests per device per minute
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 60
const rateLimitMap = new Map<string, { count: number; windowStart: number }>()

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(key)
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(key, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

/** 기기가 보내는 짧은 식별 문자열만 통과시킨다(로그·화면 오염 방지). */
function readShortString(v: unknown, max = 64): string | null {
  if (typeof v !== "string") return null
  const trimmed = v.trim().slice(0, max)
  return trimmed || null
}

/** 기기가 보낸 원본을 그대로 저장하되, 크기와 형태를 제한한다.
 *  중첩 객체·거대한 배열이 들어와 DB가 커지는 것을 막는다. */
function sanitizePayload(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let count = 0
  for (const [k, v] of Object.entries(body)) {
    if (count >= 32) break
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v
    else if (typeof v === "boolean") out[k] = v
    else if (typeof v === "string") out[k] = v.slice(0, 120)
    else continue
    count++
  }
  return out
}


/** 계정 이메일을 화면에 띄울 만큼만 가린다.
 *  장비 화면은 창고·수조 옆에 놓여 아무나 볼 수 있으므로 전체 주소를 그대로
 *  노출하지 않는다. 본인이 자기 계정임을 알아볼 정도면 충분하다. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@")
  if (!domain) return email
  const head = local.slice(0, 2)
  const tail = local.length > 3 ? local.slice(-1) : ""
  return `${head}${"*".repeat(Math.max(1, local.length - head.length - tail.length))}${tail}@${domain}`
}

// GET /api/sensors/data
// 기기가 "나는 지금 어느 계정·수조에 붙어 있나"를 확인하는 경로.
// 재부팅 후에도 화면에 연결 정보를 띄울 수 있어야 한다.
export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("X-Device-Key")?.trim()
  if (!apiKey) {
    return NextResponse.json({ error: "X-Device-Key 헤더가 필요합니다." }, { status: 401 })
  }
  if (!checkRateLimit(`info:${apiKey}`)) {
    return NextResponse.json({ error: "요청이 너무 많습니다." }, { status: 429 })
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SERVICE_ROLE_KEY_NOT_SET" }, { status: 503 })
  }

  const admin = createAdminClient()
  const { data: device } = await admin
    .from("sensor_devices")
    .select("name, active, tank_id, tanks!sensor_devices_tank_id_fkey(name, farms!tanks_farm_id_fkey(name, user_id))")
    .eq("api_key", apiKey)
    .maybeSingle()

  if (!device) {
    return NextResponse.json({ error: "유효하지 않은 기기 키입니다." }, { status: 401 })
  }

  const tank = (Array.isArray(device.tanks) ? device.tanks[0] : device.tanks) as
    | { name?: string; farms?: { name?: string; user_id?: string } | { name?: string; user_id?: string }[] }
    | undefined
  const farm = (Array.isArray(tank?.farms) ? tank?.farms[0] : tank?.farms) as
    | { name?: string; user_id?: string }
    | undefined

  let account: string | null = null
  if (farm?.user_id) {
    const { data: owner } = await admin.auth.admin.getUserById(farm.user_id)
    if (owner?.user?.email) account = maskEmail(owner.user.email)
  }

  return NextResponse.json({
    device_name: device.name,
    active: device.active,
    tank_name: tank?.name ?? null,
    farm_name: farm?.name ?? null,
    account,
  })
}

// POST /api/sensors/data
// 기기 인증: X-Device-Key 헤더
// RLS 없이 service-role 클라이언트 사용
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-Device-Key")?.trim()
  if (!apiKey) {
    return NextResponse.json({ error: "X-Device-Key 헤더가 필요합니다." }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "요청 본문이 유효한 JSON이 아닙니다." }, { status: 400 })
  }

  let supabaseAdmin
  try {
    supabaseAdmin = createAdminClient()
  } catch {
    return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 })
  }

  // 1. API 키로 기기 조회
  const { data: device, error: deviceError } = await supabaseAdmin
    .from("sensor_devices")
    .select("id, tank_id, active")
    .eq("api_key", apiKey)
    .single()

  if (deviceError || !device) {
    return NextResponse.json({ error: "유효하지 않은 기기 키입니다." }, { status: 401 })
  }
  if (!device.active) {
    return NextResponse.json({ error: "비활성화된 기기입니다." }, { status: 401 })
  }

  // Rate limit per device key
  if (!checkRateLimit(apiKey)) {
    return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }, { status: 429 })
  }

  // 2. 측정값 파싱 + 유효 범위 검증 (DB 오염·오버플로 방지)
  // conductivity — EC 센서를 전도도 모드로 쓰는 농장(양액·민물)이 있어 함께 저장한다.
  // flow_rate·diff_pressure — 수경재배(농업 모드) 순환 유량과 UV 살균기·필터 차압.
  const FIELDS = ["temperature", "ph", "do_level", "salinity", "ammonia", "nitrite", "nitrate", "alkalinity", "turbidity", "conductivity", "flow_rate", "diff_pressure"] as const
  type FieldKey = typeof FIELDS[number]

  const VALID_RANGE: Record<FieldKey, [number, number]> = {
    temperature: [-5,   60],
    ph:          [ 0,   14],
    do_level:    [ 0,   30],
    salinity:    [ 0,   50],   // ppt — 바닷물이 약 35
    ammonia:     [ 0,  100],
    nitrite:     [ 0,  100],
    nitrate:     [ 0,  500],
    alkalinity:  [ 0, 1000],
    turbidity:   [ 0, 1000],
    conductivity:[ 0, 200000],  // uS/cm — 바닷물이 약 50,000
    flow_rate:    [ 0, 1000],   // L/min
    diff_pressure:[ 0, 1000],   // kPa
  }

  const values: Partial<Record<FieldKey, number>> = {}
  for (const field of FIELDS) {
    const raw = body[field]
    if (raw !== undefined && raw !== null) {
      const n = Number(raw)
      const [min, max] = VALID_RANGE[field]
      if (!Number.isNaN(n) && Number.isFinite(n) && n >= min && n <= max) {
        values[field] = n
      }
    }
  }

  if (Object.keys(values).length === 0) {
    return NextResponse.json({ error: "측정값이 하나도 없습니다." }, { status: 422 })
  }

  // recorded_at: ISO8601 형식만 허용, 미래 시각 차단
  let recordedAt = new Date().toISOString()
  if (typeof body.recorded_at === "string") {
    const parsed = new Date(body.recorded_at)
    if (!isNaN(parsed.getTime()) && parsed.getTime() <= Date.now()) {
      recordedAt = parsed.toISOString()
    }
  }

  // 3. water_quality_readings 삽입
  //    device_id 로 "어느 센서가 잰 값인지" 를 남긴다. 마이그레이션 전이라
  //    컬럼이 없으면 그 컬럼만 빼고 다시 저장한다(측정은 절대 멈추면 안 된다).
  // 마이그레이션이 아직 안 된 DB 를 만나도 측정이 멈춰서는 안 된다.
  // 아직 없는 칸(device_id·conductivity·flow_rate·diff_pressure)은 하나씩 빼고
  // 다시 시도한다.
  //
  // **에러가 이름을 콕 집은 칸만 뗀다.** 예전에는 미정의 컬럼 코드
  // (42703/PGRST204)만 보이면 목록을 앞에서부터 훑어 아무 칸이나 뗐다. 그러면
  // 없는 칸이 diff_pressure 하나여도 device_id·conductivity·flow_rate 가 먼저
  // 걸려 멀쩡한 측정값 셋이 조용히 사라진다. 코드는 "칸이 없어서 난 오류인가"를
  // 확인하는 데만 쓰고, 뗄 대상은 메시지가 지목한 이름으로 고른다.
  // ('column' 문구만 보고 판단하면 tank_id NOT NULL 같은 엉뚱한 오류까지 삼킨다.)
  const OPTIONAL_COLS = ["device_id", "conductivity", "flow_rate", "diff_pressure"] as const
  let row: Record<string, unknown> = {
    tank_id: device.tank_id, ...values, recorded_at: recordedAt, device_id: device.id,
  }
  let reading: Record<string, unknown> | null = null
  let insertError: { message?: string; code?: string } | null = null

  for (let attempt = 0; ; attempt++) {
    const res = await supabaseAdmin
      .from("water_quality_readings").insert(row).select().single()
    reading = res.data
    insertError = res.error
    if (!insertError) break

    const msg = insertError.message || ""
    // 칸이 없어서 난 오류인가 — 코드 또는 문구로 확인한다.
    const isMissingColumnError =
      insertError.code === "42703" || insertError.code === "PGRST204" ||
      /(column|schema cache|does not exist|not found)/i.test(msg)
    // 메시지가 이름을 집은 칸만 후보다. 앞뒤가 단어 문자면 다른 칸 이름의
    // 부분 문자열을 잘못 집을 수 있으므로 경계를 함께 본다.
    const named = OPTIONAL_COLS.find(col =>
      col in row && new RegExp(`(^|[^A-Za-z0-9_])${col}([^A-Za-z0-9_]|$)`, "i").test(msg))
    const missing = isMissingColumnError ? named : undefined
    if (!missing || attempt >= OPTIONAL_COLS.length) break

    console.warn(`[sensors/data] ${missing} 칸 없음 — 빼고 저장(마이그레이션 필요)`)
    const { [missing]: _drop, ...rest } = row
    row = rest
  }

  if (insertError) {
    console.error("[sensors/data] insert error:", insertError)
    return NextResponse.json({ error: "데이터 저장에 실패했습니다." }, { status: 500 })
  }

  // 4. 임계값 체크 → 알림 생성 + 수조 상태 갱신
  //
  // 베드(수조)에 양액 레시피가 있으면 레시피 기반 체크(checkRecipe)를 함께 돌려
  // 결과를 합친다. 레시피 조회는 별도 쿼리 + 실패 무시 — 마이그레이션 전 DB
  // (컬럼 없음)에서도 기존 새우 장비 수신이 절대 멈추면 안 된다.
  //
  // 같은 조회에 농장 유형(farms.farm_type)을 조인해 판정 프로필도 함께 받는다.
  // **서버에는 URL이 없다** — 화면의 /daumlabs 분기가 여기까지 오지 않으므로
  // 판정 축은 데이터, 즉 farms.farm_type 이다(설계서 3-5·7장 3번 축).
  // 조인이라 쿼리 수는 늘지 않는다. 실패하면 profile 은 "shrimp" 로 남는다.
  let recipe: TankRecipe | null = null
  let profile: FarmProfile = "shrimp"
  try {
    const { data: tankRow, error: tankErr } = await supabaseAdmin
      .from("tanks")
      .select("target_ec, ec_tolerance, target_ph, ph_tolerance, farms!inner(farm_type)")
      .eq("id", device.tank_id)
      .maybeSingle()
    // 실패하면 조용히 새우 프로필로 떨어져 EC 알림이 흔적 없이 사라진다.
    // 수신은 계속하되(비치명) 왜 사라졌는지는 남긴다.
    if (tankErr) console.warn("[sensors/data] 베드 레시피·농장유형 조회 실패 — shrimp 프로필로 진행:", tankErr.message)
    if (tankRow) {
      recipe = tankRow as TankRecipe
      // Supabase 조인 결과는 관계 카디널리티에 따라 객체 또는 배열로 온다.
      const joined = (tankRow as { farms?: unknown }).farms
      const farmRow = Array.isArray(joined) ? joined[0] : joined
      if ((farmRow as { farm_type?: string } | undefined)?.farm_type === "agriculture") {
        profile = "agriculture"
      }
      // **레시피는 농업 농장에서만 적용한다.**
      //
      // target_ec/target_ph 는 tanks 에 남는 값이라 농장을 agriculture 로 썼다가
      // shrimp 로 되돌리면 그대로 남는다(새우 농장 폼에는 레시피 칸이 없어 지울
      // 방법도 없다). 그 상태로 레시피를 적용하면 새우 농가에서 두 가지가 한꺼번에
      // 깨진다 — 염도 알림이 영구히 사라지고(아래 hasRecipe 분기), 양식지 pH
      // 7.8~8.5 가 남은 목표 6.0±0.5 에 걸려 매 수신마다 danger 알림이 뜬다.
      //
      // 판정 축은 farms.farm_type 하나다(설계서 3-5). 새우 농장이면 새우 규칙만
      // 쓴다 — 레시피 칸에 뭐가 남아 있든 상관없다.
      if (profile !== "agriculture") recipe = null
    }
  } catch { /* 컬럼 없음 등 — 레시피 없이 기존 흐름 그대로 */ }

  // 레시피가 설정된 베드에서는 전역 체크 중 두 항목을 건너뛴다.
  //  - 염도: 새우 해수 기준이라 농업에서 오탐(설계서 4-4. 농업 장비는
  //    ec_mode=conductivity 라 실제로는 거의 안 보내지만 방어적으로 막는다).
  //  - pH(목표 pH 가 있을 때만): 레시피 체크와 전역 체크가 같은 parameter("pH")
  //    행을 두고 서로 다른 기준으로 다투면 알림이 매 수신마다 뒤집힌다.
  const globalValues: Partial<Record<FieldKey, number>> = { ...values }
  if (hasRecipe(recipe)) delete globalValues.salinity
  if (recipe?.target_ph != null) delete globalValues.ph

  // 장비가 찾아 보낸 추세 이상징후. 임계값을 깨기 전 단계라 **같은 목록에 섞어**
  // 중복 억제·복귀·푸시를 그대로 태운다 — 알림 수명 관리를 두 벌 만들지 않는다.
  //
  // 두 가지를 걸러 둔다.
  //  · **밀린 값에는 반응하지 않는다.** 회선이 돌아오면 buffer 가 며칠치를 한꺼번에
  //    올리는데, 그 안의 추세 판정은 지금 상황이 아니다. 사흘 전 급락으로 새벽에
  //    휴대폰이 울리면 그 알림은 거짓말이다.
  //  · **농업 베드는 뺀다.** 장비의 추세 기준(수온 2.0 ℃, pH 0.4)은 새우 해수
  //    기준이라, 근권 냉방으로 일부러 흔드는 양액에 대면 정상 운전이 경고가 된다.
  const FRESH_MS = 15 * 60_000
  const fresh = Date.now() - new Date(recordedAt).getTime() <= FRESH_MS
  const trendAlerts = (fresh && profile !== "agriculture")
    ? parseTrendAlerts(body.ai_anomaly)
    : []

  // 수조 색(초록·주황·빨강)을 정하는 것은 **지금 값의 판정**뿐이다. 추세 경고까지
  // 섞으면 기준 안에서 멀쩡히 도는 수조가 "위험" 으로 보여 진짜 이탈과 구분되지
  // 않는다. 그래서 둘을 나눠 두고, 알림 수명(중복 억제·복귀·푸시)만 함께 태운다.
  const statusAlerts = [
    ...checkThresholds(globalValues as Parameters<typeof checkThresholds>[0], profile),
    ...checkRecipe(values, recipe),
  ]
  const thresholdAlerts = [...statusAlerts, ...trendAlerts]

  // 같은 항목이 계속 범위 밖이면 알림을 새로 만들지 않는다.
  //
  // 1분마다 측정하므로, 밤새 산소가 낮으면 알림이 480건 쌓인다. 그러면 정작
  // 봐야 할 다른 알림이 묻히고, 농가는 알림 자체를 무시하게 된다. 아직 해결되지
  // 않은 같은 알림이 있으면 그 값만 갱신하고 새 줄은 만들지 않는다.
  for (const alert of thresholdAlerts) {
    try {
      const { data: open } = await supabaseAdmin
        .from("alerts")
        .select("id, type")
        .eq("tank_id", device.tank_id)
        .eq("parameter", alert.parameter)
        .eq("resolved", false)
        .limit(1)
        .maybeSingle()

      if (open) {
        // 이미 알린 상태다. 최신 값과 심각도만 반영한다.
        await supabaseAdmin
          .from("alerts")
          .update({ type: alert.type, value: alert.value, message: alert.message })
          .eq("id", open.id)

        // 주의 → 위험으로 올라간 것은 새 사건이다. 같은 줄을 갱신만 하면
        // 화면에는 색이 바뀌지만 아무도 그 사실을 모른다. 등급이 오를 때만
        // 밀어 준다 — 그대로면 1분마다 같은 푸시가 쌓여 소음이 된다.
        if (open.type !== "danger" && alert.type === "danger") {
          await sendAlertPush(device.tank_id, { type: alert.type, message: alert.message, parameter: alert.parameter })
        }
      } else {
        await supabaseAdmin.from("alerts").insert({
          tank_id: device.tank_id,
          type: alert.type,
          parameter: alert.parameter,
          value: alert.value,
          threshold: alert.threshold,
          message: alert.message,
          resolved: false,
        })

        // 새로 생긴 알림 — 앱이 닫혀 있어도 닿아야 한다.
        // 실패해도 sendAlertPush 가 전부 삼키므로 수집은 멈추지 않는다.
        await sendAlertPush(device.tank_id, { type: alert.type, message: alert.message, parameter: alert.parameter })
      }
    } catch (e) { console.warn("[sensors/data] non-fatal:", e instanceof Error ? e.message : e) }
  }

  // 범위 안으로 돌아온 항목은 알림을 닫는다. 안 닫으면 위 중복 방지 때문에
  // 다음에 정말 문제가 생겨도 옛 알림만 갱신되고 새로 알리지 않는다.
  //
  // 비교 대상은 **알림 키**(alerts.parameter)여야 한다. 측정값 객체의 키는
  // "temperature" 인데 저장되는 알림 키는 "수온" 이라, 값 키를 그대로 넘기면
  // `.in("parameter", …)` 가 어떤 행과도 안 맞아 복귀가 조용히 실패한다.
  // resolvableParameters 가 그 변환과 "판정한 항목만" 필터를 함께 맡는다.
  //
  // 0 은 이 저장소 규약상 "미측정"이라 checkThresholds 가 판정에서 건너뛴다.
  // 판정을 안 한 값은 복귀도 아니다 — 비대칭이면 전극이 물 밖으로 나와 DO 0.0 을
  // 계속 보낼 때 열려 있던 저산소 위험 알림이 조용히 닫힌다. 기기는 살아 있으니
  // 오프라인 표시도 안 뜨고 알림함만 초록색이 된다. resolvableParameters 가
  // 그 "판정한 항목만" 규칙을 checkThresholds 와 같은 파일에서 함께 지킨다.
  //
  // 판정 대상은 values 가 아니라 globalValues 다. 레시피가 있는 베드에서는 위에서
  // salinity·ph 를 뺐고, 그 두 항목의 복귀는 아래 target_ec/target_ph 분기가 따로
  // 잡는다. values 를 쓰면 판정하지도 않은 항목까지 복귀시킨다.
  const stillBad = new Set(thresholdAlerts.map(a => a.parameter))
  const recovered = resolvableParameters(
    globalValues as Parameters<typeof resolvableParameters>[0], profile,
  ).filter(p => !stillBad.has(p))
  // 값이 들어왔다는 사실 자체가 입력 누락의 해소다.
  recovered.push(MISSING_INPUT_PARAMETER)
  // 추세 알림의 복귀 — 이번에 보고되지 않은 항목은 더 이상 이상징후가 아니다.
  // 장비가 매 측정마다 **전체 목록**을 보내므로 빠진 것이 곧 해소다.
  // 밀린 값(fresh 아님)으로는 닫지 않는다 — 사흘 전 payload 에 없다는 이유로
  // 지금 열려 있는 경고를 닫으면, 정작 지금 벌어지는 일을 지워 버린다.
  if (fresh && profile !== "agriculture") {
    const stillTrending = new Set(trendAlerts.map(a => a.parameter))
    recovered.push(...TREND_ALERT_PARAMETERS.filter(p => !stillTrending.has(p)))
  }
  // 레시피 알림은 parameter 가 값 키와 달라("EC"/"pH") 별도 매핑으로 복귀를 잡는다.
  // 0 은 전극이 물 밖일 때 나오는 값이라 checkRecipe 가 판정에서 제외한다 —
  // 판정을 안 했으면 복귀도 아니다(비대칭이면 이탈 알림이 0 수신에 닫혀 버린다).
  if (recipe?.target_ec != null && values.conductivity !== undefined && values.conductivity !== 0 && !stillBad.has("EC")) {
    recovered.push("EC")
  }
  if (recipe?.target_ph != null && values.ph !== undefined && values.ph !== 0 && !stillBad.has("pH")) {
    recovered.push("pH")
  }
  if (recovered.length > 0) {
    try {
      await supabaseAdmin
        .from("alerts")
        .update({ resolved: true })
        .eq("tank_id", device.tank_id)
        .eq("resolved", false)
        .in("parameter", recovered)
    } catch (e) { console.warn("[sensors/data] non-fatal:", e instanceof Error ? e.message : e) }
  }

  const newStatus = statusAlerts.some(a => a.type === "danger") ? "danger"
    : statusAlerts.some(a => a.type === "warning") ? "warning"
    : "active"

  try {
    await supabaseAdmin
      .from("tanks")
      .update({ status: newStatus })
      .eq("id", device.tank_id)
  } catch (e) { console.warn("[sensors/data] non-fatal:", e instanceof Error ? e.message : e) }

  // 5. 기기 상태 갱신 — 마지막 수신 시각과 자기소개(시리얼·버전), 원본 측정값.
  //    원본을 통째로 남겨 두면 수질 기록에 저장하지 않는 값(전도도·TDS 등)도
  //    화면에서 확인할 수 있어 현장에서 기기 상태를 파악하기 쉽다.
  try {
    const deviceUpdate: Record<string, unknown> = {
      last_seen_at: new Date().toISOString(),
      last_payload: sanitizePayload(body),
    }
    const serial = readShortString(body.serial)
    const firmware = readShortString(body.firmware)
    if (serial) deviceUpdate.serial = serial
    if (firmware) deviceUpdate.firmware = firmware

    await supabaseAdmin.from("sensor_devices").update(deviceUpdate).eq("id", device.id)
  } catch (e) { console.warn("[sensors/data] non-fatal:", e instanceof Error ? e.message : e) }

  return NextResponse.json({
    success: true,
    reading_id: reading?.id,
    tank_id: device.tank_id,
    alerts_triggered: thresholdAlerts.length,
    trend_alerts: trendAlerts.length,
  })
}
