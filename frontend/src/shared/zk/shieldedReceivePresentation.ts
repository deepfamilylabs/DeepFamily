import { isDevMode } from "../config/env";

/** The recursive issuer proof and all private lookups stay inside the asset Worker. */
export async function proveShieldedReceivePresentation(request: Record<string, unknown>, expected: readonly (string | bigint | number)[]) {
  // The runtime is built with the fixed issuer keys and verifies its output before returning it.
  // @ts-ignore The Go browser runtime is generated alongside the receive prover artifacts.
  const runtime = await import("../../../../packages/receive-prover/browser.mjs");
  const kind = request.kind;
  if (kind !== "anonymous" && kind !== "fund" && kind !== "attachment") throw new Error("Unsupported receive proof kind");
  const manifestPath = `/zk/receive/${kind}/manifest.json`;
  const result = await runtime.prove({ ...request, kind }, { allowDevelopmentArtifacts: isDevMode(),
    assetHost: { baseUrl: __ZK_ASSET_BASE_URL__, digests: __ZK_ASSET_DIGESTS__ },
    expectedManifestSha256: __ZK_ASSET_DIGESTS__[manifestPath],
    expectedIssuerVkSha256: __SHIELDED_RECEIVE_CREDENTIAL_VKEY_SHA256__[kind === "fund" ? "fund" : "anonymous"],
  }) as { proof: string; publicSignals: string[] };
  if (!/^0x[0-9a-f]+$/i.test(result.proof) || result.publicSignals.length !== expected.length ||
    result.publicSignals.some((value, index) => BigInt(value) !== BigInt(expected[index]))) {
    throw new Error("Receive proof does not match the authenticated transaction");
  }
  return result;
}
