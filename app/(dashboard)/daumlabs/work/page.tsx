import { redirect } from "next/navigation";
import { workHref } from "@/lib/work/constants";

/** 현장관리 진입점. 세션·초대 확인은 (app) 레이아웃이 한다. */
export default function WorkIndexPage() {
  redirect(workHref("/dashboard"));
}
