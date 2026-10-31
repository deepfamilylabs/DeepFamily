import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SHIELDED_CIRCUITS, RECEIVE_PRESENTATION_CIRCUITS } from "./zkCircuitSelection.mjs";
import {
  linkedVerifierSource,
  readZkeyDeltaG1,
  readZkeyLinkParameters,
} from "./linkedVerifierSource.mjs";
import { createPrivateTemporaryDirectory } from "./privateTemporaryDirectory.mjs";
import {
  assertSnarkjsRuntimeHash,
  inspectSnarkjsRuntime,
  snapshotSnarkjsRuntime,
} from "./snarkjsToolchain.mjs";

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
  return writeLinkedReceiveArtifacts({ root, outputRoot, key, manifest });
}

async function writeLinkedReceiveArtifacts({ root, outputRoot, key, manifest }) {
  const keys = {};
  const verifiers = {};
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

/** Lightweight manifest consistency only; release checks must use verifyLinkedReceiveArtifacts. */
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
  if (Object.keys(keys).sort().join(",") !== "anonymous,fund")
    throw new Error("Receive linker requires both circuit kinds");
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
    circuitCount: 2,
    manifestSha256: sha256(read(root, manifestFile)),
    artifacts,
  };
}

/** Independently rederive the linker bundle and fixed verifiers from immutable zkey snapshots. */
export async function verifyLinkedReceiveArtifacts({
  root = process.cwd(),
  requireProduction = false,
  expectedManifestSha256,
  privateDirectoryFactory = createPrivateTemporaryDirectory,
} = {}) {
  root = fs.realpathSync(path.resolve(root));
  const inspected = inspectLinkedReceiveArtifacts({ root, requireProduction });
  if (expectedManifestSha256 !== undefined && inspected.manifestSha256 !== expectedManifestSha256) {
    throw new Error("Receive manifest changed since zkey verification");
  }
  const originals = new Map();
  const regularDigest = (file) => {
    const state = fs.lstatSync(file);
    if (!state.isFile() || state.isSymbolicLink() || fs.realpathSync(file) !== file) {
      throw new Error(`Receive artifact must be a regular non-symlink file: ${file}`);
    }
    return sha256(fs.readFileSync(file));
  };
  const pin = (relative, expected) => {
    const file = path.join(root, relative);
    const digest = regularDigest(file);
    if (expected !== undefined && digest !== expected) {
      throw new Error(`Receive artifact SHA-256 mismatch: ${relative}`);
    }
    originals.set(relative, digest);
  };
  const manifestFile = `circuits/shielded-${inspected.status}-manifest.json`;
  pin(manifestFile, inspected.manifestSha256);
  const manifest = json(root, manifestFile);
  pin(BASE_PATH, manifest.linkKeys.verifierBaseSha256);
  pin(RECEIVE_LINK_KEYS_PATH, manifest.linkKeys.sha256);
  for (const spec of Object.values(RECEIVE_PRESENTATION_CIRCUITS)) {
    pin(`contracts/${spec.contractName}.sol`, manifest.linkKeys.verifiers[spec.kind].sha256);
  }
  const actions = new Set(Object.keys(RECEIVE_PRESENTATION_CIRCUITS));
  for (const spec of Object.values(RECEIVE_PRESENTATION_CIRCUITS)) actions.add(spec.issuer);
  for (const action of actions) {
    const source = SHIELDED_CIRCUITS[action];
    const item = manifest.circuits?.[action];
    if (
      item?.source !== source ||
      !/^[0-9a-f]{64}$/u.test(item.zkeySha256 ?? "") ||
      !/^[0-9a-f]{64}$/u.test(item.verificationKeySha256 ?? "")
    ) {
      throw new Error(`${action} is missing its zkey/vkey manifest binding`);
    }
    const prefix = `frontend/public/zk/shielded/${source}`;
    pin(`${prefix}_final.zkey`, item.zkeySha256);
    pin(`${prefix}.vkey.json`, item.verificationKeySha256);
  }
  // Resolve tools from this module's installation, just like the generator. Production
  // manifests additionally bind that runtime to the reviewed ceremony toolchain.
  const toolchainRoot = fs.realpathSync(path.resolve(import.meta.dirname, "../.."));
  const runtimeDigest =
    manifest.toolchain?.snarkjsRuntimeSha256 ??
    inspectSnarkjsRuntime({ root: toolchainRoot }).sha256;
  assertSnarkjsRuntimeHash({ root: toolchainRoot, expectedSha256: runtimeDigest });
  const temporary = await privateDirectoryFactory({ prefix: "deepfamily-receive-verify-" });
  try {
    const inputRoot = path.join(temporary, "inputs");
    for (const [relative, digest] of originals) {
      const source = path.join(root, relative);
      const destination = path.join(inputRoot, relative);
      if (regularDigest(source) !== digest)
        throw new Error(`Receive artifact changed: ${relative}`);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, 0o400);
      if (regularDigest(destination) !== digest)
        throw new Error(`Receive snapshot mismatch: ${relative}`);
    }
    const runtime = snapshotSnarkjsRuntime({
      root: toolchainRoot,
      destinationRoot: path.join(temporary, "runtime"),
      expectedSha256: runtimeDigest,
    });
    const parameters = new Map();
    for (const action of actions) {
      const prefix = `frontend/public/zk/shielded/${SHIELDED_CIRCUITS[action]}`;
      const derived = await readZkeyLinkParameters({
        root: inputRoot,
        zkeyPath: `${prefix}_final.zkey`,
        runtimeRoot: runtime.root,
      });
      if (
        JSON.stringify(derived.verificationKey) !==
        JSON.stringify(json(inputRoot, `${prefix}.vkey.json`))
      ) {
        throw new Error(`${action} verification key was not derived from the zkey`);
      }
      parameters.set(action, {
        ...derived,
        verificationKeySha256: originals.get(`${prefix}.vkey.json`),
      });
    }
    const outputRoot = path.join(temporary, "derived");
    await writeLinkedReceiveArtifacts({
      root: inputRoot,
      outputRoot,
      key: async (action) => parameters.get(action),
    });
    for (const relative of [
      RECEIVE_LINK_KEYS_PATH,
      ...Object.values(RECEIVE_PRESENTATION_CIRCUITS).map(
        (spec) => `contracts/${spec.contractName}.sol`,
      ),
    ]) {
      if (!read(outputRoot, relative).equals(read(inputRoot, relative))) {
        throw new Error(`${relative} was not derived from the zkey`);
      }
    }
    // Reject changes to either the published inputs or their private snapshots while
    // deriving. Rehash the runtime too, including dependencies used by the generator.
    for (const [relative, digest] of originals) {
      if (
        regularDigest(path.join(root, relative)) !== digest ||
        regularDigest(path.join(inputRoot, relative)) !== digest
      ) {
        throw new Error(`Receive artifact changed during independent verification: ${relative}`);
      }
    }
    assertSnarkjsRuntimeHash({ root: runtime.root, expectedSha256: runtimeDigest });
    assertSnarkjsRuntimeHash({ root: toolchainRoot, expectedSha256: runtimeDigest });
    return { ...inspected, derivation: "zkey" };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
