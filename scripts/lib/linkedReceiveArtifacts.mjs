import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SHIELDED_CIRCUITS, RECEIVE_PRESENTATION_CIRCUITS } from "./zkCircuitSelection.mjs";
import { linkedVerifierSource, readZkeyDeltaG1 } from "./linkedVerifierSource.mjs";

export const RECEIVE_LINK_KEYS_PATH = "frontend/public/zk/shielded/receive-link-keys.json";
const BASE_PATH = "contracts/libraries/LinkedGroth16Verifier.sol";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const read = (root, file) => fs.readFileSync(path.join(root, file));
const json = (root, file) => JSON.parse(read(root, file));

/** Derive the small linker key bundle and fixed verifiers from the existing Circom keys. */
export async function syncLinkedReceiveArtifacts({
  root = process.cwd(),
  outputRoot = root,
  circuitFiles,
  manifest,
} = {}) {
  const keys = {};
  const verifiers = {};
  const deltas = new Map();
  const key = async (action) => {
    const prefix = `frontend/public/zk/shielded/${SHIELDED_CIRCUITS[action]}`;
    const files = circuitFiles?.[action] ?? {
      zkey: path.join(root, `${prefix}_final.zkey`),
      vkey: path.join(root, `${prefix}.vkey.json`),
    };
    if (!deltas.has(action)) deltas.set(action, await readZkeyDeltaG1(files.zkey));
    const raw = fs.readFileSync(files.vkey);
    return {
      verificationKey: JSON.parse(raw),
      deltaG1: deltas.get(action),
      verificationKeySha256: sha256(raw),
    };
  };
  for (const [action, spec] of Object.entries(RECEIVE_PRESENTATION_CIRCUITS)) {
    const issuer = await key(spec.issuer);
    const presentation = await key(action);
    if (
      issuer.verificationKey.nPublic !== spec.hiddenInputs ||
      presentation.verificationKey.nPublic !== spec.hiddenInputs + spec.publicInputs
    ) {
      throw new Error(`${spec.kind} receive linking layout differs from the configured circuits`);
    }
    keys[spec.kind] = {
      verificationKey: presentation.verificationKey,
      deltaG1: presentation.deltaG1,
      issuerDeltaG1: issuer.deltaG1,
      issuerVerificationKeySha256: issuer.verificationKeySha256,
    };
    const source = await linkedVerifierSource({
      contractName: spec.contractName,
      issuerVerificationKey: issuer.verificationKey,
      issuerDeltaG1: issuer.deltaG1,
      presentationVerificationKey: presentation.verificationKey,
      presentationDeltaG1: presentation.deltaG1,
      publicSignals: spec.publicInputs,
    });
    const file = `contracts/${spec.contractName}.sol`;
    fs.mkdirSync(path.dirname(path.join(outputRoot, file)), { recursive: true });
    fs.writeFileSync(path.join(outputRoot, file), source);
    verifiers[spec.kind] = { path: file, sha256: sha256(source) };
  }
  const raw = `${JSON.stringify(keys, null, 2)}\n`;
  fs.mkdirSync(path.dirname(path.join(outputRoot, RECEIVE_LINK_KEYS_PATH)), { recursive: true });
  fs.writeFileSync(path.join(outputRoot, RECEIVE_LINK_KEYS_PATH), raw);
  const binding = {
    path: RECEIVE_LINK_KEYS_PATH,
    sha256: sha256(raw),
    verifierBaseSha256: sha256(read(root, BASE_PATH)),
    verifiers,
  };
  if (manifest) manifest.linkKeys = binding;
  return binding;
}

/** Public transport contains only re-randomized linked proofs, never credential fields. */
export function inspectLinkedReceiveArtifacts({
  root = process.cwd(),
  requireProduction = false,
} = {}) {
  const production = fs.existsSync(path.join(root, "circuits/shielded-production-manifest.json"));
  if (requireProduction && !production)
    throw new Error("Receive presentations require production Circom artifacts");
  const manifestFile = production
    ? "circuits/shielded-production-manifest.json"
    : "circuits/shielded-development-manifest.json";
  const manifest = json(root, manifestFile);
  const binding = manifest.linkKeys;
  if (
    binding?.path !== RECEIVE_LINK_KEYS_PATH ||
    sha256(read(root, RECEIVE_LINK_KEYS_PATH)) !== binding.sha256
  ) {
    throw new Error("Receive link key bundle does not match the Circom manifest");
  }
  if (sha256(read(root, BASE_PATH)) !== binding.verifierBaseSha256)
    throw new Error("Receive linked verifier base has changed");
  const keys = json(root, RECEIVE_LINK_KEYS_PATH);
  const artifacts = {};
  if (Object.keys(keys).sort().join(",") !== "anonymous,attachment,fund")
    throw new Error("Receive linker requires all three circuit kinds");
  for (const [action, spec] of Object.entries(RECEIVE_PRESENTATION_CIRCUITS)) {
    const entry = keys[spec.kind];
    const source = SHIELDED_CIRCUITS[action];
    const circuit = manifest.circuits?.[action];
    const vkeyFile = `frontend/public/zk/shielded/${source}.vkey.json`;
    const issuerFile = `frontend/public/zk/shielded/${SHIELDED_CIRCUITS[spec.issuer]}.vkey.json`;
    if (sha256(read(root, issuerFile)) !== entry?.issuerVerificationKeySha256) {
      throw new Error(`${spec.kind} linked verifier uses a stale credential issuer key`);
    }
    if (
      circuit?.source !== source ||
      sha256(read(root, vkeyFile)) !== circuit.verificationKeySha256 ||
      JSON.stringify(entry?.verificationKey) !== JSON.stringify(json(root, vkeyFile)) ||
      entry.verificationKey.nPublic !== spec.hiddenInputs + spec.publicInputs
    ) {
      throw new Error(`${spec.kind} linked verifier uses a stale Circom presentation key`);
    }
    if (
      !Array.isArray(entry.deltaG1) ||
      entry.deltaG1.length < 2 ||
      !Array.isArray(entry.issuerDeltaG1) ||
      entry.issuerDeltaG1.length < 2
    ) {
      throw new Error(`${spec.kind} linked verifier is missing its fixed blinding bases`);
    }
    const verifier = binding.verifiers?.[spec.kind];
    if (
      verifier?.path !== `contracts/${spec.contractName}.sol` ||
      sha256(read(root, verifier.path)) !== verifier.sha256
    ) {
      throw new Error(`${spec.kind} receive Solidity verifier is stale`);
    }
    artifacts[spec.kind] = {
      circuit: action,
      source,
      publicSignals: spec.publicInputs,
      verifierPath: verifier.path,
    };
  }
  return {
    status: production ? "production" : "development",
    verification: "passed",
    circuitCount: 3,
    manifestSha256: sha256(read(root, manifestFile)),
    artifacts,
  };
}
