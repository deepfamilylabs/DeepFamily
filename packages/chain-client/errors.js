import { ownValue } from "./internal.js";

const categories = new Set(["cancelled", "wallet", "network", "reverted", "validation", "verification", "unknown"]);
const operations = new Set(["read", "estimate", "submit", "confirm", "verify"]);
const metadata = new WeakMap();
const explicitCategories = new WeakMap();
const copiedWalletCodes = new WeakMap();
const walletCodes = new Set([
  4001, "4001", "ACTION_REJECTED", -32002, "-32002", "WALLET_REQUEST_PENDING",
  4100, 4200, 4900, 4901, 4902,
  "INSUFFICIENT_FUNDS", "NONCE_EXPIRED", "REPLACEMENT_UNDERPRICED", "UNSUPPORTED_OPERATION", "UNPREDICTABLE_GAS_LIMIT",
]);
const diagnosticFields = ["code", "reason", "data", "info", "receipt", "action", "shortMessage", "errorName", "errorArgs", "__dfDecodedReason", "i18n", "messageAvailable"];

/** Foreign rejections need an Error identity without inventing a user-facing diagnostic. */
export class ChainOperationError extends Error {
  constructor(message, fallbackMessage = "Chain operation failed") {
    const messageAvailable = typeof message === "string" && message.trim().length > 0;
    super(messageAvailable ? message : fallbackMessage);
    this.name = "ChainOperationError";
    this.messageAvailable = messageAvailable;
  }
}

function storedDetails(error) {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return undefined;
  const stored = metadata.get(error);
  if (stored) return stored;
  const view = ownValue(error, "chainError");
  const category = ownValue(view, "category");
  const operation = ownValue(view, "operation");
  const code = ownValue(view, "code");
  const retryable = ownValue(view, "retryable");
  if (!categories.has(category) || !operations.has(operation) || typeof retryable !== "boolean" ||
      !(typeof code === "number" && Number.isSafeInteger(code) || typeof code === "string" && /^[A-Za-z0-9_:.-]{1,96}$/.test(code))) return undefined;
  const transactionHash = ownValue(view, "transactionHash");
  const transactionConfirmed = ownValue(view, "transactionConfirmed");
  const verificationFailure = ownValue(view, "verificationFailure");
  return { category, operation, code, retryable,
    ...(typeof transactionHash === "string" && transactionHash ? { transactionHash } : {}),
    ...(typeof transactionConfirmed === "boolean" ? { transactionConfirmed } : {}),
    ...(transactionConfirmed === true && ["read", "mismatch"].includes(verificationFailure) ? { verificationFailure } : {}),
  };
}

/** Public context excludes raw errors, calldata, proof material and arbitrary diagnostics. */
export function getTransactionErrorContext(error) {
  const stored = storedDetails(error);
  const transactionHash = ownValue(error, "transactionHash") ?? stored?.transactionHash;
  const transactionConfirmed = ownValue(error, "transactionConfirmed") ?? stored?.transactionConfirmed;
  const verificationFailure = ownValue(error, "verificationFailure") ?? stored?.verificationFailure;
  return {
    ...(typeof transactionHash === "string" && transactionHash ? { transactionHash } : {}),
    ...(typeof transactionConfirmed === "boolean" ? { transactionConfirmed } : {}),
    ...(transactionConfirmed === true && ["read", "mismatch"].includes(verificationFailure) ? { verificationFailure } : {}),
  };
}

function errorObject(error, fallbackMessage = "Chain operation failed") {
  if (error instanceof Error) return error;
  const copy = new ChainOperationError(typeof error === "string" ? error : ownValue(error, "message"), fallbackMessage);
  // Keep only recognized wallet codes when converting foreign rejections; do not retain causes.
  copiedWalletCodes.set(copy, walletFailureCodes(error));
  for (const key of diagnosticFields) {
    const value = ownValue(error, key);
    if (value !== undefined) Object.defineProperty(copy, key, { value, configurable: true, writable: true });
  }
  return Object.assign(copy, getTransactionErrorContext(error));
}

function copyError(error) {
  const copy = Object.create(Object.getPrototypeOf(error));
  copiedWalletCodes.set(copy, walletFailureCodes(error));
  for (const key of ["name", "message", "stack", ...diagnosticFields]) {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    if (descriptor && "value" in descriptor) Object.defineProperty(copy, key, { ...descriptor, configurable: true, writable: true });
  }
  const context = getTransactionErrorContext(error);
  const previous = storedDetails(error);
  if (previous) metadata.set(copy, Object.freeze({ ...previous, ...context }));
  if (explicitCategories.has(error)) explicitCategories.set(copy, explicitCategories.get(error));
  return Object.assign(copy, context);
}

function attach(error, fields) {
  try { return Object.assign(error, fields); }
  catch { return Object.assign(copyError(error), fields); }
}

export function withTransactionHash(error, transactionHash) {
  const normalized = errorObject(error, "Transaction tracking failed");
  if (typeof transactionHash !== "string" || !transactionHash) return normalized;
  return attach(normalized, { transactionHash });
}

export function withConfirmedTransaction(error, transactionHash, verificationFailure) {
  return normalizeChainError(attach(withTransactionHash(error, transactionHash), {
    transactionConfirmed: true, verificationFailure,
  }), { operation: verificationFailure === "read" ? "read" : "verify", category: "verification" });
}

