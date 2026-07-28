import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { MAINNET_MIN_DELAY_FLOOR_SECONDS } from "./mainnetReleaseSafety.mjs";
import {
  MINIMUM_MULTI_PARTY_CONTRIBUTORS,
  MINIMUM_SINGLE_OPERATOR_CONTRIBUTORS,
  ZK_PRODUCTION_PHASE1,
  ZK_TRUST_MODEL_MULTI_PARTY,
  ZK_TRUST_MODEL_SINGLE_OPERATOR,
} from "./zkArtifactTrust.mjs";

export const TESTNET_RELEASE_REPORT_SCHEMA_VERSION = 3;
export const TESTNET_RELEASE_READINESS_GATES = Object.freeze([
  "allRecordedStepsPassed",
  "canonicalSafeMatched",
  "cleanReleaseCommit",
  "completedWithoutError",
  "deploymentDirectoryUnchanged",
  "explorerVerificationPassed",
  "finalizedCoveragePassed",
  "onchainChecksPassed",
  "productionConfigurationMatched",
  "productionDeploymentPathsMatched",
  "refundCompleted",
  "sourceInputsUnchanged",
  "terminalGovernanceStateMatched",
]);
export const TESTNET_RELEASE_REQUIRED_STEPS = Object.freeze([
  "acceptance-source-inputs-unchanged",
  "canonical-safe-1.3.0-two-of-three",
  "canonical-safe-mainnet-infrastructure",
  "canonical-safe-testnet-infrastructure",
  "critical-transactions-finalized",
  "delayed-deep-treasury-transfer",
  "deployment-directory-unchanged",
  "fund-isolated-run-deployer",
  "isolated-integrated-protocol-wiring",
  "production-build-manifest-preflight",
  "real-zk-endorsement-nft-story",
  "release-rehearsal-clean-source-preflight",
  "safe-delay-timelock-and-treasury-migrations",
  "safe-timelock-schedule-wait-execute-cancel",
  "source-verified-initial-deployment",
  "storage-safe-timelocked-uups-upgrade",
  "terminal-governance-state-verified",
  "zk-artifact-trust-preflight",
]);

const DEFAULT_MAX_REPORT_BYTES = 16 * 1024 * 1024;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const HASH_32_PATTERN = /^0x[0-9a-f]{64}$/u;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const ZERO_HASH = `0x${"0".repeat(64)}`;
const REQUIRED_VERIFIED_CONTRACTS = Object.freeze([
  "governance-replacements:ReplacementGovernanceTimelock",
  "initial-deployment:AdultAgeGate",
  "initial-deployment:DeepFamily",
  "initial-deployment:DeepFamilyReader",
  "initial-deployment:DeepFamilyToken",
  "initial-deployment:DisclosureBindingVerifier",
  "initial-deployment:GovernanceTimelock",
  "initial-deployment:GovernedVerifierCandidate",
  "initial-deployment:Groth16VerifierAdapter",
  "initial-deployment:PersonCommitmentVerifier",
  "initial-deployment:PoseidonT5",
  "initial-deployment:UUPSProxy",
  "upgrade-candidate:DeepFamilyV2Mock",
]);
const REQUIRED_VERIFICATION_PHASES = Object.freeze([
  "governance-replacements",
  "initial-deployment",
  "upgrade-candidate",
]);

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const requireRecord = (value, label) => {
  if (!isRecord(value)) throw new Error(`${label} must be a JSON object`);
  return value;
};

const requireExact = (actual, expected, label) => {
  if (actual !== expected) {
    throw new Error(`${label} must be ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`);
  }
};

const requireHash32 = (value, label) => {
  if (typeof value !== "string" || !HASH_32_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase 32-byte 0x-prefixed hash`);
  }
  return value;
};

const requireCommit = (value, label) => {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value)) {
    throw new Error(`${label} must be a full lowercase 40-character Git commit`);
  }
  return value;
};

const requireSafeInteger = (value, label, minimum = 0) => {
  let parsed;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`${label} exceeds the JavaScript safe-integer range`);
    }
    parsed = Number(value);
  } else if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)) {
    const asBigInt = BigInt(value);
    if (asBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`${label} exceeds the JavaScript safe-integer range`);
    }
    parsed = Number(asBigInt);
  } else {
    throw new Error(`${label} must be a canonical base-10 integer`);
  }
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${label} must be a safe integer >= ${minimum}`);
  }
  return parsed;
};

const requireNonemptyString = (value, label, maximumLength = 256) => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.length > maximumLength
  ) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
  return value;
};

const requireIsoTimestamp = (value, label) => {
  requireNonemptyString(value, label, 64);
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return value;
};

const requireAddress = (value, label, { allowZero = false } = {}) => {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    throw new Error(`${label} must be a 20-byte 0x-prefixed EVM address`);
  }
  const normalized = value.toLowerCase();
  if (!allowZero && normalized === ZERO_ADDRESS) {
    throw new Error(`${label} must not be the zero address`);
  }
  return normalized;
};

const requireSameAddress = (actual, expected, label) => {
  requireExact(
    requireAddress(actual, label, { allowZero: true }),
    requireAddress(expected, `${label} expected value`, { allowZero: true }),
    label,
  );
};

