#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectProtocolProductionArtifacts } from "./lib/protocolProductionArtifacts.mjs";

/** Production approval covers exactly the current 14 relations. */
export async function verifyProductionCeremony(options = {}) {
  return inspectProtocolProductionArtifacts(options);
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length) throw new Error("Usage: node scripts/zk-ceremony-verify.mjs");
  return verifyProductionCeremony();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(`[zk-ceremony] ${error.message}`); process.exitCode = 1; });
