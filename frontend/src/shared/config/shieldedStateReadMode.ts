export type ShieldedStateReadMode = "rebuild" | "chain";

/** Requests must opt in explicitly before any recipient-specific RPC is allowed. */
export function normalizeShieldedStateReadMode(value?: unknown): ShieldedStateReadMode {
  if (value === undefined) return "rebuild";
  if (value === "rebuild" || value === "chain") return value;
  throw new Error("Unsupported shielded state read mode");
}
