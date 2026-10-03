/*
 * 원본: mrv-platform/apps/web/src/features/control-console/control-console-meta.ts
 * 표시 전용 메타데이터/순수 함수라 그대로 옮겼다. 바꾼 것은 두 가지뿐이다:
 *   - import 경로(@/types/api → @/lib/mrv/api-types)
 *   - 디자인 토큰 클래스 이름(signal-*, fg/surface/... → mrv-* 네임스페이스)
 */
import type { ControlActionStatus, ControlActionStatusFilter } from "@/lib/mrv/api-types";

/*
 * 승인형 제어 콘솔 표시 메타데이터(phase-3 3절, MASTER 화면11). 라벨/뱃지 색상만 담는다
 * (상태 전이 규칙 자체는 서버가 최종 강제 — 여기는 표시용 상수뿐, 재계산 아님).
 */

export const CONTROL_ACTION_STATUS_LABEL: Record<ControlActionStatus, string> = {
  pending: "대기중",
  approved: "승인됨",
  rejected: "거부됨",
  applied: "적용됨",
};

export const CONTROL_ACTION_STATUS_FILTERS: Array<{
  value: ControlActionStatusFilter;
  label: string;
}> = [
  { value: "pending", label: "대기중" },
  { value: "approved", label: "승인됨" },
  { value: "rejected", label: "거부됨" },
  { value: "applied", label: "적용됨" },
  { value: "all", label: "전체" },
];

export const CONTROL_ACTION_STATUS_BADGE_CLASS: Record<ControlActionStatus, string> = {
  pending: "bg-mrv-amber-bg text-mrv-amber",
  approved: "bg-mrv-na-bg text-mrv-fg",
  rejected: "bg-mrv-red-bg text-mrv-red",
  applied: "bg-mrv-green-bg text-mrv-green",
};
