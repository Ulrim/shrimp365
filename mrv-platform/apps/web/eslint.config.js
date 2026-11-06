import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

/*
 * ESLint flat config (스프린트 0).
 * typescript-eslint + react-hooks + react-refresh 권장 규칙. TS/TSX 대상.
 * make lint(ruff+eslint+tsc) 게이트가 프론트에서도 실제로 강제되도록 한다.
 */
export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  // 테스트/설정 파일은 Node 전역을 허용.
  {
    files: ["**/*.test.{ts,tsx}", "src/test/**", "*.config.{ts,js}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
);
