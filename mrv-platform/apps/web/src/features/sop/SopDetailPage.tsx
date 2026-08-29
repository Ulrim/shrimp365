import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSopDetail } from "@/hooks/useSopDetail";
import { useSubmitChecklistRun } from "@/hooks/useSubmitChecklistRun";
import { useChecklistRuns } from "@/hooks/useChecklistRuns";
import { ApiError } from "@/lib/api-client";
import { formatIsoLocal } from "@/lib/datetime";
import { SOP_CATEGORY_LABEL } from "./sop-meta";
import { MarkdownLite } from "./MarkdownLite";
import type { ChecklistRunItemInput } from "@/types/api";

/*
 * SOP 상세 화면(MASTER 화면8, phase-3 2.1/2.2절, PRO 이상).
 * 본문(마크다운 최소 렌더) + 체크리스트 실행 폼(항목별 체크박스+비고) → 제출(증빙,
 * append-only). viewer는 조회만 가능(제출 버튼 비활성 — require_writer가 최종 방어선).
 * 과거 실행 이력을 함께 표시한다. 산식 재계산 없음(백엔드 응답 그대로 표시).
 */

const DEMO_SITE_ID = import.meta.env.VITE_DEMO_SITE_ID ?? "demo-site";

type ChecklistFieldState = Record<string, { checked: boolean; note: string }>;

