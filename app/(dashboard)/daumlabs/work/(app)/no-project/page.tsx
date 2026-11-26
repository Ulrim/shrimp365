import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardBody } from "@/components/work/ui/card";
import { workHref } from "@/lib/work/constants";
import { getSession } from "@/lib/work/session";

export default async function NoProjectPage() {
  const session = await getSession();
  if (session.project && session.role) redirect(workHref("/dashboard"));
  return (
    <Card className="mx-auto mt-10 max-w-md">
      <CardBody className="text-center">
        <h1 className="text-lg font-semibold text-foreground">배정된 사업장이 없습니다</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {session.isExecutive
            ? "사업장 관리에서 첫 사업장을 등록해 주세요."
            : "현장관리자에게 사업장 배정을 요청해 주세요."}
        </p>
        {session.isExecutive && (
          <Link href={workHref("/admin/projects")} className="mt-4 inline-block font-semibold text-brand-fg underline">
            사업장 관리로 이동
          </Link>
        )}
      </CardBody>
    </Card>
  );
}
