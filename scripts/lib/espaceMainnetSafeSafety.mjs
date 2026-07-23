import { ethers } from "ethers";

import { CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE } from "./governanceSafety.mjs";
import {
  CANONICAL_SAFE_OWNER_COUNT,
  CANONICAL_SAFE_THRESHOLD,
  getCanonicalSafeDeploymentMetadata,
} from "./safeGovernance.mjs";

export const ESPACE_MAINNET_SAFE_NETWORK = "conflux";
export const ESPACE_MAINNET_SAFE_CHAIN_ID = 1030n;
export const ESPACE_MAINNET_SAFE_PROFILE = CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE;
export const ESPACE_MAINNET_SAFE_CONFIRMATION = "conflux-mainnet-safe-chain-1030";
export const ESPACE_MAINNET_SAFE_STATE_SCHEMA_VERSION = 1;
export const ESPACE_MAINNET_SAFE_PLAN_DIGEST_DOMAIN = "deepfamily:espace-mainnet-safe:v1";

const DECIMAL_CFX_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/;
const DECIMAL_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const GIT_COMMIT_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const normalizeChainId = (chainId) => {
  let normalized;
  try {
    normalized = BigInt(chainId);
  } catch {
    throw new Error(`eSpace mainnet Safe creation requires chainId 1030; got ${String(chainId)}`);
  }
  if (normalized !== ESPACE_MAINNET_SAFE_CHAIN_ID) {
    throw new Error(`eSpace mainnet Safe creation requires chainId 1030; got ${normalized}`);
  }
  return normalized;
};

const requiredAddress = (name, value) => {
  const raw = String(value ?? "").trim();
  if (!ethers.isAddress(raw) || raw.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
    throw new Error(`${name} must be an explicit nonzero EVM address`);
  }
  return ethers.getAddress(raw);
};

const parseExpectedSafeOwners = (value) => {
  const raw = String(value ?? "").trim();
  const owners = raw === "" ? [] : raw.split(",").map((item) => item.trim());
  if (owners.length !== CANONICAL_SAFE_OWNER_COUNT) {
    throw new Error(
      `ESPACE_MAINNET_SAFE_OWNERS must contain exactly ${CANONICAL_SAFE_OWNER_COUNT} ` +
        "comma-separated addresses",
    );
  }
  const normalized = owners.map((owner, index) =>
    requiredAddress(`ESPACE_MAINNET_SAFE_OWNERS[${index}]`, owner),
  );
  if (new Set(normalized.map((owner) => owner.toLowerCase())).size !== normalized.length) {
    throw new Error("ESPACE_MAINNET_SAFE_OWNERS must contain three distinct addresses");
  }
  // Safe setup calldata, CREATE2 prediction and the review digest all depend on owner order.
  return Object.freeze(normalized);
};

