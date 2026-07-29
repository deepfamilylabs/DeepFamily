#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSingleOperatorProductionSetup } from "./lib/zkProductionSetup.mjs";

const usage = () => {
  console.log(`Usage:
  npm run zk:production:setup
  npm run zk:production:setup -- --ceremony-id <stable-audit-id>

Creates both production Groth16 proving keys with:
  - a hash-verified official compiler or fresh pinned-source private build for this host;
  - canonical R1CS/WASM hashes checked before either Groth16 setup starts;
  - the pinned, published Powers of Tau Phase 1 file;
  - one local Phase 2 operator using OS CSPRNG entropy per circuit;
  - one finalization beacon generated only after both contributions;
  - a schema-validated single-operator transcript and production manifest.

The command requires a clean Git working tree, refuses to overwrite a production manifest, stages
all outputs before installation, and restores the previous artifact set if final validation fails.
It intentionally records that production security trusts the operator to destroy both Phase 2
secrets.`);
};

const parseArguments = (argv) => {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  if (argv.length === 0) return { help: false, ceremonyId: undefined };
  if (argv.length === 2 && argv[0] === "--ceremony-id" && argv[1].trim() !== "") {
    return { help: false, ceremonyId: argv[1] };
  }
  throw new Error("Usage: npm run zk:production:setup -- [--ceremony-id <stable-audit-id>]");
};

export const main = async (argv = process.argv.slice(2)) => {
  const parsed = parseArguments(argv);
  if (parsed.help) {
    usage();
    return;
  }
  console.warn(
    "Starting single-operator production ZK setup. Keep this machine isolated and destroy " +
      "all Phase 2 entropy after the process exits.",
  );
  const result = await runSingleOperatorProductionSetup({
    ceremonyId: parsed.ceremonyId,
  });
  console.log("Production ZK setup completed and verified:");
  console.log(`  ceremony:   ${result.ceremonyId}`);
  console.log(`  trust:      ${result.trustModel} (${result.contributorCount} contributor)`);
  console.log(`  manifest:   ${result.manifestSha256}`);
  console.log(`  transcript: ${result.transcriptSha256}`);
  console.log(
    "Review and commit every generated artifact together, then run npm run release:preflight.",
  );
};

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((error) => {
    console.error(`[zk-production-setup] ${error.message}`);
    process.exitCode = 1;
  });
}
