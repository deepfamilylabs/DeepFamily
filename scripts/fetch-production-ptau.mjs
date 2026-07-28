#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensureProductionPtau } from "./lib/productionPtau.mjs";

export const main = async () => {
  const result = await ensureProductionPtau();
  console.log(`Production Powers of Tau ${result.status}: ${result.path}`);
  console.log(`  bytes:       ${result.bytes}`);
  console.log(`  SHA-256:     ${result.sha256}`);
  console.log(`  BLAKE2b-512: ${result.blake2b512}`);
};

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((error) => {
    console.error(`[production-ptau] ${error.message}`);
    process.exitCode = 1;
  });
}
