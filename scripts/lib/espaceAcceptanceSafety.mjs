import { setTimeout as sleep } from "node:timers/promises";
import { ethers } from "ethers";

export const ESPACE_TESTNET_NAME = "confluxTestnet";
export const ESPACE_TESTNET_CHAIN_ID = 71n;
export const ESPACE_E2E_CONFIRMATION = "conflux-testnet-chain-71";
export const ESPACE_MULTISIG_DOMAIN_NAME = "DeepFamily E2E Testnet Multisig";
export const ESPACE_MULTISIG_DOMAIN_VERSION = "1";

export const ESPACE_MULTISIG_EXECUTE_TYPES = Object.freeze({
  Execute: Object.freeze([
    Object.freeze({ name: "target", type: "address" }),
    Object.freeze({ name: "value", type: "uint256" }),
    Object.freeze({ name: "dataHash", type: "bytes32" }),
    Object.freeze({ name: "nonce", type: "uint256" }),
  ]),
});

const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;
const DECIMAL_CFX_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/;
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

export const sanitizeRunId = (value) => {
  const runId = String(value ?? "").trim();
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(
      "ESPACE_E2E_RUN_ID must be 8-80 characters using only letters, digits, '_' or '-', " +
        "and must start with a letter or digit",
    );
  }
  return runId;
};

export const hashRunId = (runId) =>
  ethers.keccak256(
    ethers.toUtf8Bytes(`deepfamily:espace-acceptance:run-id:${sanitizeRunId(runId)}`),
  );

export const runIdReportFileComponent = (runId) => hashRunId(runId).slice(2, 34);

