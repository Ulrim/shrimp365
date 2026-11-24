import Link from "next/link";
import { redirect } from "next/navigation";
import { WORK_BASE } from "@/lib/work/constants";
import { createClient } from "@/lib/work/supabase/server";

/**
 * 현장관리 구성원이 아닌 계정에게 보여 주는 안내. (app) 그룹 밖이라 세션 레이아웃을 타지 않는다
 * (타면 getSession 이 다시 이곳으로 보내 무한 이동이 된다).
 */
export default async function NotInvitedPage({ searchParams }: { searchParams: Promise<{ reason?: string | string[] }> }) {
  const { reason } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const inactive = reason === "inactive";
  const unverified = !user.email_confirmed_at;

  return (
    <div className="dw-root mx-auto mt-10 w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center">
      <h1 className="text-lg font-semibold text-foreground">
        {inactive ? "현장관리 사용이 중지된 계정입니다" : "현장관리는 초대받은 계정만 사용할 수 있습니다"}
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">로그인 계정</p>
      <p className="mt-1 break-all text-sm font-semibold text-foreground">{user.email ?? "-"}</p>

      {inactive ? (
        <p className="mt-4 text-sm text-muted-foreground">
          관리자가 이 계정의 현장관리 사용을 중지했습니다. 다시 사용하려면 현장관리자 또는 경영진에게 문의해 주세요.
        </p>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          현장관리자 또는 경영진에게 위 이메일 주소로 초대를 요청해 주세요. 초대가 등록되면 아래 버튼으로 바로 들어올 수 있습니다.
        </p>
      )}

      {!inactive && unverified && (
        <p className="mt-3 rounded-xl border border-border bg-muted px-3 py-2 text-sm text-foreground">
          이메일 인증이 끝나지 않았습니다. 가입 때 받은 인증 메일의 링크를 먼저 눌러 주세요. 인증된 이메일로 온 초대만 수락됩니다.
        </p>
      )}

      <Link
        href={WORK_BASE}
        prefetch={false}
        className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-brand px-5 text-sm font-semibold text-white"
      >
        다시 확인
      </Link>
    </div>
  );
}
