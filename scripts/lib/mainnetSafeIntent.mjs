/**
 * Shared canonical Safe creation-intent validation.
 */
import { ethers as checkpointEthers } from "ethers";

import {
  CANONICAL_SAFE_DEPLOYMENT_TYPE,
  CANONICAL_SAFE_THRESHOLD,
  CANONICAL_SAFE_VERSION,
  getCanonicalSafeDeploymentMetadata,
  normalizeSafeOwners,
  normalizeSafeSaltNonce,
} from "./safeGovernance.mjs";

const SAFE_CREATION_LABEL = "createGovernanceSafe";
const CREATE_PROXY_SIGNATURE = "createProxyWithNonce(address,bytes,uint256)";
const SAFE_SETUP_SIGNATURE =
  "setup(address[],uint256,address,bytes,address,address,uint256,address)";

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const sameAddress = (left, right) =>
  String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();

const requiredNonzeroAddress = (ethers, name, value) => {
  if (!ethers.isAddress(value) || sameAddress(value, ethers.ZeroAddress)) {
    throw new Error(`${name} must be a nonzero EVM address`);
  }
  return ethers.getAddress(value);
};

const requiredSafeInteger = (name, value) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value;
};

const requiredUint = (name, value) => {
  let normalized;
  try {
    normalized = BigInt(value);
  } catch {
    throw new Error(`${name} must be a non-negative integer`);
  }
  if (normalized < 0n) throw new Error(`${name} must be a non-negative integer`);
  return normalized;
};

const requiredHexData = (ethers, name, value) => {
  if (!ethers.isHexString(value)) {
    throw new Error(`${name} must be a 0x-prefixed hexadecimal value`);
  }
  return ethers.hexlify(value);
};

const assertAddress = (ethers, name, actual, expected) => {
  const normalized = requiredNonzeroAddress(ethers, name, actual);
  if (!sameAddress(normalized, expected)) {
    throw new Error(`${name} differs from the canonical Safe deployment metadata`);
  }
  return normalized;
};

const assertZeroAddress = (ethers, name, value) => {
  if (!ethers.isAddress(value) || !sameAddress(value, ethers.ZeroAddress)) {
    throw new Error(`${name} must be the zero address`);
  }
  return ethers.ZeroAddress;
};

const normalizeChainId = (chainId) => {
  let normalized;
  try {
    normalized = BigInt(chainId);
  } catch {
    throw new Error(`Safe creation chainId is invalid: ${String(chainId)}`);
  }
  if (normalized <= 0n) throw new Error("Safe creation chainId must be positive");
  return normalized;
};

const assertComponentMetadata = ({ ethers, name, actual, expected }) => {
  if (!actual || typeof actual !== "object") {
    throw new Error(`Prepared Safe ${name} metadata is missing`);
  }
  assertAddress(ethers, `Prepared Safe ${name} address`, actual.address, expected.address);
  if (
    !ethers.isHexString(actual.codeHash, 32) ||
    actual.codeHash.toLowerCase() !== expected.codeHash.toLowerCase()
  ) {
    throw new Error(`Prepared Safe ${name} codeHash differs from canonical metadata`);
  }
  if (actual.version !== expected.version || actual.contractName !== expected.contractName) {
    throw new Error(`Prepared Safe ${name} identity differs from canonical metadata`);
  }
};

const assertPreparedMetadata = ({ ethers, preparedMetadata, canonicalMetadata, chainId }) => {
  if (!preparedMetadata || typeof preparedMetadata !== "object") {
    throw new Error("Prepared Safe canonical metadata is missing");
  }
  if (requiredUint("Prepared Safe metadata chainId", preparedMetadata.chainId) !== chainId) {
    throw new Error("Prepared Safe metadata chainId differs from the requested network");
  }
  if (
    preparedMetadata.safeVersion !== CANONICAL_SAFE_VERSION ||
    preparedMetadata.safeVersion !== canonicalMetadata.safeVersion
  ) {
    throw new Error("Prepared Safe version differs from the pinned canonical version");
  }
  if (
    preparedMetadata.deploymentType !== CANONICAL_SAFE_DEPLOYMENT_TYPE ||
    preparedMetadata.deploymentType !== canonicalMetadata.deploymentType
  ) {
    throw new Error("Prepared Safe deployment type is not canonical");
  }
  for (const name of ["singleton", "proxyFactory", "fallbackHandler"]) {
    assertComponentMetadata({
      ethers,
      name,
      actual: preparedMetadata[name],
      expected: canonicalMetadata[name],
    });
  }
};

