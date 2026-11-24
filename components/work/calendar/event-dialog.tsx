"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteEvent, saveEvent } from "@/app/(app)/calendar/actions";
import { Button } from "@/components/work/ui/button";
import { Dialog, DialogContent } from "@/components/work/ui/dialog";
import { Field, FormError, Input, Select, Textarea } from "@/components/work/ui/form";
import { EVENT_TYPE } from "@/lib/work/constants";
import type { ActionResult, EventType, ScheduleEvent } from "@/lib/work/types";
import { cn } from "@/lib/utils";

/** 일정 등록(event 없음) 또는 수정·삭제(event 있음) 버튼과 대화상자 */
export function EventDialog({
  event,
  defaultDate,
  isManager,
  processes,
}: {
  event?: ScheduleEvent;
  defaultDate: string;
  isManager: boolean;
  processes: { id: string; name: string }[];
}) {
  const router = useRouter();
  const initial = () => ({
    title: event?.title ?? "",
    description: event?.description ?? "",
    start_date: event?.start_date ?? defaultDate,
    end_date: event?.end_date ?? defaultDate,
    event_type: (event?.event_type ?? (isManager ? "construction" : "personal")) as EventType,
    personal: event ? event.owner_id !== null : !isManager,
    process_id: event?.process_id ?? "",
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<ReturnType<typeof initial>>) => setForm((f) => ({ ...f, ...patch }));

  // 열 때마다 현재 선택한 날짜·일정 내용으로 입력값을 새로 채운다
  function openDialog() {
    setForm(initial());
    setError(null);
    setOpen(true);
  }

  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setError(result.error);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {event ? (
        <Button variant="ghost" size="icon" aria-label="일정 수정" onClick={openDialog}>
          <Pencil />
        </Button>
      ) : (
        <Button onClick={openDialog}>
          <Plus /> 일정 등록
        </Button>
      )}
      {open && (
        <DialogContent title={event ? "일정 수정" : "일정 등록"}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => saveEvent(event?.id ?? null, form));
            }}
          >
            {isManager && (
              <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="일정 구분">
                {[
                  { value: false, label: "전체 일정" },
                  { value: true, label: "개인 일정" },
                ].map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    role="radio"
                    aria-checked={form.personal === opt.value}
                    onClick={() => set({ personal: opt.value, event_type: opt.value ? "personal" : form.event_type === "personal" ? "construction" : form.event_type })}
                    className={cn(
                      "h-11 rounded-lg border text-sm font-semibold",
                      form.personal === opt.value ? "border-brand bg-brand text-white" : "border-border bg-card text-foreground",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
            {!isManager && <p className="text-sm text-muted-foreground">개인 일정으로 등록됩니다. 본인과 관리자만 볼 수 있습니다.</p>}
            <Field label="일정명" htmlFor="event-title" required>
              <Input id="event-title" maxLength={200} value={form.title} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="시작일" htmlFor="event-start" required>
                <Input
                  id="event-start"
                  type="date"
                  value={form.start_date}
                  onChange={(e) => set({ start_date: e.target.value, end_date: form.end_date < e.target.value ? e.target.value : form.end_date })}
                />
              </Field>
              <Field label="종료일" htmlFor="event-end" required>
                <Input id="event-end" type="date" min={form.start_date} value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} />
              </Field>
              {isManager && (
                <Field label="유형" htmlFor="event-type">
                  <Select id="event-type" value={form.event_type} onChange={(e) => set({ event_type: e.target.value as EventType })}>
                    {(Object.keys(EVENT_TYPE) as EventType[]).map((t) => (
                      <option key={t} value={t}>{EVENT_TYPE[t].label}</option>
                    ))}
                  </Select>
                </Field>
              )}
              {isManager && !form.personal && (
                <Field label="관련 공정" htmlFor="event-process">
                  <Select id="event-process" value={form.process_id} onChange={(e) => set({ process_id: e.target.value })}>
                    <option value="">선택 안 함</option>
                    {processes.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            <Field label="메모" htmlFor="event-description">
              <Textarea id="event-description" rows={2} maxLength={1000} value={form.description} onChange={(e) => set({ description: e.target.value })} />
            </Field>
            <FormError message={error} />
            <div className="flex gap-2 pt-1">
              {event && (
                <Button
                  variant="dangerOutline"
                  size="lg"
                  disabled={pending}
                  onClick={() => confirm("이 일정을 삭제할까요?") && run(() => deleteEvent(event.id))}
                >
                  삭제
                </Button>
              )}
              <Button variant="outline" size="lg" className="flex-1" onClick={() => setOpen(false)}>취소</Button>
              <Button type="submit" size="lg" className="flex-1" disabled={pending}>{pending ? "저장 중…" : "저장"}</Button>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
