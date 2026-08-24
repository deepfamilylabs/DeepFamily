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
import {
  inspectProtocolDeploymentArtifacts,
  inspectProtocolReleaseManifest,
  protocolDeploymentEvidenceFromAcceptanceReport,
  protocolDeploymentEvidenceSha256,
} from "./protocolReleaseManifest.mjs";

export const TESTNET_RELEASE_REPORT_SCHEMA_VERSION = 5;
export const TESTNET_RELEASE_EVIDENCE_TYPE = "initial-mainnet-release";
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
  "deployment-directory-unchanged",
  "fund-isolated-run-deployer",
  "isolated-integrated-protocol-wiring",
  "production-build-manifest-preflight",
  "protocol-release-manifest-preflight",
  "real-zk-endorsement-nft-story",
  "release-rehearsal-clean-source-preflight",
  "source-verified-initial-deployment",
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
  "initial-deployment:AdultAgeGate",
  "initial-deployment:DeepFamily",
  "initial-deployment:DeepFamilyReader",
  "initial-deployment:DeepFamilyToken",
  "initial-deployment:DisclosureBindingVerifier",
  "initial-deployment:GovernanceTimelock",
  "initial-deployment:Groth16VerifierAdapter",
  "initial-deployment:MetadataArchiveV1",
  "initial-deployment:PersonCommitmentVerifier",
  "initial-deployment:PoseidonT5",
  "initial-deployment:UUPSProxy",
]);
const REQUIRED_VERIFICATION_PHASES = Object.freeze(["initial-deployment"]);
const FORBIDDEN_GOVERNANCE_LIFECYCLE_FIELDS = Object.freeze([
  "governance",
  "governanceLifecycle",
  "treasury",
  "upgrade",
]);
const FORBIDDEN_GOVERNANCE_LIFECYCLE_ADDRESSES = Object.freeze([
  "deepFamilyV2",
  "governedVerifierCandidate",
  "replacementGovernanceSafe",
  "replacementSafeOwners",
  "replacementTimelock",
]);
const FORBIDDEN_GOVERNANCE_LIFECYCLE_TRANSACTION_LABEL =
  /(?:^deploy-Groth16VerifierAdapter$|DeepFamilyV2Mock|GovernedVerifierCandidate|ReplacementGovernanceTimelock|schedule|execute|fee-update|verifier-update|treasury|upgrade|\bv2\b|migration|migrate|replacement|timelock-delay)/iu;

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

const requireExactRecordKeys = (value, label, expectedKeys) => {
  const record = requireRecord(value, label);
  const actualKeys = Object.keys(record).sort();
  const normalizedExpectedKeys = [...expectedKeys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(normalizedExpectedKeys)) {
    throw new Error(`${label} must contain exactly: ${normalizedExpectedKeys.join(", ")}`);
  }
  return record;
};

