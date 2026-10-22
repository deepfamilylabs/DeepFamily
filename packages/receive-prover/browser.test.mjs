import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadReceiveProver, RECEIVE_CIRCUIT_VERSION } from "./browser.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const base = "https://app.example/zk/receive/anonymous/";
const issuer = "a".repeat(64);
const manifest = {
  circuitVersion: RECEIVE_CIRCUIT_VERSION, kind: "anonymous", publicSignals: 11,
  issuerVkSha256: issuer, productionCeremony: true, setup: "production-ceremony",
  artifacts: Object.fromEntries(["receipt.r1cs", "receipt.pk", "receipt.vk"].map((name) => [name, "b".repeat(64)])),
};

test("production loader requires fixed manifest and issuer pins before network access", async () => {
  let requested = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { requested = true; throw new Error("unexpected network"); };
  try {
    await assert.rejects(loadReceiveProver({ artifactBaseUrl: base }), /pinned manifest and fixed issuer/u);
    assert.equal(requested, false);
  } finally { globalThis.fetch = original; }
});

test("pinned production loader rejects development setup and changed fixed issuer", async () => {
  const original = globalThis.fetch;
  try {
    for (const [patch, error] of [
      [{ productionCeremony: false, setup: "insecure-local-development" }, /production ceremony/u],
      [{ issuerVkSha256: "c".repeat(64) }, /different fixed credential issuer/u],
    ]) {
      const body = JSON.stringify({ ...manifest, ...patch });
      globalThis.fetch = async () => new Response(body);
      await assert.rejects(loadReceiveProver({ artifactBaseUrl: base,
        expectedManifestSha256: digest(body), expectedIssuerVkSha256: issuer }), error);
    }
  } finally { globalThis.fetch = original; }
});

test("R2 addressing uses pinned digest and rejects changed bytes before loading a runtime", async () => {
  const original = globalThis.fetch;
  const body = JSON.stringify(manifest);
  let requested;
  globalThis.fetch = async (url) => { requested = String(url); return new Response(`${body} `); };
  try {
    const expected = digest(body);
    await assert.rejects(loadReceiveProver({ artifactBaseUrl: base,
      expectedManifestSha256: expected, expectedIssuerVkSha256: issuer,
      assetHost: { baseUrl: "https://assets.example/proofs", digests: { "/zk/receive/anonymous/manifest.json": expected } },
    }), /digest mismatch/u);
    assert.equal(requested, `https://assets.example/proofs/${expected}/manifest.json`);
    await assert.rejects(loadReceiveProver({ artifactBaseUrl: base,
      expectedManifestSha256: expected, expectedIssuerVkSha256: issuer,
      assetHost: { baseUrl: "https://assets.example", digests: {} },
    }), /Missing pinned receive asset digest/u);
  } finally { globalThis.fetch = original; }
});
