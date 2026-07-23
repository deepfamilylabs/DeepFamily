import { ethers } from "ethers";

import { CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE } from "./governanceSafety.mjs";

export const ESPACE_MAINNET_NETWORK = "conflux";
export const ESPACE_MAINNET_CHAIN_ID = 1030n;
export const ESPACE_MAINNET_CONFIRMATION = "conflux-mainnet-chain-1030";
export const ESPACE_MAINNET_MIN_DELAY_FLOOR_SECONDS = 86_400;
export const ESPACE_MAINNET_STATE_SCHEMA_VERSION = 1;
export const ESPACE_MAINNET_TRANSACTION_LABELS = Object.freeze([
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

const DECIMAL_CFX_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/;
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

const parseExpectedSafeOwners = (value) => {
  const raw = String(value ?? "").trim();
  const owners = raw === "" ? [] : raw.split(",").map((item) => item.trim());
  if (owners.length !== 3) {
    throw new Error(
      "ESPACE_MAINNET_SAFE_OWNERS must contain exactly three comma-separated addresses",
    );
  }
  const normalized = owners.map((owner, index) =>
    requiredAddress(`ESPACE_MAINNET_SAFE_OWNERS[${index}]`, owner),
  );
  if (new Set(normalized.map((owner) => owner.toLowerCase())).size !== normalized.length) {
    throw new Error("ESPACE_MAINNET_SAFE_OWNERS must contain three distinct addresses");
  }
  return Object.freeze(normalized);
};

const parseRecoveryTransactions = (value) => {
  const raw = String(value ?? "").trim();
  if (raw === "") return Object.freeze({});
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("ESPACE_MAINNET_RECOVERY_TXS must be a JSON object of label-to-hash entries");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ESPACE_MAINNET_RECOVERY_TXS must be a JSON object of label-to-hash entries");
  }
  const entries = Object.entries(parsed).map(([label, hash]) => {
    if (!TRANSACTION_LABEL_PATTERN.test(label)) {
      throw new Error(`ESPACE_MAINNET_RECOVERY_TXS contains an invalid label: ${label}`);
    }
    if (!ethers.isHexString(hash, 32)) {
      throw new Error(`ESPACE_MAINNET_RECOVERY_TXS.${label} must be a 32-byte transaction hash`);
    }
    if (!ESPACE_MAINNET_TRANSACTION_LABELS.includes(label)) {
      throw new Error(`ESPACE_MAINNET_RECOVERY_TXS contains an unknown release label: ${label}`);
    }
    return [label, hash.toLowerCase()];
  });
  return Object.freeze(Object.fromEntries(entries));
};

const parseSafeAcceptanceTransaction = (value) => {
  const raw = String(value ?? "").trim();
  if (!ethers.isHexString(raw, 32)) {
    throw new Error(
      "ESPACE_MAINNET_SAFE_ACCEPTANCE_TX must be the finalized outer transaction hash " +
        "from the real 2-of-3 owner smoke test",
    );
  }
  return raw.toLowerCase();
};

export const parseMainnetAuthorization = (env = process.env) => {
  const confirmation = String(env.ESPACE_MAINNET_CONFIRM ?? "").trim();
  if (confirmation === "") return Object.freeze({ mode: "plan", confirmation: null });
  if (confirmation !== ESPACE_MAINNET_CONFIRMATION) {
    throw new Error(
      `ESPACE_MAINNET_CONFIRM must be blank for a read-only plan or exactly ` +
        ESPACE_MAINNET_CONFIRMATION,
    );
  }
  return Object.freeze({ mode: "execute", confirmation });
};

export const parseESpaceMainnetReleaseConfig = ({
  env = process.env,
  networkName,
  chainId,
} = {}) => {
  const authorization = parseMainnetAuthorization(env);
  if (networkName !== ESPACE_MAINNET_NETWORK) {
    throw new Error(
      `eSpace mainnet release is restricted to network ${ESPACE_MAINNET_NETWORK}; got ` +
        `${networkName || "unknown"}`,
    );
  }
  let normalizedChainId;
  try {
    normalizedChainId = BigInt(chainId);
  } catch {
    throw new Error(`eSpace mainnet release requires chainId 1030; got ${String(chainId)}`);
  }
  if (normalizedChainId !== ESPACE_MAINNET_CHAIN_ID) {
    throw new Error(`eSpace mainnet release requires chainId 1030; got ${normalizedChainId}`);
  }
  if (String(env.FORCE_NEW_DEPLOYMENT ?? "").trim() !== "") {
    throw new Error("FORCE_NEW_DEPLOYMENT is forbidden by the eSpace mainnet release orchestrator");
  }
  if (String(env.GOVERNANCE_OWNER ?? "").trim() !== "") {
    throw new Error(
      "GOVERNANCE_OWNER must be blank; the release orchestrator deploys and checkpoints it",
    );
  }

  const governanceMultisigProfile = String(env.GOVERNANCE_MULTISIG_PROFILE ?? "").trim();
  if (governanceMultisigProfile !== CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE) {
    throw new Error(
      `eSpace mainnet release requires GOVERNANCE_MULTISIG_PROFILE=` +
        CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE,
    );
  }
  const governanceMultisig = requiredAddress("GOVERNANCE_MULTISIG", env.GOVERNANCE_MULTISIG);
  const expectedDeployer = requiredAddress(
    "ESPACE_MAINNET_EXPECTED_DEPLOYER",
    env.ESPACE_MAINNET_EXPECTED_DEPLOYER,
  );
  const expectedSafeOwners = parseExpectedSafeOwners(env.ESPACE_MAINNET_SAFE_OWNERS);
  if (expectedSafeOwners.some((owner) => owner.toLowerCase() === expectedDeployer.toLowerCase())) {
    throw new Error("ESPACE_MAINNET_EXPECTED_DEPLOYER must not be one of the Safe owners");
  }

  const minDelaySeconds = parseInteger(
    "MIN_DELAY",
    env.MIN_DELAY,
    0,
    ESPACE_MAINNET_MIN_DELAY_FLOOR_SECONDS,
    Number.MAX_SAFE_INTEGER,
  );
  const confirmations = parseInteger(
    "ESPACE_MAINNET_CONFIRMATIONS",
    env.ESPACE_MAINNET_CONFIRMATIONS,
    2,
    2,
    100,
  );
  const finalityTimeoutSeconds = parseInteger(
    "ESPACE_MAINNET_FINALITY_TIMEOUT",
    env.ESPACE_MAINNET_FINALITY_TIMEOUT,
    3600,
    60,
    604_800,
  );
  for (const name of ["ESPACE_MAINNET_VERIFY", "ESPACE_MAINNET_REQUIRE_FINALITY"]) {
    const value = String(env[name] ?? "1").trim();
    if (value !== "1") throw new Error(`${name} is mandatory and must be exactly 1`);
  }

  const maxCfx = String(env.ESPACE_MAINNET_MAX_CFX ?? "").trim();
  if (!DECIMAL_CFX_PATTERN.test(maxCfx)) {
    throw new Error(
      "ESPACE_MAINNET_MAX_CFX must be explicitly set to a positive plain decimal with at most 18 decimals",
    );
  }
  const maxCfxWei = ethers.parseEther(maxCfx);
  if (maxCfxWei <= 0n) throw new Error("ESPACE_MAINNET_MAX_CFX must be greater than zero");

  const configuredPlanDigest = String(env.ESPACE_MAINNET_PLAN_DIGEST ?? "").trim();
  if (authorization.mode === "execute" && !ethers.isHexString(configuredPlanDigest, 32)) {
    throw new Error(
      "ESPACE_MAINNET_PLAN_DIGEST must be the 32-byte digest printed by a reviewed plan",
    );
  }
  if (authorization.mode === "plan" && configuredPlanDigest !== "") {
    throw new Error("Leave ESPACE_MAINNET_PLAN_DIGEST blank while generating a plan");
  }

  return Object.freeze({
    ...authorization,
    networkName,
    chainId: normalizedChainId,
    governanceMultisig,
    governanceMultisigProfile,
    expectedSafeOwners,
    expectedDeployer,
    minDelaySeconds,
    confirmations,
    finalityTimeoutSeconds,
    maxCfx,
    maxCfxWei,
    configuredPlanDigest: configuredPlanDigest === "" ? null : configuredPlanDigest.toLowerCase(),
    recoveryTransactions: parseRecoveryTransactions(env.ESPACE_MAINNET_RECOVERY_TXS),
    safeAcceptanceTransaction: parseSafeAcceptanceTransaction(
      env.ESPACE_MAINNET_SAFE_ACCEPTANCE_TX,
    ),
  });
};

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
    ethers.toUtf8Bytes(`deepfamily:espace-mainnet-release:v1:${canonicalJson(fingerprint)}`),
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
  if (!checkpoint || checkpoint.schemaVersion !== ESPACE_MAINNET_STATE_SCHEMA_VERSION) {
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
