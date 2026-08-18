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
  ]),
]);

export default eslintConfig;
