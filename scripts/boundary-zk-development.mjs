#!/usr/bin/env node
// DEVELOPMENT ONLY: explicit local setup for the three current asset boundaries.
// Identity and production ceremony manifests are never written by this command.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runZkBuild } from "./zk-build.mjs";
import { assertLocalCircomInstallation } from "./fetch-circom.mjs";
import { CIRCOM_ARTIFACT_FLAGS, CIRCOM_VERSION } from "./lib/circomToolchain.mjs";
import { inspectSnarkjsRuntime } from "./lib/snarkjsToolchain.mjs";
import { SHIELDED_DEPLOYMENT_CIRCUITS } from "./lib/zkDeploymentCatalog.mjs";
import { BOUNDARY_DEVELOPMENT_MANIFEST } from "./lib/canonicalBoundaryArtifacts.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
export const BOUNDARY_CIRCUITS = SHIELDED_DEPLOYMENT_CIRCUITS;
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const relative = (root, file) => path.relative(root, file).split(path.sep).join("/");
const save = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
let runtimePromise;
async function snarkjsRuntime() {
  if (!runtimePromise) runtimePromise = (async () => {
    const cpus = os.cpus;
    os.cpus = () => cpus().slice(0, 2);
    try {
      const snarkjs = await import("snarkjs");
      await (await import("ffjavascript")).buildBn128();
      return snarkjs;
    } finally { os.cpus = cpus; }
  })();
  return runtimePromise;
}

export function boundaryArtifactPaths(circuit, { root = ROOT } = {}) {
  if (!Object.hasOwn(BOUNDARY_CIRCUITS, circuit)) throw new Error(`Unknown boundary circuit: ${circuit}`);
  const spec = BOUNDARY_CIRCUITS[circuit];
  const directory = path.join(root, "zk-artifacts/shielded");
  const publicDirectory = path.join(root, "frontend/public/zk/shielded");
  return { ...spec, directory, publicDirectory,
    r1cs: path.join(directory, `${spec.source}.r1cs`),
    compiledWasm: path.join(directory, `${spec.source}_js`, `${spec.source}.wasm`),
    wasm: path.join(publicDirectory, `${spec.source}.wasm`),
    zkey: path.join(publicDirectory, `${spec.source}_final.zkey`),
    vkey: path.join(publicDirectory, `${spec.source}.vkey.json`),
    solidity: path.join(root, "contracts", `${spec.verifierContractName}.sol`),
  };
}

