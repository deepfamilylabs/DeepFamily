import fs from "node:fs/promises";
import path from "node:path";

const SAFE_INPUT_FILES = Object.freeze([
  "hardhat.config.mjs",
  "package.json",
  "package-lock.json",
  "scripts/espace-mainnet-safe-command.mjs",
  "scripts/espace-mainnet-safe.mjs",
  "scripts/lib/espaceMainnetSafeEvidence.mjs",
  "scripts/lib/espaceMainnetSafeIntent.mjs",
  "scripts/lib/espaceMainnetSafeSafety.mjs",
  "scripts/lib/espaceMainnetReleaseState.mjs",
  "scripts/lib/espaceReleaseEvidence.mjs",
  "scripts/lib/exclusiveCommandLock.mjs",
  "scripts/lib/governanceSafety.mjs",
  "scripts/lib/safeGovernance.mjs",
]);

/**
 * Hashes the exact tracked source and lockfile inputs used by the production Safe creator.
 * A clean commit is also required by the caller; this digest makes the reviewed report explicit
 * about the bytes that were actually executed.
 */
export const hashESpaceMainnetSafeInputs = async (ethers, root = process.cwd()) => {
  const files = {};
  const entries = [];
  for (const relativePath of SAFE_INPUT_FILES) {
    const contents = await fs.readFile(path.join(root, relativePath));
    const digest = ethers.keccak256(contents).toLowerCase();
    files[relativePath] = digest;
    entries.push(`${relativePath}:${digest}`);
  }
  return Object.freeze({
    digest: ethers.keccak256(ethers.toUtf8Bytes(entries.join("\n"))).toLowerCase(),
    files: Object.freeze(files),
  });
};

export const publicSafeCreatorError = (error, env = process.env) => {
  let message = String(error?.shortMessage || error?.reason || error?.message || error || "error");
  for (const [name, replacement] of [
    ["PRIVATE_KEY", "[REDACTED_PRIVATE_KEY]"],
    ["CONFLUX_RPC_URL", "[REDACTED_RPC_URL]"],
  ]) {
    const secret = String(env[name] ?? "");
    if (secret.length >= 4) message = message.split(secret).join(replacement);
  }
  return message.replace(/0x[0-9a-fA-F]{130,}/g, "[redacted-calldata]").slice(0, 4_000);
};
