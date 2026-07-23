import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";

const DEFAULT_TOTAL_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_RETRIES = 2;
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 10_000;

const publicErrorMessage = (error) => {
  let raw = String(error?.shortMessage || error?.reason || error?.message || error || "unknown");
  for (const name of ["PRIVATE_KEY", "CONFLUX_RPC_URL", "CONFLUX_TESTNET_RPC_URL"]) {
    const secret = String(process.env[name] ?? "");
    if (secret.length >= 4) raw = raw.split(secret).join(`<redacted-${name.toLowerCase()}>`);
  }
  const explorerKey = String(process.env.EXPLORER_API_KEY ?? "");
  if (explorerKey.length >= 8 && explorerKey !== "espace") {
    raw = raw.split(explorerKey).join("<redacted-explorer-api-key>");
  }
  return raw
    .replace(/https?:\/\/[^\s"'<>]+/giu, "<redacted-url>")
    .replace(/0x[0-9a-fA-F]{41,}/g, "<redacted-hex-data>")
    .replace(/\s+/g, " ")
    .slice(0, 500);
};

// ConfluxScan can finish a verification request successfully but return the machine status
// `already_verified` while Hardhat is polling it. hardhat-verify currently doesn't recognize
// that eSpace-specific spelling and wraps it in HHE80024, so handle only the explorer's exact
// machine marker here. Free-form messages such as "already verified" remain failures.
const isConfluxScanAlreadyVerified = (error) => {
  if (error?.customCode === "already_verified" || error?.body?.customCode === "already_verified") {
    return true;
  }

  const messages = [error?.shortMessage, error?.reason, error?.message]
    .filter((value) => typeof value === "string")
    .join("\n");
  return /(?:^|[\s"'])already_verified\s*:/i.test(messages);
};

const log = (logger, level, message) => {
  if (!logger) return;
  if (typeof logger === "function") {
    logger(message);
    return;
  }
  const output = logger[level] || logger.log;
  if (typeof output === "function") output.call(logger, message);
};

const positiveSafeInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
};

const nonNegativeSafeInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
};

const withTimeout = async (operation, timeoutMs, description) => {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${description} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const normalizeEntry = (entry, index) => {
  if (!entry || typeof entry !== "object") {
    throw new Error(`entries[${index}] must be an object`);
  }
  for (const field of ["label", "address", "contract"]) {
    if (typeof entry[field] !== "string" || entry[field].trim() === "") {
      throw new Error(`entries[${index}].${field} must be a non-empty string`);
    }
  }
  if (entry.constructorArgs !== undefined && !Array.isArray(entry.constructorArgs)) {
    throw new Error(`entries[${index}].constructorArgs must be an array`);
  }
  if (
    entry.libraries !== undefined &&
    (entry.libraries === null ||
      typeof entry.libraries !== "object" ||
      Array.isArray(entry.libraries))
  ) {
    throw new Error(`entries[${index}].libraries must be an object`);
  }
  return {
    label: entry.label.trim(),
    address: entry.address,
    contract: entry.contract,
    constructorArgs: entry.constructorArgs ?? [],
    libraries: entry.libraries ?? {},
  };
};

/**
 * Verify an isolated eSpace acceptance deployment sequentially.
 *
 * `timeoutMs` is a hard deadline for the complete batch. Each individual explorer request is
 * also bounded by `attemptTimeoutMs` (an injectable test/advanced option). Results intentionally
 * contain only public labels, addresses, contract names, attempt counts, and sanitized errors.
 */
export const verifyAcceptanceContracts = async ({
  hre,
  entries,
  timeoutMs = DEFAULT_TOTAL_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
  logger = console,
  verifyFn = verifyContract,
  sleepFn = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  nowFn = Date.now,
  attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
} = {}) => {
  if (!hre) throw new Error("hre is required");
  if (!Array.isArray(entries)) throw new Error("entries must be an array");
  if (typeof verifyFn !== "function") throw new Error("verifyFn must be a function");
  if (typeof sleepFn !== "function") throw new Error("sleepFn must be a function");
  if (typeof nowFn !== "function") throw new Error("nowFn must be a function");

  positiveSafeInteger(timeoutMs, "timeoutMs");
  positiveSafeInteger(attemptTimeoutMs, "attemptTimeoutMs");
  nonNegativeSafeInteger(retries, "retries");
  if (retries > MAX_RETRIES) throw new Error(`retries must not exceed ${MAX_RETRIES}`);

  const normalizedEntries = entries.map(normalizeEntry);
  const startedAt = nowFn();
  const deadline = startedAt + timeoutMs;
  if (!Number.isSafeInteger(startedAt) || !Number.isSafeInteger(deadline)) {
    throw new Error("verification deadline is outside the safe integer range");
  }

  const results = [];
  for (const entry of normalizedEntries) {
    let attempts = 0;
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const remainingMs = deadline - nowFn();
      if (remainingMs <= 0) {
        lastError = new Error(`verification batch timed out after ${timeoutMs}ms`);
        break;
      }

      attempts += 1;
      log(
        logger,
        "log",
        `[verify] ${entry.label} ${entry.address} (attempt ${attempts}/${retries + 1})`,
      );
      try {
        const verified = await withTimeout(
          () =>
            verifyFn(
              {
                address: entry.address,
                constructorArgs: entry.constructorArgs,
                libraries: entry.libraries,
                contract: entry.contract,
              },
              hre,
            ),
          Math.min(attemptTimeoutMs, remainingMs),
          `${entry.label} verification attempt`,
        );
        if (verified !== true) {
          throw new Error(`${entry.label} verification returned an unsuccessful result`);
        }
        lastError = undefined;
        break;
      } catch (error) {
        if (isConfluxScanAlreadyVerified(error)) {
          lastError = undefined;
          log(
            logger,
            "log",
            `[verify] ${entry.label} already verified on ConfluxScan; accepting explorer status`,
          );
          break;
        }
        lastError = error;
        const detail = publicErrorMessage(error);
        log(logger, "warn", `[verify] ${entry.label} attempt ${attempts} failed: ${detail}`);
      }

      if (attempt < retries) {
        const remainingBeforeSleep = deadline - nowFn();
        if (remainingBeforeSleep <= 0) break;
        const requestedDelay = Math.min(
          RETRY_DELAY_MS * 2 ** attempt,
          MAX_RETRY_DELAY_MS,
          remainingBeforeSleep,
        );
        try {
          await withTimeout(
            () => sleepFn(requestedDelay),
            remainingBeforeSleep,
            `${entry.label} verification retry delay`,
          );
        } catch (error) {
          lastError = error;
          break;
        }
      }
    }

    if (lastError === undefined) {
      results.push({
        label: entry.label,
        address: entry.address,
        contract: entry.contract,
        status: "passed",
        attempts,
      });
      log(logger, "log", `[verify] ${entry.label} passed`);
    } else {
      const detail = publicErrorMessage(lastError);
      results.push({
        label: entry.label,
        address: entry.address,
        contract: entry.contract,
        status: "failed",
        attempts,
        error: detail,
      });
      log(logger, "error", `[verify] ${entry.label} failed: ${detail}`);
    }
  }

  const failed = results.filter((result) => result.status === "failed");
  if (failed.length > 0) {
    const error = new Error(
      `ConfluxScan verification failed for ${failed.length}/${results.length} contract(s): ` +
        failed.map((result) => result.label).join(", "),
    );
    error.results = results;
    throw error;
  }

  return results;
};

export default verifyAcceptanceContracts;
