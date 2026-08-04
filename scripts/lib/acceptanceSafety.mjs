import { setTimeout as sleep } from "node:timers/promises";
import { ethers } from "ethers";

import { ESPACE_CHAIN_PROFILE, ETHEREUM_CHAIN_PROFILE } from "./chainProfiles.mjs";
import { MAINNET_MIN_DELAY_FLOOR_SECONDS } from "./mainnetReleaseSafety.mjs";

export const ESPACE_TESTNET_NAME = ESPACE_CHAIN_PROFILE.acceptance.networkName;
export const ESPACE_TESTNET_CHAIN_ID = ESPACE_CHAIN_PROFILE.acceptance.chainId;
export const ESPACE_E2E_CONFIRMATION = ESPACE_CHAIN_PROFILE.acceptance.confirmation;
export const ACCEPTANCE_MODE_DIAGNOSTIC = "diagnostic";
export const ACCEPTANCE_MODE_RELEASE_REHEARSAL = "release-rehearsal";
export const ESPACE_E2E_RELEASE_SAFE_PROFILE = ESPACE_CHAIN_PROFILE.governanceMultisigProfile;
export const ETHEREUM_TESTNET_NAME = ETHEREUM_CHAIN_PROFILE.acceptance.networkName;
export const ETHEREUM_TESTNET_CHAIN_ID = ETHEREUM_CHAIN_PROFILE.acceptance.chainId;
export const ETHEREUM_E2E_CONFIRMATION = ETHEREUM_CHAIN_PROFILE.acceptance.confirmation;
export const ETHEREUM_E2E_RELEASE_SAFE_PROFILE = ETHEREUM_CHAIN_PROFILE.governanceMultisigProfile;

const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;
const DECIMAL_NATIVE_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/;
const SECRET_KEY_PATTERN =
  /(?:private.?key|mnemonic|seed(?:phrase)?|signature(?:s)?|proof(?:data)?|passphrase|secret)/iu;

const parseInteger = (name, value, defaultValue, minimum) => {
  const raw = value === undefined || value === "" ? String(defaultValue) : String(value);
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`${name} must be a base-10 integer`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return parsed;
};

const parseBooleanFlag = (name, value, defaultValue) => {
  const raw = value === undefined || value === "" ? defaultValue : String(value);
  if (raw !== "0" && raw !== "1") {
    throw new Error(`${name} must be exactly 0 or 1`);
  }
  return raw === "1";
};

const parseAcceptanceMode = (name, value) => {
  const mode = value === undefined || value === "" ? ACCEPTANCE_MODE_DIAGNOSTIC : String(value);
  if (mode !== ACCEPTANCE_MODE_DIAGNOSTIC && mode !== ACCEPTANCE_MODE_RELEASE_REHEARSAL) {
    throw new Error(
      `${name} must be exactly ${ACCEPTANCE_MODE_DIAGNOSTIC} or ` +
        ACCEPTANCE_MODE_RELEASE_REHEARSAL,
    );
  }
  return mode;
};

