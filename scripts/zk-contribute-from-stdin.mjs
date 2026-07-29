#!/usr/bin/env node

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertSnarkjsRuntimeHash } from "./lib/snarkjsToolchain.mjs";

const ENTROPY_HEX_LENGTH = 128;
const ENTROPY_INPUT_LENGTH = ENTROPY_HEX_LENGTH + 1;
const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/u;

const isLowerHexByte = (value) =>
  (value >= 0x30 && value <= 0x39) || (value >= 0x61 && value <= 0x66);

/**
 * Reads one 64-byte lowercase-hex entropy value from stdin, uses it exactly once, and wipes every
 * mutable copy before returning. The immutable JavaScript string exists only in this short-lived
 * helper process and disappears when the process exits.
 */
export const withContributionEntropy = async ({ inputBytes, consume }) => {
  if (!Buffer.isBuffer(inputBytes) && !(inputBytes instanceof Uint8Array)) {
    throw new Error("Contribution entropy input must be bytes");
  }
  if (typeof consume !== "function") {
    throw new Error("Contribution entropy consumer must be a function");
  }

  const combined = Buffer.isBuffer(inputBytes) ? inputBytes : Buffer.from(inputBytes);
  let entropy;
  try {
    if (
      combined.length !== ENTROPY_INPUT_LENGTH ||
      combined[ENTROPY_HEX_LENGTH] !== 0x0a ||
      !combined.subarray(0, ENTROPY_HEX_LENGTH).every(isLowerHexByte)
    ) {
      throw new Error("Phase 2 entropy stdin must be exactly 64 lowercase-hex bytes plus newline");
    }

    entropy = combined.subarray(0, ENTROPY_HEX_LENGTH).toString("ascii");
    await consume(entropy);
  } finally {
    entropy = undefined;
    combined.fill(0);
  }
};

export const runZkeyContributionFromStdin = async ({
  argv = process.argv.slice(2),
  inputBytes,
  contributor,
  runtimeInspector = assertSnarkjsRuntimeHash,
} = {}) => {
  const expectedArgumentCount = contributor === undefined ? 5 : 3;
  if (!Array.isArray(argv) || argv.length !== expectedArgumentCount) {
    throw new Error(
      "Usage: node scripts/zk-contribute-from-stdin.mjs " +
        "<old.zkey> <new.zkey> <participant-id> <snarkjs-runtime-root> " +
        "<snarkjs-runtime-sha256>",
    );
  }
  const [oldZkey, newZkey, participantId, configuredRuntimeRoot, expectedRuntimeSha256] = argv;
  if (
    typeof oldZkey !== "string" ||
    oldZkey === "" ||
    typeof newZkey !== "string" ||
    newZkey === "" ||
    path.resolve(oldZkey) === path.resolve(newZkey)
  ) {
    throw new Error("Phase 2 contribution requires distinct old and new zkey paths");
  }
  if (typeof participantId !== "string" || !PARTICIPANT_ID_PATTERN.test(participantId)) {
    throw new Error("Phase 2 participant id has an unsafe or ambiguous format");
  }
  if (contributor !== undefined && typeof contributor !== "function") {
    throw new Error("zkey contributor must be a function");
  }
  if (typeof runtimeInspector !== "function") {
    throw new Error("snarkjs runtime inspector must be a function");
  }
  let runtimeRoot;
  if (contributor === undefined) {
    if (typeof configuredRuntimeRoot !== "string" || !path.isAbsolute(configuredRuntimeRoot)) {
      throw new Error("Phase 2 snarkjs runtime root must be absolute");
    }
    runtimeRoot = fs.realpathSync(configuredRuntimeRoot);
    if (runtimeRoot !== path.resolve(configuredRuntimeRoot)) {
      throw new Error("Phase 2 snarkjs runtime root must not traverse a symbolic link");
    }
    runtimeInspector({
      root: runtimeRoot,
      expectedSha256: expectedRuntimeSha256,
    });
  }

  // Verify the complete runtime closure before reading the secret. Then read fd 0 synchronously
  // before dynamically importing snarkjs; a parent can finish writing the pipe before a newly
  // launched Node process attaches asynchronous process.stdin listeners.
  const ownedInput = inputBytes === undefined ? fs.readFileSync(0) : Buffer.from(inputBytes);
  await withContributionEntropy({
    inputBytes: ownedInput,
    consume: async (entropy) => {
      let resolvedContributor = contributor;
      if (resolvedContributor === undefined) {
        const resolver = createRequire(path.join(runtimeRoot, "__deepfamily_contributor__.cjs"));
        const entryPath = resolver.resolve("snarkjs");
        const runtimeNodeModules = path.join(runtimeRoot, "node_modules");
        const relativeEntry = path.relative(runtimeNodeModules, fs.realpathSync(entryPath));
        if (
          relativeEntry === "" ||
          relativeEntry.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relativeEntry)
        ) {
          throw new Error("Phase 2 snarkjs entry point escapes the reviewed runtime snapshot");
        }
        const library = await import(pathToFileURL(entryPath).href);
        resolvedContributor = library.zKey?.contribute ?? library.default?.zKey?.contribute;
        if (typeof resolvedContributor !== "function") {
          throw new Error("Reviewed snarkjs runtime does not export zKey.contribute");
        }
      }
      await resolvedContributor(oldZkey, newZkey, participantId, entropy);
    },
  });
};

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  runZkeyContributionFromStdin().then(
    () => {
      // snarkjs's library API can retain idle curve workers after the output file is closed.
      // This process exists only for one contribution, so exiting here also destroys its entropy.
      process.exit(0);
    },
    (error) => {
      // Flush the diagnostic before process.exit; console.error can still be buffered when stderr
      // is a parent-owned pipe.
      fs.writeSync(2, `[zk-contribute] ${error.message}\n`);
      process.exit(1);
    },
  );
}
