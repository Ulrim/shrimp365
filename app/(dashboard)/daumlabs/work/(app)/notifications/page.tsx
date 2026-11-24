import type { Metadata } from "next";
import { NotificationList } from "@/components/work/notifications/notification-list";
import { PageHeader } from "@/components/work/ui/misc";
import { formatDateTime } from "@/lib/work/dates";
import { getSession } from "@/lib/work/session";
import type { Notification } from "@/lib/work/types";

export const metadata: Metadata = { title: "알림" };

function relative(value: string, now: number): string {
  const minutes = Math.floor((now - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}시간 전`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}일 전`;
  return formatDateTime(value);
}

export default async function NotificationsPage() {
  const { supabase, userId } = await getSession();
  const { data } = await supabase
    .from("dw_notifications")
    .select("id, type, title, body, link, is_read, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<Notification[]>();
  // eslint-disable-next-line react-hooks/purity -- 서버에서 요청마다 한 번 계산하는 기준 시각
  const now = Date.now();

  return (
    <>
      <PageHeader title="알림" description="최근 100건까지 표시합니다." />
      <NotificationList
        items={(data ?? []).map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          link: n.link,
          is_read: n.is_read,
          when: relative(n.created_at, now),
          at: formatDateTime(n.created_at),
        }))}
      />
    </>
  );
}
