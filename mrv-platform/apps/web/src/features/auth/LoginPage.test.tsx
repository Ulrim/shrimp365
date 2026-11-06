import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/*
 * LoginPage: 렌더/제출 흐름, 실패 시 일반화된 에러 메시지(계정 존재 여부 비노출),
 * 로딩 상태 처리, 성공 시 /overview 리다이렉트를 검증한다.
 * supabase-client는 mock(실제 네트워크 호출 없음).
 *
 * FED-2(ADR 0006 2절): Google/Kakao 소셜 로그인 + 매직링크 케이스를 추가한다.
 * ★ `shouldCreateUser: false` 단언은 삭제 금지 대상이다(설계서 FED-2 수용 기준) —
 *   기본값(true)이면 초대 정책을 우회하는 고아 Supabase 계정이 생기고 shrimp365의
 *   handle_new_user 트리거가 운영 데이터(profiles)를 오염시킨다.
 */

const signInWithPassword = vi.fn();
const signInWithOAuth = vi.fn();
const signInWithOtp = vi.fn();
const navigate = vi.fn();

vi.mock("@/lib/supabase-client", () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
      signInWithOAuth: (...args: unknown[]) => signInWithOAuth(...args),
      signInWithOtp: (...args: unknown[]) => signInWithOtp(...args),
    },
  },
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

import { LoginPage } from "./LoginPage";

function renderPage() {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    signInWithPassword.mockReset();
    signInWithOAuth.mockReset();
    signInWithOtp.mockReset();
    navigate.mockReset();
  });

  it("이메일·비밀번호 입력 필드와 로그인 버튼을 렌더한다", () => {
    renderPage();
    expect(screen.getByLabelText("이메일")).toBeInTheDocument();
    expect(screen.getByLabelText("비밀번호")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그인" })).toBeInTheDocument();
  });

  it("빈 입력으로 제출하면 signInWithPassword를 호출하지 않고 안내를 표시한다", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(screen.getByText("이메일과 비밀번호를 모두 입력하세요.")).toBeInTheDocument();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("로그인 성공 시 /overview로 이동한다", async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: null });
    renderPage();

    fireEvent.change(screen.getByLabelText("이메일"), {
      target: { value: "owner@culiver.example" },
    });
    fireEvent.change(screen.getByLabelText("비밀번호"), {
      target: { value: "correct-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/overview", { replace: true }));
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "owner@culiver.example",
      password: "correct-password",
    });
  });

  it("로그인 실패 시 Supabase 원문 에러 대신 일반화된 메시지를 표시한다", async () => {
    signInWithPassword.mockResolvedValue({
      data: {},
      error: { message: "User not found" },
    });
    renderPage();

    fireEvent.change(screen.getByLabelText("이메일"), {
      target: { value: "nobody@culiver.example" },
    });
    fireEvent.change(screen.getByLabelText("비밀번호"), {
      target: { value: "whatever" },
    });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("이메일 또는 비밀번호가 올바르지 않습니다.");
    // 계정 존재 여부를 드러내는 원문 Supabase 메시지는 노출하지 않는다.
    expect(screen.queryByText(/User not found/)).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("LoginPage — 소셜 로그인 / 매직링크 (FED-2)", () => {
  const REDIRECT_TO = `${window.location.origin}/login`;
  const MAGIC_LINK_NOTICE = "입력하신 이메일로 로그인 링크를 보냈습니다. 메일함을 확인하세요.";

  beforeEach(() => {
    signInWithPassword.mockReset();
    signInWithOAuth.mockReset();
    signInWithOtp.mockReset();
    navigate.mockReset();
  });

  it("shrimp365 계정 안내 문구를 노출한다", () => {
    renderPage();
    expect(screen.getByText("shrimp365 계정으로 로그인할 수 있습니다.")).toBeInTheDocument();
  });

  it("회원가입 링크는 두지 않는다(초대 기반 유지 — ADR 0006 4절)", () => {
    renderPage();
    expect(screen.queryByText(/회원가입/)).not.toBeInTheDocument();
  });

  it("Naver 소셜 버튼은 렌더하지 않는다(ADR 0006 2절에서 기각)", () => {
    renderPage();
    expect(screen.queryByText(/Naver|네이버/)).not.toBeInTheDocument();
  });

  it.each([
    ["google", "Google로 계속하기"],
    ["kakao", "Kakao로 계속하기"],
  ] as const)("%s 버튼 클릭 시 signInWithOAuth를 정확히 1회 호출한다", async (provider, label) => {
    signInWithOAuth.mockResolvedValue({ data: {}, error: null });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: label }));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider,
      options: { redirectTo: REDIRECT_TO },
    });
  });

  it("소셜 로그인 시작 실패 시 일반화된 안내를 alert로 표시한다", async () => {
    signInWithOAuth.mockResolvedValue({ data: {}, error: { message: "provider disabled" } });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Google로 계속하기" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("소셜 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    // Supabase 원문 메시지는 노출하지 않는다.
    expect(screen.queryByText(/provider disabled/)).not.toBeInTheDocument();
  });

  it("★매직링크 호출은 shouldCreateUser: false를 포함한다 (삭제 금지 단언, ADR 0006 2절)", async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: null });
    renderPage();

    fireEvent.change(screen.getByLabelText("이메일"), {
      target: { value: "kakao-user@culiver.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "이메일로 로그인 링크 받기" }));

    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledTimes(1));
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "kakao-user@culiver.example",
      options: { shouldCreateUser: false, emailRedirectTo: REDIRECT_TO },
    });
    const options = signInWithOtp.mock.calls[0][0].options;
    expect(options.shouldCreateUser).toBe(false);
  });

  it("매직링크 성공/실패 응답 모두 동일 문구를 렌더한다(사용자 열거 방지)", async () => {
    // 성공 응답
    signInWithOtp.mockResolvedValue({ data: {}, error: null });
    const { unmount } = render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("이메일"), {
      target: { value: "exists@culiver.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "이메일로 로그인 링크 받기" }));
    expect(await screen.findByText(MAGIC_LINK_NOTICE)).toBeInTheDocument();
    unmount();

    // 실패 응답(shouldCreateUser:false로 인한 "계정 없음" 포함)
    signInWithOtp.mockResolvedValue({
      data: {},
      error: { message: "Signups not allowed for otp" },
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("이메일"), {
      target: { value: "nobody@culiver.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "이메일로 로그인 링크 받기" }));
    expect(await screen.findByText(MAGIC_LINK_NOTICE)).toBeInTheDocument();
    expect(screen.queryByText(/Signups not allowed/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("네트워크 예외가 나도 버튼이 잠기지 않는다(pending 해제 + 재시도 안내)", async () => {
    signInWithOAuth.mockRejectedValue(new Error("network down"));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Kakao로 계속하기" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("소셜 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Kakao로 계속하기" })).not.toBeDisabled(),
    );
  });

  it("매직링크 전송이 예외로 실패하면 재시도 안내를 표시하고 pending을 해제한다", async () => {
    signInWithOtp.mockRejectedValue(new Error("network down"));
    renderPage();

    fireEvent.change(screen.getByLabelText("이메일"), {
      target: { value: "someone@culiver.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "이메일로 로그인 링크 받기" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    expect(screen.queryByText(MAGIC_LINK_NOTICE)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "이메일로 로그인 링크 받기" })).not.toBeDisabled(),
    );
  });

  it("이메일 미입력 상태로 매직링크를 누르면 네트워크 호출 없이 검증 문구를 표시한다", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "이메일로 로그인 링크 받기" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("이메일을 먼저 입력하세요.");
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});
