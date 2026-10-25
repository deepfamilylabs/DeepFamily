#!/usr/bin/env node
// Isolated local development keys for the receive protocol. This command never
// modifies production manifests, production proving files or existing keys.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AbiCoder } from "ethers";
import { inspectSnarkjsRuntime } from "./lib/snarkjsToolchain.mjs";
import { assertLocalCircomInstallation } from "./fetch-circom.mjs";
import { CIRCOM_VERSION } from "./lib/circomToolchain.mjs";

import { PROTOCOL_CIRCUITS } from "./lib/protocolCircuitCatalog.mjs";
export { PROTOCOL_CIRCUITS };
export const PROTOCOL_ARTIFACT_DIRECTORY = "zk-artifacts/protocol";
export const PROTOCOL_PUBLIC_DIRECTORY = "frontend/public/zk/protocol";
export const PROTOCOL_DEVELOPMENT_MANIFEST = "circuits/receive-development-manifest.json";
const ROOT = path.resolve(import.meta.dirname, "..");
const INCLUDE_ARGUMENTS = ["-l", "node_modules", "-l", "node_modules/circomlib/circuits"];
const FLAGS = ["--r1cs", "--wasm", "--sym", "--O2", "--sanity_check", "2"];
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const relative = (root, file) => path.relative(root, file).split(path.sep).join("/");
const saveJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
let snarkjsPromise;
async function snarkjsRuntime() {
  // snarkjs uses this during its first curve initialization. Limit local
  // development workers to keep builds/proofs useful on ordinary laptops.
  if (!snarkjsPromise) {
    snarkjsPromise = (async () => {
      const cpus = os.cpus;
      os.cpus = () => cpus().slice(0, 2);
      try {
        const snarkjs = await import("snarkjs");
        await (await import("ffjavascript")).buildBn128();
        return snarkjs;
      } finally {
        os.cpus = cpus;
      }
    })();
  }
  return snarkjsPromise;
}

export function protocolArtifactPaths(circuit, { root = ROOT } = {}) {
  const spec = PROTOCOL_CIRCUITS[circuit];
  if (!spec) throw new Error(`Unknown protocol circuit: ${circuit}`);
  const directory = path.join(root, PROTOCOL_ARTIFACT_DIRECTORY);
  const publicDirectory = path.join(root, PROTOCOL_PUBLIC_DIRECTORY);
  return {
    ...spec,
    directory,
    publicDirectory,
    r1cs: path.join(directory, `${spec.source}.r1cs`),
    compiledWasm: path.join(directory, `${spec.source}_js`, `${spec.source}.wasm`),
    wasm: path.join(publicDirectory, `${spec.source}.wasm`),
    zkey: path.join(publicDirectory, `${spec.source}_final.zkey`),
    vkey: path.join(publicDirectory, `${spec.source}.vkey.json`),
    solidity: path.join(root, "contracts/generated/protocol", `${spec.contract}.sol`),
  };
}

function sourceSnapshot(root, entry) {
  const sources = {};
  const visit = (file) => {
    const name = relative(root, file);
    if (Object.hasOwn(sources, name)) return;
    if (name.startsWith("../") || path.isAbsolute(name))
      throw new Error("Circuit source escapes workspace");
    sources[name] = sha256(file);
    const source = fs.readFileSync(file, "utf8");
    for (const [, include] of source.matchAll(/include\s+"([^"\n]+)"\s*;/gu)) {
      const candidate = [
        path.dirname(file),
        path.join(root, "node_modules"),
        path.join(root, "node_modules/circomlib/circuits"),
      ]
        .map((directory) => path.resolve(directory, include))
        .find((file) => fs.existsSync(file));
      if (!candidate) throw new Error(`Unresolved Circom include ${include}`);
      visit(candidate);
    }
  };
  visit(path.join(root, "circuits", `${entry}.circom`));
  return Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)));
}

