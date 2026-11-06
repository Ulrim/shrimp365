import { useId, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSiteRecommendations } from "@/hooks/useSiteRecommendations";
import { useAddRecipeVersion } from "@/hooks/useAddRecipeVersion";
import { ApiError } from "@/lib/api-client";
import { formatIsoLocal } from "@/lib/datetime";
import {
  RECIPE_TYPE_LABEL,
  RECIPE_TYPE_ORDER,
  formatRecommendedValue,
} from "./recommend-meta";
import type { RecipeType, RecommendationItem } from "@/types/api";

/*
 * 추천(운전 레시피) 보드 화면(MASTER 화면7, phase-2 슬라이스 K-FE, PRO 이상).
 * 산식 재계산 금지 — GET /sites/{id}/recommendations 응답(params/rationale/source_refs)을
 * 그대로 표시한다. status='recommend_only'는 이번 Phase 고정값(승인/자동 적용 없음).
 *
 * 이중 방어: App.tsx 네비게이션은 GET /auth/me(usePlan) 기반으로 START 플랜이면 메뉴 자체를
 * 숨긴다(선제 게이팅, ComparisonPage와 동일). 직접 URL 접근 시에는 API 403 응답을 받은 뒤에만
 * 이 화면이 PRO 안내로 전환한다(백엔드가 최종 방어선).
 * 계약상 viewer는 GET 조회 자체는 차단되지 않으므로(설계 문서 명시), 조회 화면은 viewer에게도
 * 그대로 노출하고 "수동으로 새 버전 추가" 폼만 owner/operator로 제한한다.
 */

const DEMO_SITE_ID = import.meta.env.VITE_DEMO_SITE_ID ?? "demo-site";