const rejectPresentFields = (value, label, forbiddenFields) => {
  const record = requireRecord(value, label);
  const present = forbiddenFields.filter((field) => Object.hasOwn(record, field));
  if (present.length > 0) {
    throw new Error(
      `${label} contains forbidden governance lifecycle fields: ${present.join(", ")}`,
    );
  }
  return record;
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

const requireSha256 = (value, label) => {
  if (typeof value !== "string" || !SHA_256_PATTERN.test(value)) {
    throw new Error(`${label} must be lowercase SHA-256 hex`);
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
      "releaseReadinessGates must contain exactly the schema v5 initial-release gate set: " +
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
  if (Object.hasOwn(verification, "gateBeforeUpgradeSchedule")) {
    throw new Error(
      "verification.gateBeforeUpgradeSchedule is forbidden in schema v5 initial-release evidence",
    );
  }
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
      "verification.contracts must contain exactly the schema v5 initial-release contract set",
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
    throw new Error(
      "verification.phases must contain exactly the schema v5 initial-release phase set",
    );
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
    if (FORBIDDEN_GOVERNANCE_LIFECYCLE_TRANSACTION_LABEL.test(label)) {
      throw new Error(
        `transactions.${label} is forbidden governance lifecycle content in initial-release evidence`,
      );
    }
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

const requireTerminalGovernanceEvidence = ({
  report,
  expectedChainId,
  expectedMinDelay,
  repositoryRoot,
  protocolManifest,
  protocolDeploymentArtifactInspector,
}) => {
  const terminal = requireExactRecordKeys(
    report.terminalGovernanceState,
    "terminalGovernanceState",
    [
      "archive",
      "deepFamily",
      "deploymentEvidenceSha256",
      "observedAfterFinality",
      "observedAtBlock",
      "proofRoutes",
      "reader",
      "safe",
      "status",
      "timelock",
      "token",
      "verifierAdapter",
    ],
  );
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
  const addresses = rejectPresentFields(
    report.addresses,
    "addresses",
    FORBIDDEN_GOVERNANCE_LIFECYCLE_ADDRESSES,
  );
  const governanceSafeAddress = requireAddress(
    addresses.governanceSafe,
    "addresses.governanceSafe",
  );
  const safeOwners = requireAddressArray(addresses.safeOwners, "addresses.safeOwners", 3);
  requireTerminalSafe({
    value: terminal.safe,
    label: "terminalGovernanceState.safe",
    expectedChainId,
    expectedAddress: governanceSafeAddress,
    expectedOwners: safeOwners,
  });

  const timelockAddress = requireAddress(addresses.timelock, "addresses.timelock");
  requireTerminalTimelock({
    value: terminal.timelock,
    label: "terminalGovernanceState.timelock",
    expectedAddress: timelockAddress,
    expectedMultisig: governanceSafeAddress,
    expectedMinDelay,
  });

  const deepFamilyAddress = requireAddress(addresses.deepFamily, "addresses.deepFamily");
  const deepFamilyImplementationAddress = requireAddress(
    addresses.deepFamilyImplementation,
    "addresses.deepFamilyImplementation",
  );
  const tokenAddress = requireAddress(addresses.token, "addresses.token");
  const verifierAdapterAddress = requireAddress(
    addresses.groth16VerifierAdapter,
    "addresses.groth16VerifierAdapter",
  );
  const personVerifierAddress = requireAddress(
    addresses.personCommitmentVerifier,
    "addresses.personCommitmentVerifier",
  );
  const disclosureBindingVerifierAddress = requireAddress(
    addresses.disclosureBindingVerifier,
    "addresses.disclosureBindingVerifier",
  );
  const metadataArchiveAddress = requireAddress(
    addresses.metadataArchive,
    "addresses.metadataArchive",
  );
  const deepFamily = requireExactRecordKeys(
    terminal.deepFamily,
    "terminalGovernanceState.deepFamily",
    [
      "address",
      "disclosureBindingVerifier",
      "implementation",
      "metadataArchive",
      "owner",
      "personCommitmentVerifier",
      "protocolEndorsementFeeBps",
    ],
  );
  requireSameAddress(
    deepFamily.address,
    deepFamilyAddress,
    "terminalGovernanceState.deepFamily.address",
  );
  requireSameAddress(deepFamily.owner, timelockAddress, "terminalGovernanceState.deepFamily.owner");
  requireSameAddress(
    deepFamily.implementation,
    deepFamilyImplementationAddress,
    "terminalGovernanceState.deepFamily.implementation",
  );
  requireSameAddress(
    deepFamily.personCommitmentVerifier,
    verifierAdapterAddress,
    "terminalGovernanceState.deepFamily.personCommitmentVerifier",
  );
  requireSameAddress(
    deepFamily.disclosureBindingVerifier,
    verifierAdapterAddress,
    "terminalGovernanceState.deepFamily.disclosureBindingVerifier",
  );
  requireSameAddress(
    deepFamily.metadataArchive,
    metadataArchiveAddress,
    "terminalGovernanceState.deepFamily.metadataArchive",
  );
  requireExact(
    requireSafeInteger(
      deepFamily.protocolEndorsementFeeBps,
      "terminalGovernanceState.deepFamily.protocolEndorsementFeeBps",
      0,
    ),
    500,
    "terminalGovernanceState.deepFamily.protocolEndorsementFeeBps",
  );

  const token = requireExactRecordKeys(terminal.token, "terminalGovernanceState.token", [
    "address",
    "deepFamilyContract",
    "deepFamilyTokenFromProtocol",
    "owner",
  ]);
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

  const verifierAdapter = requireExactRecordKeys(
    terminal.verifierAdapter,
    "terminalGovernanceState.verifierAdapter",
    ["address", "artifactSha256", "disclosureBindingVerifier", "personVerifier", "runtimeSha256"],
  );
  requireSameAddress(
    verifierAdapter.address,
    verifierAdapterAddress,
    "terminalGovernanceState.verifierAdapter.address",
  );
  requireSameAddress(
    verifierAdapter.personVerifier,
    personVerifierAddress,
    "terminalGovernanceState.verifierAdapter.personVerifier",
  );
  requireSameAddress(
    verifierAdapter.disclosureBindingVerifier,
    disclosureBindingVerifierAddress,
    "terminalGovernanceState.verifierAdapter.disclosureBindingVerifier",
  );

  const archive = requireExactRecordKeys(terminal.archive, "terminalGovernanceState.archive", [
    "address",
    "artifactSha256",
    "deepFamily",
    "runtimeSha256",
  ]);
  requireSameAddress(
    archive.address,
    metadataArchiveAddress,
    "terminalGovernanceState.archive.address",
  );
  requireSameAddress(
    archive.deepFamily,
    deepFamilyAddress,
    "terminalGovernanceState.archive.deepFamily",
  );

  const readerAddress = requireAddress(addresses.deepFamilyReader, "addresses.deepFamilyReader");
  const reader = requireExactRecordKeys(terminal.reader, "terminalGovernanceState.reader", [
    "address",
    "artifactSha256",
    "deepFamily",
    "metadataArchive",
    "runtimeSha256",
  ]);
  requireSameAddress(reader.address, readerAddress, "terminalGovernanceState.reader.address");
  requireSameAddress(
    reader.deepFamily,
    deepFamilyAddress,
    "terminalGovernanceState.reader.deepFamily",
  );
  requireSameAddress(
    reader.metadataArchive,
    metadataArchiveAddress,
    "terminalGovernanceState.reader.metadataArchive",
  );

  if (!Array.isArray(terminal.proofRoutes)) {
    throw new Error("terminalGovernanceState.proofRoutes must be an array");
  }
  const actualRoutes = terminal.proofRoutes
    .map((route, index) => {
      const item = requireExactRecordKeys(route, `terminalGovernanceState.proofRoutes[${index}]`, [
        "circuitId",
        "proofEncodingId",
        "purpose",
        "purposeOrdinal",
      ]);
      return {
        purpose: requireNonemptyString(
          item.purpose,
          `terminalGovernanceState.proofRoutes[${index}].purpose`,
          64,
        ),
        purposeOrdinal: requireSafeInteger(
          item.purposeOrdinal,
          `terminalGovernanceState.proofRoutes[${index}].purposeOrdinal`,
          0,
        ),
        circuitId: requireSafeInteger(
          item.circuitId,
          `terminalGovernanceState.proofRoutes[${index}].circuitId`,
          1,
        ),
        proofEncodingId: requireSafeInteger(
          item.proofEncodingId,
          `terminalGovernanceState.proofRoutes[${index}].proofEncodingId`,
          1,
        ),
      };
    })
    .sort(
      (left, right) =>
        left.purposeOrdinal - right.purposeOrdinal || left.circuitId - right.circuitId,
    );
  const expectedRoutes = requireRecord(protocolManifest, "current protocol manifest").proofRoutes;
  if (!Array.isArray(expectedRoutes)) {
    throw new Error("current protocol manifest proofRoutes must be an array");
  }
  const normalizedExpectedRoutes = expectedRoutes
    .map((route) => ({
      purpose: route?.purpose,
      purposeOrdinal: route?.purposeOrdinal,
      circuitId: route?.circuitId,
      proofEncodingId: route?.proofEncodingId,
    }))
    .sort(
      (left, right) =>
        left.purposeOrdinal - right.purposeOrdinal || left.circuitId - right.circuitId,
    );
  requireExact(
    JSON.stringify(actualRoutes),
    JSON.stringify(normalizedExpectedRoutes),
    "terminalGovernanceState.proofRoutes",
  );

  if (typeof protocolDeploymentArtifactInspector !== "function") {
    throw new Error("protocolDeploymentArtifactInspector must be a function");
  }
  const inspectedArtifacts = protocolDeploymentArtifactInspector({
    root: repositoryRoot,
    deployments: {
      groth16VerifierAdapter: {
        personVerifierImmutable: verifierAdapter.personVerifier,
        disclosureBindingVerifierImmutable: verifierAdapter.disclosureBindingVerifier,
      },
      metadataArchiveV1: { deepFamilyImmutable: archive.deepFamily },
      deepFamilyReader: {
        deepFamilyImmutable: reader.deepFamily,
        metadataArchiveImmutable: reader.metadataArchive,
      },
    },
  });
  const manifestDeployments = requireRecord(
    protocolManifest.deployments,
    "current protocol manifest deployments",
  );
  for (const [label, reported, inspected, manifestDeployment] of [
    [
      "Groth16VerifierAdapter",
      verifierAdapter,
      inspectedArtifacts?.groth16VerifierAdapter,
      manifestDeployments.groth16VerifierAdapter,
    ],
    [
      "MetadataArchiveV1",
      archive,
      inspectedArtifacts?.metadataArchiveV1,
      manifestDeployments.metadataArchiveV1,
    ],
    [
      "DeepFamilyReader",
      reader,
      inspectedArtifacts?.deepFamilyReader,
      manifestDeployments.deepFamilyReader,
    ],
  ]) {
    const reportedArtifactSha256 = requireSha256(
      reported.artifactSha256,
      `terminalGovernanceState ${label} artifactSha256`,
    );
    const reportedRuntimeSha256 = requireSha256(
      reported.runtimeSha256,
      `terminalGovernanceState ${label} runtimeSha256`,
    );
    requireExact(
      reportedArtifactSha256,
      requireSha256(inspected?.artifactSha256, `inspected ${label} artifactSha256`),
      `terminalGovernanceState ${label} artifactSha256`,
    );
    requireExact(
      reportedRuntimeSha256,
      requireSha256(inspected?.runtimeSha256, `inspected ${label} runtimeSha256`),
      `terminalGovernanceState ${label} runtimeSha256`,
    );
    requireExact(
      reportedArtifactSha256,
      requireSha256(
        manifestDeployment?.artifactSha256,
        `protocol manifest ${label} artifactSha256`,
      ),
      `terminalGovernanceState ${label} production artifactSha256`,
    );
  }

  const projection = protocolDeploymentEvidenceFromAcceptanceReport(report);
  const projectionSha256 = protocolDeploymentEvidenceSha256(projection);
  requireExact(
    requireSha256(
      terminal.deploymentEvidenceSha256,
      "terminalGovernanceState.deploymentEvidenceSha256",
    ),
    projectionSha256,
    "terminalGovernanceState.deploymentEvidenceSha256",
  );
  return {
    observedAtBlock,
    minDelay: expectedMinDelay,
    deploymentEvidenceSha256: projectionSha256,
  };
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
  if (Object.hasOwn(productionParity, "sharedGovernanceOperationBuildersMatched")) {
    throw new Error(
      "productionParity.sharedGovernanceOperationBuildersMatched is forbidden in schema v5 " +
        "initial-release evidence",
    );
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

const requireProtocolManifestEvidence = (report, repositoryRoot, protocolManifestInspector) => {
  const evidence = requireExactRecordKeys(
    report.protocolManifestEvidence,
    "protocolManifestEvidence",
    ["path", "sha256", "protocol", "protocolGeneration", "releaseStatus", "goldenVectorSha256"],
  );
  if (typeof protocolManifestInspector !== "function") {
    throw new Error("protocolManifestInspector must be a function");
  }
  const current = protocolManifestInspector({
    root: repositoryRoot,
    requireProduction: true,
  });
  requireExact(
    evidence.path,
    path.relative(repositoryRoot, current.manifestPath),
    "protocolManifestEvidence.path",
  );
  requireExact(evidence.sha256, current.manifestSha256, "protocolManifestEvidence.sha256");
  requireExact(evidence.protocol, current.manifest.protocol, "protocolManifestEvidence.protocol");
  requireExact(
    evidence.protocolGeneration,
    current.manifest.protocolGeneration,
    "protocolManifestEvidence.protocolGeneration",
  );
  requireExact(evidence.releaseStatus, "production", "protocolManifestEvidence.releaseStatus");
  requireExact(
    evidence.goldenVectorSha256,
    current.manifest.goldenVectors.sha256,
    "protocolManifestEvidence.goldenVectorSha256",
  );
  return { evidence, inspection: current };
};

/**
 * Loads one explicitly selected schema-v5 initial-mainnet-release rehearsal report and fails closed
 * unless it is valid evidence for the exact Git commit, testnet chain and production MIN_DELAY being
 * released. Governance lifecycle exercises are deliberately outside this evidence type.
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
  protocolManifestInspector = inspectProtocolReleaseManifest,
  protocolDeploymentArtifactInspector = inspectProtocolDeploymentArtifacts,
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
  requireExact(report.evidenceType, TESTNET_RELEASE_EVIDENCE_TYPE, "evidenceType");
  requireExact(report.governanceLifecycleIncluded, false, "governanceLifecycleIncluded");
  requireExact(report.mode, "acceptance", "mode");
  requireExact(report.acceptanceMode, "release-rehearsal", "acceptanceMode");
  requireExact(report.status, "passed", "status");
  requireExact(report.releaseReady, true, "releaseReady");
  requireExact(report.failedStep, null, "failedStep");
  requireExact(report.error, null, "error");
  requireExact(report.releaseCommit, expectedCommit, "releaseCommit");
  rejectPresentFields(
    report,
    "testnet release evidence root",
    FORBIDDEN_GOVERNANCE_LIFECYCLE_FIELDS,
  );

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
  const protocolManifest = requireProtocolManifestEvidence(
    report,
    repositoryRoot,
    protocolManifestInspector,
  );
  const zkArtifactTrust = requireProductionZkEvidence(report);
  const verification = requireVerificationEvidence(report);
  const finality = requireFinalityEvidence(report);
  const terminal = requireTerminalGovernanceEvidence({
    report,
    expectedChainId,
    expectedMinDelay,
    repositoryRoot,
    protocolManifest: protocolManifest.inspection.manifest,
    protocolDeploymentArtifactInspector,
  });
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
  const sortedStepNames = [...stepNames].sort();
  const expectedStepNames = [...TESTNET_RELEASE_REQUIRED_STEPS].sort();
  if (JSON.stringify(sortedStepNames) !== JSON.stringify(expectedStepNames)) {
    throw new Error(
      "steps must contain exactly the schema v5 initial-release step set: " +
        expectedStepNames.join(", "),
    );
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
    evidenceType: report.evidenceType,
    governanceLifecycleIncluded: report.governanceLifecycleIncluded,
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
    protocolManifest: {
      sha256: protocolManifest.evidence.sha256,
      protocol: protocolManifest.evidence.protocol,
      protocolGeneration: protocolManifest.evidence.protocolGeneration,
      goldenVectorSha256: protocolManifest.evidence.goldenVectorSha256,
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
      deploymentEvidenceSha256: terminal.deploymentEvidenceSha256,
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
