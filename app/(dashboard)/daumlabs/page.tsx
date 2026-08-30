import { redirect } from "next/navigation"

// 농가에 안내하는 주소는 `/daumlabs` 한 마디다. 그 밑 실제 첫 화면은 홈이므로
// 여기서 넘긴다 — 이게 없으면 주소를 정확히 친 사람이 404를 본다.
export default function Page() {
  redirect("/daumlabs/home")
}