// Binary headers are enough to inspect capacity and public arity, without
// loading constraints or creating another ffjavascript curve/worker pool.
function binarySections(file, magic) {
  const bytes = fs.readFileSync(file);
  if (bytes.subarray(0, 4).toString("ascii") !== magic) throw new Error(`Invalid ${magic} file`);
  const sections = new Map();
  const count = bytes.readUInt32LE(8);
  let offset = 12;
  for (let i = 0; i < count; i++) {
    const type = bytes.readUInt32LE(offset),
      size = Number(bytes.readBigUInt64LE(offset + 4));
    if (sections.has(type)) throw new Error(`Duplicate binary section ${type}`);
    sections.set(type, bytes.subarray(offset + 12, offset + 12 + size));
    offset += 12 + size;
  }
  if (offset !== bytes.length) throw new Error("Truncated binary artifact");
  return sections;
}
function r1csHeader(file) {
  const header = binarySections(file, "r1cs").get(1);
  if (!header) throw new Error("R1CS header missing");
  const offset = 4 + header.readUInt32LE(0);
  return {
    wires: header.readUInt32LE(offset),
    outputs: header.readUInt32LE(offset + 4),
    inputs: header.readUInt32LE(offset + 8),
    constraints: header.readUInt32LE(offset + 24),
  };
}
function ptauCapacity(file) {
  const sections = binarySections(file, "ptau"),
    header = sections.get(1);
  if (!header || !sections.has(12)) throw new Error("Powers of Tau must be prepared for phase 2");
  return header.readUInt32LE(4 + header.readUInt32LE(0));
}
function blankManifest(root, compiler) {
  return {
    schemaVersion: 1,
    protocol: "deepfamily.receive",
    environment: "development",
    production: false,
    trustModel: "Local development setup only; these keys are not approved for production",
    compiler: {
      path: relative(root, compiler.path),
      sha256: compiler.sha256,
      version: `circom compiler ${compiler.version}`,
      flags: FLAGS,
    },
    snarkjsRuntimeSha256: inspectSnarkjsRuntime({ root }).sha256,
    circuits: {},
  };
}
function assertDevelopment(manifest) {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.protocol !== "deepfamily.receive" ||
    manifest.environment !== "development" ||
    manifest.production !== false
  )
    throw new Error("Expected isolated receive protocol development manifest");
}
function readManifest(root) {
  const file = path.join(root, PROTOCOL_DEVELOPMENT_MANIFEST);
  if (!fs.existsSync(file))
    throw new Error(
      `Receive protocol manifest missing; restore ${PROTOCOL_DEVELOPMENT_MANIFEST}. ` +
      "Creating replacement development keys requires an explicit npm run zk:dev.",
    );
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  assertDevelopment(manifest);
  return manifest;
}

export async function buildProtocolDevelopment({
  root = ROOT,
  circuits = Object.keys(PROTOCOL_CIRCUITS),
} = {}) {
  fs.mkdirSync(path.join(root, PROTOCOL_ARTIFACT_DIRECTORY), { recursive: true });
  fs.mkdirSync(path.join(root, PROTOCOL_PUBLIC_DIRECTORY), { recursive: true });
  const compiler = await assertLocalCircomInstallation({ root });
  const current = blankManifest(root, compiler);
  const manifestFile = path.join(root, PROTOCOL_DEVELOPMENT_MANIFEST);
  const manifest = fs.existsSync(manifestFile) ? readManifest(root) : current;
  manifest.compiler = current.compiler;
  manifest.snarkjsRuntimeSha256 = current.snarkjsRuntimeSha256;
  for (const circuit of circuits) {
    const files = protocolArtifactPaths(circuit, { root });
    const sources = sourceSnapshot(root, files.source);
    console.log(`[protocol-zk] compile ${circuit}`);
    execFileSync(
      compiler.path,
      [`circuits/${files.source}.circom`, ...FLAGS, ...INCLUDE_ARGUMENTS, "-o", files.directory],
      { cwd: root, stdio: "inherit" },
    );
    if (JSON.stringify(sources) !== JSON.stringify(sourceSnapshot(root, files.source)))
      throw new Error("Circuit sources changed during compilation");
    const header = r1csHeader(files.r1cs);
    if (header.outputs + header.inputs !== files.publicSignals)
      throw new Error(`Unexpected ${circuit} public-signal count`);
    fs.copyFileSync(files.compiledWasm, files.wasm);
    // A fresh compilation invalidates any prior setup. Setup must explicitly
    // authenticate this new R1CS before proving is allowed again.
    manifest.circuits[circuit] = {
      source: files.source,
      contract: files.contract,
      publicSignals: files.publicSignals,
      ...header,
      sources,
      compiled: {
        [relative(root, files.r1cs)]: sha256(files.r1cs),
        [relative(root, files.wasm)]: sha256(files.wasm),
      },
    };
    saveJson(manifestFile, manifest);
  }
  return manifest;
}