const requireAddressArray = (value, label, length) => {
  if (!Array.isArray(value) || value.length !== length) {
    throw new Error(`${label} must contain exactly ${length} addresses`);
  }
  const addresses = value.map((address, index) => requireAddress(address, `${label}[${index}]`));
  if (new Set(addresses).size !== addresses.length) {
    throw new Error(`${label} must contain distinct addresses`);
  }
  return addresses;
};

const pathIsWithin = (root, target) => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
};

const readExplicitRegularJsonFile = async ({
  reportPath,
  repositoryRoot,
  allowExternalArchive,
  maxReportBytes,
}) => {
  if (
    typeof reportPath !== "string" ||
    reportPath.length === 0 ||
    reportPath.trim() !== reportPath
  ) {
    throw new Error("reportPath must be supplied explicitly as a non-empty trimmed path");
  }
  if (typeof repositoryRoot !== "string" || repositoryRoot.trim() === "") {
    throw new Error("repositoryRoot must be a non-empty path");
  }
  if (typeof allowExternalArchive !== "boolean") {
    throw new Error("allowExternalArchive must be a boolean");
  }
  const sizeLimit = requireSafeInteger(maxReportBytes, "maxReportBytes", 1);
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const realRepositoryRoot = await fs.realpath(resolvedRepositoryRoot);
  if (realRepositoryRoot !== resolvedRepositoryRoot) {
    throw new Error("repositoryRoot must not traverse a symbolic link");
  }

  const resolvedReportPath = path.isAbsolute(reportPath)
    ? path.resolve(reportPath)
    : path.resolve(realRepositoryRoot, reportPath);
  if (path.extname(resolvedReportPath).toLowerCase() !== ".json") {
    throw new Error("testnet release evidence must be an explicit .json file");
  }

  let pathState;
  try {
    pathState = await fs.lstat(resolvedReportPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`testnet release evidence file does not exist: ${resolvedReportPath}`);
    }
    throw error;
  }
  if (pathState.isSymbolicLink()) {
    throw new Error("testnet release evidence path must not be a symbolic link");
  }
  if (!pathState.isFile()) {
    throw new Error("testnet release evidence path must be a regular file");
  }

  const realReportPath = await fs.realpath(resolvedReportPath);
  if (realReportPath !== resolvedReportPath) {
    throw new Error("testnet release evidence path must not traverse a symbolic link");
  }
  const insideRepository = pathIsWithin(realRepositoryRoot, realReportPath);
  if (!insideRepository && !allowExternalArchive) {
    throw new Error(
      "testnet release evidence must be inside repositoryRoot unless " +
        "allowExternalArchive=true is explicitly selected",
    );
  }

  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await fs.open(realReportPath, fsConstants.O_RDONLY | noFollow);
  let content;
  let fileState;
  try {
    fileState = await handle.stat();
    if (!fileState.isFile()) {
      throw new Error("testnet release evidence path must be a regular file");
    }
    if (fileState.size > sizeLimit) {
      throw new Error(
        `testnet release evidence exceeds maxReportBytes (${fileState.size} > ${sizeLimit})`,
      );
    }
    content = await handle.readFile();
  } finally {
    await handle.close();
  }
  const pathStateAfter = await fs.lstat(realReportPath);
  if (
    pathStateAfter.isSymbolicLink() ||
    !pathStateAfter.isFile() ||
    pathStateAfter.dev !== fileState.dev ||
    pathStateAfter.ino !== fileState.ino ||
    pathStateAfter.size !== fileState.size
  ) {
    throw new Error("testnet release evidence file changed while it was being read");
  }

  let report;
  try {
    report = JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error("testnet release evidence file must contain valid JSON");
  }
  requireRecord(report, "testnet release evidence root");
  const sha256 = createHash("sha256").update(content).digest("hex");
  if (!SHA_256_PATTERN.test(sha256)) {
    throw new Error("internal error while hashing testnet release evidence");
  }
  const relativePath = insideRepository
    ? path.relative(realRepositoryRoot, realReportPath).split(path.sep).join("/")
    : null;
  return {
    report,
    reportPath: realReportPath,
    insideRepository,
    repositoryRelativePath: relativePath,
    sizeBytes: content.byteLength,
    sha256,
  };
};

export const currentGitCommit = (repositoryRoot = process.cwd()) => {
  let commit;
  try {
    commit = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error("unable to determine the current Git commit for release evidence");
  }
  return requireCommit(commit, "current Git commit");
};

const requireAllReadinessGates = (value) => {
  const gates = requireRecord(value, "releaseReadinessGates");
  const names = Object.keys(gates).sort();
  if (JSON.stringify(names) !== JSON.stringify(TESTNET_RELEASE_READINESS_GATES)) {
    throw new Error(
      "releaseReadinessGates must contain exactly the schema v3 gate set: " +
        TESTNET_RELEASE_READINESS_GATES.join(", "),
    );
  }
  for (const name of names) requireExact(gates[name], true, `releaseReadinessGates.${name}`);
  return names;
};

