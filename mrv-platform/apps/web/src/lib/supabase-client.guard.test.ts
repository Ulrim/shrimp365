/*
 * ★★ 이 테스트를 삭제하거나 skip 처리하지 말 것 (FED-4 / ADR 0006 6절).
 *
 * 무엇을 지키는가:
 *   culiver FE는 shrimp365(www.shrimp365.kr)와 **동일한 Supabase 프로젝트의 anon key**를
 *   들고 있다. 따라서 코드가 마음만 먹으면 PostgREST(`supabase.from("farms").select()`)로
 *   **운영 중인 shrimp365의 데이터**에 접근할 수 있다. 사용자가 명시적으로 결정한 범위는
 *   "계정(로그인)만 공유 / 데이터는 완전 별건"이며, 이 경계는 백엔드에서는 구조가(연결
 *   문자열 자체가 없음), 프런트에서는 **오직 규율이** 막는다. 그 규율을 이 테스트가
 *   물리적으로 강제한다(ADR 0002의 "관례가 아닌 물리적 강제" 철학).
 *
 * 이 테스트를 지우면 무엇이 깨지는가:
 *   - ADR 0006 6절의 "데이터 평면 분리" 주장이 근거를 잃는다(문서만 남고 강제는 사라진다).
 *   - shrimp365 운영 데이터에 대한 무단 읽기/쓰기가 CI를 그대로 통과하게 된다.
 *   - culiver KPI/MRV 수치의 출처가 백엔드 단일 경로라는 전제(CLAUDE Rule 1·6)가 흔들린다.
 *   culiver가 shrimp365 데이터를 실제로 읽어야 하는 요구가 생기면 조용히 `.from()`을
 *   추가하는 대신 **ADR 0006의 격리 결정을 뒤집는 새 ADR**을 먼저 쓴다(ADR 0006 결과 (d)).
 *
 * 허용되는 것: `supabase.auth.*` (인증 평면 — 연계의 유일한 접점).
 */
import { describe, it, expect } from "vitest";

/*
 * 소스 수집은 Vite의 import.meta.glob(?raw)로 한다 — 신규 의존성 없이(Node 타입 패키지조차
 * 필요 없이) apps/web/src 전체를 결정론적으로 훑는다. eager 이므로 테스트 실행 시점에
 * 파일 내용이 이미 문자열로 들어와 있고, 키(경로)를 정렬해 순회 순서에 의존하지 않는다.
 */
const RAW_SOURCES = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** 자기 자신(이 가드 파일)은 금지 패턴을 문서화하므로 스캔 대상에서 제외한다. */
const SELF_SUFFIX = "lib/supabase-client.guard.test.ts";

/** Supabase 클라이언트의 "데이터 평면" 표면. auth 는 의도적으로 제외한다. */
const FORBIDDEN_MEMBERS = [
  "from",
  "rpc",
  "storage",
  "functions",
  "channel",
  "realtime",
  "schema",
] as const;

/**
 * `supabase.<금지멤버>` 형태만 잡는다.
 * - 수신자(`supabase`)를 반드시 요구하므로 `Array.from(...)`, `Object.fromEntries(...)`,
 *   `import ... from "..."` 같은 무관한 패턴에는 걸리지 않는다(오탐 방지 — 정규식이 넓으면
 *   팀이 이 가드를 신뢰하지 않게 되고, 신뢰받지 못하는 가드는 결국 삭제된다).
 * - `supabaseClient.from(` 처럼 다른 식별자는 매칭되지 않지만, 그런 우회는 아래
 *   "클라이언트 생성 지점 단일화" 테스트가 막는다(@supabase/supabase-js 임포트 제한).
 */
const DATA_PLANE_PATTERN = new RegExp(
  String.raw`\bsupabase\s*\.\s*(${FORBIDDEN_MEMBERS.join("|")})\b`,
  "g",
);

