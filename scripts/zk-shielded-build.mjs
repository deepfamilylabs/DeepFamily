#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalCircomInstallation } from "./fetch-circom.mjs";
import { CIRCOM_ARTIFACT_FLAGS } from "./lib/circomToolchain.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = path.join(root, "zk-artifacts", "shielded");
export const SHIELDED_CIRCUITS = Object.freeze({
  keyRegistration: "shielded_key_registration",
  shield: "shielded_shield",
  createPolicy: "shielded_create_policy",
  allocate: "shielded_allocate",
  topUp: "shielded_top_up",
  mergeBudget: "shielded_merge_budget",
  claim: "shielded_claim",
  privateTransfer: "shielded_private_transfer",
  unshield: "shielded_unshield",
});

function selected(argv) {
  if (argv.length === 0) return Object.entries(SHIELDED_CIRCUITS);
  if (argv.length !== 2 || argv[0] !== "--circuit" || !Object.hasOwn(SHIELDED_CIRCUITS, argv[1])) {
    throw new Error(
      `Usage: node scripts/zk-shielded-build.mjs [--circuit ${Object.keys(SHIELDED_CIRCUITS).join("|")}]`,
    );
  }
  return [[argv[1], SHIELDED_CIRCUITS[argv[1]]]];
}

export async function buildShieldedCircuits(argv = []) {
  const compiler = await assertLocalCircomInstallation({ root });
  fs.mkdirSync(output, { recursive: true });
  const names = selected(argv);
  for (const [, sourceName] of names) {
    execFileSync(
      compiler.path,
      [
        path.join("circuits", `${sourceName}.circom`),
        ...CIRCOM_ARTIFACT_FLAGS,
        "-l",
        "node_modules",
        "-l",
        path.join("node_modules", "circomlib", "circuits"),
        "-o",
        output,
      ],
      { cwd: root, stdio: "inherit" },
    );
  }
  return names.map(([action, sourceName]) => ({ action, sourceName, output }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildShieldedCircuits(process.argv.slice(2));
}
