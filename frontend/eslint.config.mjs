import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

const srcFiles = ["src/**/*.{ts,tsx}"];

const restrictedImportRule = (patterns) => [
  "error",
  {
    patterns: patterns.map((group) => ({ group })),
  },
];

const noAppOrPages = [["**/app/**"], ["**/pages/**"]];
const noTreeModel = [["**/tree/model"], ["**/tree/model/**"]];

export default [
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**"],
  },
  {
    files: srcFiles,
    ignores: ["src/shared/config/env.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.type='MetaProperty'][object.meta.name='import'][object.property.name='meta'][property.name='env']",
          message: "Read Vite env through src/shared/config/env.ts.",
        },
        {
          selector:
            "MemberExpression[object.type='TSAsExpression'][property.name='env'] > TSAsExpression > MetaProperty[meta.name='import'][property.name='meta']",
          message: "Read Vite env through src/shared/config/env.ts.",
        },
        {
          selector:
            "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env']",
          message: "Read runtime env through src/shared/config/env.ts.",
        },
      ],
    },
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
        ["**/app/**"],
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
      "no-restricted-imports": restrictedImportRule(noAppOrPages),
    },
  },
  {
    files: ["src/domains/tree/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrictedImportRule([
        ...noAppOrPages,
        ["**/wallet/**"],
        ["**/transactions/**"],
      ]),
    },
  },
  {
    files: ["src/domains/config/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrictedImportRule([
        ...noAppOrPages,
        ...noTreeModel,
        ["**/wallet/config"],
        ["**/wallet/config/**"],
      ]),
    },
  },
  {
    files: [
      "src/domains/person/**/*.{ts,tsx}",
      "src/domains/transactions/**/*.{ts,tsx}",
      "src/domains/wallet/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": restrictedImportRule([
        ...noAppOrPages,
        ...noTreeModel,
      ]),
    },
  },
  {
    files: ["src/domains/wallet/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrictedImportRule([
        ...noAppOrPages,
        ...noTreeModel,
        ["**/person/**"],
        ["**/transactions/**"],
      ]),
    },
  },
  {
    files: [
      "src/app/**/*.{ts,tsx}",
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
        ["**/domains/tree/model"],
        ["**/domains/tree/model/*"],
        ["**/domains/tree/queries/*"],
        ["**/domains/tree/selectors/*"],
        ["**/domains/tree/ui/*"],
      ]),
    },
  },
];
