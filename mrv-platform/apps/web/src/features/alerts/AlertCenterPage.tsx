import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSiteAlerts } from "@/hooks/useSiteAlerts";
import { useAckAlert } from "@/hooks/useAckAlert";
import { useUpdateAlertSubscriptions } from "@/hooks/useUpdateAlertSubscriptions";
import { ApiError } from "@/lib/api-client";
import { formatIsoLocal } from "@/lib/datetime";
import {
  ALERT_SEVERITY_BADGE_CLASS,
  ALERT_SEVERITY_LABEL,
  ALERT_STATUS_LABEL,
  ALERT_TYPE_LABEL,
  summarizeAlertPayload,
} from "@/lib/alert-meta";
import type { AlertItem, AlertStatusFilter, AlertType } from "@/types/api";

/*
 * 알림 센터 화면(MASTER 화면5, phase-2 슬라이스 H-FE, START 포함 전체 플랜).
 * 흐름: 상태 필터(open/ack/all) → 목록 조회(GET /alerts) → owner/operator만 ack 가능.
 * 구독 스위치(1.7절)는 PATCH-only 계약이라 GET 엔드포인트가 없다 — 로컬 상태(기본 전체 on)로
 * 관리하고, 서버에 반영된 마지막 응답으로 갱신한다(미해결 이슈: 최종 요약 참고).
 */

const DEMO_SITE_ID = import.meta.env.VITE_DEMO_SITE_ID ?? "demo-site";

const STATUS_FILTERS: Array<{ value: AlertStatusFilter; label: string }> = [
  { value: "open", label: "미확인" },
  { value: "ack", label: "확인됨" },
  { value: "all", label: "전체" },
];

const SUBSCRIPTION_TYPES: AlertType[] = ["do_low", "mortality_spike", "kpi_red"];

