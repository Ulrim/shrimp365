import { Navigate, Route, Routes, Link, NavLink } from "react-router-dom";
import { OverviewPage } from "./features/dashboard/OverviewPage";
import { InputPage } from "./features/input/InputPage";
import { BaselineLockPage } from "./features/baseline/BaselineLockPage";
import { AlertCenterPage } from "./features/alerts/AlertCenterPage";
import { ComparisonPage } from "./features/comparison/ComparisonPage";
import { RecommendationBoardPage } from "./features/recommend/RecommendationBoardPage";
import { MrvReportListPage } from "./features/mrv/MrvReportListPage";
import { MrvReportGeneratePage } from "./features/mrv/MrvReportGeneratePage";
import { MrvReportViewPage } from "./features/mrv/MrvReportViewPage";
import { SopListPage } from "./features/sop/SopListPage";
import { SopDetailPage } from "./features/sop/SopDetailPage";
import { OnboardingWizardPage } from "./features/onboarding/OnboardingWizardPage";
import { LoginPage } from "./features/auth/LoginPage";
import { NotInvitedPage } from "./features/auth/NotInvitedPage";
import { ControlConsolePage } from "./features/control-console/ControlConsolePage";
import { MultisiteBenchmarkPage } from "./features/multisite/MultisiteBenchmarkPage";
import { AuditLogPage } from "./features/audit-log/AuditLogPage";
import { usePlan } from "@/hooks/usePlan";
import { useAuth } from "@/hooks/useAuth";
import { useAuthMe } from "@/hooks/useAuthMe";
import { ApiError } from "@/lib/api-client";

/*
 * 라우터 셸 + 상단 네비게이션.
 * Phase 1: 개요 / 급이·폐사 입력 / 기준선 잠금 + 401·404 처리 경로.
 * Phase 2(H/J): 알림 센터 / 전·후 비교·추천 보드(PRO 이상).
 * Phase 2 QA 갭 해소: GET /auth/me(usePlan)로 plan을 확보해 메뉴 자체를 선제 게이팅한다
 *   (START면 "/comparison"·"/recommend" 링크를 숨김). plan이 아직 로딩 중일 때는 깜빡임
 *   방지를 위해 확정 전까지 PRO 전용 항목을 렌더하지 않는다(로딩 완료 후 렌더).
 *   직접 URL 접근 시에는 각 페이지의 기존 403 안내 화면이 이중 방어로 계속 동작한다
 *   (백엔드 403이 최종 방어선 — 메뉴 숨김은 UX 보조 수단일 뿐 라우트 자체를 막지 않는다).
 * Phase 3 슬라이스 O: 미인증 상태에서 보호된 라우트 접근 시 /login으로 리다이렉트
 *   (RequireAuth, 간단한 가드 — 로그인 성공 후 원래 경로로 돌아가는 것까지는 과설계이므로
 *   범위 밖, /overview로 고정 이동). 서버 401이 최종 방어선이며 이 가드는 UX 보조 수단이다.
 * Phase 3 P1: SOP 라이브러리(/sop, PRO 이상 — PRO_NAV_ITEMS에 배지 표기)와 온보딩 마법사
 *   (/onboarding, 공통 — 플랜 무관, BASE_NAV_ITEMS에 항상 노출)를 추가한다.
 * Phase 3 P2: 승인형 제어 콘솔(/control-console) · 멀티사이트 벤치마크(/multisite) ·
 *   감사 로그(/audit-logs) — 전부 ENTERPRISE 전용. usePlan()의 isEnterprise를 PRO 게이팅과
 *   동일한 방식(선제 UI 힌트, 서버 403이 최종 방어선)으로 확장해 ENTERPRISE_NAV_ITEMS를
 *   별도 배열로 둔다(PRO_NAV_ITEMS 패턴 재사용, 배지로 등급 구분).
 * FED-3(ADR 0006 4절): shrimp365 계정으로 인증에 성공했으나 초대가 없는 계정(GET /auth/me
 *   403)·다중 조직 초대(409)는 RequireAuth에서 NotInvitedPage로 대체한다.
 */

