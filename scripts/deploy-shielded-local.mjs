#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import hre from "hardhat";
import { id } from "ethers";

import {
  compileCandidateVerifiers,
  loadCandidateArtifacts,
} from "./shielded-testnet-rehearsal.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEPLOYMENTS = path.join(ROOT, "deployments", "localhost");
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

/** Runs before candidate compilation or any deployment transaction. */
export async function assertLocalShieldedDevelopmentNetwork(connection) {
  if (connection.networkName !== "localhost" || connection.networkConfig?.type !== "http") {
    throw new Error("Shielded development deployment requires the named localhost network");
  }
  const configuredUrl =
    typeof connection.networkConfig.url?.get === "function"
      ? await connection.networkConfig.url.get()
      : connection.networkConfig.url;
  const endpoint = new URL(configuredUrl);
  if (
    endpoint.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new Error("Shielded development RPC must be local loopback HTTP");
  }
  const [raw, network] = await Promise.all([
    connection.ethers.provider.send("eth_chainId", []),
    connection.ethers.provider.getNetwork(),
  ]);
  if (BigInt(raw) !== 31337n || network.chainId !== 31337n) {
    throw new Error("Shielded development deployment requires chain ID 31337");
  }
}

async function readDeployment(name) {
  const record = JSON.parse(await fs.readFile(path.join(DEPLOYMENTS, `${name}.json`), "utf8"));
  if (!record?.address) throw new Error(`${name} local deployment has no address`);
  return record;
}

async function writeDeployment(name, record) {
  await fs.mkdir(DEPLOYMENTS, { recursive: true });
  const file = path.join(DEPLOYMENTS, `${name}.json`);
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
}

async function deploy(factory, args = []) {
  const contract = await factory.deploy(...args);
  const receipt = await contract.deploymentTransaction()?.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error("Shielded development deployment failed");
  return { contract, address: await contract.getAddress(), deploymentBlock: receipt.blockNumber };
}

