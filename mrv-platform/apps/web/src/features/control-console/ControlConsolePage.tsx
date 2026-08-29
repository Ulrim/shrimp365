import { useId, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useControlActions } from "@/hooks/useControlActions";
import { useApproveControlAction } from "@/hooks/useApproveControlAction";
import { useRejectControlAction } from "@/hooks/useRejectControlAction";
import { useApplyControlAction } from "@/hooks/useApplyControlAction";
import { useProposeControlAction } from "@/hooks/useProposeControlAction";
import { ApiError } from "@/lib/api-client";
import { formatIsoLocal } from "@/lib/datetime";
import { ControlActionConfirmDialog } from "./ControlActionConfirmDialog";
import {
  CONTROL_ACTION_STATUS_BADGE_CLASS,
  CONTROL_ACTION_STATUS_FILTERS,
  CONTROL_ACTION_STATUS_LABEL,
} from "./control-console-meta";
import type { ControlAction, ControlActionStatusFilter } from "@/types/api";

/*
 * 승인형 제어 콘솔(MASTER 화면11, phase-3 3절, ENTERPRISE). "적용"은 실제 액추에이터 제어가
 * 아니라 운영자가 물리적으로 설비에 반영한 뒤 결과를 기록하는 human-in-the-loop 흐름이다
 * (3.0절). 승인 게이트는 서버(DB CHECK 제약 + 상태 전이 검증)가 최종 강제하며, 이 화면의
 * 확인 다이얼로그는 오조작 방지용 UX 보조 수단일 뿐이다. 산식 재계산 없음(상태/필드를 그대로
 * 표시). viewer는 조회만 가능(버튼 자체를 렌더하지 않는다).
 */

const DEMO_SITE_ID = import.meta.env.VITE_DEMO_SITE_ID ?? "demo-site";

function conflictMessage(error: unknown): string | null {
  return error instanceof ApiError && error.status === 409
    ? "이미 처리된 항목입니다. 새로고침해 주세요."
    : null;
}

export function ControlConsolePage() {
  const siteId = DEMO_SITE_ID;
  const { isViewer } = useAuth();

  const [statusFilter, setStatusFilter] = useState<ControlActionStatusFilter>("pending");
  const listQuery = useControlActions(siteId, statusFilter);

  const approveMutation = useApproveControlAction();
  const rejectMutation = useRejectControlAction();
  const applyMutation = useApplyControlAction();
  const proposeMutation = useProposeControlAction();

  const [confirmTarget, setConfirmTarget] = useState<
    { kind: "approve" | "apply"; action: ControlAction } | null
  >(null);
  const [applyNote, setApplyNote] = useState("");

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const listApiError = listQuery.error instanceof ApiError ? listQuery.error : null;

  const activeMutationError =
    approveMutation.error ?? rejectMutation.error ?? applyMutation.error;
  const conflict = conflictMessage(activeMutationError);

  function openApproveDialog(action: ControlAction) {
    setConfirmTarget({ kind: "approve", action });
  }

  function openApplyDialog(action: ControlAction) {
    setApplyNote("");
    setConfirmTarget({ kind: "apply", action });
  }

  function handleConfirmDialog() {
    if (!confirmTarget) return;
    if (confirmTarget.kind === "approve") {
      approveMutation.mutate(confirmTarget.action.id, {
        onSettled: () => setConfirmTarget(null),
      });
    } else {
      applyMutation.mutate(
        {
          id: confirmTarget.action.id,
          body: { result_json: { applied_note: applyNote } },
        },
        { onSettled: () => setConfirmTarget(null) },
      );
    }
  }

  function handleRejectConfirm(id: string) {
    rejectMutation.mutate(
      { id, body: { note: rejectNote } },
      {
        onSuccess: () => {
          setRejectingId(null);
          setRejectNote("");
        },
      },
    );
  }

  return (
    <PageShell>
      <section aria-label="상태 필터" className="flex flex-wrap items-center gap-2">
        {CONTROL_ACTION_STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            aria-pressed={statusFilter === f.value}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
              statusFilter === f.value
                ? "border-primary bg-bg text-primary"
                : "border-border text-muted hover:bg-bg hover:text-fg"
            }`}
          >
            {f.label}
          </button>
        ))}
      </section>

      {!isViewer && (
        <ProposeForm siteId={siteId} mutation={proposeMutation} />
      )}

      {conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-signal-red bg-signal-red-bg p-4 text-sm"
        >
          <span className="text-fg">{conflict}</span>
          <button
            type="button"
            onClick={() => void listQuery.refetch()}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg hover:bg-bg"
          >
            새로고침
          </button>
        </div>
      )}

      {listQuery.isLoading && (
        <div
          role="status"
          aria-label="제어 대기열 불러오는 중"
          className="h-32 animate-pulse rounded-card border border-border bg-surface"
        />
      )}

      {listApiError?.status === 403 && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-card border border-border bg-surface p-5 text-sm"
        >
          <p className="font-semibold text-fg">승인형 제어 콘솔을 사용할 수 없습니다</p>
          <p className="text-muted">
            제어 콘솔은 ENTERPRISE 요금제에서 제공됩니다. 요금제를 업그레이드하면 이용할 수
            있습니다.
          </p>
        </div>
      )}
      {listApiError?.isUnauthorized && (
        <p role="alert" className="text-sm text-signal-red">
          인증이 만료되었습니다. 다시 로그인해 주세요.
        </p>
      )}
      {listQuery.isError && !listApiError && (
        <p role="alert" className="text-sm text-signal-red">
          제어 대기열을 불러오지 못했습니다.
        </p>
      )}

      {listQuery.data && listQuery.data.items.length === 0 && (
        <p
          role="status"
          className="rounded-card border border-border bg-surface p-6 text-sm text-muted"
        >
          해당 상태의 제어 항목이 없습니다.
        </p>
      )}

      {listQuery.data && listQuery.data.items.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label="제어 대기열 목록">
          {listQuery.data.items.map((action) => (
            <li
              key={action.id}
              className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-fg">
                    탱크 {action.tank_id} · 레시피 버전 {action.recipe_version_id}
                  </span>
                  <span className="text-xs text-muted">
                    등록 {formatIsoLocal(action.created_at)}
                    {action.approved_at && ` · 승인 ${formatIsoLocal(action.approved_at)}`}
                    {action.applied_at && ` · 적용 ${formatIsoLocal(action.applied_at)}`}
                  </span>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CONTROL_ACTION_STATUS_BADGE_CLASS[action.status]}`}
                >
                  {CONTROL_ACTION_STATUS_LABEL[action.status]}
                </span>
              </div>

              {!isViewer && action.status === "pending" && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openApproveDialog(action)}
                    className="rounded-md border border-primary px-3 py-1.5 text-sm font-medium text-primary hover:bg-bg"
                  >
                    승인
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRejectingId(action.id);
                      setRejectNote("");
                    }}
                    className="rounded-md border border-signal-red px-3 py-1.5 text-sm font-medium text-signal-red hover:bg-bg"
                  >
                    거부
                  </button>
                </div>
              )}

              {!isViewer && action.status === "approved" && (
                <button
                  type="button"
                  onClick={() => openApplyDialog(action)}
                  className="self-start rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                >
                  적용
                </button>
              )}

              {!isViewer && rejectingId === action.id && (
                <RejectForm
                  pending={rejectMutation.isPending}
                  note={rejectNote}
                  onNoteChange={setRejectNote}
                  onCancel={() => {
                    setRejectingId(null);
                    setRejectNote("");
                  }}
                  onConfirm={() => handleRejectConfirm(action.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <ControlActionConfirmDialog
        open={confirmTarget !== null}
        title={
          confirmTarget?.kind === "approve"
            ? "정말 승인하시겠습니까?"
            : "설비에 실제로 적용하셨습니까?"
        }
        description={
          confirmTarget?.kind === "approve"
            ? "승인 후에는 적용 단계로 진행됩니다."
            : "실제 설비에 물리적으로 반영을 완료한 뒤에만 적용을 기록하세요. 관측값/비고를 함께 남길 수 있습니다."
        }
        confirmLabel={confirmTarget?.kind === "approve" ? "승인" : "적용 기록"}
        pendingLabel={confirmTarget?.kind === "approve" ? "승인 중…" : "기록 중…"}
        pending={
          confirmTarget?.kind === "approve" ? approveMutation.isPending : applyMutation.isPending
        }
        onConfirm={handleConfirmDialog}
        onCancel={() => setConfirmTarget(null)}
      >
        {confirmTarget?.kind === "apply" && (
          <ApplyResultInput value={applyNote} onChange={setApplyNote} />
        )}
      </ControlActionConfirmDialog>
    </PageShell>
  );
}

function ApplyResultInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-fg">
        관측값/비고
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder="예: 실측 DO 6.4 mg/L, 특이사항 없음"
        className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg"
      />
    </div>
  );
}

