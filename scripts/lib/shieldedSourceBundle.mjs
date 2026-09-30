import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHIELDED_CIRCUITS } from "./zkCircuitSelection.mjs";

const DEFAULT_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SOURCE_ROOTS = [
  "contracts/",
  "circuits/",
  "docs/",
  "frontend/",
  "hardhat/",
  "lib/",
  "packages/",
  "scripts/",
  "tasks/",
  "test/",
];
const SOURCE_SINGLETONS = new Set(["package.json", "package-lock.json", "hardhat.config.mjs"]);
const SOURCE_EXCLUSIONS = new Set([
  "circuits/shielded-production-manifest.json",
  "circuits/shielded-development-manifest.json",
  "circuits/zk-artifacts-manifest.json",
  "circuits/zk-ceremony-transcript.json",
  "contracts/PersonCommitmentVerifier.sol",
  "contracts/DisclosureBindingVerifier.sol",
  "frontend/public/zk/person_commitment.wasm",
  "frontend/public/zk/person_commitment_final.zkey",
  "frontend/public/zk/person_commitment.vkey.json",
  "frontend/public/zk/disclosure_binding.wasm",
  "frontend/public/zk/disclosure_binding_final.zkey",
  "frontend/public/zk/disclosure_binding.vkey.json",
  "contracts/ShieldedShieldVerifier.sol",
  "contracts/ShieldedCreatePolicyVerifier.sol",
  "contracts/ShieldedAllocateVerifier.sol",
  "contracts/ShieldedTopUpVerifier.sol",
  "contracts/ShieldedMergeBudgetVerifier.sol",
  "contracts/ShieldedClaimVerifier.sol",
  "contracts/ShieldedPrivateTransferVerifier.sol",
  "contracts/ShieldedUnshieldVerifier.sol",
  ...Object.values(SHIELDED_CIRCUITS).flatMap((source) => [
    `frontend/public/zk/shielded/${source}.wasm`,
    `frontend/public/zk/shielded/${source}_final.zkey`,
    `frontend/public/zk/shielded/${source}.vkey.json`,
  ]),
]);

export function checkedFile(root, relativePath, label, prefix = "") {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new Error(`${label} path is missing`);
  }
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
    throw new Error(`${label} path must stay inside the checkout`);
  }
  const normalized = relativePath.replaceAll("\\", "/");
  if (prefix && !normalized.startsWith(prefix)) {
    throw new Error(`${label} must be under ${prefix}`);
  }
  const absolute = path.resolve(root, relativePath);
  if (!absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} path escapes the checkout`);
  }
  let state;
  try {
    state = fs.lstatSync(absolute);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${label} is missing: ${relativePath}`);
    throw error;
  }
  if (!state.isFile() || state.isSymbolicLink()) {
    throw new Error(`${label} must be an ordinary file`);
  }
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(absolute);
  if (!realFile.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`${label} traverses a symbolic link outside the checkout`);
  }
  return absolute;
}

/** Hash tracked release sources; generated proof artifacts are hashed by the manifest. */
export function sourceBundleSha256(root = DEFAULT_ROOT) {
  root = path.resolve(root);
  const output = execFileSync("git", ["ls-files", "-z"], { cwd: root });
  const files = output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter(
      (file) =>
        !SOURCE_EXCLUSIONS.has(file) &&
        !file.startsWith("release-evidence/") &&
        (SOURCE_SINGLETONS.has(file) || SOURCE_ROOTS.some((prefix) => file.startsWith(prefix))),
    )
    .sort();
  const digest = createHash("sha256");
  for (const file of files) {
    const absolute = checkedFile(root, file, "tracked source");
    const fileHash = createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
    digest.update(file).update("\0").update(fileHash).update("\n");
  }
  return digest.digest("hex");
}
