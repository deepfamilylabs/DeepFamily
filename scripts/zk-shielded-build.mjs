#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHIELDED_CIRCUITS } from "./lib/zkCircuitSelection.mjs";
import { runZkBuild } from "./zk-build.mjs";

export { SHIELDED_CIRCUITS } from "./lib/zkCircuitSelection.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = path.join(root, "zk-artifacts", "shielded");

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
  const names = selected(argv);
  await runZkBuild({ root, circuit: argv.length === 0 ? "shielded" : `shielded:${argv[1]}` });
  return names.map(([action, sourceName]) => ({ action, sourceName, output }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildShieldedCircuits(process.argv.slice(2));
}
