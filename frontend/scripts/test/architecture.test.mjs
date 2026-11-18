import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("../../", import.meta.url)) });
async function messages(code, filePath = "src/domains/inheritance/services/probe.ts") {
  const [result] = await eslint.lintText(code, { filePath });
  assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
  return result.messages;
}

test("new browser writes must not import or re-export the raw transaction executor", async () => {
  for (const code of [
    'import { executeChainTransaction as send } from "@deepfamily/chain-client";',
    'export { executeChainTransaction as send } from "@deepfamily/chain-client";',
    'export * from "@deepfamily/chain-client";', 'import * as chain from "@deepfamily/chain-client";',
    'const chain = await import("@deepfamily/chain-client");',
  ]) assert((await messages(code)).some(({ ruleId }) => ruleId === "project/wallet-submission"), code);
  for (const code of [
    'import { runChainRead } from "@deepfamily/chain-client";',
    'import type * as Chain from "@deepfamily/chain-client";',
    'import { captureWalletDraft } from "../../../shared/clients/walletDraft";',
  ]) assert.deepEqual(await messages(code), []);
});

test("Hooks checks reject conditional calls and stale effect dependencies", async () => {
  const result = await messages(
    `
    import { useEffect, useState } from "react";
    export function Probe({ enabled, value }) {
      if (enabled) useState(0);
      useEffect(() => console.log(value), []);
      return null;
    }
  `,
    "src/pages/Probe.tsx",
  );
  assert(result.some(({ ruleId }) => ruleId === "react-hooks/rules-of-hooks"));
  assert(result.some(({ ruleId }) => ruleId === "react-hooks/exhaustive-deps"));
});

test("every domain, including new domains, rejects sibling internals", async () => {
  for (const domain of ["inheritance", "config", "future"]) {
    for (const code of [
      'import { value } from "../../wallet/services/walletProvider";',
      'export { value } from "../../wallet/services/walletProvider";',
      'export * from "../../wallet/services/walletProvider";',
      'const value = import("../../wallet/services/walletProvider");',
      'type Value = import("../../wallet/services/walletProvider").Value;',
      'import type { Value } from "../../wallet/services/walletProvider";',
    ]) {
      const result = await messages(code, `src/domains/${domain}/services/probe.ts`);
      assert(
        result.some(({ ruleId }) => ruleId === "project/architecture"),
        `${domain}: ${code}`,
      );
    }
  }
});

test("normalized paths cannot bypass layer direction or public domain entries", async () => {
  for (const [filename, specifier] of [
    ["src/shared/lib/probe.ts", "../../domains/person"],
    ["src/shared/lib/probe.ts", "../../pages/TreePage"],
    ["src/domains/inheritance/services/probe.ts", "../../../app/ui/Layout"],
    ["src/pages/Probe.tsx", "../domains/wallet/services/walletProvider"],
    ["src/domains/inheritance/services/probe.ts", "../../wallet/../wallet/services/walletProvider"],
    ["src/domains/inheritance/services/probe.ts", "/src/domains/wallet/services/walletProvider"],
  ]) {
    assert(
      (await messages(`import "${specifier}";`, filename)).some(
        ({ ruleId }) => ruleId === "project/architecture",
      ),
      filename,
    );
  }
});

test("public entries, same-domain imports and framework code remain available", async () => {
  for (const specifier of [
    "../../wallet",
    "../../wallet/index",
    "../../wallet/index.ts",
    "../model/value",
    "../../../shared/model",
    "react",
  ]) {
    assert.deepEqual(await messages(`import "${specifier}";`), [], specifier);
  }
  assert.deepEqual(
    await messages(
      `
    import { useEffect } from "react";
    export function Probe({ value }) { useEffect(() => console.log(value), [value]); return null; }
  `,
      "src/pages/Probe.tsx",
    ),
    [],
  );
});
