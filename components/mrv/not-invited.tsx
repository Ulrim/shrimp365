"use client"

/**
 * 미초대 계정 안내 게이트.
 * 원본: mrv-platform/apps/web/src/features/auth/NotInvitedPage.tsx
 *
 * MRV 플랫폼은 초대 기반이라, shrimp365 계정으로 **인증에 성공해도** 초대가 없으면
 * /auth/me 가 403 을 낸다. 그대로 두면 사용자는 "로그인은 됐는데 페이지마다 깨진 화면"을
 * 본다. 이 화면은 그 상태를 사용자 언어로 설명한다 — **인증 성공**과 **권한 부재**를
 * 분리해 알리는 것이 핵심이다.
 *
 * 셸(내비)을 감싸지 않는다: 들어갈 수 있는 메뉴가 없는데 메뉴를 보여 주면 오해만 키운다.
 */

import Link from "next/link"
import { useMemo } from "react"

export type NotInvitedReasonStatus = 403 | 409

const BODY_BY_STATUS: Record<NotInvitedReasonStatus, string> = {
  403:
    "shrimp365 계정으로 정상 인증되었습니다. 다만 컬리버 MRV 플랫폼은 조직 단위 이용 신청(초대)이 " +
    "완료된 계정만 이용할 수 있습니다.",
  409: "이 계정이 둘 이상의 조직에 초대되어 있어 자동 연결이 중단되었습니다. 관리자에게 문의해 주세요.",
}

/**
 * 문의 경로 해석. 이메일이면 mailto:, https URL 이면 새 탭 링크, 그 외(빈 값·형식 불명)면
 * null 이라 **링크를 렌더하지 않는다** — 깨진 링크를 실서비스에 노출하지 않기 위함이다.
 */
function resolveSupportContact(
  raw: string | undefined,
): { href: string; label: string; external: boolean } | null {
  const value = (raw ?? "").trim()
  if (!value) return null
  if (/^https?:\/\/\S+$/i.test(value)) {
    return { href: value, label: "문의하기", external: true }
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { href: `mailto:${value}`, label: `문의하기 (${value})`, external: false }
  }
  return null
}

export function NotInvited({ status = 403 }: { status?: NotInvitedReasonStatus }) {
  // NEXT_PUBLIC_* 은 빌드타임 정적 치환이라 반드시 리터럴로 직접 참조해야 한다.
  const contact = useMemo(
    () => resolveSupportContact(process.env.NEXT_PUBLIC_MRV_SUPPORT_CONTACT),
    [],
  )

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-10 text-center">
      <h1 className="text-lg font-bold text-mrv-fg">이용 신청이 필요합니다</h1>

      <p className="text-sm text-mrv-muted">{BODY_BY_STATUS[status]}</p>

      <p className="text-xs text-mrv-muted">
        카카오 계정처럼 이메일이 제공되지 않는 경우에도 관리자가 직접 연결할 수 있습니다. 문의 시
        사용 중인 로그인 방식을 함께 알려 주세요.
      </p>

      <div className="flex flex-col items-center gap-2">
        {contact && (
          <a
            href={contact.href}
            {...(contact.external
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
            className="rounded-md border border-mrv-primary px-4 py-2 text-sm font-medium text-mrv-primary hover:bg-mrv-bg"
          >
            {contact.label}
          </a>
        )}

        {/* 로그아웃 경로가 없으면 잘못된 계정으로 들어온 사용자가 다른 계정으로
            재시도할 방법 없이 이 화면에 갇힌다. shrimp365 의 로그인 화면으로 보낸다. */}
        <Link
          href="/login"
          className="rounded-md border border-mrv-border px-4 py-2 text-sm text-mrv-fg hover:bg-mrv-bg"
        >
          다른 계정으로 로그인
        </Link>
      </div>
    </div>
  )
}
