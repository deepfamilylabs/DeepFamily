#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectZkReleaseArtifacts } from "./lib/zkArtifactTrust.mjs";
import { inspectCanonicalDevelopmentArtifacts } from "./check-protocol-artifacts.mjs";

/** Current identity, asset boundary and receiving statements; keys are never generated here. */
export function checkCurrentArtifacts({ root = process.cwd(), requireBuiltR1cs = true } = {}) {
  const identity = inspectZkReleaseArtifacts({ root, requireBuiltR1cs });
  const receiving = inspectCanonicalDevelopmentArtifacts({ root, requireCompiledProtocol: requireBuiltR1cs });
  return { status: "development", circuitCount: 13, identity, ...receiving };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkCurrentArtifacts(); console.log("All 13 current development artifact sets verified"); }
  catch (error) { console.error(`[zk-artifacts] ${error.message}`); process.exitCode = 1; }
}
