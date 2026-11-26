"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateMyProfile } from "@/app/(dashboard)/farm365/work/(app)/admin/account/actions";
import { Button } from "@/components/work/ui/button";
import { Card, CardBody, CardHeader } from "@/components/work/ui/card";
import { Field, FormError, FormNotice, Input } from "@/components/work/ui/form";

interface ProfileValues {
  full_name: string;
  phone: string;
  company: string;
  position: string;
}

/** 현장관리 프로필만 고친다. 비밀번호·이메일은 Shrimp365 계정의 것이라 여기서 다루지 않는다. */
export function AccountForm({ initial }: { initial: ProfileValues }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [profile, setProfile] = useState(initial);
  const [profileMessage, setProfileMessage] = useState<{ error?: string; notice?: string }>({});
  const set = (key: keyof ProfileValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setProfile((p) => ({ ...p, [key]: e.target.value }));

  return (
    <div className="grid gap-4 md:grid-cols-2 md:items-start">
      <Card>
        <CardHeader title="기본 정보" />
        <CardBody>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const result = await updateMyProfile(profile);
                setProfileMessage(result.ok ? { notice: "저장했습니다." } : { error: result.error });
                if (result.ok) router.refresh();
              });
            }}
          >
            <Field label="이름" htmlFor="my-name" required>
              <Input id="my-name" value={profile.full_name} onChange={set("full_name")} maxLength={50} required />
            </Field>
            <Field label="소속" htmlFor="my-company">
              <Input id="my-company" value={profile.company} onChange={set("company")} maxLength={100} />
            </Field>
            <Field label="직책" htmlFor="my-position">
              <Input id="my-position" value={profile.position} onChange={set("position")} maxLength={50} />
            </Field>
            <Field label="연락처" htmlFor="my-phone">
              <Input id="my-phone" type="tel" inputMode="tel" value={profile.phone} onChange={set("phone")} maxLength={30} />
            </Field>
            <FormError message={profileMessage.error} />
            <FormNotice message={profileMessage.notice} />
            <Button type="submit" size="lg" className="w-full" disabled={pending}>저장</Button>
          </form>
        </CardBody>
      </Card>
      <p className="text-sm text-muted-foreground">비밀번호는 Shrimp365 설정에서 변경합니다.</p>
    </div>
  );
}
