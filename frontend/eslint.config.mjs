import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import projectRules from "./scripts/eslint/architecture.mjs";

const srcFiles = ["src/**/*.{ts,tsx}"];

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
      project: projectRules,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "project/architecture": "error",
    },
  },
  {
    files: ["src/pages/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "ethers",
              importNames: ["Contract", "BrowserProvider", "JsonRpcProvider", "ContractFactory"],
              allowTypeImports: true,
              message:
                "Create contract and RPC clients inside a domain service; pages compose domain operations.",
            },
          ],
          patterns: [
            {
              group: [
                "**/clients/contractFactory",
                "**/clients/providerFactory",
                "**/clients/providerRegistry",
              ],
              message:
                "Pages must use domain services rather than construct contract or RPC clients.",
            },
          ],
        },
      ],
    },
  },
];
