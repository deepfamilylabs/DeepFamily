// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PersonHashCalculatorHandle } from "../../../../person";
import { useAddVersionIdentityMaterials } from "./useAddVersionIdentityMaterials";

const mocks = vi.hoisted(() => ({ cryptoWorkerCall: vi.fn() }));

vi.mock("../../../../../shared/workers/cryptoWorkerClient", () => ({
  cryptoWorkerCall: (...args: unknown[]) => mocks.cryptoWorkerCall(...args),
}));

function calculator(passphrase: string, resolvedIdentity?: { identitySuiteId: number; resolvedPersonHash: string }): PersonHashCalculatorHandle {
  return {
    getPublicFormData: () => ({
      ...resolvedIdentity,
      fullName: "Ada Lovelace",
      gender: 2,
      birthYear: 1815,
      birthMonth: 12,
      birthDay: 10,
      isBirthBC: false,
      hasPassphrase: passphrase.length > 0,
    }),
    getSecretInputs: () => ({ passphrase }),
    hasPassphrase: () => passphrase.length > 0,
    passphrasesMatch: () => true,
    clearSecretInputs: vi.fn(),
  } as unknown as PersonHashCalculatorHandle;
}

describe("useAddVersionIdentityMaterials", () => {
  beforeEach(() => {
    mocks.cryptoWorkerCall.mockReset();
  });

  it("checks the final derivation against the person hash resolved for this form", async () => {
    const resolvedIdentity = { identitySuiteId: 1, resolvedPersonHash: "0x" + "aa".repeat(32) };
    mocks.cryptoWorkerCall.mockResolvedValue({ identitySuiteId: 1, personHash: "0x" + "bb".repeat(32) });
    const { result } = renderHook(() => useAddVersionIdentityMaterials());
    await expect(result.current.resolveIdentityMaterial(calculator("changed passphrase", resolvedIdentity)))
      .rejects.toThrow("credentials changed");
  });

  it("refuses malformed Unicode before deriving anything", async () => {
    // Failing here gives a specific reason instead of a generic worker error,
    // and no secret leaves the page for a derivation that could only fail.
    const { result } = renderHook(() => useAddVersionIdentityMaterials());
    const passphrase = "family\ud800motto";

    await expect(result.current.resolveIdentityMaterial(calculator(passphrase))).rejects.toThrow(
      /malformed Unicode/,
    );
    expect(mocks.cryptoWorkerCall).not.toHaveBeenCalled();
  });

  it.each(["family motto", " family\tmotto\u3000", "张·王\u200d-secret"])(
    "passes accepted raw characters unchanged to the derivation worker (%s)",
    async (passphrase) => {
      mocks.cryptoWorkerCall.mockResolvedValue({
        derivedSecretField: "7",
        identitySuiteId: 1,
        personHash: `0x${"11".repeat(32)}`,
        identityCommitment: "9",
      });
      const { result } = renderHook(() => useAddVersionIdentityMaterials());

      const material = await result.current.resolveIdentityMaterial(calculator(passphrase));

      expect(mocks.cryptoWorkerCall).toHaveBeenCalledWith(
        "deriveIdentityMaterialV1",
        expect.objectContaining({ rawPassphrase: passphrase }),
        expect.anything(),
      );
      expect(material?.identityCommitment).toBe(9n);
    },
  );
});
