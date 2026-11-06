// 노지 재해위험 판단 수신 — OFDF 엣지(라즈베리파이)가 올리는 유일한 창구.
//
//   POST /api/field/device/judgements   판단 레코드를 묶어서 올린다(+ 살아 있음 보고)
//
// 왜 /api/sensors/data 가 아닌가: 그 경로는 수질 12항목 화이트리스트라 기온을 temperature
// 로 넣으면 **수온**으로 저장돼 오탐이 난다(설계서 2장). 환경값은 여기서만 받아
// field_risk_judgements.environment 에 두고, water_quality_readings 는 건드리지 않는다.
//
// 인증은 X-Device-Key(비전 /api/vision/device 와 같은 방식). 기존 6자리 페어링으로 노지
// 베드에 연결한 sensor_devices 의 api_key 다. 서버는 그 키로 tank_id 를 찾고 service_role
// 로 쓴다 — 장비에 DB 비밀번호를 주지 않는다.
//
// 멱등: (device_id, ts, risk, horizon_h) 유니크 → ON CONFLICT DO NOTHING. 장비가 끊겼다
// 붙어 보관분을 다시 보내도 행이 늘지 않고 응답 duplicates 에만 잡힌다.
//
// 알림(1차 범위, 설계서 4-2): 위험별 최신 판단이 level ≥ 2 면 alerts 1건(type danger/warning,
// parameter "field:<risk>", message = 등급명 + 농가 말 ko). 같은 (tank_id, parameter) 미해결
// 알림이 있으면 새로 만들지 않는다. level ≤ 1 로 내려오면 그 알림을 resolved 로 닫는다.
// 수질 라우트(app/api/sensors/data/route.ts)·thresholds.ts 는 건드리지 않는다.
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase-server"
import { sendAlertPush } from "@/lib/push-server"
import { agriOpenfield, FIELD_ALERT_PREFIX } from "@/lib/i18n/agri/openfield"
import { latestPerRisk, parseJudgementsBody, semverOf, type ParsedJudgement } from "@/app/api/field/_lib/judgements"

export const dynamic = "force-dynamic"

/** 이보다 오래된 판단은 저장만 하고 알림은 건드리지 않는다. 회선이 돌아와 큐 7일치가
 *  한꺼번에 올라올 때, 사흘 전 "서리 경계"로 지금 휴대폰이 울리면 그 알림은 거짓말이다.
 *  3시간 = 가장 긴 전망 구간. */
const ALERT_FRESH_MS = 3 * 60 * 60_000

const unauthorized = () => NextResponse.json({ error: "유효하지 않은 기기 키입니다." }, { status: 401 })

type AdminClient = ReturnType<typeof createAdminClient>

/** 테이블이 아직 없다(마이그레이션 전). Postgres 42P01 또는 PostgREST 스키마 캐시 PGRST205. */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === "42P01" || err.code === "PGRST205") return true
  return /field_risk_judgements/.test(err.message ?? "") && /(does not exist|not find|schema cache)/i.test(err.message ?? "")
}

