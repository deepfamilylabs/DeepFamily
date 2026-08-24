import { canonicalizeFullName } from "@deepfamily/protocol-core";

export { canonicalizeFullName };

/** UI validation helper around the release-frozen fresh-v1 canonicalizer. */
export function safeCanonicalizeFullName(value: string): string {
  try {
    return canonicalizeFullName(value);
  } catch {
    return "";
  }
}
