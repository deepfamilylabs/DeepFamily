/**
 * Trusted Types (see shared/config/contentSecurityPolicy.ts) make every script-URL sink take a
 * value a policy produced. The only such sink this app reaches is the Worker constructor, so a
 * default policy admits script URLs from this origin and nothing else: the bundled workers, and
 * the blob: URLs snarkjs creates for its proving threads, which share their creator's origin.
 * Every other string reaching a script or HTML sink stays a violation.
 */
type TrustedTypesFactory = {
  createPolicy(name: string, rules: { createScriptURL: (input: string) => string | null }): unknown;
};

export function isSameOriginScriptUrl(input: string, origin: string): boolean {
  try {
    return new URL(input, origin).origin === origin;
  } catch {
    return false;
  }
}

/** Installs the default policy in this realm; a realm without Trusted Types is left alone. */
export function installTrustedWorkerUrlPolicy(): void {
  const scope = globalThis as typeof globalThis & { trustedTypes?: TrustedTypesFactory };
  const origin = scope.location?.origin;
  if (!scope.trustedTypes || !origin) return;
  scope.trustedTypes.createPolicy("default", {
    createScriptURL: (input) => (isSameOriginScriptUrl(input, origin) ? input : null),
  });
}