function verifyFiles(root, entries, label) {
  for (const [file, hash] of Object.entries(entries ?? {})) {
    if (!/^[a-f0-9]{64}$/u.test(hash) || sha256(path.join(root, file)) !== hash)
      throw new Error(`${label} hash mismatch: ${file}`);
  }
}
export function inspectProtocolArtifacts({
  root = ROOT,
  circuits = Object.keys(PROTOCOL_CIRCUITS),
  requireSetup = true,
  requireCompiled = false,
} = {}) {
  const manifest = readManifest(root);
  if (
    !["bin/circom", "bin/circom.exe"].includes(manifest.compiler?.path) ||
    manifest.compiler?.version !== `circom compiler ${CIRCOM_VERSION}` ||
    !/^[a-f0-9]{64}$/u.test(manifest.compiler?.sha256 ?? "") ||
    JSON.stringify(manifest.compiler?.flags) !== JSON.stringify(FLAGS) ||
    !/^[a-f0-9]{64}$/u.test(manifest.snarkjsRuntimeSha256 ?? "")
  )
    throw new Error("Protocol development toolchain manifest is incomplete");
  // This is the setup compiler's provenance, not a requirement to install that
  // host's binary for proof generation. Compilation authenticates the current
  // native toolchain separately and must reproduce the pinned R1CS and WASM.
  if (inspectSnarkjsRuntime({ root }).sha256 !== manifest.snarkjsRuntimeSha256)
    throw new Error("Protocol snarkjs runtime hash changed");
  for (const circuit of circuits) {
    const files = protocolArtifactPaths(circuit, { root }),
      entry = manifest.circuits[circuit];
    if (
      !entry ||
      entry.source !== files.source ||
      entry.contract !== files.contract ||
      entry.publicSignals !== files.publicSignals
    )
      throw new Error(`Protocol ${circuit} manifest entry is missing or incompatible`);
    if (JSON.stringify(entry.sources) !== JSON.stringify(sourceSnapshot(root, files.source)))
      throw new Error(
        `Protocol ${circuit} circuit sources changed; rebuild and set up development artifacts`,
      );
    if (
      JSON.stringify(Object.keys(entry.compiled ?? {}).sort()) !==
      JSON.stringify([relative(root, files.r1cs), relative(root, files.wasm)].sort())
    )
      throw new Error(`Protocol ${circuit} compiled artifact list is incomplete`);
    verifyFiles(root, { [relative(root, files.wasm)]: entry.compiled[relative(root, files.wasm)] }, "Witness artifact");
    if (requireCompiled) {
      verifyFiles(root, { [relative(root, files.r1cs)]: entry.compiled[relative(root, files.r1cs)] }, "R1CS artifact");
      if (sha256(files.compiledWasm) !== entry.compiled[relative(root, files.wasm)])
        throw new Error(`Protocol ${circuit} local witness build differs from its pinned artifact`);
    }
    if (requireSetup) {
      if (
        entry.setup?.production !== false ||
        !entry.setup?.artifacts ||
        Object.keys(entry.setup.artifacts).length !== 3
      )
        throw new Error(`Protocol ${circuit} development setup missing`);
      if (
        JSON.stringify(Object.keys(entry.setup.artifacts).sort()) !==
        JSON.stringify(
          [
            relative(root, files.zkey),
            relative(root, files.vkey),
            relative(root, files.solidity),
          ].sort(),
        )
      )
        throw new Error(`Protocol ${circuit} setup artifact list is incomplete`);
      verifyFiles(root, entry.setup.artifacts, "Setup artifact");
      const key = JSON.parse(fs.readFileSync(files.vkey, "utf8"));
      if (
        key.protocol !== "groth16" ||
        key.curve !== "bn128" ||
        key.nPublic !== files.publicSignals
      )
        throw new Error(`Protocol ${circuit} verification key mismatch`);
    }
  }
  return manifest;
}

