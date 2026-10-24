import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertShieldedPublicSignals,
  generateShieldedProof,
  SHIELDED_RECEIVE_LINK_KEYS,
  selectShieldedClaimCircuit,
  selectShieldedFundCircuit,
  selectShieldedValueCircuit,
  type ShieldedWitness,
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
    // Single-input unshield: chainId, pool, one shard id, root and nullifier, two
    // outputs, two ciphertext hashes, amount, recipient.
    const expected = Array(11).fill("0");
    expected[9] = "100";
    expected[10] = "17";
    expect(() => assertShieldedPublicSignals("unshield", [...expected], expected)).not.toThrow();
    const forged = [...expected];
    forged[10] = "18";
    expect(() => assertShieldedPublicSignals("unshield", forged, expected)).toThrow(
      "public signal 10",
    );
    expect(() => assertShieldedPublicSignals("unshield", expected.slice(0, 10), expected)).toThrow(
      "11 public signals",
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
      ["fundContinuation", 29],
      ["claim", 15],
      ["claim32", 15],
      ["privateTransfer", 11],
      ["privateTransfer4", 20],
      ["unshield", 11],
      ["unshield4", 20],
    ] as const) {
      expect(() =>
        assertShieldedPublicSignals(circuit, Array(count).fill("0"), Array(count).fill("0")),
      ).not.toThrow();
      expect(() =>
        assertShieldedPublicSignals(circuit, Array(count - 1).fill("0"), Array(count).fill("0")),
      ).toThrow(`${count} public signals`);
    }
  });

  it("selects the Fund circuit from its mode before downloading artifacts", () => {
    for (const fundMode of [0, "0"] as const) {
      expect(selectShieldedFundCircuit({ fundMode })).toBe("fund");
    }
    for (const fundMode of [1, "1"] as const) {
      expect(selectShieldedFundCircuit({ fundMode })).toBe("fundContinuation");
    }
    for (const fundMode of [-1, 2, 0.5, "", "01", "1.0", "bad", ["1"]]) {
      expect(() => selectShieldedFundCircuit({ fundMode })).toThrow("mode must be 0 or 1");
    }
    expect(() => selectShieldedFundCircuit({})).toThrow("mode must be 0 or 1");
  });

  it("downloads only the Fund mode's proving artifacts and retains its witness", async () => {
    mocks.verify.mockResolvedValue(true);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ nPublic: 29 })));
    vi.stubGlobal("fetch", fetch);
    for (const [fundMode, file] of [
      [0, "shielded_fund"],
      [1, "shielded_fund_continuation"],
    ] as const) {
      mocks.fetchAsset.mockClear();
      fetch.mockClear();
      const expectedPublicSignals = Array(29).fill("0");
      expectedPublicSignals[2] = String(fundMode);
      mocks.fullProve.mockResolvedValue({ proof: {}, publicSignals: expectedPublicSignals });
      const witness = { fundMode: String(fundMode), endorsementSiblings: Array(64).fill("0") };
      await generateShieldedProof({ circuit: "fund", witness, expectedPublicSignals });
      expect(mocks.fetchAsset.mock.calls).toEqual([
        [`/zk/shielded/${file}.wasm`],
        [`/zk/shielded/${file}_final.zkey`],
      ]);
      expect(fetch).toHaveBeenCalledExactlyOnceWith(`/zk/shielded/${file}.vkey.json`, {
        cache: "no-cache",
        credentials: "same-origin",
      });
      expect(mocks.fullProve.mock.calls[mocks.fullProve.mock.calls.length - 1][0]).toBe(witness);
      expect(witness.endorsementSiblings).toHaveLength(64);
    }
  });

  it("rejects unsupported Fund modes and explicit continuation mismatches before proving", async () => {
    vi.stubGlobal("fetch", vi.fn());
    for (const witness of [{}, { fundMode: "2" }, { fundMode: ["1"] }] as ShieldedWitness[]) {
      await expect(
        generateShieldedProof({
          circuit: "fund",
          witness,
          expectedPublicSignals: Array(29).fill("0"),
        }),
      ).rejects.toThrow("mode must be 0 or 1");
    }
    await expect(
      generateShieldedProof({
        circuit: "fundContinuation",
        witness: { fundMode: "0" },
        expectedPublicSignals: Array(29).fill("0"),
      }),
    ).rejects.toThrow("requires mode 1");
    expect(mocks.fullProve).not.toHaveBeenCalled();
    expect(mocks.fetchAsset).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("selects the VALUE variant from witness capacity and rejects unsupported shapes", () => {
    for (const circuit of ["privateTransfer", "unshield"] as const) {
      expect(selectShieldedValueCircuit(circuit, { inputEnabled: ["1"] })).toBe(circuit);
      expect(selectShieldedValueCircuit(circuit, { inputEnabled: ["1", "1", "0", "0"] })).toBe(
        `${circuit}4`,
      );
      for (const inputEnabled of [[], ["1", "1"], ["1", "1", "1"], Array(5).fill("1")]) {
        expect(() => selectShieldedValueCircuit(circuit, { inputEnabled })).toThrow("one or four");
      }
    }
  });

  it("downloads only the selected single or four-input VALUE proving artifacts", async () => {
    mocks.verify.mockResolvedValue(true);
    const fetch = vi.fn(async () => new Response(JSON.stringify({})));
    vi.stubGlobal("fetch", fetch);
    for (const [action, file] of [
      ["privateTransfer", "shielded_private_transfer"],
      ["unshield", "shielded_unshield"],
    ] as const) {
      for (const width of [1, 4] as const) {
        mocks.fetchAsset.mockClear();
        fetch.mockClear();
        const expectedPublicSignals = Array(width === 1 ? 11 : 20).fill("0");
        mocks.fullProve.mockResolvedValue({ proof: {}, publicSignals: expectedPublicSignals });
        await generateShieldedProof({
          circuit: action,
          witness: { inputEnabled: Array(width).fill("1") },
          expectedPublicSignals,
        });
        const selected = width === 1 ? file : `${file}_4`;
        expect(mocks.fetchAsset.mock.calls).toEqual([
          [`/zk/shielded/${selected}.wasm`],
          [`/zk/shielded/${selected}_final.zkey`],
        ]);
        expect(fetch).toHaveBeenCalledExactlyOnceWith(`/zk/shielded/${selected}.vkey.json`, {
          cache: "no-cache",
          credentials: "same-origin",
        });
      }
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
      ["/zk/shielded/shielded_claim_32.wasm"],
      ["/zk/shielded/shielded_claim_32_final.zkey"],
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
      ["/zk/shielded/shielded_claim_64.wasm"],
      ["/zk/shielded/shielded_claim_64_final.zkey"],
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
