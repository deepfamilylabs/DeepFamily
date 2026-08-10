/**
 * Shared guarded EVM mainnet Safe configuration and authorization helpers.
 */
import { ethers } from "ethers";

import { ESPACE_CHAIN_PROFILE, ETHEREUM_CHAIN_PROFILE, getChainProfile } from "./chainProfiles.mjs";
import {
  CANONICAL_SAFE_OWNER_COUNT,
  CANONICAL_SAFE_THRESHOLD,
  getCanonicalSafeDeploymentMetadata,
} from "./safeGovernance.mjs";

export const ESPACE_MAINNET_SAFE_NETWORK = ESPACE_CHAIN_PROFILE.mainnet.networkName;
export const ESPACE_MAINNET_SAFE_CHAIN_ID = ESPACE_CHAIN_PROFILE.mainnet.chainId;
export const ESPACE_MAINNET_SAFE_PROFILE = ESPACE_CHAIN_PROFILE.governanceMultisigProfile;
export const ETHEREUM_MAINNET_SAFE_NETWORK = ETHEREUM_CHAIN_PROFILE.mainnet.networkName;
export const ETHEREUM_MAINNET_SAFE_CHAIN_ID = ETHEREUM_CHAIN_PROFILE.mainnet.chainId;
export const ETHEREUM_MAINNET_SAFE_PROFILE = ETHEREUM_CHAIN_PROFILE.governanceMultisigProfile;
export const MAINNET_SAFE_STATE_SCHEMA_VERSION = 1;
export const ESPACE_MAINNET_SAFE_PLAN_DIGEST_DOMAIN =
  ESPACE_CHAIN_PROFILE.mainnet.safePlanDigestDomain;
export const ETHEREUM_MAINNET_SAFE_PLAN_DIGEST_DOMAIN =
  ETHEREUM_CHAIN_PROFILE.mainnet.safePlanDigestDomain;

