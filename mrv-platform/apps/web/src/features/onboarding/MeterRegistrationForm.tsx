import { useId, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCreateMeter } from "@/hooks/useCreateMeter";
import { ApiError } from "@/lib/api-client";
import type { MeterCreateRequest, MeterType } from "@/types/api";

/*
 * 계측기(meter) 등록 폼(센서 매핑 단계, phase-3 7.2절). type/unit/is_aeration/label 입력 →
 * POST /sites/{siteId}/meters. viewer는 비활성(require_writer가 최종 방어선).
 * tank_id/certification_info는 선택 입력(자유 텍스트 — 별도 tank 목록 조회 API는 이번 계약
 * 범위 밖이므로 직접 입력으로 충분, 과설계 금지).
 */

const METER_TYPE_OPTIONS: MeterType[] = ["power", "do", "temp", "ph", "orp", "ec"];
const METER_TYPE_LABEL: Record<MeterType, string> = {
  power: "전력",
  do: "용존산소(DO)",
  temp: "수온",
  ph: "pH",
  orp: "ORP",
  ec: "전기전도도(EC)",
};

export function MeterRegistrationForm({ siteId }: { siteId: string }) {
  const { canWriteLogs, isViewer } = useAuth();
  const mutation = useCreateMeter(siteId);

  const typeId = useId();
  const unitId = useId();
  const labelId = useId();
  const tankId = useId();
  const certId = useId();

  const [type, setType] = useState<MeterType>("power");
  const [unit, setUnit] = useState("");
  const [isAeration, setIsAeration] = useState(false);
  const [label, setLabel] = useState("");
  const [tank, setTank] = useState("");
  const [certificationInfo, setCertificationInfo] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const disabled = !canWriteLogs || mutation.isPending;

  function validate(): MeterCreateRequest | null {
    if (!unit.trim()) {
      setFieldError("단위(unit)를 입력하세요.");
      return null;
    }
    if (!label.trim()) {
      setFieldError("라벨(label)을 입력하세요.");
      return null;
    }
    setFieldError(null);
    const trimmedCert = certificationInfo.trim();
    return {
      type,
      unit: unit.trim(),
      is_aeration: isAeration,
      tank_id: tank.trim() || null,
      label: label.trim(),
      // 백엔드 스키마는 certification_info를 자유 JSON 객체로 받는다(자유 텍스트 아님,
      // MASTER 9장 규제훅 "자리만"). 입력 폼은 자유 텍스트 UX를 유지하고 여기서만 감싼다.
      certification_info: trimmedCert ? { note: trimmedCert } : null,
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const body = validate();
    if (!body) return;
    mutation.mutate(body, {
      onSuccess: () => {
        setUnit("");
        setLabel("");
        setTank("");
        setCertificationInfo("");
        setIsAeration(false);
      },
    });
  }

  const serverError =
    mutation.isError && mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.isError
        ? "계측기 등록에 실패했습니다."
        : null;

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="계측기 등록 폼"
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
    >
      {isViewer && (
        <p role="note" className="rounded-md bg-signal-na-bg px-3 py-2 text-xs text-muted">
          읽기 전용 권한(viewer)입니다. 계측기 등록은 owner/operator만 가능합니다.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={typeId} className="text-xs font-medium text-fg">
            종류 <span className="text-signal-red">*</span>
          </label>
          <select
            id={typeId}
            value={type}
            disabled={disabled}
            onChange={(e) => setType(e.target.value as MeterType)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg disabled:opacity-60"
          >
            {METER_TYPE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {METER_TYPE_LABEL[opt]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={unitId} className="text-xs font-medium text-fg">
            단위(unit) <span className="text-signal-red">*</span>
          </label>
          <input
            id={unitId}
            type="text"
            value={unit}
            disabled={disabled}
            placeholder="예: kWh_interval, mg_l"
            onChange={(e) => setUnit(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg disabled:opacity-60"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={labelId} className="text-xs font-medium text-fg">
            라벨(label) <span className="text-signal-red">*</span>
          </label>
          <input
            id={labelId}
            type="text"
            value={label}
            disabled={disabled}
            placeholder="예: 1호 수조 메인 전력계"
            onChange={(e) => setLabel(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg disabled:opacity-60"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={tankId} className="text-xs font-medium text-fg">
            수조 ID(선택)
          </label>
          <input
            id={tankId}
            type="text"
            value={tank}
            disabled={disabled}
            onChange={(e) => setTank(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg disabled:opacity-60"
          />
        </div>

        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor={certId} className="text-xs font-medium text-fg">
            인증정보(선택, KCC/KC 등)
          </label>
          <input
            id={certId}
            type="text"
            value={certificationInfo}
            disabled={disabled}
            onChange={(e) => setCertificationInfo(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg disabled:opacity-60"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          checked={isAeration}
          disabled={disabled}
          onChange={(e) => setIsAeration(e.target.checked)}
        />
        폭기(aeration) 설비 전력계입니다
      </label>

      {fieldError && (
        <p role="alert" className="text-sm text-signal-red">
          {fieldError}
        </p>
      )}
      {serverError && (
        <p role="alert" className="text-sm text-signal-red">
          {serverError}
        </p>
      )}
      {mutation.isSuccess && (
        <p role="status" className="text-sm text-signal-green">
          계측기가 등록되었습니다.
        </p>
      )}

      <button
        type="submit"
        disabled={disabled}
        className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {mutation.isPending ? "등록 중…" : "계측기 등록"}
      </button>
    </form>
  );
}
