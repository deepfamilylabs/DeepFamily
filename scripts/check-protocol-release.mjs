#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectProtocolProductionArtifacts } from "./lib/protocolProductionArtifacts.mjs";

export async function checkProtocolReleaseEvidence(options = {}) {
  return inspectProtocolProductionArtifacts(options);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  checkProtocolReleaseEvidence().catch(error => { console.error(`[protocol-release] ${error.message}`); process.exitCode = 1; });
