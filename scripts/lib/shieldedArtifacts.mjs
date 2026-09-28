import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { renameZkVerifierSource } from "../rename-zk-verifier.mjs";
import { SHIELDED_CIRCUITS } from "./zkCircuitSelection.mjs";

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

/** Accepts the nine pinned public artifact sets and their matching named contract verifiers. */
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
  const expectedActions = Object.keys(SHIELDED_CIRCUITS).sort();
  if (
    Object.keys(manifest.circuits ?? {})
      .sort()
      .join(",") !== expectedActions.join(",")
  ) {
    throw new Error("Candidate manifest must contain exactly the nine shielded circuits");
  }
  const circuits = {};
  for (const [action, source] of Object.entries(SHIELDED_CIRCUITS)) {
    const item = manifest.circuits[action];
    if (item?.source !== source) throw new Error(`${action} candidate circuit source is wrong`);
    const contractName = `Shielded${action[0].toUpperCase()}${action.slice(1)}Verifier`;
    const verifierRelative = `contracts/${contractName}.sol`;
    if (item.verifierPath !== verifierRelative || item.verifierContractName !== contractName) {
      throw new Error(`${action} verifier identity differs from its circuit action`);
    }
    const verifier = checkedHash(
      root,
      verifierRelative,
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
    const expectedSignals = action === "keyRegistration" ? 7 : 32;
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

/** Check that candidate Solidity and verification keys were actually exported from the candidate zkeys. */
export function verifyCandidateDerivation(candidate, { root = DEFAULT_ROOT } = {}) {
  const snarkjs = checkedFile(
    path.resolve(root),
    "node_modules/snarkjs/build/cli.cjs",
    "snarkjs CLI",
  );
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-shielded-testnet-"));
  try {
    for (const [action, entry] of Object.entries(candidate.circuits)) {
      const exportedVerifier = path.join(temporary, `${action}.sol`);
      const exportedVkey = path.join(temporary, `${action}.vkey.json`);
      execFileSync(
        process.execPath,
        [snarkjs, "zkey", "export", "solidityverifier", entry.zkey, exportedVerifier],
        {
          cwd: root,
          stdio: "pipe",
        },
      );
      execFileSync(
        process.execPath,
        [snarkjs, "zkey", "export", "verificationkey", entry.zkey, exportedVkey],
        {
          cwd: root,
          stdio: "pipe",
        },
      );
      const generated = fs.readFileSync(exportedVerifier, "utf8");
      const expected = renameZkVerifierSource(generated, entry.contractName);
      if (expected !== fs.readFileSync(entry.verifier, "utf8")) {
        throw new Error(`${action} candidate verifier is not derived from its zkey`);
      }
      if (
        JSON.stringify(JSON.parse(fs.readFileSync(exportedVkey, "utf8"))) !==
        JSON.stringify(JSON.parse(fs.readFileSync(entry.vkey, "utf8")))
      ) {
        throw new Error(`${action} candidate verification key is not derived from its zkey`);
      }
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export async function compileCandidateVerifiers(candidate, { root = DEFAULT_ROOT } = {}) {
  const hardhatCompiler = path.join(
    root,
    "node_modules/hardhat/dist/src/internal/builtin-plugins/solidity/build-system/compiler/index.js",
  );
  const { getCompiler } = await import(pathToFileURL(hardhatCompiler).href);
  const compiler = await getCompiler("0.8.28", { preferWasm: false });
  const sources = Object.fromEntries(
    Object.entries(candidate.circuits).map(([action, entry]) => [
      `${action}.sol`,
      { content: fs.readFileSync(entry.verifier, "utf8") },
    ]),
  );
  const output = await compiler.compile({
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 1 },
      viaIR: true,
      evmVersion: "cancun",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  });
  const errors = output.errors?.filter((entry) => entry.severity === "error") ?? [];
  if (errors.length > 0) {
    throw new Error(
      `Candidate verifier Solidity compilation failed: ${errors[0].formattedMessage}`,
    );
  }
  return Object.fromEntries(
    Object.entries(candidate.circuits).map(([action, entry]) => {
      const artifact = output.contracts?.[`${action}.sol`]?.[entry.contractName];
      if (!artifact?.evm?.bytecode?.object || !artifact.abi) {
        throw new Error(`${action} compiled verifier contract is missing`);
      }
      return [action, artifact];
    }),
  );
}
