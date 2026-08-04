#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSingleOperatorProductionSetup } from "./lib/zkProductionSetup.mjs";

const usage = () => {
  console.log(`Usage:
  npm run zk:production:setup
  npm run zk:production:setup -- --ceremony-id <stable-audit-id>
  npm run zk:production:setup -- --rotate \\
    --expected-current-manifest-sha256 <current-production-manifest-sha256> \\
    --expected-snarkjs-runtime-sha256 <reviewed-new-runtime-sha256> \\
    [--ceremony-id <new-stable-audit-id>]

Creates both production Groth16 proving keys with:
  - a hash-verified official compiler or fresh pinned-source private build for this host;
  - canonical R1CS/WASM hashes checked before either Groth16 setup starts;
  - the pinned, published Powers of Tau Phase 1 file;
  - one local Phase 2 operator using OS CSPRNG entropy per circuit;
  - one finalization beacon generated only after both contributions;
  - a schema-validated single-operator transcript and production manifest.

The default command requires a development manifest and refuses to overwrite production artifacts.
The explicit --rotate form accepts only a valid existing schema-v3 single-operator production
manifest and requires reviewed hashes for both that manifest and the newly installed snarkjs
runtime graph. Both forms require a clean Git working tree, stage all outputs before installation,
and restore the previous artifact set if final validation fails. They intentionally record that
production security trusts the operator to destroy both Phase 2 secrets.`);
};

const USAGE_ERROR =
  "Usage: npm run zk:production:setup -- [--ceremony-id <stable-audit-id>] or " +
  "--rotate --expected-current-manifest-sha256 <sha256> " +
  "--expected-snarkjs-runtime-sha256 <sha256> [--ceremony-id <new-stable-audit-id>]";

export const parseArguments = (argv) => {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const parsed = {
    help: false,
    rotate: false,
    ceremonyId: undefined,
    expectedCurrentManifestSha256: undefined,
    expectedSnarkjsRuntimeSha256: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--rotate") {
      if (parsed.rotate) throw new Error(USAGE_ERROR);
      parsed.rotate = true;
      continue;
    }
    const field =
      argument === "--ceremony-id"
        ? "ceremonyId"
        : argument === "--expected-current-manifest-sha256"
          ? "expectedCurrentManifestSha256"
          : argument === "--expected-snarkjs-runtime-sha256"
            ? "expectedSnarkjsRuntimeSha256"
            : null;
    if (field === null || parsed[field] !== undefined) throw new Error(USAGE_ERROR);
    const value = argv[index + 1];
    if (typeof value !== "string" || value.trim() === "" || value.startsWith("--")) {
      throw new Error(USAGE_ERROR);
    }
    parsed[field] = value;
    index += 1;
  }
  const hasRotationEvidence =
    parsed.expectedCurrentManifestSha256 !== undefined ||
    parsed.expectedSnarkjsRuntimeSha256 !== undefined;
  if (
    (parsed.rotate &&
      (parsed.expectedCurrentManifestSha256 === undefined ||
        parsed.expectedSnarkjsRuntimeSha256 === undefined)) ||
    (!parsed.rotate && hasRotationEvidence)
  ) {
    throw new Error(USAGE_ERROR);
  }
  return parsed;
};

export const main = async (argv = process.argv.slice(2)) => {
  const parsed = parseArguments(argv);
  if (parsed.help) {
    usage();
    return;
  }
  console.warn(
    `Starting single-operator production ZK ${parsed.rotate ? "rotation" : "setup"}. ` +
      "Keep this machine isolated and destroy " +
      "all Phase 2 entropy after the process exits.",
  );
  const result = await runSingleOperatorProductionSetup({
    ceremonyId: parsed.ceremonyId,
    rotate: parsed.rotate,
    expectedCurrentManifestSha256: parsed.expectedCurrentManifestSha256,
    expectedSnarkjsRuntimeSha256: parsed.expectedSnarkjsRuntimeSha256,
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
