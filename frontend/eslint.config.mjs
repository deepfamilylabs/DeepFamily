import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

const srcFiles = ["src/**/*.{ts,tsx}"];

const restrictedImportRule = (patterns) => [
  "error",
  {
    patterns: patterns.map((group) => ({ group })),
  },
];

export default [
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**"],
  },
  {
    files: srcFiles,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
  },
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrictedImportRule([
        ["**/domains/**"],
        ["**/pages/**"],
        ["**/components/**"],
        ["**/context/**"],
        ["**/hooks/**"],
      ]),
    },
  },
  {
    files: ["src/domains/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrictedImportRule([["**/pages/**"]]),
    },
  },
  {
    files: [
      "src/pages/**/*.{ts,tsx}",
      "src/components/**/*.{ts,tsx}",
      "src/hooks/**/*.{ts,tsx}",
      "src/context/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": restrictedImportRule([
        ["**/domains/**/services/**"],
        ["**/domains/**/api/**"],
        ["**/domains/person/model/*"],
        ["**/domains/person/queries/*"],
        ["**/domains/person/ui/*"],
        ["**/domains/transactions/flows/*"],
        ["**/domains/transactions/model/*"],
        ["**/domains/transactions/ui/*"],
        ["**/domains/tree/context/*"],
        ["**/domains/tree/queries/*"],
        ["**/domains/tree/selectors/*"],
        ["**/domains/tree/ui/*"],
      ]),
    },
  },
];
