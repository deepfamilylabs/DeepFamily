#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyShieldedProductionCeremony } from "./lib/shieldedProductionSetup.mjs";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error("Usage: node scripts/zk-shielded-production-check.mjs");
    process.exitCode = 1;
  } else {
    verifyShieldedProductionCeremony()
      .then(({ manifestSha256, circuitCount }) => {
        console.log(
          `Shielded production ceremony verified: ${circuitCount} circuits, manifest SHA-256 ${manifestSha256}`,
        );
      })
      .catch((error) => {
        console.error(`[zk-shielded-production-check] ${error.message}`);
        process.exitCode = 1;
      });
  }
}