const parseRequiredPositiveInteger = (name, value) => {
  const raw = String(value ?? "");
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`${name} must be explicitly set to a positive base-10 integer`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} exceeds the JavaScript safe-integer range`);
  }
  return parsed;
};

export const sanitizeRunId = (
  value,
  environmentName = ESPACE_CHAIN_PROFILE.acceptance.runIdEnvironmentName,
) => {
  const runId = String(value ?? "").trim();
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(
      `${environmentName} must be 8-80 characters using only letters, digits, '_' or '-', ` +
        "and must start with a letter or digit",
    );
  }
  return runId;
};

export const hashRunId = (runId, chainProfile = ESPACE_CHAIN_PROFILE) =>
  ethers.keccak256(
    ethers.toUtf8Bytes(
      `${chainProfile.acceptance.runIdDigestDomain}:` +
        sanitizeRunId(runId, chainProfile.acceptance.runIdEnvironmentName),
    ),
  );

export const runIdReportFileComponent = (runId, chainProfile = ESPACE_CHAIN_PROFILE) =>
  hashRunId(runId, chainProfile).slice(2, 34);

export const parseAcceptanceConfig = ({
  chainProfile = ESPACE_CHAIN_PROFILE,
  env = process.env,
  networkName,
  chainId,
} = {}) => {
  const acceptance = chainProfile.acceptance;
  if (networkName !== acceptance.networkName) {
    throw new Error(
      `${chainProfile.displayName} acceptance is restricted to network ` +
        `${acceptance.networkName}; got ${networkName || "unknown"}`,
    );
  }

  let normalizedChainId;
  try {
    normalizedChainId = BigInt(chainId);
  } catch {
    throw new Error(
      `${chainProfile.displayName} acceptance requires chainId ${acceptance.chainId}; got ` +
        String(chainId),
    );
  }
  if (normalizedChainId !== acceptance.chainId) {
    throw new Error(
      `${chainProfile.displayName} acceptance requires chainId ${acceptance.chainId}; got ` +
        normalizedChainId,
    );
  }

  if (env[acceptance.confirmationEnvironmentName] !== acceptance.confirmation) {
    throw new Error(
      `Set ${acceptance.confirmationEnvironmentName}=${acceptance.confirmation} ` +
        "to authorize testnet transactions",
    );
  }

  const acceptanceMode = parseAcceptanceMode(
    acceptance.modeEnvironmentName,
    env[acceptance.modeEnvironmentName],
  );
  const minDelaySeconds = parseInteger(
    acceptance.minDelayEnvironmentName,
    env[acceptance.minDelayEnvironmentName],
    30,
    10,
  );
  const confirmations = parseInteger(
    acceptance.confirmationsEnvironmentName,
    env[acceptance.confirmationsEnvironmentName],
    2,
    1,
  );
  if (confirmations > 100) {
    throw new Error(`${acceptance.confirmationsEnvironmentName} must not exceed 100`);
  }
  const verify = parseBooleanFlag(
    acceptance.verifyEnvironmentName,
    env[acceptance.verifyEnvironmentName],
    "1",
  );
  const recover = parseBooleanFlag(
    acceptance.recoverEnvironmentName,
    env[acceptance.recoverEnvironmentName],
    "0",
  );
  const requireFinality = parseBooleanFlag(
    acceptance.requireFinalityEnvironmentName,
    env[acceptance.requireFinalityEnvironmentName],
    "1",
  );
  let productionMinDelaySeconds = null;
  let productionGovernanceMultisigProfile = null;
  if (acceptanceMode === ACCEPTANCE_MODE_RELEASE_REHEARSAL) {
    if (!verify) {
      throw new Error(`release-rehearsal requires ${acceptance.verifyEnvironmentName}=1`);
    }
    if (!requireFinality) {
      throw new Error(`release-rehearsal requires ${acceptance.requireFinalityEnvironmentName}=1`);
    }
    productionMinDelaySeconds = parseRequiredPositiveInteger("MIN_DELAY", env.MIN_DELAY);
    if (productionMinDelaySeconds !== minDelaySeconds) {
      throw new Error(
        `release-rehearsal requires ${acceptance.minDelayEnvironmentName} ` +
          `(${minDelaySeconds}) to equal ` +
          `MIN_DELAY (${productionMinDelaySeconds})`,
      );
    }
    if (productionMinDelaySeconds < MAINNET_MIN_DELAY_FLOOR_SECONDS) {
      throw new Error(
        `release-rehearsal requires MIN_DELAY >= ` +
          `${MAINNET_MIN_DELAY_FLOOR_SECONDS} seconds to match the production minimum`,
      );
    }
    productionGovernanceMultisigProfile = String(env.GOVERNANCE_MULTISIG_PROFILE ?? "").trim();
    if (productionGovernanceMultisigProfile !== chainProfile.governanceMultisigProfile) {
      throw new Error(
        `release-rehearsal requires GOVERNANCE_MULTISIG_PROFILE=` +
          chainProfile.governanceMultisigProfile,
      );
    }
  }
  const finalityTimeoutSeconds = parseInteger(
    acceptance.finalityTimeoutEnvironmentName,
    env[acceptance.finalityTimeoutEnvironmentName],
    3600,
    60,
  );

  const configuredMaximumCost = String(env[acceptance.maximumCostEnvironmentName] ?? "").trim();
  const rawMaximumCost = configuredMaximumCost || acceptance.defaultMaximumCost;
  if (!DECIMAL_NATIVE_PATTERN.test(rawMaximumCost)) {
    throw new Error(
      `${acceptance.maximumCostEnvironmentName} must be a positive plain decimal with at most ` +
        "18 decimals",
    );
  }
  const maximumCostWei = ethers.parseEther(rawMaximumCost);
  if (maximumCostWei <= 0n) {
    throw new Error(`${acceptance.maximumCostEnvironmentName} must be greater than zero`);
  }
  const maximumCostCeilingWei = ethers.parseEther(acceptance.maximumCostCeiling);
  if (maximumCostWei > maximumCostCeilingWei) {
    throw new Error(
      `${acceptance.maximumCostEnvironmentName} must not exceed ` +
        `${acceptance.maximumCostCeiling} ${chainProfile.nativeSymbol} for ` +
        `${chainProfile.displayName} acceptance`,
    );
  }

  const configuredRunId = String(env[acceptance.runIdEnvironmentName] ?? "").trim();
  const runId =
    configuredRunId === "" ? null : sanitizeRunId(configuredRunId, acceptance.runIdEnvironmentName);
  if (recover && runId === null) {
    throw new Error(
      `${acceptance.recoverEnvironmentName}=1 requires ${acceptance.runIdEnvironmentName}`,
    );
  }

  return Object.freeze({
    chainProfileId: chainProfile.id,
    nativeSymbol: chainProfile.nativeSymbol,
    acceptanceMode,
    networkName,
    chainId: normalizedChainId,
    minDelaySeconds,
    confirmations,
    verify,
    recover,
    requireFinality,
    productionMinDelaySeconds,
    productionGovernanceMultisigProfile,
    finalityTimeoutSeconds,
    maximumCost: rawMaximumCost,
    maximumCostWei,
    runId,
    runIdHash: runId === null ? null : hashRunId(runId, chainProfile),
  });
};

export const parseESpaceAcceptanceConfig = (options = {}) =>
  parseAcceptanceConfig({ ...options, chainProfile: ESPACE_CHAIN_PROFILE });

export const parseEthereumAcceptanceConfig = (options = {}) =>
  parseAcceptanceConfig({ ...options, chainProfile: ETHEREUM_CHAIN_PROFILE });

/**
 * Summarizes the actual Hardhat build-info inputs used by the acceptance artifacts. This keeps the
 * report tied to compiler evidence instead of restating hardhat.config.mjs as an unchecked claim.
 */
export const summarizeProductionBuildInfo = (records) => {
  if (!Array.isArray(records)) {
    throw new Error("Build-info records must be an array");
  }
  const compilerJobs = records.map((record, index) => {
    const buildInfo = record?.buildInfo;
    const sourceNames = Object.keys(buildInfo?.input?.sources ?? {}).sort();
    const settings = buildInfo?.input?.settings;
    if (
      typeof record?.file !== "string" ||
      !ethers.isHexString(record?.digest, 32) ||
      typeof buildInfo?.solcVersion !== "string" ||
      typeof buildInfo?.solcLongVersion !== "string" ||
      !settings ||
      sourceNames.length === 0
    ) {
      throw new Error(`Malformed Hardhat build-info record at index ${index}`);
    }
    const poseidonOverride =
      sourceNames.length === 1 &&
      (sourceNames[0] === "npm/poseidon-solidity@0.0.5/PoseidonT5.sol" ||
        sourceNames[0].endsWith("/poseidon-solidity/PoseidonT5.sol"));
    const projectBuild = sourceNames.includes("project/contracts/DeepFamily.sol");
    const optimizer = {
      enabled: settings.optimizer?.enabled === true,
      runs: settings.optimizer?.runs,
    };
    const expectedSettingsMatched =
      buildInfo.solcVersion === "0.8.28" &&
      buildInfo.solcLongVersion === "0.8.28+commit.7893614a" &&
      optimizer.enabled === true &&
      optimizer.runs === 1 &&
      settings.evmVersion === "cancun" &&
      settings.viaIR === !poseidonOverride;
    return Object.freeze({
      file: record.file,
      digest: record.digest.toLowerCase(),
      solcVersion: buildInfo.solcVersion,
      solcLongVersion: buildInfo.solcLongVersion,
      optimizer,
      evmVersion: settings.evmVersion ?? null,
      viaIR: settings.viaIR === true,
      sourceCount: sourceNames.length,
      sourceSetDigest: ethers.keccak256(ethers.toUtf8Bytes(sourceNames.join("\n"))),
      projectBuild,
      poseidonOverride,
      expectedSettingsMatched,
    });
  });
  const hasProjectCompilerJob = compilerJobs.some((job) => job.projectBuild);
  const hasPoseidonOverrideCompilerJob = compilerJobs.some((job) => job.poseidonOverride);
  return Object.freeze({
    buildInfoFileCount: compilerJobs.length,
    compilerJobs: Object.freeze(compilerJobs),
    hasProjectCompilerJob,
    hasPoseidonOverrideCompilerJob,
    productionSettingsMatched:
      compilerJobs.length > 0 &&
      hasProjectCompilerJob &&
      hasPoseidonOverrideCompilerJob &&
      compilerJobs.every((job) => job.expectedSettingsMatched),
  });
};

const normalizeBasePrivateKey = (privateKey) => {
  const value = String(privateKey ?? "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("PRIVATE_KEY must contain 0x followed by exactly 64 hexadecimal characters");
  }
  // Wallet additionally rejects zero and out-of-range secp256k1 scalars.
  return new ethers.Wallet(value).privateKey;
};

const deriveScalar = (basePrivateKey, runId, label, chainProfile) => {
  const digest = ethers.keccak256(
    ethers.concat([
      ethers.getBytes(basePrivateKey),
      ethers.toUtf8Bytes(`${chainProfile.acceptance.walletDerivationDomain}:${runId}:${label}`),
    ]),
  );
  const scalar = (BigInt(digest) % (SECP256K1_ORDER - 1n)) + 1n;
  return ethers.zeroPadValue(ethers.toBeHex(scalar), 32);
};

export const deriveAcceptanceWallet = ({
  basePrivateKey,
  runId,
  label,
  provider = null,
  chainProfile = ESPACE_CHAIN_PROFILE,
}) => {
  const normalizedKey = normalizeBasePrivateKey(basePrivateKey);
  const normalizedRunId = sanitizeRunId(runId, chainProfile.acceptance.runIdEnvironmentName);
  if (!/^[a-z][a-z0-9-]{2,40}$/.test(String(label ?? ""))) {
    throw new Error("Acceptance wallet label is invalid");
  }
  return new ethers.Wallet(
    deriveScalar(normalizedKey, normalizedRunId, label, chainProfile),
    provider,
  );
};

export const deriveAcceptanceWallets = ({
  basePrivateKey,
  runId,
  provider = null,
  chainProfile = ESPACE_CHAIN_PROFILE,
}) => {
  const normalizedKey = normalizeBasePrivateKey(basePrivateKey);
  const normalizedRunId = sanitizeRunId(runId, chainProfile.acceptance.runIdEnvironmentName);
  const baseAddress = new ethers.Wallet(normalizedKey).address;
  const wallets = {
    runDeployer: deriveAcceptanceWallet({
      basePrivateKey: normalizedKey,
      runId: normalizedRunId,
      label: "run-deployer",
      provider,
      chainProfile,
    }),
    ownerA: deriveAcceptanceWallet({
      basePrivateKey: normalizedKey,
      runId: normalizedRunId,
      label: "multisig-owner-a",
      provider,
      chainProfile,
    }),
    ownerB: deriveAcceptanceWallet({
      basePrivateKey: normalizedKey,
      runId: normalizedRunId,
      label: "multisig-owner-b",
      provider,
      chainProfile,
    }),
    ownerC: deriveAcceptanceWallet({
      basePrivateKey: normalizedKey,
      runId: normalizedRunId,
      label: "multisig-owner-c",
      provider,
      chainProfile,
    }),
    ownerD: deriveAcceptanceWallet({
      basePrivateKey: normalizedKey,
      runId: normalizedRunId,
      label: "multisig-owner-d",
      provider,
      chainProfile,
    }),
    ownerE: deriveAcceptanceWallet({
      basePrivateKey: normalizedKey,
      runId: normalizedRunId,
      label: "multisig-owner-e",
      provider,
      chainProfile,
    }),
    ownerF: deriveAcceptanceWallet({
      basePrivateKey: normalizedKey,
      runId: normalizedRunId,
      label: "multisig-owner-f",
      provider,
      chainProfile,
    }),
  };
  const addresses = [baseAddress, ...Object.values(wallets).map((wallet) => wallet.address)];
  if (new Set(addresses.map((address) => address.toLowerCase())).size !== addresses.length) {
    throw new Error("Acceptance wallet derivation produced duplicate addresses");
  }
  return Object.freeze(wallets);
};

export const withTimeout = async (operation, { timeoutMs, description = "operation" } = {}) => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive integer");
  }
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${description} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
};

export const pollUntil = async (
  probe,
  { timeoutMs, intervalMs = 1_000, description = "condition", signal } = {},
) => {
  if (typeof probe !== "function") throw new Error("pollUntil probe must be a function");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive integer");
  }
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error("intervalMs must be a positive integer");
  }
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() <= deadline) {
    if (signal?.aborted) throw signal.reason ?? new Error(`${description} was aborted`);
    lastValue = await probe();
    if (lastValue) return lastValue;
    const remaining = deadline - Date.now();
    if (remaining > 0) await sleep(Math.min(intervalMs, remaining), undefined, { signal });
  }
  throw new Error(`${description} timed out after ${timeoutMs}ms`);
};

const redactString = (value, secrets) => {
  let redacted = value;
  for (const secret of secrets) {
    if (secret !== "") redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
};

export const redactSecrets = (value, { secretValues = [] } = {}) => {
  const secrets = secretValues
    .filter((secret) => typeof secret === "string" && secret !== "")
    .sort((a, b) => b.length - a.length);
  const seen = new WeakSet();
  const visit = (current, key = "") => {
    if (SECRET_KEY_PATTERN.test(key)) return "[REDACTED]";
    if (typeof current === "bigint") return current.toString();
    if (typeof current === "string") return redactString(current, secrets);
    if (current === null || typeof current !== "object") return current;
    if (seen.has(current)) return "[CIRCULAR]";
    seen.add(current);
    if (Array.isArray(current)) return current.map((item) => visit(item));
    return Object.fromEntries(
      Object.entries(current).map(([childKey, child]) => [childKey, visit(child, childKey)]),
    );
  };
  return visit(value);
};

export const safeJsonStringify = (value, { space = 2, secretValues = [] } = {}) =>
  JSON.stringify(redactSecrets(value, { secretValues }), null, space);
