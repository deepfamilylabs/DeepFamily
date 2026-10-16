import { describe, expect, it } from "vitest";
import { assertShieldedPublicSignals } from "./shieldedZk";

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
      ["receiveCode", 9],
      ["shield", 7],
      ["fund", 27],
      ["claim", 27],
      ["privateTransfer", 30],
      ["unshield", 32],
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