function selected(circuits) {
  if (!Array.isArray(circuits) || circuits.length === 0 || new Set(circuits).size !== circuits.length)
    throw new Error("Select unique current boundary circuits");
  for (const circuit of circuits) boundaryArtifactPaths(circuit);
  return circuits;
}
function readManifest(root, optional = false) {
  const file = path.join(root, BOUNDARY_DEVELOPMENT_MANIFEST);
  if (optional && !fs.existsSync(file)) return {
    schema: "deepfamily/shielded-development-keys@1", developmentOnly: true, productionReady: false, circuits: {},
  };
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (manifest.schema !== "deepfamily/shielded-development-keys@1"
    || manifest.developmentOnly !== true || manifest.productionReady !== false
    || !manifest.circuits || typeof manifest.circuits !== "object" || Array.isArray(manifest.circuits))
    throw new Error("Expected isolated boundary development manifest");
  if (Object.keys(manifest.circuits).some(circuit => !Object.hasOwn(BOUNDARY_CIRCUITS, circuit)))
    throw new Error("Boundary development manifest contains an unsupported circuit");
  return manifest;
}
function sources(root, source) {
  const result = {};
  function visit(file) {
    const name = relative(root, file);
    if (name.startsWith("../") || path.isAbsolute(name)) throw new Error("Boundary source escapes workspace");
    if (Object.hasOwn(result, name)) return;
    result[name] = hash(file);
    for (const [, include] of fs.readFileSync(file, "utf8").matchAll(/include\s+"([^"\n]+)"\s*;/gu)) {
      const target = [path.dirname(file), path.join(root, "node_modules"), path.join(root, "node_modules/circomlib/circuits")]
        .map(directory => path.resolve(directory, include)).find(candidate => fs.existsSync(candidate));
      if (!target) throw new Error(`Unresolved boundary include: ${include}`);
      visit(target);
    }
  }
  visit(path.join(root, "circuits", `${source}.circom`));
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
function sections(file, magic) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 12 || bytes.subarray(0, 4).toString("ascii") !== magic) throw new Error(`Invalid ${magic} file`);
  const result = new Map();
  let offset = 12;
  for (let index = 0; index < bytes.readUInt32LE(8); ++index) {
    if (offset + 12 > bytes.length) throw new Error("Truncated binary section");
    const kind = bytes.readUInt32LE(offset), size = Number(bytes.readBigUInt64LE(offset + 4));
    if (!Number.isSafeInteger(size) || size < 0 || offset + 12 + size > bytes.length || result.has(kind))
      throw new Error("Invalid binary section");
    result.set(kind, bytes.subarray(offset + 12, offset + 12 + size));
    offset += 12 + size;
  }
  if (offset !== bytes.length) throw new Error("Truncated binary artifact");
  return result;
}
function r1csHeader(file) {
  const header = sections(file, "r1cs").get(1);
  if (!header || header.length < 4) throw new Error("Missing R1CS header");
  const offset = 4 + header.readUInt32LE(0);
  if (offset + 28 > header.length) throw new Error("Truncated R1CS header");
  return { wires: header.readUInt32LE(offset), outputs: header.readUInt32LE(offset + 4),
    inputs: header.readUInt32LE(offset + 8), constraints: header.readUInt32LE(offset + 24) };
}
function ptauPower(file) {
  const data = sections(file, "ptau"), header = data.get(1);
  if (!header || header.length < 4 || !data.has(12)) throw new Error("Prepared phase-2 Powers of Tau required");
  const offset = 4 + header.readUInt32LE(0);
  if (offset + 4 > header.length) throw new Error("Truncated Powers of Tau header");
  return header.readUInt32LE(offset);
}

export async function buildBoundaryDevelopment({ root = ROOT, circuits = Object.keys(BOUNDARY_CIRCUITS),
  build = runZkBuild, compilerInspector = assertLocalCircomInstallation, runtimeInspector = inspectSnarkjsRuntime,
} = {}) {
  selected(circuits);
  const manifest = readManifest(root, true);
  const compiler = await compilerInspector({ root });
  if (compiler.version !== CIRCOM_VERSION) throw new Error("Unexpected boundary Circom compiler version");
  manifest.compiler = { path: relative(root, compiler.path), sha256: compiler.sha256,
    version: `circom compiler ${compiler.version}`, flags: CIRCOM_ARTIFACT_FLAGS };
  manifest.snarkjsRuntimeSha256 = runtimeInspector({ root }).sha256;
  fs.mkdirSync(path.join(root, "circuits"), { recursive: true });
  for (const circuit of circuits) {
    const files = boundaryArtifactPaths(circuit, { root }), snapshot = sources(root, files.source);
    await build({ root, circuit: `shielded:${circuit}`, compilerInspector: async () => compiler, overrideInspector: async () => null });
    if (JSON.stringify(snapshot) !== JSON.stringify(sources(root, files.source))) throw new Error("Boundary sources changed during compilation");
    const header = r1csHeader(files.r1cs);
    if (header.outputs + header.inputs !== files.publicSignals) throw new Error(`Boundary ${circuit} public arity mismatch`);
    fs.mkdirSync(files.publicDirectory, { recursive: true });
    fs.copyFileSync(files.compiledWasm, files.wasm);
    // Recompilation invalidates this circuit's setup before any new key can be used.
    manifest.circuits[circuit] = { source: files.source, sourceSha256: hash(path.join(root, "circuits", `${files.source}.circom`)),
      sources: snapshot, ...header, publicSignals: files.publicSignals,
      r1csSha256: hash(files.r1cs), wasmSha256: hash(files.wasm),
      verifierPath: relative(root, files.solidity), verifierContractName: files.verifierContractName };
    save(path.join(root, BOUNDARY_DEVELOPMENT_MANIFEST), manifest);
  }
  return manifest;
}