const requireSourceEvidence = (report, expectedCommit) => {
  const source = requireRecord(report.sourceState, "sourceState");
  requireExact(source.commit, expectedCommit, "sourceState.commit");
  requireExact(source.clean, true, "sourceState.clean");
  requireExact(source.changedPathCount, 0, "sourceState.changedPathCount");
  requireExact(source.unchanged, true, "sourceState.unchanged");
  const inputDigest = requireHash32(
    source.acceptanceInputDigest,
    "sourceState.acceptanceInputDigest",
  );
  requireExact(
    requireRecord(source.acceptanceInputs, "sourceState.acceptanceInputs").digest,
    inputDigest,
    "sourceState.acceptanceInputs.digest",
  );

  const after = requireRecord(source.after, "sourceState.after");
  requireExact(after.commit, expectedCommit, "sourceState.after.commit");
  requireExact(after.clean, true, "sourceState.after.clean");
  requireExact(after.changedPathCount, 0, "sourceState.after.changedPathCount");
  requireExact(after.acceptanceInputDigest, inputDigest, "sourceState.after.acceptanceInputDigest");
  requireExact(
    requireRecord(after.acceptanceInputs, "sourceState.after.acceptanceInputs").digest,
    inputDigest,
    "sourceState.after.acceptanceInputs.digest",
  );
  return inputDigest;
};

const requireVerificationEvidence = (report) => {
  const verification = requireRecord(report.verification, "verification");
  requireExact(verification.enabled, true, "verification.enabled");
  requireExact(verification.status, "passed", "verification.status");
  requireExact(
    verification.gateBeforeUpgradeSchedule,
    true,
    "verification.gateBeforeUpgradeSchedule",
  );
  if (!Array.isArray(verification.contracts) || verification.contracts.length === 0) {
    throw new Error("verification.contracts must contain at least one verified contract");
  }
  const verifiedContracts = [];
  for (const [index, contract] of verification.contracts.entries()) {
    const item = requireRecord(contract, `verification.contracts[${index}]`);
    requireExact(item.status, "passed", `verification.contracts[${index}].status`);
    const phase = requireNonemptyString(item.phase, `verification.contracts[${index}].phase`, 80);
    const label = requireNonemptyString(item.label, `verification.contracts[${index}].label`, 100);
    requireAddress(item.address, `verification.contracts[${index}].address`);
    requireSafeInteger(item.attempts, `verification.contracts[${index}].attempts`, 1);
    verifiedContracts.push(`${phase}:${label}`);
  }
  const sortedVerifiedContracts = verifiedContracts.sort();
  if (
    new Set(sortedVerifiedContracts).size !== sortedVerifiedContracts.length ||
    JSON.stringify(sortedVerifiedContracts) !== JSON.stringify(REQUIRED_VERIFIED_CONTRACTS)
  ) {
    throw new Error(
      "verification.contracts must contain exactly the schema v3 release contract set",
    );
  }
  if (!Array.isArray(verification.phases) || verification.phases.length === 0) {
    throw new Error("verification.phases must contain at least one passed phase");
  }
  const verifiedPhases = [];
  for (const [index, phase] of verification.phases.entries()) {
    const item = requireRecord(phase, `verification.phases[${index}]`);
    requireExact(item.status, "passed", `verification.phases[${index}].status`);
    verifiedPhases.push(
      requireNonemptyString(item.phase, `verification.phases[${index}].phase`, 80),
    );
  }
  const sortedPhases = verifiedPhases.sort();
  if (
    new Set(sortedPhases).size !== sortedPhases.length ||
    JSON.stringify(sortedPhases) !== JSON.stringify(REQUIRED_VERIFICATION_PHASES)
  ) {
    throw new Error("verification.phases must contain exactly the schema v3 release phase set");
  }
  return verification;
};