export const parseESpaceAcceptanceConfig = ({ env = process.env, networkName, chainId } = {}) => {
  if (networkName !== ESPACE_TESTNET_NAME) {
    throw new Error(
      `eSpace acceptance is restricted to network ${ESPACE_TESTNET_NAME}; got ${
        networkName || "unknown"
      }`,
    );
  }

  let normalizedChainId;
  try {
    normalizedChainId = BigInt(chainId);
  } catch {
    throw new Error(`eSpace acceptance requires chainId 71; got ${String(chainId)}`);
  }
  if (normalizedChainId !== ESPACE_TESTNET_CHAIN_ID) {
    throw new Error(`eSpace acceptance requires chainId 71; got ${normalizedChainId}`);
  }

  if (env.ESPACE_E2E_CONFIRM !== ESPACE_E2E_CONFIRMATION) {
    throw new Error(
      `Set ESPACE_E2E_CONFIRM=${ESPACE_E2E_CONFIRMATION} to authorize testnet transactions`,
    );
  }

  const minDelaySeconds = parseInteger("ESPACE_E2E_MIN_DELAY", env.ESPACE_E2E_MIN_DELAY, 30, 10);
  const confirmations = parseInteger(
    "ESPACE_E2E_CONFIRMATIONS",
    env.ESPACE_E2E_CONFIRMATIONS,
    2,
    1,
  );
  if (minDelaySeconds > 86_400) {
    throw new Error("ESPACE_E2E_MIN_DELAY must not exceed 86400 seconds");
  }
  if (confirmations > 100) {
    throw new Error("ESPACE_E2E_CONFIRMATIONS must not exceed 100");
  }
  const verify = parseBooleanFlag("ESPACE_E2E_VERIFY", env.ESPACE_E2E_VERIFY, "1");
  const recover = parseBooleanFlag("ESPACE_E2E_RECOVER", env.ESPACE_E2E_RECOVER, "0");

  const rawMaxCfx = String(env.ESPACE_E2E_MAX_CFX ?? "5").trim();
  if (!DECIMAL_CFX_PATTERN.test(rawMaxCfx)) {
    throw new Error("ESPACE_E2E_MAX_CFX must be a positive plain decimal with at most 18 decimals");
  }
  const maxCfxWei = ethers.parseEther(rawMaxCfx);
  if (maxCfxWei <= 0n) {
    throw new Error("ESPACE_E2E_MAX_CFX must be greater than zero");
  }

  const configuredRunId = String(env.ESPACE_E2E_RUN_ID ?? "").trim();
  const runId = configuredRunId === "" ? null : sanitizeRunId(configuredRunId);
  if (recover && runId === null) {
    throw new Error("ESPACE_E2E_RECOVER=1 requires ESPACE_E2E_RUN_ID");
  }

  return Object.freeze({
    networkName,
    chainId: normalizedChainId,
    minDelaySeconds,
    confirmations,
    verify,
    recover,
    maxCfx: rawMaxCfx,
    maxCfxWei,
    runId,
    runIdHash: runId === null ? null : hashRunId(runId),
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

const deriveScalar = (basePrivateKey, runId, label) => {
  const digest = ethers.keccak256(
    ethers.concat([
      ethers.getBytes(basePrivateKey),
      ethers.toUtf8Bytes(`deepfamily:espace-acceptance:v1:${runId}:${label}`),
    ]),
  );
  const scalar = (BigInt(digest) % (SECP256K1_ORDER - 1n)) + 1n;
  return ethers.zeroPadValue(ethers.toBeHex(scalar), 32);
};

export const deriveAcceptanceWallet = ({ basePrivateKey, runId, label, provider = null }) => {
  const normalizedKey = normalizeBasePrivateKey(basePrivateKey);
  const normalizedRunId = sanitizeRunId(runId);
  if (!/^[a-z][a-z0-9-]{2,40}$/.test(String(label ?? ""))) {
    throw new Error("Acceptance wallet label is invalid");
  }
  return new ethers.Wallet(deriveScalar(normalizedKey, normalizedRunId, label), provider);
};

export const deriveAcceptanceWallets = ({ basePrivateKey, runId, provider = null }) => {
  const normalizedKey = normalizeBasePrivateKey(basePrivateKey);
  const normalizedRunId = sanitizeRunId(runId);
  const baseAddress = new ethers.Wallet(normalizedKey).address;
  const wallets = {
    runDeployer: deriveAcceptanceWallet({
      basePrivateKey: normalizedKey,
      runId: normalizedRunId,
      label: "run-deployer",
      provider,
    }),
    ownerA: deriveAcceptanceWallet({
      basePrivateKey: normalizedKey,
      runId: normalizedRunId,
      label: "multisig-owner-a",
      provider,
    }),
    ownerB: deriveAcceptanceWallet({
      basePrivateKey: normalizedKey,
      runId: normalizedRunId,
      label: "multisig-owner-b",
      provider,
    }),
    ownerC: deriveAcceptanceWallet({
      basePrivateKey: normalizedKey,
      runId: normalizedRunId,
      label: "multisig-owner-c",
      provider,
    }),
  };
  const addresses = [baseAddress, ...Object.values(wallets).map((wallet) => wallet.address)];
  if (new Set(addresses.map((address) => address.toLowerCase())).size !== addresses.length) {
    throw new Error("Acceptance wallet derivation produced duplicate addresses");
  }
  return Object.freeze(wallets);
};

const assertAddress = (name, value) => {
  if (!ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${name} must be a valid nonzero EVM address`);
  }
  return ethers.getAddress(value);
};

export const buildMultisigExecuteTypedData = ({
  chainId,
  multisigAddress,
  target,
  value = 0n,
  data,
  nonce,
}) => {
  const normalizedChainId = BigInt(chainId);
  if (normalizedChainId !== ESPACE_TESTNET_CHAIN_ID) {
    throw new Error(`Multisig acceptance signatures require chainId 71; got ${normalizedChainId}`);
  }
  const normalizedData = ethers.hexlify(data);
  const normalizedValue = BigInt(value);
  const normalizedNonce = BigInt(nonce);
  if (normalizedValue < 0n || normalizedNonce < 0n) {
    throw new Error("Multisig value and nonce must be non-negative");
  }

  return Object.freeze({
    domain: Object.freeze({
      name: ESPACE_MULTISIG_DOMAIN_NAME,
      version: ESPACE_MULTISIG_DOMAIN_VERSION,
      chainId: normalizedChainId,
      verifyingContract: assertAddress("multisigAddress", multisigAddress),
    }),
    types: ESPACE_MULTISIG_EXECUTE_TYPES,
    message: Object.freeze({
      target: assertAddress("target", target),
      value: normalizedValue,
      dataHash: ethers.keccak256(normalizedData),
      nonce: normalizedNonce,
    }),
  });
};

export const signMultisigExecute = async ({ wallets, ...execute }) => {
  if (!Array.isArray(wallets) || wallets.length < 2 || wallets.length > 3) {
    throw new Error("Exactly two or three acceptance owner wallets are required");
  }
  const ownerAddresses = await Promise.all(wallets.map((wallet) => wallet.getAddress()));
  const distinctOwnerAddresses = new Set(ownerAddresses.map((address) => address.toLowerCase()));
  if (distinctOwnerAddresses.size !== ownerAddresses.length) {
    throw new Error("Acceptance owner wallets must be distinct");
  }
  const typedData = buildMultisigExecuteTypedData(execute);
  const signatures = await Promise.all(
    wallets.map((wallet) =>
      wallet.signTypedData(typedData.domain, typedData.types, typedData.message),
    ),
  );
  return { typedData, signatures };
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