const assertCanonicalInfrastructure = ({
  ethers,
  canonicalInfrastructure,
  canonicalMetadata,
  chainId,
}) => {
  if (!canonicalInfrastructure || typeof canonicalInfrastructure !== "object") {
    throw new Error("Canonical Safe infrastructure evidence is required");
  }
  if (
    requiredUint("Canonical Safe infrastructure chainId", canonicalInfrastructure.chainId) !==
      chainId ||
    requiredUint(
      "Canonical Safe infrastructure raw RPC chainId",
      canonicalInfrastructure.rpcChainId,
    ) !== chainId
  ) {
    throw new Error("Canonical Safe infrastructure evidence belongs to a different network");
  }
  for (const name of ["singleton", "proxyFactory", "fallbackHandler"]) {
    const evidence = canonicalInfrastructure.components?.[name];
    const expected = canonicalMetadata[name];
    if (!evidence || typeof evidence !== "object") {
      throw new Error(`Canonical Safe ${name} infrastructure evidence is missing`);
    }
    assertAddress(
      ethers,
      `Canonical Safe ${name} infrastructure address`,
      evidence.address,
      expected.address,
    );
    for (const field of ["expectedCodeHash", "actualCodeHash"]) {
      if (
        !ethers.isHexString(evidence[field], 32) ||
        evidence[field].toLowerCase() !== expected.codeHash.toLowerCase()
      ) {
        throw new Error(
          `Canonical Safe ${name} infrastructure ${field} does not match canonical metadata`,
        );
      }
    }
    if (evidence.matched !== true) {
      throw new Error(`Canonical Safe ${name} infrastructure was not code-hash verified`);
    }
  }
  if (!ethers.isHexString(canonicalInfrastructure.canonicalProxyCodeHash, 32)) {
    throw new Error("Canonical Safe proxy runtime codeHash evidence is malformed");
  }
};

const parseExactCall = ({ ethers, abi, data, value = 0n, signature, description }) => {
  const contractInterface = new ethers.Interface(abi);
  let parsed;
  try {
    parsed = contractInterface.parseTransaction({ data, value });
  } catch {
    throw new Error(`${description} calldata cannot be decoded`);
  }
  if (!parsed || parsed.signature !== signature) {
    throw new Error(`${description} must call ${signature}`);
  }
  const canonicalData = contractInterface.encodeFunctionData(parsed.fragment, parsed.args);
  if (canonicalData.toLowerCase() !== data.toLowerCase()) {
    throw new Error(`${description} calldata is not canonically encoded`);
  }
  return parsed;
};

const assertOrderedOwners = (ethers, actualOwners, expectedOwners, source) => {
  if (!Array.isArray(actualOwners) && typeof actualOwners?.length !== "number") {
    throw new Error(`${source} owners are malformed`);
  }
  const actual = Array.from(actualOwners, (owner, index) =>
    requiredNonzeroAddress(ethers, `${source} owners[${index}]`, owner),
  );
  if (
    actual.length !== expectedOwners.length ||
    actual.some((owner, index) => !sameAddress(owner, expectedOwners[index]))
  ) {
    throw new Error(`${source} owners differ from the reviewed owner order`);
  }
  return actual;
};

const assertPreparedAccountConfig = ({ ethers, accountConfig, orderedOwners, fallbackHandler }) => {
  if (!accountConfig || typeof accountConfig !== "object") {
    throw new Error("Prepared Safe account config is missing");
  }
  assertOrderedOwners(ethers, accountConfig.owners, orderedOwners, "Prepared Safe account config");
  if (requiredUint("Prepared Safe account threshold", accountConfig.threshold) !== 2n) {
    throw new Error("Prepared Safe account threshold must be 2");
  }
  assertZeroAddress(ethers, "Prepared Safe account setup target", accountConfig.to);
  if (requiredHexData(ethers, "Prepared Safe account setup data", accountConfig.data) !== "0x") {
    throw new Error("Prepared Safe account setup data must be empty");
  }
  assertAddress(
    ethers,
    "Prepared Safe account fallback handler",
    accountConfig.fallbackHandler,
    fallbackHandler,
  );
  assertZeroAddress(ethers, "Prepared Safe account payment token", accountConfig.paymentToken);
  if (requiredUint("Prepared Safe account payment", accountConfig.payment) !== 0n) {
    throw new Error("Prepared Safe account payment must be zero");
  }
  assertZeroAddress(
    ethers,
    "Prepared Safe account payment receiver",
    accountConfig.paymentReceiver,
  );
};

