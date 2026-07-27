/**
 * Shared guarded EVM mainnet release configuration and authorization helpers.
 */
import { ethers } from "ethers";

import { ESPACE_CHAIN_PROFILE, ETHEREUM_CHAIN_PROFILE } from "./chainProfiles.mjs";

export const ESPACE_MAINNET_NETWORK = ESPACE_CHAIN_PROFILE.mainnet.networkName;
export const ESPACE_MAINNET_CHAIN_ID = ESPACE_CHAIN_PROFILE.mainnet.chainId;
export const ESPACE_MAINNET_CONFIRMATION = ESPACE_CHAIN_PROFILE.mainnet.confirmation;
export const ETHEREUM_MAINNET_NETWORK = ETHEREUM_CHAIN_PROFILE.mainnet.networkName;
export const ETHEREUM_MAINNET_CHAIN_ID = ETHEREUM_CHAIN_PROFILE.mainnet.chainId;
export const ETHEREUM_MAINNET_CONFIRMATION = ETHEREUM_CHAIN_PROFILE.mainnet.confirmation;
export const MAINNET_MIN_DELAY_FLOOR_SECONDS = 86_400;
export const MAINNET_STATE_SCHEMA_VERSION = 1;
export const MAINNET_TRANSACTION_LABELS = Object.freeze([
  "governanceTimelock",
  "deepFamilyToken",
  "poseidonT5",
  "adultAgeGate",
  "personCommitmentVerifier",
  "disclosureBindingVerifier",
  "groth16VerifierAdapter",
  "deepFamilyImplementation",
  "deepFamilyProxy",
  "deepFamilyReader",
  "tokenInitialize",
  "setPersonCommitmentVerifier",
  "setDisclosureBindingVerifier",
  "transferDeepFamilyOwnership",
]);

const DECIMAL_NATIVE_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/;
const TRANSACTION_LABEL_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,79}$/;

