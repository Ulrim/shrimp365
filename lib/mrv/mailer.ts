/**
 * 리포트 이메일 발송기 — 공급자에 매이지 않는 얇은 경계.
 *
 * ── 왜 이 모양인가 ─────────────────────────────────────────────────────────
 * 사양서 화면 6번이 "이메일 발송" 인데 이 저장소에는 메일 의존성이 하나도 없었다. 어느
 * 업체를 쓸지는 사람이 정할 일이라, 코드는 **공급자를 환경변수로 고르는 경계**만 두고
 * 기본값은 아무것도 보내지 않는 `log` 다.
 *
 *   MRV_MAIL_PROVIDER=log      (기본) 보내지 않고 발송 기록만 남긴다 — status 'skipped'
 *   MRV_MAIL_PROVIDER=resend   Resend HTTPS API. 의존성 없이 fetch 로 보낸다.
 *                              RESEND_API_KEY, MRV_MAIL_FROM 이 필요하다.
 *
 * 기본이 `log` 인 이유: 설정을 깜빡한 배포가 **조용히 메일을 보내는 것**보다 **조용히 안
 * 보내는 것**이 낫다. 그리고 안 보낸 사실은 `mrv_report_deliveries` 에 'skipped' 로 남아
 * 사람이 알아챌 수 있다.
 *
 * ── 보냈다는 사실이 증빙이다 ──────────────────────────────────────────────
 * 이 모듈은 결과를 돌려줄 뿐 기록하지 않는다. 기록(`mrv_report_deliveries`)은 호출부
 * (report-jobs.ts)가 한다 — 발송기를 바꿔도 기록 규약은 그대로여야 한다.
 */

export type MailMessage = {
  to: string
  subject: string
  /** 본문은 평문이다. HTML 본문은 두지 않는다 — 리포트 자체는 링크로 열고, 메일은 알림이다. */
  text: string
}

export type MailResult =
  | { status: "sent"; provider: string; messageId: string | null }
  | { status: "skipped"; provider: string; reason: string }
  | { status: "failed"; provider: string; error: string }

export type MailTransport = {
  readonly name: string
  send(message: MailMessage): Promise<MailResult>
}

/** 기본값. 아무것도 보내지 않고, 왜 안 보냈는지를 결과에 적는다. */
export const logTransport: MailTransport = {
  name: "log",
  async send(message) {
    console.info(`[mrv-mail] (log) to=${message.to} subject=${JSON.stringify(message.subject)}`)
    return {
      status: "skipped",
      provider: "log",
      reason: "MRV_MAIL_PROVIDER 가 설정되지 않아 보내지 않았습니다(log 모드).",
    }
  },
}

/** Resend(https://resend.com) — 의존성 없이 HTTPS 로 보낸다. */
export function resendTransport(env: { apiKey: string; from: string }): MailTransport {
  return {
    name: "resend",
    async send(message) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: env.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
          }),
        })
        if (!res.ok) {
          const body = (await res.text()).slice(0, 300)
          return { status: "failed", provider: "resend", error: `HTTP ${res.status} ${body}` }
        }
        const json = (await res.json().catch(() => ({}))) as { id?: string }
        return { status: "sent", provider: "resend", messageId: json.id ?? null }
      } catch (err) {
        return { status: "failed", provider: "resend", error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}

/**
 * 환경변수로 발송기를 고른다. 모르는 값이나 설정이 모자라면 **log 로 내려가되 그 이유를
 * 콘솔에 남긴다** — 설정 오타로 메일이 조용히 안 나가는 일을 막으려면 적어도 로그에는
 * 있어야 한다.
 */
export function mailTransportFromEnv(env: NodeJS.ProcessEnv = process.env): MailTransport {
  const provider = (env.MRV_MAIL_PROVIDER ?? "log").trim().toLowerCase()
  if (provider === "log" || provider === "") return logTransport
  if (provider === "resend") {
    const apiKey = env.RESEND_API_KEY?.trim()
    const from = env.MRV_MAIL_FROM?.trim()
    if (!apiKey || !from) {
      console.error(
        "[mrv-mail] MRV_MAIL_PROVIDER=resend 인데 RESEND_API_KEY 또는 MRV_MAIL_FROM 이 비어 " +
          "있습니다 — log 모드로 내려갑니다(메일이 나가지 않습니다).",
      )
      return logTransport
    }
    return resendTransport({ apiKey, from })
  }
  console.error(`[mrv-mail] 모르는 MRV_MAIL_PROVIDER=${provider} — log 모드로 내려갑니다.`)
  return logTransport
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 수신자 목록 검사. 빈 목록은 허용한다(= 생성만 하고 보내지 않는다). */
export function checkRecipients(raw: unknown): { ok: true; recipients: string[] } | { ok: false; detail: string } {
  if (raw === undefined || raw === null) return { ok: true, recipients: [] }
  if (!Array.isArray(raw) || raw.some((r) => typeof r !== "string")) {
    return { ok: false, detail: "recipients 는 이메일 주소 배열이어야 합니다." }
  }
  const list = Array.from(new Set((raw as string[]).map((r) => r.trim().toLowerCase()).filter((r) => r !== "")))
  const bad = list.find((r) => !EMAIL_RE.test(r) || r.length > 320)
  if (bad) return { ok: false, detail: `올바른 이메일 주소가 아닙니다: ${bad}` }
  if (list.length > 20) return { ok: false, detail: "수신자는 20명까지 적을 수 있습니다." }
  return { ok: true, recipients: list }
}
