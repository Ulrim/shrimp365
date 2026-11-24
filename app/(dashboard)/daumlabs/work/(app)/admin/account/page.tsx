import type { Metadata } from "next";
import { AccountForm } from "@/components/work/admin/account-form";
import { PageHeader } from "@/components/work/ui/misc";
import { GLOBAL_ROLE_LABEL, ROLE_LABEL } from "@/lib/work/constants";
import { getSession } from "@/lib/work/session";

export const metadata: Metadata = { title: "내 프로필" };

export default async function AccountPage() {
  const { profile, role, project } = await getSession();
  const roleLabel = profile.global_role ? GLOBAL_ROLE_LABEL[profile.global_role] : role ? ROLE_LABEL[role] : "소속 없음";
  return (
    <>
      <PageHeader title="내 프로필" description={`${profile.email} · ${roleLabel}${project && !profile.global_role ? ` (${project.name})` : ""}`} />
      <AccountForm
        initial={{
          full_name: profile.full_name,
          phone: profile.phone ?? "",
          company: profile.company ?? "",
          position: profile.position ?? "",
        }}
      />
    </>
  );
}
