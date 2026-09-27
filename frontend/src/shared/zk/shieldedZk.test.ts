import { describe, expect, it } from "vitest";
import { assertShieldedPublicSignals } from "./shieldedZk";

describe("shielded proof public inputs", () => {
  it("rejects a proof for a different amount, root or recipient before submission", () => {
    const expected = Array(32).fill("0");
    expected[0] = "7";
    expected[25] = "100";
    expected[26] = "17";
    expect(() => assertShieldedPublicSignals("unshield", [...expected], expected)).not.toThrow();
    const forged = [...expected];
    forged[26] = "18";
    expect(() => assertShieldedPublicSignals("unshield", forged, expected)).toThrow(
      "public signal 26",
    );
    expect(() => assertShieldedPublicSignals("unshield", expected.slice(0, 31), expected)).toThrow(
      "32 public signals",
    );
  });

  it("uses seven fixed inputs for viewing-key registration", () => {
    expect(() =>
      assertShieldedPublicSignals("keyRegistration", Array(7).fill("0"), Array(7).fill("0")),
    ).not.toThrow();
    expect(() =>
      assertShieldedPublicSignals("keyRegistration", Array(32).fill("0"), Array(7).fill("0")),
    ).toThrow("7 public signals");
  });
});
