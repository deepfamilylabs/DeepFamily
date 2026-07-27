/**
 * Shared checkpoint and transaction-state helpers for guarded EVM mainnet commands.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { ethers } from "ethers";

import {
  GAS_CHARGING_CONFLUX_THREE_QUARTER,
  GAS_CHARGING_ETHEREUM_RECEIPT,
} from "./chainProfiles.mjs";

const nowIso = () => new Date().toISOString();

export const writeJsonAtomic = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify(value, (_key, child) => (typeof child === "bigint" ? child.toString() : child), 2)}\n`,
    { mode: 0o600 },
  );
  await fs.rename(temporaryPath, filePath);
  await fs.chmod(filePath, 0o600);
};

export const readJsonIfExists = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

export const acquireReleaseLock = async (lockPath, details = {}, lockLabel = "Mainnet release") => {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await fs.open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        `${lockLabel} lock already exists at ${lockPath}. Confirm no production process is ` +
          "running before removing a stale lock manually.",
      );
    }
    throw error;
  }
  await handle.writeFile(
    `${JSON.stringify({ pid: process.pid, createdAt: nowIso(), ...details }, null, 2)}\n`,
  );
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await handle.close();
    await fs.unlink(lockPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  };
};

const receiptEvidence = (receipt, gasCharged) => ({
  hash: receipt.hash,
  blockNumber: Number(receipt.blockNumber),
  blockHash: receipt.blockHash,
  status: Number(receipt.status),
  contractAddress: receipt.contractAddress ?? null,
  gasUsed: receipt.gasUsed.toString(),
  gasCharged: gasCharged.toString(),
  gasPrice: (receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0n).toString(),
});

const requestEvidence = (request) => ({
  to: request.to == null ? null : ethers.getAddress(request.to),
  data: ethers.hexlify(request.data ?? "0x"),
  value: BigInt(request.value ?? 0n).toString(),
  nonce: Number(request.nonce),
  chainId: BigInt(request.chainId).toString(),
  gasLimit: BigInt(request.gasLimit).toString(),
  type: request.type == null ? null : Number(request.type),
  gasPrice: request.gasPrice == null ? null : BigInt(request.gasPrice).toString(),
  maxFeePerGas: request.maxFeePerGas == null ? null : BigInt(request.maxFeePerGas).toString(),
  maxPriorityFeePerGas:
    request.maxPriorityFeePerGas == null ? null : BigInt(request.maxPriorityFeePerGas).toString(),
  accessList: request.accessList ?? null,
});

const hydrateRequest = (request) =>
  Object.fromEntries(
    Object.entries({
      to: request.to,
      data: request.data,
      value: BigInt(request.value),
      nonce: request.nonce,
      chainId: BigInt(request.chainId),
      gasLimit: BigInt(request.gasLimit),
      type: request.type,
      gasPrice: request.gasPrice == null ? undefined : BigInt(request.gasPrice),
      maxFeePerGas: request.maxFeePerGas == null ? undefined : BigInt(request.maxFeePerGas),
      maxPriorityFeePerGas:
        request.maxPriorityFeePerGas == null ? undefined : BigInt(request.maxPriorityFeePerGas),
      accessList: request.accessList ?? undefined,
    }).filter(([, value]) => value !== null && value !== undefined),
  );

const maximumTransactionCost = (request) => {
  const feePerGas = request.maxFeePerGas ?? request.gasPrice;
  if (feePerGas == null || feePerGas <= 0n) {
    throw new Error("RPC did not populate a positive gas price or maxFeePerGas");
  }
  if (request.gasLimit == null || request.gasLimit <= 0n) {
    throw new Error("RPC did not populate a positive gasLimit");
  }
  return request.gasLimit * feePerGas + BigInt(request.value ?? 0n);
};

const sameAddress = (left, right) =>
  String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();

const sameNullableAddress = (left, right) => {
  if (left == null || right == null) return left == null && right == null;
  return sameAddress(left, right);
};

const normalizeExpectedIntents = (expectedIntents) => {
  const raw = Array.isArray(expectedIntents)
    ? expectedIntents
    : Object.entries(expectedIntents ?? {}).map(([label, intent]) => ({ ...intent, label }));
  const result = new Map();
  for (const intent of raw) {
    if (!intent || typeof intent !== "object" || typeof intent.label !== "string") {
      throw new Error("Every expected mainnet release intent must have a label");
    }
    if (result.has(intent.label)) {
      throw new Error(`Duplicate expected mainnet release intent: ${intent.label}`);
    }
    if (intent.kind !== "deployment" && intent.kind !== "call") {
      throw new Error(`${intent.label} expected intent kind is invalid`);
    }
    if (!Number.isSafeInteger(intent.nonce) || intent.nonce < 0) {
      throw new Error(`${intent.label} expected intent nonce is invalid`);
    }
    const from = ethers.getAddress(intent.from);
    if (from === ethers.ZeroAddress) {
      throw new Error(`${intent.label} expected intent sender cannot be zero`);
    }
    const chainId = BigInt(intent.chainId);
    if (chainId <= 0n) throw new Error(`${intent.label} expected intent chainId is invalid`);
    const to = intent.to == null ? null : ethers.getAddress(intent.to);
    if (intent.kind === "deployment" && to !== null) {
      throw new Error(`${intent.label} deployment intent target must be null`);
    }
    if (intent.kind === "call" && to === null) {
      throw new Error(`${intent.label} call intent target must be an address`);
    }
    const data = ethers.hexlify(intent.data);
    const dataHash = ethers.keccak256(data);
    if (String(intent.dataHash).toLowerCase() !== dataHash.toLowerCase()) {
      throw new Error(`${intent.label} expected intent dataHash does not match its calldata`);
    }
    const predictedAddress =
      intent.predictedAddress == null ? null : ethers.getAddress(intent.predictedAddress);
    const canonicalPrediction =
      intent.kind === "deployment" ? ethers.getCreateAddress({ from, nonce: intent.nonce }) : null;
    if (!sameNullableAddress(predictedAddress, canonicalPrediction)) {
      throw new Error(`${intent.label} expected intent predictedAddress is invalid`);
    }
    const value = BigInt(intent.value ?? 0n);
    if (value < 0n) throw new Error(`${intent.label} expected intent value cannot be negative`);
    result.set(
      intent.label,
      Object.freeze({
        label: intent.label,
        kind: intent.kind,
        nonce: intent.nonce,
        from,
        chainId: chainId.toString(),
        to,
        value: value.toString(),
        data,
        dataHash,
        predictedAddress,
      }),
    );
  }
  return result;
};

const assertRequestCoreMatches = ({ actual, expected, label, source }) => {
  if (!actual) throw new Error(`${label} ${source} is unavailable`);
  const actualTo = actual.to == null ? null : ethers.getAddress(actual.to);
  if (!sameNullableAddress(actualTo, expected.to)) {
    throw new Error(`${label} ${source} target differs from the immutable release intent`);
  }
  const actualData = ethers.hexlify(actual.data ?? "0x");
  if (actualData.toLowerCase() !== expected.data.toLowerCase()) {
    throw new Error(`${label} ${source} calldata differs from the immutable release intent`);
  }
  if (BigInt(actual.value ?? 0n) !== BigInt(expected.value)) {
    throw new Error(`${label} ${source} value differs from the immutable release intent`);
  }
};

const assertEntryMatchesExpectedIntent = ({ entry, expected, label, signerAddress }) => {
  if (!expected) throw new Error(`${label} is not present in the immutable release intent plan`);
  if (entry.label !== label || entry.kind !== expected.kind) {
    throw new Error(`${label} checkpoint label or kind differs from the immutable release intent`);
  }
  if (!sameAddress(entry.from, expected.from) || !sameAddress(entry.from, signerAddress)) {
    throw new Error(`${label} checkpoint sender differs from the immutable release intent`);
  }
  if (entry.request?.nonce !== expected.nonce) {
    throw new Error(`${label} checkpoint nonce differs from the immutable release intent`);
  }
  if (BigInt(entry.request?.chainId) !== BigInt(expected.chainId)) {
    throw new Error(`${label} checkpoint chainId differs from the immutable release intent`);
  }
  assertRequestCoreMatches({
    actual: entry.request,
    expected,
    label,
    source: "checkpoint request",
  });
  if (String(entry.dataHash).toLowerCase() !== expected.dataHash.toLowerCase()) {
    throw new Error(`${label} checkpoint dataHash differs from the immutable release intent`);
  }
  if (!sameNullableAddress(entry.predictedAddress, expected.predictedAddress)) {
    throw new Error(
      `${label} checkpoint predictedAddress differs from the immutable release intent`,
    );
  }
};

const assertTransactionMatchesPlan = ({ transaction, planned, signerAddress, label }) => {
  if (!transaction) throw new Error(`${label} transaction is unavailable from the RPC`);
  if (!sameAddress(transaction.from, signerAddress)) {
    throw new Error(`${label} transaction sender does not match the release deployer`);
  }
  if (Number(transaction.nonce) !== planned.request.nonce) {
    throw new Error(`${label} transaction nonce does not match its checkpoint plan`);
  }
  if (!sameAddress(transaction.to, planned.request.to)) {
    throw new Error(`${label} transaction target does not match its checkpoint plan`);
  }
  if (ethers.hexlify(transaction.data).toLowerCase() !== planned.request.data.toLowerCase()) {
    throw new Error(`${label} transaction calldata does not match its checkpoint plan`);
  }
  if (BigInt(transaction.value) !== BigInt(planned.request.value)) {
    throw new Error(`${label} transaction value does not match its checkpoint plan`);
  }
  if (BigInt(transaction.chainId) !== BigInt(planned.request.chainId)) {
    throw new Error(`${label} transaction chainId does not match its checkpoint plan`);
  }
  if (BigInt(transaction.gasLimit) !== BigInt(planned.request.gasLimit)) {
    throw new Error(`${label} transaction gasLimit does not match its checkpoint plan`);
  }
};

const canonicalReceipt = async ({ provider, entry, confirmations, timeoutMs, label }) => {
  let receipt = await provider.getTransactionReceipt(entry.hash);
  if (!receipt) {
    receipt = await provider.waitForTransaction(entry.hash, confirmations, timeoutMs);
  } else if (confirmations > 1) {
    const latest = await provider.getBlockNumber();
    const observed = latest - Number(receipt.blockNumber) + 1;
    if (observed < confirmations) {
      receipt = await provider.waitForTransaction(entry.hash, confirmations, timeoutMs);
    }
  }
  if (!receipt) throw new Error(`${label} transaction was not confirmed before the timeout`);
  if (Number(receipt.status) !== 1) throw new Error(`${label} transaction reverted`);
  if (entry.receipt) {
    if (
      Number(entry.receipt.blockNumber) !== Number(receipt.blockNumber) ||
      String(entry.receipt.blockHash).toLowerCase() !== String(receipt.blockHash).toLowerCase()
    ) {
      throw new Error(`${label} confirmed receipt changed; refusing to continue after a reorg`);
    }
  }
  if (entry.kind === "deployment") {
    if (!receipt.contractAddress || !sameAddress(receipt.contractAddress, entry.predictedAddress)) {
      throw new Error(`${label} deployed at an address different from its checkpoint prediction`);
    }
    if ((await provider.getCode(receipt.contractAddress)) === "0x") {
      throw new Error(`${label} has no runtime code at ${receipt.contractAddress}`);
    }
  }
  const block = await provider.getBlock(receipt.blockNumber);
  if (!block || String(block.hash).toLowerCase() !== String(receipt.blockHash).toLowerCase()) {
    throw new Error(`${label} receipt is not in the canonical block at its recorded height`);
  }
  return receipt;
};

const parseNonNegativeWei = (value, field) => {
  let parsed;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${field} is not a valid wei amount`);
  }
  if (parsed < 0n) throw new Error(`${field} cannot be negative`);
  return parsed;
};

const checkpointMaximumCost = ({ entry, label }) => {
  if (!entry.request) throw new Error(`${label} checkpoint request is missing`);
  let recomputed;
  try {
    recomputed = maximumTransactionCost({
      gasLimit: BigInt(entry.request.gasLimit),
      gasPrice: entry.request.gasPrice == null ? null : BigInt(entry.request.gasPrice),
      maxFeePerGas: entry.request.maxFeePerGas == null ? null : BigInt(entry.request.maxFeePerGas),
      value: BigInt(entry.request.value ?? 0n),
    });
  } catch (error) {
    throw new Error(`${label} checkpoint fee reservation is invalid: ${error.message}`);
  }
  const recorded = parseNonNegativeWei(entry.maximumCostWei, `${label} checkpoint maximumCostWei`);
  if (recorded !== recomputed) {
    throw new Error(
      `${label} checkpoint maximumCostWei ${recorded} does not match recomputed ` +
        `${recomputed} wei`,
    );
  }
  const data = ethers.hexlify(entry.request.data ?? "0x");
  if (String(entry.dataHash).toLowerCase() !== ethers.keccak256(data).toLowerCase()) {
    throw new Error(`${label} checkpoint dataHash does not match its checkpoint calldata`);
  }
  const predictedAddress =
    entry.kind === "deployment"
      ? ethers.getCreateAddress({ from: entry.from, nonce: entry.request.nonce })
      : null;
  if (!sameNullableAddress(entry.predictedAddress, predictedAddress)) {
    throw new Error(`${label} checkpoint predictedAddress is inconsistent`);
  }
  return recomputed;
};

const assertCheckpointReservations = ({
  checkpoint,
  maxCostWei,
  budgetEnvironmentName = "ESPACE_MAINNET_MAX_CFX",
  nativeSymbol = "CFX",
}) => {
  const cap =
    maxCostWei == null ? null : parseNonNegativeWei(maxCostWei, "mainnet release maxCostWei");
  const reserved = Object.entries(checkpoint.transactions ?? {}).reduce(
    (total, [label, entry]) => total + checkpointMaximumCost({ entry, label }),
    0n,
  );
  if (cap != null && reserved > cap) {
    throw new Error(
      `Checkpoint fee reservations exceed ${budgetEnvironmentName}: reserved ` +
        `${ethers.formatEther(reserved)} ${nativeSymbol}, cap ${ethers.formatEther(cap)} ` +
        nativeSymbol,
    );
  }
  return reserved;
};

export const chargedGasForReceipt = ({
  entry,
  receipt,
  gasChargingPolicy = GAS_CHARGING_CONFLUX_THREE_QUARTER,
}) => {
  const gasUsed = BigInt(receipt.gasUsed);
  if (gasChargingPolicy === GAS_CHARGING_ETHEREUM_RECEIPT) return gasUsed;
  if (gasChargingPolicy !== GAS_CHARGING_CONFLUX_THREE_QUARTER) {
    throw new Error(`Unsupported gas charging policy: ${String(gasChargingPolicy)}`);
  }
  const gasLimit = BigInt(entry.request.gasLimit);
  const threeQuarterGasFloor = (gasLimit * 3n + 3n) / 4n;
  return gasUsed > threeQuarterGasFloor ? gasUsed : threeQuarterGasFloor;
};

const canonicalActualCostWei = ({ entry, receipt, label, gasChargingPolicy }) => {
  const gasPrice = receipt.gasPrice ?? receipt.effectiveGasPrice;
  if (gasPrice == null) {
    throw new Error(`${label} confirmed receipt does not include an effective gas price`);
  }
  const gasCharged = chargedGasForReceipt({ entry, receipt, gasChargingPolicy });
  const actualCostWei = gasCharged * BigInt(gasPrice) + BigInt(entry.request?.value ?? 0n);
  const maximumCostWei = parseNonNegativeWei(
    entry.maximumCostWei,
    `${label} checkpoint maximumCostWei`,
  );
  if (actualCostWei > maximumCostWei) {
    throw new Error(
      `${label} actual cost ${actualCostWei} wei exceeds its checkpoint maximum ` +
        `${maximumCostWei} wei`,
    );
  }
  if (
    entry.actualCostWei != null &&
    parseNonNegativeWei(entry.actualCostWei, `${label} checkpoint actualCostWei`) !== actualCostWei
  ) {
    throw new Error(`${label} checkpoint actualCostWei does not match its canonical receipt`);
  }
  if (entry.receipt?.gasCharged != null && BigInt(entry.receipt.gasCharged) !== gasCharged) {
    throw new Error(`${label} checkpoint gasCharged does not match its canonical receipt`);
  }
  return { actualCostWei, gasCharged };
};

const assertCumulativeActualCost = ({
  checkpoint,
  canonicalCosts = new Map(),
  maxCostWei,
  budgetEnvironmentName = "ESPACE_MAINNET_MAX_CFX",
  nativeSymbol = "CFX",
}) => {
  if (maxCostWei == null) return;
  const cap = parseNonNegativeWei(maxCostWei, "mainnet release maxCostWei");
  const cumulativeActualCostWei = Object.entries(checkpoint.transactions ?? {}).reduce(
    (total, [label, entry]) => {
      const canonicalCost = canonicalCosts.get(label);
      if (canonicalCost != null) return total + canonicalCost;
      if (entry.actualCostWei == null) return total;
      return total + parseNonNegativeWei(entry.actualCostWei, `${label} checkpoint actualCostWei`);
    },
    0n,
  );
  if (cumulativeActualCostWei > cap) {
    throw new Error(
      `Confirmed transaction costs exceed ${budgetEnvironmentName}: actual ` +
        `${ethers.formatEther(cumulativeActualCostWei)} ${nativeSymbol}, cap ` +
        `${ethers.formatEther(cap)} ${nativeSymbol}`,
    );
  }
};

/**
 * Builds the transaction boundary used by the mainnet release. Every transaction is persisted as
 * planned before broadcast, then submitted and confirmed. A consumed planned nonce is never
 * resent; the operator must supply the original hash through the selected profile's recovery
 * environment variable.
 */
