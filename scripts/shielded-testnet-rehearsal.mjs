#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getAddress, id, ZeroAddress } from "ethers";

import { renameZkVerifierSource } from "./rename-zk-verifier.mjs";
import { SHIELDED_CIRCUITS } from "./zk-shielded-build.mjs";

const DEFAULT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const TESTNET_CHAIN_ID = 71n;
const ACTIONS = [
  "shield",
  "createPolicy",
  "allocate",
  "topUp",
  "mergeBudget",
  "claim",
  "privateTransfer",
  "unshield",
];
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

export function parseRehearsalArguments(argv) {
  const options = {};
  const allowed = new Set(["--candidate-manifest", "--verifier-dir", "--lineage"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--execute") {
      if (options.execute) throw new Error("--execute may be supplied only once");
      options.execute = true;
      continue;
    }
    if (!allowed.has(flag) || options[flag] !== undefined || !argv[index + 1]) {
      throw new Error(`Unexpected or incomplete rehearsal argument: ${flag}`);
    }
    options[flag] = argv[++index];
  }
  if (
    !options.execute ||
    !options["--candidate-manifest"] ||
    !options["--verifier-dir"] ||
    !options["--lineage"]
  ) {
    throw new Error(
      "Usage: node scripts/shielded-testnet-rehearsal.mjs " +
        "--execute --candidate-manifest <file> --verifier-dir <directory> --lineage <address>",
    );
  }
  let lineageAddress;
  try {
    lineageAddress = getAddress(options["--lineage"]);
  } catch {
    throw new Error("--lineage must be an EVM address");
  }
  if (lineageAddress === ZeroAddress) throw new Error("--lineage cannot be the zero address");
  return {
    candidateManifest: options["--candidate-manifest"],
    verifierDirectory: options["--verifier-dir"],
    lineageAddress,
  };
}

/** Every check here is read-only and runs before the first deployment transaction. */
export async function assertRehearsalNetwork(connection) {
  if (connection.networkName !== "confluxTestnet") {
    throw new Error("Shielded rehearsal requires the named confluxTestnet network");
  }
  const provider = connection.ethers.provider;
  const [raw, network] = await Promise.all([
    provider.send("eth_chainId", []),
    provider.getNetwork(),
  ]);
  let rawChainId;
  try {
    rawChainId = BigInt(raw);
  } catch {
    throw new Error("Testnet RPC returned an invalid raw chain ID");
  }
  if (rawChainId !== TESTNET_CHAIN_ID || network.chainId !== TESTNET_CHAIN_ID) {
    throw new Error(
      `Shielded rehearsal requires RPC chain ID 71; got raw=${rawChainId} provider=${network.chainId}`,
    );
  }
}

