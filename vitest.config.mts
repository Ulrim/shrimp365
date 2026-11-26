import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 현장관리(DailyWork 이식) 테스트 설정. 별칭 `@` 는 tsconfig 와 같이 저장소 루트다.
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": root } },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/work/unit/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: ["tests/work/db/**/*.test.ts"],
          globalSetup: ["tests/work/db/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 20000,
        },
      },
    ],
  },
});