const parseInteger = (name, value, defaultValue, minimum, maximum) => {
  const raw = value === undefined || value === "" ? String(defaultValue) : String(value).trim();
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be a base-10 integer`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
};

const parseSaltNonce = (value) => {
  const raw = String(value ?? "").trim();
  if (!DECIMAL_INTEGER_PATTERN.test(raw)) {
    throw new Error(
      "ESPACE_MAINNET_SAFE_SALT_NONCE must be explicitly set to a canonical unsigned " +
        "base-10 integer",
    );
  }
  const saltNonce = BigInt(raw);
  if (saltNonce > ethers.MaxUint256) {
    throw new Error("ESPACE_MAINNET_SAFE_SALT_NONCE must fit in uint256");
  }
  return saltNonce.toString();
};

const parseMaximumCost = (value) => {
  const maxCfx = String(value ?? "").trim();
  if (!DECIMAL_CFX_PATTERN.test(maxCfx)) {
    throw new Error(
      "ESPACE_MAINNET_SAFE_MAX_CFX must be explicitly set to a positive plain decimal " +
        "with at most 18 decimals",
    );
  }
  const maxCfxWei = ethers.parseEther(maxCfx);
  if (maxCfxWei <= 0n) {
    throw new Error("ESPACE_MAINNET_SAFE_MAX_CFX must be greater than zero");
  }
  if (maxCfxWei > ethers.MaxUint256) {
    throw new Error("ESPACE_MAINNET_SAFE_MAX_CFX exceeds uint256");
  }
  return { maxCfx, maxCfxWei };
};

const parseRecoveryTransaction = (value) => {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  if (!ethers.isHexString(raw, 32)) {
    throw new Error("ESPACE_MAINNET_SAFE_RECOVERY_TX must be blank or a 32-byte transaction hash");
  }
  return raw.toLowerCase();
};

const parseAcceptanceTransaction = (value) => {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  if (!ethers.isHexString(raw, 32)) {
    throw new Error(
      "ESPACE_MAINNET_SAFE_ACCEPTANCE_TX must be blank or a 32-byte transaction hash",
    );
  }
  return raw.toLowerCase();
};

/**
 * The two execute authorizations are deliberately atomic: a blank pair is plan mode and a fully
 * valid pair is execute mode. This prevents an old digest or confirmation flag from silently
 * changing a later planning run into an execution.
 */
export const parseESpaceMainnetSafeAuthorization = (env = process.env) => {
  const confirmation = String(env.ESPACE_MAINNET_SAFE_CONFIRM ?? "").trim();
  const configuredPlanDigest = String(env.ESPACE_MAINNET_SAFE_PLAN_DIGEST ?? "").trim();
  if (confirmation === "" && configuredPlanDigest === "") {
    return Object.freeze({
      mode: "plan",
      confirmation: null,
      configuredPlanDigest: null,
    });
  }
  if (confirmation === "" || configuredPlanDigest === "") {
    throw new Error(
      "ESPACE_MAINNET_SAFE_CONFIRM and ESPACE_MAINNET_SAFE_PLAN_DIGEST must either both " +
        "be blank for plan mode or both be set for execute mode",
    );
  }
  if (confirmation !== ESPACE_MAINNET_SAFE_CONFIRMATION) {
    throw new Error(
      `ESPACE_MAINNET_SAFE_CONFIRM must be exactly ${ESPACE_MAINNET_SAFE_CONFIRMATION}`,
    );
  }
  if (!ethers.isHexString(configuredPlanDigest, 32)) {
    throw new Error(
      "ESPACE_MAINNET_SAFE_PLAN_DIGEST must be the 32-byte digest printed by a reviewed plan",
    );
  }
  return Object.freeze({
    mode: "execute",
    confirmation,
    configuredPlanDigest: configuredPlanDigest.toLowerCase(),
  });
};

// Shorter alias used by command wrappers that must reject bad authorization before opening an RPC.
export const parseMainnetSafeAuthorization = parseESpaceMainnetSafeAuthorization;

export const parseESpaceMainnetSafeConfig = ({ env = process.env, networkName, chainId } = {}) => {
  // Authorization is parsed first so an invalid non-empty confirmation fails before any caller
  // needs to open an RPC connection or load a deployer private key.
  const authorization = parseMainnetSafeAuthorization(env);
  if (networkName !== ESPACE_MAINNET_SAFE_NETWORK) {
    throw new Error(
      `eSpace mainnet Safe creation is restricted to network ${ESPACE_MAINNET_SAFE_NETWORK}; ` +
        `got ${networkName || "unknown"}`,
    );
  }
  const normalizedChainId = normalizeChainId(chainId);

  const governanceMultisigProfile = String(env.GOVERNANCE_MULTISIG_PROFILE ?? "").trim();
  if (governanceMultisigProfile !== ESPACE_MAINNET_SAFE_PROFILE) {
    throw new Error(
      `eSpace mainnet Safe creation requires GOVERNANCE_MULTISIG_PROFILE=` +
        ESPACE_MAINNET_SAFE_PROFILE,
    );
  }
  const expectedDeployer = requiredAddress(
    "ESPACE_MAINNET_EXPECTED_DEPLOYER",
    env.ESPACE_MAINNET_EXPECTED_DEPLOYER,
  );
  const expectedSafeOwners = parseExpectedSafeOwners(env.ESPACE_MAINNET_SAFE_OWNERS);
  if (expectedSafeOwners.some((owner) => owner.toLowerCase() === expectedDeployer.toLowerCase())) {
    throw new Error("ESPACE_MAINNET_EXPECTED_DEPLOYER must not be one of the Safe owners");
  }

  const saltNonce = parseSaltNonce(env.ESPACE_MAINNET_SAFE_SALT_NONCE);
  const governanceMultisigRaw = String(env.GOVERNANCE_MULTISIG ?? "").trim();
  const governanceMultisig =
    governanceMultisigRaw === ""
      ? null
      : requiredAddress("GOVERNANCE_MULTISIG", governanceMultisigRaw);
  const { maxCfx, maxCfxWei } = parseMaximumCost(env.ESPACE_MAINNET_SAFE_MAX_CFX);
  const confirmations = parseInteger(
    "ESPACE_MAINNET_SAFE_CONFIRMATIONS",
    env.ESPACE_MAINNET_SAFE_CONFIRMATIONS,
    2,
    2,
    100,
  );
  const finalityTimeoutSeconds = parseInteger(
    "ESPACE_MAINNET_SAFE_FINALITY_TIMEOUT",
    env.ESPACE_MAINNET_SAFE_FINALITY_TIMEOUT,
    3600,
    60,
    604_800,
  );
  const recoveryTransaction = parseRecoveryTransaction(env.ESPACE_MAINNET_SAFE_RECOVERY_TX);
  const acceptanceTransaction = parseAcceptanceTransaction(env.ESPACE_MAINNET_SAFE_ACCEPTANCE_TX);
  if (recoveryTransaction !== null && authorization.mode !== "execute") {
    throw new Error("ESPACE_MAINNET_SAFE_RECOVERY_TX is accepted only in confirmed execute mode");
  }

  return deepFreeze({
    ...authorization,
    networkName,
    chainId: normalizedChainId,
    governanceMultisigProfile,
    expectedSafeOwners,
    expectedDeployer,
    governanceMultisig,
    saltNonce,
    maxCfx,
    maxCfxWei,
    confirmations,
    finalityTimeoutSeconds,
    recoveryTransaction,
    acceptanceTransaction,
  });
};

const canonicalize = (value, path = "value") => {
  if (typeof value === "bigint") return value.toString();
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} must contain only plain JSON-compatible objects`);
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key], `${path}.${key}`)]),
    );
  }
  throw new Error(`${path} contains an unsupported value`);
};

