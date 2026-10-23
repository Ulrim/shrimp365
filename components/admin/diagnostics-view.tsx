"use client"

// 시스템 진단 — /api/admin/diag(센서 기록)·/api/admin/ai-diag(AI 연결)를 버튼으로
// 실행하고 결과를 읽기 좋게 보여 준다(설계서 admin-console.md 3장). 전에는 화면이
// 없어 주소를 직접 열어야 했다. API 는 손대지 않고 응답만 읽는다.
//
// API 가 이미 키를 가리지만 화면에서도 한 번 더 가린다(6장): 필드 이름에 key·token·
// secret(·키)이 든 값은 앞 4글자 + "…" 만 남긴다. 복사 버튼도 가린 결과를 복사한다.
// 단 API 가 이미 줄인 꼴("설정됨 (sk-a…, 51자)"·"미설정")은 그대로 둔다 — 다시 가리면
// "설정…" 만 남아 설정 여부조차 읽을 수 없다.
import { useState } from "react"
import { Activity, BrainCircuit, Play, Loader2, Copy, Check } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/utils"

// ─── 가리기 ───────────────────────────────────────────────────────────────────

const SENSITIVE_KEY = /key|token|secret|키/i

/** API(ai-diag 의 hint())가 이미 가린 값 — 앞 4글자 이하 + "…" 와 길이만 담는다. */
const ALREADY_MASKED = /^(설정됨 \([^()]{0,4}…, \d+자\)|미설정)$/

function maskValue(v: unknown): unknown {
  if (typeof v === "string") {
    if (ALREADY_MASKED.test(v)) return v
    return v.length > 4 ? `${v.slice(0, 4)}…` : v
  }
  if (typeof v === "number" || typeof v === "bigint") return maskValue(String(v))
  if (Array.isArray(v)) return v.map(maskValue)
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskValue(x)]))
  }
  return v
}

/** 이름에 민감한 단어가 든 필드는 그 아래 값을 모두 가린다. */
export function maskSecrets(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(maskSecrets)
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, SENSITIVE_KEY.test(k) ? maskValue(x) : maskSecrets(x)]),
    )
  }
  return v
}

// ─── 요약 ─────────────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v)
const text = (v: unknown): string =>
  v == null ? "—" : typeof v === "string" ? v : typeof v === "boolean" ? (v ? "예" : "아니오") : JSON.stringify(v)

type Line = { label: string; value: string }

const ERROR_LABELS: Record<string, string> = {
  SERVICE_ROLE_KEY_NOT_SET: "서버에 SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다",
}

function errorLines(body: Rec): Line[] | null {
  if (typeof body.error !== "string") return null
  return [{ label: "오류", value: ERROR_LABELS[body.error] ?? body.error }]
}

/** 센서 기록 진단(/api/admin/diag) 핵심 줄. */
function summarizeSensor(body: Rec): Line[] {
  const lines: Line[] = []
  if ("supabase_프로젝트" in body) lines.push({ label: "Supabase 프로젝트", value: text(body["supabase_프로젝트"]) })
  if ("검사1_device_id_직접조회" in body) lines.push({ label: "device_id 직접 조회", value: text(body["검사1_device_id_직접조회"]) })
  if ("검사2_전체조회에_device_id_포함" in body) lines.push({ label: "전체 조회에 device_id 포함", value: text(body["검사2_전체조회에_device_id_포함"]) })
  const hour = body["검사3_최근1시간"]
  if (isRec(hour)) lines.push({ label: "최근 1시간 기록", value: `전체 ${text(hour["전체"])} · 센서 표시 ${text(hour["센서표시있음"])}` })
  const latest = body["기기별_최신값"]
  if (Array.isArray(latest)) {
    if (latest.length === 0) lines.push({ label: "활성 기기", value: "없음" })
    for (const d of latest) {
      if (isRec(d)) lines.push({ label: text(d["기기"]), value: text(d["판정"]) })
    }
  }
  return lines
}

/** AI 연결 진단(/api/admin/ai-diag) 핵심 줄. */
function summarizeAi(body: Rec): Line[] {
  const lines: Line[] = []
  const probes = body["실제호출검사"]
  if (Array.isArray(probes)) {
    if (probes.length === 0) lines.push({ label: "실제 호출", value: "설정된 백엔드 없음" })
    for (const p of probes) {
      if (!isRec(p)) continue
      const took = p["걸린시간"] ? ` (${text(p["걸린시간"])})` : ""
      lines.push({ label: `${text(p["이름"])} · ${text(p["모델"])}`, value: `${text(p["결과"])}${took}` })
    }
  }
  const advice = body["진단"]
  if (Array.isArray(advice)) {
    for (const a of advice) lines.push({ label: "진단", value: text(a) })
  }
  return lines
}

// ─── 실행 패널 ────────────────────────────────────────────────────────────────

type Result = {
  status: number
  at: string
  ms: number
  body: unknown
  lines: Line[]
}