const parseInteger = (name, value, defaultValue, minimum, maximum) => {
  const raw = value === undefined || value === "" ? String(defaultValue) : String(value).trim();
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be a base-10 integer`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
};

const requiredAddress = (name, value) => {
  const raw = String(value ?? "").trim();
  if (!ethers.isAddress(raw) || raw === ethers.ZeroAddress) {
    throw new Error(`${name} must be an explicit nonzero EVM address`);
  }
  return ethers.getAddress(raw);
};

const parseExpectedSafeOwners = (
  value,
  environmentName = ESPACE_CHAIN_PROFILE.mainnet.safeOwnersEnvironmentName,
) => {
  const raw = String(value ?? "").trim();
  const owners = raw === "" ? [] : raw.split(",").map((item) => item.trim());
  if (owners.length !== 3) {
    throw new Error(`${environmentName} must contain exactly three comma-separated addresses`);
  }
  const normalized = owners.map((owner, index) =>
    requiredAddress(`${environmentName}[${index}]`, owner),
  );
  if (new Set(normalized.map((owner) => owner.toLowerCase())).size !== normalized.length) {
    throw new Error(`${environmentName} must contain three distinct addresses`);
  }
  return Object.freeze(normalized);
};

const parseRecoveryTransactions = (
  value,
  environmentName = ESPACE_CHAIN_PROFILE.mainnet.recoveryTransactionsEnvironmentName,
) => {
  const raw = String(value ?? "").trim();
  if (raw === "") return Object.freeze({});
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${environmentName} must be a JSON object of label-to-hash entries`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${environmentName} must be a JSON object of label-to-hash entries`);
  }
  const entries = Object.entries(parsed).map(([label, hash]) => {
    if (!TRANSACTION_LABEL_PATTERN.test(label)) {
      throw new Error(`${environmentName} contains an invalid label: ${label}`);
    }
    if (!ethers.isHexString(hash, 32)) {
      throw new Error(`${environmentName}.${label} must be a 32-byte transaction hash`);
    }
    if (!MAINNET_TRANSACTION_LABELS.includes(label)) {
      throw new Error(`${environmentName} contains an unknown release label: ${label}`);
    }
    return [label, hash.toLowerCase()];
  });
  return Object.freeze(Object.fromEntries(entries));
};

const parseSafeAcceptanceTransaction = (
  value,
  environmentName = ESPACE_CHAIN_PROFILE.mainnet.safeAcceptanceTransactionEnvironmentName,
) => {
  const raw = String(value ?? "").trim();
  if (!ethers.isHexString(raw, 32)) {
    throw new Error(
      `${environmentName} must be the finalized outer transaction hash ` +
        "from the real 2-of-3 owner smoke test",
    );
  }
  return raw.toLowerCase();
};

export const parseMainnetAuthorization = (
  env = process.env,
  chainProfile = ESPACE_CHAIN_PROFILE,
) => {
  const mainnet = chainProfile.mainnet;
  const confirmation = String(env[mainnet.confirmationEnvironmentName] ?? "").trim();
  if (confirmation === "") return Object.freeze({ mode: "plan", confirmation: null });
  if (confirmation !== mainnet.confirmation) {
    throw new Error(
      `${mainnet.confirmationEnvironmentName} must be blank for a read-only plan or exactly ` +
        mainnet.confirmation,
    );
  }
  return Object.freeze({ mode: "execute", confirmation });
};

export const parseProductionMainnetReleaseConfig = ({
  chainProfile = ESPACE_CHAIN_PROFILE,
  env = process.env,
  networkName,
  chainId,
} = {}) => {
  const mainnet = chainProfile.mainnet;
  const authorization = parseMainnetAuthorization(env, chainProfile);
  if (networkName !== mainnet.networkName) {
    throw new Error(
      `${chainProfile.displayName} mainnet release is restricted to network ` +
        `${mainnet.networkName}; got ${networkName || "unknown"}`,
    );
  }
  let normalizedChainId;
  try {
    normalizedChainId = BigInt(chainId);
  } catch {
    throw new Error(
      `${chainProfile.displayName} mainnet release requires chainId ${mainnet.chainId}; got ` +
        String(chainId),
    );
  }
  if (normalizedChainId !== mainnet.chainId) {
    throw new Error(
      `${chainProfile.displayName} mainnet release requires chainId ${mainnet.chainId}; got ` +
        normalizedChainId,
    );
  }
  if (String(env.FORCE_NEW_DEPLOYMENT ?? "").trim() !== "") {
    throw new Error(
      `FORCE_NEW_DEPLOYMENT is forbidden by the ${chainProfile.displayName} mainnet release ` +
        "orchestrator",
    );
  }
  if (String(env.GOVERNANCE_OWNER ?? "").trim() !== "") {
    throw new Error(
      "GOVERNANCE_OWNER must be blank; the release orchestrator deploys and checkpoints it",
    );
  }

  const governanceMultisigProfile = String(env.GOVERNANCE_MULTISIG_PROFILE ?? "").trim();
  if (governanceMultisigProfile !== chainProfile.governanceMultisigProfile) {
    throw new Error(
      `${chainProfile.displayName} mainnet release requires GOVERNANCE_MULTISIG_PROFILE=` +
        chainProfile.governanceMultisigProfile,
    );
  }
  const governanceMultisig = requiredAddress("GOVERNANCE_MULTISIG", env.GOVERNANCE_MULTISIG);
  const expectedDeployer = requiredAddress(
    mainnet.expectedDeployerEnvironmentName,
    env[mainnet.expectedDeployerEnvironmentName],
  );
  const expectedSafeOwners = parseExpectedSafeOwners(
    env[mainnet.safeOwnersEnvironmentName],
    mainnet.safeOwnersEnvironmentName,
  );
  if (expectedSafeOwners.some((owner) => owner.toLowerCase() === expectedDeployer.toLowerCase())) {
    throw new Error(
      `${mainnet.expectedDeployerEnvironmentName} must not be one of the Safe owners`,
    );
  }

  const minDelaySeconds = parseInteger(
    "MIN_DELAY",
    env.MIN_DELAY,
    0,
    MAINNET_MIN_DELAY_FLOOR_SECONDS,
    Number.MAX_SAFE_INTEGER,
  );
  const confirmations = parseInteger(
    mainnet.confirmationsEnvironmentName,
    env[mainnet.confirmationsEnvironmentName],
    2,
    2,
    100,
  );
  const finalityTimeoutSeconds = parseInteger(
    mainnet.finalityTimeoutEnvironmentName,
    env[mainnet.finalityTimeoutEnvironmentName],
    3600,
    60,
    604_800,
  );
  for (const name of [mainnet.verifyEnvironmentName, mainnet.requireFinalityEnvironmentName]) {
    const value = String(env[name] ?? "1").trim();
    if (value !== "1") throw new Error(`${name} is mandatory and must be exactly 1`);
  }

  const maximumCost = String(env[mainnet.maximumCostEnvironmentName] ?? "").trim();
  if (!DECIMAL_NATIVE_PATTERN.test(maximumCost)) {
    throw new Error(
      `${mainnet.maximumCostEnvironmentName} must be explicitly set to a positive plain decimal ` +
        "with at most 18 decimals",
    );
  }
  const maximumCostWei = ethers.parseEther(maximumCost);
  if (maximumCostWei <= 0n) {
    throw new Error(`${mainnet.maximumCostEnvironmentName} must be greater than zero`);
  }

  const configuredPlanDigest = String(env[mainnet.planDigestEnvironmentName] ?? "").trim();
  if (authorization.mode === "execute" && !ethers.isHexString(configuredPlanDigest, 32)) {
    throw new Error(
      `${mainnet.planDigestEnvironmentName} must be the 32-byte digest printed by a reviewed plan`,
    );
  }
  if (authorization.mode === "plan" && configuredPlanDigest !== "") {
    throw new Error(`Leave ${mainnet.planDigestEnvironmentName} blank while generating a plan`);
  }

  return Object.freeze({
    ...authorization,
    chainProfileId: chainProfile.id,
    nativeSymbol: chainProfile.nativeSymbol,
    gasChargingPolicy: mainnet.gasChargingPolicy,
    networkName,
    chainId: normalizedChainId,
    governanceMultisig,
    governanceMultisigProfile,
    expectedSafeOwners,
    expectedDeployer,
    minDelaySeconds,
    confirmations,
    finalityTimeoutSeconds,
    maximumCost,
    maximumCostWei,
    configuredPlanDigest: configuredPlanDigest === "" ? null : configuredPlanDigest.toLowerCase(),
    recoveryTransactions: parseRecoveryTransactions(
      env[mainnet.recoveryTransactionsEnvironmentName],
      mainnet.recoveryTransactionsEnvironmentName,
    ),
    safeAcceptanceTransaction: parseSafeAcceptanceTransaction(
      env[mainnet.safeAcceptanceTransactionEnvironmentName],
      mainnet.safeAcceptanceTransactionEnvironmentName,
    ),
  });
};

export const parseESpaceMainnetReleaseConfig = (options = {}) =>
  parseProductionMainnetReleaseConfig({ ...options, chainProfile: ESPACE_CHAIN_PROFILE });

export const parseEthereumMainnetReleaseConfig = (options = {}) =>
  parseProductionMainnetReleaseConfig({ ...options, chainProfile: ETHEREUM_CHAIN_PROFILE });

const canonicalize = (value) => {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

export const canonicalJson = (value) => JSON.stringify(canonicalize(value));

export const deriveMainnetPlanDigest = (fingerprint) =>
  ethers.keccak256(
    ethers.toUtf8Bytes(
      `${fingerprint?.domain ?? ESPACE_CHAIN_PROFILE.mainnet.releasePlanDigestDomain}:` +
        canonicalJson(fingerprint),
    ),
  );

export const assertMainnetReleaseSafeAcceptanceNonce = (nonce) => {
  let normalized;
  try {
    normalized = BigInt(nonce);
  } catch {
    throw new Error("Governance Safe acceptance nonce is invalid");
  }
  if (normalized !== 1n) {
    throw new Error(
      "Governance Safe bootstrap acceptance must be its first and only execution before " +
        `protocol release; current nonce is ${normalized}`,
    );
  }
  return normalized;
};

export const assertPlanMatchesCheckpoint = ({ checkpoint, fingerprint, planDigest }) => {
  if (!checkpoint || checkpoint.schemaVersion !== MAINNET_STATE_SCHEMA_VERSION) {
    throw new Error("Mainnet release checkpoint is missing or has an unsupported schema version");
  }
  const currentDigest = deriveMainnetPlanDigest(fingerprint);
  if (currentDigest.toLowerCase() !== String(planDigest).toLowerCase()) {
    throw new Error("Current release inputs do not match the approved plan digest");
  }
  if (String(checkpoint.planDigest).toLowerCase() !== String(planDigest).toLowerCase()) {
    throw new Error("Checkpoint plan digest does not match the approved plan digest");
  }
  if (canonicalJson(checkpoint.fingerprint) !== canonicalJson(fingerprint)) {
    throw new Error("Current release fingerprint differs from the immutable checkpoint");
  }
};
