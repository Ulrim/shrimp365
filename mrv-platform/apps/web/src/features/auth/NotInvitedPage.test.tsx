import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/*
 * NotInvitedPage (FED-3, ADR 0006 4절): 인증은 성공했으나 초대가 없는 계정에게
 * "인증 성공 ≠ 이용 권한"을 설명하는 화면.
 *
 * 특히 검증하는 것:
 *  - 로그아웃 버튼 존재(없으면 잘못된 계정으로 들어온 사용자가 세션에 갇힌다).
 *  - 카카오처럼 이메일이 없는 계정을 UID 선연계(FED-1) 경로로 데려가는 안내 문구.
 *  - VITE_SUPPORT_CONTACT 미설정 시 링크를 렌더하지 않는다(깨진 링크 금지).
 */

const signOut = vi.fn();
const navigate = vi.fn();

vi.mock("@/lib/supabase-client", () => ({
  supabase: { auth: { signOut: (...args: unknown[]) => signOut(...args) } },
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

import { NotInvitedPage } from "./NotInvitedPage";

function renderPage(props: { status?: 403 | 409 } = {}) {
  render(
    <MemoryRouter>
      <NotInvitedPage {...props} />
    </MemoryRouter>,
  );
}

describe("NotInvitedPage", () => {
  beforeEach(() => {
    signOut.mockReset();
    signOut.mockResolvedValue({ error: null });
    navigate.mockReset();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("제목과 403 본문을 렌더한다(기본값)", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "이용 신청이 필요합니다" })).toBeInTheDocument();
    expect(
      screen.getByText(/shrimp365 계정으로 정상 인증되었습니다/),
    ).toBeInTheDocument();
    expect(screen.getByText(/조직 단위 이용 신청\(초대\)이 완료된 계정만/)).toBeInTheDocument();
  });

  it("409면 다중 조직 문구로 분기한다", () => {
    renderPage({ status: 409 });
    expect(screen.getByRole("heading", { name: "이용 신청이 필요합니다" })).toBeInTheDocument();
    expect(screen.getByText(/둘 이상의 조직에 초대되어 있어/)).toBeInTheDocument();
    expect(screen.queryByText(/shrimp365 계정으로 정상 인증되었습니다/)).not.toBeInTheDocument();
  });

  it("카카오처럼 이메일이 없는 계정을 위한 관리자 직접 연결 안내를 포함한다", () => {
    renderPage();
    expect(
      screen.getByText(/이메일이 제공되지 않는 경우에도 관리자가 직접 연결할 수 있습니다/),
    ).toBeInTheDocument();
  });

  it("★로그아웃 버튼이 존재하고, 클릭 시 signOut 후 /login으로 이동한다", async () => {
    renderPage();
    const button = screen.getByRole("button", { name: "로그아웃" });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/login", { replace: true }));
  });

  it("signOut이 실패해도 /login으로 이동시킨다(세션에 갇히지 않게)", async () => {
    signOut.mockRejectedValue(new Error("network down"));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/login", { replace: true }));
  });

  it("VITE_SUPPORT_CONTACT 미설정 시 문의 링크를 렌더하지 않는다", () => {
    vi.stubEnv("VITE_SUPPORT_CONTACT", "");
    renderPage();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("VITE_SUPPORT_CONTACT가 이메일이면 mailto: 링크를 렌더한다", () => {
    vi.stubEnv("VITE_SUPPORT_CONTACT", "support@culiver.example");
    renderPage();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "mailto:support@culiver.example");
    expect(link).not.toHaveAttribute("target");
  });

  it("VITE_SUPPORT_CONTACT가 https URL이면 새 탭 링크로 렌더한다", () => {
    vi.stubEnv("VITE_SUPPORT_CONTACT", "https://culiver.example/support");
    renderPage();
    const link = screen.getByRole("link", { name: "문의하기" });
    expect(link).toHaveAttribute("href", "https://culiver.example/support");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("형식이 불명한 VITE_SUPPORT_CONTACT는 링크로 렌더하지 않는다(깨진 링크 금지)", () => {
    vi.stubEnv("VITE_SUPPORT_CONTACT", "고객센터로 전화 주세요");
    renderPage();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