/**
 * 세션 복원(sessionReady)이 끝나기 전에는 성급히 미인증으로 판단하지 않는다 — 새로고침
 * 직후 유효한 세션도 잠깐 null 상태를 거치기 때문이다(supabase-client.ts 주석 참고).
 *
 * FED-3(ADR 0006 4절): 인증은 됐으나 초대가 없는 계정(GET /auth/me 403)과 다중 조직
 * 초대로 자동 연결이 중단된 계정(409)은 안내 화면으로 대체한다. **이 한 곳만** 고치면
 * 보호 라우트 전체가 커버된다(페이지마다 흩뿌리지 않는다).
 * - 401은 여기서 다루지 않는다(토큰 만료는 세션 갱신/로그아웃 경로가 처리).
 * - 로딩 중에는 기존 동작(children 렌더)을 유지한다 — 성급히 안내 화면을 띄우면 정상
 *   사용자에게 깜빡임이 생긴다.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, sessionReady } = useAuth();
  const me = useAuthMe();

  if (!sessionReady) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (me.error instanceof ApiError && (me.error.status === 403 || me.error.status === 409)) {
    return <NotInvitedPage status={me.error.status} />;
  }

  return <>{children}</>;
}

const BASE_NAV_ITEMS: Array<{ to: string; label: string }> = [
  { to: "/overview", label: "개요" },
  { to: "/input", label: "급이·폐사 입력" },
  { to: "/baseline", label: "기준선 잠금" },
  { to: "/alerts", label: "알림 센터" },
  { to: "/onboarding", label: "온보딩" },
];

const PRO_NAV_ITEMS: Array<{ to: string; label: string }> = [
  { to: "/comparison", label: "전·후 비교" },
  { to: "/recommend", label: "추천 보드" },
  { to: "/mrv-reports", label: "MRV 리포트" },
  { to: "/sop", label: "SOP 라이브러리" },
];

const ENTERPRISE_NAV_ITEMS: Array<{ to: string; label: string }> = [
  { to: "/control-console", label: "제어 콘솔" },
  { to: "/multisite", label: "멀티사이트" },
  { to: "/audit-logs", label: "감사 로그" },
];

export function NavBar() {
  const { isPro, isEnterprise } = usePlan();
  const items = [
    ...BASE_NAV_ITEMS,
    ...(isPro ? PRO_NAV_ITEMS : []),
    ...(isEnterprise ? ENTERPRISE_NAV_ITEMS : []),
  ];
  const enterprisePaths = new Set(ENTERPRISE_NAV_ITEMS.map((item) => item.to));

  return (
    <nav
      aria-label="주요 메뉴"
      className="sticky top-0 z-40 flex items-center gap-1 border-b border-border bg-surface px-6 py-3"
    >
      <span className="mr-4 text-sm font-bold text-fg">컬리버 MRV</span>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
              isActive
                ? "bg-bg text-primary"
                : "text-muted hover:bg-bg hover:text-fg"
            }`
          }
        >
          {item.label}
          {enterprisePaths.has(item.to) && (
            <span className="rounded-full bg-signal-na-bg px-1.5 py-0.5 text-[10px] font-semibold text-muted">
              ENTERPRISE
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <NavBar />
      <main className="flex-1">{children}</main>
    </div>
  );
}

function UnauthorizedPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-10 text-center">
      <h1 className="text-lg font-bold text-fg">로그인이 필요합니다</h1>
      <p className="text-sm text-muted">
        세션이 만료되었거나 인증되지 않았습니다. 다시 로그인해 주세요.
      </p>
      <Link
        to="/overview"
        className="rounded-md border border-border px-4 py-2 text-sm text-fg hover:bg-bg"
      >
        개요로 이동
      </Link>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-10 text-center">
      <h1 className="text-lg font-bold text-fg">페이지를 찾을 수 없습니다</h1>
      <Link
        to="/overview"
        className="rounded-md border border-border px-4 py-2 text-sm text-fg hover:bg-bg"
      >
        개요로 이동
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/overview" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/overview"
        element={
          <RequireAuth>
            <AppLayout>
              <OverviewPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/input"
        element={
          <RequireAuth>
            <AppLayout>
              <InputPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/baseline"
        element={
          <RequireAuth>
            <AppLayout>
              <BaselineLockPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/alerts"
        element={
          <RequireAuth>
            <AppLayout>
              <AlertCenterPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/comparison"
        element={
          <RequireAuth>
            <AppLayout>
              <ComparisonPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/recommend"
        element={
          <RequireAuth>
            <AppLayout>
              <RecommendationBoardPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/mrv-reports"
        element={
          <RequireAuth>
            <AppLayout>
              <MrvReportListPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/mrv-reports/new"
        element={
          <RequireAuth>
            <AppLayout>
              <MrvReportGeneratePage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/mrv-reports/:id"
        element={
          <RequireAuth>
            <AppLayout>
              <MrvReportViewPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/sop"
        element={
          <RequireAuth>
            <AppLayout>
              <SopListPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/sop/:id"
        element={
          <RequireAuth>
            <AppLayout>
              <SopDetailPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/onboarding"
        element={
          <RequireAuth>
            <AppLayout>
              <OnboardingWizardPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/control-console"
        element={
          <RequireAuth>
            <AppLayout>
              <ControlConsolePage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/multisite"
        element={
          <RequireAuth>
            <AppLayout>
              <MultisiteBenchmarkPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route
        path="/audit-logs"
        element={
          <RequireAuth>
            <AppLayout>
              <AuditLogPage />
            </AppLayout>
          </RequireAuth>
        }
      />
      <Route path="/401" element={<UnauthorizedPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
