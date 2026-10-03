import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSiteMrvReports } from "@/hooks/useSiteMrvReports";
import { ApiError } from "@/lib/api-client";
import { formatIsoLocal } from "@/lib/datetime";
import { formatMrvNumber } from "./mrv-meta";

/*
 * MRV 리포트 이력 목록(MASTER 화면10, phase-3 슬라이스 M-FE, PRO 이상).
 * GET /sites/{siteId}/mrv-reports 응답을 그대로 나열한다(재계산 없음). 조회는 viewer도
 * 가능(require_plan만, require_writer 아님) — 생성 버튼만 owner/operator로 제한한다
 * (RecommendationBoardPage와 동일한 조회/쓰기 분리 관례).
 */

const DEMO_SITE_ID = import.meta.env.VITE_DEMO_SITE_ID ?? "demo-site";

export function MrvReportListPage() {
  const siteId = DEMO_SITE_ID;
  const { isViewer } = useAuth();

  const listQuery = useSiteMrvReports(siteId);
  const apiError = listQuery.error instanceof ApiError ? listQuery.error : null;

  return (
    <PageShell isViewer={isViewer}>
      {listQuery.isLoading && (
        <div
          role="status"
          aria-label="MRV 리포트 이력 불러오는 중"
          className="h-40 animate-pulse rounded-card border border-border bg-surface"
        />
      )}

      {apiError?.status === 403 && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-card border border-border bg-surface p-5 text-sm"
        >
          <p className="font-semibold text-fg">MRV 리포트를 사용할 수 없습니다</p>
          <p className="text-muted">
            MRV 리포트는 PRO 이상 요금제에서 제공됩니다. 요금제를 업그레이드하면 이용할 수
            있습니다.
          </p>
        </div>
      )}
      {apiError?.isUnauthorized && (
        <p role="alert" className="text-sm text-signal-red">
          인증이 만료되었습니다. 다시 로그인해 주세요.
        </p>
      )}
      {listQuery.isError && !apiError && (
        <p role="alert" className="text-sm text-signal-red">
          MRV 리포트 이력을 불러오지 못했습니다.
        </p>
      )}

      {listQuery.data && listQuery.data.items.length === 0 && (
        <div className="flex flex-col items-start gap-3 rounded-card border border-border bg-surface p-6 text-sm">
          <p role="status" className="text-muted">
            아직 생성된 리포트가 없습니다.
          </p>
          {!isViewer && (
            <Link
              to="/mrv-reports/new"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white"
            >
              새 리포트 생성
            </Link>
          )}
        </div>
      )}

      {listQuery.data && listQuery.data.items.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="MRV 리포트 이력">
          {listQuery.data.items.map((item) => (
            <li key={item.id}>
              <Link
                to={`/mrv-reports/${item.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-surface p-4 text-sm hover:bg-bg"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-fg">{formatIsoLocal(item.generated_at)}</span>
                  <span className="text-xs text-muted">
                    {item.period.from.slice(0, 10)} ~ {item.period.to.slice(0, 10)}
                  </span>
                </div>
                <span className="text-sm font-semibold text-fg">
                  감축량 {formatMrvNumber(item.reduction_tco2e, 3)}
                  {item.reduction_tco2e !== null && " tCO2e"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

function PageShell({
  children,
  isViewer,
}: {
  children: React.ReactNode;
  isViewer: boolean;
}) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold text-fg">MRV 리포트</h1>
          <p className="text-sm text-muted">
            사이트 {DEMO_SITE_ID} · 탄소저감 성과 리포트 이력(PRO 이상)
          </p>
        </div>
        {!isViewer && (
          <Link
            to="/mrv-reports/new"
            className="rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-bg"
          >
            새 리포트 생성
          </Link>
        )}
      </header>
      {children}
    </div>
  );
}