export async function setupProtocolDevelopment({
  root = ROOT,
  circuits = Object.keys(PROTOCOL_CIRCUITS),
  ptauPath,
} = {}) {
  const manifest = inspectProtocolArtifacts({ root, circuits, requireSetup: false, requireCompiled: true });
  const candidates = ptauPath
    ? [path.resolve(root, ptauPath)]
    : [
        path.join(root, "circuits/ptau/ppot_0080_17.ptau"),
        path.join(root, "tmp/second-circuit-optimization-baseline/circuits/ptau/ppot_0080_17.ptau"),
        path.join(root, "tmp/zk-development/dev_phase1_final.ptau"),
      ];
  const tau = candidates.find((file) => fs.existsSync(file));
  if (!tau) throw new Error("A prepared local Powers of Tau file is required (--ptau <file>)");
  const power = ptauCapacity(tau),
    ptauHash = sha256(tau);
  // snarkjs 0.7.5's contribution verifier leaves a PTau reader unclosed.
  // Passing the already hash-checked bytes avoids leaking an OS FileHandle
  // (which is a fatal garbage-collection error on Node 26).
  const tauBytes = new Uint8Array(fs.readFileSync(tau));
  const snarkjs = await snarkjsRuntime();
  const template = fs.readFileSync(
    path.join(root, "node_modules/snarkjs/templates/verifier_groth16.sol.ejs"),
    "utf8",
  );
  fs.mkdirSync(path.join(root, "contracts/generated/protocol"), { recursive: true });
  fs.mkdirSync(path.join(root, PROTOCOL_PUBLIC_DIRECTORY), { recursive: true });
  for (const circuit of circuits) {
    const files = protocolArtifactPaths(circuit, { root }),
      entry = manifest.circuits[circuit];
    const required = Math.ceil(Math.log2(entry.constraints + entry.publicSignals + 1));
    if (required > power)
      throw new Error(`${circuit} needs Powers of Tau ${required}, available ${power}`);
    console.log(
      `[protocol-zk] setup ${circuit}: ${entry.constraints} constraints, power ${required}`,
    );
    const initial = path.join(files.directory, `${files.source}_initial.zkey`);
    const staged = path.join(files.directory, `${files.source}_staged.zkey`);
    try {
      const created = await snarkjs.zKey.newZKey(files.r1cs, tauBytes, initial);
      if (created === -1) throw new Error(`Failed ${circuit} Groth16 initial setup`);
      const contribution = await snarkjs.zKey.contribute(
        initial,
        staged,
        "receive-local-development",
        randomBytes(64).toString("hex"),
      );
      if (!(await snarkjs.zKey.verifyFromR1cs(files.r1cs, tauBytes, staged)))
        throw new Error(`${circuit} contribution verification failed`);
      const key = await snarkjs.zKey.exportVerificationKey(staged);
      if (key.nPublic !== files.publicSignals)
        throw new Error(`${circuit} setup public arity mismatch`);
      let solidity = await snarkjs.zKey.exportSolidityVerifier(staged, { groth16: template });
      solidity = solidity.replace("contract Groth16Verifier", `contract ${files.contract}`);
      solidity = solidity.replace(
        "pragma solidity >=0.7.0 <0.9.0;",
        "// DEVELOPMENT ONLY: generated from an isolated local setup; not production keys.\npragma solidity ^0.8.24;",
      );
      fs.renameSync(staged, files.zkey);
      saveJson(files.vkey, key);
      fs.writeFileSync(files.solidity, solidity);
      entry.setup = {
        production: false,
        ptauPath: relative(root, tau),
        ptauSha256: ptauHash,
        ptauPower: power,
        contributionHash: Buffer.from(contribution).toString("hex"),
        artifacts: {
          [relative(root, files.zkey)]: sha256(files.zkey),
          [relative(root, files.vkey)]: sha256(files.vkey),
          [relative(root, files.solidity)]: sha256(files.solidity),
        },
      };
      saveJson(path.join(root, PROTOCOL_DEVELOPMENT_MANIFEST), manifest);
    } finally {
      fs.rmSync(initial, { force: true });
      fs.rmSync(staged, { force: true });
    }
  }
  if (sha256(tau) !== ptauHash) throw new Error("Powers of Tau changed during setup");
  return inspectProtocolArtifacts({ root, circuits });
}