function walletFailureCodes(error) {
  const codes = new Set();
  const seen = new Set();
  const visit = (value, depth) => {
    if (!value || typeof value !== "object" || depth > 4 || seen.has(value)) return;
    seen.add(value);
    for (const code of copiedWalletCodes.get(value) ?? []) codes.add(code);
    const code = ownValue(value, "code");
    if (walletCodes.has(code)) codes.add(code);
    // Recognize the standard RPC rejection without retaining or exporting its message.
    const message = ownValue(value, "message");
    if ((code === -32000 || code === "UNKNOWN_ERROR" || code === "SERVER_ERROR") &&
        typeof message === "string" && /\binsufficient funds\b/i.test(message)) codes.add("INSUFFICIENT_FUNDS");
    visit(ownValue(value, "error"), depth + 1);
    visit(ownValue(value, "cause"), depth + 1);
    visit(ownValue(ownValue(value, "info"), "error"), depth + 1);
  };
  visit(error, 0);
  return [...codes];
}

function walletRequestPending(error) {
  return walletFailureCodes(error).some((code) => code === -32002 || code === "-32002" || code === "WALLET_REQUEST_PENDING");
}

function walletRequestRejected(error) {
  return walletFailureCodes(error).some((code) => code === 4001 || code === "4001" || code === "ACTION_REJECTED");
}

function classify(error, context, operation) {
  const code = ownValue(error, "code");
  const action = ownValue(error, "action");
  if (context.transactionConfirmed) return "verification";
  if (walletRequestPending(error)) return "wallet";
  if (walletRequestRejected(error) || code === "TRANSACTION_REPLACEMENT_CANCELLED" ||
      (code === "TRANSACTION_REPLACED" && ownValue(error, "cancelled") === true) ||
      (typeof code === "string" && /(?:_CANCELLED|_PREVIEW_REJECTED)$/.test(code))) return "cancelled";
  if (walletFailureCodes(error).length) return "wallet";
  if (["NETWORK_ERROR", "SERVER_ERROR", "TIMEOUT", "OFFCHAIN_FAULT", "UNKNOWN_ERROR"].includes(code)) return "network";
  if (code === "CALL_EXCEPTION") return action === "estimateGas" || operation === "estimate" ? "validation" : "reverted";
  if (code === "TRANSACTION_REPLACEMENT_MISMATCH" || code === "TRANSACTION_RECEIPT_MISMATCH") return "verification";
  if (["INVALID_ARGUMENT", "NUMERIC_FAULT", "BUFFER_OVERRUN", "BAD_DATA"].includes(code) ||
      (typeof code === "string" && /(?:^ARCHIVE_|_SCOPE_CHANGED$|_VALIDATION_FAILED$)/.test(code))) return "validation";
  return "unknown";
}

/** One error contract for browser and Node consumers; no raw diagnostics enter these details. */
export function getChainErrorDetails(error, options = {}) {
  const previous = storedDetails(error);
  const context = { ...getTransactionErrorContext(error), ...getTransactionErrorContext(options) };
  const action = ownValue(error, "action");
  const inferredOperation = action === "estimateGas" ? "estimate" : action === "sendTransaction" ? "submit" : "read";
  const operation = operations.has(options.operation) ? options.operation : previous?.operation ?? inferredOperation;
  const category = categories.has(options.category) ? options.category :
    context.transactionConfirmed ? "verification" : explicitCategories.get(error) ??
      (metadata.has(error) ? classify(error, context, operation) : previous?.category ?? classify(error, context, operation));
  const rawCode = ownValue(error, "code");
  const walletCode = walletFailureCodes(error).find((candidate) => ![4001, "4001", "ACTION_REJECTED", -32002, "-32002", "WALLET_REQUEST_PENDING"].includes(candidate));
  const code = previous?.code ?? (walletRequestPending(error) ? "WALLET_REQUEST_PENDING" :
    walletRequestRejected(error) && rawCode !== 4001 && rawCode !== "4001" ? "ACTION_REJECTED" :
    walletCode !== undefined ? walletCode :
    typeof rawCode === "number" && Number.isSafeInteger(rawCode) ? rawCode :
    typeof rawCode === "string" && /^[A-Za-z0-9_:.-]{1,96}$/.test(rawCode) ? rawCode : "CHAIN_OPERATION_FAILED");
  const retryable = !context.transactionHash && !context.transactionConfirmed &&
    ((operation === "read" || operation === "estimate") && category === "network" ||
      category === "wallet" && code === "WALLET_REQUEST_PENDING");
  return { category, operation, code, retryable, ...context };
}

/** Preserve the original Error and its domain identity while adding a safe canonical view. */
export function normalizeChainError(error, options = {}) {
  const normalized = errorObject(error);
  if (categories.has(options.category)) explicitCategories.set(normalized, options.category);
  const details = Object.freeze(getChainErrorDetails(normalized, options));
  metadata.set(normalized, details);
  try {
    Object.defineProperty(normalized, "chainError", { value: details, configurable: true, enumerable: false });
  } catch { /* Frozen domain errors keep their identity; the WeakMap remains authoritative. */ }
  return normalized;
}

export function chainTrackingError(message, code) {
  return Object.assign(new Error(message), { code, reason: code });
}

export async function readConfirmedDetails(transactionHash, read) {
  try { return await read(); }
  catch (error) { throw withConfirmedTransaction(error, transactionHash, "read"); }
}

export async function verifyConfirmedDetails(transactionHash, verify) {
  try { return await verify(); }
  catch (error) {
    throw withConfirmedTransaction(error, transactionHash,
      getTransactionErrorContext(error).verificationFailure === "read" ? "read" : "mismatch");
  }
}