const DECIMAL_NATIVE_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/;
const DECIMAL_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const GIT_COMMIT_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const normalizeChainId = (chainId, chainProfile = ESPACE_CHAIN_PROFILE) => {
  const mainnet = chainProfile.mainnet;
  let normalized;
  try {
    normalized = BigInt(chainId);
  } catch {
    throw new Error(
      `${chainProfile.displayName} mainnet Safe creation requires chainId ${mainnet.chainId}; ` +
        `got ${String(chainId)}`,
    );
  }
  if (normalized !== mainnet.chainId) {
    throw new Error(
      `${chainProfile.displayName} mainnet Safe creation requires chainId ${mainnet.chainId}; ` +
        `got ${normalized}`,
    );
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

const parseExpectedSafeOwners = (
  value,
  environmentName = ESPACE_CHAIN_PROFILE.mainnet.safeOwnersEnvironmentName,
) => {
  const raw = String(value ?? "").trim();
  const owners = raw === "" ? [] : raw.split(",").map((item) => item.trim());
  if (owners.length !== CANONICAL_SAFE_OWNER_COUNT) {
    throw new Error(
      `${environmentName} must contain exactly ${CANONICAL_SAFE_OWNER_COUNT} ` +
        "comma-separated addresses",
    );
  }
  const normalized = owners.map((owner, index) =>
    requiredAddress(`${environmentName}[${index}]`, owner),
  );
  if (new Set(normalized.map((owner) => owner.toLowerCase())).size !== normalized.length) {
    throw new Error(`${environmentName} must contain three distinct addresses`);
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

const parseSaltNonce = (
  value,
  environmentName = ESPACE_CHAIN_PROFILE.mainnet.safeSaltNonceEnvironmentName,
) => {
  const raw = String(value ?? "").trim();
  if (!DECIMAL_INTEGER_PATTERN.test(raw)) {
    throw new Error(
      `${environmentName} must be explicitly set to a canonical unsigned ` + "base-10 integer",
    );
  }
  const saltNonce = BigInt(raw);
  if (saltNonce > ethers.MaxUint256) {
    throw new Error(`${environmentName} must fit in uint256`);
  }
  return saltNonce.toString();
};

const parseMaximumCost = (
  value,
  environmentName = ESPACE_CHAIN_PROFILE.mainnet.safeMaximumCostEnvironmentName,
) => {
  const maximumCost = String(value ?? "").trim();
  if (!DECIMAL_NATIVE_PATTERN.test(maximumCost)) {
    throw new Error(
      `${environmentName} must be explicitly set to a positive plain decimal ` +
        "with at most 18 decimals",
    );
  }
  const maximumCostWei = ethers.parseEther(maximumCost);
  if (maximumCostWei <= 0n) {
    throw new Error(`${environmentName} must be greater than zero`);
  }
  if (maximumCostWei > ethers.MaxUint256) {
    throw new Error(`${environmentName} exceeds uint256`);
  }
  return { maximumCost, maximumCostWei };
};

const parseRecoveryTransaction = (
  value,
  environmentName = ESPACE_CHAIN_PROFILE.mainnet.safeRecoveryTransactionEnvironmentName,
) => {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  if (!ethers.isHexString(raw, 32)) {
    throw new Error(`${environmentName} must be blank or a 32-byte transaction hash`);
  }
  return raw.toLowerCase();
};

const parseAcceptanceTransaction = (
  value,
  environmentName = ESPACE_CHAIN_PROFILE.mainnet.safeAcceptanceTransactionEnvironmentName,
) => {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  if (!ethers.isHexString(raw, 32)) {
    throw new Error(`${environmentName} must be blank or a 32-byte transaction hash`);
  }
  return raw.toLowerCase();
};

/**
 * A blank reviewed-plan digest selects plan mode; a valid digest selects execute mode. The execute
 * path still recomputes the complete plan and rejects a stale or mismatched digest before broadcast.
 */
export const parseMainnetSafeAuthorization = (
  env = process.env,
  chainProfile = ESPACE_CHAIN_PROFILE,
) => {
  const mainnet = chainProfile.mainnet;
  const configuredPlanDigest = String(env[mainnet.safePlanDigestEnvironmentName] ?? "").trim();
  if (configuredPlanDigest === "") {
    return Object.freeze({
      mode: "plan",
      configuredPlanDigest: null,
    });
  }
  if (!ethers.isHexString(configuredPlanDigest, 32)) {
    throw new Error(
      `${mainnet.safePlanDigestEnvironmentName} must be the 32-byte digest printed by a ` +
        "reviewed plan",
    );
  }
  return Object.freeze({
    mode: "execute",
    configuredPlanDigest: configuredPlanDigest.toLowerCase(),
  });
};

export const parseESpaceMainnetSafeAuthorization = (env = process.env) =>
  parseMainnetSafeAuthorization(env, ESPACE_CHAIN_PROFILE);

export const parseEthereumMainnetSafeAuthorization = (env = process.env) =>
  parseMainnetSafeAuthorization(env, ETHEREUM_CHAIN_PROFILE);

export const parseProductionMainnetSafeConfig = ({
  chainProfile = ESPACE_CHAIN_PROFILE,
  env = process.env,
  networkName,
  chainId,
} = {}) => {
  const mainnet = chainProfile.mainnet;
  // Authorization is parsed first so an invalid non-empty plan digest fails before any caller needs
  // to open an RPC connection or load a deployer private key.
  const authorization = parseMainnetSafeAuthorization(env, chainProfile);
  if (networkName !== mainnet.networkName) {
    throw new Error(
      `${chainProfile.displayName} mainnet Safe creation is restricted to network ` +
        `${mainnet.networkName}; got ${networkName || "unknown"}`,
    );
  }
  const normalizedChainId = normalizeChainId(chainId, chainProfile);

  const governanceMultisigProfile = String(env.GOVERNANCE_MULTISIG_PROFILE ?? "").trim();
  if (governanceMultisigProfile !== chainProfile.governanceMultisigProfile) {
    throw new Error(
      `${chainProfile.displayName} mainnet Safe creation requires GOVERNANCE_MULTISIG_PROFILE=` +
        chainProfile.governanceMultisigProfile,
    );
  }
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

  const saltNonce = parseSaltNonce(
    env[mainnet.safeSaltNonceEnvironmentName],
    mainnet.safeSaltNonceEnvironmentName,
  );
  const governanceMultisigRaw = String(env.GOVERNANCE_MULTISIG ?? "").trim();
  const governanceMultisig =
    governanceMultisigRaw === ""
      ? null
      : requiredAddress("GOVERNANCE_MULTISIG", governanceMultisigRaw);
  const { maximumCost, maximumCostWei } = parseMaximumCost(
    env[mainnet.safeMaximumCostEnvironmentName],
    mainnet.safeMaximumCostEnvironmentName,
  );
  const confirmations = parseInteger(
    mainnet.safeConfirmationsEnvironmentName,
    env[mainnet.safeConfirmationsEnvironmentName],
    2,
    2,
    100,
  );
  const finalityTimeoutSeconds = parseInteger(
    mainnet.safeFinalityTimeoutEnvironmentName,
    env[mainnet.safeFinalityTimeoutEnvironmentName],
    3600,
    60,
    604_800,
  );
  const recoveryTransaction = parseRecoveryTransaction(
    env[mainnet.safeRecoveryTransactionEnvironmentName],
    mainnet.safeRecoveryTransactionEnvironmentName,
  );
  const acceptanceTransaction = parseAcceptanceTransaction(
    env[mainnet.safeAcceptanceTransactionEnvironmentName],
    mainnet.safeAcceptanceTransactionEnvironmentName,
  );
  if (recoveryTransaction !== null && authorization.mode !== "execute") {
    throw new Error(
      `${mainnet.safeRecoveryTransactionEnvironmentName} is accepted only in execute mode`,
    );
  }

  return deepFreeze({
    ...authorization,
    chainProfileId: chainProfile.id,
    nativeSymbol: chainProfile.nativeSymbol,
    gasChargingPolicy: mainnet.gasChargingPolicy,
    networkName,
    chainId: normalizedChainId,
    governanceMultisigProfile,
    expectedSafeOwners,
    expectedDeployer,
    governanceMultisig,
    saltNonce,
    maximumCost,
    maximumCostWei,
    confirmations,
    finalityTimeoutSeconds,
    recoveryTransaction,
    acceptanceTransaction,
  });
};

export const parseESpaceMainnetSafeConfig = (options = {}) =>
  parseProductionMainnetSafeConfig({ ...options, chainProfile: ESPACE_CHAIN_PROFILE });

export const parseEthereumMainnetSafeConfig = (options = {}) =>
  parseProductionMainnetSafeConfig({ ...options, chainProfile: ETHEREUM_CHAIN_PROFILE });

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

const normalizeCanonicalInfrastructure = (
  canonicalInfrastructure,
  chainProfile = ESPACE_CHAIN_PROFILE,
) => {
  if (
    !canonicalInfrastructure ||
    typeof canonicalInfrastructure !== "object" ||
    Array.isArray(canonicalInfrastructure)
  ) {
    throw new Error("canonicalInfrastructure must be a Safe infrastructure inspection");
  }
  const chainId = normalizeChainId(canonicalInfrastructure.chainId, chainProfile);
  let rpcChainId;
  try {
    rpcChainId = BigInt(canonicalInfrastructure.rpcChainId);
  } catch {
    throw new Error(
      `canonicalInfrastructure.rpcChainId must identify chainId ${chainProfile.mainnet.chainId}`,
    );
  }
  if (rpcChainId !== chainProfile.mainnet.chainId) {
    throw new Error(
      `canonicalInfrastructure.rpcChainId must identify chainId ${chainProfile.mainnet.chainId}`,
    );
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
  chainProfile: explicitChainProfile = getChainProfile(
    config?.chainProfileId ?? ESPACE_CHAIN_PROFILE.id,
  ),
  releaseCommit,
  safeToolInputs,
  deployerNonce,
  predictedSafeAddress,
  deploymentTransaction,
  canonicalInfrastructure,
}) => {
  if (!config || typeof config !== "object") {
    throw new Error("A parsed production mainnet Safe config is required");
  }
  const chainProfile = explicitChainProfile;
  const mainnet = chainProfile.mainnet;
  if (!GIT_COMMIT_PATTERN.test(String(releaseCommit ?? ""))) {
    throw new Error("releaseCommit must be a 40- or 64-character hexadecimal Git commit");
  }
  const normalizedToolInputs = normalizeSafeToolInputs(safeToolInputs);
  const normalizedDeployerNonce = parseNonnegativeInteger("deployerNonce", deployerNonce);
  const normalizedPredictedSafeAddress = requiredAddress(
    "predictedSafeAddress",
    predictedSafeAddress,
  );
  const infrastructure = normalizeCanonicalInfrastructure(canonicalInfrastructure, chainProfile);
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

  const normalizedOwners = parseExpectedSafeOwners(
    [...config.expectedSafeOwners].join(","),
    mainnet.safeOwnersEnvironmentName,
  );
  const expectedDeployer = requiredAddress("config.expectedDeployer", config.expectedDeployer);
  if (normalizedOwners.some((owner) => owner.toLowerCase() === expectedDeployer.toLowerCase())) {
    throw new Error("config.expectedDeployer must not be one of the Safe owners");
  }
  const saltNonce = parseSaltNonce(config.saltNonce, mainnet.safeSaltNonceEnvironmentName);
  if (config.networkName !== mainnet.networkName) {
    throw new Error(`config.networkName must be ${mainnet.networkName}`);
  }
  const configChainId = normalizeChainId(config.chainId, chainProfile);
  if (config.governanceMultisigProfile !== chainProfile.governanceMultisigProfile) {
    throw new Error(
      `config.governanceMultisigProfile must be ${chainProfile.governanceMultisigProfile}`,
    );
  }
  const confirmations = parseInteger("config.confirmations", config.confirmations, 2, 2, 100);
  const finalityTimeoutSeconds = parseInteger(
    "config.finalityTimeoutSeconds",
    config.finalityTimeoutSeconds,
    3600,
    60,
    604_800,
  );
  const maximumCostWei = parseNonnegativeInteger("config.maximumCostWei", config.maximumCostWei);
  if (BigInt(maximumCostWei) <= 0n || BigInt(maximumCostWei) > ethers.MaxUint256) {
    throw new Error("config.maximumCostWei must be a positive uint256 amount");
  }

  return deepFreeze(
    canonicalize({
      schemaVersion: MAINNET_SAFE_STATE_SCHEMA_VERSION,
      domain: mainnet.safePlanDigestDomain,
      chainProfileId: chainProfile.id,
      network: {
        name: mainnet.networkName,
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
        profile: chainProfile.governanceMultisigProfile,
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
        nativeSymbol: chainProfile.nativeSymbol,
        gasChargingPolicy: mainnet.gasChargingPolicy,
        maximumCostWei,
      },
    }),
  );
};

export const deriveMainnetSafePlanDigest = (fingerprint) =>
  ethers.keccak256(
    ethers.toUtf8Bytes(
      `${fingerprint?.domain ?? ESPACE_MAINNET_SAFE_PLAN_DIGEST_DOMAIN}:` +
        canonicalMainnetSafePlanJson(fingerprint),
    ),
  );

export const assertMainnetSafePlanMatchesCheckpoint = ({ checkpoint, fingerprint, planDigest }) => {
  if (!checkpoint || checkpoint.schemaVersion !== MAINNET_SAFE_STATE_SCHEMA_VERSION) {
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