const requireFinalityEvidence = (report) => {
  const network = requireRecord(report.network, "network");
  const finality = requireRecord(network.finality, "network.finality");
  requireExact(finality.required, true, "network.finality.required");
  requireExact(finality.status, "passed", "network.finality.status");
  const lastCriticalBlock = requireSafeInteger(
    finality.lastCriticalBlock,
    "network.finality.lastCriticalBlock",
    1,
  );
  const finalizedBlockNumber = requireSafeInteger(
    finality.finalizedBlockNumber,
    "network.finality.finalizedBlockNumber",
    lastCriticalBlock,
  );
  const finalizedBlockHash = requireHash32(
    finality.finalizedBlockHash,
    "network.finality.finalizedBlockHash",
  );
  const transactionCount = requireSafeInteger(
    finality.revalidatedTransactionCount,
    "network.finality.revalidatedTransactionCount",
    1,
  );
  const transactions = requireRecord(report.transactions, "transactions");
  const transactionEntries = Object.entries(transactions);
  if (transactionEntries.length === 0 || transactionEntries.length !== transactionCount) {
    throw new Error(
      "transactions must be non-empty and match network.finality.revalidatedTransactionCount",
    );
  }
  const recordedTransactions = new Map();
  let maximumTransactionBlock = 0;
  for (const [label, receipt] of transactionEntries) {
    requireNonemptyString(label, `transactions label ${label}`, 100);
    const item = requireRecord(receipt, `transactions.${label}`);
    const blockNumber = requireSafeInteger(
      item.blockNumber,
      `transactions.${label}.blockNumber`,
      1,
    );
    const recorded = {
      label,
      hash: requireHash32(item.hash, `transactions.${label}.hash`),
      blockNumber,
      blockHash: requireHash32(item.blockHash, `transactions.${label}.blockHash`),
      status: item.status,
    };
    requireExact(recorded.status, 1, `transactions.${label}.status`);
    if (blockNumber > finalizedBlockNumber) {
      throw new Error(`transactions.${label}.blockNumber is above the finalized block`);
    }
    maximumTransactionBlock = Math.max(maximumTransactionBlock, blockNumber);
    recordedTransactions.set(label, recorded);
  }
  requireExact(lastCriticalBlock, maximumTransactionBlock, "network.finality.lastCriticalBlock");
  if (
    !Array.isArray(finality.revalidatedTransactions) ||
    finality.revalidatedTransactions.length !== transactionCount
  ) {
    throw new Error(
      "network.finality.revalidatedTransactions must match revalidatedTransactionCount",
    );
  }
  const revalidatedLabels = new Set();
  for (const [index, transaction] of finality.revalidatedTransactions.entries()) {
    const item = requireRecord(transaction, `network.finality.revalidatedTransactions[${index}]`);
    const label = requireNonemptyString(
      item.label,
      `network.finality.revalidatedTransactions[${index}].label`,
      100,
    );
    if (revalidatedLabels.has(label)) {
      throw new Error(`network.finality.revalidatedTransactions contains duplicate ${label}`);
    }
    revalidatedLabels.add(label);
    const recorded = recordedTransactions.get(label);
    if (!recorded) {
      throw new Error(
        `network.finality.revalidatedTransactions[${index}] has unknown label ${label}`,
      );
    }
    requireExact(item.status, 1, `network.finality.revalidatedTransactions[${index}].status`);
    requireExact(
      requireHash32(item.hash, `network.finality.revalidatedTransactions[${index}].hash`),
      recorded.hash,
      `network.finality.revalidatedTransactions[${index}].hash`,
    );
    requireExact(
      requireSafeInteger(
        item.blockNumber,
        `network.finality.revalidatedTransactions[${index}].blockNumber`,
        1,
      ),
      recorded.blockNumber,
      `network.finality.revalidatedTransactions[${index}].blockNumber`,
    );
    requireExact(
      requireHash32(item.blockHash, `network.finality.revalidatedTransactions[${index}].blockHash`),
      recorded.blockHash,
      `network.finality.revalidatedTransactions[${index}].blockHash`,
    );
  }
  if (revalidatedLabels.size !== recordedTransactions.size) {
    throw new Error("network.finality.revalidatedTransactions does not cover every transaction");
  }
  return { lastCriticalBlock, finalizedBlockNumber, finalizedBlockHash, transactionCount };
};

const requireTerminalSafe = ({
  value,
  label,
  expectedChainId,
  expectedAddress,
  expectedOwners,
}) => {
  const safe = requireRecord(value, label);
  requireExact(
    requireSafeInteger(safe.chainId, `${label}.chainId`, 1),
    expectedChainId,
    `${label}.chainId`,
  );
  requireSameAddress(safe.safeAddress, expectedAddress, `${label}.safeAddress`);
  requireExact(safe.safeVersion, "1.3.0", `${label}.safeVersion`);
  requireAddress(safe.singleton, `${label}.singleton`);
  const owners = requireAddressArray(safe.owners, `${label}.owners`, 3);
  if (JSON.stringify(owners) !== JSON.stringify(expectedOwners)) {
    throw new Error(`${label}.owners do not match the report owner set`);
  }
  requireExact(safe.threshold, 2, `${label}.threshold`);
  requireSafeInteger(safe.nonce, `${label}.nonce`, 1);
  if (!Array.isArray(safe.modules) || safe.modules.length !== 0) {
    throw new Error(`${label}.modules must be empty`);
  }
  requireSameAddress(safe.guard, ZERO_ADDRESS, `${label}.guard`);
  requireAddress(safe.fallbackHandler, `${label}.fallbackHandler`);
  requireHash32(safe.proxyCodeHash, `${label}.proxyCodeHash`);
  requireExact(
    requireHash32(safe.canonicalProxyCodeHash, `${label}.canonicalProxyCodeHash`),
    safe.proxyCodeHash,
    `${label}.canonicalProxyCodeHash`,
  );
  const componentCodeHashes = requireRecord(
    safe.componentCodeHashes,
    `${label}.componentCodeHashes`,
  );
  for (const component of ["singleton", "proxyFactory", "fallbackHandler"]) {
    requireHash32(componentCodeHashes[component], `${label}.componentCodeHashes.${component}`);
  }
  return safe;
};

