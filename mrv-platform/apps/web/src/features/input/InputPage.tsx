import { FeedLogForm } from "./FeedLogForm";
import { MortalityLogForm } from "./MortalityLogForm";

/*
 * 급이/폐사 입력 화면 (MASTER 화면4).
 * 두 폼을 나란히 배치. 각 폼은 검증·성공/에러·권한을 자체 처리한다.
 */

const DEMO_SITE_ID = import.meta.env.VITE_DEMO_SITE_ID ?? "demo-site";

export function InputPage() {
  const siteId = DEMO_SITE_ID;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-fg">급이 · 폐사 입력</h1>
        <p className="text-sm text-muted">
          사이트 {siteId} · 입력값은 검증 후 저장되며 KPI(FCR·폐사율)에 반영됩니다.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FeedLogForm siteId={siteId} />
        <MortalityLogForm siteId={siteId} />
      </div>
    </div>
  );
}
