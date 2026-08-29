import { Link } from "react-router-dom";
import { useSopList } from "@/hooks/useSopList";
import { ApiError } from "@/lib/api-client";
import { SOP_CATEGORY_LABEL, SOP_CATEGORY_ORDER } from "./sop-meta";
import type { SopCategory, SopSummary } from "@/types/api";

/*
 * SOP 라이브러리 목록(MASTER 화면8, phase-3 2.1절, PRO 이상).
 * GET /sop 응답(정적 콘텐츠 메타)을 카테고리(4종)별로 그룹핑해 카드로 나열한다.
 * 산식/판정 없음 — 순수 표시. 로딩/에러(403=플랜 부족 안내)/빈 상태를 명시적으로 처리한다.
 */
export function SopListPage() {
  const listQuery = useSopList();
  const apiError = listQuery.error instanceof ApiError ? listQuery.error : null;

  const grouped: Record<SopCategory, SopSummary[]> = {
    normal: [],
    water_quality: [],
    do_drop: [],
    mortality_spike: [],
  };
  for (const item of listQuery.data?.items ?? []) {
    grouped[item.category]?.push(item);
  }

  return (
    <PageShell>
      {listQuery.isLoading && (
        <div
          role="status"
          aria-label="SOP 목록 불러오는 중"
          className="h-40 animate-pulse rounded-card border border-border bg-surface"
        />
      )}

      {apiError?.status === 403 && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-card border border-border bg-surface p-5 text-sm"
        >
          <p className="font-semibold text-fg">SOP 라이브러리를 사용할 수 없습니다</p>
          <p className="text-muted">
            SOP 라이브러리는 PRO 이상 요금제에서 제공됩니다. 요금제를 업그레이드하면 이용할 수
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
          SOP 목록을 불러오지 못했습니다.
        </p>
      )}

      {listQuery.data && listQuery.data.items.length === 0 && (
        <p role="status" className="rounded-card border border-border bg-surface p-6 text-sm text-muted">
          등록된 SOP가 없습니다.
        </p>
      )}

      {listQuery.data && listQuery.data.items.length > 0 && (
        <div className="flex flex-col gap-6">
          {SOP_CATEGORY_ORDER.map((category) => {
            const items = grouped[category];
            if (items.length === 0) return null;
            return (
              <section key={category} className="flex flex-col gap-3" aria-label={SOP_CATEGORY_LABEL[category]}>
                <h2 className="text-base font-semibold text-fg">{SOP_CATEGORY_LABEL[category]}</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {items.map((item) => (
                    <Link
                      key={item.id}
                      to={`/sop/${item.id}`}
                      className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4 text-sm hover:bg-bg"
                    >
                      <span className="font-medium text-fg">{item.title}</span>
                      <span className="text-xs text-muted">{item.summary}</span>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-fg">SOP 라이브러리</h1>
        <p className="text-sm text-muted">
          상황별 표준운영절차(정상운영 · 수질악화 · DO저하 · 폐사증가, PRO 이상)
        </p>
      </header>
      {children}
    </div>
  );
}