const requireTerminalTimelock = ({
  value,
  label,
  expectedAddress,
  expectedMultisig,
  expectedMinDelay,
}) => {
  const timelock = requireRecord(value, label);
  requireSameAddress(timelock.address, expectedAddress, `${label}.address`);
  requireExact(
    requireHash32(timelock.adminRole, `${label}.adminRole`),
    ZERO_HASH,
    `${label}.adminRole`,
  );
  requireSameAddress(timelock.admin, expectedAddress, `${label}.admin`);
  requireSameAddress(timelock.currentMultisig, expectedMultisig, `${label}.currentMultisig`);
  const roles = requireRecord(timelock.roles, `${label}.roles`);
  for (const role of ["PROPOSER_ROLE", "CANCELLER_ROLE", "EXECUTOR_ROLE"]) {
    requireHash32(roles[role], `${label}.roles.${role}`);
  }
  requireExact(
    requireSafeInteger(timelock.minDelay, `${label}.minDelay`, MAINNET_MIN_DELAY_FLOOR_SECONDS),
    expectedMinDelay,
    `${label}.minDelay`,
  );
  return timelock;
};

const requireTerminalGovernanceEvidence = (report, expectedChainId, expectedMinDelay) => {
  const terminal = requireRecord(report.terminalGovernanceState, "terminalGovernanceState");
  requireExact(terminal.status, "passed", "terminalGovernanceState.status");
  requireExact(
    terminal.observedAfterFinality,
    true,
    "terminalGovernanceState.observedAfterFinality",
  );
  const observedAtBlock = requireSafeInteger(
    terminal.observedAtBlock,
    "terminalGovernanceState.observedAtBlock",
    1,
  );
  const addresses = requireRecord(report.addresses, "addresses");
  const primarySafeAddress = requireAddress(addresses.governanceSafe, "addresses.governanceSafe");
  const replacementSafeAddress = requireAddress(
    addresses.replacementGovernanceSafe,
    "addresses.replacementGovernanceSafe",
  );
  const primaryOwners = requireAddressArray(addresses.safeOwners, "addresses.safeOwners", 3);
  const replacementOwners = requireAddressArray(
    addresses.replacementSafeOwners,
    "addresses.replacementSafeOwners",
    3,
  );
  const safes = requireRecord(terminal.safes, "terminalGovernanceState.safes");
  requireTerminalSafe({
    value: safes.primary,
    label: "terminalGovernanceState.safes.primary",
    expectedChainId,
    expectedAddress: primarySafeAddress,
    expectedOwners: primaryOwners,
  });
  requireTerminalSafe({
    value: safes.replacement,
    label: "terminalGovernanceState.safes.replacement",
    expectedChainId,
    expectedAddress: replacementSafeAddress,
    expectedOwners: replacementOwners,
  });

  const primaryTimelockAddress = requireAddress(addresses.timelock, "addresses.timelock");
  const replacementTimelockAddress = requireAddress(
    addresses.replacementTimelock,
    "addresses.replacementTimelock",
  );
  const timelocks = requireRecord(terminal.timelocks, "terminalGovernanceState.timelocks");
  requireTerminalTimelock({
    value: timelocks.retired,
    label: "terminalGovernanceState.timelocks.retired",
    expectedAddress: primaryTimelockAddress,
    expectedMultisig: replacementSafeAddress,
    expectedMinDelay: expectedMinDelay + 1,
  });
  requireTerminalTimelock({
    value: timelocks.replacement,
    label: "terminalGovernanceState.timelocks.replacement",
    expectedAddress: replacementTimelockAddress,
    expectedMultisig: replacementSafeAddress,
    expectedMinDelay,
  });

  const deepFamilyAddress = requireAddress(addresses.deepFamily, "addresses.deepFamily");
  const deepFamilyV2Address = requireAddress(addresses.deepFamilyV2, "addresses.deepFamilyV2");
  const tokenAddress = requireAddress(addresses.token, "addresses.token");
  const governedVerifierAddress = requireAddress(
    addresses.governedVerifierCandidate,
    "addresses.governedVerifierCandidate",
  );
  const disclosureAdapterAddress = requireAddress(
    addresses.groth16VerifierAdapter,
    "addresses.groth16VerifierAdapter",
  );
  const deepFamily = requireRecord(terminal.deepFamily, "terminalGovernanceState.deepFamily");
  requireSameAddress(
    deepFamily.address,
    deepFamilyAddress,
    "terminalGovernanceState.deepFamily.address",
  );
  requireSameAddress(
    deepFamily.owner,
    replacementTimelockAddress,
    "terminalGovernanceState.deepFamily.owner",
  );
  requireSameAddress(
    deepFamily.implementation,
    deepFamilyV2Address,
    "terminalGovernanceState.deepFamily.implementation",
  );
  requireSameAddress(
    deepFamily.personCommitmentVerifier,
    governedVerifierAddress,
    "terminalGovernanceState.deepFamily.personCommitmentVerifier",
  );
  requireSameAddress(
    deepFamily.disclosureBindingVerifier,
    disclosureAdapterAddress,
    "terminalGovernanceState.deepFamily.disclosureBindingVerifier",
  );
  requireSafeInteger(
    deepFamily.protocolEndorsementFeeBps,
    "terminalGovernanceState.deepFamily.protocolEndorsementFeeBps",
    0,
  );

  const token = requireRecord(terminal.token, "terminalGovernanceState.token");
  requireSameAddress(token.address, tokenAddress, "terminalGovernanceState.token.address");
  requireSameAddress(token.owner, ZERO_ADDRESS, "terminalGovernanceState.token.owner");
  requireSameAddress(
    token.deepFamilyContract,
    deepFamilyAddress,
    "terminalGovernanceState.token.deepFamilyContract",
  );
  requireSameAddress(
    token.deepFamilyTokenFromProtocol,
    tokenAddress,
    "terminalGovernanceState.token.deepFamilyTokenFromProtocol",
  );
  requireExact(
    terminal.retiredTimelockTreasuryBalance,
    "0",
    "terminalGovernanceState.retiredTimelockTreasuryBalance",
  );
  return { observedAtBlock, replacementDelay: expectedMinDelay };
};

