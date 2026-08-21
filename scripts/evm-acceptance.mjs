/**
 * Shared guarded EVM testnet acceptance engine.
 *
 * Network-specific entry files must pass an immutable chain profile. Do not invoke this shared
 * engine directly.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Contract, id as solidityId, Interface, JsonRpcProvider, keccak256 } from "ethers";
import { decryptPersonVersionRuntime } from "@deepfamily/protocol-core";

import hre from "hardhat";

import { deployIntegratedSystem } from "../hardhat/integratedDeployment.mjs";
import seedHelpers from "../lib/seedHelpers.js";
import { resolveArtifactFile } from "../lib/proofCommon.js";
import {
  DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
  PERSON_RELATION_PROOF_DESCRIPTOR,
} from "../lib/proofDescriptors.js";
import {
  assertImplementationMatchesArtifact,
  assertImplementationStorageSafe,
  deriveSalt as deriveUpgradeSalt,
} from "../tasks/lib/timelockUpgrade.mjs";
import {
  deriveAcceptanceWallets,
  hashRunId,
  parseAcceptanceConfig,
  runIdReportFileComponent,
  summarizeProductionBuildInfo,
} from "./lib/acceptanceSafety.mjs";
import { assertAcceptanceReleaseRehearsalWrapper } from "./lib/acceptanceCommandWrapper.mjs";
import {
  CANONICAL_SAFE_DEPLOYMENT_TYPE,
  CANONICAL_SAFE_VERSION,
  assertCanonicalSafeProfile,
  assertSafeExecutionSuccess,
  connectCanonicalSafe,
  createCanonicalSafeInterface,
  createCanonicalSafeTransaction,
  getCanonicalSafeDeploymentMetadata,
  prepareCanonicalSafeDeployment,
  signCanonicalSafeTransaction,
} from "./lib/safeGovernance.mjs";
import { resolveTimelockDeploymentConfig } from "./lib/timelockDeployment.mjs";
import { verifyAcceptanceContracts } from "./lib/acceptanceVerification.mjs";
import {
  buildMultisigMigrationOperation,
  readExactTimelockRoleState,
} from "../tasks/lib/timelockMultisigMigration.mjs";
import { buildOwnerMigrationOperation } from "../tasks/lib/timelockOwnerMigration.mjs";
import { deriveTreasuryTransferSalt } from "../tasks/lib/timelockTreasury.mjs";
import { deriveGovernanceSalt } from "../tasks/lib/timelockGovernance.mjs";
import { deriveDelayUpdateSalt } from "../tasks/timelock-update-delay.mjs";
import { resolveProductionRpcUrl } from "./lib/hardhatConfig.mjs";
import { ESPACE_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";
import { resolveProductionPtauPath } from "./lib/productionPtau.mjs";
import { inspectZkReleaseArtifacts } from "./lib/zkArtifactTrust.mjs";
import { inspectProtocolReleaseManifest } from "./lib/protocolReleaseManifest.mjs";
import { verifyProductionCeremony } from "./zk-ceremony-verify.mjs";
import {
  TESTNET_RELEASE_EVIDENCE_TYPE,
  TESTNET_RELEASE_REPORT_SCHEMA_VERSION,
  validateTestnetReleaseEvidence,
} from "./lib/testnetReleaseEvidence.mjs";
import { publishTestnetReleaseEvidence } from "./lib/releaseEvidencePublisher.mjs";

const { addPersonVersion, mintPersonVersionNFT } = seedHelpers;

let CHAIN_PROFILE = ESPACE_CHAIN_PROFILE;
let ACCEPTANCE_PROFILE = CHAIN_PROFILE.acceptance;
let EXPECTED_NETWORK = ACCEPTANCE_PROFILE.networkName;
let EXPECTED_CHAIN_ID = ACCEPTANCE_PROFILE.chainId;
const TX_TIMEOUT_MS = 10 * 60 * 1000;
const PROOF_TIMEOUT_MS = 5 * 60 * 1000;
const PERSON_RELATION_PURPOSE = 0;
const DISCLOSURE_BINDING_PURPOSE = 1;
const RELEASE_PERSON_RELATION_CIRCUIT_ID = 1;
const RELEASE_DISCLOSURE_BINDING_CIRCUIT_ID = 1;
const GOVERNED_PERSON_RELATION_CIRCUIT_ID = 2;
const READY_GRACE_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 2_000;
const ZERO_HASH = `0x${"0".repeat(64)}`;
const ERC1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
let REPORT_ROOT = path.join(process.cwd(), "tmp", ACCEPTANCE_PROFILE.reportDirectoryName);
let DEPLOYMENTS_DIR = path.join(process.cwd(), "deployments", EXPECTED_NETWORK);
const OWNABLE_UNAUTHORIZED_SELECTOR = solidityId("OwnableUnauthorizedAccount(address)").slice(
  0,
  10,
);
const STORY_ALREADY_SEALED_SELECTOR = solidityId("StoryAlreadySealed()").slice(0, 10);
const STANDARD_REVERT_INTERFACE = new Interface(["error Error(string)", "error Panic(uint256)"]);

const configureChainProfile = (chainProfile) => {
  if (
    !chainProfile ||
    typeof chainProfile !== "object" ||
    !chainProfile.acceptance ||
    typeof chainProfile.acceptance.networkName !== "string"
  ) {
    throw new Error("A guarded acceptance chain profile is required");
  }
  CHAIN_PROFILE = chainProfile;
  ACCEPTANCE_PROFILE = chainProfile.acceptance;
  EXPECTED_NETWORK = ACCEPTANCE_PROFILE.networkName;
  EXPECTED_CHAIN_ID = ACCEPTANCE_PROFILE.chainId;
  REPORT_ROOT = path.join(process.cwd(), "tmp", ACCEPTANCE_PROFILE.reportDirectoryName);
  DEPLOYMENTS_DIR = path.join(process.cwd(), "deployments", EXPECTED_NETWORK);
};

const nowIso = () => new Date().toISOString();
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const assertCondition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const defaultRunId = () => {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `${timestamp}-${randomBytes(4).toString("hex")}`;
};

const withTimeout = async (promise, timeoutMs, label) => {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

const retryBounded = async (operation, { attempts = 3, timeoutMs = 30_000, label }) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await withTimeout(
        Promise.resolve().then(operation),
        timeoutMs,
        `${label} attempt ${attempt}`,
      );
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 1_000);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${safeErrorMessage(lastError)}`);
};

const inspectCanonicalSafeInfrastructure = async ({ provider, chainId }) => {
  const rpcChainId = await retryBounded(() => provider.send("eth_chainId", []), {
    label: `raw Safe infrastructure chain-id query for ${chainId}`,
  });
  assertCondition(
    typeof rpcChainId === "string" && BigInt(rpcChainId) === BigInt(chainId),
    `Safe infrastructure RPC expected raw chainId ${chainId}, got ${String(rpcChainId)}`,
  );
  const network = await retryBounded(() => provider.getNetwork(), {
    label: `Safe infrastructure chain-id query for ${chainId}`,
  });
  assertCondition(
    network.chainId === BigInt(chainId),
    `Safe infrastructure provider expected chainId ${chainId}, got ${network.chainId}`,
  );
  const metadata = getCanonicalSafeDeploymentMetadata(chainId);
  const components = {};
  for (const name of ["singleton", "proxyFactory", "fallbackHandler"]) {
    const expected = metadata[name];
    const code = await retryBounded(() => provider.getCode(expected.address), {
      label: `Safe ${name} code query for chainId ${chainId}`,
    });
    assertCondition(code !== "0x", `Safe ${name} has no code on chainId ${chainId}`);
    const actualCodeHash = keccak256(code).toLowerCase();
    assertCondition(
      actualCodeHash === expected.codeHash,
      `Safe ${name} codeHash mismatch on chainId ${chainId}: expected ` +
        `${expected.codeHash}, got ${actualCodeHash}`,
    );
    components[name] = {
      address: expected.address,
      expectedCodeHash: expected.codeHash,
      actualCodeHash,
      matched: true,
    };
  }
  const proxyFactory = new Contract(
    metadata.proxyFactory.address,
    metadata.proxyFactory.abi,
    provider,
  );
  const canonicalProxyRuntimeCode = await retryBounded(() => proxyFactory.proxyRuntimeCode(), {
    label: `Safe proxy runtime query for chainId ${chainId}`,
  });
  assertCondition(
    typeof canonicalProxyRuntimeCode === "string" && canonicalProxyRuntimeCode !== "0x",
    `Safe ProxyFactory returned invalid proxy runtime code on chainId ${chainId}`,
  );
  return {
    chainId: network.chainId,
    rpcChainId,
    components,
    canonicalProxyCodeHash: keccak256(canonicalProxyRuntimeCode).toLowerCase(),
  };
};

const pollUntil = async (predicate, { timeoutMs, intervalMs = POLL_INTERVAL_MS, label }) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }
  const detail = lastError ? `; last error: ${safeErrorMessage(lastError)}` : "";
  throw new Error(`${label} timed out after ${timeoutMs}ms${detail}`);
};

const jsonReplacer = (_key, value) => (typeof value === "bigint" ? value.toString() : value);

const redactText = (value, secrets = []) => {
  let text = String(value || "Unknown error");
  const configuredSecrets = [
    process.env.CONFLUX_RPC_URL,
    process.env.CONFLUX_TESTNET_RPC_URL,
    process.env.ETHEREUM_MAINNET_RPC_URL,
    process.env.ETHEREUM_SEPOLIA_RPC_URL,
    process.env.INFURA_API_KEY,
    process.env.EXPLORER_API_KEY === "espace" ? "" : process.env.EXPLORER_API_KEY,
  ].filter((secret) => typeof secret === "string" && secret.length >= 4);
  for (const secret of [...secrets, ...configuredSecrets]) {
    if (secret) text = text.split(secret).join("[redacted-secret]");
  }
  // Ethers errors can embed raw proof calldata or 65-byte signatures. Keep ordinary addresses
  // and 32-byte transaction/operation hashes useful while removing longer opaque payloads.
  text = text
    .replace(/https?:\/\/[^\s"'<>]+/giu, "[redacted-url]")
    .replace(/0x[0-9a-fA-F]{130,}/g, (match) => `[redacted-hex:${match.length - 2}]`);
  return text.slice(0, 4_000);
};

export const safeErrorMessage = (error, secrets = []) =>
  redactText(error?.shortMessage || error?.reason || error?.message || error, secrets);

const writeJsonAtomic = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, jsonReplacer, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, filePath);
};

const gitCommit = () => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};

const gitWorkingTreeState = () => {
  try {
    const porcelain = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      encoding: "utf8",
    }).trim();
    return {
      commit: gitCommit(),
      clean: porcelain === "",
      changedPathCount: porcelain === "" ? 0 : porcelain.split("\n").length,
    };
  } catch {
    return { commit: gitCommit(), clean: null, changedPathCount: null };
  }
};

const hashDirectory = async (ethers, directory) => {
  const entries = [];
  const visit = async (current, relative = "") => {
    let children;
    try {
      children = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const childRelative = path.posix.join(relative, child.name);
      const childPath = path.join(current, child.name);
      if (child.isDirectory()) {
        await visit(childPath, childRelative);
      } else if (child.isFile()) {
        const content = await fs.readFile(childPath);
        entries.push(`${childRelative}:${ethers.keccak256(content)}`);
      }
    }
  };
  await visit(directory);
  return {
    fileCount: entries.length,
    digest: ethers.keccak256(ethers.toUtf8Bytes(entries.join("\n"))),
  };
};

const hashAcceptanceInputs = async (ethers) => {
  const directoryNames = [
    "artifacts",
    "contracts",
    "circuits",
    "hardhat",
    "lib",
    "packages",
    "protocol-vectors",
    "scripts",
    "tasks",
  ];
  const fileNames = [
    "hardhat.config.mjs",
    "package.json",
    "package-lock.json",
    "protocol-release-manifest.json",
  ];
  const entries = [];
  const directories = {};
  const files = {};
  for (const name of directoryNames) {
    const snapshot = await hashDirectory(ethers, path.join(process.cwd(), name));
    directories[name] = snapshot;
    entries.push(`directory:${name}:${snapshot.fileCount}:${snapshot.digest}`);
  }
  for (const name of fileNames) {
    const content = await fs.readFile(path.join(process.cwd(), name));
    const digest = ethers.keccak256(content);
    files[name] = digest;
    entries.push(`file:${name}:${digest}`);
  }
  return {
    digest: ethers.keccak256(ethers.toUtf8Bytes(entries.join("\n"))),
    directories,
    files,
  };
};

const readProductionBuildInfoState = async (ethers) => {
  const buildInfoDirectory = path.join(process.cwd(), "artifacts", "build-info");
  let entries;
  try {
    entries = await fs.readdir(buildInfoDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return summarizeProductionBuildInfo([]);
    throw error;
  }
  const files = entries
    .filter(
      (entry) =>
        entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".output.json"),
    )
    .map((entry) => entry.name)
    .sort();
  const records = [];
  for (const file of files) {
    const content = await fs.readFile(path.join(buildInfoDirectory, file));
    records.push({
      file: path.posix.join("artifacts", "build-info", file),
      digest: ethers.keccak256(content),
      buildInfo: JSON.parse(content.toString("utf8")),
    });
  }
  return summarizeProductionBuildInfo(records);
};

const hashProofArtifacts = async (ethers, artifacts) => {
  const evidence = {};
  for (const [kind, artifactPath] of Object.entries(artifacts)) {
    const content = await fs.readFile(artifactPath);
    const stats = await fs.stat(artifactPath);
    evidence[kind] = {
      path: path.relative(process.cwd(), artifactPath),
      bytes: stats.size,
      keccak256: ethers.keccak256(content),
    };
  }
  return evidence;
};

const resolveProofArtifacts = (descriptor, label) =>
  Object.fromEntries(
    ["wasm", "zkey"].map((kind) => [
      kind,
      resolveArtifactFile(
        `${label} ${kind}`,
        undefined,
        descriptor.files.node[kind].map((candidate) => path.resolve(process.cwd(), candidate)),
      ),
    ]),
  );

const assertProofArtifactsUnchanged = (before, after, label) => {
  for (const kind of ["wasm", "zkey"]) {
    assertCondition(
      before[kind].path === after[kind].path &&
        before[kind].bytes === after[kind].bytes &&
        before[kind].keccak256 === after[kind].keccak256,
      `${label} ${kind} changed while the proof was being generated`,
    );
  }
};

const publicReceipt = (receipt) => ({
  hash: receipt.hash,
  blockNumber: receipt.blockNumber,
  blockHash: receipt.blockHash,
  status: Number(receipt.status),
  gasUsed: receipt.gasUsed,
  gasPrice: receipt.gasPrice ?? null,
  contractAddress: receipt.contractAddress ?? null,
});

const implementationAddress = async (ethers, provider, proxyAddress) => {
  const raw = await provider.getStorage(proxyAddress, ERC1967_IMPLEMENTATION_SLOT);
  return ethers.getAddress(ethers.dataSlice(raw, 12));
};

const errorEvidence = (error) => {
  const strings = [];
  const revertData = [];
  const seen = new Set();
  const visit = (value, depth = 0) => {
    if (typeof value === "string") {
      strings.push(value);
      if (/^0x[0-9a-fA-F]{8,}$/.test(value)) revertData.push(value.toLowerCase());
      return;
    }
    if (value === null || typeof value !== "object" || depth > 5 || seen.has(value)) return;
    seen.add(value);
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(error);
  for (const value of [
    error?.name,
    error?.shortMessage,
    error?.reason,
    error?.message,
    error?.revert?.name,
    error?.errorName,
  ]) {
    if (typeof value === "string") strings.push(value);
  }
  for (const data of revertData) {
    try {
      const parsed = STANDARD_REVERT_INTERFACE.parseError(data);
      if (parsed?.name === "Error" && typeof parsed.args[0] === "string") {
        strings.push(parsed.args[0]);
      }
    } catch {
      // Custom-error selectors are matched directly by expectRevert.
    }
  }
  return { strings, revertData };
};

const expectRevert = async (
  operation,
  label,
  { expectedErrorNames = [], expectedSelectors = [], expectedMessages = [] } = {},
) => {
  try {
    await operation();
  } catch (error) {
    const evidence = errorEvidence(error);
    const matchedName = expectedErrorNames.find((name) =>
      evidence.strings.some((value) => value.includes(name)),
    );
    const normalizedSelectors = expectedSelectors.map((selector) => selector.toLowerCase());
    const matchedSelector = normalizedSelectors.find((selector) =>
      evidence.revertData.some((data) => data.startsWith(selector)),
    );
    const matchedMessage = expectedMessages.find((message) =>
      evidence.strings.some((value) => value.includes(message)),
    );
    if (matchedName || matchedSelector || matchedMessage) {
      return {
        matchedName: matchedName ?? null,
        matchedSelector: matchedSelector ?? null,
        matchedMessage: matchedMessage ?? null,
      };
    }
    throw new Error(
      `${label} failed without the expected rejection ` +
        `(errors=${expectedErrorNames.join(",") || "none"}; ` +
        `selectors=${expectedSelectors.join(",") || "none"}): ${safeErrorMessage(error)}`,
      { cause: error },
    );
  }
  throw new Error(`${label} unexpectedly succeeded`);
};

const expectSafeSimulationFailure = async ({
  provider,
  from,
  safeAddress,
  data,
  blockTag,
  safeInterface,
  label,
  expectedSafeRevertCodes,
}) => {
  let result;
  try {
    const transaction = { from, to: safeAddress, data };
    result =
      blockTag === undefined
        ? await provider.call(transaction)
        : await provider.send("eth_call", [transaction, `0x${BigInt(blockTag).toString(16)}`]);
  } catch (error) {
    const errorText = errorEvidence(error).strings.join("\n");
    const observedCodes = [...new Set(errorText.match(/\bGS\d{3}\b/g) ?? [])];
    const acceptedCodes = Array.isArray(expectedSafeRevertCodes) ? expectedSafeRevertCodes : [];
    if (observedCodes.some((code) => acceptedCodes.includes(code))) {
      return { outcome: "reverted", safeRevertCodes: observedCodes };
    }
    throw new Error(
      `${label} simulation failed without an expected Safe revert code ` +
        `(${acceptedCodes.join(", ") || "none configured"}): ${safeErrorMessage(error)}`,
      { cause: error },
    );
  }
  let innerSuccess;
  try {
    [innerSuccess] = safeInterface.decodeFunctionResult("execTransaction", result);
  } catch (error) {
    throw new Error(
      `${label} returned malformed Safe execTransaction data: ${safeErrorMessage(error)}`,
      { cause: error },
    );
  }
  if (innerSuccess === false) return { outcome: "returned-false", safeRevertCodes: [] };
  throw new Error(`${label} unexpectedly succeeded`);
};

const duplicateSafeSignatureCalldata = ({ ethers, safeInterface, encodedTransaction }) => {
  const parsed = safeInterface.parseTransaction({ data: encodedTransaction });
  assertCondition(parsed?.name === "execTransaction", "Expected Safe execTransaction calldata");
  const args = [...parsed.args];
  const signaturesIndex = args.length - 1;
  args[signaturesIndex] = ethers.concat([args[signaturesIndex], args[signaturesIndex]]);
  return safeInterface.encodeFunctionData(parsed.fragment, args);
};

const waitForReady = async (timelock, operationId, minDelay) =>
  pollUntil(
    () =>
      retryBounded(() => timelock.isOperationReady(operationId), {
        attempts: 1,
        timeoutMs: 30_000,
        label: `Timelock readiness query for ${operationId}`,
      }),
    {
      timeoutMs: minDelay * 1_000 + READY_GRACE_MS,
      label: `Timelock operation ${operationId} readiness`,
    },
  );

const verificationEntry = async (
  artifacts,
  name,
  address,
  constructorArgs = [],
  libraries = {},
) => {
  const artifact = await artifacts.readArtifact(name);
  return {
    label: name,
    address,
    contract: `${artifact.sourceName}:${artifact.contractName}`,
    constructorArgs,
    libraries,
  };
};

const verifyEntries = async (entries, report, saveReport, phase = "deployment") => {
  report.verification.status = "running";
  const phaseReport = { phase, status: "running", contracts: [] };
  report.verification.phases.push(phaseReport);
  await saveReport();
  let failures = [];
  try {
    phaseReport.contracts = await verifyAcceptanceContracts({
      hre,
      entries,
      timeoutMs: 15 * 60 * 1000,
      attemptTimeoutMs: 2 * 60 * 1000,
      retries: 2,
      logger: console,
      verificationProvider: ACCEPTANCE_PROFILE.verificationProvider,
      explorerName: ACCEPTANCE_PROFILE.explorerName,
    });
    phaseReport.status = "passed";
    report.verification.contracts.push(
      ...phaseReport.contracts.map((contract) => ({ phase, ...contract })),
    );
    report.verification.status = "passed";
  } catch (error) {
    phaseReport.contracts = Array.isArray(error.results) ? error.results : [];
    report.verification.contracts.push(
      ...phaseReport.contracts.map((contract) => ({ phase, ...contract })),
    );
    failures = phaseReport.contracts.filter((item) => item.status !== "passed");
    if (failures.length === 0) {
      failures = [{ label: "verification-batch", status: "failed" }];
    }
    phaseReport.status = "failed";
    phaseReport.error = safeErrorMessage(error);
    report.verification.status = "failed";
    report.verification.error = safeErrorMessage(error);
  }
  await saveReport();
  return failures;
};

const refundWallet = async ({ ethers, provider, wallet, recipient, confirmations }) => {
  const balanceBefore = await provider.getBalance(wallet.address);
  if (balanceBefore === 0n) {
    return { status: "not-needed", balanceBefore, amount: 0n, balanceAfter: 0n };
  }

  const feeData = await provider.getFeeData();
  const feePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (!feePerGas || feePerGas <= 0n)
    throw new Error("RPC did not return a usable gas price for refund");
  const estimatedGas = await wallet.estimateGas({ to: recipient, value: 0n });
  const gasLimit = (estimatedGas * 125n + 99n) / 100n;
  const reserve = gasLimit * feePerGas;
  if (balanceBefore <= reserve) {
    throw new Error(
      `Run deployer balance ${balanceBefore} is not enough to pay the estimated refund gas ${reserve}`,
    );
  }
  const amount = balanceBefore - reserve;
  const feeOverrides =
    feeData.maxFeePerGas != null
      ? {
          maxFeePerGas: feeData.maxFeePerGas,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n,
        }
      : { gasPrice: feeData.gasPrice };
  const tx = await wallet.sendTransaction({
    to: recipient,
    value: amount,
    gasLimit,
    ...feeOverrides,
  });
  const receipt = await tx.wait(confirmations, TX_TIMEOUT_MS);
  assertCondition(receipt, "Run-deployer refund transaction was not confirmed");
  assertCondition(Number(receipt.status) === 1, "Run-deployer refund transaction reverted");
  return {
    status: "passed",
    balanceBefore,
    amount,
    balanceAfter: await provider.getBalance(wallet.address),
    transaction: publicReceipt(receipt),
  };
};

const runRecovery = async ({ ethers, provider, config, funder, runDeployer, baseReportPath }) => {
  const recoveryPath = path.join(
    REPORT_ROOT,
    `${config.reportFileComponent}.recovery-${Date.now().toString(10)}.json`,
  );
  const report = {
    schemaVersion: TESTNET_RELEASE_REPORT_SCHEMA_VERSION,
    mode: "recovery",
    acceptanceMode: config.acceptanceMode,
    evidenceType: "recovery",
    governanceLifecycleIncluded: config.runGovernanceLifecycle,
    releaseReady: false,
    runId: config.runId,
    status: "running",
    startedAt: nowIso(),
    network: { name: EXPECTED_NETWORK, chainId: EXPECTED_CHAIN_ID },
    addresses: { funder: funder.address, runDeployer: runDeployer.address },
    sourceReport: baseReportPath,
  };
  await writeJsonAtomic(recoveryPath, report);
  try {
    report.refund = await refundWallet({
      ethers,
      provider,
      wallet: runDeployer,
      recipient: funder.address,
      confirmations: config.confirmations,
    });
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error = safeErrorMessage(error, [config.privateKey, runDeployer.privateKey]);
    throw error;
  } finally {
    report.finishedAt = nowIso();
    await writeJsonAtomic(recoveryPath, report);
    console.log(`[${CHAIN_PROFILE.id}-acceptance] recovery report: ${recoveryPath}`);
  }
};

export const main = async (chainProfile) => {
  configureChainProfile(chainProfile);
  const requestedMode = String(
    process.env[ACCEPTANCE_PROFILE.modeEnvironmentName] ?? "diagnostic",
  ).trim();
  if (requestedMode === "release-rehearsal") {
    // This must pass before opening the RPC. The wrapper keeps the production-build lock held from
    // the complete preflight through this --no-compile acceptance run.
    await assertAcceptanceReleaseRehearsalWrapper({
      chainProfile: CHAIN_PROFILE,
      environment: process.env,
      root: process.cwd(),
    });
  }
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const provider = ethers.provider;
  const rawTestnetChainId = await retryBounded(() => provider.send("eth_chainId", []), {
    label: "raw testnet RPC chain-id query",
  });
  assertCondition(
    typeof rawTestnetChainId === "string" && BigInt(rawTestnetChainId) === EXPECTED_CHAIN_ID,
    `${CHAIN_PROFILE.displayName} acceptance RPC must report raw chainId ${EXPECTED_CHAIN_ID}; ` +
      `got ${String(rawTestnetChainId)}`,
  );
  const network = await retryBounded(() => provider.getNetwork(), { label: "RPC chain-id query" });
  // The tested safety parser evaluates the network name and chain ID together before report
  // creation, funding, or any other transaction.
  const parsedConfig = parseAcceptanceConfig({
    chainProfile: CHAIN_PROFILE,
    env: process.env,
    networkName: connection.networkName,
    chainId: network.chainId,
  });
  const privateKey = String(process.env.PRIVATE_KEY || "").trim();
  const runId = parsedConfig.runId || defaultRunId();
  const config = {
    privateKey,
    acceptanceMode: parsedConfig.acceptanceMode,
    runGovernanceLifecycle: parsedConfig.runGovernanceLifecycle,
    minDelay: parsedConfig.minDelaySeconds,
    diagnosticMinDelay: parsedConfig.diagnosticMinDelaySeconds,
    productionMinDelay: parsedConfig.productionMinDelaySeconds,
    productionGovernanceMultisigProfile: parsedConfig.productionGovernanceMultisigProfile,
    confirmations: parsedConfig.confirmations,
    maximumCostWei: parsedConfig.maximumCostWei,
    maximumCostText: parsedConfig.maximumCost,
    nativeSymbol: parsedConfig.nativeSymbol,
    runId,
    reportFileComponent: runIdReportFileComponent(runId, CHAIN_PROFILE),
    recover: parsedConfig.recover,
    verify: parsedConfig.verify,
    requireFinality: parsedConfig.requireFinality,
    finalityTimeoutMs: parsedConfig.finalityTimeoutSeconds * 1_000,
  };

  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey) || /^0x0{64}$/i.test(privateKey)) {
    throw new Error("PRIVATE_KEY must be a valid non-zero 0x-prefixed private key");
  }
  const funder = new ethers.Wallet(privateKey, provider);
  const acceptanceWallets = deriveAcceptanceWallets({
    basePrivateKey: privateKey,
    runId,
    provider,
    chainProfile: CHAIN_PROFILE,
  });
  const { runDeployer, ownerA, ownerB, ownerC, ownerD, ownerE, ownerF } = acceptanceWallets;

  const reportPath = path.join(REPORT_ROOT, `${config.reportFileComponent}.json`);
  if (config.recover) {
    await runRecovery({
      ethers,
      provider,
      config,
      funder,
      runDeployer,
      baseReportPath: reportPath,
    });
    return;
  }

  const isolatedDeploymentDirectory = path.join(
    REPORT_ROOT,
    config.reportFileComponent,
    "deployments",
    EXPECTED_NETWORK,
  );

  const primarySafeOwners = [ownerA.address, ownerB.address, ownerC.address];
  const replacementSafeOwners = [ownerD.address, ownerE.address, ownerF.address];
  const ownerLabels = new Map(
    [
      ["A", ownerA],
      ["B", ownerB],
      ["C", ownerC],
      ["D", ownerD],
      ["E", ownerE],
      ["F", ownerF],
    ].map(([label, wallet]) => [wallet.address.toLowerCase(), label]),
  );
  assertCondition(
    new Set([funder.address, runDeployer.address, ...primarySafeOwners, ...replacementSafeOwners])
      .size === 8,
    "Derived test accounts must all be distinct",
  );

  try {
    await fs.access(reportPath);
    throw new Error(
      `Report ${reportPath} already exists; choose a new ` +
        `${ACCEPTANCE_PROFILE.runIdEnvironmentName} or use ` +
        `${ACCEPTANCE_PROFILE.recoverEnvironmentName}=1`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const runBalanceBefore = await provider.getBalance(runDeployer.address);
  assertCondition(
    runBalanceBefore === 0n,
    `Derived run deployer ${runDeployer.address} already holds ${runBalanceBefore} wei; use ` +
      `${ACCEPTANCE_PROFILE.recoverEnvironmentName}=1 before a new run`,
  );
  const funderBalanceBefore = await provider.getBalance(funder.address);
  const feeData = await provider.getFeeData();
  const fundingGasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
  assertCondition(fundingGasPrice > 0n, "RPC did not return a usable gas price");
  assertCondition(
    funderBalanceBefore > config.maximumCostWei + 21_000n * fundingGasPrice,
    `Funder balance is below the ${config.maximumCostText} ${config.nativeSymbol} test budget plus ` +
      "funding gas",
  );

  const [deploymentsBefore, isolatedDeploymentsBefore, acceptanceInputs, compilerBuildState] =
    await Promise.all([
      hashDirectory(ethers, DEPLOYMENTS_DIR),
      hashDirectory(ethers, isolatedDeploymentDirectory),
      hashAcceptanceInputs(ethers),
      readProductionBuildInfoState(ethers),
    ]);
  const sourceState = gitWorkingTreeState();
  const buildState = {
    hardhatBuildProfile: hre.globalOptions?.buildProfile ?? "default",
    ...compilerBuildState,
    artifactsFileCount: acceptanceInputs.directories.artifacts.fileCount,
    artifactsDigest: acceptanceInputs.directories.artifacts.digest,
  };
  const zkCeremonyVerification =
    config.acceptanceMode === "release-rehearsal"
      ? await verifyProductionCeremony({
          root: process.cwd(),
          ptauPath: resolveProductionPtauPath(),
        })
      : null;
  const zkArtifactTrust = inspectZkReleaseArtifacts({
    root: process.cwd(),
    requireProduction: config.acceptanceMode === "release-rehearsal",
    requireBuiltR1cs: true,
  });
  const inspectedProtocolManifest = inspectProtocolReleaseManifest({
    root: process.cwd(),
    requireProduction: config.acceptanceMode === "release-rehearsal",
  });
  const protocolManifestEvidence = {
    path: path.relative(process.cwd(), inspectedProtocolManifest.manifestPath),
    sha256: inspectedProtocolManifest.manifestSha256,
    protocol: inspectedProtocolManifest.manifest.protocol,
    protocolGeneration: inspectedProtocolManifest.manifest.protocolGeneration,
    releaseStatus: inspectedProtocolManifest.manifest.releaseStatus,
    goldenVectorSha256: inspectedProtocolManifest.manifest.goldenVectors.sha256,
  };
  const report = {
    schemaVersion: TESTNET_RELEASE_REPORT_SCHEMA_VERSION,
    mode: "acceptance",
    acceptanceMode: config.acceptanceMode,
    evidenceType:
      config.acceptanceMode === "release-rehearsal"
        ? TESTNET_RELEASE_EVIDENCE_TYPE
        : "diagnostic-governance-lifecycle",
    governanceLifecycleIncluded: config.runGovernanceLifecycle,
    releaseReady: false,
    runId: config.runId,
    status: "running",
    failedStep: null,
    error: null,
    startedAt: nowIso(),
    finishedAt: null,
    releaseCommit: sourceState.commit,
    sourceState: {
      ...sourceState,
      acceptanceInputDigest: acceptanceInputs.digest,
      acceptanceInputs,
    },
    buildState,
    zkArtifactTrust,
    zkCeremonyVerification,
    protocolManifestEvidence,
    network: {
      name: connection.networkName,
      chainId: network.chainId,
      confirmations: config.confirmations,
      latestBlockAtStart: await provider.getBlockNumber(),
      finality: { required: config.requireFinality, status: "pending" },
    },
    safety: {
      isolatedDeployment: true,
      privateKeysPersisted: false,
      reportContainsProofsOrSignatures: false,
      recoveryCommand:
        `${ACCEPTANCE_PROFILE.runIdEnvironmentName}=${config.runId} ` +
        `${ACCEPTANCE_PROFILE.recoverEnvironmentName}=1 ${ACCEPTANCE_PROFILE.command}`,
    },
    addresses: {
      funder: funder.address,
      runDeployer: runDeployer.address,
      safeOwners: primarySafeOwners,
      ...(config.runGovernanceLifecycle ? { replacementSafeOwners } : {}),
    },
    safeInfrastructure: {
      version: CANONICAL_SAFE_VERSION,
      deploymentType: CANONICAL_SAFE_DEPLOYMENT_TYPE,
      saltNonce: BigInt(hashRunId(runId, CHAIN_PROFILE)).toString(),
      components: {},
    },
    safePolicy: {
      policy: "2-of-3",
      ownerCount: 3,
      threshold: 2,
      oneSignatureRejected: false,
      duplicateSignatureRejected: false,
      nonOwnerSigningRejectedBySdk: false,
      twoSignaturePairsExecuted: [],
      replayRejected: false,
      modules: null,
      guard: null,
      fallbackHandler: null,
      ownerSets: {
        primary: { labels: ["A", "B", "C"], addresses: primarySafeOwners },
        ...(config.runGovernanceLifecycle
          ? { replacement: { labels: ["D", "E", "F"], addresses: replacementSafeOwners } }
          : {}),
      },
      ...(config.runGovernanceLifecycle
        ? { primaryOwnerSignaturesRejectedByReplacementSafe: false }
        : {}),
      executions: [],
    },
    timelockDeployment: {},
    productionParity: {
      canonicalSafeImplementationMatched: false,
      sameSafeManifestOnChain71And1030: false,
      sameSafeManifestOnTestnetAndMainnet: false,
      mainnetCanonicalSafeInfrastructureMatched: false,
      sameTimelockArtifactAndConfigResolver: false,
      sameProtocolDeploymentHelper: false,
      sameDeploymentMetadataWriter: false,
      ...(config.runGovernanceLifecycle ? { sharedGovernanceOperationBuildersMatched: false } : {}),
      criticalTransactionsFinalized: false,
      cleanReleaseCommit: sourceState.clean,
      productionBuildProfileMatched: buildState.hardhatBuildProfile === "production",
      productionSafeProfileMatched:
        config.productionGovernanceMultisigProfile === CHAIN_PROFILE.governanceMultisigProfile,
      artifactManifestCaptured:
        buildState.artifactsFileCount > 0 && buildState.buildInfoFileCount > 0,
      productionCompilerSettingsMatched: buildState.productionSettingsMatched,
      productionTrustedSetupMatched: zkArtifactTrust.productionReady,
      productionCeremonyVerified: zkCeremonyVerification?.status === "passed",
      ownerKeysRepresentIndependentHumans: false,
      hardwareWalletAndUiCovered: false,
    },
    steps: [],
    transactions: {},
    onchain: { status: "running" },
    ...(config.runGovernanceLifecycle
      ? {
          governance: {},
          governanceLifecycle: {},
          treasury: {},
          upgrade: {},
        }
      : {}),
    terminalGovernanceState: { status: "pending" },
    business: {},
    verification: {
      enabled: config.verify,
      provider: ACCEPTANCE_PROFILE.verificationProvider,
      explorer: ACCEPTANCE_PROFILE.explorerName,
      status: config.verify ? "pending" : "skipped",
      contracts: [],
      phases: [],
    },
    budget: {
      nativeSymbol: config.nativeSymbol,
      capWei: config.maximumCostWei,
      capNative: config.maximumCostText,
      ...(CHAIN_PROFILE.id === "espace" ? { capCfx: config.maximumCostText } : {}),
      funderBalanceBefore,
      runBalanceBefore,
      refund: { status: "pending" },
    },
    deploymentsDirectory: {
      path: DEPLOYMENTS_DIR,
      before: deploymentsBefore,
      after: null,
      unchanged: null,
    },
    isolatedDeploymentArtifacts: {
      path: path.relative(process.cwd(), isolatedDeploymentDirectory),
      before: isolatedDeploymentsBefore,
      after: null,
      productionWriterExercised: false,
    },
  };
  const saveReport = () => writeJsonAtomic(reportPath, report);
  await saveReport();
  console.log(`[${CHAIN_PROFILE.id}-acceptance] run ID: ${config.runId}`);
  console.log(`[${CHAIN_PROFILE.id}-acceptance] report initialized: ${reportPath}`);

  let currentStep = "acceptance-mode-preflight";
  let originalError = null;
  let publishedReleaseEvidence = null;
  let funded = false;
  const secretValues = [
    config.privateKey,
    runDeployer.privateKey,
    ownerA.privateKey,
    ownerB.privateKey,
    ownerC.privateKey,
    ownerD.privateKey,
    ownerE.privateKey,
    ownerF.privateKey,
  ];
  const addStep = async (name, evidence = {}) => {
    report.steps.push({ name, status: "passed", at: nowIso(), ...evidence });
    await saveReport();
    console.log(`[${CHAIN_PROFILE.id}-acceptance] PASS ${name}`);
  };
  const recordTx = async (label, tx) => {
    const receipt = await tx.wait(config.confirmations, TX_TIMEOUT_MS);
    assertCondition(receipt, `${label} transaction was not confirmed`);
    assertCondition(Number(receipt.status) === 1, `${label} transaction reverted`);
    report.transactions[label] = publicReceipt(receipt);
    await saveReport();
    return receipt;
  };
  const deploy = async (contractName, signer, args = [], factoryOptions = {}) => {
    const factory = await ethers.getContractFactory(contractName, { signer, ...factoryOptions });
    const contract = await factory.deploy(...args);
    const transaction = contract.deploymentTransaction();
    assertCondition(transaction, `${contractName} deployment transaction is unavailable`);
    await recordTx(`deploy-${contractName}`, transaction);
    const address = await contract.getAddress();
    assertCondition(
      (await provider.getCode(address)) !== "0x",
      `${contractName} has no deployed code`,
    );
    return contract;
  };

  let oldGovernanceTimelockAddress = process.env.GOVERNANCE_TIMELOCK_ADDRESS;
  let oldGovernanceSafeAddress = process.env.GOVERNANCE_SAFE_ADDRESS;
  let oldGovernanceSafeProfile = process.env.GOVERNANCE_SAFE_PROFILE;
  let mainnetSafeInfrastructure;
  let testnetSafeInfrastructure;

  try {
    currentStep = "production-build-preflight";
    assertCondition(
      buildState.hardhatBuildProfile === "production",
      `${CHAIN_PROFILE.displayName} acceptance requires Hardhat --build-profile production`,
    );
    assertCondition(
      buildState.artifactsFileCount > 0 && buildState.buildInfoFileCount > 0,
      `${CHAIN_PROFILE.displayName} acceptance requires non-empty artifacts and build-info manifests`,
    );
    assertCondition(
      buildState.productionSettingsMatched,
      "Actual build-info compiler settings do not match the pinned production configuration",
    );
    assertCondition(
      isolatedDeploymentsBefore.fileCount === 0,
      "Isolated deployment-metadata directory is not empty for this run ID",
    );
    await addStep("production-build-manifest-preflight", buildState);
    await addStep("zk-artifact-trust-preflight", {
      artifactTrust: zkArtifactTrust,
      ceremonyVerification: zkCeremonyVerification,
    });
    await addStep("protocol-release-manifest-preflight", protocolManifestEvidence);

    if (config.acceptanceMode === "release-rehearsal") {
      currentStep = "acceptance-mode-preflight";
      assertCondition(
        sourceState.clean === true,
        "release-rehearsal requires a clean Git working tree before any testnet funding",
      );
      assertCondition(
        config.productionGovernanceMultisigProfile === CHAIN_PROFILE.governanceMultisigProfile,
        `release-rehearsal requires GOVERNANCE_SAFE_PROFILE=` +
          CHAIN_PROFILE.governanceMultisigProfile,
      );
      await addStep("release-rehearsal-clean-source-preflight", {
        commit: sourceState.commit,
        clean: sourceState.clean,
        acceptanceInputDigest: acceptanceInputs.digest,
        productionMinDelaySeconds: config.productionMinDelay,
        productionGovernanceMultisigProfile: config.productionGovernanceMultisigProfile,
        buildState,
        zkArtifactTrust,
      });
    }

    currentStep = "testnet-safe-infrastructure";
    testnetSafeInfrastructure = await inspectCanonicalSafeInfrastructure({
      provider,
      chainId: EXPECTED_CHAIN_ID,
    });
    await addStep("canonical-safe-testnet-infrastructure", testnetSafeInfrastructure);

    currentStep = "mainnet-safe-infrastructure";
    const mainnetProvider = new JsonRpcProvider(resolveProductionRpcUrl(CHAIN_PROFILE));
    try {
      mainnetSafeInfrastructure = await inspectCanonicalSafeInfrastructure({
        provider: mainnetProvider,
        chainId: ACCEPTANCE_PROFILE.productionChainId,
      });
    } finally {
      mainnetProvider.destroy();
    }
    const safeInfrastructureMatchesAcrossNetworks = [
      "singleton",
      "proxyFactory",
      "fallbackHandler",
    ].every(
      (component) =>
        testnetSafeInfrastructure.components[component].address ===
          mainnetSafeInfrastructure.components[component].address &&
        testnetSafeInfrastructure.components[component].actualCodeHash ===
          mainnetSafeInfrastructure.components[component].actualCodeHash,
    );
    assertCondition(
      safeInfrastructureMatchesAcrossNetworks &&
        testnetSafeInfrastructure.canonicalProxyCodeHash ===
          mainnetSafeInfrastructure.canonicalProxyCodeHash,
      `Canonical Safe infrastructure differs between ${CHAIN_PROFILE.displayName} testnet ` +
        "and mainnet",
    );
    report.productionParity.mainnetCanonicalSafeInfrastructureMatched = true;
    report.productionParity.sameSafeManifestOnTestnetAndMainnet = true;
    if (CHAIN_PROFILE.id === "espace") {
      report.productionParity.sameSafeManifestOnChain71And1030 = true;
    }
    await addStep("canonical-safe-mainnet-infrastructure", {
      ...mainnetSafeInfrastructure,
      matchesTestnet: true,
    });

    currentStep = "funding";
    const fundingTx = await funder.sendTransaction({
      to: runDeployer.address,
      value: config.maximumCostWei,
    });
    funded = true;
    await recordTx("fund-run-deployer", fundingTx);
    assertCondition(
      (await provider.getBalance(runDeployer.address)) <= config.maximumCostWei,
      "Run deployer received more than the configured hard budget",
    );
    await addStep("fund-isolated-run-deployer", { amountWei: config.maximumCostWei });

    currentStep = "deploy-canonical-safe-timelock";
    const safeOwners = primarySafeOwners;
    const safeSaltNonce = BigInt(hashRunId(config.runId, CHAIN_PROFILE)).toString();
    const testnetSafeMetadata = getCanonicalSafeDeploymentMetadata(EXPECTED_CHAIN_ID);
    const mainnetSafeMetadata = getCanonicalSafeDeploymentMetadata(
      ACCEPTANCE_PROFILE.productionChainId,
    );
    const manifestComponents = ["singleton", "proxyFactory", "fallbackHandler"];
    const sameManifestOnTestnetAndMainnet = manifestComponents.every(
      (component) =>
        testnetSafeMetadata[component].address === mainnetSafeMetadata[component].address &&
        testnetSafeMetadata[component].codeHash === mainnetSafeMetadata[component].codeHash,
    );
    assertCondition(
      sameManifestOnTestnetAndMainnet,
      `Pinned Safe manifest differs between ${CHAIN_PROFILE.displayName} testnet and mainnet`,
    );

    const preparedSafe = await prepareCanonicalSafeDeployment({
      provider,
      chainId: EXPECTED_CHAIN_ID,
      owners: safeOwners,
      saltNonce: safeSaltNonce,
    });
    assertCondition(
      (await provider.getCode(preparedSafe.safeAddress)) === "0x",
      `Predicted governance Safe ${preparedSafe.safeAddress} is already deployed`,
    );
    const safeDeploymentTx = await runDeployer.sendTransaction(preparedSafe.deploymentTransaction);
    await recordTx("deploy-canonical-governance-safe", safeDeploymentTx);
    const safeAddress = preparedSafe.safeAddress;
    const initialSafeProfile = await assertCanonicalSafeProfile({
      provider,
      chainId: EXPECTED_CHAIN_ID,
      safeAddress,
      expectedOwners: safeOwners,
      expectedNonce: 0n,
    });
    assertCondition(
      initialSafeProfile.canonicalProxyCodeHash ===
        mainnetSafeInfrastructure.canonicalProxyCodeHash,
      `Canonical SafeProxy runtime differs between ${CHAIN_PROFILE.displayName} testnet and ` +
        "mainnet factories",
    );
    const safeReader = await connectCanonicalSafe({
      provider,
      chainId: EXPECTED_CHAIN_ID,
      safeAddress,
    });

    const timelockConfig = await resolveTimelockDeploymentConfig({
      connection,
      ethers,
      provider,
      deployerAddress: runDeployer.address,
      env: {
        ...process.env,
        MIN_DELAY: String(config.minDelay),
        GOVERNANCE_SAFE_ADDRESS: safeAddress,
      },
      inspectMultisig: ({ provider: inspectionProvider, address }) =>
        assertCanonicalSafeProfile({
          provider: inspectionProvider,
          chainId: EXPECTED_CHAIN_ID,
          safeAddress: address,
          expectedOwners: safeOwners,
        }),
    });
    const timelock = await deploy("GovernanceTimelock", runDeployer, [
      timelockConfig.minDelay,
      timelockConfig.governanceMultisig,
    ]);
    const timelockAddress = await timelock.getAddress();
    report.addresses.governanceSafe = safeAddress;
    report.addresses.timelock = timelockAddress;
    report.safeInfrastructure = {
      version: CANONICAL_SAFE_VERSION,
      deploymentType: CANONICAL_SAFE_DEPLOYMENT_TYPE,
      saltNonce: safeSaltNonce,
      predictedAddress: safeAddress,
      deploymentFactoryMatched:
        preparedSafe.deploymentTransaction.to === testnetSafeMetadata.proxyFactory.address,
      components: Object.fromEntries(
        manifestComponents.map((component) => [
          component,
          {
            address: testnetSafeMetadata[component].address,
            expectedCodeHash: testnetSafeMetadata[component].codeHash,
            actualCodeHash: initialSafeProfile.componentCodeHashes[component],
            matched:
              testnetSafeMetadata[component].codeHash ===
              initialSafeProfile.componentCodeHashes[component],
          },
        ]),
      ),
      testnetPreflight: testnetSafeInfrastructure,
      mainnet: mainnetSafeInfrastructure,
    };
    Object.assign(report.safePolicy, {
      owners: initialSafeProfile.owners,
      modules: initialSafeProfile.modules,
      guard: initialSafeProfile.guard,
      fallbackHandler: initialSafeProfile.fallbackHandler,
      singleton: initialSafeProfile.singleton,
      proxyCodeHash: initialSafeProfile.proxyCodeHash,
      canonicalProxyCodeHash: initialSafeProfile.canonicalProxyCodeHash,
      proxyRuntimeMatched:
        initialSafeProfile.proxyCodeHash === initialSafeProfile.canonicalProxyCodeHash,
    });
    report.productionParity.canonicalSafeImplementationMatched = true;
    report.productionParity.sameTimelockArtifactAndConfigResolver = true;
    report.timelockDeployment = {
      configResolver: "resolveTimelockDeploymentConfig",
      minDelaySeconds: timelockConfig.minDelay,
      governanceSafe: timelockConfig.governanceMultisig,
      rolesExclusive: true,
    };
    await saveReport();

    const roleChecks = [
      ["admin", await timelock.DEFAULT_ADMIN_ROLE(), timelockAddress],
      ["proposer", await timelock.PROPOSER_ROLE(), safeAddress],
      ["canceller", await timelock.CANCELLER_ROLE(), safeAddress],
      ["executor", await timelock.EXECUTOR_ROLE(), safeAddress],
    ];
    for (const [name, role, expected] of roleChecks) {
      const count = await timelock.getRoleMemberCount(role);
      const member = count === 1n ? await timelock.getRoleMember(role, 0) : ethers.ZeroAddress;
      assertCondition(
        count === 1n && ethers.getAddress(member) === ethers.getAddress(expected),
        `Timelock ${name} role is not exclusively held by ${expected}`,
      );
    }
    assertCondition(
      (await timelock.getMinDelay()) === BigInt(config.minDelay),
      "Timelock delay mismatch",
    );

    const safeInterface = createCanonicalSafeInterface(EXPECTED_CHAIN_ID);
    const primarySafeContext = { label: "primary", safeAddress, safeReader };
    const signedExecution = async (
      target,
      value,
      data,
      wallets = [ownerA, ownerB],
      safeContext = primarySafeContext,
    ) => {
      const nonce = await safeContext.safeReader.getNonce();
      const unsigned = await createCanonicalSafeTransaction({
        safe: safeContext.safeReader,
        target,
        value,
        data,
        nonce,
      });
      const signed = await signCanonicalSafeTransaction({
        provider,
        chainId: EXPECTED_CHAIN_ID,
        safeAddress: safeContext.safeAddress,
        safeTransaction: unsigned.safeTransaction,
        signerPrivateKeys: wallets.map((wallet) => wallet.privateKey),
      });
      assertCondition(
        signed.safeTxHash === unsigned.safeTxHash,
        "Safe transaction hash changed while collecting signatures",
      );
      return { nonce, ...signed };
    };
    const executeSafe = async (
      label,
      target,
      value,
      data,
      wallets = [ownerA, ownerB],
      safeContext = primarySafeContext,
    ) => {
      const signed = await signedExecution(target, value, data, wallets, safeContext);
      const tx = await runDeployer.sendTransaction({
        to: safeContext.safeAddress,
        value: 0n,
        data: signed.encodedTransaction,
      });
      const receipt = await recordTx(label, tx);
      const execution = assertSafeExecutionSuccess({
        receipt,
        safeAddress: safeContext.safeAddress,
        safeTxHash: signed.safeTxHash,
        chainId: EXPECTED_CHAIN_ID,
      });
      assertCondition(
        BigInt(await safeContext.safeReader.getNonce()) === BigInt(signed.nonce) + 1n,
        `${label} did not advance Safe nonce`,
      );
      const evidence = {
        label,
        safe: safeContext.label,
        safeAddress: safeContext.safeAddress,
        safeNonce: signed.nonce,
        safeTxHash: execution.safeTxHash,
        signers: wallets.map((wallet) => {
          const signerLabel = ownerLabels.get(wallet.address.toLowerCase());
          assertCondition(signerLabel, `Unknown acceptance Safe signer ${wallet.address}`);
          return signerLabel;
        }),
        event: "ExecutionSuccess",
        outerTransactionHash: receipt.hash,
      };
      report.safePolicy.executions.push(evidence);
      await saveReport();
      return { receipt, ...signed, evidence };
    };

    const singleExecution = await signedExecution(runDeployer.address, 0n, "0x", [ownerA]);
    await expectSafeSimulationFailure({
      provider,
      from: runDeployer.address,
      safeAddress,
      data: singleExecution.encodedTransaction,
      safeInterface,
      label: "Single-signature Safe execution",
      expectedSafeRevertCodes: ["GS020"],
    });
    report.safePolicy.oneSignatureRejected = true;

    const duplicateExecutionData = duplicateSafeSignatureCalldata({
      ethers,
      safeInterface,
      encodedTransaction: singleExecution.encodedTransaction,
    });
    await expectSafeSimulationFailure({
      provider,
      from: runDeployer.address,
      safeAddress,
      data: duplicateExecutionData,
      safeInterface,
      label: "Duplicate-owner Safe execution",
      expectedSafeRevertCodes: ["GS026"],
    });
    report.safePolicy.duplicateSignatureRejected = true;

    const outsiderUnsigned = await createCanonicalSafeTransaction({
      safe: safeReader,
      target: runDeployer.address,
      value: 0n,
      data: "0x",
      nonce: await safeReader.getNonce(),
    });
    await expectRevert(
      () =>
        signCanonicalSafeTransaction({
          provider,
          chainId: EXPECTED_CHAIN_ID,
          safeAddress,
          safeTransaction: outsiderUnsigned.safeTransaction,
          signerPrivateKeys: [runDeployer.privateKey],
        }),
      "Non-owner Safe signing",
      { expectedMessages: ["Transactions can only be signed by Safe owners"] },
    );
    report.safePolicy.nonOwnerSigningRejectedBySdk = true;

    const abExecution = await executeSafe(
      "safe-two-signature-smoke-ab",
      runDeployer.address,
      0n,
      "0x",
      [ownerA, ownerB],
    );
    report.safePolicy.twoSignaturePairsExecuted.push("AB");
    await executeSafe("safe-two-signature-smoke-ac", runDeployer.address, 0n, "0x", [
      ownerA,
      ownerC,
    ]);
    report.safePolicy.twoSignaturePairsExecuted.push("AC");
    await executeSafe("safe-two-signature-smoke-bc", runDeployer.address, 0n, "0x", [
      ownerB,
      ownerC,
    ]);
    report.safePolicy.twoSignaturePairsExecuted.push("BC");
    await expectSafeSimulationFailure({
      provider,
      from: runDeployer.address,
      safeAddress,
      data: abExecution.encodedTransaction,
      safeInterface,
      label: "Safe nonce replay",
      expectedSafeRevertCodes: ["GS026"],
    });
    report.safePolicy.replayRejected = true;
    await addStep("canonical-safe-1.3.0-two-of-three", {
      ...report.safePolicy,
      owners: [...report.safePolicy.owners],
      modules: [...report.safePolicy.modules],
      twoSignaturePairsExecuted: [...report.safePolicy.twoSignaturePairsExecuted],
      executions: report.safePolicy.executions.map((execution) => ({ ...execution })),
      nonceAfterSmoke: await safeReader.getNonce(),
    });

    currentStep = "deploy-protocol";
    process.env.GOVERNANCE_TIMELOCK_ADDRESS = timelockAddress;
    process.env.GOVERNANCE_SAFE_ADDRESS = safeAddress;
    process.env.GOVERNANCE_SAFE_PROFILE = CHAIN_PROFILE.governanceMultisigProfile;
    const deployed = await deployIntegratedSystem(connection, {
      writeDeployments: true,
      signer: runDeployer,
      artifacts: hre.artifacts,
      deploymentDirectory: isolatedDeploymentDirectory,
      transactionConfirmations: config.confirmations,
      transactionTimeoutMs: TX_TIMEOUT_MS,
      onTransactionReceipt: async (label, receipt) => {
        report.transactions[`integrated-${label}`] = publicReceipt(receipt);
        await saveReport();
      },
    });
    const {
      token,
      poseidonT5,
      adultAgeGate,
      personCommitmentVerifier,
      nameDisclosureVerifier,
      groth16VerifierAdapter,
      deepFamily,
      metadataArchive,
      deepFamilyReader,
      deepFamilyImplementationAddress,
      transactionReceipts,
    } = deployed;
    const addresses = {
      token: await token.getAddress(),
      poseidonT5: await poseidonT5.getAddress(),
      adultAgeGate: await adultAgeGate.getAddress(),
      personCommitmentVerifier: await personCommitmentVerifier.getAddress(),
      disclosureBindingVerifier: await nameDisclosureVerifier.getAddress(),
      groth16VerifierAdapter: await groth16VerifierAdapter.getAddress(),
      deepFamily: await deepFamily.getAddress(),
      deepFamilyImplementation: deepFamilyImplementationAddress,
      metadataArchive: await metadataArchive.getAddress(),
      deepFamilyReader: await deepFamilyReader.getAddress(),
    };
    Object.assign(report.addresses, addresses);

    const expectedDeploymentMetadata = {
      DeepFamilyToken: addresses.token,
      PoseidonT5: addresses.poseidonT5,
      AdultAgeGate: addresses.adultAgeGate,
      PersonCommitmentVerifier: addresses.personCommitmentVerifier,
      DisclosureBindingVerifier: addresses.disclosureBindingVerifier,
      Groth16VerifierAdapter: addresses.groth16VerifierAdapter,
      DeepFamily: addresses.deepFamily,
      MetadataArchiveV1: addresses.metadataArchive,
      DeepFamilyReader: addresses.deepFamilyReader,
    };
    for (const [contractName, expectedAddress] of Object.entries(expectedDeploymentMetadata)) {
      const deploymentMetadata = JSON.parse(
        await fs.readFile(path.join(isolatedDeploymentDirectory, `${contractName}.json`), "utf8"),
      );
      assertCondition(
        ethers.getAddress(deploymentMetadata.address) === ethers.getAddress(expectedAddress) &&
          Array.isArray(deploymentMetadata.abi) &&
          deploymentMetadata.abi.length > 0 &&
          (contractName !== "DeepFamily" ||
            ethers.getAddress(deploymentMetadata.implementationAddress) ===
              ethers.getAddress(deepFamilyImplementationAddress)),
        `Persisted ${contractName} deployment metadata does not match the deployed contract`,
      );
    }
    const isolatedDeploymentsAfter = await hashDirectory(ethers, isolatedDeploymentDirectory);
    assertCondition(
      isolatedDeploymentsAfter.fileCount === Object.keys(expectedDeploymentMetadata).length,
      "Production deployment metadata writer did not persist the complete contract set",
    );
    report.isolatedDeploymentArtifacts.after = isolatedDeploymentsAfter;
    report.isolatedDeploymentArtifacts.productionWriterExercised = true;
    report.productionParity.sameProtocolDeploymentHelper = true;
    report.productionParity.sameDeploymentMetadataWriter = true;
    await saveReport();

    // The callback above persists every receipt immediately so a mid-deployment failure still
    // leaves complete evidence. Keep this invariant check against the final returned map.
    for (const label of Object.keys(transactionReceipts)) {
      assertCondition(
        report.transactions[`integrated-${label}`],
        `Integrated deployment receipt ${label} was not persisted`,
      );
    }

    assertCondition(
      (await deepFamily.owner()) === timelockAddress,
      "DeepFamily owner is not Timelock",
    );
    assertCondition(
      (await token.owner()) === ethers.ZeroAddress,
      "DeepFamilyToken bootstrap owner is active",
    );
    assertCondition(
      (await token.deepFamilyContract()) === addresses.deepFamily,
      "Token to DeepFamily binding mismatch",
    );
    assertCondition(
      (await deepFamily.DEEP_FAMILY_TOKEN_CONTRACT()) === addresses.token,
      "DeepFamily to Token binding mismatch",
    );
    assertCondition(
      (await deepFamilyReader.DEEP_FAMILY()) === addresses.deepFamily,
      "Reader to DeepFamily binding mismatch",
    );
    assertCondition(
      (await deepFamily.metadataArchive()) === addresses.metadataArchive &&
        (await metadataArchive.DEEP_FAMILY()) === addresses.deepFamily &&
        (await deepFamilyReader.METADATA_ARCHIVE()) === addresses.metadataArchive,
      "Metadata Archive reverse binding mismatch",
    );
    assertCondition(
      (await deepFamily.verifierRegistry(
        PERSON_RELATION_PURPOSE,
        RELEASE_PERSON_RELATION_CIRCUIT_ID,
      )) === addresses.groth16VerifierAdapter &&
        (await deepFamily.verifierRegistry(
          DISCLOSURE_BINDING_PURPOSE,
          RELEASE_DISCLOSURE_BINDING_CIRCUIT_ID,
        )) === addresses.groth16VerifierAdapter,
      "DeepFamily verifier route mismatch",
    );
    assertCondition(
      (await groth16VerifierAdapter.personVerifier()) === addresses.personCommitmentVerifier &&
        (await groth16VerifierAdapter.disclosureBindingVerifier()) ===
          addresses.disclosureBindingVerifier,
      "Groth16 adapter backend mismatch",
    );
    assertCondition(
      (await implementationAddress(ethers, provider, addresses.deepFamily)) ===
        ethers.getAddress(deepFamilyImplementationAddress),
      "Initial ERC-1967 implementation mismatch",
    );
    await addStep("isolated-integrated-protocol-wiring", {
      addresses,
      transactionCount: Object.keys(transactionReceipts).length,
      confirmations: config.confirmations,
    });

    currentStep = "verify-initial-deployment";
    if (config.runGovernanceLifecycle) {
      const governedVerifierCandidate = await deploy("Groth16VerifierAdapter", runDeployer, [
        addresses.personCommitmentVerifier,
        addresses.disclosureBindingVerifier,
      ]);
      addresses.governedVerifierCandidate = await governedVerifierCandidate.getAddress();
      assertCondition(
        (await governedVerifierCandidate.personVerifier()) === addresses.personCommitmentVerifier &&
          (await governedVerifierCandidate.disclosureBindingVerifier()) ===
            addresses.disclosureBindingVerifier,
        "Governed verifier candidate backend mismatch",
      );
      report.addresses.governedVerifierCandidate = addresses.governedVerifierCandidate;
    }

    const deepFamilyFactory = await ethers.getContractFactory("DeepFamily", {
      signer: runDeployer,
      libraries: {
        PoseidonT5: addresses.poseidonT5,
        AdultAgeGate: addresses.adultAgeGate,
      },
    });
    const proxyInitData = deepFamilyFactory.interface.encodeFunctionData("initialize", [
      addresses.token,
      runDeployer.address,
    ]);
    const initialVerificationEntries = [
      await verificationEntry(hre.artifacts, "GovernanceTimelock", timelockAddress, [
        config.minDelay,
        safeAddress,
      ]),
      await verificationEntry(hre.artifacts, "DeepFamilyToken", addresses.token),
      await verificationEntry(hre.artifacts, "PoseidonT5", addresses.poseidonT5),
      await verificationEntry(hre.artifacts, "AdultAgeGate", addresses.adultAgeGate),
      await verificationEntry(
        hre.artifacts,
        "PersonCommitmentVerifier",
        addresses.personCommitmentVerifier,
      ),
      await verificationEntry(
        hre.artifacts,
        "DisclosureBindingVerifier",
        addresses.disclosureBindingVerifier,
      ),
      await verificationEntry(
        hre.artifacts,
        "Groth16VerifierAdapter",
        addresses.groth16VerifierAdapter,
        [addresses.personCommitmentVerifier, addresses.disclosureBindingVerifier],
      ),
      await verificationEntry(hre.artifacts, "DeepFamily", addresses.deepFamilyImplementation, [], {
        PoseidonT5: addresses.poseidonT5,
        AdultAgeGate: addresses.adultAgeGate,
      }),
      await verificationEntry(hre.artifacts, "UUPSProxy", addresses.deepFamily, [
        addresses.deepFamilyImplementation,
        proxyInitData,
      ]),
      await verificationEntry(hre.artifacts, "MetadataArchiveV1", addresses.metadataArchive, [
        addresses.deepFamily,
      ]),
      await verificationEntry(hre.artifacts, "DeepFamilyReader", addresses.deepFamilyReader, [
        addresses.deepFamily,
      ]),
    ];
    if (config.runGovernanceLifecycle) {
      initialVerificationEntries.push({
        ...(await verificationEntry(
          hre.artifacts,
          "Groth16VerifierAdapter",
          addresses.governedVerifierCandidate,
          [addresses.personCommitmentVerifier, addresses.disclosureBindingVerifier],
        )),
        label: "GovernedVerifierCandidate",
      });
    }
    if (config.verify) {
      const initialVerificationFailures = await verifyEntries(
        initialVerificationEntries,
        report,
        saveReport,
        "initial-deployment",
      );
      if (initialVerificationFailures.length > 0) {
        throw new Error(
          `${initialVerificationFailures.length} initial ${ACCEPTANCE_PROFILE.explorerName} ` +
            "verification(s) failed; see report",
        );
      }
    }
    await addStep("source-verified-initial-deployment", {
      status: config.verify ? "passed" : "skipped-diagnostic",
      contractCount: initialVerificationEntries.length,
    });

    const scheduleOperation = async ({ label, target, data, salt, signers = [ownerA, ownerB] }) => {
      const operationId = await timelock.hashOperation(target, 0n, data, ZERO_HASH, salt);
      const scheduleData = timelock.interface.encodeFunctionData("schedule", [
        target,
        0n,
        data,
        ZERO_HASH,
        salt,
        config.minDelay,
      ]);
      const scheduleExecution = await executeSafe(
        `${label}-schedule`,
        timelockAddress,
        0n,
        scheduleData,
        signers,
      );
      assertCondition(await timelock.isOperationPending(operationId), `${label} is not pending`);
      return {
        operationId,
        target,
        data,
        salt,
        scheduleBlockNumber: scheduleExecution.receipt.blockNumber,
      };
    };
    const executeOperation = async (label, operation, signers = [ownerA, ownerB]) => {
      const executeData = timelock.interface.encodeFunctionData("execute", [
        operation.target,
        0n,
        operation.data,
        ZERO_HASH,
        operation.salt,
      ]);
      await executeSafe(`${label}-execute`, timelockAddress, 0n, executeData, signers);
      assertCondition(
        await timelock.isOperationDone(operation.operationId),
        `${label} is not done`,
      );
    };

    const feeBefore = await deepFamily.protocolEndorsementFeeBps();
    let activeProtocolFee = feeBefore;
    let activePersonVerifier = addresses.groth16VerifierAdapter;
    let governedFeeData = null;
    if (config.runGovernanceLifecycle) {
      currentStep = "governance-fee";
      const newFee = feeBefore === 501n ? 502n : 501n;
      await expectRevert(
        () => deepFamily.connect(runDeployer).updateEndorsementFee.staticCall(newFee),
        "Direct non-owner endorsement fee update",
        {
          expectedErrorNames: ["OwnableUnauthorizedAccount"],
          expectedSelectors: [OWNABLE_UNAUTHORIZED_SELECTOR],
        },
      );
      await expectRevert(
        () =>
          deepFamily
            .connect(runDeployer)
            .setCircuitVerifier.staticCall(
              PERSON_RELATION_PURPOSE,
              GOVERNED_PERSON_RELATION_CIRCUIT_ID,
              addresses.governedVerifierCandidate,
            ),
        "Direct non-owner verifier update",
        {
          expectedErrorNames: ["OwnableUnauthorizedAccount"],
          expectedSelectors: [OWNABLE_UNAUTHORIZED_SELECTOR],
        },
      );
      governedFeeData = deepFamily.interface.encodeFunctionData("updateEndorsementFee", [newFee]);
      const feeOperation = await scheduleOperation({
        label: "fee-update",
        target: addresses.deepFamily,
        data: governedFeeData,
        salt: deriveGovernanceSalt(ethers, {
          targetAddress: addresses.deepFamily,
          calldata: governedFeeData,
        }),
        signers: [ownerA, ownerB],
      });
      // With a short diagnostic delay, waiting for multiple confirmations can consume the entire
      // wall-clock delay. Simulate at the schedule receipt's historical block instead of assuming
      // the operation is still early when the RPC finally returns.
      const feeScheduleBlock = await retryBounded(
        () => provider.getBlock(feeOperation.scheduleBlockNumber),
        {
          attempts: 4,
          timeoutMs: 60_000,
          label: "fee schedule block read",
        },
      );
      assertCondition(feeScheduleBlock, "Fee schedule block is unavailable");
      const feeReadyTimestamp = await retryBounded(
        () => timelock.getTimestamp(feeOperation.operationId),
        {
          attempts: 4,
          timeoutMs: 60_000,
          label: "fee operation ready timestamp read",
        },
      );
      assertCondition(
        feeReadyTimestamp > BigInt(feeScheduleBlock.timestamp),
        "Fee operation did not preserve a non-zero early-execution window at schedule time",
      );
      const earlyExecuteData = timelock.interface.encodeFunctionData("execute", [
        feeOperation.target,
        0n,
        feeOperation.data,
        ZERO_HASH,
        feeOperation.salt,
      ]);
      const early = await signedExecution(timelockAddress, 0n, earlyExecuteData, [ownerB, ownerC]);
      const nonceBeforeEarly = await safeReader.getNonce();
      await expectSafeSimulationFailure({
        provider,
        from: runDeployer.address,
        safeAddress,
        data: early.encodedTransaction,
        blockTag: feeOperation.scheduleBlockNumber,
        safeInterface,
        label: "Early Timelock execution through Safe",
        expectedSafeRevertCodes: ["GS013"],
      });
      assertCondition(
        (await safeReader.getNonce()) === nonceBeforeEarly,
        "Early execution simulation changed Safe nonce",
      );
      assertCondition(
        (await deepFamily.protocolEndorsementFeeBps()) === feeBefore,
        "Early execution changed endorsement fee",
      );
      const verifierOperation = await scheduleOperation({
        label: "verifier-update",
        target: addresses.deepFamily,
        data: deepFamily.interface.encodeFunctionData("setCircuitVerifier", [
          PERSON_RELATION_PURPOSE,
          GOVERNED_PERSON_RELATION_CIRCUIT_ID,
          addresses.governedVerifierCandidate,
        ]),
        salt: deriveGovernanceSalt(ethers, {
          targetAddress: addresses.deepFamily,
          calldata: deepFamily.interface.encodeFunctionData("setCircuitVerifier", [
            PERSON_RELATION_PURPOSE,
            GOVERNED_PERSON_RELATION_CIRCUIT_ID,
            addresses.governedVerifierCandidate,
          ]),
        }),
        signers: [ownerB, ownerC],
      });
      await waitForReady(timelock, feeOperation.operationId, config.minDelay);
      await waitForReady(timelock, verifierOperation.operationId, config.minDelay);
      await executeOperation("fee-update", feeOperation, [ownerA, ownerC]);
      assertCondition(
        (await deepFamily.protocolEndorsementFeeBps()) === newFee,
        "Governed endorsement fee was not updated",
      );
      await executeOperation("verifier-update", verifierOperation, [ownerA, ownerB]);
      assertCondition(
        (await deepFamily.verifierRegistry(
          PERSON_RELATION_PURPOSE,
          GOVERNED_PERSON_RELATION_CIRCUIT_ID,
        )) === addresses.governedVerifierCandidate,
        "Governed person-relation verifier route was not appended",
      );

      const cancelledFee = newFee === 502n ? 503n : 502n;
      const cancelOperation = await scheduleOperation({
        label: "fee-update-cancelled",
        target: addresses.deepFamily,
        data: deepFamily.interface.encodeFunctionData("updateEndorsementFee", [cancelledFee]),
        salt: deriveGovernanceSalt(ethers, {
          targetAddress: addresses.deepFamily,
          calldata: deepFamily.interface.encodeFunctionData("updateEndorsementFee", [cancelledFee]),
        }),
        signers: [ownerB, ownerC],
      });
      const cancelData = timelock.interface.encodeFunctionData("cancel", [
        cancelOperation.operationId,
      ]);
      await executeSafe("fee-update-cancel", timelockAddress, 0n, cancelData, [ownerA, ownerB]);
      assertCondition(
        !(await timelock.isOperation(cancelOperation.operationId)),
        "Cancelled operation still exists",
      );
      assertCondition(
        (await deepFamily.protocolEndorsementFeeBps()) === newFee,
        "Cancelled operation changed the endorsement fee",
      );
      const cancelledExecuteData = timelock.interface.encodeFunctionData("execute", [
        cancelOperation.target,
        0n,
        cancelOperation.data,
        ZERO_HASH,
        cancelOperation.salt,
      ]);
      const cancelledExecution = await signedExecution(timelockAddress, 0n, cancelledExecuteData, [
        ownerA,
        ownerC,
      ]);
      await expectSafeSimulationFailure({
        provider,
        from: runDeployer.address,
        safeAddress,
        data: cancelledExecution.encodedTransaction,
        safeInterface,
        label: "Execution of a cancelled Timelock operation through Safe",
        expectedSafeRevertCodes: ["GS013"],
      });
      report.governance = {
        feeBefore,
        feeAfter: newFee,
        executedOperationId: feeOperation.operationId,
        verifierOperationId: verifierOperation.operationId,
        verifierBefore: addresses.groth16VerifierAdapter,
        verifierAfter: addresses.governedVerifierCandidate,
        verifierPurpose: PERSON_RELATION_PURPOSE,
        verifierCircuitId: GOVERNED_PERSON_RELATION_CIRCUIT_ID,
        directPrivilegedCallsRejected: true,
        cancelledOperationId: cancelOperation.operationId,
        earlyExecutionRejected: true,
        earlyExecutionSimulationBlock: feeOperation.scheduleBlockNumber,
        scheduleBlockTimestamp: feeScheduleBlock.timestamp,
        operationReadyTimestamp: feeReadyTimestamp,
        cancelled: true,
        cancelledExecutionRejected: true,
        signaturePairs: {
          feeSchedule: "AB",
          feeExecute: "AC",
          verifierSchedule: "BC",
          verifierExecute: "AB",
          cancelledFeeSchedule: "BC",
          cancel: "AB",
        },
      };
      activeProtocolFee = newFee;
      await addStep("safe-timelock-schedule-wait-execute-cancel", report.governance);
    }

    currentStep = "real-zk-business";
    const acceptancePassphrase = `DeepFamily acceptance ${CHAIN_PROFILE.id} ${config.runId}`;
    const person = {
      fullName: `DeepFamily ${CHAIN_PROFILE.displayName} E2E ${config.runId}`,
      passphrase: acceptancePassphrase,
      isBirthBC: false,
      birthYear: 1990,
      birthMonth: 1,
      birthDay: 1,
      // Exercise the full contract/circuit uint8 range, not only the frontend's current 0-3 UI.
      gender: 255,
    };
    const father = {
      fullName: `DeepFamily ${CHAIN_PROFILE.displayName} E2E Father ${config.runId}`,
      passphrase: acceptancePassphrase,
      isBirthBC: false,
      birthYear: 1960,
      birthMonth: 1,
      birthDay: 1,
      gender: 1,
    };
    const mother = {
      fullName: `DeepFamily ${CHAIN_PROFILE.displayName} E2E Mother ${config.runId}`,
      passphrase: acceptancePassphrase,
      isBirthBC: false,
      birthYear: 1962,
      birthMonth: 1,
      birthDay: 1,
      gender: 2,
    };
    const personProofArtifactPaths = resolveProofArtifacts(
      PERSON_RELATION_PROOF_DESCRIPTOR,
      "Person relation circuit",
    );
    const personProofArtifactsBefore = await hashProofArtifacts(ethers, personProofArtifactPaths);
    const rewardBalanceBefore = await token.balanceOf(runDeployer.address);
    const addResult = await withTimeout(
      addPersonVersion({
        deepFamily,
        signer: runDeployer,
        personData: person,
        fatherData: father,
        motherData: mother,
        fatherVersion: 0,
        motherVersion: 0,
        versionContent: {
          tag: `${CHAIN_PROFILE.id}-e2e-v1`,
          biography: `DeepFamily automated ${CHAIN_PROFILE.displayName} acceptance identity`,
        },
        proofArtifacts: personProofArtifactPaths,
      }),
      PROOF_TIMEOUT_MS,
      "Person relation proof, DFM1 encryption, and submission",
    );
    const personProofArtifacts = await hashProofArtifacts(ethers, addResult.proofArtifacts);
    assertProofArtifactsUnchanged(
      personProofArtifactsBefore,
      personProofArtifacts,
      "Person relation proof artifact",
    );
    assertCondition(
      addResult.metadata.parents.father && addResult.metadata.parents.mother,
      "Complete parent commitments missing",
    );
    await recordTx("zk-add-person", addResult.tx);
    const personHash = addResult.personHash;
    assertCondition(
      (await deepFamily.personVersionsCount(personHash)) === 1n,
      "Person version missing",
    );
    const versionDetails = await deepFamilyReader.getVersionDetails(personHash, 1);
    const storedVersion = versionDetails.version ?? versionDetails[0];
    const metadataRef = versionDetails.metadata ?? versionDetails[1];
    assertCondition(
      storedVersion.versionCommitment === addResult.versionCommitment,
      "Reader versionCommitment does not match the submitted metadata",
    );
    assertCondition(
      metadataRef.payloadHash.toLowerCase() === addResult.payloadHash.toLowerCase(),
      "Reader MetadataRef payloadHash does not match the submitted envelope",
    );
    assertCondition(
      Number(metadataRef.payloadLength) === addResult.metadataEnvelope.length,
      "Reader MetadataRef payloadLength does not match the submitted envelope",
    );
    const metadataRuntimeCode = await provider.getCode(metadataRef.pointer);
    const decodedMetadata = await decryptPersonVersionRuntime({
      runtimeCode: metadataRuntimeCode,
      payloadLength: metadataRef.payloadLength,
      payloadHash: metadataRef.payloadHash,
      rawPassphrase: acceptancePassphrase,
      context: {
        chainId: network.chainId,
        deepFamilyProxy: addresses.deepFamily,
        personHash,
        fatherHash: addResult.metadata.parents.father.personHash,
        fatherVersionIndex: addResult.metadata.parents.father.versionIndex,
        motherHash: addResult.metadata.parents.mother.personHash,
        motherVersionIndex: addResult.metadata.parents.mother.versionIndex,
        versionCommitment: addResult.versionCommitment,
      },
    });
    assertCondition(
      decodedMetadata.metadata.tag === addResult.metadata.tag &&
        decodedMetadata.metadata.biography === addResult.metadata.biography,
      "Archive runtime did not decrypt to the submitted tag and biography",
    );
    const reward = await token.recentReward();
    const rewardBalanceAfter = await token.balanceOf(runDeployer.address);
    assertCondition(reward > 0n, "Complete-parent person did not produce a DEEP reward");
    assertCondition(
      rewardBalanceAfter - rewardBalanceBefore === reward,
      "DEEP reward balance delta mismatch",
    );

    await recordTx(
      "endorsement-approve",
      await token.connect(runDeployer).approve(addresses.deepFamily, reward),
    );
    const treasuryBefore = await token.balanceOf(timelockAddress);
    await recordTx(
      "endorse-person-version",
      await deepFamily.connect(runDeployer).endorseVersion(personHash, 1),
    );
    const protocolShare = (reward * activeProtocolFee) / 10_000n;
    const treasuryAfter = await token.balanceOf(timelockAddress);
    assertCondition(protocolShare > 0n, "Calculated protocol share is zero");
    assertCondition(
      treasuryAfter - treasuryBefore === protocolShare,
      "Protocol endorsement share did not reach Timelock",
    );

    const disclosureProofArtifactPaths = resolveProofArtifacts(
      DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
      "Disclosure binding circuit",
    );
    const disclosureProofArtifactsBefore = await hashProofArtifacts(
      ethers,
      disclosureProofArtifactPaths,
    );
    const mintResult = await withTimeout(
      mintPersonVersionNFT({
        deepFamily,
        signer: runDeployer,
        personHash,
        versionIndex: 1,
        tokenURI: `ipfs://deepfamily-e2e/${config.runId}/nft`,
        basicInfo: person,
        supplementInfo: {
          fullName: person.fullName,
          birthPlace: `${CHAIN_PROFILE.displayName} Testnet`,
          isDeathBC: false,
          deathYear: 0,
          deathMonth: 0,
          deathDay: 0,
          deathPlace: "",
          story: `DeepFamily automated ${CHAIN_PROFILE.displayName} acceptance identity`,
        },
        proofArtifacts: disclosureProofArtifactPaths,
      }),
      PROOF_TIMEOUT_MS,
      "Disclosure binding proof and NFT submission",
    );
    const disclosureProofArtifacts = await hashProofArtifacts(ethers, mintResult.proofArtifacts);
    assertProofArtifactsUnchanged(
      disclosureProofArtifactsBefore,
      disclosureProofArtifacts,
      "Disclosure binding proof artifact",
    );
    await recordTx("zk-mint-person-nft", mintResult.tx);
    const tokenId = await deepFamily.versionToTokenId(personHash, 1);
    assertCondition(tokenId > 0n, "NFT token ID was not assigned");
    assertCondition(
      (await deepFamily.ownerOf(tokenId)) === runDeployer.address,
      "NFT owner mismatch",
    );

    const storyContent = `${CHAIN_PROFILE.displayName} automated acceptance ${config.runId}`;
    const storyHash = ethers.keccak256(ethers.toUtf8Bytes(storyContent));
    await recordTx(
      "story-add-chunk",
      await deepFamily
        .connect(runDeployer)
        .addStoryChunk(tokenId, 0, 0, storyContent, "", storyHash),
    );
    const storyChunk = await deepFamilyReader.getStoryChunk(tokenId, 0);
    assertCondition(storyChunk.content === storyContent, "Reader returned different story content");
    assertCondition(storyChunk.chunkHash === storyHash, "Reader returned different story hash");
    await recordTx("story-seal", await deepFamily.connect(runDeployer).sealStory(tokenId));
    const storyMetadata = await deepFamilyReader.getStoryMetadata(tokenId);
    assertCondition(storyMetadata.isSealed, "Story is not sealed");
    await expectRevert(
      () =>
        deepFamily
          .connect(runDeployer)
          .addStoryChunk.staticCall(tokenId, 1, 0, "after seal", "", ethers.ZeroHash),
      "Writing a sealed story",
      {
        expectedErrorNames: ["StoryAlreadySealed"],
        expectedSelectors: [STORY_ALREADY_SEALED_SELECTOR],
      },
    );
    await recordTx(
      "cancel-endorsement",
      await deepFamily.connect(runDeployer).cancelEndorsement(personHash),
    );
    assertCondition(
      (await deepFamily.endorsedVersionIndex(personHash, runDeployer.address)) === 0n,
      "Endorsement cancellation did not clear the index",
    );
    report.business = {
      personHash,
      versionIndex: 1,
      fatherAndMotherCommitments: true,
      parentRecordsRequiredOnChain: false,
      reward,
      protocolShare,
      tokenId,
      storyHash,
      storySealed: true,
      endorsementCancelled: true,
      proofArtifacts: {
        personCommitment: { stableDuringGeneration: true, files: personProofArtifacts },
        disclosureBinding: { stableDuringGeneration: true, files: disclosureProofArtifacts },
      },
      activePersonVerifier,
      activeProtocolFee,
      activeVerifierRouteUsedByRealProof:
        (await deepFamily.verifierRegistry(
          PERSON_RELATION_PURPOSE,
          RELEASE_PERSON_RELATION_CIRCUIT_ID,
        )) === activePersonVerifier,
    };
    await addStep("real-zk-endorsement-nft-story", report.business);

    let governanceLifecycleTerminalContext = null;
    if (config.runGovernanceLifecycle) {
      currentStep = "treasury";
      const treasuryAmount = ethers.parseEther("1");
      assertCondition(
        (await token.balanceOf(timelockAddress)) >= treasuryAmount,
        "Timelock treasury has less than 1 DEEP",
      );
      const treasuryRecipient = ownerA.address;
      const recipientBefore = await token.balanceOf(treasuryRecipient);
      const treasuryOperation = await scheduleOperation({
        label: "treasury-transfer",
        target: addresses.token,
        data: token.interface.encodeFunctionData("transfer", [treasuryRecipient, treasuryAmount]),
        salt: deriveTreasuryTransferSalt(ethers, {
          timelockAddress,
          tokenAddress: addresses.token,
          recipient: treasuryRecipient,
          rawAmount: treasuryAmount,
        }),
        signers: [ownerA, ownerC],
      });
      await waitForReady(timelock, treasuryOperation.operationId, config.minDelay);
      await executeOperation("treasury-transfer", treasuryOperation, [ownerB, ownerC]);
      const recipientAfter = await token.balanceOf(treasuryRecipient);
      assertCondition(
        recipientAfter - recipientBefore === treasuryAmount,
        "Delayed treasury transfer balance delta mismatch",
      );
      report.treasury = {
        operationId: treasuryOperation.operationId,
        recipient: treasuryRecipient,
        amount: treasuryAmount,
        balanceBefore: treasuryBefore,
        balanceAfterEndorsement: treasuryAfter,
        signaturePairs: { schedule: "AC", execute: "BC" },
      };
      await addStep("delayed-deep-treasury-transfer", report.treasury);

      currentStep = "upgrade-candidate";
      await assertImplementationStorageSafe(hre, "DeepFamily", "DeepFamilyV2Mock");
      const v2 = await deploy("DeepFamilyV2Mock", runDeployer, [], {
        libraries: {
          PoseidonT5: addresses.poseidonT5,
          AdultAgeGate: addresses.adultAgeGate,
        },
      });
      const v2Address = await v2.getAddress();
      await assertImplementationMatchesArtifact({
        connection,
        ethers,
        hre,
        contractName: "DeepFamilyV2Mock",
        implementation: v2Address,
        spec: {
          needsLibraries: true,
          libraryAddresses: {
            PoseidonT5: addresses.poseidonT5,
            AdultAgeGate: addresses.adultAgeGate,
          },
        },
      });
      report.addresses.deepFamilyV2 = v2Address;
      await saveReport();

      const candidateVerificationEntries = [
        await verificationEntry(hre.artifacts, "DeepFamilyV2Mock", v2Address, [], {
          PoseidonT5: addresses.poseidonT5,
          AdultAgeGate: addresses.adultAgeGate,
        }),
      ];
      if (config.verify) {
        const verificationFailures = await verifyEntries(
          candidateVerificationEntries,
          report,
          saveReport,
          "upgrade-candidate",
        );
        if (verificationFailures.length > 0) {
          currentStep = "explorer-verification";
          throw new Error(
            `${verificationFailures.length} ${ACCEPTANCE_PROFILE.explorerName} verification(s) ` +
              "failed before upgrade scheduling; see report",
          );
        }
      }

      currentStep = "timelocked-upgrade";
      await expectRevert(
        () => deepFamily.connect(runDeployer).upgradeToAndCall.staticCall(v2Address, "0x"),
        "Direct deployer UUPS upgrade",
        {
          expectedErrorNames: ["OwnableUnauthorizedAccount"],
          expectedSelectors: [OWNABLE_UNAUTHORIZED_SELECTOR],
        },
      );
      const implementationBefore = await implementationAddress(
        ethers,
        provider,
        addresses.deepFamily,
      );
      const upgradeOperation = await scheduleOperation({
        label: "uups-upgrade",
        target: addresses.deepFamily,
        data: deepFamily.interface.encodeFunctionData("upgradeToAndCall", [v2Address, "0x"]),
        salt: deriveUpgradeSalt(ethers, {
          target: addresses.deepFamily,
          implementation: v2Address,
          initData: "0x",
        }),
        signers: [ownerA, ownerB],
      });
      await waitForReady(timelock, upgradeOperation.operationId, config.minDelay);
      await executeOperation("uups-upgrade", upgradeOperation, [ownerA, ownerC]);
      const implementationAfter = await implementationAddress(
        ethers,
        provider,
        addresses.deepFamily,
      );
      assertCondition(
        implementationAfter === ethers.getAddress(v2Address),
        "ERC-1967 implementation slot was not updated",
      );
      const deepFamilyV2 = await ethers.getContractAt(
        "DeepFamilyV2Mock",
        addresses.deepFamily,
        runDeployer,
      );
      assertCondition((await deepFamilyV2.version()) === "V2", "Upgraded proxy does not expose V2");
      assertCondition(
        (await deepFamilyV2.owner()) === timelockAddress,
        "Upgrade changed DeepFamily owner",
      );
      assertCondition(
        (await deepFamilyV2.personVersionsCount(personHash)) === 1n &&
          (await deepFamilyV2.versionToTokenId(personHash, 1)) === tokenId,
        "Upgrade did not preserve person/NFT state",
      );
      assertCondition(
        (await deepFamilyV2.DEEP_FAMILY_TOKEN_CONTRACT()) === addresses.token &&
          (await token.deepFamilyContract()) === addresses.deepFamily &&
          (await token.owner()) === ethers.ZeroAddress,
        "Upgrade changed Token wiring",
      );
      assertCondition(
        (await deepFamilyV2.verifierRegistry(
          PERSON_RELATION_PURPOSE,
          RELEASE_PERSON_RELATION_CIRCUIT_ID,
        )) === addresses.groth16VerifierAdapter &&
          (await deepFamilyV2.verifierRegistry(
            DISCLOSURE_BINDING_PURPOSE,
            RELEASE_DISCLOSURE_BINDING_CIRCUIT_ID,
          )) === addresses.groth16VerifierAdapter &&
          (await deepFamilyV2.verifierRegistry(
            PERSON_RELATION_PURPOSE,
            GOVERNED_PERSON_RELATION_CIRCUIT_ID,
          )) === addresses.governedVerifierCandidate,
        "Upgrade changed verifier routes",
      );
      assertCondition(
        (await deepFamilyV2.protocolEndorsementFeeBps()) === activeProtocolFee,
        "Upgrade changed the governed endorsement fee",
      );
      assertCondition(
        (await deepFamilyV2.endorsedVersionIndex(personHash, runDeployer.address)) === 0n,
        "Upgrade changed the cancelled endorsement state",
      );
      const storyMetadataAfterUpgrade = await deepFamilyReader.getStoryMetadata(tokenId);
      assertCondition(
        storyMetadataAfterUpgrade.isSealed &&
          storyMetadataAfterUpgrade.totalChunks === storyMetadata.totalChunks &&
          storyMetadataAfterUpgrade.fullStoryHash === storyMetadata.fullStoryHash,
        "Upgrade changed the sealed story state",
      );
      await recordTx("v2-set-new-value", await deepFamilyV2.setNewValue(42));
      assertCondition(
        (await deepFamilyV2.newValue()) === 42n,
        "V2 appended storage is not writable",
      );
      report.upgrade = {
        storageLayoutSafe: true,
        candidateRuntimeArtifactMatch: true,
        operationId: upgradeOperation.operationId,
        implementationBefore,
        implementationAfter,
        version: "V2",
        ownerPreserved: true,
        businessStatePreserved: true,
        keyWiringPreserved: true,
        governedFeePreserved: true,
        sealedStoryPreserved: true,
        newValue: 42,
        signaturePairs: { schedule: "AB", execute: "AC" },
      };
      await addStep("storage-safe-timelocked-uups-upgrade", report.upgrade);

      currentStep = "governance-lifecycle-migrations";
      const replacementSafeSaltNonce = BigInt(
        ethers.id(`deepfamily-e2e:${config.runId}:replacement-safe`),
      ).toString();
      const preparedReplacementSafe = await prepareCanonicalSafeDeployment({
        provider,
        chainId: EXPECTED_CHAIN_ID,
        owners: replacementSafeOwners,
        saltNonce: replacementSafeSaltNonce,
      });
      assertCondition(
        preparedReplacementSafe.safeAddress !== safeAddress,
        "Replacement Safe address equals the primary Safe",
      );
      assertCondition(
        (await provider.getCode(preparedReplacementSafe.safeAddress)) === "0x",
        `Predicted replacement Safe ${preparedReplacementSafe.safeAddress} is already deployed`,
      );
      await recordTx(
        "deploy-replacement-canonical-governance-safe",
        await runDeployer.sendTransaction(preparedReplacementSafe.deploymentTransaction),
      );
      const replacementSafeAddress = preparedReplacementSafe.safeAddress;
      const replacementSafeProfile = await assertCanonicalSafeProfile({
        provider,
        chainId: EXPECTED_CHAIN_ID,
        safeAddress: replacementSafeAddress,
        expectedOwners: replacementSafeOwners,
        expectedNonce: 0n,
      });
      const replacementSafeReader = await connectCanonicalSafe({
        provider,
        chainId: EXPECTED_CHAIN_ID,
        safeAddress: replacementSafeAddress,
      });
      const replacementSafeContext = {
        label: "replacement",
        safeAddress: replacementSafeAddress,
        safeReader: replacementSafeReader,
      };
      report.addresses.replacementGovernanceSafe = replacementSafeAddress;
      report.safeInfrastructure.replacement = {
        saltNonce: replacementSafeSaltNonce,
        address: replacementSafeAddress,
        singleton: replacementSafeProfile.singleton,
        proxyCodeHash: replacementSafeProfile.proxyCodeHash,
        canonicalProxyCodeHash: replacementSafeProfile.canonicalProxyCodeHash,
        proxyRuntimeMatched:
          replacementSafeProfile.proxyCodeHash === replacementSafeProfile.canonicalProxyCodeHash,
        owners: replacementSafeProfile.owners,
        threshold: replacementSafeProfile.threshold,
        nonce: replacementSafeProfile.nonce,
        modules: replacementSafeProfile.modules,
        guard: replacementSafeProfile.guard,
        fallbackHandler: replacementSafeProfile.fallbackHandler,
      };
      await saveReport();
      await expectSafeSimulationFailure({
        provider,
        from: runDeployer.address,
        safeAddress: replacementSafeAddress,
        data: abExecution.encodedTransaction,
        safeInterface,
        label: "Primary Safe owner signatures against replacement Safe",
        expectedSafeRevertCodes: ["GS026"],
      });
      assertCondition(
        BigInt(await replacementSafeReader.getNonce()) === 0n,
        "Rejected primary-owner signatures changed the replacement Safe nonce",
      );
      report.safePolicy.primaryOwnerSignaturesRejectedByReplacementSafe = true;

      const replacementTimelockConfig = await resolveTimelockDeploymentConfig({
        connection,
        ethers,
        provider,
        deployerAddress: runDeployer.address,
        env: {
          ...process.env,
          MIN_DELAY: String(config.minDelay),
          GOVERNANCE_SAFE_ADDRESS: replacementSafeAddress,
        },
        inspectMultisig: ({ provider: inspectionProvider, address }) =>
          assertCanonicalSafeProfile({
            provider: inspectionProvider,
            chainId: EXPECTED_CHAIN_ID,
            safeAddress: address,
            expectedOwners: replacementSafeOwners,
          }),
      });
      const ReplacementTimelockFactory = await ethers.getContractFactory(
        "GovernanceTimelock",
        runDeployer,
      );
      const replacementTimelock = await ReplacementTimelockFactory.deploy(
        replacementTimelockConfig.minDelay,
        replacementTimelockConfig.governanceMultisig,
      );
      const replacementTimelockDeploymentTx = replacementTimelock.deploymentTransaction();
      assertCondition(
        replacementTimelockDeploymentTx,
        "Replacement GovernanceTimelock deployment transaction is unavailable",
      );
      await recordTx("deploy-replacement-GovernanceTimelock", replacementTimelockDeploymentTx);
      const replacementTimelockAddress = await replacementTimelock.getAddress();
      report.addresses.replacementTimelock = replacementTimelockAddress;

      if (config.verify) {
        const replacementVerificationFailures = await verifyEntries(
          [
            {
              ...(await verificationEntry(
                hre.artifacts,
                "GovernanceTimelock",
                replacementTimelockAddress,
                [config.minDelay, replacementSafeAddress],
              )),
              label: "ReplacementGovernanceTimelock",
            },
          ],
          report,
          saveReport,
          "governance-replacements",
        );
        if (replacementVerificationFailures.length > 0) {
          throw new Error(
            `${replacementVerificationFailures.length} governance replacement verification(s) failed; see report`,
          );
        }
      }

      // A newly deployed contract can briefly be visible to one public-RPC backend while another
      // backend still returns `0x` for the same eth_call. Ethers reports that transient response as
      // "could not decode result data". Keep every migration-planning read bounded and retryable;
      // these operations are view-only, so retrying cannot duplicate a governance transaction.
      const migrationRead = (label, operation) =>
        retryBounded(operation, { attempts: 4, timeoutMs: 60_000, label });
      const originalRoleState = await migrationRead("pre-migration primary Timelock roles", () =>
        readExactTimelockRoleState({
          ethers,
          timelock,
          timelockAddress,
        }),
      );
      const replacementRoleState = await migrationRead(
        "pre-migration replacement Timelock roles",
        () =>
          readExactTimelockRoleState({
            ethers,
            timelock: replacementTimelock,
            timelockAddress: replacementTimelockAddress,
          }),
      );
      assertCondition(
        originalRoleState.currentMultisig === safeAddress,
        "Primary Timelock role owner changed before migration",
      );
      assertCondition(
        replacementRoleState.currentMultisig === replacementSafeAddress,
        "Replacement Timelock role owner mismatch",
      );

      const multisigMigration = await migrationRead(
        "build governance Safe migration operation",
        () =>
          buildMultisigMigrationOperation({
            ethers,
            timelock,
            timelockAddress,
            roles: originalRoleState.roles,
            oldMultisig: safeAddress,
            newMultisig: replacementSafeAddress,
          }),
      );
      const updatedRetiredTimelockDelay = BigInt(config.minDelay) + 1n;
      const delayUpdatePayload = timelock.interface.encodeFunctionData("updateDelay", [
        updatedRetiredTimelockDelay,
      ]);
      const delayUpdateSalt = deriveDelayUpdateSalt(ethers, {
        timelockAddress,
        newDelay: updatedRetiredTimelockDelay,
      });
      const delayUpdateOperationId = await migrationRead(
        "hash retired Timelock delay update operation",
        () =>
          timelock.hashOperation(
            timelockAddress,
            0n,
            delayUpdatePayload,
            ZERO_HASH,
            delayUpdateSalt,
          ),
      );
      const ownerMigration = await migrationRead("build Timelock owner migration operation", () =>
        buildOwnerMigrationOperation({
          ethers,
          oldTimelock: timelock,
          oldTimelockAddress: timelockAddress,
          deepFamily: deepFamilyV2,
          deepFamilyAddress: addresses.deepFamily,
          tokenAddress: addresses.token,
          newTimelockAddress: replacementTimelockAddress,
        }),
      );
      const postMigrationFee = activeProtocolFee === 504n ? 505n : activeProtocolFee + 1n;
      const postMigrationFeeData = deepFamilyV2.interface.encodeFunctionData(
        "updateEndorsementFee",
        [postMigrationFee],
      );
      const postMigrationFeeSalt = deriveGovernanceSalt(ethers, {
        targetAddress: addresses.deepFamily,
        calldata: postMigrationFeeData,
      });
      const postMigrationFeeOperationId = await migrationRead(
        "hash replacement Timelock fee operation",
        () =>
          replacementTimelock.hashOperation(
            addresses.deepFamily,
            0n,
            postMigrationFeeData,
            ZERO_HASH,
            postMigrationFeeSalt,
          ),
      );

      const scheduleBatchThroughSafe = async ({
        label,
        targetTimelock,
        targetTimelockAddress,
        operation,
        signers,
        safeContext,
      }) => {
        const calldata = targetTimelock.interface.encodeFunctionData("scheduleBatch", [
          operation.targets,
          operation.values,
          operation.payloads,
          operation.predecessor,
          operation.salt,
          config.minDelay,
        ]);
        await executeSafe(
          `${label}-schedule`,
          targetTimelockAddress,
          0n,
          calldata,
          signers,
          safeContext,
        );
        assertCondition(
          await migrationRead(`${label} pending-state read`, () =>
            targetTimelock.isOperationPending(operation.operationId),
          ),
          `${label} is not pending`,
        );
      };
      const executeBatchThroughSafe = async ({
        label,
        targetTimelock,
        targetTimelockAddress,
        operation,
        signers,
        safeContext,
      }) => {
        const calldata = targetTimelock.interface.encodeFunctionData("executeBatch", [
          operation.targets,
          operation.values,
          operation.payloads,
          operation.predecessor,
          operation.salt,
        ]);
        await executeSafe(
          `${label}-execute`,
          targetTimelockAddress,
          0n,
          calldata,
          signers,
          safeContext,
        );
        assertCondition(
          await migrationRead(`${label} done-state read`, () =>
            targetTimelock.isOperationDone(operation.operationId),
          ),
          `${label} is not done`,
        );
      };
      const scheduleSingleThroughSafe = async ({
        label,
        targetTimelock,
        targetTimelockAddress,
        target,
        data,
        salt,
        operationId,
        signers,
        safeContext,
      }) => {
        const calldata = targetTimelock.interface.encodeFunctionData("schedule", [
          target,
          0n,
          data,
          ZERO_HASH,
          salt,
          config.minDelay,
        ]);
        await executeSafe(
          `${label}-schedule`,
          targetTimelockAddress,
          0n,
          calldata,
          signers,
          safeContext,
        );
        assertCondition(
          await migrationRead(`${label} pending-state read`, () =>
            targetTimelock.isOperationPending(operationId),
          ),
          `${label} is not pending`,
        );
      };
      const executeSingleThroughSafe = async ({
        label,
        targetTimelock,
        targetTimelockAddress,
        target,
        data,
        salt,
        operationId,
        signers,
        safeContext,
      }) => {
        const calldata = targetTimelock.interface.encodeFunctionData("execute", [
          target,
          0n,
          data,
          ZERO_HASH,
          salt,
        ]);
        await executeSafe(
          `${label}-execute`,
          targetTimelockAddress,
          0n,
          calldata,
          signers,
          safeContext,
        );
        assertCondition(
          await migrationRead(`${label} done-state read`, () =>
            targetTimelock.isOperationDone(operationId),
          ),
          `${label} is not done`,
        );
      };

      await scheduleBatchThroughSafe({
        label: "governance-safe-migration",
        targetTimelock: timelock,
        targetTimelockAddress: timelockAddress,
        operation: multisigMigration,
        signers: [ownerA, ownerB],
        safeContext: primarySafeContext,
      });
      await scheduleSingleThroughSafe({
        label: "timelock-delay-update",
        targetTimelock: timelock,
        targetTimelockAddress: timelockAddress,
        target: timelockAddress,
        data: delayUpdatePayload,
        salt: delayUpdateSalt,
        operationId: delayUpdateOperationId,
        signers: [ownerA, ownerC],
        safeContext: primarySafeContext,
      });
      await scheduleBatchThroughSafe({
        label: "timelock-owner-treasury-migration",
        targetTimelock: timelock,
        targetTimelockAddress: timelockAddress,
        operation: ownerMigration,
        signers: [ownerB, ownerC],
        safeContext: primarySafeContext,
      });
      await scheduleSingleThroughSafe({
        label: "post-migration-fee",
        targetTimelock: replacementTimelock,
        targetTimelockAddress: replacementTimelockAddress,
        target: addresses.deepFamily,
        data: postMigrationFeeData,
        salt: postMigrationFeeSalt,
        operationId: postMigrationFeeOperationId,
        signers: [ownerD, ownerE],
        safeContext: replacementSafeContext,
      });

      const oldTreasuryAtOwnerMigrationSchedule = await token.balanceOf(timelockAddress);
      await recordTx(
        "migration-window-endorsement-approve",
        await token.connect(runDeployer).approve(addresses.deepFamily, reward),
      );
      await recordTx(
        "migration-window-endorsement",
        await deepFamilyV2.connect(runDeployer).endorseVersion(personHash, 1),
      );
      const oldTreasuryBeforeOwnerMigration = await token.balanceOf(timelockAddress);
      assertCondition(
        oldTreasuryBeforeOwnerMigration - oldTreasuryAtOwnerMigrationSchedule === protocolShare,
        "Protocol fee received during the owner-migration delay window is incorrect",
      );
      await recordTx(
        "migration-window-cancel-endorsement",
        await deepFamilyV2.connect(runDeployer).cancelEndorsement(personHash),
      );

      await Promise.all([
        waitForReady(timelock, multisigMigration.operationId, config.minDelay),
        waitForReady(timelock, delayUpdateOperationId, config.minDelay),
        waitForReady(timelock, ownerMigration.operationId, config.minDelay),
        waitForReady(replacementTimelock, postMigrationFeeOperationId, config.minDelay),
      ]);

      // Keep the same preconditions and order enforced by timelock-migrate-owner: the old
      // Timelock still has its original delay and the original Safe still holds every operational
      // role when ownership and the complete execution-time treasury balance migrate atomically.
      const replacementTreasuryBeforeOwnerMigration = await token.balanceOf(
        replacementTimelockAddress,
      );
      await executeBatchThroughSafe({
        label: "timelock-owner-treasury-migration",
        targetTimelock: timelock,
        targetTimelockAddress: timelockAddress,
        operation: ownerMigration,
        signers: [ownerB, ownerC],
        safeContext: primarySafeContext,
      });
      const oldTreasuryAfterOwnerMigration = await token.balanceOf(timelockAddress);
      const replacementTreasuryAfterOwnerMigration = await token.balanceOf(
        replacementTimelockAddress,
      );
      assertCondition(
        (await deepFamilyV2.owner()) === replacementTimelockAddress,
        "DeepFamily ownership did not migrate to the replacement Timelock",
      );
      assertCondition(oldTreasuryAfterOwnerMigration === 0n, "Retired Timelock still holds DEEP");
      assertCondition(
        replacementTreasuryAfterOwnerMigration - replacementTreasuryBeforeOwnerMigration ===
          oldTreasuryBeforeOwnerMigration,
        "Replacement Timelock did not receive the complete execution-time DEEP balance",
      );

      await executeBatchThroughSafe({
        label: "governance-safe-migration",
        targetTimelock: timelock,
        targetTimelockAddress: timelockAddress,
        operation: multisigMigration,
        signers: [ownerA, ownerB],
        safeContext: primarySafeContext,
      });
      const migratedRoleState = await migrationRead("post-migration primary Timelock roles", () =>
        readExactTimelockRoleState({
          ethers,
          timelock,
          timelockAddress,
        }),
      );
      assertCondition(
        migratedRoleState.currentMultisig === replacementSafeAddress,
        "Primary Timelock roles did not atomically migrate to the replacement Safe",
      );

      const unauthorizedOldSafeSalt = ethers.id(
        `deepfamily-e2e:${config.runId}:old-safe-must-fail`,
      );
      const unauthorizedOldSafeData = timelock.interface.encodeFunctionData("schedule", [
        addresses.deepFamily,
        0n,
        governedFeeData,
        ZERO_HASH,
        unauthorizedOldSafeSalt,
        config.minDelay,
      ]);
      const unauthorizedOldSafeExecution = await signedExecution(
        timelockAddress,
        0n,
        unauthorizedOldSafeData,
        [ownerA, ownerC],
        primarySafeContext,
      );
      const primaryNonceBeforeUnauthorizedCall = await safeReader.getNonce();
      await expectSafeSimulationFailure({
        provider,
        from: runDeployer.address,
        safeAddress,
        data: unauthorizedOldSafeExecution.encodedTransaction,
        safeInterface,
        label: "Retired Safe governance call",
        expectedSafeRevertCodes: ["GS013"],
      });
      assertCondition(
        (await safeReader.getNonce()) === primaryNonceBeforeUnauthorizedCall,
        "Retired Safe failure simulation changed its nonce",
      );

      await executeSingleThroughSafe({
        label: "timelock-delay-update",
        targetTimelock: timelock,
        targetTimelockAddress: timelockAddress,
        target: timelockAddress,
        data: delayUpdatePayload,
        salt: delayUpdateSalt,
        operationId: delayUpdateOperationId,
        signers: [ownerD, ownerF],
        safeContext: replacementSafeContext,
      });
      assertCondition(
        (await timelock.getMinDelay()) === updatedRetiredTimelockDelay,
        "Timelock delay update did not take effect",
      );

      await executeSingleThroughSafe({
        label: "post-migration-fee",
        targetTimelock: replacementTimelock,
        targetTimelockAddress: replacementTimelockAddress,
        target: addresses.deepFamily,
        data: postMigrationFeeData,
        salt: postMigrationFeeSalt,
        operationId: postMigrationFeeOperationId,
        signers: [ownerD, ownerE],
        safeContext: replacementSafeContext,
      });
      assertCondition(
        (await deepFamilyV2.protocolEndorsementFeeBps()) === postMigrationFee,
        "Replacement Safe and Timelock could not execute post-migration governance",
      );

      report.governanceLifecycle = {
        replacementSafe: replacementSafeAddress,
        replacementTimelock: replacementTimelockAddress,
        multisigMigrationOperationId: multisigMigration.operationId,
        oldSafeRejectedAfterMigration: true,
        delayUpdateOperationId,
        previousDelay: config.minDelay,
        updatedRetiredTimelockDelay,
        ownerMigrationOperationId: ownerMigration.operationId,
        ownerAfterMigration: replacementTimelockAddress,
        treasuryAtOwnerMigrationSchedule: oldTreasuryAtOwnerMigrationSchedule,
        treasuryBeforeOwnerMigration: oldTreasuryBeforeOwnerMigration,
        treasuryAfterOwnerMigration: replacementTreasuryAfterOwnerMigration,
        delayWindowProtocolFeeIncluded: true,
        retiredTimelockTreasuryEmpty: true,
        postMigrationFeeOperationId,
        postMigrationFee,
        ownerSets: {
          primary: { labels: ["A", "B", "C"], addresses: primarySafeOwners },
          replacement: { labels: ["D", "E", "F"], addresses: replacementSafeOwners },
        },
        primaryOwnerSignaturesRejectedByReplacementSafe: true,
        replacementSignaturePairs: {
          postMigrationFeeSchedule: "DE",
          retiredTimelockDelayExecute: "DF",
          postMigrationFeeExecute: "DE",
        },
        replacementGovernanceOperational: true,
      };
      report.productionParity.sharedGovernanceOperationBuildersMatched = true;
      await addStep("safe-delay-timelock-and-treasury-migrations", report.governanceLifecycle);
      governanceLifecycleTerminalContext = {
        deepFamilyV2,
        postMigrationFee,
        replacementSafeAddress,
        replacementTimelock,
        replacementTimelockAddress,
        updatedRetiredTimelockDelay,
        v2Address,
      };
    }

    currentStep = "chain-finality";
    const lastCriticalBlock = Math.max(
      ...Object.values(report.transactions).map((receipt) => Number(receipt.blockNumber)),
    );
    if (config.requireFinality) {
      const finalizedBlock = await pollUntil(
        async () => {
          const block = await retryBounded(() => provider.getBlock("finalized"), {
            attempts: 1,
            timeoutMs: 30_000,
            label: "finalized head query",
          });
          return block && Number(block.number) >= lastCriticalBlock ? block : null;
        },
        {
          timeoutMs: config.finalityTimeoutMs,
          intervalMs: POLL_INTERVAL_MS,
          label: `finalized block covering acceptance block ${lastCriticalBlock}`,
        },
      );
      const revalidatedTransactions = [];
      for (const [label, expectedReceipt] of Object.entries(report.transactions)) {
        const canonicalReceipt = await retryBounded(
          () => provider.getTransactionReceipt(expectedReceipt.hash),
          { label: `finality receipt revalidation for ${label}` },
        );
        assertCondition(canonicalReceipt, `${label} receipt disappeared before finality`);
        assertCondition(Number(canonicalReceipt.status) === 1, `${label} is not successful`);
        assertCondition(
          Number(canonicalReceipt.blockNumber) === Number(expectedReceipt.blockNumber),
          `${label} moved from block ${expectedReceipt.blockNumber} to ` +
            `${canonicalReceipt.blockNumber}`,
        );
        assertCondition(
          String(canonicalReceipt.blockHash).toLowerCase() ===
            String(expectedReceipt.blockHash).toLowerCase(),
          `${label} receipt block hash changed before finality`,
        );
        assertCondition(
          Number(finalizedBlock.number) >= Number(canonicalReceipt.blockNumber),
          `${label} is above the finalized head`,
        );
        const canonicalBlock = await retryBounded(
          () => provider.getBlock(canonicalReceipt.blockNumber),
          { label: `canonical block revalidation for ${label}` },
        );
        assertCondition(canonicalBlock, `${label} canonical block is unavailable`);
        assertCondition(
          String(canonicalBlock.hash).toLowerCase() ===
            String(canonicalReceipt.blockHash).toLowerCase(),
          `${label} receipt is no longer in the canonical block at its recorded height`,
        );
        revalidatedTransactions.push({
          label,
          hash: canonicalReceipt.hash,
          blockNumber: canonicalReceipt.blockNumber,
          blockHash: canonicalReceipt.blockHash,
          status: Number(canonicalReceipt.status),
        });
      }
      report.network.finality = {
        required: true,
        status: "passed",
        lastCriticalBlock,
        finalizedBlockNumber: finalizedBlock.number,
        finalizedBlockHash: finalizedBlock.hash,
        revalidatedTransactionCount: revalidatedTransactions.length,
        revalidatedTransactions,
      };
      report.productionParity.criticalTransactionsFinalized = true;
      await addStep("critical-transactions-finalized", report.network.finality);
    } else {
      report.network.finality = {
        required: false,
        status: "skipped-diagnostic",
        lastCriticalBlock,
      };
      await addStep("critical-transactions-finality-skipped", report.network.finality);
    }

    currentStep = "terminal-governance-state";
    const terminalRead = (label, operation) =>
      retryBounded(operation, { attempts: 4, timeoutMs: 60_000, label });
    if (config.runGovernanceLifecycle) {
      assertCondition(
        governanceLifecycleTerminalContext,
        "Diagnostic governance lifecycle terminal context is unavailable",
      );
      const {
        deepFamilyV2,
        postMigrationFee,
        replacementSafeAddress,
        replacementTimelock,
        replacementTimelockAddress,
        updatedRetiredTimelockDelay,
        v2Address,
      } = governanceLifecycleTerminalContext;
      const terminalPrimarySafeProfile = await terminalRead("terminal primary Safe profile", () =>
        assertCanonicalSafeProfile({
          provider,
          chainId: EXPECTED_CHAIN_ID,
          safeAddress,
          expectedOwners: primarySafeOwners,
        }),
      );
      const terminalReplacementSafeProfile = await terminalRead(
        "terminal replacement Safe profile",
        () =>
          assertCanonicalSafeProfile({
            provider,
            chainId: EXPECTED_CHAIN_ID,
            safeAddress: replacementSafeAddress,
            expectedOwners: replacementSafeOwners,
          }),
      );
      const terminalPrimaryTimelockRoles = await terminalRead(
        "terminal retired Timelock roles",
        () => readExactTimelockRoleState({ ethers, timelock, timelockAddress }),
      );
      const terminalReplacementTimelockRoles = await terminalRead(
        "terminal replacement Timelock roles",
        () =>
          readExactTimelockRoleState({
            ethers,
            timelock: replacementTimelock,
            timelockAddress: replacementTimelockAddress,
          }),
      );
      const terminalPrimaryTimelockDelay = await terminalRead(
        "terminal retired Timelock delay",
        () => timelock.getMinDelay(),
      );
      const terminalReplacementTimelockDelay = await terminalRead(
        "terminal replacement Timelock delay",
        () => replacementTimelock.getMinDelay(),
      );
      const terminalDeepFamilyOwner = await terminalRead("terminal DeepFamily owner", () =>
        deepFamilyV2.owner(),
      );
      const terminalDeepFamilyImplementation = await terminalRead(
        "terminal DeepFamily implementation",
        () => implementationAddress(ethers, provider, addresses.deepFamily),
      );
      const terminalPersonVerifier = await terminalRead("terminal person verifier", () =>
        deepFamilyV2.verifierRegistry(PERSON_RELATION_PURPOSE, RELEASE_PERSON_RELATION_CIRCUIT_ID),
      );
      const terminalGovernedPersonVerifier = await terminalRead(
        "terminal governed person verifier",
        () =>
          deepFamilyV2.verifierRegistry(
            PERSON_RELATION_PURPOSE,
            GOVERNED_PERSON_RELATION_CIRCUIT_ID,
          ),
      );
      const terminalDisclosureVerifier = await terminalRead("terminal disclosure verifier", () =>
        deepFamilyV2.verifierRegistry(
          DISCLOSURE_BINDING_PURPOSE,
          RELEASE_DISCLOSURE_BINDING_CIRCUIT_ID,
        ),
      );
      const terminalProtocolFee = await terminalRead("terminal protocol fee", () =>
        deepFamilyV2.protocolEndorsementFeeBps(),
      );
      const terminalTokenOwner = await terminalRead("terminal token owner", () => token.owner());
      const terminalTokenBinding = await terminalRead("terminal token binding", () =>
        token.deepFamilyContract(),
      );
      const terminalDeepFamilyToken = await terminalRead("terminal protocol token binding", () =>
        deepFamilyV2.DEEP_FAMILY_TOKEN_CONTRACT(),
      );
      const terminalRetiredTreasuryBalance = await terminalRead(
        "terminal retired treasury balance",
        () => token.balanceOf(timelockAddress),
      );
      assertCondition(
        ethers.getAddress(terminalPrimaryTimelockRoles.currentMultisig) === replacementSafeAddress,
        "Retired Timelock terminal governance roles do not belong exclusively to replacement Safe",
      );
      assertCondition(
        ethers.getAddress(terminalReplacementTimelockRoles.currentMultisig) ===
          replacementSafeAddress,
        "Replacement Timelock terminal governance roles do not belong exclusively to replacement Safe",
      );
      assertCondition(
        terminalPrimaryTimelockDelay === updatedRetiredTimelockDelay,
        "Retired Timelock terminal delay mismatch",
      );
      assertCondition(
        terminalReplacementTimelockDelay === BigInt(config.minDelay),
        "Replacement Timelock terminal delay mismatch",
      );
      assertCondition(
        ethers.getAddress(terminalDeepFamilyOwner) === replacementTimelockAddress,
        "DeepFamily terminal owner is not replacement Timelock",
      );
      assertCondition(
        ethers.getAddress(terminalDeepFamilyImplementation) === v2Address,
        "DeepFamily terminal implementation is not the verified V2 candidate",
      );
      assertCondition(
        ethers.getAddress(terminalPersonVerifier) === addresses.groth16VerifierAdapter &&
          ethers.getAddress(terminalGovernedPersonVerifier) ===
            addresses.governedVerifierCandidate &&
          ethers.getAddress(terminalDisclosureVerifier) === addresses.groth16VerifierAdapter,
        "DeepFamily terminal verifier routes changed unexpectedly",
      );
      assertCondition(
        terminalProtocolFee === postMigrationFee,
        "DeepFamily terminal endorsement fee mismatch",
      );
      assertCondition(
        terminalTokenOwner === ethers.ZeroAddress,
        "DeepFamilyToken terminal owner must remain renounced",
      );
      assertCondition(
        ethers.getAddress(terminalTokenBinding) === addresses.deepFamily &&
          ethers.getAddress(terminalDeepFamilyToken) === addresses.token,
        "DeepFamilyToken terminal two-way binding mismatch",
      );
      assertCondition(
        terminalRetiredTreasuryBalance === 0n,
        "Retired Timelock terminal DEEP treasury is not empty",
      );
      report.terminalGovernanceState = {
        status: "passed",
        observedAfterFinality: report.network.finality.status === "passed",
        observedAtBlock: await provider.getBlockNumber(),
        safes: {
          primary: terminalPrimarySafeProfile,
          replacement: terminalReplacementSafeProfile,
        },
        timelocks: {
          retired: {
            address: timelockAddress,
            ...terminalPrimaryTimelockRoles,
            minDelay: terminalPrimaryTimelockDelay,
          },
          replacement: {
            address: replacementTimelockAddress,
            ...terminalReplacementTimelockRoles,
            minDelay: terminalReplacementTimelockDelay,
          },
        },
        deepFamily: {
          address: addresses.deepFamily,
          owner: terminalDeepFamilyOwner,
          implementation: terminalDeepFamilyImplementation,
          personCommitmentVerifier: terminalPersonVerifier,
          governedPersonRelationVerifier: terminalGovernedPersonVerifier,
          disclosureBindingVerifier: terminalDisclosureVerifier,
          protocolEndorsementFeeBps: terminalProtocolFee,
        },
        token: {
          address: addresses.token,
          owner: terminalTokenOwner,
          deepFamilyContract: terminalTokenBinding,
          deepFamilyTokenFromProtocol: terminalDeepFamilyToken,
        },
        retiredTimelockTreasuryBalance: terminalRetiredTreasuryBalance,
      };
    } else {
      const terminalSafeProfile = await terminalRead("terminal governance Safe profile", () =>
        assertCanonicalSafeProfile({
          provider,
          chainId: EXPECTED_CHAIN_ID,
          safeAddress,
          expectedOwners: primarySafeOwners,
        }),
      );
      const terminalTimelockRoles = await terminalRead("terminal Timelock roles", () =>
        readExactTimelockRoleState({ ethers, timelock, timelockAddress }),
      );
      const terminalTimelockDelay = await terminalRead("terminal Timelock delay", () =>
        timelock.getMinDelay(),
      );
      const terminalDeepFamilyOwner = await terminalRead("terminal DeepFamily owner", () =>
        deepFamily.owner(),
      );
      const terminalDeepFamilyImplementation = await terminalRead(
        "terminal DeepFamily implementation",
        () => implementationAddress(ethers, provider, addresses.deepFamily),
      );
      const terminalPersonVerifier = await terminalRead("terminal person verifier", () =>
        deepFamily.verifierRegistry(PERSON_RELATION_PURPOSE, RELEASE_PERSON_RELATION_CIRCUIT_ID),
      );
      const terminalDisclosureVerifier = await terminalRead("terminal disclosure verifier", () =>
        deepFamily.verifierRegistry(
          DISCLOSURE_BINDING_PURPOSE,
          RELEASE_DISCLOSURE_BINDING_CIRCUIT_ID,
        ),
      );
      const terminalProtocolFee = await terminalRead("terminal protocol fee", () =>
        deepFamily.protocolEndorsementFeeBps(),
      );
      const terminalTokenOwner = await terminalRead("terminal token owner", () => token.owner());
      const terminalTokenBinding = await terminalRead("terminal token binding", () =>
        token.deepFamilyContract(),
      );
      const terminalDeepFamilyToken = await terminalRead("terminal protocol token binding", () =>
        deepFamily.DEEP_FAMILY_TOKEN_CONTRACT(),
      );
      const terminalReaderBinding = await terminalRead("terminal reader binding", () =>
        deepFamilyReader.DEEP_FAMILY(),
      );
      assertCondition(
        ethers.getAddress(terminalTimelockRoles.currentMultisig) === safeAddress,
        "Timelock terminal governance roles do not belong exclusively to the release Safe",
      );
      assertCondition(
        terminalTimelockDelay === BigInt(config.productionMinDelay),
        "Timelock terminal production delay mismatch",
      );
      assertCondition(
        ethers.getAddress(terminalDeepFamilyOwner) === timelockAddress,
        "DeepFamily terminal owner is not the initial Timelock",
      );
      assertCondition(
        ethers.getAddress(terminalDeepFamilyImplementation) ===
          ethers.getAddress(addresses.deepFamilyImplementation),
        "DeepFamily terminal implementation is not the initial release implementation",
      );
      assertCondition(
        ethers.getAddress(terminalPersonVerifier) === addresses.groth16VerifierAdapter &&
          ethers.getAddress(terminalDisclosureVerifier) === addresses.groth16VerifierAdapter,
        "DeepFamily initial verifier routes changed unexpectedly",
      );
      assertCondition(
        terminalProtocolFee === 500n && feeBefore === 500n,
        "DeepFamily initial endorsement fee must remain 500 bps",
      );
      assertCondition(
        terminalTokenOwner === ethers.ZeroAddress,
        "DeepFamilyToken terminal owner must remain renounced",
      );
      assertCondition(
        ethers.getAddress(terminalTokenBinding) === addresses.deepFamily &&
          ethers.getAddress(terminalDeepFamilyToken) === addresses.token,
        "DeepFamilyToken terminal two-way binding mismatch",
      );
      assertCondition(
        ethers.getAddress(terminalReaderBinding) === addresses.deepFamily,
        "DeepFamilyReader terminal binding mismatch",
      );
      report.terminalGovernanceState = {
        status: "passed",
        observedAfterFinality: report.network.finality.status === "passed",
        observedAtBlock: await provider.getBlockNumber(),
        safe: terminalSafeProfile,
        timelock: {
          address: timelockAddress,
          ...terminalTimelockRoles,
          minDelay: terminalTimelockDelay,
        },
        deepFamily: {
          address: addresses.deepFamily,
          owner: terminalDeepFamilyOwner,
          implementation: terminalDeepFamilyImplementation,
          personCommitmentVerifier: terminalPersonVerifier,
          disclosureBindingVerifier: terminalDisclosureVerifier,
          protocolEndorsementFeeBps: terminalProtocolFee,
        },
        token: {
          address: addresses.token,
          owner: terminalTokenOwner,
          deepFamilyContract: terminalTokenBinding,
          deepFamilyTokenFromProtocol: terminalDeepFamilyToken,
        },
        reader: {
          address: addresses.deepFamilyReader,
          deepFamily: terminalReaderBinding,
        },
      };
    }
    await addStep("terminal-governance-state-verified", report.terminalGovernanceState);

    currentStep = "source-input-integrity";
    const acceptanceInputsAfter = await hashAcceptanceInputs(ethers);
    const gitStateAfter = gitWorkingTreeState();
    report.sourceState.after = {
      ...gitStateAfter,
      acceptanceInputDigest: acceptanceInputsAfter.digest,
      acceptanceInputs: acceptanceInputsAfter,
    };
    report.sourceState.unchanged =
      gitStateAfter.commit === report.sourceState.commit &&
      gitStateAfter.clean === report.sourceState.clean &&
      acceptanceInputsAfter.digest === report.sourceState.acceptanceInputDigest;
    assertCondition(
      report.sourceState.unchanged,
      "Acceptance source inputs or Git commit/clean state changed while the run was in progress",
    );
    await addStep("acceptance-source-inputs-unchanged", {
      commit: gitStateAfter.commit,
      clean: gitStateAfter.clean,
      acceptanceInputDigest: acceptanceInputsAfter.digest,
    });

    report.onchain.status = "passed";
    await saveReport();

    currentStep = "deployment-directory-integrity";
    const deploymentsAfter = await hashDirectory(ethers, DEPLOYMENTS_DIR);
    report.deploymentsDirectory.after = deploymentsAfter;
    report.deploymentsDirectory.unchanged =
      deploymentsBefore.fileCount === deploymentsAfter.fileCount &&
      deploymentsBefore.digest === deploymentsAfter.digest;
    assertCondition(
      report.deploymentsDirectory.unchanged,
      `${DEPLOYMENTS_DIR} changed during isolated acceptance run`,
    );
    await addStep("deployment-directory-unchanged", deploymentsAfter);
    report.status = "passed";
  } catch (error) {
    originalError = error;
    report.status = "failed";
    report.failedStep = currentStep;
    report.error = safeErrorMessage(error, secretValues);
    if (report.onchain.status !== "passed") report.onchain.status = "failed";
  } finally {
    if (oldGovernanceTimelockAddress === undefined) {
      delete process.env.GOVERNANCE_TIMELOCK_ADDRESS;
    } else {
      process.env.GOVERNANCE_TIMELOCK_ADDRESS = oldGovernanceTimelockAddress;
    }
    if (oldGovernanceSafeAddress === undefined) delete process.env.GOVERNANCE_SAFE_ADDRESS;
    else process.env.GOVERNANCE_SAFE_ADDRESS = oldGovernanceSafeAddress;
    if (oldGovernanceSafeProfile === undefined) delete process.env.GOVERNANCE_SAFE_PROFILE;
    else process.env.GOVERNANCE_SAFE_PROFILE = oldGovernanceSafeProfile;

    if (funded) {
      try {
        report.budget.refund = await refundWallet({
          ethers,
          provider,
          wallet: runDeployer,
          recipient: funder.address,
          confirmations: config.confirmations,
        });
      } catch (refundError) {
        report.budget.refund = {
          status: "failed",
          error: safeErrorMessage(refundError, secretValues),
        };
        if (!originalError) {
          originalError = refundError;
          report.status = "failed";
          report.failedStep = "refund";
          report.error = safeErrorMessage(refundError, secretValues);
        }
      }
    } else {
      report.budget.refund = { status: "not-funded" };
    }

    report.budget.funderBalanceAfter = await provider.getBalance(funder.address).catch(() => null);
    report.budget.runBalanceAfter = await provider
      .getBalance(runDeployer.address)
      .catch(() => null);
    if (
      funded &&
      report.budget.runBalanceAfter !== null &&
      typeof report.budget.refund?.amount === "bigint"
    ) {
      report.budget.spentWei =
        config.maximumCostWei - report.budget.refund.amount - report.budget.runBalanceAfter;
      report.budget.spentNative = ethers.formatEther(report.budget.spentWei);
      if (CHAIN_PROFILE.id === "espace") {
        report.budget.spentCfx = report.budget.spentNative;
      }
    }
    if (!report.deploymentsDirectory.after) {
      try {
        report.deploymentsDirectory.after = await hashDirectory(ethers, DEPLOYMENTS_DIR);
        report.deploymentsDirectory.unchanged =
          deploymentsBefore.fileCount === report.deploymentsDirectory.after.fileCount &&
          deploymentsBefore.digest === report.deploymentsDirectory.after.digest;
      } catch (directoryError) {
        report.deploymentsDirectory.error = safeErrorMessage(directoryError);
      }
    }
    if (report.deploymentsDirectory.unchanged === false && !originalError) {
      originalError = new Error(`${DEPLOYMENTS_DIR} changed during isolated acceptance run`);
      report.status = "failed";
      report.failedStep = "deployment-directory-integrity";
      report.error = originalError.message;
    }
    report.finishedAt = nowIso();
    const releaseReadinessGates = {
      completedWithoutError: originalError === null && report.status === "passed",
      cleanReleaseCommit: report.productionParity.cleanReleaseCommit === true,
      sourceInputsUnchanged: report.sourceState.unchanged === true,
      explorerVerificationPassed:
        report.verification.enabled === true && report.verification.status === "passed",
      finalizedCoveragePassed:
        report.network.finality.required === true &&
        report.network.finality.status === "passed" &&
        report.productionParity.criticalTransactionsFinalized === true,
      canonicalSafeMatched:
        report.productionParity.canonicalSafeImplementationMatched === true &&
        report.productionParity.sameSafeManifestOnTestnetAndMainnet === true &&
        report.productionParity.mainnetCanonicalSafeInfrastructureMatched === true,
      productionDeploymentPathsMatched:
        report.productionParity.sameTimelockArtifactAndConfigResolver === true &&
        report.productionParity.sameProtocolDeploymentHelper === true &&
        report.productionParity.sameDeploymentMetadataWriter === true &&
        report.isolatedDeploymentArtifacts.productionWriterExercised === true,
      productionConfigurationMatched:
        config.productionMinDelay === config.minDelay &&
        report.productionParity.productionBuildProfileMatched === true &&
        report.productionParity.productionSafeProfileMatched === true &&
        report.productionParity.artifactManifestCaptured === true &&
        report.productionParity.productionCompilerSettingsMatched === true &&
        report.productionParity.productionTrustedSetupMatched === true &&
        report.productionParity.productionCeremonyVerified === true &&
        report.zkCeremonyVerification?.status === "passed" &&
        report.zkArtifactTrust.productionReady === true &&
        report.protocolManifestEvidence.releaseStatus === "production",
      onchainChecksPassed: report.onchain.status === "passed",
      terminalGovernanceStateMatched: report.terminalGovernanceState.status === "passed",
      deploymentDirectoryUnchanged: report.deploymentsDirectory.unchanged === true,
      allRecordedStepsPassed: report.steps.every((step) => step.status === "passed"),
      refundCompleted:
        report.budget.refund?.status === "passed" || report.budget.refund?.status === "not-needed",
    };
    report.releaseReadinessGates = releaseReadinessGates;
    report.releaseReady =
      config.acceptanceMode === "release-rehearsal" &&
      Object.values(releaseReadinessGates).every((passed) => passed === true);
    if (config.acceptanceMode === "release-rehearsal" && report.releaseReady) {
      await saveReport();
      try {
        await validateTestnetReleaseEvidence({
          reportPath,
          repositoryRoot: process.cwd(),
          expectedTestnetChainId: EXPECTED_CHAIN_ID,
          expectedTestnetNetworkName: EXPECTED_NETWORK,
          mainnetMinDelaySeconds: config.productionMinDelay,
          currentCommit: report.releaseCommit,
          expectedAcceptanceInputDigest: report.sourceState.acceptanceInputDigest,
        });
      } catch (validationError) {
        originalError = new Error(
          `release-rehearsal report failed schema-v4 self-validation: ` +
            safeErrorMessage(validationError, secretValues),
        );
        report.releaseReady = false;
        report.status = "failed";
        report.failedStep = "release-evidence-self-validation";
        report.error = originalError.message;
      }
    }
    if (
      config.acceptanceMode === "release-rehearsal" &&
      !report.releaseReady &&
      originalError === null
    ) {
      const failedGates = Object.entries(releaseReadinessGates)
        .filter(([, passed]) => passed !== true)
        .map(([name]) => name);
      originalError = new Error(
        `release-rehearsal did not satisfy release readiness gates: ${failedGates.join(", ")}`,
      );
      report.status = "failed";
      report.failedStep = "release-readiness";
      report.error = originalError.message;
    }
    await saveReport();
    if (
      config.acceptanceMode === "release-rehearsal" &&
      report.releaseReady &&
      originalError === null
    ) {
      try {
        publishedReleaseEvidence = await publishTestnetReleaseEvidence({
          sourceReportPath: reportPath,
          destinationRelativePath: CHAIN_PROFILE.mainnet.testnetReleaseReportRelativePath,
          repositoryRoot: process.cwd(),
          expectedTestnetChainId: EXPECTED_CHAIN_ID,
          expectedTestnetNetworkName: EXPECTED_NETWORK,
          mainnetMinDelaySeconds: config.productionMinDelay,
          currentCommit: report.releaseCommit,
          expectedAcceptanceInputDigest: report.sourceState.acceptanceInputDigest,
        });
      } catch (publicationError) {
        originalError = new Error(
          `release-rehearsal evidence publication failed: ` +
            safeErrorMessage(publicationError, secretValues),
        );
        report.releaseReadinessGates.completedWithoutError = false;
        report.releaseReady = false;
        report.status = "failed";
        report.failedStep = "release-evidence-publication";
        report.error = originalError.message;
        await saveReport();
      }
    }
    console.log(`[${CHAIN_PROFILE.id}-acceptance] report: ${reportPath}`);
    if (publishedReleaseEvidence) {
      console.log(
        `[${CHAIN_PROFILE.id}-acceptance] release evidence: ` +
          `${publishedReleaseEvidence.reportPath} ` +
          `(sha256 ${publishedReleaseEvidence.reportSha256})`,
      );
    }
  }

  if (originalError) {
    console.error(
      `[${CHAIN_PROFILE.id}-acceptance] FAILED at ${report.failedStep}: ${report.error}`,
    );
    throw new Error(report.error);
  }
  if (config.acceptanceMode === "release-rehearsal") {
    console.log(`[${CHAIN_PROFILE.id}-acceptance] RELEASE REHEARSAL PASSED run ${config.runId}`);
  } else {
    console.log(`[${CHAIN_PROFILE.id}-acceptance] DIAGNOSTIC PASSED run ${config.runId}`);
  }
};