export function inspectBoundaryDevelopment({ root = ROOT, circuits = Object.keys(BOUNDARY_CIRCUITS),
  requireSetup = true, runtimeInspector = inspectSnarkjsRuntime,
} = {}) {
  selected(circuits);
  const manifest = readManifest(root);
  if (manifest.compiler?.version !== `circom compiler ${CIRCOM_VERSION}`
    || !/^[a-f0-9]{64}$/u.test(manifest.compiler?.sha256 ?? "")
    || JSON.stringify(manifest.compiler?.flags) !== JSON.stringify(CIRCOM_ARTIFACT_FLAGS)
    || manifest.snarkjsRuntimeSha256 !== runtimeInspector({ root }).sha256)
    throw new Error("Boundary development toolchain changed or is incomplete");
  for (const circuit of circuits) {
    const files = boundaryArtifactPaths(circuit, { root }), entry = manifest.circuits[circuit];
    if (!entry || entry.source !== files.source || entry.verifierPath !== relative(root, files.solidity)
      || entry.verifierContractName !== files.verifierContractName || entry.publicSignals !== files.publicSignals
      || JSON.stringify(entry.sources) !== JSON.stringify(sources(root, files.source)))
      throw new Error(`Boundary ${circuit} source or catalogue mismatch`);
    const required = [[files.r1cs, entry.r1csSha256], [files.compiledWasm, entry.wasmSha256], [files.wasm, entry.wasmSha256]];
    if (requireSetup) required.push([files.zkey, entry.zkeySha256], [files.vkey, entry.verificationKeySha256], [files.solidity, entry.solidityVerifierSha256]);
    for (const [file, digest] of required) if (!/^[a-f0-9]{64}$/u.test(digest ?? "") || hash(file) !== digest)
      throw new Error(`Boundary ${circuit} artifact hash mismatch: ${relative(root, file)}`);
    if (requireSetup) {
      const key = JSON.parse(fs.readFileSync(files.vkey, "utf8"));
      if (key.protocol !== "groth16" || key.curve !== "bn128" || key.nPublic !== files.publicSignals)
        throw new Error(`Boundary ${circuit} verification key mismatch`);
    }
  }
  return manifest;
}

