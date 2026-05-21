function normalizeValue(value: unknown): unknown {
  if (value === undefined) {
    throw new Error("Cannot canonicalize undefined");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error("Canonical attestation numbers must be integers");
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const child = record[key];
      if (child !== undefined) out[key] = normalizeValue(child);
    }
    return out;
  }
  throw new Error(`Unsupported canonical attestation value: ${typeof value}`);
}

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}
