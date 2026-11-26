"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteReport, requestReportChange, reviewChangeRequest, reviewReport, submitReport,
} from "@/app/(dashboard)/farm365/work/(app)/reports/actions";
import { Button } from "@/components/work/ui/button";
import { Dialog, DialogContent } from "@/components/work/ui/dialog";
import { Field, FormError, Textarea } from "@/components/work/ui/form";
import { workHref } from "@/lib/work/constants";
import type { ActionResult } from "@/lib/work/types";

type Mode = "approve" | "revision" | "change" | "change-approve" | "change-reject" | null;

const DIALOG: Record<Exclude<Mode, null>, { title: string; label: string; required: boolean; confirm: string; danger?: boolean }> = {
  approve: { title: "작업일보 승인", label: "검토 의견 (선택)", required: false, confirm: "승인" },
  revision: { title: "보완 요청", label: "보완 요청 사유", required: true, confirm: "보완 요청", danger: true },
  change: { title: "수정 요청", label: "수정이 필요한 사유", required: true, confirm: "수정 요청" },
  "change-approve": { title: "수정 요청 승인", label: "처리 의견 (선택)", required: false, confirm: "수정 허용" },
  "change-reject": { title: "수정 요청 반려", label: "반려 사유 (선택)", required: false, confirm: "반려", danger: true },
};

export function ReportActions({
  reportId,
  canEdit,
  canSubmit,
  canDelete,
  canReview,
  canRequestChange,
  pendingChangeId,
  canReviewChange,
}: {
  reportId: string;
  canEdit: boolean;
  canSubmit: boolean;
  canDelete: boolean;
  canReview: boolean;
  canRequestChange: boolean;
  pendingChangeId: string | null;
  canReviewChange: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult>, after?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setError(result.error);
      setError(null);
      setMode(null);
      setComment("");
      if (after) after();
      else router.refresh();
    });
  }

  function confirmDialog() {
    if (!mode) return;
    if (DIALOG[mode].required && !comment.trim()) return setError("사유를 입력해 주세요.");
    if (mode === "approve") run(() => reviewReport(reportId, "approved", comment));
    else if (mode === "revision") run(() => reviewReport(reportId, "revision_requested", comment));
    else if (mode === "change") run(() => requestReportChange(reportId, comment));
    else if (pendingChangeId) run(() => reviewChangeRequest(pendingChangeId, reportId, mode === "change-approve", comment));
  }

  const open = (next: Mode) => {
    setError(null);
    setComment("");
    setMode(next);
  };
  const nothing = !canEdit && !canSubmit && !canDelete && !canReview && !canRequestChange && !(pendingChangeId && canReviewChange);
  if (nothing) return null;

  return (
    <div className="no-print space-y-2">
      {!mode && <FormError message={error} />}
      <div className="flex flex-wrap gap-2">
        {canReview && (
          <>
            <Button size="lg" className="flex-1 md:flex-none" disabled={pending} onClick={() => open("approve")}>승인</Button>
            <Button size="lg" variant="dangerOutline" className="flex-1 md:flex-none" disabled={pending} onClick={() => open("revision")}>보완 요청</Button>
          </>
        )}
        {pendingChangeId && canReviewChange && (
          <>
            <Button size="lg" className="flex-1 md:flex-none" disabled={pending} onClick={() => open("change-approve")}>수정 허용</Button>
            <Button size="lg" variant="dangerOutline" className="flex-1 md:flex-none" disabled={pending} onClick={() => open("change-reject")}>수정 요청 반려</Button>
          </>
        )}
        {canSubmit && (
          <Button
            size="lg"
            className="flex-1 md:flex-none"
            disabled={pending}
            onClick={() => confirm("제출하면 관리자 검토 전까지 수정할 수 없습니다. 제출할까요?") && run(() => submitReport(reportId))}
          >
            제출
          </Button>
        )}
        {canEdit && (
          <Button size="lg" variant="outline" className="flex-1 md:flex-none" asChild>
            <Link href={workHref(`/reports/${reportId}/edit`)}>수정</Link>
          </Button>
        )}
        {canRequestChange && (
          <Button size="lg" variant="outline" className="flex-1 md:flex-none" disabled={pending} onClick={() => open("change")}>수정 요청</Button>
        )}
        {canDelete && (
          <Button
            size="lg"
            variant="ghost"
            className="dw-fg-red"
            disabled={pending}
            onClick={() => confirm("작성중인 작업일보를 삭제할까요?") && run(() => deleteReport(reportId), () => router.replace(workHref("/reports")))}
          >
            삭제
          </Button>
        )}
      </div>

      <Dialog open={mode !== null} onOpenChange={(v) => !v && setMode(null)}>
        {mode && (
          <DialogContent title={DIALOG[mode].title}>
            <div className="space-y-3">
              <Field label={DIALOG[mode].label} htmlFor="review-comment" required={DIALOG[mode].required}>
                <Textarea id="review-comment" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
              </Field>
              <FormError message={error} />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="lg" onClick={() => setMode(null)}>취소</Button>
                <Button size="lg" variant={DIALOG[mode].danger ? "danger" : "primary"} disabled={pending} onClick={confirmDialog}>
                  {pending ? "처리 중…" : DIALOG[mode].confirm}
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
