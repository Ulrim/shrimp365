import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase-client";

/*
 * 로그인 페이지 (Phase 3 슬라이스 O, ADR 0005 6절 / phase-3-auth.md 5절).
 * 이메일+비밀번호 → supabase.auth.signInWithPassword. 회원가입/비밀번호 재설정은
 * 이번 슬라이스 범위 밖(초대 기반 흐름 — ADR 0005 4절, 과설계 금지).
 *
 * 보안: Supabase가 반환하는 원문 에러(계정 없음/자격증명 불일치 등)를 그대로 노출하지
 * 않는다 — 계정 존재 여부가 드러나는 사용자 열거(user enumeration) 공격 표면을 줄이기
 * 위해 일반화된 문구로 치환한다(OWASP A07 성격).
 *
 * FED-2(ADR 0006 2절 / shrimp365-integration.md FED-2): shrimp365와 동일한 Supabase
 * 프로젝트를 공유하므로, 소셜(Google/Kakao)로 가입해 **비밀번호가 없는** shrimp365
 * 사용자도 들어올 수 있어야 한다. 그래서 수단을 4개로 확장한다:
 *   이메일+비밀번호(기존) / Google / Kakao / 매직링크(이메일 OTP).
 * - Naver는 제외한다(ADR 0006 2절): Supabase 네이티브 provider가 아니라 service_role
 *   키를 보관할 신규 서버 표면이 필요해진다. Naver 가입자는 이메일을 보유하므로
 *   매직링크가 대체 진입로다.
 * - 콜백 라우트를 신설하지 않는다: Vite SPA의 supabase-js는 detectSessionInUrl
 *   기본값(true)으로 OAuth/매직링크 콜백 해시를 자동 처리한다. 콜백도 /login으로 돌아온다.
 * - 회원가입 링크는 여전히 두지 않는다(초대 기반 유지 — ADR 0006 4절).
 */

/** OAuth·매직링크 콜백 복귀 주소. 라우트 신설 없이 /login으로 되돌아온다(위 주석 참고). */
const OAUTH_REDIRECT_TO = `${window.location.origin}/login`;

/**
 * 매직링크 발송 결과 안내. 성공이든 `shouldCreateUser: false`로 인한 "계정 없음" 실패든
 * **동일 문구**를 쓴다 — 계정 존재 여부를 노출하지 않기 위함(사용자 열거 방지).
 */
const MAGIC_LINK_NOTICE =
  "입력하신 이메일로 로그인 링크를 보냈습니다. 메일함을 확인하세요.";

const OAUTH_ERROR = "소셜 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.";

/** 전송 계층 실패(네트워크 등). 계정 존재 여부와 무관하므로 열거 위험이 없다. */
const NETWORK_ERROR = "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";

type OAuthProvider = "google" | "kakao";

const OAUTH_PROVIDERS: ReadonlyArray<{ provider: OAuthProvider; label: string }> = [
  { provider: "google", label: "Google로 계속하기" },
  { provider: "kakao", label: "Kakao로 계속하기" },
];

export function LoginPage() {
  const navigate = useNavigate();
  const emailId = useId();
  const passwordId = useId();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState<OAuthProvider | "magic-link" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const busy = isSubmitting || pendingAction !== null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);

    if (!email.trim() || !password) {
      setError("이메일과 비밀번호를 모두 입력하세요.");
      return;
    }

    setIsSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setIsSubmitting(false);

    if (signInError) {
      // 계정 존재 여부 노출 방지 — Supabase 원문 메시지를 그대로 보여주지 않는다.
      setError("이메일 또는 비밀번호가 올바르지 않습니다.");
      return;
    }

    navigate("/overview", { replace: true });
  }

  /**
   * 소셜 로그인. 성공하면 브라우저가 Supabase 인증 페이지로 이동하므로 이 함수의
   * 이후 코드는 사실상 실패 경로에서만 실행된다.
   */
  async function signInWithProvider(provider: OAuthProvider) {
    if (busy) return;
    setError(null);
    setNotice(null);
    setPendingAction(provider);

    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: OAUTH_REDIRECT_TO },
      });
      if (oauthError) setError(OAUTH_ERROR);
    } catch {
      // 던져진 예외(네트워크 등)도 반드시 삼켜서 pending 상태를 해제한다 —
      // 그렇지 않으면 버튼이 영구히 비활성화되어 사용자가 로그인 수단을 잃는다.
      setError(OAUTH_ERROR);
    } finally {
      setPendingAction(null);
    }
  }

  /**
   * 매직링크(이메일 OTP). 폼의 email 입력값을 재사용한다(별도 입력 필드 없음 — 과설계 금지).
   */
  async function sendMagicLink() {
    if (busy) return;
    setError(null);
    setNotice(null);

    if (!email.trim()) {
      setError("이메일을 먼저 입력하세요.");
      return;
    }

    setPendingAction("magic-link");
    try {
      await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          // ★★ 절대 변경 금지 (ADR 0006 2절): true(기본값)면 존재하지 않는 이메일로도
          //    Supabase 계정이 신규 생성되어 초대 기반 정책을 우회하는 고아 계정이 생기고,
          //    shrimp365의 handle_new_user 트리거가 profiles 행까지 만든다(운영 서비스 오염).
          shouldCreateUser: false,
          emailRedirectTo: OAUTH_REDIRECT_TO,
        },
      });
      // 응답의 error 필드를 의도적으로 **검사하지 않는다**: 성공이든
      // shouldCreateUser:false로 인한 "계정 없음"이든 같은 문구를 보여줘야
      // 계정 존재 여부가 드러나지 않는다(사용자 열거 방지).
      setNotice(MAGIC_LINK_NOTICE);
    } catch {
      // 전송 계층 실패는 계정 존재 여부와 무관하다(supabase-js는 API 오류를 throw하지
      // 않고 error 필드로 돌려준다) — 열거 위험 없이 재시도 안내를 할 수 있다.
      setError(NETWORK_ERROR);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-lg font-bold text-fg">컬리버 MRV 로그인</h1>
        <p className="mt-1 text-sm text-muted">계정 이메일과 비밀번호를 입력하세요.</p>
        <p className="mt-1 text-sm text-muted">shrimp365 계정으로 로그인할 수 있습니다.</p>
      </div>

      <form
        onSubmit={handleSubmit}
        aria-label="로그인 폼"
        className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5 shadow-sm"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={emailId} className="text-sm font-medium text-fg">
            이메일
          </label>
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            value={email}
            disabled={isSubmitting}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg disabled:opacity-60"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={passwordId} className="text-sm font-medium text-fg">
            비밀번호
          </label>
          <input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={isSubmitting}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg disabled:opacity-60"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-signal-red">
            {error}
          </p>
        )}

        {notice && (
          <p role="status" className="text-sm text-fg">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "로그인 중…" : "로그인"}
        </button>
      </form>

      {/* 구분선: 기존 폼과 대체 수단(소셜/매직링크)을 시각적으로 분리 */}
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted">또는</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="flex flex-col gap-2">
        {OAUTH_PROVIDERS.map(({ provider, label }) => (
          <button
            key={provider}
            type="button"
            disabled={busy}
            onClick={() => void signInWithProvider(provider)}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
          >
            {label}
          </button>
        ))}

        <button
          type="button"
          disabled={busy}
          onClick={() => void sendMagicLink()}
          className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
        >
          이메일로 로그인 링크 받기
        </button>

        <p className="text-xs text-muted">
          비밀번호가 없거나 기억나지 않으면 위 이메일 주소로 로그인 링크를 받아 접속할 수 있습니다.
        </p>
      </div>
    </div>
  );
}
