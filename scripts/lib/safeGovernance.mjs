import Safe from "@safe-global/protocol-kit";
import {
  getCompatibilityFallbackHandlerDeployment,
  getProxyFactoryDeployment,
  getSafeL2SingletonDeployment,
} from "@safe-global/safe-deployments";
import { OperationType, SigningMethod } from "@safe-global/types-kit";
import { ethers } from "ethers";

export const CANONICAL_SAFE_VERSION = "1.3.0";
export const CANONICAL_SAFE_DEPLOYMENT_TYPE = "canonical";
export const CANONICAL_SAFE_OWNER_COUNT = 3;
export const CANONICAL_SAFE_THRESHOLD = 2;
export const CONFLUX_ESPACE_TESTNET_CHAIN_ID = 71n;
export const CONFLUX_ESPACE_MAINNET_CHAIN_ID = 1030n;
export const SAFE_SENTINEL_ADDRESS = "0x0000000000000000000000000000000000000001";
export const SAFE_FALLBACK_HANDLER_STORAGE_SLOT = ethers.id("fallback_manager.handler.address");
export const SAFE_GUARD_STORAGE_SLOT = ethers.id("guard_manager.guard.address");

const SUPPORTED_CHAIN_IDS = new Set([
  CONFLUX_ESPACE_TESTNET_CHAIN_ID,
  CONFLUX_ESPACE_MAINNET_CHAIN_ID,
]);
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL_INTEGER_PATTERN = /^[0-9]+$/;
const COMPONENT_ACCESSORS = Object.freeze({
  singleton: getSafeL2SingletonDeployment,
  proxyFactory: getProxyFactoryDeployment,
  fallbackHandler: getCompatibilityFallbackHandlerDeployment,
});
const metadataCache = new Map();

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
};

const normalizeChainId = (chainId) => {
  let normalized;
  try {
    normalized = BigInt(chainId);
  } catch {
    throw new Error(`Safe chainId is invalid: ${String(chainId)}`);
  }
  if (!SUPPORTED_CHAIN_IDS.has(normalized)) {
    throw new Error(
      `Canonical Safe ${CANONICAL_SAFE_VERSION} governance is restricted to Conflux eSpace ` +
        `chainIds 71 and 1030; got ${normalized}`,
    );
  }
  return normalized;
};

