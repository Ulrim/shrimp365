import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase-client";

/*
 * 미초대 계정 안내 게이트 (FED-3, ADR 0006 4절 / shrimp365-integration.md FED-3).
 *
 * 문제: culiver는 초대 기반(ADR 0005 4절)이므로 shrimp365 계정으로 **인증에 성공해도**
 * 초대가 없으면 GET /auth/me가 403을 반환한다. 그대로 두면 사용자는 "로그인은 됐는데
 * 페이지마다 깨진 화면"을 보게 된다. 이 화면은 그 상태를 사용자 언어로 설명한다 —
 * **인증 성공**과 **권한 부재**를 분리해서 알리는 것이 핵심이다.
 *
 * 이 컴포넌트는 App.tsx의 RequireAuth 한 곳에서만 렌더된다(보호 라우트 전체를 한 번에
 * 커버 — 페이지마다 흩뿌리지 않는다). 앱 셸(NavBar)은 감싸지 않는다: 접근 가능한 메뉴가
 * 하나도 없는 상태에서 네비를 보여주면 오해를 키운다.
 */

export type NotInvitedReasonStatus = 403 | 409;

export interface NotInvitedPageProps {
  /**
   * GET /auth/me 응답 상태.
   * - 403: 이 계정에 대한 초대(=org 소속)가 없음(기본값).
   * - 409: 둘 이상의 조직에 초대되어 자동 연결이 중단됨.
   * 사용자가 취할 행동("관리자 문의")이 동일하므로 화면은 하나이고 본문만 분기한다.
   */
  status?: NotInvitedReasonStatus;
}

const BODY_BY_STATUS: Record<NotInvitedReasonStatus, string> = {
  403:
    "shrimp365 계정으로 정상 인증되었습니다. 다만 컬리버 MRV 플랫폼은 조직 단위 이용 신청(초대)이 " +
    "완료된 계정만 이용할 수 있습니다.",
  409:
    "이 계정이 둘 이상의 조직에 초대되어 있어 자동 연결이 중단되었습니다. 관리자에게 문의해 주세요.",
};

/**
 * 문의 경로(VITE_SUPPORT_CONTACT) 해석. 이메일이면 mailto:, https URL이면 새 탭 링크,
 * 그 외(빈 값·형식 불명)면 null → **링크를 렌더하지 않는다**(깨진 링크 노출 금지 —
 * shrimp365 진입 버튼과 동일 원칙).
 */
function resolveSupportContact(
  raw: string | undefined,
): { href: string; label: string; external: boolean } | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (/^https?:\/\/\S+$/i.test(value)) {
    return { href: value, label: "문의하기", external: true };
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { href: `mailto:${value}`, label: `문의하기 (${value})`, external: false };
  }
  return null;
}

export function NotInvitedPage({ status = 403 }: NotInvitedPageProps) {
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const contact = resolveSupportContact(import.meta.env.VITE_SUPPORT_CONTACT);

  /**
   * 로그아웃(필수). 세션은 localStorage에 남으므로 이 버튼이 없으면 잘못된 계정으로
   * 들어온 사용자가 다른 계정으로 재시도할 방법 없이 이 화면에 갇힌다(ADR 0006 4절).
   */
  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await supabase.auth.signOut();
    } catch {
      // 네트워크 실패 등으로 서버 세션 무효화가 실패해도 사용자를 이 화면에 묶어두지
      // 않는다 — 로그인 화면으로 보내 다른 계정으로 재시도할 길을 항상 열어 둔다.
    } finally {
      setIsSigningOut(false);
      navigate("/login", { replace: true });
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-4 p-10 text-center">
      <h1 className="text-lg font-bold text-fg">이용 신청이 필요합니다</h1>

      <p className="text-sm text-muted">{BODY_BY_STATUS[status]}</p>

      <p className="text-xs text-muted">
        카카오 계정처럼 이메일이 제공되지 않는 경우에도 관리자가 직접 연결할 수 있습니다. 문의 시
        사용 중인 로그인 방식을 함께 알려 주세요.
      </p>

      <div className="flex flex-col items-center gap-2">
        {contact &&
          (contact.external ? (
            <a
              href={contact.href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-bg"
            >
              {contact.label}
            </a>
          ) : (
            <a
              href={contact.href}
              className="rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-bg"
            >
              {contact.label}
            </a>
          ))}

        <button
          type="button"
          onClick={() => void handleSignOut()}
          disabled={isSigningOut}
          className="rounded-md border border-border px-4 py-2 text-sm text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
