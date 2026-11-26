"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteProcess, saveProcess } from "@/app/(dashboard)/daumlabs/work/(app)/progress/actions";
import { Button } from "@/components/work/ui/button";
import { Dialog, DialogContent } from "@/components/work/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/work/ui/form";
import type { Process } from "@/lib/work/types";

const text = (v: string | number | null | undefined) => (v == null ? "" : String(v));

/** 공정 등록(process 없음)·수정 대화상자 */
export function ProcessDialog({ process, nextOrder, today }: { process?: Process; nextOrder?: number; today: string }) {
  const router = useRouter();
  const initial = () => ({
    name: process?.name ?? "",
    description: process?.description ?? "",
    sort_order: text(process?.sort_order ?? nextOrder ?? 1),
    weight: text(process ? Number(process.weight) : 10),
    planned_start: process?.planned_start ?? today,
    planned_end: process?.planned_end ?? today,
    actual_start: process?.actual_start ?? "",
    actual_end: process?.actual_end ?? "",
    progress: text(process ? Number(process.progress) : 0),
  });
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof ReturnType<typeof initial>, value: string) => setValues((v) => ({ ...v, [key]: value }));

  function onOpenChange(next: boolean) {
    if (next) {
      setValues(initial());
      setError(null);
    }
    setOpen(next);
  }

  function done() {
    setOpen(false);
    router.refresh();
  }

  function onSave() {
    if (values.weight === "" || values.progress === "") return setError("가중치와 실적률을 입력해 주세요.");
    startTransition(async () => {
      const result = await saveProcess(process?.id ?? null, values);
      if (!result.ok) return setError(result.error);
      done();
    });
  }

  function onDelete() {
    if (!process || !confirm(`'${process.name}' 공정을 삭제할까요?\n연결된 업무·작업내역의 공정 정보는 비워집니다.`)) return;
    startTransition(async () => {
      const result = await deleteProcess(process.id);
      if (!result.ok) return setError(result.error);
      done();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {process ? (
        <Button variant="ghost" size="sm" aria-label={`${process.name} 수정`} onClick={() => onOpenChange(true)}>
          <Pencil /> 수정
        </Button>
      ) : (
        <Button onClick={() => onOpenChange(true)}>
          <Plus /> 공정 등록
        </Button>
      )}
      <DialogContent title={process ? "공정 수정" : "공정 등록"} description="전체 공정률은 가중치 비율로 계산됩니다.">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
          <Field label="공정명" htmlFor="process-name" required>
            <Input id="process-name" maxLength={100} value={values.name} onChange={(e) => set("name", e.target.value)} required />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="가중치" htmlFor="process-weight" required>
              <Input id="process-weight" type="number" inputMode="decimal" min={0} step="any" value={values.weight} onChange={(e) => set("weight", e.target.value)} />
            </Field>
            <Field label="실적률(%)" htmlFor="process-progress" required>
              <Input id="process-progress" type="number" inputMode="decimal" min={0} max={100} step="0.1" value={values.progress} onChange={(e) => set("progress", e.target.value)} />
            </Field>
            <Field label="표시 순서" htmlFor="process-order">
              <Input id="process-order" type="number" inputMode="numeric" min={0} value={values.sort_order} onChange={(e) => set("sort_order", e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="계획 시작일" htmlFor="process-planned-start" required>
              <Input id="process-planned-start" type="date" value={values.planned_start} onChange={(e) => set("planned_start", e.target.value)} required />
            </Field>
            <Field label="계획 종료일" htmlFor="process-planned-end" required>
              <Input id="process-planned-end" type="date" value={values.planned_end} onChange={(e) => set("planned_end", e.target.value)} required />
            </Field>
            <Field label="실제 시작일" htmlFor="process-actual-start">
              <Input id="process-actual-start" type="date" value={values.actual_start} onChange={(e) => set("actual_start", e.target.value)} />
            </Field>
            <Field label="실제 종료일" htmlFor="process-actual-end">
              <Input id="process-actual-end" type="date" value={values.actual_end} onChange={(e) => set("actual_end", e.target.value)} />
            </Field>
          </div>
          <Field label="설명" htmlFor="process-description">
            <Textarea id="process-description" rows={2} maxLength={1000} value={values.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <FormError message={error} />
          <div className="flex gap-2 pt-1">
            {process && (
              <Button variant="dangerOutline" size="lg" disabled={pending} onClick={onDelete}>
                삭제
              </Button>
            )}
            <Button variant="outline" size="lg" className="ml-auto" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? "저장 중…" : "저장"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
