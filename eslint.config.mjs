import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const reactCompilerCompatibilityFiles = [
  "app/(dashboard)/diagnosis/page.tsx",
  "app/(dashboard)/reports/page.tsx",
  "components/farms/farms-view.tsx",
  "components/layout/notifications-panel.tsx",
  "components/layout/search-panel.tsx",
  "components/layout/settings-panel.tsx",
  "components/layout/sidebar.tsx",
  "components/water-quality/water-quality-view.tsx",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: reactCompilerCompatibilityFiles,
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // openfield/ 는 Python 하위 프로젝트(OFDF). dashboard/*.js 는 키오스크의 <script> 전용이다.
    "openfield/**",
    // vision/ 도 Python 하위 프로젝트(카메라 개체수). tests/ui/*.js 는 node 로 바로 돌리는 CommonJS 점검 스크립트다.
    "vision/**",
  ]),
]);

export default eslintConfig;