export const createCheckpointedTransactionExecutor = ({
  provider,
  signer,
  checkpoint,
  saveCheckpoint,
  maxCostWei,
  recoveryTransactions = {},
  expectedNonces = {},
  expectedIntents = {},
  budgetEnvironmentName = "ESPACE_MAINNET_MAX_CFX",
  recoveryEnvironmentName = "ESPACE_MAINNET_RECOVERY_TXS",
  nativeSymbol = "CFX",
  gasChargingPolicy = GAS_CHARGING_CONFLUX_THREE_QUARTER,
}) => {
  if (!provider || !signer || !checkpoint || typeof saveCheckpoint !== "function") {
    throw new Error(
      "Checkpointed executor requires provider, signer, checkpoint and saveCheckpoint",
    );
  }
  const releaseCostCap = parseNonNegativeWei(maxCostWei, "mainnet release maxCostWei");
  if (releaseCostCap === 0n) {
    throw new Error("mainnet release maxCostWei must be greater than zero");
  }
  checkpoint.transactions ??= {};
  const enforceExpectedNoncePlan = Object.keys(expectedNonces).length > 0;
  const expectedIntentPlan = normalizeExpectedIntents(expectedIntents);
  const enforceExpectedIntentPlan = expectedIntentPlan.size > 0;

  return async ({
    label,
    kind,
    transactionRequest,
    transactionConfirmations,
    transactionTimeoutMs,
  }) => {
    const signerAddress = ethers.getAddress(await signer.getAddress());
    let entry = checkpoint.transactions[label];
    const expectedIntent = expectedIntentPlan.get(label);
    if (enforceExpectedIntentPlan && !expectedIntent) {
      throw new Error(`${label} is not present in the immutable release intent plan`);
    }
    if (expectedIntent && !sameAddress(signerAddress, expectedIntent.from)) {
      throw new Error(`${label} signer differs from the immutable release intent`);
    }
    for (const [checkpointLabel, checkpointEntry] of Object.entries(checkpoint.transactions)) {
      if (enforceExpectedIntentPlan) {
        assertEntryMatchesExpectedIntent({
          entry: checkpointEntry,
          expected: expectedIntentPlan.get(checkpointLabel),
          label: checkpointLabel,
          signerAddress,
        });
      }
    }
    assertCheckpointReservations({
      checkpoint,
      maxCostWei: releaseCostCap,
      budgetEnvironmentName,
      nativeSymbol,
    });
    if (entry && entry.kind !== kind) {
      throw new Error(`${label} checkpoint kind changed from ${entry.kind} to ${kind}`);
    }
    if (expectedIntent && expectedIntent.kind !== kind) {
      throw new Error(`${label} transaction kind differs from the immutable release intent`);
    }
    if (enforceExpectedNoncePlan && !Object.hasOwn(expectedNonces, label)) {
      throw new Error(`${label} is not present in the immutable release transaction plan`);
    }
    const expectedNonce = expectedNonces[label];
    if (
      (expectedNonce !== undefined || enforceExpectedNoncePlan) &&
      (!Number.isSafeInteger(expectedNonce) || expectedNonce < 0)
    ) {
      throw new Error(`${label} expected nonce is invalid`);
    }
    if (expectedIntent && expectedNonce !== undefined && expectedIntent.nonce !== expectedNonce) {
      throw new Error(`${label} immutable nonce and intent plans disagree`);
    }
    if (entry && expectedNonce !== undefined && entry.request?.nonce !== expectedNonce) {
      throw new Error(`${label} checkpoint nonce differs from the immutable release plan`);
    }
    if (transactionRequest == null && !expectedIntent) {
      throw new Error(`${label} null transaction request requires an immutable release intent`);
    }
    if (transactionRequest != null) {
      assertRequestCoreMatches({
        actual: transactionRequest,
        expected: expectedIntent ?? {
          to: entry?.request?.to ?? transactionRequest.to ?? null,
          data: entry?.request?.data ?? ethers.hexlify(transactionRequest.data ?? "0x"),
          value: entry?.request?.value ?? BigInt(transactionRequest.value ?? 0n).toString(),
        },
        label,
        source: "transaction request",
      });
    }

    if (!entry) {
      if (transactionRequest == null) {
        throw new Error(`${label} cannot create a checkpoint from a null transaction request`);
      }
      const pendingNonce = await provider.getTransactionCount(signerAddress, "pending");
      const approvedNonce = expectedIntent?.nonce ?? expectedNonce;
      if (approvedNonce !== undefined && pendingNonce !== approvedNonce) {
        throw new Error(
          `${label} expected deployer nonce ${approvedNonce}, but the pending nonce is ` +
            `${pendingNonce}; refusing to consume an unapproved nonce`,
        );
      }
      if (expectedIntent) {
        const network = await provider.getNetwork();
        if (BigInt(network.chainId) !== BigInt(expectedIntent.chainId)) {
          throw new Error(`${label} connected chain differs from the immutable release intent`);
        }
      }
      const populatedBySigner = await signer.populateTransaction({
        ...transactionRequest,
        nonce: pendingNonce,
      });
      const hasExplicitGasLimit = transactionRequest.gasLimit != null;
      let gasLimit;
      if (hasExplicitGasLimit) {
        gasLimit = BigInt(transactionRequest.gasLimit);
      } else {
        const { gasLimit: _populatedGasLimit, ...requestToEstimate } = populatedBySigner;
        const estimatedGas = BigInt(await signer.estimateGas(requestToEstimate));
        gasLimit = (estimatedGas * 130n + 99n) / 100n;
      }
      let feeFields;
      if (populatedBySigner.maxFeePerGas != null) {
        feeFields = {
          maxFeePerGas: populatedBySigner.maxFeePerGas,
          maxPriorityFeePerGas: populatedBySigner.maxPriorityFeePerGas ?? 0n,
          gasPrice: undefined,
          type: populatedBySigner.type ?? 2,
        };
      } else if (populatedBySigner.gasPrice != null) {
        feeFields = {
          gasPrice: populatedBySigner.gasPrice,
          maxFeePerGas: undefined,
          maxPriorityFeePerGas: undefined,
          type: populatedBySigner.type,
        };
      } else {
        const feeData = await provider.getFeeData();
        if (feeData.maxFeePerGas != null) {
          feeFields = {
            maxFeePerGas: feeData.maxFeePerGas,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n,
            gasPrice: undefined,
            type: 2,
          };
        } else if (feeData.gasPrice != null) {
          feeFields = {
            gasPrice: feeData.gasPrice,
            maxFeePerGas: undefined,
            maxPriorityFeePerGas: undefined,
            type: populatedBySigner.type,
          };
        } else {
          throw new Error("RPC did not return a usable transaction fee quote");
        }
      }
      const populated = {
        ...populatedBySigner,
        chainId: populatedBySigner.chainId ?? (await provider.getNetwork()).chainId,
        gasLimit,
        ...feeFields,
      };
      const request = requestEvidence(populated);
      const maximumCostWei = maximumTransactionCost(populated);
      const alreadyReserved = Object.values(checkpoint.transactions).reduce(
        (total, item) => total + BigInt(item.maximumCostWei ?? 0),
        0n,
      );
      if (alreadyReserved + maximumCostWei > releaseCostCap) {
        throw new Error(
          `${label} would exceed ${budgetEnvironmentName}: reserved ` +
            `${ethers.formatEther(alreadyReserved + maximumCostWei)} ${nativeSymbol}, cap ` +
            `${ethers.formatEther(releaseCostCap)} ${nativeSymbol}`,
        );
      }
      entry = {
        label,
        kind,
        status: "planned",
        plannedAt: nowIso(),
        from: signerAddress,
        request,
        dataHash: ethers.keccak256(request.data),
        predictedAddress:
          kind === "deployment"
            ? ethers.getCreateAddress({ from: signerAddress, nonce: pendingNonce })
            : null,
        maximumCostWei: maximumCostWei.toString(),
        hash: null,
        receipt: null,
      };
      checkpoint.transactions[label] = entry;
      if (expectedIntent) {
        assertEntryMatchesExpectedIntent({
          entry,
          expected: expectedIntent,
          label,
          signerAddress,
        });
      }
      assertCheckpointReservations({
        checkpoint,
        maxCostWei: releaseCostCap,
        budgetEnvironmentName,
        nativeSymbol,
      });
      await saveCheckpoint();
    }

    if (entry.status === "planned") {
      assertCheckpointReservations({
        checkpoint,
        maxCostWei: releaseCostCap,
        budgetEnvironmentName,
        nativeSymbol,
      });
      const recoveredHash = recoveryTransactions[label];
      if (recoveredHash) {
        const recoveredTransaction = await provider.getTransaction(recoveredHash);
        assertTransactionMatchesPlan({
          transaction: recoveredTransaction,
          planned: entry,
          signerAddress,
          label,
        });
        entry.hash = recoveredHash;
        entry.status = "submitted";
        entry.submittedAt = nowIso();
        entry.recoveredHash = true;
        await saveCheckpoint();
      } else {
        const [latestNonce, pendingNonce] = await Promise.all([
          provider.getTransactionCount(signerAddress, "latest"),
          provider.getTransactionCount(signerAddress, "pending"),
        ]);
        if (latestNonce !== entry.request.nonce || pendingNonce !== entry.request.nonce) {
          throw new Error(
            `${label} planned nonce ${entry.request.nonce} has already been consumed or is ` +
              "pending. Do not resend it; provide its original hash in " +
              `${recoveryEnvironmentName} after independently confirming the transaction.`,
          );
        }
        const availableBalance = await provider.getBalance(signerAddress);
        if (BigInt(availableBalance) < BigInt(entry.maximumCostWei)) {
          throw new Error(
            `${label} deployer balance is below its maximum reserved transaction cost`,
          );
        }
        assertCheckpointReservations({
          checkpoint,
          maxCostWei: releaseCostCap,
          budgetEnvironmentName,
          nativeSymbol,
        });
        const response = await signer.sendTransaction(hydrateRequest(entry.request));
        if (Number(response.nonce) !== entry.request.nonce) {
          throw new Error(`${label} was broadcast with an unexpected nonce`);
        }
        entry.hash = response.hash;
        entry.status = "submitted";
        entry.submittedAt = nowIso();
        await saveCheckpoint();
      }
    }

    if (
      entry.status !== "submitted" &&
      entry.status !== "confirmed" &&
      entry.status !== "finalized"
    ) {
      throw new Error(`${label} checkpoint has unsupported status ${entry.status}`);
    }
    const transaction = await provider.getTransaction(entry.hash);
    assertCheckpointReservations({
      checkpoint,
      maxCostWei: releaseCostCap,
      budgetEnvironmentName,
      nativeSymbol,
    });
    assertTransactionMatchesPlan({ transaction, planned: entry, signerAddress, label });
    const receipt = await canonicalReceipt({
      provider,
      entry,
      confirmations: transactionConfirmations,
      timeoutMs: transactionTimeoutMs,
      label,
    });
    const { actualCostWei, gasCharged } = canonicalActualCostWei({
      entry,
      receipt,
      label,
      gasChargingPolicy,
    });
    const evidence = receiptEvidence(receipt, gasCharged);
    assertCumulativeActualCost({
      checkpoint,
      canonicalCosts: new Map([[label, actualCostWei]]),
      maxCostWei: releaseCostCap,
      budgetEnvironmentName,
      nativeSymbol,
    });
    if (entry.status === "submitted") {
      entry.status = "confirmed";
      entry.confirmedAt = nowIso();
      entry.receipt = evidence;
      entry.actualCostWei = actualCostWei.toString();
      await saveCheckpoint();
    }
    return receipt;
  };
};

