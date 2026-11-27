"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { saveReport, type SaveReportInput } from "@/app/(dashboard)/farm365/work/(app)/reports/actions";
import { Button } from "@/components/work/ui/button";
import { Card, CardBody, CardHeader } from "@/components/work/ui/card";
import { Field, FormError, FormNotice, Input, Select, Textarea } from "@/components/work/ui/form";
import { ITEM_STATUS, workHref } from "@/lib/work/constants";
import { formatMinutes, workMinutes } from "@/lib/work/dates";
import type { FormOptions, PhotoView } from "@/lib/work/reports";
import type { ItemStatus } from "@/lib/work/types";
import { cn } from "@/lib/utils";
import { PhotoUploader } from "./photo-uploader";

interface ItemState {
  key: string;
  id: string | null;
  process_id: string;
  task_id: string;
  content: string;
  result: string;
  quantity: string;
  unit: string;
  status: ItemStatus;
  task_progress: string;
  process_progress: string;
}

export interface ReportFormValues {
  id: string | null;
  work_date: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  notes: string;
  support_request: string;
  next_day_plan: string;
  items: Omit<ItemState, "key">[];
}

// 서버 렌더링과 브라우저에서 같은 키가 나오도록 초기 항목은 순번으로, 추가 항목은 난수로 키를 만든다
const newItem = (key: string = crypto.randomUUID()): ItemState => ({
  key, id: null, process_id: "", task_id: "", content: "", result: "", quantity: "", unit: "",
  status: "in_progress", task_progress: "", process_progress: "",
});
const isBlank = (i: ItemState) =>
  !i.content.trim() && !i.result.trim() && !i.quantity && !i.process_id && !i.task_id && !i.process_progress;

