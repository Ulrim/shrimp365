"use client";

import { CheckCheck, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markAllNotificationsRead, markNotificationRead } from "@/app/(dashboard)/daumlabs/work/(app)/notifications/actions";
import { Button } from "@/components/work/ui/button";
import { Card } from "@/components/work/ui/card";
import { FormError } from "@/components/work/ui/form";
import { EmptyState } from "@/components/work/ui/misc";
import { workHref } from "@/lib/work/constants";
import { cn } from "@/lib/utils";

export interface NotificationView {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  /** 서버에서 만든 표시용 시각 (예: 5분 전) */
  when: string;
  at: string;
}

export function NotificationList({ items }: { items: NotificationView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const unread = items.filter((n) => !n.is_read).length;

  function open(item: NotificationView) {
    startTransition(async () => {
      if (!item.is_read) {
        const result = await markNotificationRead(item.id);
        if (!result.ok) return setError(result.error);
      }
      setError(null);
      // 내부 경로만 이동한다. 알림 링크는 원본 경로("/tasks")로 저장되므로 현장관리 접두사를 붙인다
      if (item.link && item.link.startsWith("/") && !item.link.startsWith("//")) router.push(workHref(item.link));
      else router.refresh();
    });
  }

  function readAll() {
    startTransition(async () => {
      const result = await markAllNotificationsRead();
      if (!result.ok) return setError(result.error);
      setError(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" data-testid="unread-summary">
          읽지 않은 알림 <strong className="text-foreground">{unread}</strong>건
        </p>
        <Button variant="outline" size="sm" disabled={pending || unread === 0} onClick={readAll}>
          <CheckCheck /> 모두 읽음
        </Button>
      </div>
      <FormError message={error} />
      <Card>
        {items.length === 0 ? (
          <EmptyState title="알림이 없습니다" description="업무 배정, 작업일보 검토 결과 등이 여기에 표시됩니다." />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => open(item)}
                  data-read={item.is_read}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-accent active:bg-accent",
                    !item.is_read && "bg-brand-a5",
                  )}
                >
                  <span
                    className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.is_read ? "bg-muted-foreground/40" : "bg-red-500")}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[15px] text-foreground", item.is_read ? "font-medium" : "font-semibold")}>
                      {item.title}
                      {!item.is_read && <span className="sr-only"> (읽지 않음)</span>}
                    </span>
                    {item.body && <span className="mt-0.5 block break-words text-sm text-muted-foreground">{item.body}</span>}
                    <span className="mt-1 block text-xs text-muted-foreground" title={item.at}>
                      {item.when}
                    </span>
                  </span>
                  {item.link && <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