export async function setupBoundaryDevelopment({ root = ROOT, circuits = Object.keys(BOUNDARY_CIRCUITS), ptauPath,
  runtime = snarkjsRuntime, runtimeInspector = inspectSnarkjsRuntime,
} = {}) {
  const manifest = inspectBoundaryDevelopment({ root, circuits, requireSetup: false, runtimeInspector });
  const tau = path.resolve(root, ptauPath ?? "circuits/ptau/ppot_0080_17.ptau");
  const power = ptauPower(tau), ptauHash = hash(tau);
  // snarkjs' contribution verifier can leave a PTau reader open. Bytes avoid an OS FileHandle leak.
  const tauBytes = new Uint8Array(fs.readFileSync(tau));
  const snarkjs = await runtime();
  const template = fs.readFileSync(path.join(root, "node_modules/snarkjs/templates/verifier_groth16.sol.ejs"), "utf8");
  for (const circuit of circuits) {
    const files = boundaryArtifactPaths(circuit, { root }), entry = manifest.circuits[circuit];
    const required = Math.ceil(Math.log2(entry.constraints + files.publicSignals + 1));
    if (required > power) throw new Error(`Boundary ${circuit} needs Powers of Tau ${required}, available ${power}`);
    console.log(`[boundary-zk] setup ${circuit}: ${entry.constraints} constraints, power ${required}`);
    const initial = path.join(files.directory, `${files.source}_initial.zkey`);
    const staged = path.join(files.directory, `${files.source}_staged.zkey`);
    try {
      if (await snarkjs.zKey.newZKey(files.r1cs, tauBytes, initial) === -1) throw new Error(`Boundary ${circuit} initial setup failed`);
      const contribution = await snarkjs.zKey.contribute(initial, staged, "boundary-local-development", randomBytes(64).toString("hex"));
      if (!await snarkjs.zKey.verifyFromR1cs(files.r1cs, tauBytes, staged)) throw new Error(`Boundary ${circuit} contribution verification failed`);
      const key = await snarkjs.zKey.exportVerificationKey(staged);
      if (key.protocol !== "groth16" || key.curve !== "bn128" || key.nPublic !== files.publicSignals)
        throw new Error(`Boundary ${circuit} setup verification key mismatch`);
      let solidity = await snarkjs.zKey.exportSolidityVerifier(staged, { groth16: template });
      if (!solidity.includes("contract Groth16Verifier") || !solidity.includes("pragma solidity >=0.7.0 <0.9.0;"))
        throw new Error("Unexpected generated boundary verifier template");
      solidity = solidity.replace("contract Groth16Verifier", `contract ${files.verifierContractName}`)
        .replace("pragma solidity >=0.7.0 <0.9.0;", "// DEVELOPMENT ONLY: isolated local setup; never production keys.\npragma solidity ^0.8.24;");
      if (hash(tau) !== ptauHash) throw new Error("Powers of Tau changed during boundary setup");
      fs.mkdirSync(path.dirname(files.solidity), { recursive: true });
      fs.renameSync(staged, files.zkey);
      save(files.vkey, key);
      fs.writeFileSync(files.solidity, solidity);
      Object.assign(entry, { zkeySha256: hash(files.zkey), verificationKeySha256: hash(files.vkey),
        verifierSha256: hash(files.solidity), solidityVerifierSha256: hash(files.solidity),
        contributionHash: Buffer.from(contribution).toString("hex"), ptauSha256: ptauHash, ptauPower: power });
      manifest.ptauSha256 = ptauHash;
      save(path.join(root, BOUNDARY_DEVELOPMENT_MANIFEST), manifest);
    } finally { fs.rmSync(initial, { force: true }); fs.rmSync(staged, { force: true }); }
  }
  return inspectBoundaryDevelopment({ root, circuits, runtimeInspector });
}

export function parseBoundaryArguments(argv) {
  if (!Array.isArray(argv)) throw new TypeError("Expected boundary argument array");
  let action;
  const values = {};
  for (let index = 0; index < argv.length; ++index) {
    const argument = argv[index];
    if (["--all", "--build", "--setup", "--check"].includes(argument)) {
      if (action) throw new Error("Choose exactly one boundary development action");
      action = argument;
    } else if (["--ptau", "--circuit"].includes(argument)) {
      const value = argv[++index];
      if (Object.hasOwn(values, argument) || typeof value !== "string" || value === "" || value.startsWith("--"))
        throw new Error(`Expected one value for ${argument}`);
      values[argument] = value;
    } else throw new Error(`Unknown boundary development argument: ${argument}`);
  }
  if (!action) throw new Error("Usage: boundary-zk-development.mjs <--all|--build|--setup|--check> [--ptau path] [--circuit shield|unshield|unshield4]");
  if (values["--ptau"] && !["--all", "--setup"].includes(action)) throw new Error("--ptau applies only to setup");
  const circuits = values["--circuit"] ? [values["--circuit"]] : Object.keys(BOUNDARY_CIRCUITS);
  selected(circuits);
  return { action, circuits, ptauPath: values["--ptau"] };
}
export async function main(argv = process.argv.slice(2), options = {}) {
  const { action, circuits, ptauPath } = parseBoundaryArguments(argv);
  if (["--all", "--build"].includes(action)) await buildBoundaryDevelopment({ ...options, circuits });
  if (["--all", "--setup"].includes(action)) await setupBoundaryDevelopment({ ...options, circuits, ptauPath });
  if (action === "--check") inspectBoundaryDevelopment({ ...options, circuits });
  console.log("[boundary-zk] Current local asset-boundary artifacts verified; production keys are unchanged.");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { console.error(`[boundary-zk] ${error.message}`); process.exitCode = 1; }
  finally { await globalThis.curve_bn128?.terminate?.(); }
}
