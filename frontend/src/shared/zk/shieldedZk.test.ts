import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertShieldedPublicSignals,
  generateShieldedProof,
  SHIELDED_RECEIVE_LINK_KEYS,
  selectShieldedClaimCircuit,
} from "./shieldedZk";

const mocks = vi.hoisted(() => ({
  fullProve: vi.fn(),
  verify: vi.fn(),
  fetchAsset: vi.fn(async () => new Uint8Array([1])),
}));

vi.mock("snarkjs", () => ({ groth16: { fullProve: mocks.fullProve, verify: mocks.verify } }));
vi.mock("./zkAssets", () => ({ fetchZkAsset: mocks.fetchAsset }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("shielded proof public inputs", () => {
  it("rejects a proof for a different amount, root or recipient before submission", () => {
    // Unshield: chainId, pool, four shard ids, roots and nullifiers, two
    // outputs, two ciphertext hashes, amount, recipient.
    const expected = Array(20).fill("0");
    expected[18] = "100";
    expected[19] = "17";
    expect(() => assertShieldedPublicSignals("unshield", [...expected], expected)).not.toThrow();
    const forged = [...expected];
    forged[19] = "18";
    expect(() => assertShieldedPublicSignals("unshield", forged, expected)).toThrow(
      "public signal 19",
    );
    expect(() => assertShieldedPublicSignals("unshield", expected.slice(0, 19), expected)).toThrow(
      "20 public signals",
    );
  });

  it("checks each circuit against its own public-signal count", () => {
    for (const [circuit, count] of [
      ["anonymousReceiveCredential", 11],
      ["fundReceiveCredential", 12],
      ["anonymousReceivePresentation", 22],
      ["fundReceivePresentation", 23],
      ["attachedReceivePresentation", 25],
      ["identityAuthorizationUpdate", 6],
      ["shield", 7],
      ["fund", 29],
      ["claim", 15],
      ["claim32", 15],
      ["privateTransfer", 20],
      ["unshield", 20],
    ] as const) {
      expect(() =>
        assertShieldedPublicSignals(circuit, Array(count).fill("0"), Array(count).fill("0")),
      ).not.toThrow();
      expect(() =>
        assertShieldedPublicSignals(circuit, Array(count - 1).fill("0"), Array(count).fill("0")),
      ).toThrow(`${count} public signals`);
    }
  });

  it("selects by both compact paths and checks the supported depth range", () => {
    for (const [endorsementDepth, trustedDepth, expected] of [
      [0, 0, "claim32"],
      [32, 32, "claim32"],
      [33, 1, "claim"],
      [1, 33, "claim"],
      [64, 64, "claim"],
    ] as const) {
      expect(selectShieldedClaimCircuit({ endorsementDepth, trustedDepth })).toBe(expected);
    }
    for (const endorsementDepth of [-1, 65, 1.5, "bad"]) {
      expect(() => selectShieldedClaimCircuit({ endorsementDepth, trustedDepth: 0 })).toThrow(
        "depth",
      );
    }
  });

  it("downloads only the selected claim variant and preserves the original witness", async () => {
    const expectedPublicSignals = Array(15).fill("0");
    mocks.fullProve.mockResolvedValue({ proof: {}, publicSignals: expectedPublicSignals });
    mocks.verify.mockResolvedValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ nPublic: 15 }))),
    );
    const siblings = Array(64).fill("0");
    const witness = {
      endorsementDepth: 32,
      trustedDepth: 1,
      endorsementSiblings: siblings,
      trustedSiblings: siblings,
    };
    await generateShieldedProof({ circuit: "claim", witness, expectedPublicSignals });
    expect(mocks.fetchAsset.mock.calls).toEqual([
      ["/zk/shielded/shielded_claim32.wasm"],
      ["/zk/shielded/shielded_claim32_final.zkey"],
    ]);
    expect(mocks.fullProve.mock.calls[0][0].endorsementSiblings).toHaveLength(32);
    expect(witness.endorsementSiblings).toHaveLength(64);
    mocks.fetchAsset.mockClear();
    await generateShieldedProof({
      circuit: "claim",
      witness: { ...witness, trustedDepth: 33 },
      expectedPublicSignals,
    });
    expect(mocks.fetchAsset.mock.calls).toEqual([
      ["/zk/shielded/shielded_claim.wasm"],
      ["/zk/shielded/shielded_claim_final.zkey"],
    ]);
    expect(mocks.fullProve.mock.calls[1][0].trustedSiblings).toHaveLength(64);
    await expect(
      generateShieldedProof({
        circuit: "claim32",
        witness: { ...witness, trustedDepth: 33 },
        expectedPublicSignals,
      }),
    ).rejects.toThrow("cannot exceed");
  });

  it("proves a receive presentation with existing Circom assets and its embedded verification key", async () => {
    const expectedPublicSignals = Array.from({ length: 22 }, (_, i) => String(i));
    const proof = { protocol: "groth16", curve: "bn128" };
    mocks.fullProve.mockResolvedValue({ proof, publicSignals: expectedPublicSignals });
    mocks.verify.mockResolvedValue(true);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(
      generateShieldedProof({
        circuit: "anonymousReceivePresentation",
        witness: { authorizationAlias: "7" },
        expectedPublicSignals,
      }),
    ).resolves.toEqual({ proof, publicSignals: expectedPublicSignals });

    expect(mocks.fetchAsset.mock.calls).toEqual([
      ["/zk/shielded/shielded_anonymous_receive_presentation.wasm"],
      ["/zk/shielded/shielded_anonymous_receive_presentation_final.zkey"],
    ]);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith(
      SHIELDED_RECEIVE_LINK_KEYS?.anonymous.verificationKey,
      expectedPublicSignals,
      proof,
    );
  });

  it("rejects a presentation that fails verification against the embedded key", async () => {
    const expectedPublicSignals = Array(23).fill("0");
    mocks.fullProve.mockResolvedValue({ proof: {}, publicSignals: expectedPublicSignals });
    mocks.verify.mockResolvedValue(false);
    await expect(
      generateShieldedProof({
        circuit: "fundReceivePresentation",
        witness: {},
        expectedPublicSignals,
      }),
    ).rejects.toThrow("failed local verification");
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith(
      SHIELDED_RECEIVE_LINK_KEYS?.fund.verificationKey,
      expectedPublicSignals,
      {},
    );
  });
});
