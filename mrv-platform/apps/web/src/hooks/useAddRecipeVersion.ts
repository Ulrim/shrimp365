import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { siteRecommendationsQueryKey } from "@/hooks/useSiteRecommendations";
import type { AddRecipeVersionRequest, AddRecipeVersionResponse } from "@/types/api";

/*
 * POST /recipes/{id}/versions — 수동으로 새 레시피 버전 추가(require_writer+PRO, phase-2 2.3절).
 * "적용" 개념 없음(추천만) — 운영자 수기 조정 이력을 남기는 용도. 성공 시 추천 보드(GET
 * /sites/{siteId}/recommendations) 쿼리를 무효화해 current_version 등을 갱신한다.
 */
export function useAddRecipeVersion(
  siteId: string,
): UseMutationResult<
  AddRecipeVersionResponse,
  unknown,
  { recipeId: string; body: AddRecipeVersionRequest }
> {
  const qc = useQueryClient();
  return useMutation<
    AddRecipeVersionResponse,
    unknown,
    { recipeId: string; body: AddRecipeVersionRequest }
  >({
    mutationFn: ({ recipeId, body }) =>
      apiFetch<AddRecipeVersionResponse>(
        `/recipes/${encodeURIComponent(recipeId)}/versions`,
        { method: "POST", json: body },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: siteRecommendationsQueryKey(siteId) });
    },
  });
}