const normalizeNonzeroAddress = (name, value) => {
  if (!ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${name} must be a valid nonzero EVM address`);
  }
  return ethers.getAddress(value);
};

const sameAddress = (left, right) => left.toLowerCase() === right.toLowerCase();

const cloneAbi = (abi) => JSON.parse(JSON.stringify(abi));

const resolveCanonicalComponent = ({ accessor, componentName, chainId }) => {
  const network = chainId.toString();
  const deployment = accessor({ version: CANONICAL_SAFE_VERSION, network });
  if (!deployment) {
    throw new Error(
      `Official Safe deployment metadata is missing ${componentName} v${CANONICAL_SAFE_VERSION} ` +
        `for Conflux eSpace chainId ${network}`,
    );
  }
  if (!deployment.released || deployment.version !== CANONICAL_SAFE_VERSION) {
    throw new Error(`Official Safe ${componentName} metadata is not the released pinned version`);
  }

  const canonical = deployment.deployments?.[CANONICAL_SAFE_DEPLOYMENT_TYPE];
  if (
    !canonical ||
    !ethers.isAddress(canonical.address) ||
    !ethers.isHexString(canonical.codeHash, 32)
  ) {
    throw new Error(`Official Safe ${componentName} canonical metadata is malformed`);
  }

  const networkAddress = deployment.networkAddresses?.[network];
  if (typeof networkAddress !== "string" || !sameAddress(networkAddress, canonical.address)) {
    throw new Error(
      `Official Safe ${componentName} deployment for chainId ${network} is not canonical`,
    );
  }

  return {
    contractName: deployment.contractName,
    version: deployment.version,
    address: ethers.getAddress(canonical.address),
    codeHash: canonical.codeHash.toLowerCase(),
    abi: cloneAbi(deployment.abi),
  };
};

/**
 * Returns the official Safe deployment manifest pinned by this project.
 * Both Conflux eSpace networks intentionally resolve to the same canonical contracts.
 */
export const getCanonicalSafeDeploymentMetadata = (chainId) => {
  const normalizedChainId = normalizeChainId(chainId);
  const cacheKey = normalizedChainId.toString();
  if (!metadataCache.has(cacheKey)) {
    const components = Object.fromEntries(
      Object.entries(COMPONENT_ACCESSORS).map(([componentName, accessor]) => [
        componentName,
        resolveCanonicalComponent({ accessor, componentName, chainId: normalizedChainId }),
      ]),
    );
    metadataCache.set(
      cacheKey,
      deepFreeze({
        chainId: normalizedChainId,
        safeVersion: CANONICAL_SAFE_VERSION,
        deploymentType: CANONICAL_SAFE_DEPLOYMENT_TYPE,
        ...components,
      }),
    );
  }
  return metadataCache.get(cacheKey);
};

/** Adapts an ethers/Hardhat provider to the EIP-1193 shape required by Protocol Kit. */
export const asEip1193Provider = (provider) => {
  if (!provider || typeof provider !== "object") {
    throw new Error("Safe provider must be an EIP-1193 or ethers provider object");
  }
  if (typeof provider.request === "function") {
    return provider;
  }
  if (typeof provider.send !== "function") {
    throw new Error("Safe provider must expose request(args) or send(method, params)");
  }
  return Object.freeze({
    request: async ({ method, params = [] }) => {
      if (typeof method !== "string" || method.length === 0) {
        throw new Error("EIP-1193 request method must be a non-empty string");
      }
      if (!Array.isArray(params)) {
        throw new Error("Ethers provider adapter requires request params to be an array");
      }
      return provider.send(method, params);
    },
  });
};

const asEthersProvider = (provider) => {
  if (
    provider &&
    typeof provider.getNetwork === "function" &&
    typeof provider.getCode === "function"
  ) {
    return provider;
  }
  return new ethers.BrowserProvider(asEip1193Provider(provider), "any");
};

const assertProviderChain = async (provider, expectedChainId) => {
  const network = await asEthersProvider(provider).getNetwork();
  if (network.chainId !== expectedChainId) {
    throw new Error(
      `Safe provider chainId mismatch: expected ${expectedChainId}, got ${network.chainId}`,
    );
  }
};

export const normalizeSafeOwners = (owners) => {
  if (!Array.isArray(owners) || owners.length !== CANONICAL_SAFE_OWNER_COUNT) {
    throw new Error(
      `Canonical governance Safe requires exactly ${CANONICAL_SAFE_OWNER_COUNT} owners`,
    );
  }
  const normalized = owners.map((owner, index) =>
    normalizeNonzeroAddress(`owners[${index}]`, owner),
  );
  if (new Set(normalized.map((owner) => owner.toLowerCase())).size !== normalized.length) {
    throw new Error("Canonical governance Safe owners must be distinct");
  }
  return Object.freeze(normalized);
};

export const normalizeSafeSaltNonce = (saltNonce) => {
  let raw;
  if (typeof saltNonce === "bigint") {
    raw = saltNonce.toString();
  } else if (typeof saltNonce === "number") {
    if (!Number.isSafeInteger(saltNonce) || saltNonce < 0) {
      throw new Error("Safe saltNonce must be a non-negative base-10 integer");
    }
    raw = String(saltNonce);
  } else {
    raw = String(saltNonce ?? "").trim();
  }
  if (!DECIMAL_INTEGER_PATTERN.test(raw)) {
    throw new Error("Safe saltNonce must be a non-negative base-10 integer");
  }
  return BigInt(raw).toString();
};

export const buildCanonicalSafeAccountConfig = ({ chainId, owners }) => {
  const metadata = getCanonicalSafeDeploymentMetadata(chainId);
  return deepFreeze({
    owners: [...normalizeSafeOwners(owners)],
    threshold: CANONICAL_SAFE_THRESHOLD,
    to: ethers.ZeroAddress,
    data: "0x",
    fallbackHandler: metadata.fallbackHandler.address,
    paymentToken: ethers.ZeroAddress,
    payment: 0,
    paymentReceiver: ethers.ZeroAddress,
  });
};

export const buildCanonicalSafeDeploymentConfig = ({ saltNonce }) =>
  Object.freeze({
    saltNonce: normalizeSafeSaltNonce(saltNonce),
    safeVersion: CANONICAL_SAFE_VERSION,
    deploymentType: CANONICAL_SAFE_DEPLOYMENT_TYPE,
  });

/**
 * Predicts a 2-of-3 Safe and returns the exact canonical factory deployment transaction.
 * The caller/relayer sends deploymentTransaction; owner keys are not needed for deployment.
 */
export const prepareCanonicalSafeDeployment = async ({ provider, chainId, owners, saltNonce }) => {
  const normalizedChainId = normalizeChainId(chainId);
  const safeAccountConfig = buildCanonicalSafeAccountConfig({
    chainId: normalizedChainId,
    owners,
  });
  const safeDeploymentConfig = buildCanonicalSafeDeploymentConfig({ saltNonce });
  await assertProviderChain(provider, normalizedChainId);

  const safe = await Safe.init({
    provider: asEip1193Provider(provider),
    isL1SafeSingleton: false,
    predictedSafe: { safeAccountConfig, safeDeploymentConfig },
  });
  if (safe.getContractVersion() !== CANONICAL_SAFE_VERSION) {
    throw new Error(`Protocol Kit did not select Safe v${CANONICAL_SAFE_VERSION}`);
  }

  const metadata = getCanonicalSafeDeploymentMetadata(normalizedChainId);
  const safeAddress = normalizeNonzeroAddress("predicted Safe address", await safe.getAddress());
  const rawDeploymentTransaction = await safe.createSafeDeploymentTransaction();
  const deploymentTransaction = Object.freeze({
    to: normalizeNonzeroAddress("Safe deployment target", rawDeploymentTransaction.to),
    value: BigInt(rawDeploymentTransaction.value),
    data: ethers.hexlify(rawDeploymentTransaction.data),
  });
  if (!sameAddress(deploymentTransaction.to, metadata.proxyFactory.address)) {
    throw new Error(
      "Protocol Kit Safe deployment transaction does not target the canonical factory",
    );
  }
  if (deploymentTransaction.value !== 0n || deploymentTransaction.data === "0x") {
    throw new Error("Protocol Kit returned a malformed Safe deployment transaction");
  }

  return Object.freeze({
    safe,
    safeAddress,
    deploymentTransaction,
    safeAccountConfig,
    safeDeploymentConfig,
    metadata,
  });
};

const normalizePrivateKey = (privateKey) => {
  const value = String(privateKey ?? "").trim();
  if (!PRIVATE_KEY_PATTERN.test(value)) {
    throw new Error("Safe owner private key must contain 0x followed by 64 hexadecimal characters");
  }
  return new ethers.Wallet(value).privateKey;
};

export const connectCanonicalSafe = async ({ provider, chainId, safeAddress, signer }) => {
  const normalizedChainId = normalizeChainId(chainId);
  const normalizedSafeAddress = normalizeNonzeroAddress("safeAddress", safeAddress);
  const normalizedSigner = signer === undefined ? undefined : normalizePrivateKey(signer);
  await assertProviderChain(provider, normalizedChainId);
  const safe = await Safe.init({
    provider: asEip1193Provider(provider),
    ...(normalizedSigner === undefined ? {} : { signer: normalizedSigner }),
    isL1SafeSingleton: false,
    safeAddress: normalizedSafeAddress,
  });
  if (safe.getContractVersion() !== CANONICAL_SAFE_VERSION) {
    throw new Error(
      `Governance Safe version mismatch: expected ${CANONICAL_SAFE_VERSION}, got ${safe.getContractVersion()}`,
    );
  }
  if ((await safe.getChainId()) !== normalizedChainId) {
    throw new Error("Protocol Kit connected to the wrong Safe chainId");
  }
  return safe;
};

const normalizeUint = (name, value) => {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  let normalized;
  try {
    normalized = BigInt(value);
  } catch {
    throw new Error(`${name} must be a non-negative integer`);
  }
  if (normalized < 0n) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return normalized;
};

const normalizeNonceOption = (nonce) => {
  if (nonce === undefined) return undefined;
  const normalized = normalizeUint("Safe nonce", nonce);
  if (normalized > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Safe nonce exceeds the Protocol Kit safe-integer range");
  }
  return Number(normalized);
};

/** Creates one CALL-only governance transaction with Protocol Kit's canonical gas fields. */
export const createCanonicalSafeTransaction = async ({
  safe,
  target,
  value = 0n,
  data = "0x",
  nonce,
}) => {
  if (
    !safe ||
    typeof safe.createTransaction !== "function" ||
    typeof safe.getTransactionHash !== "function"
  ) {
    throw new Error("A connected Protocol Kit Safe instance is required");
  }
  const normalizedTarget = normalizeNonzeroAddress("Safe transaction target", target);
  const normalizedValue = normalizeUint("Safe transaction value", value);
  if (!ethers.isHexString(data)) {
    throw new Error("Safe transaction data must be a 0x-prefixed hexadecimal value");
  }
  const normalizedData = ethers.hexlify(data);
  const normalizedNonce = normalizeNonceOption(nonce);
  const safeTransaction = await safe.createTransaction({
    transactions: [
      {
        to: normalizedTarget,
        value: normalizedValue.toString(),
        data: normalizedData,
        operation: OperationType.Call,
      },
    ],
    ...(normalizedNonce === undefined ? {} : { options: { nonce: normalizedNonce } }),
  });
  const safeTxHash = await safe.getTransactionHash(safeTransaction);
  if (!ethers.isHexString(safeTxHash, 32)) {
    throw new Error("Protocol Kit returned an invalid Safe transaction hash");
  }
  return Object.freeze({ safeTransaction, safeTxHash: safeTxHash.toLowerCase() });
};

/**
 * Adds local EIP-712 signatures and returns execTransaction calldata for an unprivileged relayer.
 * Private keys never leave Protocol Kit and are never returned.
 */
export const signCanonicalSafeTransaction = async ({
  provider,
  chainId,
  safeAddress,
  safeTransaction,
  signerPrivateKeys,
}) => {
  if (!(safeTransaction?.signatures instanceof Map) || safeTransaction.signatures.size !== 0) {
    throw new Error("Safe transaction must be an unsigned Protocol Kit transaction");
  }
  if (
    !Array.isArray(signerPrivateKeys) ||
    signerPrivateKeys.length < 1 ||
    signerPrivateKeys.length > 3
  ) {
    throw new Error("Safe signing requires between one and three owner private keys");
  }
  const privateKeys = signerPrivateKeys.map(normalizePrivateKey);
  const signerAddresses = privateKeys.map((privateKey) => new ethers.Wallet(privateKey).address);
  if (
    new Set(signerAddresses.map((address) => address.toLowerCase())).size !== signerAddresses.length
  ) {
    throw new Error("Safe signer private keys must be distinct");
  }

  let signedTransaction = safeTransaction;
  let signingSafe;
  for (const privateKey of privateKeys) {
    signingSafe = await connectCanonicalSafe({
      provider,
      chainId,
      safeAddress,
      signer: privateKey,
    });
    signedTransaction = await signingSafe.signTransaction(
      signedTransaction,
      SigningMethod.ETH_SIGN_TYPED_DATA_V4,
    );
  }
  if (signedTransaction.signatures.size !== signerAddresses.length) {
    throw new Error("Protocol Kit did not preserve the expected number of distinct signatures");
  }

  const safeTxHash = await signingSafe.getTransactionHash(signedTransaction);
  const encodedTransaction = await signingSafe.getEncodedTransaction(signedTransaction);
  if (!ethers.isHexString(encodedTransaction) || encodedTransaction === "0x") {
    throw new Error("Protocol Kit returned invalid Safe execTransaction calldata");
  }
  return Object.freeze({
    safeTransaction: signedTransaction,
    safeTxHash: safeTxHash.toLowerCase(),
    encodedTransaction,
    signerAddresses: Object.freeze([...signerAddresses]),
  });
};

export const createCanonicalSafeInterface = (chainId) =>
  new ethers.Interface(getCanonicalSafeDeploymentMetadata(chainId).singleton.abi);

/**
 * A relayed Safe transaction can have receipt status 1 while the inner call failed.
 * Treat only the expected ExecutionSuccess event as success and reject ExecutionFailure.
 */
export const assertSafeExecutionSuccess = ({ receipt, safeAddress, safeTxHash, chainId }) => {
  if (!receipt || Number(receipt.status) !== 1 || !Array.isArray(receipt.logs)) {
    throw new Error("Safe execution receipt is missing or reverted");
  }
  const normalizedSafeAddress = normalizeNonzeroAddress("safeAddress", safeAddress);
  if (!ethers.isHexString(safeTxHash, 32)) {
    throw new Error("safeTxHash must be a 32-byte hexadecimal value");
  }
  const normalizedSafeTxHash = safeTxHash.toLowerCase();
  const safeInterface = createCanonicalSafeInterface(chainId);
  const executionEvents = [];
  for (const log of receipt.logs) {
    if (!ethers.isAddress(log.address) || !sameAddress(log.address, normalizedSafeAddress))
      continue;
    try {
      const parsed = safeInterface.parseLog(log);
      if (parsed?.name === "ExecutionSuccess" || parsed?.name === "ExecutionFailure") {
        executionEvents.push(parsed);
      }
    } catch {
      // A Safe transaction can include other Safe-address logs; only execution events matter here.
    }
  }

  const failures = executionEvents.filter(
    (event) =>
      event.name === "ExecutionFailure" &&
      String(event.args.txHash).toLowerCase() === normalizedSafeTxHash,
  );
  if (failures.length > 0) {
    throw new Error(`Safe emitted ExecutionFailure for ${normalizedSafeTxHash}`);
  }
  const successes = executionEvents.filter(
    (event) =>
      event.name === "ExecutionSuccess" &&
      String(event.args.txHash).toLowerCase() === normalizedSafeTxHash,
  );
  if (successes.length !== 1) {
    throw new Error(
      `Expected exactly one Safe ExecutionSuccess for ${normalizedSafeTxHash}; got ${successes.length}`,
    );
  }
  if (executionEvents.length !== 1) {
    throw new Error("Safe receipt contains unexpected additional execution result events");
  }
  return Object.freeze({
    safeTxHash: normalizedSafeTxHash,
    payment: BigInt(successes[0].args.payment),
  });
};

const addressFromStorageWord = (name, word) => {
  if (!ethers.isHexString(word, 32)) {
    throw new Error(`${name} storage word is malformed`);
  }
  return ethers.getAddress(ethers.dataSlice(word, 12));
};

const assertCanonicalComponentCode = async ({ provider, componentName, component }) => {
  const code = await provider.getCode(component.address);
  if (!ethers.isHexString(code) || code === "0x") {
    throw new Error(`Canonical Safe ${componentName} has no deployed bytecode`);
  }
  const actualCodeHash = ethers.keccak256(code).toLowerCase();
  if (actualCodeHash !== component.codeHash) {
    throw new Error(
      `Canonical Safe ${componentName} codeHash mismatch: expected ${component.codeHash}, got ${actualCodeHash}`,
    );
  }
  return actualCodeHash;
};

/**
 * Compares a Safe account proxy with the runtime bytecode returned by the already code-hash-pinned
 * canonical ProxyFactory. Interface/configuration checks alone are insufficient because a custom
 * contract could imitate VERSION/getOwners/getThreshold while implementing malicious execution.
 */
export const assertCanonicalSafeProxyRuntime = ({ proxyCode, canonicalRuntimeCode }) => {
  if (!ethers.isHexString(proxyCode) || proxyCode === "0x") {
    throw new Error("Governance Safe proxy has no valid deployed bytecode");
  }
  if (!ethers.isHexString(canonicalRuntimeCode) || canonicalRuntimeCode === "0x") {
    throw new Error("Canonical Safe ProxyFactory returned invalid proxy runtime bytecode");
  }
  const proxyCodeHash = ethers.keccak256(proxyCode).toLowerCase();
  const canonicalProxyCodeHash = ethers.keccak256(canonicalRuntimeCode).toLowerCase();
  if (proxyCodeHash !== canonicalProxyCodeHash) {
    throw new Error(
      `Governance Safe proxy runtime codeHash mismatch: expected ${canonicalProxyCodeHash}, ` +
        `got ${proxyCodeHash}`,
    );
  }
  return Object.freeze({ proxyCodeHash, canonicalProxyCodeHash });
};

/** Verifies the freshly deployed account and every security-relevant Safe extension on-chain. */
export const assertCanonicalSafeProfile = async ({
  provider,
  chainId,
  safeAddress,
  expectedOwners,
  expectedNonce,
}) => {
  const normalizedChainId = normalizeChainId(chainId);
  const normalizedSafeAddress = normalizeNonzeroAddress("safeAddress", safeAddress);
  const normalizedOwners = normalizeSafeOwners(expectedOwners);
  const normalizedExpectedNonce =
    expectedNonce === undefined ? undefined : normalizeUint("expected Safe nonce", expectedNonce);
  const ethersProvider = asEthersProvider(provider);
  await assertProviderChain(ethersProvider, normalizedChainId);
  const metadata = getCanonicalSafeDeploymentMetadata(normalizedChainId);

  const componentCodeHashes = {};
  for (const componentName of ["singleton", "proxyFactory", "fallbackHandler"]) {
    componentCodeHashes[componentName] = await assertCanonicalComponentCode({
      provider: ethersProvider,
      componentName,
      component: metadata[componentName],
    });
  }

  const proxyCode = await ethersProvider.getCode(normalizedSafeAddress);
  const proxyFactory = new ethers.Contract(
    metadata.proxyFactory.address,
    metadata.proxyFactory.abi,
    ethersProvider,
  );
  const canonicalProxyRuntimeCode = await proxyFactory.proxyRuntimeCode();
  const { proxyCodeHash, canonicalProxyCodeHash } = assertCanonicalSafeProxyRuntime({
    proxyCode,
    canonicalRuntimeCode: canonicalProxyRuntimeCode,
  });

  const safeContract = new ethers.Contract(
    normalizedSafeAddress,
    [...metadata.singleton.abi, "function masterCopy() view returns (address)"],
    ethersProvider,
  );
  // Keep profile inspection friendly to rate-limited public RPCs. This runs during deployment,
  // operational tasks and terminal acceptance checks, where reliability matters more than a small
  // latency saving from a burst of concurrent eth_call requests.
  const version = await safeContract.VERSION();
  const masterCopy = await safeContract.masterCopy();
  const owners = await safeContract.getOwners();
  const threshold = await safeContract.getThreshold();
  const nonce = await safeContract.nonce();
  const modulesPage = await safeContract.getModulesPaginated(SAFE_SENTINEL_ADDRESS, 10);
  const fallbackWord = await ethersProvider.getStorage(
    normalizedSafeAddress,
    SAFE_FALLBACK_HANDLER_STORAGE_SLOT,
  );
  const guardWord = await ethersProvider.getStorage(normalizedSafeAddress, SAFE_GUARD_STORAGE_SLOT);

  if (version !== CANONICAL_SAFE_VERSION) {
    throw new Error(
      `Governance Safe VERSION mismatch: expected ${CANONICAL_SAFE_VERSION}, got ${version}`,
    );
  }
  if (!sameAddress(masterCopy, metadata.singleton.address)) {
    throw new Error("Governance Safe proxy does not use the canonical L2 singleton");
  }
  const normalizedActualOwners = owners.map((owner) => ethers.getAddress(owner));
  if (
    normalizedActualOwners.length !== normalizedOwners.length ||
    normalizedOwners.some(
      (owner) => !normalizedActualOwners.some((actualOwner) => sameAddress(owner, actualOwner)),
    )
  ) {
    throw new Error("Governance Safe owners do not match the expected 3-owner set");
  }
  if (BigInt(threshold) !== BigInt(CANONICAL_SAFE_THRESHOLD)) {
    throw new Error(`Governance Safe threshold must be ${CANONICAL_SAFE_THRESHOLD}`);
  }
  if (normalizedExpectedNonce !== undefined && BigInt(nonce) !== normalizedExpectedNonce) {
    throw new Error(
      `Governance Safe nonce mismatch: expected ${normalizedExpectedNonce}, got ${BigInt(nonce)}`,
    );
  }

  const modules = [...modulesPage[0]].map((module) => ethers.getAddress(module));
  const modulesNext = ethers.getAddress(modulesPage[1]);
  if (modules.length !== 0 || !sameAddress(modulesNext, SAFE_SENTINEL_ADDRESS)) {
    throw new Error("Governance Safe must not have any enabled modules");
  }
  const fallbackHandler = addressFromStorageWord("Safe fallback handler", fallbackWord);
  const guard = addressFromStorageWord("Safe guard", guardWord);
  if (!sameAddress(fallbackHandler, metadata.fallbackHandler.address)) {
    throw new Error("Governance Safe fallback handler is not the canonical compatibility handler");
  }
  if (guard !== ethers.ZeroAddress) {
    throw new Error("Governance Safe must not have an enabled guard");
  }

  return deepFreeze({
    chainId: normalizedChainId,
    safeAddress: normalizedSafeAddress,
    safeVersion: version,
    singleton: ethers.getAddress(masterCopy),
    owners: normalizedActualOwners,
    threshold: Number(threshold),
    nonce: BigInt(nonce),
    modules,
    guard,
    fallbackHandler,
    proxyCodeHash,
    canonicalProxyCodeHash,
    componentCodeHashes,
  });
};