export async function POST(req: NextRequest) {
  const key = req.headers.get("X-Device-Key")?.trim()
  if (!key) return NextResponse.json({ error: "X-Device-Key 헤더가 필요합니다." }, { status: 401 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "서버에 SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다." }, { status: 503 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "요청 본문이 유효한 JSON이 아닙니다." }, { status: 400 })
  }

  // 검증은 인증보다 싸지만 **인증을 먼저** 한다 — 모르는 키에게 우리 검증 규칙을 설명해 줄 이유가 없다.
  const admin = createAdminClient()
  const { data: device } = await admin
    .from("sensor_devices")
    .select("id, tank_id, active")
    .eq("api_key", key)
    .maybeSingle()
  if (!device) return unauthorized()
  if (!device.active) return NextResponse.json({ error: "비활성화된 기기입니다." }, { status: 401 })

  const parsed = parseJudgementsBody(body)
  if (!parsed.ok) {
    // 어느 건이 왜인지 — 업로더 로그에서 바로 찾을 수 있게 index·field 를 같이 준다.
    return NextResponse.json({ error: parsed.error, index: parsed.index, field: parsed.field }, { status: parsed.status })
  }

  const rows = parsed.judgements.map((j) => ({ tank_id: device.tank_id, device_id: device.id, ...j }))
  let accepted = 0
  if (rows.length > 0) {
    const { data, error } = await admin
      .from("field_risk_judgements")
      .upsert(rows, { onConflict: "device_id,ts,risk,horizon_h", ignoreDuplicates: true })
      .select("id")
    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json(
          { error: "field_risk_judgements 테이블이 없습니다. supabase/migrations/field_risk.sql 을 SQL Editor 에서 실행하세요." },
          { status: 503 },
        )
      }
      console.error("[field/judgements] insert error:", error)
      return NextResponse.json({ error: "판단을 저장하지 못했습니다." }, { status: 500 })
    }
    accepted = data?.length ?? 0
  }

  // 알림·살아있음 보고는 비치명 — 실패해도 판단은 이미 저장됐고 장비는 200 을 받아야 재전송하지 않는다.
  try {
    await syncFieldAlerts(admin, device.tank_id, parsed.judgements)
  } catch (e) { console.warn("[field/judgements] alert sync non-fatal:", e instanceof Error ? e.message : e) }
  try {
    await touchDevice(admin, device.id, parsed.agentVersion)
  } catch (e) { console.warn("[field/judgements] touch non-fatal:", e instanceof Error ? e.message : e) }

  return NextResponse.json({ accepted, duplicates: rows.length - accepted })
}

/** 위험별 최신 판단으로 alerts 를 맞춘다. 수질 라우트의 중복 억제·복귀 규칙과 같은 결. */
async function syncFieldAlerts(admin: AdminClient, tankId: string, judgements: ParsedJudgement[]) {
  const ko = agriOpenfield.ko
  const now = Date.now()
  for (const [risk, j] of latestPerRisk(judgements)) {
    if (now - new Date(j.ts).getTime() > ALERT_FRESH_MS) continue
    const parameter = `${FIELD_ALERT_PREFIX}${risk}`

    if (j.level <= 1) {
      await admin.from("alerts").update({ resolved: true })
        .eq("tank_id", tankId).eq("parameter", parameter).eq("resolved", false)
      continue
    }

    const type: "danger" | "warning" = j.level >= 3 ? "danger" : "warning"
    // 등급명은 장비가 보낸 level_name 이 아니라 사전 고정 문구를 쓴다 — 푸시 본문을
    // 장비 쪽에서 바꿀 수 없게. level_name 은 저장만 한다.
    const message = `${ko.level[j.level]} · ${ko.headline[j.risk][j.level]}`
    const { data: open } = await admin
      .from("alerts")
      .select("id, type")
      .eq("tank_id", tankId).eq("parameter", parameter).eq("resolved", false)
      .limit(1)
      .maybeSingle()

    if (open) {
      // 이미 알린 상태 — 새 줄은 만들지 않고 등급·문구만 맞춘다. 경계 → 긴급은 새 사건이라 그때만 밀어 준다.
      await admin.from("alerts").update({ type, value: j.level, message }).eq("id", open.id)
      if (open.type !== "danger" && type === "danger") {
        await sendAlertPush(tankId, { type, message, parameter })
      }
      continue
    }

    await admin.from("alerts").insert({
      tank_id: tankId, type, parameter, value: j.level, threshold: 2, message, resolved: false,
    })
    await sendAlertPush(tankId, { type, message, parameter })
  }
}

/** 살아 있음 보고. agent_version 은 CHECK(N.N.N) 때문에 숫자 부분만 쓰고, 그래도 거부되면
 *  last_seen_at 만 다시 적는다 — 버전 한 칸 때문에 "마지막 응답"이 옛날로 남으면 안 된다. */
async function touchDevice(admin: AdminClient, deviceId: string, agentVersion: string | null) {
  const seen = { last_seen_at: new Date().toISOString() }
  const semver = semverOf(agentVersion)
  if (semver) {
    const { error } = await admin.from("sensor_devices")
      .update({ ...seen, agent_version: semver, agent_version_at: seen.last_seen_at })
      .eq("id", deviceId)
    if (!error) return
    console.warn("[field/judgements] agent_version 갱신 실패 — last_seen_at 만 적습니다:", error.message)
  }
  await admin.from("sensor_devices").update(seen).eq("id", deviceId)
}
