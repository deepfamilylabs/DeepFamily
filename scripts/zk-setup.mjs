#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSingleOperatorProductionSetup } from "./lib/zkProductionSetup.mjs";

const usage = () => {
  console.log(`Usage:
  npm run zk:setup
  npm run zk:setup -- --ceremony-id <stable-audit-id>
  npm run zk:setup -- --informal
  npm run zk:setup -- --rotate \\
    --expected-current-manifest-sha256 <current-production-manifest-sha256> \\
    --expected-current-shielded-manifest-sha256 <current-shielded-manifest-sha256> \\
    --expected-snarkjs-runtime-sha256 <reviewed-new-runtime-sha256> \\
    [--ceremony-id <new-stable-audit-id>]

Optional: --shielded-release-criteria <committed-json-path> records the six reviewed
release thresholds. These thresholds are checked by release:preflight.

Creates the single final artifact set for all fifteen Circom circuits with:
  - a hash-verified official compiler or fresh pinned-source private build for this host;
  - a frozen source and compiled R1CS/WASM snapshot checked before any Groth16 setup starts;
  - the pinned, published Powers of Tau Phase 1 file, hash-verified before use;
  - one local Phase 2 operator using OS CSPRNG entropy per circuit;
  - one finalization beacon generated only after every contribution;
  - schema-validated identity and shielded transcripts and production manifests.

The Phase 1 file is read from circuits/ptau/ppot_0080_17.ptau, or from
ZK_PTAU_PATH when set. Neither form downloads it.

The first setup reads the reviewed source/toolchain manifest and compiles the committed sources;
it does not require previously generated proving files. It refuses to overwrite an existing
finalized setup without the explicit rotation options.
The explicit --rotate form accepts only a valid existing schema-v3 single-operator production
manifest and requires reviewed hashes for both that manifest and the newly installed snarkjs
runtime graph. Both forms require a clean Git working tree, stage all outputs before installation,
and restore the previous artifact set if final validation fails. They intentionally record that
production security trusts the operator to destroy every Phase 2 secret.
The same final keys, verification/link keys and Solidity verifiers are used in local development,
CI and releases. Build, fetch and check commands reuse them without generating new keys.

--informal runs the same compilation, contribution, beacon and export steps, but installs the
keys as development artifacts: development manifests that claim no ceremony and bind no
transcript, so release:preflight rejects them. It skips the full Phase 1 "powersoftau verify",
every "zkey verify" and the clean Git working tree requirement, and it cannot be combined with
--rotate or --shielded-release-criteria.`);
};

const USAGE_ERROR =
  "Usage: npm run zk:setup -- [--ceremony-id <stable-audit-id>] " +
  "[--informal | --shielded-release-criteria <committed-json-path>] or " +
  "--rotate --expected-current-manifest-sha256 <sha256> " +
  "--expected-current-shielded-manifest-sha256 <sha256> " +
  "--expected-snarkjs-runtime-sha256 <sha256> " +
  "[--shielded-release-criteria <committed-json-path>] [--ceremony-id <new-stable-audit-id>]";

export const parseArguments = (argv) => {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const parsed = {
    help: false,
    rotate: false,
    informal: false,
    ceremonyId: undefined,
    expectedCurrentManifestSha256: undefined,
    expectedSnarkjsRuntimeSha256: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--rotate" || argument === "--informal") {
      const flag = argument === "--rotate" ? "rotate" : "informal";
      if (parsed[flag]) throw new Error(USAGE_ERROR);
      parsed[flag] = true;
      continue;
    }
    const field =
      argument === "--ceremony-id"
        ? "ceremonyId"
        : argument === "--expected-current-manifest-sha256"
          ? "expectedCurrentManifestSha256"
          : argument === "--expected-current-shielded-manifest-sha256"
            ? "expectedCurrentShieldedManifestSha256"
            : argument === "--expected-snarkjs-runtime-sha256"
              ? "expectedSnarkjsRuntimeSha256"
              : argument === "--shielded-release-criteria"
                ? "shieldedReleaseCriteriaPath"
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
    parsed.expectedSnarkjsRuntimeSha256 !== undefined ||
    parsed.expectedCurrentShieldedManifestSha256 !== undefined;
  if (
    (parsed.rotate &&
      (parsed.expectedCurrentManifestSha256 === undefined ||
        parsed.expectedSnarkjsRuntimeSha256 === undefined ||
        parsed.expectedCurrentShieldedManifestSha256 === undefined)) ||
    (!parsed.rotate && hasRotationEvidence) ||
    (parsed.informal && (parsed.rotate || parsed.shieldedReleaseCriteriaPath !== undefined))
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
    parsed.informal
      ? "Starting informal ZK setup: development keys, pTau and zkey verification skipped."
      : `Starting single-operator final ZK ${parsed.rotate ? "rotation" : "setup"}. ` +
          "Keep this machine isolated and destroy " +
          "all Phase 2 entropy after the process exits.",
  );
  const result = await runSingleOperatorProductionSetup({
    ceremonyId: parsed.ceremonyId,
    rotate: parsed.rotate,
    informal: parsed.informal,
    expectedCurrentManifestSha256: parsed.expectedCurrentManifestSha256,
    expectedCurrentShieldedManifestSha256: parsed.expectedCurrentShieldedManifestSha256,
    expectedSnarkjsRuntimeSha256: parsed.expectedSnarkjsRuntimeSha256,
    includeShielded: true,
    shieldedReleaseCriteriaPath: parsed.shieldedReleaseCriteriaPath,
  });
  if (parsed.informal) {
    console.log("Informal ZK setup completed; development keys installed:");
    console.log(`  manifest:   ${result.manifestSha256}`);
    console.log(`  shielded:   ${result.shieldedManifestSha256}`);
    console.log(
      "Review and commit every generated artifact together. A release needs the formal npm run zk:setup.",
    );
    return;
  }
  console.log("Final ZK setup completed and verified:");
  console.log(`  ceremony:   ${result.ceremonyId}`);
  console.log(`  trust:      ${result.trustModel} (${result.contributorCount} contributor)`);
  console.log(`  manifest:   ${result.manifestSha256}`);
  console.log(`  shielded:   ${result.shieldedManifestSha256}`);
  console.log(`  transcript: ${result.transcriptSha256}`);
  console.log(
    "Review and commit every generated artifact together, then run npm run release:preflight.",
  );
};

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((error) => {
    console.error(`[zk-setup] ${error.message}`);
    process.exitCode = 1;
  });
}