function DiagPanel({ title, description, endpoint, buttonLabel, icon, summarize }: {
  title: string
  description: string
  endpoint: string
  buttonLabel: string
  icon: React.ReactNode
  summarize: (body: Rec) => Line[]
}) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [copied, setCopied] = useState(false)

  async function run() {
    setRunning(true)
    setCopied(false)
    const started = Date.now()
    try {
      const res = await fetch(endpoint, { cache: "no-store" })
      const raw = await res.text()
      let body: unknown
      try { body = JSON.parse(raw) } catch { body = raw.slice(0, 2000) }
      const masked = maskSecrets(body)
      const lines = isRec(masked)
        ? (errorLines(masked) ?? summarize(masked))
        : [{ label: "응답", value: "JSON 이 아닌 응답입니다(아래 원문 참고)" }]
      setResult({ status: res.status, at: new Date().toISOString(), ms: Date.now() - started, body: masked, lines })
    } catch (e) {
      setResult({
        status: 0, at: new Date().toISOString(), ms: Date.now() - started, body: null,
        lines: [{ label: "오류", value: e instanceof Error ? e.message : "요청하지 못했습니다" }],
      })
    } finally {
      setRunning(false)
    }
  }

  const json = result ? JSON.stringify(result.body, null, 2) : ""

  async function copy() {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const ok = result && result.status >= 200 && result.status < 300

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-foreground flex items-center gap-2">
          {icon} {title}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          onClick={run}
          disabled={running}
          className="bg-foreground text-background hover:bg-foreground/90 gap-2 min-h-[44px]"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Play className="w-4 h-4" aria-hidden="true" />}
          {running ? "실행 중…" : buttonLabel}
        </Button>

        {result && (
          <div className="space-y-3" aria-live="polite">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className={`${result.status ? "font-mono" : ""} font-semibold px-2 py-0.5 rounded-full border ${
                ok ? "border-emerald-500/40 text-emerald-600 bg-emerald-500/10" : "border-red-500/40 text-red-600 bg-red-500/10"
              }`}>
                {result.status ? `HTTP ${result.status}` : "요청 실패"}
              </span>
              <span className="text-muted-foreground">{formatDateTime(result.at)} · {result.ms}ms</span>
            </div>

            {result.lines.length > 0 && (
              <dl className="divide-y divide-border rounded-lg border border-border">
                {result.lines.map((l, i) => (
                  <div key={i} className="flex flex-col sm:flex-row sm:gap-4 px-3 py-2 text-sm">
                    <dt className="text-muted-foreground sm:w-56 shrink-0 break-words">{l.label}</dt>
                    <dd className="text-foreground break-words min-w-0">{l.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {result.body != null && (
              <details className="rounded-lg border border-border">
                <summary className="cursor-pointer select-none px-3 py-2 min-h-[44px] flex items-center text-sm text-muted-foreground hover:text-foreground">
                  전체 결과(JSON)
                </summary>
                <div className="border-t border-border">
                  <div className="flex justify-end px-3 pt-2">
                    <button
                      onClick={copy}
                      className="inline-flex items-center gap-1.5 text-sm px-3 min-h-[44px] rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {copied ? <Check className="w-3 h-3" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
                      {copied ? "복사됨" : "복사"}
                    </button>
                  </div>
                  <pre className="m-0 p-3 text-xs font-mono text-foreground/90 whitespace-pre-wrap break-words overflow-x-auto max-h-[480px] overflow-y-auto">
                    {json}
                  </pre>
                </div>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── View ─────────────────────────────────────────────────────────────────────

export function DiagnosticsView() {
  return (
    <div className="space-y-5">
      {/* 셸 머리(h1 "시스템 진단")와 같은 이름이라 데스크톱에서는 제목만 숨긴다. */}
      <div>
        <h2 className="text-xl font-bold text-foreground lg:sr-only">시스템 진단</h2>
        <p className="text-sm text-muted-foreground mt-0.5 lg:mt-0">
          사이트가 실제로 쓰는 경로로 검사합니다. 결과를 전달할 때는 &quot;복사&quot;를 눌러 그대로 붙여 넣으세요.
        </p>
      </div>
      <DiagPanel
        title="센서 기록 진단"
        description="기록에 센서(device_id)가 붙는지, 기기별 최신 측정값이 정상 범위인지 확인합니다."
        endpoint="/api/admin/diag"
        buttonLabel="센서 기록 진단 실행"
        icon={<Activity className="w-4 h-4 text-muted-foreground" />}
        summarize={summarizeSensor}
      />
      <DiagPanel
        title="AI 연결 진단"
        description="설정된 AI 백엔드를 실제로 한 번 호출해 응답과 오류를 확인합니다. 최대 30초 걸릴 수 있습니다."
        endpoint="/api/admin/ai-diag"
        buttonLabel="AI 연결 진단 실행"
        icon={<BrainCircuit className="w-4 h-4 text-muted-foreground" />}
        summarize={summarizeAi}
      />
    </div>
  )
}