export function ReportForm({
  projectId,
  initial,
  initialPhotos,
  options,
  today,
  revisionComment,
}: {
  projectId: string;
  initial: ReportFormValues;
  initialPhotos: PhotoView[];
  options: FormOptions;
  today: string;
  revisionComment?: string | null;
}) {
  const router = useRouter();
  const [reportId, setReportId] = useState(initial.id);
  const [values, setValues] = useState({
    work_date: initial.work_date,
    start_time: initial.start_time,
    end_time: initial.end_time,
    break_minutes: String(initial.break_minutes),
    notes: initial.notes,
    support_request: initial.support_request,
    next_day_plan: initial.next_day_plan,
  });
  const [items, setItems] = useState<ItemState[]>(
    initial.items.length ? initial.items.map((i, index) => ({ ...i, key: i.id ?? `init-${index}` })) : [newItem("init-0")],
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // 최신 상태를 사진 업로드(비동기)에서도 읽을 수 있게 보관한다
  const latest = useRef({ reportId, values, items });
  useEffect(() => {
    latest.current = { reportId, values, items };
  });

  const set = <K extends keyof typeof values>(key: K, value: string) => setValues((v) => ({ ...v, [key]: value }));
  const setItem = (key: string, patch: Partial<ItemState>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const minutes = workMinutes(values.start_time, values.end_time, Number(values.break_minutes) || 0);

  // 저장은 한 번에 하나씩 한다. 임시저장과 사진 첨부의 자동 임시저장이 겹치면 새 작업일보를
  // 두 번 만들려다 "해당 날짜의 작업일보가 이미 있습니다"로 실패한다.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  function persist(submit: boolean): Promise<string | null> {
    const run = queue.current.then(() => persistNow(submit));
    queue.current = run.catch(() => null);
    return run;
  }

  async function persistNow(submit: boolean): Promise<string | null> {
    const current = latest.current;
    const filled = current.items.filter((i) => !isBlank(i));
    const input: SaveReportInput = {
      ...current.values,
      break_minutes: current.values.break_minutes === "" ? 0 : Number(current.values.break_minutes),
      items: filled.map(({ key: _key, ...item }) => item),
    };
    const result = await saveReport(current.reportId, input, submit);
    if (!result.ok) {
      setError(result.error);
      setNotice(null);
      return null;
    }
    const { id, itemIds } = result.data!;
    setError(null);
    setReportId(id);
    // 다음 렌더 전에 이어지는 저장(대기열)도 같은 작업일보를 고치게 한다
    latest.current = { ...latest.current, reportId: id };
    // 저장된 작업내역의 id 를 반영해 다음 저장 때 같은 행을 수정하게 한다
    setItems((list) => {
      let n = 0;
      const next = list.map((i) => (isBlank(i) ? i : { ...i, id: itemIds[n++] ?? i.id }));
      return next;
    });
    // 주소는 바꾸지 않는다. 새로 고치면 /reports/new 가 저장된 작업일보의 수정 화면으로 이동시킨다.
    return id;
  }

  function onSave(submit: boolean) {
    if (submit && !confirm("제출하면 관리자 검토 전까지 수정할 수 없습니다. 제출할까요?")) return;
    startTransition(async () => {
      const id = await persist(submit);
      if (!id) return;
      if (submit) {
        router.push(workHref(`/reports/${id}`));
        router.refresh();
      } else {
        setNotice("임시저장했습니다.");
      }
    });
  }

  return (
    <form className="space-y-4 pb-28 lg:pb-0" onSubmit={(e) => e.preventDefault()}>
      {revisionComment && (
        <div className="rounded-xl border px-4 py-3 text-sm dw-tone-amber dw-line">
          <p className="font-semibold">관리자 보완 요청</p>
          <p className="mt-1 whitespace-pre-wrap">{revisionComment}</p>
        </div>
      )}

      <Card>
        <CardHeader title="작업 시간" />
        <CardBody className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="작업일" htmlFor="work_date" required className="col-span-2 md:col-span-1">
            <Input id="work_date" type="date" max={today} value={values.work_date} onChange={(e) => set("work_date", e.target.value)} />
          </Field>
          <Field label="시작시간" htmlFor="start_time" required>
            <Input id="start_time" type="time" value={values.start_time} onChange={(e) => set("start_time", e.target.value)} />
          </Field>
          <Field label="종료시간" htmlFor="end_time" required>
            <Input id="end_time" type="time" value={values.end_time} onChange={(e) => set("end_time", e.target.value)} />
          </Field>
          <Field label="휴게시간(분)" htmlFor="break_minutes" required>
            <Input id="break_minutes" type="number" inputMode="numeric" min={0} max={600} step={10} value={values.break_minutes} onChange={(e) => set("break_minutes", e.target.value)} />
          </Field>
          <div className="col-span-2 flex items-center justify-between rounded-lg bg-brand-a10 px-3 py-2.5 md:col-span-4">
            <span className="text-sm text-brand-fg">실제 작업시간</span>
            <span data-testid="work-minutes" className={cn("text-base font-bold", minutes != null && minutes > 0 ? "text-brand-fg" : "dw-fg-red")}>
              {minutes != null && minutes > 0 ? formatMinutes(minutes) : "시간을 확인해 주세요"}
            </span>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="작업내역" description="공정별로 나누어 여러 건을 등록할 수 있습니다." />
        <CardBody className="space-y-4">
          {items.map((item, index) => {
            const tasks = options.tasks.filter((t) => !item.process_id || !t.process_id || t.process_id === item.process_id);
            return (
              <fieldset key={item.key} className="rounded-xl border border-border p-3 md:p-4" data-testid="report-item">
                <legend className="sr-only">작업내역 {index + 1}</legend>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-brand-fg">작업내역 {index + 1}</span>
                  {items.length > 1 && (
                    <Button variant="ghost" size="sm" className="dw-fg-red" onClick={() => setItems((list) => list.filter((i) => i.key !== item.key))}>
                      <Trash2 /> 삭제
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="공정" htmlFor={`process-${item.key}`}>
                    <Select id={`process-${item.key}`} value={item.process_id} onChange={(e) => setItem(item.key, { process_id: e.target.value })}>
                      <option value="">선택 안 함</option>
                      {options.processes.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="배정 업무" htmlFor={`task-${item.key}`}>
                    <Select
                      id={`task-${item.key}`}
                      value={item.task_id}
                      onChange={(e) => {
                        const task = options.tasks.find((t) => t.id === e.target.value);
                        setItem(item.key, {
                          task_id: e.target.value,
                          process_id: task?.process_id ?? item.process_id,
                          task_progress: task ? String(task.progress) : "",
                        });
                      }}
                    >
                      <option value="">선택 안 함</option>
                      {tasks.map((t) => (
                        <option key={t.id} value={t.id}>{t.title}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="작업내용" htmlFor={`content-${item.key}`} required className="md:col-span-2">
                    <Textarea id={`content-${item.key}`} rows={2} maxLength={2000} placeholder="예) A동 기둥 세우기" value={item.content} onChange={(e) => setItem(item.key, { content: e.target.value })} />
                  </Field>
                  <Field label="작업실적" htmlFor={`result-${item.key}`} className="md:col-span-2">
                    <Textarea id={`result-${item.key}`} rows={2} maxLength={2000} placeholder="예) 기둥 8본 설치 완료" value={item.result} onChange={(e) => setItem(item.key, { result: e.target.value })} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="수량" htmlFor={`quantity-${item.key}`}>
                      <Input id={`quantity-${item.key}`} type="number" inputMode="decimal" min={0} step="any" value={item.quantity} onChange={(e) => setItem(item.key, { quantity: e.target.value })} />
                    </Field>
                    <Field label="단위" htmlFor={`unit-${item.key}`}>
                      <Input id={`unit-${item.key}`} maxLength={20} placeholder="m, 본, ㎡" value={item.unit} onChange={(e) => setItem(item.key, { unit: e.target.value })} />
                    </Field>
                  </div>
                  <div>
                    <span className="mb-1.5 block text-sm font-medium text-foreground">진행상태</span>
                    <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="진행상태">
                      {(Object.keys(ITEM_STATUS) as ItemStatus[]).map((status) => (
                        <button
                          key={status}
                          type="button"
                          role="radio"
                          aria-checked={item.status === status}
                          onClick={() => setItem(item.key, { status })}
                          className={cn(
                            "h-11 rounded-lg border text-sm font-semibold md:h-10",
                            item.status === status ? "border-brand bg-brand text-white" : "border-border bg-card text-foreground",
                          )}
                        >
                          {ITEM_STATUS[status].label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {item.task_id && (
                    <Field label="업무 진행률(%)" htmlFor={`task-progress-${item.key}`} hint="배정 업무의 누계 진행률">
                      <Input id={`task-progress-${item.key}`} type="number" inputMode="numeric" min={0} max={100} value={item.task_progress} onChange={(e) => setItem(item.key, { task_progress: e.target.value })} />
                    </Field>
                  )}
                  {item.process_id && (
                    <Field label="공정 누계 실적률(%)" htmlFor={`process-progress-${item.key}`} hint="선택 입력. 승인되면 공정률에 반영됩니다.">
                      <Input id={`process-progress-${item.key}`} type="number" inputMode="decimal" min={0} max={100} step="0.1" value={item.process_progress} onChange={(e) => setItem(item.key, { process_progress: e.target.value })} />
                    </Field>
                  )}
                </div>
              </fieldset>
            );
          })}
          <Button variant="outline" className="w-full" onClick={() => setItems((list) => [...list, newItem()])}>
            <Plus /> 작업내역 추가
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="현장 사진" />
        <CardBody>
          <PhotoUploader
            projectId={projectId}
            initial={initialPhotos}
            ensureReportId={async () => latest.current.reportId ?? (await persist(false))}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="특이사항 및 계획" />
        <CardBody className="space-y-3">
          <Field label="특이사항" htmlFor="notes">
            <Textarea id="notes" rows={2} maxLength={2000} placeholder="안전, 품질, 자재, 기상 등 특이사항" value={values.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
          <Field label="지원 요청사항" htmlFor="support_request">
            <Textarea id="support_request" rows={2} maxLength={2000} placeholder="인력, 장비, 자재, 의사결정 등" value={values.support_request} onChange={(e) => set("support_request", e.target.value)} />
          </Field>
          <Field label="익일 작업계획" htmlFor="next_day_plan">
            <Textarea id="next_day_plan" rows={2} maxLength={2000} value={values.next_day_plan} onChange={(e) => set("next_day_plan", e.target.value)} />
          </Field>
        </CardBody>
      </Card>

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-card/95 px-4 py-2.5 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
        <div className="space-y-2">
          <FormError message={error} />
          {!error && <FormNotice message={notice} />}
          <div className="grid grid-cols-2 gap-2 lg:flex lg:justify-end">
            <Button variant="outline" size="lg" disabled={pending} onClick={() => onSave(false)}>
              임시저장
            </Button>
            <Button size="lg" disabled={pending} onClick={() => onSave(true)}>
              {pending ? "처리 중…" : "제출"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