const requireRefundEvidence = (report) => {
  const refund = requireRecord(requireRecord(report.budget, "budget").refund, "budget.refund");
  if (refund.status === "not-needed") {
    for (const field of ["balanceBefore", "amount", "balanceAfter"]) {
      requireExact(
        requireSafeInteger(refund[field], `budget.refund.${field}`, 0),
        0,
        `budget.refund.${field}`,
      );
    }
    if (refund.transaction !== undefined) {
      throw new Error("budget.refund.transaction must be absent when refund is not-needed");
    }
    return { status: "not-needed", transactionHash: null };
  }
  requireExact(refund.status, "passed", "budget.refund.status");
  const transaction = requireRecord(refund.transaction, "budget.refund.transaction");
  requireExact(transaction.status, 1, "budget.refund.transaction.status");
  const transactionHash = requireHash32(transaction.hash, "budget.refund.transaction.hash");
  return { status: "passed", transactionHash };
};

const requireProductionParityEvidence = (report) => {
  const productionParity = requireRecord(report.productionParity, "productionParity");
  const requiredParityFacts = [
    "canonicalSafeImplementationMatched",
    "sameSafeManifestOnTestnetAndMainnet",
    "mainnetCanonicalSafeInfrastructureMatched",
    "sameTimelockArtifactAndConfigResolver",
    "sameProtocolDeploymentHelper",
    "sameDeploymentMetadataWriter",
    "sharedGovernanceOperationBuildersMatched",
    "criticalTransactionsFinalized",
    "cleanReleaseCommit",
    "productionBuildProfileMatched",
    "productionSafeProfileMatched",
    "artifactManifestCaptured",
    "productionCompilerSettingsMatched",
    "productionTrustedSetupMatched",
  ];
  for (const name of requiredParityFacts) {
    requireExact(productionParity[name], true, `productionParity.${name}`);
  }

  const buildState = requireRecord(report.buildState, "buildState");
  requireExact(buildState.hardhatBuildProfile, "production", "buildState.hardhatBuildProfile");
  requireSafeInteger(buildState.artifactsFileCount, "buildState.artifactsFileCount", 1);
  requireSafeInteger(buildState.buildInfoFileCount, "buildState.buildInfoFileCount", 1);
  requireExact(buildState.productionSettingsMatched, true, "buildState.productionSettingsMatched");
  requireExact(
    requireRecord(report.isolatedDeploymentArtifacts, "isolatedDeploymentArtifacts")
      .productionWriterExercised,
    true,
    "isolatedDeploymentArtifacts.productionWriterExercised",
  );
  return productionParity;
};