export function AlertCenterPage() {
  const siteId = DEMO_SITE_ID;
  const { canWriteLogs, isViewer } = useAuth();

  const [statusFilter, setStatusFilter] = useState<AlertStatusFilter>("open");
  const alertsQuery = useSiteAlerts(siteId, statusFilter);
  const ackMutation = useAckAlert();

  const [subscriptions, setSubscriptions] = useState<Record<AlertType, boolean>>({
    do_low: true,
    mortality_spike: true,
    kpi_red: true,
  });
  const subscriptionMutation = useUpdateAlertSubscriptions(siteId);

  function handleAck(alert: AlertItem) {
    if (alert.status === "ack") return;
    const ok = window.confirm(
      `"${ALERT_TYPE_LABEL[alert.type]}" 알림을 확인 처리하시겠습니까?`,
    );
    if (!ok) return;
    ackMutation.mutate(alert.id);
  }

  function handleToggleSubscription(type: AlertType) {
    const next = !subscriptions[type];
    setSubscriptions((prev) => ({ ...prev, [type]: next }));
    subscriptionMutation.mutate(
      { [type]: next },
      {
        onError: () => {
          // 실패 시 로컬 표시를 원복(서버 반영 실패는 재계산이 아니라 단순 롤백).
          setSubscriptions((prev) => ({ ...prev, [type]: !next }));
        },
      },
    );
  }

  return (
    <PageShell>
      <section
        aria-label="알림 상태 필터"
        className="flex flex-wrap items-center gap-2"
      >
        {STATUS_FILTERS.map((f) => (
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

      {/* --- 로딩/에러/빈 상태 --- */}
      {alertsQuery.isLoading && (
        <div
          role="status"
          aria-label="알림 목록 불러오는 중"
          className="h-32 animate-pulse rounded-card border border-border bg-surface"
        />
      )}
      {alertsQuery.isError && (
        <p role="alert" className="text-sm text-signal-red">
          {alertsQuery.error instanceof ApiError && alertsQuery.error.isUnauthorized
            ? "인증이 만료되었습니다. 다시 로그인해 주세요."
            : "알림 목록을 불러오지 못했습니다."}
        </p>
      )}
      {alertsQuery.data && alertsQuery.data.items.length === 0 && (
        <p role="status" className="rounded-card border border-border bg-surface p-6 text-sm text-muted">
          해당 상태의 알림이 없습니다.
        </p>
      )}

      {alertsQuery.data && alertsQuery.data.items.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label="알림 목록">
          {alertsQuery.data.items.map((alert) => (
            <li
              key={alert.id}
              className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-fg">
                    {ALERT_TYPE_LABEL[alert.type]}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${ALERT_SEVERITY_BADGE_CLASS[alert.severity]}`}
                  >
                    <span aria-hidden="true">
                      {alert.severity === "critical"
                        ? "⚠"
                        : alert.severity === "warning"
                          ? "⚡"
                          : "ℹ"}
                    </span>
                    {ALERT_SEVERITY_LABEL[alert.severity]}
                  </span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                    {ALERT_STATUS_LABEL[alert.status]}
                  </span>
                </div>
                <p className="text-sm text-muted">
                  {summarizeAlertPayload(alert.type, alert.payload)}
                </p>
                <p className="text-xs text-muted">
                  발생 {formatIsoLocal(alert.created_at)}
                  {alert.status === "ack" &&
                    ` · 확인 ${formatIsoLocal(alert.acked_at)}${alert.acked_by ? ` (${alert.acked_by})` : ""}`}
                </p>
              </div>

              {/* ack 버튼: owner/operator만. viewer는 숨김(조회만). */}
              {!isViewer && (
                <button
                  type="button"
                  onClick={() => handleAck(alert)}
                  disabled={
                    !canWriteLogs || alert.status === "ack" || ackMutation.isPending
                  }
                  className="self-start rounded-md border border-primary px-3 py-1.5 text-sm font-medium text-primary hover:bg-bg disabled:cursor-not-allowed disabled:border-border disabled:text-muted disabled:opacity-60"
                >
                  {alert.status === "ack" ? "확인 완료" : "확인 처리"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {ackMutation.isError && (
        <p role="alert" className="text-sm text-signal-red">
          알림 확인 처리에 실패했습니다.
        </p>
      )}

      {/* --- 구독 설정(1.7절) --- */}
      <section
        aria-label="알림 구독 설정"
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5"
      >
        <h2 className="text-base font-semibold text-fg">알림 구독 설정</h2>
        <p className="text-xs text-muted">
          채널(이메일/SMS)은 미지원 — 앱 내 알림 센터 표시 여부만 제어합니다.
        </p>
        <ul className="flex flex-col gap-2">
          {SUBSCRIPTION_TYPES.map((type) => (
            <li key={type} className="flex items-center justify-between gap-3">
              <div>
                <span className="text-sm text-fg">{ALERT_TYPE_LABEL[type]}</span>
                {!subscriptions[type] && (
                  <p className="text-xs text-muted">
                    해당 유형 알림이 생성되지 않습니다.
                  </p>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={subscriptions[type]}
                aria-label={`${ALERT_TYPE_LABEL[type]} 알림 ${subscriptions[type] ? "끄기" : "켜기"}`}
                disabled={!canWriteLogs}
                onClick={() => handleToggleSubscription(type)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  subscriptions[type] ? "bg-primary" : "bg-border"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                    subscriptions[type] ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </li>
          ))}
        </ul>
        {isViewer && (
          <p role="note" className="text-xs text-muted">
            읽기 전용 권한(viewer)입니다. 구독 설정 변경은 owner/operator만 가능합니다.
          </p>
        )}
      </section>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-fg">알림 센터</h1>
        <p className="text-sm text-muted">
          사이트 {DEMO_SITE_ID} · DO 저하 · 폐사 급증 · KPI 위험(red) 알림
        </p>
      </header>
      {children}
    </div>
  );
}