/**
 * Decodes and validates the exact factory/setup calldata produced by Protocol Kit before it is
 * fingerprinted or persisted. Safe creation is a call to ProxyFactory, so predictedAddress stays
 * null in the generic transaction intent; predictedSafeAddress is bound separately.
 */
export const buildAndValidateSafeCreationIntent = ({
  ethers,
  preparedSafe,
  expectedDeployer,
  deployerNonce,
  chainId,
  orderedOwners,
  saltNonce,
  canonicalInfrastructure,
}) => {
  if (!ethers || typeof ethers.Interface !== "function") {
    throw new Error("Safe creation intent requires ethers");
  }
  if (!preparedSafe || typeof preparedSafe !== "object") {
    throw new Error("Prepared Safe deployment is required");
  }

  const normalizedChainId = normalizeChainId(chainId);
  const canonicalMetadata = getCanonicalSafeDeploymentMetadata(normalizedChainId);
  const normalizedDeployer = requiredNonzeroAddress(
    ethers,
    "Expected Safe deployer",
    expectedDeployer,
  );
  const normalizedNonce = requiredSafeInteger("Safe deployer nonce", deployerNonce);
  const normalizedOwners = [...normalizeSafeOwners(orderedOwners)];
  const normalizedSaltNonce = normalizeSafeSaltNonce(saltNonce);
  const predictedSafeAddress = requiredNonzeroAddress(
    ethers,
    "Predicted governance Safe",
    preparedSafe.safeAddress,
  );

  assertPreparedMetadata({
    ethers,
    preparedMetadata: preparedSafe.metadata,
    canonicalMetadata,
    chainId: normalizedChainId,
  });
  assertCanonicalInfrastructure({
    ethers,
    canonicalInfrastructure,
    canonicalMetadata,
    chainId: normalizedChainId,
  });
  assertPreparedAccountConfig({
    ethers,
    accountConfig: preparedSafe.safeAccountConfig,
    orderedOwners: normalizedOwners,
    fallbackHandler: canonicalMetadata.fallbackHandler.address,
  });
  if (!preparedSafe.safeDeploymentConfig || typeof preparedSafe.safeDeploymentConfig !== "object") {
    throw new Error("Prepared Safe deployment config is missing");
  }
  if (normalizeSafeSaltNonce(preparedSafe.safeDeploymentConfig.saltNonce) !== normalizedSaltNonce) {
    throw new Error("Prepared Safe deployment salt nonce differs from the reviewed salt nonce");
  }
  if (
    preparedSafe.safeDeploymentConfig.safeVersion !== CANONICAL_SAFE_VERSION ||
    preparedSafe.safeDeploymentConfig.deploymentType !== CANONICAL_SAFE_DEPLOYMENT_TYPE
  ) {
    throw new Error("Prepared Safe deployment config is not the pinned canonical profile");
  }

  const deployment = preparedSafe.deploymentTransaction;
  if (!deployment || typeof deployment !== "object") {
    throw new Error("Prepared Safe deployment transaction is missing");
  }
  const factoryAddress = assertAddress(
    ethers,
    "Safe deployment factory",
    deployment.to,
    canonicalMetadata.proxyFactory.address,
  );
  if (requiredUint("Safe deployment value", deployment.value ?? 0n) !== 0n) {
    throw new Error("Safe deployment factory call value must be zero");
  }
  const factoryData = requiredHexData(ethers, "Safe deployment factory calldata", deployment.data);
  if (factoryData === "0x") throw new Error("Safe deployment factory calldata cannot be empty");

  const factoryCall = parseExactCall({
    ethers,
    abi: canonicalMetadata.proxyFactory.abi,
    data: factoryData,
    value: 0n,
    signature: CREATE_PROXY_SIGNATURE,
    description: "Safe ProxyFactory deployment",
  });
  const singleton = assertAddress(
    ethers,
    "Safe factory singleton",
    factoryCall.args[0],
    canonicalMetadata.singleton.address,
  );
  const initializer = requiredHexData(ethers, "Safe initializer", factoryCall.args[1]);
  if (initializer === "0x") throw new Error("Safe initializer cannot be empty");
  if (normalizeSafeSaltNonce(factoryCall.args[2]) !== normalizedSaltNonce) {
    throw new Error("Safe factory salt nonce differs from the reviewed salt nonce");
  }

  const setupCall = parseExactCall({
    ethers,
    abi: canonicalMetadata.singleton.abi,
    data: initializer,
    signature: SAFE_SETUP_SIGNATURE,
    description: "Safe initializer",
  });
  const setupOwners = assertOrderedOwners(
    ethers,
    setupCall.args[0],
    normalizedOwners,
    "Safe initializer",
  );
  if (requiredUint("Safe initializer threshold", setupCall.args[1]) !== 2n) {
    throw new Error("Safe initializer threshold must be 2");
  }
  const setupTarget = assertZeroAddress(
    ethers,
    "Safe initializer delegatecall target",
    setupCall.args[2],
  );
  const setupData = requiredHexData(
    ethers,
    "Safe initializer delegatecall data",
    setupCall.args[3],
  );
  if (setupData !== "0x") {
    throw new Error("Safe initializer delegatecall data must be empty");
  }
  const fallbackHandler = assertAddress(
    ethers,
    "Safe initializer fallback handler",
    setupCall.args[4],
    canonicalMetadata.fallbackHandler.address,
  );
  const paymentToken = assertZeroAddress(
    ethers,
    "Safe initializer payment token",
    setupCall.args[5],
  );
  if (requiredUint("Safe initializer payment", setupCall.args[6]) !== 0n) {
    throw new Error("Safe initializer payment must be zero");
  }
  const paymentReceiver = assertZeroAddress(
    ethers,
    "Safe initializer payment receiver",
    setupCall.args[7],
  );

  const intent = {
    label: SAFE_CREATION_LABEL,
    kind: "call",
    nonce: normalizedNonce,
    from: normalizedDeployer,
    chainId: normalizedChainId.toString(),
    to: factoryAddress,
    value: "0",
    data: factoryData,
    dataHash: ethers.keccak256(factoryData).toLowerCase(),
    predictedAddress: null,
  };
  const decodedSetup = {
    proxyFactory: factoryAddress,
    singleton,
    initializer,
    initializerHash: ethers.keccak256(initializer).toLowerCase(),
    owners: setupOwners,
    threshold: CANONICAL_SAFE_THRESHOLD.toString(),
    to: setupTarget,
    data: setupData,
    fallbackHandler,
    paymentToken,
    payment: "0",
    paymentReceiver,
    saltNonce: normalizedSaltNonce,
  };
  return deepFreeze({ intent, predictedSafeAddress, decodedSetup });
};

