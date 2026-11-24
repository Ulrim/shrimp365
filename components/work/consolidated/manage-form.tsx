"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveConsolidated } from "@/app/(app)/consolidated/actions";
import { Button } from "@/components/work/ui/button";
import { Field, FormError, FormNotice, Input, Textarea } from "@/components/work/ui/form";

export function ConsolidatedManageForm({
  date,
  weather,
  summary,
  finalized,
}: {
  date: string;
  weather: string;
  summary: string;
  finalized: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState({ weather, summary });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(finalize: boolean, message: string, ask?: string) {
    if (ask && !confirm(ask)) return;
    startTransition(async () => {
      const result = await saveConsolidated({ date, ...values, finalize });
      if (!result.ok) {
        setNotice(null);
        return setError(result.error);
      }
      setError(null);
      setNotice(message);
      router.refresh();
    });
  }

  return (
    <form className="no-print space-y-3" onSubmit={(e) => e.preventDefault()} data-testid="consolidated-form">
      <Field label="날씨" htmlFor="weather">
        <Input id="weather" maxLength={50} placeholder="예) 맑음, 최고 12℃" disabled={finalized} value={values.weather} onChange={(e) => setValues((v) => ({ ...v, weather: e.target.value }))} />
      </Field>
      <Field label="관리자 종합 의견" htmlFor="summary">
        <Textarea id="summary" rows={3} maxLength={2000} disabled={finalized} value={values.summary} onChange={(e) => setValues((v) => ({ ...v, summary: e.target.value }))} />
      </Field>
      <FormError message={error} />
      {!error && <FormNotice message={notice} />}
      {finalized ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="dangerOutline"
            disabled={pending}
            onClick={() => save(false, "확정을 해제하고 최신 승인 내용으로 다시 취합했습니다.", "확정을 해제하면 최신 승인 내용으로 다시 취합됩니다. 해제할까요?")}
          >
            확정 해제
          </Button>
          <p className="text-xs text-muted-foreground">확정된 통합 작업일보는 이후 승인 내용이 반영되지 않습니다.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:flex">
          <Button variant="outline" disabled={pending} onClick={() => save(false, "저장하고 최신 승인 내용으로 취합했습니다.")}>
            저장 및 재취합
          </Button>
          <Button disabled={pending} onClick={() => save(true, "통합 작업일보를 확정했습니다.", "확정하면 이후 승인되는 작업일보가 반영되지 않습니다. 확정할까요?")}>
            {pending ? "처리 중…" : "확정"}
          </Button>
        </div>
      )}
    </form>
  );
}