export function SopDetailPage() {
  const { id } = useParams<{ id: string }>();
  const sopId = id ?? "";
  const siteId = DEMO_SITE_ID;
  const { isViewer, canWriteLogs } = useAuth();

  const detailQuery = useSopDetail(sopId);
  const submitMutation = useSubmitChecklistRun(siteId, sopId);
  const historyQuery = useChecklistRuns(siteId, { sopId });

  const [fields, setFields] = useState<ChecklistFieldState>({});

  // 상세 로드 시 체크리스트 항목 정의로 폼 상태를 초기화(항목 정의가 바뀌면 재초기화).
  useEffect(() => {
    if (!detailQuery.data) return;
    const initial: ChecklistFieldState = {};
    for (const item of detailQuery.data.checklist_items) {
      initial[item.id] = { checked: false, note: "" };
    }
    setFields(initial);
  }, [detailQuery.data]);

  const apiError = detailQuery.error instanceof ApiError ? detailQuery.error : null;
  const canSubmit = canWriteLogs && !isViewer;

  function handleToggle(itemId: string) {
    setFields((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], checked: !prev[itemId]?.checked },
    }));
  }

  function handleNoteChange(itemId: string, note: string) {
    setFields((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], note },
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !detailQuery.data) return;
    const items: ChecklistRunItemInput[] = detailQuery.data.checklist_items.map((item) => {
      const field = fields[item.id] ?? { checked: false, note: "" };
      const trimmedNote = field.note.trim();
      return {
        item_id: item.id,
        checked: field.checked,
        ...(trimmedNote ? { note: trimmedNote } : {}),
      };
    });
    submitMutation.mutate({ items });
  }

  return (
    <PageShell>
      {detailQuery.isLoading && (
        <div
          role="status"
          aria-label="SOP 상세 불러오는 중"
          className="h-40 animate-pulse rounded-card border border-border bg-surface"
        />
      )}

      {apiError?.status === 404 && (
        <p role="alert" className="text-sm text-signal-red">
          해당 SOP를 찾을 수 없습니다.
        </p>
      )}
      {apiError?.status === 403 && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-card border border-border bg-surface p-5 text-sm"
        >
          <p className="font-semibold text-fg">이 SOP를 볼 수 없습니다</p>
          <p className="text-muted">SOP 라이브러리는 PRO 이상 요금제에서 제공됩니다.</p>
        </div>
      )}
      {apiError?.isUnauthorized && (
        <p role="alert" className="text-sm text-signal-red">
          인증이 만료되었습니다. 다시 로그인해 주세요.
        </p>
      )}
      {detailQuery.isError && !apiError && (
        <p role="alert" className="text-sm text-signal-red">
          SOP 상세를 불러오지 못했습니다.
        </p>
      )}

      {detailQuery.data && (
        <>
          <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-fg">{detailQuery.data.title}</h1>
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                {SOP_CATEGORY_LABEL[detailQuery.data.category]}
              </span>
            </div>
            <MarkdownLite markdown={detailQuery.data.body_markdown} />
          </section>

          <section
            className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5"
            aria-label="체크리스트 실행"
          >
            <h2 className="text-base font-semibold text-fg">체크리스트</h2>

            {isViewer && (
              <p role="note" className="rounded-md bg-signal-na-bg px-3 py-2 text-xs text-muted">
                읽기 전용 권한(viewer)입니다. 체크리스트 실행 기록 제출은 owner/operator만
                가능합니다.
              </p>
            )}

            {detailQuery.data.checklist_items.length === 0 ? (
              <p className="text-sm text-muted">등록된 체크리스트 항목이 없습니다.</p>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <ul className="flex flex-col gap-3">
                  {detailQuery.data.checklist_items.map((item) => (
                    <li key={item.id} className="flex flex-col gap-1 rounded-md border border-border p-3">
                      <label className="flex items-center gap-2 text-sm text-fg">
                        <input
                          type="checkbox"
                          checked={fields[item.id]?.checked ?? false}
                          disabled={!canSubmit}
                          onChange={() => handleToggle(item.id)}
                        />
                        {item.label}
                      </label>
                      <input
                        type="text"
                        value={fields[item.id]?.note ?? ""}
                        disabled={!canSubmit}
                        onChange={(e) => handleNoteChange(item.id, e.target.value)}
                        placeholder="비고(선택)"
                        className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-fg disabled:opacity-60"
                      />
                    </li>
                  ))}
                </ul>

                {submitMutation.isError && (
                  <p role="alert" className="text-sm text-signal-red">
                    {submitMutation.error instanceof ApiError
                      ? submitMutation.error.message
                      : "체크리스트 제출에 실패했습니다."}
                  </p>
                )}
                {submitMutation.isSuccess && (
                  <p role="status" className="text-sm text-signal-green">
                    체크리스트 실행 기록이 저장되었습니다.
                  </p>
                )}

                <button
                  type="submit"
                  disabled={!canSubmit || submitMutation.isPending}
                  className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitMutation.isPending ? "제출 중…" : "체크리스트 제출"}
                </button>
              </form>
            )}
          </section>

          <section className="flex flex-col gap-2" aria-label="실행 이력">
            <h2 className="text-base font-semibold text-fg">과거 실행 이력</h2>
            {historyQuery.isLoading && (
              <div
                role="status"
                aria-label="실행 이력 불러오는 중"
                className="h-16 animate-pulse rounded-card border border-border bg-surface"
              />
            )}
            {historyQuery.isError && (
              <p role="alert" className="text-sm text-signal-red">
                실행 이력을 불러오지 못했습니다.
              </p>
            )}
            {historyQuery.data && historyQuery.data.items.length === 0 && (
              <p role="status" className="text-sm text-muted">
                아직 실행 기록이 없습니다.
              </p>
            )}
            {historyQuery.data && historyQuery.data.items.length > 0 && (
              <ul className="flex flex-col gap-2">
                {historyQuery.data.items.map((run) => (
                  <li
                    key={run.id}
                    className="flex flex-col gap-1 rounded-card border border-border bg-surface p-3 text-sm"
                  >
                    <span className="text-fg">
                      {formatIsoLocal(run.performed_at)} · {run.performed_by}
                    </span>
                    <span className="text-xs text-muted">
                      {run.items.filter((i) => i.checked).length}/{run.items.length} 항목 완료
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      {children}
    </div>
  );
}
