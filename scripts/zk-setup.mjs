#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectProtocolProductionArtifacts } from "./lib/protocolProductionArtifacts.mjs";

export function parseArguments(argv) {
  if (argv.length === 0) return { help: false };
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) return { help: true };
  throw new Error("Usage: npm run zk:setup -- [--help]");
}
export async function main(argv = process.argv.slice(2)) {
  if (parseArguments(argv).help) {
    console.log("Production setup requires a reviewed ceremony for all 14 current relations. Use npm run zk:dev for local development keys; npm run zk:dev:check verifies their source and artifact pins.");
    return;
  }
  return inspectProtocolProductionArtifacts();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(`[zk-setup] ${error.message}`); process.exitCode = 1; });
