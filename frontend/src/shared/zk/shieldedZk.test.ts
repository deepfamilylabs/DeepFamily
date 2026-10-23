import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertShieldedPublicSignals,
  generateShieldedProof,
  SHIELDED_RECEIVE_LINK_KEYS,
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
    // Unshield: chainId, pool, eight shard ids, roots and nullifiers, two
    // outputs, two ciphertext hashes, amount, recipient.
    const expected = Array(32).fill("0");
    expected[30] = "100";
    expected[31] = "17";
    expect(() => assertShieldedPublicSignals("unshield", [...expected], expected)).not.toThrow();
    const forged = [...expected];
    forged[31] = "18";
    expect(() => assertShieldedPublicSignals("unshield", forged, expected)).toThrow(
      "public signal 31",
    );
    expect(() => assertShieldedPublicSignals("unshield", expected.slice(0, 31), expected)).toThrow(
      "32 public signals",
    );
  });

  it("checks each circuit against its own public-signal count", () => {
    for (const [circuit, count] of [
      ["anonymousReceiveCredential", 11],
      ["fundReceiveCredential", 12],
      ["anonymousReceivePresentation", 22],
      ["fundReceivePresentation", 23],
      ["attachedReceivePresentation", 25],
      ["identityAuthorizationUpdate", 8],
      ["shield", 7],
      ["fund", 29],
      ["claim", 27],
      ["privateTransfer", 32],
      ["unshield", 32],
    ] as const) {
      expect(() =>
        assertShieldedPublicSignals(circuit, Array(count).fill("0"), Array(count).fill("0")),
      ).not.toThrow();
      expect(() =>
        assertShieldedPublicSignals(circuit, Array(count - 1).fill("0"), Array(count).fill("0")),
      ).toThrow(`${count} public signals`);
    }
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