export async function proveProtocol({ root = ROOT, circuit, witness, expectedPublicSignals } = {}) {
  inspectProtocolArtifacts({ root, circuits: [circuit] });
  const files = protocolArtifactPaths(circuit, { root }),
    snarkjs = await snarkjsRuntime();
  const result = await snarkjs.groth16.fullProve(
    witness,
    files.wasm,
    files.zkey,
    undefined,
    { singleThread: true },
    { singleThread: true },
  );
  if (
    result.publicSignals.length !== files.publicSignals ||
    (expectedPublicSignals &&
      JSON.stringify(result.publicSignals) !== JSON.stringify(expectedPublicSignals.map(String)))
  )
    throw new Error(`Protocol ${circuit} proof public signals differ from the requested action`);
  const key = JSON.parse(fs.readFileSync(files.vkey, "utf8"));
  if (!(await snarkjs.groth16.verify(key, result.publicSignals, result.proof)))
    throw new Error(`Fresh protocol ${circuit} proof did not verify`);
  const p = result.proof;
  const solidityProof = AbiCoder.defaultAbiCoder().encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]"],
    [
      p.pi_a.slice(0, 2),
      p.pi_b.slice(0, 2).map((row) => row.slice(0, 2).reverse()),
      p.pi_c.slice(0, 2),
    ],
  );
  return { ...result, solidityProof };
}

export async function verifyProtocol({ root = ROOT, circuit, proof, publicSignals } = {}) {
  inspectProtocolArtifacts({ root, circuits: [circuit] });
  const files = protocolArtifactPaths(circuit, { root });
  if (!Array.isArray(publicSignals) || publicSignals.length !== files.publicSignals) return false;
  try {
    for (const value of publicSignals)
      if (BigInt(value) < 0n || BigInt(value) >= FIELD) return false;
  } catch {
    return false;
  }
  const snarkjs = await snarkjsRuntime();
  try {
    return await snarkjs.groth16.verify(
      JSON.parse(fs.readFileSync(files.vkey, "utf8")),
      publicSignals,
      proof,
    );
  } catch {
    return false;
  }
}

export function parseProtocolArguments(argv) {
  let action;
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (["--all", "--build", "--setup", "--check"].includes(argument)) {
      if (action) throw new Error("Choose exactly one protocol development action");
      action = argument;
    } else if (["--ptau", "--circuit"].includes(argument)) {
      const value = argv[++i];
      if (
        Object.hasOwn(values, argument) ||
        typeof value !== "string" ||
        value === "" ||
        value.startsWith("--")
      )
        throw new Error(`Expected one value for ${argument}`);
      values[argument] = value;
    } else throw new Error(`Unknown protocol development argument: ${argument}`);
  }
  if (!action)
    throw new Error(
      "Usage: node scripts/protocol-zk-development.mjs <--all|--build|--setup|--check> [--ptau path] [--circuit name]",
    );
  if (values["--ptau"] && !["--all", "--setup"].includes(action))
    throw new Error("--ptau applies only to --all or --setup");
  const circuits = values["--circuit"]
    ? values["--circuit"].split(",")
    : Object.keys(PROTOCOL_CIRCUITS);
  if (new Set(circuits).size !== circuits.length)
    throw new Error("Duplicate protocol circuit name");
  for (const circuit of circuits)
    if (!PROTOCOL_CIRCUITS[circuit]) throw new Error(`Unknown protocol circuit ${circuit}`);
  return { action, circuits, ptauPath: values["--ptau"] };
}

export async function main(argv = process.argv.slice(2)) {
  const { action, circuits, ptauPath } = parseProtocolArguments(argv);
  if (action === "--all" || action === "--build") await buildProtocolDevelopment({ circuits });
  if (action === "--all" || action === "--setup")
    await setupProtocolDevelopment({ circuits, ptauPath });
  if (action === "--check") inspectProtocolArtifacts({ circuits });
  console.log(
    "[protocol-zk] Development artifacts verified; production manifests and keys are unchanged.",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`[protocol-zk] ${error.message}`);
    process.exitCode = 1;
  } finally {
    await globalThis.curve_bn128?.terminate?.();
  }
}