/** Accepts only the nine pinned candidate circuits and their exact local verifier files. */
export function loadCandidateArtifacts({
  root = DEFAULT_ROOT,
  candidateManifest,
  verifierDirectory,
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
    (manifest.developmentOnly !== false || manifest.productionReady !== true)
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
  if (
    typeof verifierDirectory !== "string" ||
    verifierDirectory.length === 0 ||
    path.isAbsolute(verifierDirectory) ||
    verifierDirectory.split(/[\\/]/).includes("..")
  ) {
    throw new Error("--verifier-dir must be inside this checkout");
  }
  const verifierRoot = path.resolve(root, verifierDirectory);
  if (!verifierRoot.startsWith(`${root}${path.sep}`)) {
    throw new Error("--verifier-dir escapes this checkout");
  }
  const circuits = {};
  for (const [action, source] of Object.entries(SHIELDED_CIRCUITS)) {
    const item = manifest.circuits[action];
    if (item?.source !== source) throw new Error(`${action} candidate circuit source is wrong`);
    const verifierRelative = productionCandidate
      ? item.verifierPath
      : path.posix.join(verifierDirectory.replaceAll("\\", "/"), `${source}.sol`);
    if (
      typeof verifierRelative !== "string" ||
      path.dirname(path.resolve(root, verifierRelative)) !== verifierRoot
    ) {
      throw new Error(`${action} verifier is outside the explicitly selected directory`);
    }
    const verifier = checkedHash(root, verifierRelative, item.verifierSha256, `${action} verifier`);
    checkedHash(root, `circuits/${source}.circom`, item.sourceSha256, `${action} source`);
    checkedHash(root, `zk-artifacts/shielded/${source}.r1cs`, item.r1csSha256, `${action} R1CS`);
    checkedHash(
      root,
      `zk-artifacts/shielded/${source}_js/${source}.wasm`,
      item.wasmSha256,
      `${action} WASM`,
    );
    const zkey = checkedHash(
      root,
      `zk-artifacts/shielded/${source}_${development ? "dev_final" : "final"}.zkey`,
      item.zkeySha256,
      `${action} zkey`,
    );
    const vkey = checkedHash(
      root,
      `zk-artifacts/shielded/${source}.vkey.json`,
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
    const contractName = development ? "Groth16Verifier" : item.verifierContractName;
    if (!/^[A-Z][A-Za-z0-9]{2,79}$/.test(contractName ?? "")) {
      throw new Error(`${action} generated verifier contract name is invalid`);
    }
    circuits[action] = { source, verifier, zkey, vkey, contractName };
  }
  return {
    candidateClass: development ? "development-only" : "production-candidate-unapproved",
    candidateManifestSha256: sha256(fs.readFileSync(manifestFile)),
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
      const expected =
        entry.contractName === "Groth16Verifier"
          ? generated
          : renameZkVerifierSource(generated, entry.contractName);
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

async function compileCandidateVerifiers(candidate, { root = DEFAULT_ROOT } = {}) {
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

async function assertLineageIndex(ethers, lineageAddress) {
  if ((await ethers.provider.getCode(lineageAddress)) === "0x") {
    throw new Error("Explicit lineage index address has no code on chain ID 71");
  }
  const index = await ethers.getContractAt("DeepFamilyLineageIndex", lineageAddress);
  const [kind, version] = await Promise.all([index.indexKind(), index.apiVersion()]);
  if (kind !== id("deepfamily.lineage-index.v1") || version !== 1n) {
    throw new Error("Explicit lineage index is not the expected 64-depth DeepFamily index");
  }
}

async function deployRecorded(label, factory, args, write) {
  const contract = await factory.deploy(...args);
  const transaction = contract.deploymentTransaction();
  if (!transaction?.hash) throw new Error(`${label} deployment has no transaction hash`);
  write({ type: "broadcast", label, txHash: transaction.hash });
  const receipt = await transaction.wait(1);
  if (receipt?.status !== 1) throw new Error(`${label} deployment reverted: ${transaction.hash}`);
  const address = await contract.getAddress();
  write({
    type: "confirmed",
    label,
    address,
    txHash: transaction.hash,
    gasUsed: receipt.gasUsed.toString(),
  });
  return contract;
}

/** Deploys a valueless TDEEP rehearsal pool. This never calls the old production deployer. */
export async function runShieldedTestnetRehearsal({
  connection,
  root = DEFAULT_ROOT,
  options,
  loadCandidate = loadCandidateArtifacts,
  verifyDerivation = verifyCandidateDerivation,
  compileVerifiers = compileCandidateVerifiers,
  write = (record) => console.log(JSON.stringify(record)),
}) {
  await assertRehearsalNetwork(connection);
  const { ethers } = connection;
  const candidate = loadCandidate({
    root,
    candidateManifest: options.candidateManifest,
    verifierDirectory: options.verifierDirectory,
  });
  verifyDerivation(candidate, { root });
  const verifierArtifacts = await compileVerifiers(candidate, { root });
  await assertLineageIndex(ethers, options.lineageAddress);
  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("Testnet rehearsal has no transaction signer");
  if ((await ethers.provider.getBalance(await signer.getAddress())) === 0n) {
    throw new Error("Testnet rehearsal signer has no CFX for gas");
  }
  const [tokenFactory, poseidon3Factory, poseidon6Factory, adapterFactory] = await Promise.all([
    ethers.getContractFactory("ShieldedPoolTokenMock", signer),
    ethers.getContractFactory("PoseidonT3", signer),
    ethers.getContractFactory("PoseidonT6", signer),
    ethers.getContractFactory("ShieldedGroth16ActionAdapter", signer),
  ]);
  write({
    type: "rehearsal-start",
    chainId: Number(TESTNET_CHAIN_ID),
    candidateClass: candidate.candidateClass,
    candidateManifestSha256: candidate.candidateManifestSha256,
    releaseEvidence: false,
    benchmarkMeasured: false,
    token: "freshly deployed, freely mintable TDEEP only",
  });
  const rawVerifiers = {};
  for (const [action, entry] of Object.entries(candidate.circuits)) {
    const artifact = verifierArtifacts[action];
    const factory = new ethers.ContractFactory(
      artifact.abi,
      `0x${artifact.evm.bytecode.object}`,
      signer,
    );
    rawVerifiers[action] = await deployRecorded(`${action}Verifier`, factory, [], write);
  }
  const adapters = [];
  for (const [actionId, action] of ACTIONS.entries()) {
    adapters.push(
      await deployRecorded(
        `${action}Adapter`,
        adapterFactory,
        [await rawVerifiers[action].getAddress(), actionId],
        write,
      ),
    );
  }
  const token = await deployRecorded("TDEEP", tokenFactory, [], write);
  const poseidon3 = await deployRecorded("PoseidonT3", poseidon3Factory, [], write);
  const poseidon6 = await deployRecorded("PoseidonT6", poseidon6Factory, [], write);
  const keyFactory = await ethers.getContractFactory("ShieldedHeirKeyRegistry", {
    signer,
    libraries: {
      PoseidonT3: await poseidon3.getAddress(),
      PoseidonT6: await poseidon6.getAddress(),
    },
  });
  const keyRegistry = await deployRecorded(
    "ShieldedHeirKeyRegistry",
    keyFactory,
    [options.lineageAddress, await rawVerifiers.keyRegistration.getAddress()],
    write,
  );
  const poolFactory = await ethers.getContractFactory("ShieldedDeepPool", {
    signer,
    libraries: { PoseidonT3: await poseidon3.getAddress() },
  });
  const pool = await deployRecorded(
    "ShieldedDeepPool",
    poolFactory,
    [
      await token.getAddress(),
      options.lineageAddress,
      await keyRegistry.getAddress(),
      await Promise.all(adapters.map((adapter) => adapter.getAddress())),
    ],
    write,
  );
  const result = {
    type: "rehearsal-deployed",
    chainId: Number(TESTNET_CHAIN_ID),
    releaseEvidence: false,
    benchmarkMeasured: false,
    candidateClass: candidate.candidateClass,
    candidateManifestSha256: candidate.candidateManifestSha256,
    lineageIndex: options.lineageAddress,
    testToken: await token.getAddress(),
    keyRegistry: await keyRegistry.getAddress(),
    pool: await pool.getAddress(),
    verifierAddresses: Object.fromEntries(
      await Promise.all(
        Object.entries(rawVerifiers).map(async ([action, verifier]) => [
          action,
          await verifier.getAddress(),
        ]),
      ),
    ),
    adapterAddresses: await Promise.all(adapters.map((adapter) => adapter.getAddress())),
  };
  write(result);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseRehearsalArguments(process.argv.slice(2));
    // Refresh the project's compiled pool, registry, mock-token and library
    // artifacts before Hardhat loads them for this rehearsal.
    execFileSync("npm", ["run", "build"], { cwd: DEFAULT_ROOT, stdio: "inherit" });
    process.env.HARDHAT_CONFIG = path.join(DEFAULT_ROOT, "hardhat.config.mjs");
    const hre = (await import("hardhat")).default;
    const connection = await hre.network.connect("confluxTestnet");
    await runShieldedTestnetRehearsal({ connection, options });
  } catch (error) {
    console.error(`[shielded-testnet-rehearsal] ${error.message}`);
    process.exitCode = 1;
  }
}