export function RecommendationBoardPage() {
  const siteId = DEMO_SITE_ID;
  const { isViewer } = useAuth();

  const recommendationsQuery = useSiteRecommendations(siteId);
  const addVersionMutation = useAddRecipeVersion(siteId);

  const apiError =
    recommendationsQuery.error instanceof ApiError
      ? recommendationsQuery.error
      : null;

  return (
    <PageShell>
      {/* --- "추천만" 배지: 고정 표시(승인/자동 적용 없음, status='recommend_only' 반영) --- */}
      <div
        role="status"
        className="flex flex-col gap-1 rounded-card border border-signal-amber bg-signal-amber-bg p-4 text-sm"
      >
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-signal-amber">
          추천만
        </span>
        <p className="text-fg">
          이 값은 참고용이며 자동 적용되지 않습니다. 승인/적용 기능은 추후 제공됩니다.
        </p>
      </div>

      {/* --- 로딩 --- */}
      {recommendationsQuery.isLoading && (
        <div
          role="status"
          aria-label="추천 결과 불러오는 중"
          className="h-40 animate-pulse rounded-card border border-border bg-surface"
        />
      )}

      {/* --- 403: 플랜/권한 부족 --- */}
      {apiError?.status === 403 && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-card border border-border bg-surface p-5 text-sm"
        >
          <p className="font-semibold text-fg">추천 보드를 사용할 수 없습니다</p>
          <p className="text-muted">
            추천(운전 레시피) 보드는 PRO 이상 요금제에서 제공됩니다. 요금제를 업그레이드하면
            이용할 수 있습니다.
          </p>
        </div>
      )}

      {/* --- 그 외 에러 --- */}
      {recommendationsQuery.isError && !apiError && (
        <p role="alert" className="text-sm text-signal-red">
          추천 결과를 불러오지 못했습니다.
        </p>
      )}
      {apiError && apiError.isUnauthorized && (
        <p role="alert" className="text-sm text-signal-red">
          인증이 만료되었습니다. 다시 로그인해 주세요.
        </p>
      )}

      {/* --- 빈 상태 --- */}
      {recommendationsQuery.data && recommendationsQuery.data.items.length === 0 && (
        <p
          role="status"
          className="rounded-card border border-border bg-surface p-6 text-sm text-muted"
        >
          아직 산출된 추천이 없습니다.
        </p>
      )}

      {/* --- 정상 결과: 3개 카드(급이/산소/순환) --- */}
      {recommendationsQuery.data && recommendationsQuery.data.items.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {RECIPE_TYPE_ORDER.map((type) => {
            const item = recommendationsQuery.data!.items.find((i) => i.type === type);
            return (
              <RecommendationCard
                key={type}
                type={type}
                item={item}
                isViewer={isViewer}
                onAddVersion={(body) =>
                  item
                    ? addVersionMutation.mutate({ recipeId: item.recipe_id, body })
                    : undefined
                }
                mutationPending={addVersionMutation.isPending}
                mutationError={addVersionMutation.isError}
                mutationSuccess={addVersionMutation.isSuccess}
              />
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

function RecommendationCard({
  type,
  item,
  isViewer,
  onAddVersion,
  mutationPending,
  mutationError,
  mutationSuccess,
}: {
  type: RecipeType;
  item: RecommendationItem | undefined;
  isViewer: boolean;
  onAddVersion: (body: { params: Record<string, unknown>; rationale: string }) => void;
  mutationPending: boolean;
  mutationError: boolean;
  mutationSuccess: boolean;
}) {
  const label = RECIPE_TYPE_LABEL[type];

  if (!item) {
    return (
      <section className="flex flex-col gap-2 rounded-card border border-border bg-surface p-5">
        <h3 className="text-base font-semibold text-fg">{label}</h3>
        <p className="text-sm text-muted">추천 불가(근거 부족)</p>
      </section>
    );
  }

  const formattedValue = formatRecommendedValue(type, item.params);

  return (
    <section
      aria-label={`${label} 추천`}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-fg">{label}</h3>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
          v{item.current_version}
        </span>
      </div>

      <p className="text-lg font-bold text-fg">
        {formattedValue ?? (
          <span className="text-sm font-medium text-muted">추천 불가(근거 부족)</span>
        )}
      </p>

      <p className="text-sm text-fg">{item.rationale}</p>

      <p className="text-xs text-muted">
        {item.config_version} · {formatIsoLocal(item.generated_at)}
      </p>

      {!isViewer && (
        <ManualVersionForm
          onSubmit={onAddVersion}
          pending={mutationPending}
          error={mutationError}
          success={mutationSuccess}
        />
      )}
      {isViewer && (
        <p role="note" className="text-xs text-muted">
          읽기 전용 권한(viewer)입니다. 수동 버전 추가는 owner/operator만 가능합니다.
        </p>
      )}
    </section>
  );
}

function ManualVersionForm({
  onSubmit,
  pending,
  error,
  success,
}: {
  onSubmit: (body: { params: Record<string, unknown>; rationale: string }) => void;
  pending: boolean;
  error: boolean;
  success: boolean;
}) {
  const paramsId = useId();
  const rationaleId = useId();
  const [paramsText, setParamsText] = useState("{}");
  const [rationale, setRationale] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rationale.trim()) {
      setFieldError("근거(rationale)를 입력하세요.");
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(paramsText || "{}");
    } catch {
      setFieldError("params는 올바른 JSON이어야 합니다.");
      return;
    }
    setFieldError(null);
    onSubmit({ params: parsed, rationale: rationale.trim() });
  }

  return (
    <details className="rounded-md border border-border p-3 text-sm">
      <summary className="cursor-pointer font-medium text-fg">
        수동으로 새 버전 추가(고급)
      </summary>
      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={paramsId} className="text-xs font-medium text-fg">
            params (JSON)
          </label>
          <textarea
            id={paramsId}
            value={paramsText}
            onChange={(e) => setParamsText(e.target.value)}
            rows={3}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-fg"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={rationaleId} className="text-xs font-medium text-fg">
            rationale (근거)
          </label>
          <input
            id={rationaleId}
            type="text"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-fg"
          />
        </div>
        {fieldError && (
          <p role="alert" className="text-xs text-signal-red">
            {fieldError}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-signal-red">
            새 버전 저장에 실패했습니다.
          </p>
        )}
        {success && (
          <p role="status" className="text-xs text-signal-green">
            새 버전이 저장되었습니다.
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-md border border-primary px-3 py-1.5 text-xs font-medium text-primary hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "저장 중…" : "새 버전 저장"}
        </button>
      </form>
    </details>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-fg">추천(운전 레시피) 보드</h1>
        <p className="text-sm text-muted">
          사이트 {DEMO_SITE_ID} · 급이/산소/순환 추천값과 근거(PRO 이상)
        </p>
      </header>
      {children}
    </div>
  );
}