const requireProductionZkEvidence = (report) => {
  const zkArtifactTrust = requireRecord(report.zkArtifactTrust, "zkArtifactTrust");
  requireExact(zkArtifactTrust.status, "passed", "zkArtifactTrust.status");
  requireExact(
    zkArtifactTrust.trustedSetupStatus,
    "production",
    "zkArtifactTrust.trustedSetupStatus",
  );
  requireExact(zkArtifactTrust.productionReady, true, "zkArtifactTrust.productionReady");
  requireExact(
    zkArtifactTrust.phase1Source,
    ZK_PRODUCTION_PHASE1.source,
    "zkArtifactTrust.phase1Source",
  );
  requireExact(
    requireSafeInteger(zkArtifactTrust.phase1Bytes, "zkArtifactTrust.phase1Bytes", 1),
    ZK_PRODUCTION_PHASE1.bytes,
    "zkArtifactTrust.phase1Bytes",
  );
  requireExact(
    zkArtifactTrust.phase1Sha256,
    ZK_PRODUCTION_PHASE1.sha256,
    "zkArtifactTrust.phase1Sha256",
  );
  requireExact(
    zkArtifactTrust.phase1Blake2b512,
    ZK_PRODUCTION_PHASE1.blake2b512,
    "zkArtifactTrust.phase1Blake2b512",
  );
  const trustModel = requireNonemptyString(
    zkArtifactTrust.trustModel,
    "zkArtifactTrust.trustModel",
    40,
  );
  const minimumContributors = requireSafeInteger(
    zkArtifactTrust.minimumContributors,
    "zkArtifactTrust.minimumContributors",
    1,
  );
  const contributorCount = requireSafeInteger(
    zkArtifactTrust.contributorCount,
    "zkArtifactTrust.contributorCount",
    1,
  );
  if (trustModel === ZK_TRUST_MODEL_SINGLE_OPERATOR) {
    requireExact(
      minimumContributors,
      MINIMUM_SINGLE_OPERATOR_CONTRIBUTORS,
      "zkArtifactTrust.minimumContributors",
    );
    requireExact(
      contributorCount,
      MINIMUM_SINGLE_OPERATOR_CONTRIBUTORS,
      "zkArtifactTrust.contributorCount",
    );
  } else if (trustModel === ZK_TRUST_MODEL_MULTI_PARTY) {
    if (
      minimumContributors < MINIMUM_MULTI_PARTY_CONTRIBUTORS ||
      contributorCount < minimumContributors
    ) {
      throw new Error(
        "zkArtifactTrust multi-party contributor counts do not meet the declared threshold",
      );
    }
  } else {
    throw new Error("zkArtifactTrust.trustModel is unsupported");
  }
  requireExact(
    requireRecord(report.productionParity, "productionParity").productionTrustedSetupMatched,
    true,
    "productionParity.productionTrustedSetupMatched",
  );
  requireExact(
    requireRecord(report.productionParity, "productionParity").productionCeremonyVerified,
    true,
    "productionParity.productionCeremonyVerified",
  );
  const ceremony = requireRecord(report.zkCeremonyVerification, "zkCeremonyVerification");
  requireExact(ceremony.status, "passed", "zkCeremonyVerification.status");
  requireExact(
    ceremony.ceremonyId,
    zkArtifactTrust.ceremonyId,
    "zkCeremonyVerification.ceremonyId",
  );
  requireExact(
    ceremony.manifestSha256,
    zkArtifactTrust.manifestSha256,
    "zkCeremonyVerification.manifestSha256",
  );
  requireExact(
    ceremony.transcriptSha256,
    zkArtifactTrust.transcriptSha256,
    "zkCeremonyVerification.transcriptSha256",
  );
  requireExact(ceremony.trustModel, trustModel, "zkCeremonyVerification.trustModel");
  requireExact(
    requireSafeInteger(
      ceremony.minimumContributors,
      "zkCeremonyVerification.minimumContributors",
      1,
    ),
    minimumContributors,
    "zkCeremonyVerification.minimumContributors",
  );
  requireExact(
    requireSafeInteger(ceremony.contributorCount, "zkCeremonyVerification.contributorCount", 1),
    contributorCount,
    "zkCeremonyVerification.contributorCount",
  );
  requireExact(
    requireRecord(ceremony.ptau, "zkCeremonyVerification.ptau").sha256,
    zkArtifactTrust.phase1Sha256,
    "zkCeremonyVerification.ptau.sha256",
  );
  requireExact(
    ceremony.ptau.blake2b512,
    zkArtifactTrust.phase1Blake2b512,
    "zkCeremonyVerification.ptau.blake2b512",
  );
  requireExact(
    requireSafeInteger(ceremony.ptau.bytes, "zkCeremonyVerification.ptau.bytes", 1),
    requireSafeInteger(zkArtifactTrust.phase1Bytes, "zkArtifactTrust.phase1Bytes", 1),
    "zkCeremonyVerification.ptau.bytes",
  );
  return zkArtifactTrust;
};

/**
 * Loads one explicitly selected schema-v3 release-rehearsal report and fails closed unless it is
 * valid evidence for the exact Git commit, testnet chain and production MIN_DELAY being released.
 *
 * External archived reports are rejected by default. Set allowExternalArchive=true only for a
 * directly selected regular JSON file; symlinks (including symlinked path components) remain
 * forbidden.
 */