export const canonicalMainnetSafePlanJson = (value) => JSON.stringify(canonicalize(value));

const parseNonnegativeInteger = (name, value) => {
  let normalized;
  try {
    normalized = BigInt(value);
  } catch {
    throw new Error(`${name} must be a non-negative integer`);
  }
  if (normalized < 0n) throw new Error(`${name} must be a non-negative integer`);
  return normalized.toString();
};

const normalizeSafeToolInputs = (safeToolInputs) => {
  if (!safeToolInputs || typeof safeToolInputs !== "object" || Array.isArray(safeToolInputs)) {
    throw new Error("safeToolInputs must contain a digest and files map");
  }
  if (!ethers.isHexString(safeToolInputs.digest, 32)) {
    throw new Error("safeToolInputs.digest must be a 32-byte content digest");
  }
  const files = safeToolInputs.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw new Error("safeToolInputs.files must be a non-empty path-to-digest map");
  }
  const entries = Object.entries(files);
  if (entries.length === 0) {
    throw new Error("safeToolInputs.files must be a non-empty path-to-digest map");
  }
  const normalizedFiles = {};
  for (const [file, digest] of entries) {
    if (
      file === "" ||
      file.startsWith("/") ||
      file.includes("\\") ||
      file
        .split("/")
        .some((component) => component === "" || component === "." || component === "..")
    ) {
      throw new Error(`safeToolInputs.files contains an unsafe relative path: ${file}`);
    }
    if (!ethers.isHexString(digest, 32)) {
      throw new Error(`safeToolInputs.files[${file}] must be a 32-byte content digest`);
    }
    normalizedFiles[file] = digest.toLowerCase();
  }
  return {
    digest: safeToolInputs.digest.toLowerCase(),
    files: normalizedFiles,
  };
};