const assertCheckpointAddress = (ethers, name, actual, expected) => {
  if (!ethers.isAddress(actual) || !sameAddress(actual, expected)) {
    throw new Error(`${name} differs from the immutable Safe creation intent`);
  }
};

/**
 * Rejects checkpoint adoption unless its sole journal entry and address evidence exactly match the
 * reviewed Safe factory call. This prevents an unrelated or direct CREATE transaction from being
 * resumed under the Safe creator's checkpoint.
 */
export const assertSafeCreationCheckpointIntent = ({
  checkpoint,
  intent,
  predictedSafeAddress,
}) => {
  if (!checkpoint || typeof checkpoint !== "object") {
    throw new Error("Safe creation checkpoint is required");
  }
  if (!intent || typeof intent !== "object") {
    throw new Error("Immutable Safe creation intent is required");
  }
  if (intent.label !== SAFE_CREATION_LABEL || intent.kind !== "call") {
    throw new Error("Immutable Safe creation intent label or kind is invalid");
  }
  if (intent.predictedAddress !== null) {
    throw new Error("Safe factory call intent predictedAddress must be null");
  }

  const normalizedSafeAddress = requiredNonzeroAddress(
    checkpointEthers,
    "Predicted governance Safe",
    predictedSafeAddress,
  );
  const transactions = checkpoint.transactions;
  if (!transactions || typeof transactions !== "object" || Array.isArray(transactions)) {
    throw new Error("Safe creation checkpoint transaction journal is missing");
  }
  const labels = Object.keys(transactions);
  if (labels.length !== 1 || labels[0] !== SAFE_CREATION_LABEL) {
    throw new Error("Safe creation checkpoint must contain only createGovernanceSafe");
  }
  const entry = transactions[SAFE_CREATION_LABEL];
  if (!entry || typeof entry !== "object" || !entry.request) {
    throw new Error("Safe creation checkpoint journal entry is malformed");
  }

  const ethers = checkpointEthers;
  const expectedFrom = requiredNonzeroAddress(ethers, "Safe creation intent sender", intent.from);
  const expectedTo = requiredNonzeroAddress(ethers, "Safe creation intent target", intent.to);
  const expectedNonce = requiredSafeInteger("Safe creation intent nonce", intent.nonce);
  const expectedChainId = normalizeChainId(intent.chainId);
  const expectedValue = requiredUint("Safe creation intent value", intent.value);
  const expectedData = requiredHexData(ethers, "Safe creation intent calldata", intent.data);
  const expectedDataHash = ethers.keccak256(expectedData).toLowerCase();
  if (
    !ethers.isHexString(intent.dataHash, 32) ||
    intent.dataHash.toLowerCase() !== expectedDataHash
  ) {
    throw new Error("Safe creation intent dataHash does not match its calldata");
  }
  if (entry.label !== SAFE_CREATION_LABEL || entry.kind !== "call") {
    throw new Error("Safe creation checkpoint label or kind differs from the immutable intent");
  }
  assertCheckpointAddress(ethers, "Safe creation checkpoint sender", entry.from, expectedFrom);
  if (entry.predictedAddress !== null) {
    throw new Error("Safe factory call checkpoint predictedAddress must be null");
  }
  if (
    !ethers.isHexString(entry.dataHash, 32) ||
    entry.dataHash.toLowerCase() !== expectedDataHash
  ) {
    throw new Error("Safe creation checkpoint dataHash differs from the immutable intent");
  }

  const request = entry.request;
  assertCheckpointAddress(ethers, "Safe creation checkpoint target", request.to, expectedTo);
  if (request.nonce !== expectedNonce) {
    throw new Error("Safe creation checkpoint nonce differs from the immutable intent");
  }
  if (normalizeChainId(request.chainId) !== expectedChainId) {
    throw new Error("Safe creation checkpoint chainId differs from the immutable intent");
  }
  if (requiredUint("Safe creation checkpoint value", request.value) !== expectedValue) {
    throw new Error("Safe creation checkpoint value differs from the immutable intent");
  }
  const requestData = requiredHexData(ethers, "Safe creation checkpoint calldata", request.data);
  if (requestData.toLowerCase() !== expectedData.toLowerCase()) {
    throw new Error("Safe creation checkpoint calldata differs from the immutable intent");
  }

  assertCheckpointAddress(
    ethers,
    "Safe creation checkpoint safeAddress",
    checkpoint.safeAddress,
    normalizedSafeAddress,
  );
  if (!checkpoint.addresses || typeof checkpoint.addresses !== "object") {
    throw new Error("Safe creation checkpoint addresses are missing");
  }
  assertCheckpointAddress(
    ethers,
    "Safe creation checkpoint deployer address",
    checkpoint.addresses.deployer,
    expectedFrom,
  );
  assertCheckpointAddress(
    ethers,
    "Safe creation checkpoint governance Safe address",
    checkpoint.addresses.governanceSafe,
    normalizedSafeAddress,
  );

  return deepFreeze({
    label: SAFE_CREATION_LABEL,
    deployer: expectedFrom,
    nonce: expectedNonce,
    chainId: expectedChainId.toString(),
    dataHash: expectedDataHash,
    safeAddress: normalizedSafeAddress,
  });
};