function RejectForm({
  pending,
  note,
  onNoteChange,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  note: string;
  onNoteChange: (next: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-bg p-3">
      <label htmlFor={id} className="text-xs font-medium text-fg">
        거부 사유
      </label>
      <textarea
        id={id}
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        rows={2}
        className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:bg-bg disabled:opacity-50"
        >
          취소
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="rounded-md bg-signal-red px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "거부 처리 중…" : "거부 확정"}
        </button>
      </div>
    </div>
  );
}

function ProposeForm({
  siteId,
  mutation,
}: {
  siteId: string;
  mutation: ReturnType<typeof useProposeControlAction>;
}) {
  const tankId = useId();
  const recipeVersionId = useId();
  const [tank, setTank] = useState("");
  const [recipeVersion, setRecipeVersion] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tank.trim() || !recipeVersion.trim()) return;
    mutation.mutate(
      { tank_id: tank.trim(), recipe_version_id: recipeVersion.trim() },
      {
        onSuccess: () => {
          setTank("");
          setRecipeVersion("");
        },
      },
    );
  }

  return (
    <details className="rounded-card border border-border bg-surface p-4 text-sm">
      <summary className="cursor-pointer font-medium text-fg">
        새 제어 후보 제안(고급, 사이트 {siteId})
      </summary>
      <form onSubmit={handleSubmit} className="mt-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={tankId} className="text-xs font-medium text-fg">
            tank_id
          </label>
          <input
            id={tankId}
            type="text"
            value={tank}
            onChange={(e) => setTank(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={recipeVersionId} className="text-xs font-medium text-fg">
            recipe_version_id
          </label>
          <input
            id={recipeVersionId}
            type="text"
            value={recipeVersion}
            onChange={(e) => setRecipeVersion(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg"
          />
        </div>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md border border-primary px-3 py-1.5 text-sm font-medium text-primary hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? "제안 중…" : "제안 등록"}
        </button>
        {mutation.isError && (
          <p role="alert" className="text-xs text-signal-red">
            제안 등록에 실패했습니다.
          </p>
        )}
      </form>
    </details>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-fg">승인형 제어 콘솔</h1>
        <p className="text-sm text-muted">
          사이트 {DEMO_SITE_ID} · 제안→승인→적용 반자동 흐름(운영자 물리 적용 기록, ENTERPRISE)
        </p>
      </header>
      {children}
    </div>
  );
}
