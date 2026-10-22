#!/usr/bin/env node
import path from "node:path";
import { inspectReceiveArtifacts } from "./lib/receiveArtifacts.mjs";

try {
  const result = inspectReceiveArtifacts({ root: path.resolve(import.meta.dirname, "..") });
  console.log(
    `Receive presentation artifacts verified: ${result.circuitCount} circuits, ${result.manifestSha256}`,
  );
} catch (error) {
  console.error(`[check-receive-artifacts] ${error.message}`);
  process.exitCode = 1;
}
