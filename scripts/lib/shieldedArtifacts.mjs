import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SHIELDED_SETUP_CIRCUITS } from "./shieldedProductionSetup.mjs";

const DEFAULT_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SHA256 = /^[0-9a-f]{64}$/;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function checkedFile(root, relative, label) {
  if (typeof relative !== "string" || relative.length === 0 || path.isAbsolute(relative)) {
    throw new Error(`${label} must be a relative path inside this checkout`);
  }
  if (relative.split(/[\\/]/).includes("..")) {
    throw new Error(`${label} must stay inside this checkout`);
  }
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} escapes this checkout`);
  }
  const state = fs.lstatSync(absolute);
  if (!state.isFile() || state.isSymbolicLink()) {
    throw new Error(`${label} must be an ordinary file`);
  }
  if (!fs.realpathSync(absolute).startsWith(`${fs.realpathSync(root)}${path.sep}`)) {
    throw new Error(`${label} traverses outside this checkout`);
  }
  return absolute;
}

function checkedHash(root, relative, expected, label) {
  if (!SHA256.test(expected ?? "")) throw new Error(`${label} has no SHA-256 digest`);
  const absolute = checkedFile(root, relative, label);
  if (sha256(fs.readFileSync(absolute)) !== expected) {
    throw new Error(`${label} SHA-256 mismatch: ${relative}`);
  }
  return absolute;
}

export function currentShieldedCandidateManifest({ root = DEFAULT_ROOT } = {}) {
  return fs.existsSync(path.join(root, "circuits/shielded-production-manifest.json"))
    ? "circuits/shielded-production-manifest.json"
    : "circuits/shielded-development-manifest.json";
}

/**
 * Accepts the eight pinned public artifact sets and the named contract verifiers of the seven
 * pool verifier routes. The receive-code circuit is verified in the browser and has no contract.
 */
export function loadCandidateArtifacts({
  root = DEFAULT_ROOT,
  candidateManifest = currentShieldedCandidateManifest({ root }),
}) {
  root = path.resolve(root);
  const manifestFile = checkedFile(root, candidateManifest, "candidate manifest");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const development = manifest.schema === "deepfamily/shielded-development-keys@1";
  const productionCandidate = manifest.schema === "deepfamily/shielded-production-artifacts@1";
  if (!development && !productionCandidate) throw new Error("Unknown shielded candidate schema");
  if (development && (manifest.developmentOnly !== true || manifest.productionReady !== false)) {
    throw new Error("Development candidate manifest must remain development-only");
  }
  if (
    productionCandidate &&
    (manifest.status !== "production" ||
      manifest.developmentOnly !== false ||
      manifest.productionReady !== true)
  ) {
    throw new Error("Production candidate manifest has inconsistent status flags");
  }
  const expectedActions = Object.keys(SHIELDED_SETUP_CIRCUITS).sort();
  if (
    Object.keys(manifest.circuits ?? {})
      .sort()
      .join(",") !== expectedActions.join(",")
  ) {
    throw new Error("Candidate manifest must contain exactly the eight shielded circuits");
  }
  const circuits = {};
  for (const [action, spec] of Object.entries(SHIELDED_SETUP_CIRCUITS)) {
    const { source, verifierContractName: contractName, verifierPath } = spec;
    const item = manifest.circuits[action];
    if (item?.source !== source) throw new Error(`${action} candidate circuit source is wrong`);
    if (
      (item.verifierPath ?? null) !== verifierPath ||
      (item.verifierContractName ?? null) !== contractName
    ) {
      throw new Error(`${action} verifier identity differs from its circuit action`);
    }
    const verifier =
      verifierPath &&
      checkedHash(
        root,
        verifierPath,
        development ? item.solidityVerifierSha256 : item.verifierSha256,
        `${action} verifier`,
      );
    checkedHash(root, `circuits/${source}.circom`, item.sourceSha256, `${action} source`);
    const r1cs = checkedHash(
      root,
      `zk-artifacts/shielded/${source}.r1cs`,
      item.r1csSha256,
      `${action} R1CS`,
    );
    checkedHash(
      root,
      `zk-artifacts/shielded/${source}_js/${source}.wasm`,
      item.wasmSha256,
      `${action} WASM`,
    );
    const browser = `frontend/public/zk/shielded/${source}`;
    const wasm = checkedHash(root, `${browser}.wasm`, item.wasmSha256, `${action} public WASM`);
    const zkey = checkedHash(root, `${browser}_final.zkey`, item.zkeySha256, `${action} zkey`);
    const vkey = checkedHash(
      root,
      `${browser}.vkey.json`,
      item.verificationKeySha256,
      `${action} verification key`,
    );
    const expectedSignals = spec.publicSignals;
    if (JSON.parse(fs.readFileSync(vkey, "utf8")).nPublic !== expectedSignals) {
      throw new Error(`${action} verification key has the wrong public-signal count`);
    }
    if (productionCandidate && item.publicSignals !== expectedSignals) {
      throw new Error(`${action} production candidate manifest has the wrong public-signal count`);
    }
    circuits[action] = { source, verifier, r1cs, wasm, zkey, vkey, contractName };
  }
  return {
    candidateClass: development ? "development-only" : "production-candidate-unapproved",
    candidateManifestSha256: sha256(fs.readFileSync(manifestFile)),
    manifest,
    circuits,
  };
}