const normalizeCanonicalInfrastructure = (canonicalInfrastructure) => {
  if (
    !canonicalInfrastructure ||
    typeof canonicalInfrastructure !== "object" ||
    Array.isArray(canonicalInfrastructure)
  ) {
    throw new Error("canonicalInfrastructure must be a Safe infrastructure inspection");
  }
  const chainId = normalizeChainId(canonicalInfrastructure.chainId);
  let rpcChainId;
  try {
    rpcChainId = BigInt(canonicalInfrastructure.rpcChainId);
  } catch {
    throw new Error("canonicalInfrastructure.rpcChainId must identify chainId 1030");
  }
  if (rpcChainId !== ESPACE_MAINNET_SAFE_CHAIN_ID) {
    throw new Error("canonicalInfrastructure.rpcChainId must identify chainId 1030");
  }

  const officialMetadata = getCanonicalSafeDeploymentMetadata(chainId);
  const components = {};
  for (const name of ["singleton", "proxyFactory", "fallbackHandler"]) {
    const component = canonicalInfrastructure.components?.[name];
    if (!component || typeof component !== "object" || Array.isArray(component)) {
      throw new Error(`canonicalInfrastructure.components.${name} is missing`);
    }
    const address = requiredAddress(
      `canonicalInfrastructure.components.${name}.address`,
      component.address,
    );
    if (address.toLowerCase() !== officialMetadata[name].address.toLowerCase()) {
      throw new Error(`canonicalInfrastructure ${name} address is not canonical`);
    }
    for (const field of ["expectedCodeHash", "actualCodeHash"]) {
      if (!ethers.isHexString(component[field], 32)) {
        throw new Error(
          `canonicalInfrastructure.components.${name}.${field} must be a 32-byte hash`,
        );
      }
    }
    const expectedCodeHash = component.expectedCodeHash.toLowerCase();
    const actualCodeHash = component.actualCodeHash.toLowerCase();
    if (
      expectedCodeHash !== officialMetadata[name].codeHash ||
      actualCodeHash !== expectedCodeHash ||
      component.matched !== true
    ) {
      throw new Error(`canonicalInfrastructure ${name} code does not match pinned metadata`);
    }
    components[name] = {
      address,
      expectedCodeHash,
      actualCodeHash,
      matched: true,
    };
  }
  if (!ethers.isHexString(canonicalInfrastructure.canonicalProxyCodeHash, 32)) {
    throw new Error("canonicalInfrastructure.canonicalProxyCodeHash must be a 32-byte hash");
  }
  return {
    chainId,
    rpcChainId: `0x${rpcChainId.toString(16)}`,
    components,
    canonicalProxyCodeHash: canonicalInfrastructure.canonicalProxyCodeHash.toLowerCase(),
  };
};

/**
 * Builds the complete immutable review surface for the one canonical factory transaction.
 * Authentication/recovery values are intentionally excluded: they authorize or recover the
 * already-reviewed plan and must not create a circular digest dependency.
 */
