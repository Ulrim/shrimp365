import { redirect } from "next/navigation"

/** /mrv 진입점. 원본이 "/" 를 "/overview" 로 보내던 것과 같다. */
export default function MrvIndexPage() {
  redirect("/mrv/overview")
}