async function sourceDeployment(ethers) {
  // Older local address books may include this marker. The live RPC chain ID is
  // already checked above, and current Hardhat deployments need not write it.
  try {
    const chainId = (await fs.readFile(path.join(DEPLOYMENTS, ".chainId"), "utf8")).trim();
    if (chainId !== "31337") throw new Error("Local deployment address book is for another chain");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const [familyRecord, lineageRecord] = await Promise.all([
    readDeployment("DeepFamily"),
    readDeployment("DeepFamilyLineageIndex"),
  ]);
  const [familyCode, lineageCode] = await Promise.all([
    ethers.provider.getCode(familyRecord.address),
    ethers.provider.getCode(lineageRecord.address),
  ]);
  if (familyCode === "0x" || lineageCode === "0x") {
    throw new Error("Existing DeepFamily or lineage deployment has no code on localhost");
  }
  const family = await ethers.getContractAt("DeepFamily", familyRecord.address);
  const lineage = await ethers.getContractAt("DeepFamilyLineageIndex", lineageRecord.address);
  const [familyLineage, indexFamily, indexKind, apiVersion, token] = await Promise.all([
    family.lineageIndex(),
    lineage.DEEP_FAMILY(),
    lineage.indexKind(),
    lineage.apiVersion(),
    family.DEEP_FAMILY_TOKEN_CONTRACT(),
  ]);
  if (
    ethers.getAddress(familyLineage) !== ethers.getAddress(lineageRecord.address) ||
    ethers.getAddress(indexFamily) !== ethers.getAddress(familyRecord.address) ||
    indexKind !== id("deepfamily.lineage-index.v1") ||
    apiVersion !== 1n ||
    (await ethers.provider.getCode(token)) === "0x"
  ) {
    throw new Error(
      "Existing DeepFamily, 64-depth lineage and DEEP token are not coherently bound",
    );
  }
  return { token: ethers.getAddress(token), lineage: ethers.getAddress(lineageRecord.address) };
}

async function reusableDeployment(ethers, candidateHash, source) {
  try {
    const [pool, registry] = await Promise.all([
      readDeployment("ShieldedDeepPool"),
      readDeployment("ShieldedHeirKeyRegistry"),
    ]);
    if (
      pool.developmentOnly !== true ||
      registry.developmentOnly !== true ||
      pool.candidateManifestSha256 !== candidateHash ||
      registry.candidateManifestSha256 !== candidateHash ||
      !Number.isSafeInteger(pool.deploymentBlock) ||
      !Number.isSafeInteger(registry.deploymentBlock)
    ) {
      return null;
    }
    if (
      (await ethers.provider.getCode(pool.address)) === "0x" ||
      (await ethers.provider.getCode(registry.address)) === "0x"
    ) {
      return null;
    }
    const poolContract = await ethers.getContractAt("ShieldedDeepPool", pool.address);
    const keyContract = await ethers.getContractAt("ShieldedHeirKeyRegistry", registry.address);
    const [token, lineage, keyRegistry, keyLineage] = await Promise.all([
      poolContract.TOKEN(),
      poolContract.LINEAGE_INDEX(),
      poolContract.KEY_REGISTRY(),
      keyContract.LINEAGE_INDEX(),
    ]);
    if (
      ethers.getAddress(token) !== source.token ||
      ethers.getAddress(lineage) !== source.lineage ||
      ethers.getAddress(keyRegistry) !== ethers.getAddress(registry.address) ||
      ethers.getAddress(keyLineage) !== source.lineage
    ) {
      return null;
    }
    return { pool, registry, reused: true };
  } catch {
    return null;
  }
}

/** Installs real development verifiers for localhost only; no mock verifier secures funds. */
export async function deployShieldedDevelopmentSystem(connection) {
  await assertLocalShieldedDevelopmentNetwork(connection);
  const { ethers } = connection;
  const source = await sourceDeployment(ethers);
  const candidate = loadCandidateArtifacts({
    root: ROOT,
    candidateManifest: "zk-artifacts/shielded/development-manifest.json",
    verifierDirectory: "zk-artifacts/shielded/verifiers",
  });
  if (candidate.candidateClass !== "development-only") {
    throw new Error("Local development requires development-only proof artifacts");
  }
  const existing = await reusableDeployment(ethers, candidate.candidateManifestSha256, source);
  if (existing) return existing;

  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("No local deployment signer");
  const artifacts = await compileCandidateVerifiers(candidate, { root: ROOT });
  const rawVerifiers = {};
  for (const [action, artifact] of Object.entries(artifacts)) {
    const factory = new ethers.ContractFactory(
      artifact.abi,
      `0x${artifact.evm.bytecode.object}`,
      signer,
    );
    rawVerifiers[action] = await deploy(factory);
  }
  const adapterFactory = await ethers.getContractFactory("ShieldedGroth16ActionAdapter", signer);
  const adapters = [];
  for (const [actionId, action] of ACTIONS.entries()) {
    adapters.push(await deploy(adapterFactory, [rawVerifiers[action].address, actionId]));
  }
  const poseidon3 = await deploy(await ethers.getContractFactory("PoseidonT3", signer));
  const poseidon6 = await deploy(await ethers.getContractFactory("PoseidonT6", signer));
  const registryFactory = await ethers.getContractFactory("ShieldedHeirKeyRegistry", {
    signer,
    libraries: { PoseidonT3: poseidon3.address, PoseidonT6: poseidon6.address },
  });
  const registry = await deploy(registryFactory, [
    source.lineage,
    rawVerifiers.keyRegistration.address,
  ]);
  const poolFactory = await ethers.getContractFactory("ShieldedDeepPool", {
    signer,
    libraries: { PoseidonT3: poseidon3.address },
  });
  const pool = await deploy(poolFactory, [
    source.token,
    source.lineage,
    registry.address,
    adapters.map((entry) => entry.address),
  ]);
  const common = {
    developmentOnly: true,
    candidateManifestSha256: candidate.candidateManifestSha256,
    lineageIndex: source.lineage,
    token: source.token,
  };
  const registryRecord = {
    address: registry.address,
    abi: (await hre.artifacts.readArtifact("ShieldedHeirKeyRegistry")).abi,
    deploymentBlock: registry.deploymentBlock,
    ...common,
  };
  const poolRecord = {
    address: pool.address,
    abi: (await hre.artifacts.readArtifact("ShieldedDeepPool")).abi,
    deploymentBlock: pool.deploymentBlock,
    keyRegistry: registry.address,
    ...common,
  };
  await writeDeployment("ShieldedHeirKeyRegistry", registryRecord);
  await writeDeployment("ShieldedDeepPool", poolRecord);
  return { pool: poolRecord, registry: registryRecord, reused: false };
}