export const validateTestnetReleaseEvidence = async ({
  reportPath,
  repositoryRoot = process.cwd(),
  allowExternalArchive = false,
  maxReportBytes = DEFAULT_MAX_REPORT_BYTES,
  expectedTestnetChainId,
  expectedTestnetNetworkName,
  mainnetMinDelaySeconds,
  currentCommit,
  expectedAcceptanceInputDigest,
} = {}) => {
  const expectedChainId = requireSafeInteger(expectedTestnetChainId, "expectedTestnetChainId", 1);
  const expectedMinDelay = requireSafeInteger(
    mainnetMinDelaySeconds,
    "mainnetMinDelaySeconds",
    MAINNET_MIN_DELAY_FLOOR_SECONDS,
  );
  const expectedCommit =
    currentCommit === undefined
      ? currentGitCommit(repositoryRoot)
      : requireCommit(String(currentCommit), "currentCommit");
  const file = await readExplicitRegularJsonFile({
    reportPath,
    repositoryRoot,
    allowExternalArchive,
    maxReportBytes,
  });
  const { report } = file;

  requireExact(report.schemaVersion, TESTNET_RELEASE_REPORT_SCHEMA_VERSION, "schemaVersion");
  requireExact(report.mode, "acceptance", "mode");
  requireExact(report.acceptanceMode, "release-rehearsal", "acceptanceMode");
  requireExact(report.status, "passed", "status");
  requireExact(report.releaseReady, true, "releaseReady");
  requireExact(report.failedStep, null, "failedStep");
  requireExact(report.error, null, "error");
  requireExact(report.releaseCommit, expectedCommit, "releaseCommit");

  const network = requireRecord(report.network, "network");
  const networkName = requireNonemptyString(network.name, "network.name", 100);
  if (expectedTestnetNetworkName !== undefined) {
    requireExact(
      networkName,
      requireNonemptyString(expectedTestnetNetworkName, "expectedTestnetNetworkName", 100),
      "network.name",
    );
  }
  const reportChainId = requireSafeInteger(network.chainId, "network.chainId", 1);
  requireExact(reportChainId, expectedChainId, "network.chainId");

  const sourceInputDigest = requireSourceEvidence(report, expectedCommit);
  const currentInputDigest =
    expectedAcceptanceInputDigest === undefined
      ? sourceInputDigest
      : requireHash32(expectedAcceptanceInputDigest, "expectedAcceptanceInputDigest");
  requireExact(sourceInputDigest, currentInputDigest, "sourceState.acceptanceInputDigest");
  const timelockDeployment = requireRecord(report.timelockDeployment, "timelockDeployment");
  const reportMinDelay = requireSafeInteger(
    timelockDeployment.minDelaySeconds,
    "timelockDeployment.minDelaySeconds",
    MAINNET_MIN_DELAY_FLOOR_SECONDS,
  );
  requireExact(reportMinDelay, expectedMinDelay, "timelockDeployment.minDelaySeconds");

  requireProductionParityEvidence(report);
  const zkArtifactTrust = requireProductionZkEvidence(report);
  const verification = requireVerificationEvidence(report);
  const finality = requireFinalityEvidence(report);
  const terminal = requireTerminalGovernanceEvidence(report, expectedChainId, expectedMinDelay);
  if (terminal.observedAtBlock < finality.finalizedBlockNumber) {
    throw new Error(
      "terminalGovernanceState.observedAtBlock must be at or after the finalized coverage block",
    );
  }
  const refund = requireRefundEvidence(report);

  requireExact(requireRecord(report.onchain, "onchain").status, "passed", "onchain.status");
  requireExact(
    requireRecord(report.deploymentsDirectory, "deploymentsDirectory").unchanged,
    true,
    "deploymentsDirectory.unchanged",
  );
  if (!Array.isArray(report.steps) || report.steps.length === 0) {
    throw new Error("steps must contain at least one passed acceptance step");
  }
  const stepNames = [];
  for (const [index, step] of report.steps.entries()) {
    const item = requireRecord(step, `steps[${index}]`);
    requireExact(item.status, "passed", `steps[${index}].status`);
    stepNames.push(requireNonemptyString(item.name, `steps[${index}].name`, 120));
  }
  if (new Set(stepNames).size !== stepNames.length) {
    throw new Error("steps must not contain duplicate names");
  }
  const missingSteps = TESTNET_RELEASE_REQUIRED_STEPS.filter((name) => !stepNames.includes(name));
  if (missingSteps.length > 0) {
    throw new Error(`steps is missing required schema v3 steps: ${missingSteps.join(", ")}`);
  }
  const readinessGates = requireAllReadinessGates(report.releaseReadinessGates);

  const startedAt = requireIsoTimestamp(report.startedAt, "startedAt");
  const finishedAt = requireIsoTimestamp(report.finishedAt, "finishedAt");
  if (Date.parse(finishedAt) < Date.parse(startedAt)) {
    throw new Error("finishedAt must not be earlier than startedAt");
  }
  const runId = requireNonemptyString(report.runId, "runId", 128);

  const publicSummary = deepFreeze({
    evidenceFile: {
      fileName: path.basename(file.reportPath),
      location: file.insideRepository ? "repository" : "external-archive",
      repositoryRelativePath: file.repositoryRelativePath,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
    },
    schemaVersion: report.schemaVersion,
    mode: report.mode,
    acceptanceMode: report.acceptanceMode,
    status: report.status,
    releaseReady: report.releaseReady,
    runId,
    startedAt,
    finishedAt,
    releaseCommit: expectedCommit,
    sourceInputDigest,
    network: {
      name: networkName,
      chainId: String(reportChainId),
      confirmations: requireSafeInteger(network.confirmations, "network.confirmations", 1),
    },
    minDelaySeconds: reportMinDelay,
    readinessGateCount: readinessGates.length,
    passedStepCount: report.steps.length,
    zkArtifacts: {
      status: zkArtifactTrust.status,
      trustedSetupStatus: zkArtifactTrust.trustedSetupStatus,
      trustModel: zkArtifactTrust.trustModel,
      contributorCount: zkArtifactTrust.contributorCount,
      minimumContributors: zkArtifactTrust.minimumContributors,
      productionReady: zkArtifactTrust.productionReady,
    },
    verification: {
      status: verification.status,
      verifiedContractCount: verification.contracts.length,
      phaseCount: verification.phases.length,
    },
    finality: {
      status: "passed",
      finalizedBlockNumber: finality.finalizedBlockNumber,
      finalizedBlockHash: finality.finalizedBlockHash,
      revalidatedTransactionCount: finality.transactionCount,
    },
    terminalGovernance: {
      status: "passed",
      observedAtBlock: terminal.observedAtBlock,
    },
    refund: {
      status: refund.status,
      transactionHash: refund.transactionHash,
    },
  });

  return deepFreeze({
    reportPath: file.reportPath,
    reportSha256: file.sha256,
    publicSummary,
  });
};