/** `@supabase/supabase-js` 임포트가 허용되는 유일한 파일(클라이언트 싱글턴). */
const CLIENT_MODULE_SUFFIX = "lib/supabase-client.ts";
const SUPABASE_SDK_IMPORT = /from\s*["']@supabase\/supabase-js["']/;

/**
 * 주석 제거. 설명 주석(이 파일처럼 금지 패턴을 인용하는 문서화)이 오탐을 만들지 않게 한다.
 * 라인 주석은 앞 문자가 `:`/따옴표가 아닐 때만 제거해 `"https://…"` URL을 보호한다.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/** 한 파일 내용에서 위반 스니펫 목록을 돌려준다(없으면 빈 배열). */
function findDataPlaneUsages(source: string): string[] {
  DATA_PLANE_PATTERN.lastIndex = 0;
  return [...stripComments(source).matchAll(DATA_PLANE_PATTERN)].map((m) => m[0]);
}

/** `/src/features/auth/LoginPage.tsx` → `features/auth/LoginPage.tsx` (표시용 정규화). */
function normalize(globKey: string): string {
  return globKey.replace(/^\/src\//, "");
}

/** [정규화 경로, 소스] 쌍. 경로 기준 정렬로 결정론성을 보장한다. */
const SOURCE_ENTRIES: ReadonlyArray<readonly [string, string]> = Object.entries(RAW_SOURCES)
  .map(([key, source]) => [normalize(key), source] as const)
  .filter(([file]) => file !== SELF_SUFFIX)
  .sort(([a], [b]) => a.localeCompare(b));

const WHY = [
  "ADR 0006 6절 위반: culiver FE는 Supabase 의 인증 평면(supabase.auth.*)만 사용한다.",
  "사용자 결정 범위는 \"계정(로그인)만 공유 / 데이터는 완전 별건\"이며, culiver FE는",
  "shrimp365 와 동일한 anon key 를 갖기 때문에 .from()/.rpc()/.storage 호출은 운영 중인",
  "shrimp365 데이터에 직접 접근하는 행위가 된다. 업무 데이터는 반드시 culiver 백엔드",
  "API(apps/web/src/lib/api-client.ts)를 통해서만 읽고 쓴다.",
].join("\n");

describe("Supabase 데이터 평면 사용 금지 가드 (FED-4 / ADR 0006 6절)", () => {
  it("스캔 대상 소스 파일을 실제로 찾는다(가드가 조용히 무력화되지 않도록)", () => {
    expect(SOURCE_ENTRIES.length).toBeGreaterThan(10);
    expect(SOURCE_ENTRIES.map(([file]) => file)).toContain(CLIENT_MODULE_SUFFIX);
  });

  it("apps/web/src 어디에서도 supabase 데이터 평면 API를 호출하지 않는다", () => {
    const violations = SOURCE_ENTRIES.flatMap(([file, source]) =>
      findDataPlaneUsages(source).map((usage) => `${file}: ${usage}`),
    );

    expect(
      violations,
      violations.length === 0
        ? ""
        : `\n${WHY}\n\n발견된 위반:\n${violations.map((v) => `  - ${v}`).join("\n")}\n`,
    ).toEqual([]);
  });

  it("@supabase/supabase-js 임포트는 lib/supabase-client.ts 한 곳만 허용한다", () => {
    const offenders = SOURCE_ENTRIES.filter(
      ([file, source]) =>
        file !== CLIENT_MODULE_SUFFIX && SUPABASE_SDK_IMPORT.test(stripComments(source)),
    ).map(([file]) => file);

    // 클라이언트를 다른 이름으로 새로 만들면 위 패턴 스캔을 우회할 수 있으므로,
    // 생성 지점을 한 곳으로 묶어 가드의 구멍을 막는다.
    expect(
      offenders,
      offenders.length === 0 ? "" : `\n${WHY}\n\nSDK 직접 임포트:\n  - ${offenders.join("\n  - ")}\n`,
    ).toEqual([]);
  });

  describe("스캐너 자체 검증(역검증 — 신규 의존성 없이 결정론적)", () => {
    it("supabase.auth.* 는 허용한다(오탐 없음)", () => {
      const allowed = [
        'const { error } = await supabase.auth.signInWithPassword({ email, password })',
        'await supabase.auth.signInWithOAuth({ provider: "google" })',
        "await supabase.auth.signOut()",
        "supabase.auth.onAuthStateChange((_e, s) => s)",
      ].join("\n");
      expect(findDataPlaneUsages(allowed)).toEqual([]);
    });

    it("무관한 from/functions 패턴에는 걸리지 않는다(오탐 없음)", () => {
      const unrelated = [
        'import { supabase } from "@/lib/supabase-client"',
        "const rows = Array.from(items)",
        "const obj = Object.fromEntries(pairs)",
        "const { from, to } = range",
        "queryClient.getQueryData(['from'])",
        "const supabaseUrl = env.VITE_SUPABASE_URL",
      ].join("\n");
      expect(findDataPlaneUsages(unrelated)).toEqual([]);
    });

    it.each([
      'supabase.from("farms").select("*")',
      "supabase.rpc('get_farm_stats')",
      "await supabase.storage.from('bucket').download('x')",
      "supabase.functions.invoke('fn')",
      "supabase.channel('room1').subscribe()",
      "supabase.realtime.connect()",
    ])("데이터 평면 호출 %s 를 위반으로 검출한다", (snippet) => {
      expect(findDataPlaneUsages(snippet).length).toBeGreaterThan(0);
    });

    it("주석 안의 설명 문구는 위반으로 보지 않는다", () => {
      const documented = [
        '// supabase.from("farms") 는 금지된다(ADR 0006 6절).',
        "/* supabase.rpc(...) 도 마찬가지다. */",
        "await supabase.auth.getSession()",
      ].join("\n");
      expect(findDataPlaneUsages(documented)).toEqual([]);
    });
  });
});
