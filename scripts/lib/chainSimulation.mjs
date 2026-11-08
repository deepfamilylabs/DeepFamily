import { getChainErrorDetails, normalizeChainError, runChainRead } from "@deepfamily/chain-client";

const ownValue = (error, key) => {
  if (!error || typeof error !== "object") return undefined;
  try { return Object.getOwnPropertyDescriptor(error, key)?.value; } catch { return undefined; }
};

const publicSimulationDetail = (error) => {
  const detail = ["shortMessage", "reason", "message"].map((key) => ownValue(error, key))
    .find((value) => typeof value === "string" && value);
  if (!detail) return "Contract simulation failed";
  // Ethers may embed the complete RPC request in message when shortMessage is absent.
  return detail.replace(/0x[0-9a-f]{16,}/giu, "[redacted hex]").slice(0, 800);
};

/** CLI presentation adapter: retain decodable fields without printing raw RPC envelopes. */
export async function simulateChainCall({ read, label, formatError = publicSimulationDetail }) {
  try {
    return await runChainRead({ read });
  } catch (error) {
    const displayed = new Error(`${label}: ${formatError(error)}`);
    for (const key of ["code", "data", "action", "reason", "__dfDecodedReason", "errorName", "errorArgs"]) {
      const value = ownValue(error, key);
      if (value !== undefined) Object.defineProperty(displayed, key, { value, configurable: true, writable: true });
    }
    const details = getChainErrorDetails(error);
    Object.defineProperty(displayed, "chainError", { value: details, configurable: true });
    throw normalizeChainError(displayed, details);
  }
}