export const buildMainnetSafePlanFingerprint = ({
  config,
  releaseCommit,
  safeToolInputs,
  deployerNonce,
  predictedSafeAddress,
  deploymentTransaction,
  canonicalInfrastructure,
}) => {
  if (!config || typeof config !== "object") {
    throw new Error("A parsed eSpace mainnet Safe config is required");
  }
  if (!GIT_COMMIT_PATTERN.test(String(releaseCommit ?? ""))) {
    throw new Error("releaseCommit must be a 40- or 64-character hexadecimal Git commit");
  }
  const normalizedToolInputs = normalizeSafeToolInputs(safeToolInputs);
  const normalizedDeployerNonce = parseNonnegativeInteger("deployerNonce", deployerNonce);
  const normalizedPredictedSafeAddress = requiredAddress(
    "predictedSafeAddress",
    predictedSafeAddress,
  );
  const infrastructure = normalizeCanonicalInfrastructure(canonicalInfrastructure);
  if (
    !deploymentTransaction ||
    typeof deploymentTransaction !== "object" ||
    Array.isArray(deploymentTransaction)
  ) {
    throw new Error("deploymentTransaction must be the exact Safe factory transaction");
  }
  const transactionTarget = requiredAddress("deploymentTransaction.to", deploymentTransaction.to);
  if (
    transactionTarget.toLowerCase() !== infrastructure.components.proxyFactory.address.toLowerCase()
  ) {
    throw new Error("deploymentTransaction must target the canonical Safe ProxyFactory");
  }
  let transactionValue;
  try {
    transactionValue = BigInt(deploymentTransaction.value);
  } catch {
    throw new Error("deploymentTransaction.value must be a non-negative integer");
  }
  if (transactionValue !== 0n) {
    throw new Error("Canonical Safe factory deployment transaction value must be zero");
  }
  if (!ethers.isHexString(deploymentTransaction.data) || deploymentTransaction.data === "0x") {
    throw new Error("deploymentTransaction.data must be non-empty hexadecimal calldata");
  }
  const transactionData = ethers.hexlify(deploymentTransaction.data).toLowerCase();

  const normalizedOwners = parseExpectedSafeOwners([...config.expectedSafeOwners].join(","));
  const expectedDeployer = requiredAddress("config.expectedDeployer", config.expectedDeployer);
  if (normalizedOwners.some((owner) => owner.toLowerCase() === expectedDeployer.toLowerCase())) {
    throw new Error("config.expectedDeployer must not be one of the Safe owners");
  }
  const saltNonce = parseSaltNonce(config.saltNonce);
  if (config.networkName !== ESPACE_MAINNET_SAFE_NETWORK) {
    throw new Error("config.networkName must be conflux");
  }
  const configChainId = normalizeChainId(config.chainId);
  if (config.governanceMultisigProfile !== ESPACE_MAINNET_SAFE_PROFILE) {
    throw new Error(`config.governanceMultisigProfile must be ${ESPACE_MAINNET_SAFE_PROFILE}`);
  }
  const confirmations = parseInteger("config.confirmations", config.confirmations, 2, 2, 100);
  const finalityTimeoutSeconds = parseInteger(
    "config.finalityTimeoutSeconds",
    config.finalityTimeoutSeconds,
    3600,
    60,
    604_800,
  );
  const maxCfxWei = parseNonnegativeInteger("config.maxCfxWei", config.maxCfxWei);
  if (BigInt(maxCfxWei) <= 0n || BigInt(maxCfxWei) > ethers.MaxUint256) {
    throw new Error("config.maxCfxWei must be a positive uint256 amount");
  }

  return deepFreeze(
    canonicalize({
      schemaVersion: ESPACE_MAINNET_SAFE_STATE_SCHEMA_VERSION,
      domain: ESPACE_MAINNET_SAFE_PLAN_DIGEST_DOMAIN,
      network: {
        name: ESPACE_MAINNET_SAFE_NETWORK,
        chainId: configChainId,
      },
      releaseCommit: String(releaseCommit).toLowerCase(),
      safeToolInputs: normalizedToolInputs,
      deployer: {
        address: expectedDeployer,
        nonce: normalizedDeployerNonce,
      },
      governanceSafe: {
        predictedAddress: normalizedPredictedSafeAddress,
        owners: [...normalizedOwners],
        threshold: CANONICAL_SAFE_THRESHOLD,
        profile: ESPACE_MAINNET_SAFE_PROFILE,
        saltNonce,
      },
      canonicalInfrastructure: infrastructure,
      factoryTransaction: {
        to: transactionTarget,
        value: transactionValue,
        data: transactionData,
        dataHash: ethers.keccak256(transactionData),
      },
      executionPolicy: {
        confirmations,
        finalityTimeoutSeconds,
        finalityRequired: true,
        maximumCostWei: maxCfxWei,
      },
    }),
  );
};

export const deriveMainnetSafePlanDigest = (fingerprint) =>
  ethers.keccak256(
    ethers.toUtf8Bytes(
      `${ESPACE_MAINNET_SAFE_PLAN_DIGEST_DOMAIN}:${canonicalMainnetSafePlanJson(fingerprint)}`,
    ),
  );

export const assertMainnetSafePlanMatchesCheckpoint = ({ checkpoint, fingerprint, planDigest }) => {
  if (!checkpoint || checkpoint.schemaVersion !== ESPACE_MAINNET_SAFE_STATE_SCHEMA_VERSION) {
    throw new Error("Mainnet Safe checkpoint is missing or has an unsupported schema version");
  }
  if (!ethers.isHexString(planDigest, 32)) {
    throw new Error("Approved mainnet Safe plan digest must be a 32-byte hash");
  }
  const normalizedPlanDigest = planDigest.toLowerCase();
  if (deriveMainnetSafePlanDigest(fingerprint) !== normalizedPlanDigest) {
    throw new Error("Current Safe inputs do not match the approved plan digest");
  }
  if (String(checkpoint.planDigest ?? "").toLowerCase() !== normalizedPlanDigest) {
    throw new Error("Mainnet Safe checkpoint digest does not match the approved plan digest");
  }
  if (
    canonicalMainnetSafePlanJson(checkpoint.fingerprint) !==
    canonicalMainnetSafePlanJson(fingerprint)
  ) {
    throw new Error("Current Safe fingerprint differs from the immutable checkpoint");
  }
};
