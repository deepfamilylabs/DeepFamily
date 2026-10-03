import { describe, expect, it } from "vitest";
import { assertShieldedPublicSignals } from "./shieldedZk";

describe("shielded proof public inputs", () => {
  it("rejects a proof for a different amount, root or recipient before submission", () => {
    // Unshield: chainId, pool, shard, root, two nullifiers, two outputs, two
    // ciphertext hashes, amount, recipient.
    const expected = Array(12).fill("0");
    expected[10] = "100";
    expected[11] = "17";
    expect(() => assertShieldedPublicSignals("unshield", [...expected], expected)).not.toThrow();
    const forged = [...expected];
    forged[11] = "18";
    expect(() => assertShieldedPublicSignals("unshield", forged, expected)).toThrow(
      "public signal 11",
    );
    expect(() => assertShieldedPublicSignals("unshield", expected.slice(0, 11), expected)).toThrow(
      "12 public signals",
    );
  });

  it("checks each circuit against its own public-signal count", () => {
    for (const [circuit, count] of [
      ["receiveCode", 4],
      ["shield", 7],
      ["fund", 26],
      ["claim", 27],
    ] as const) {
      expect(() =>
        assertShieldedPublicSignals(circuit, Array(count).fill("0"), Array(count).fill("0")),
      ).not.toThrow();
      expect(() =>
        assertShieldedPublicSignals(circuit, Array(12).fill("0"), Array(count).fill("0")),
      ).toThrow(`${count} public signals`);
    }
  });
});