export const revalidateCheckpointTransactions = async ({
  provider,
  checkpoint,
  confirmations,
  timeoutMs,
  saveCheckpoint,
  maxCostWei,
  budgetEnvironmentName = "ESPACE_MAINNET_MAX_CFX",
  nativeSymbol = "CFX",
  gasChargingPolicy = GAS_CHARGING_CONFLUX_THREE_QUARTER,
}) => {
  assertCheckpointReservations({ checkpoint, maxCostWei, budgetEnvironmentName, nativeSymbol });
  let changed = false;
  const validated = [];
  const canonicalCosts = new Map();
  for (const [label, entry] of Object.entries(checkpoint.transactions ?? {})) {
    if (!entry.hash) continue;
    const transaction = await provider.getTransaction(entry.hash);
    assertTransactionMatchesPlan({
      transaction,
      planned: entry,
      signerAddress: entry.from,
      label,
    });
    const receipt = await canonicalReceipt({ provider, entry, confirmations, timeoutMs, label });
    const { actualCostWei, gasCharged } = canonicalActualCostWei({
      entry,
      receipt,
      label,
      gasChargingPolicy,
    });
    const evidence = receiptEvidence(receipt, gasCharged);
    canonicalCosts.set(label, actualCostWei);
    validated.push({ entry, evidence, actualCostWei });
  }
  assertCumulativeActualCost({
    checkpoint,
    canonicalCosts,
    maxCostWei,
    budgetEnvironmentName,
    nativeSymbol,
  });
  for (const { entry, evidence, actualCostWei } of validated) {
    if (entry.status === "submitted") {
      entry.status = "confirmed";
      entry.confirmedAt = nowIso();
      entry.receipt = evidence;
      entry.actualCostWei = actualCostWei.toString();
      changed = true;
    }
  }
  if (changed && typeof saveCheckpoint === "function") await saveCheckpoint();
};
