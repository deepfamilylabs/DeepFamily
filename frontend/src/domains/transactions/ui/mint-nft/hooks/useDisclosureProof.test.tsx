// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDisclosureProof } from "./useDisclosureProof";

const personHash = `0x${"12".repeat(32)}`;

const mocks = vi.hoisted(() => ({
  zkWorkerCall: vi.fn(),
  computeIdentityHashMaterial: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../../../../../shared/workers/zkWorkerClient", () => ({
  zkWorkerCall: (...args: any[]) => mocks.zkWorkerCall(...args),
}));

vi.mock("../../../../../shared/zk/zk", () => ({
  computeDisclosureBinding: () => 99n,
  formatGroth16ProofForContract: () => ({
    proofSystemId: 1,
    proofEncodingId: 1,
    proofData: "0xproof",
  }),
}));

vi.mock("../../../../../shared/zk/publicSignalSpecs", () => ({
  decodeDisclosureBindingPublicSignals: () => ({
    identityCommitment: 1n,
    disclosureBinding: 99n,
    minter: 2n,
    schemaVersion: 1,
    cryptoSuiteVersion: 1,
    hashAlgoId: 1,
  }),
}));

vi.mock("../../../../../shared/crypto/identityCommitment", () => ({
  safeCanonicalizeFullName: (value: string) => value.trim(),
}));

vi.mock("../../../../../shared/crypto/identityHash", () => ({
  computeIdentityHashMaterial: (...args: any[]) => mocks.computeIdentityHashMaterial(...args),
  normalizeIdentitySaltHex: (value: string) => value,
}));

vi.mock("../../../../../shared/crypto/passphraseStrength", () => ({
  normalizePassphraseForHash: (value: string) => value.trim(),
}));

describe("useDisclosureProof", () => {
  beforeEach(() => {
    mocks.zkWorkerCall.mockReset();
    mocks.computeIdentityHashMaterial.mockReset();
    mocks.computeIdentityHashMaterial.mockResolvedValue({
      canonicalFullName: "Ada Lovelace",
      derivedSecretField: 1n,
      identityCommitment: 1n,
      personHash,
      nameField: 2n,
      suiteCommitment: 3n,
      packedBirthGenderField: 4n,
    });
    mocks.zkWorkerCall.mockImplementation((method: string) => {
      if (method === "generateDisclosureBindingProof") {
        return Promise.resolve({
          proof: { pi_a: [], pi_b: [], pi_c: [] },
          publicSignals: ["1", "99", "2", "1", "1", "1"],
        });
      }
      if (method === "verifyDisclosureBindingProof") {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error(`unexpected zk method ${method}`));
    });
  });

  it("builds disclosure proof inputs and core info without storing secret material", async () => {
    const { result } = renderHook(() => useDisclosureProof());

    let proofResult: Awaited<ReturnType<typeof result.current.generateDisclosureProof>>;
    await act(async () => {
      proofResult = await result.current.generateDisclosureProof({
        address: "0x00000000000000000000000000000000000000aa",
        personInfo: {
          fullName: " Ada Lovelace ",
          gender: 2,
          birthYear: 1815,
          birthMonth: 12,
          birthDay: 10,
          isBirthBC: false,
        },
        formData: {
          birthPlace: "London",
          isDeathBC: false,
          deathYear: "",
          deathMonth: "",
          deathDay: "",
          deathPlace: "",
          story: "Math",
          tokenURI: "ipfs://token",
        },
        targetPersonHash: personHash,
        identityMode: "deterministic",
        recoverySaltHex: "",
        getPassphrase: () => "secret",
      });
    });

    expect(mocks.computeIdentityHashMaterial).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: "Ada Lovelace",
        passphrase: "secret",
        identityMode: "deterministic",
      }),
    );
    expect(mocks.zkWorkerCall).toHaveBeenNthCalledWith(
      1,
      "generateDisclosureBindingProof",
      expect.objectContaining({
        minterAddress: "0x00000000000000000000000000000000000000aa",
      }),
      { timeoutMs: 240_000 },
    );
    expect(proofResult!).toEqual(
      expect.objectContaining({
        computedPersonHash: personHash,
        proofEnvelope: { proofSystemId: 1, proofEncodingId: 1, proofData: "0xproof" },
        tokenURI: "ipfs://token",
        coreInfo: expect.objectContaining({
          supplementInfo: expect.objectContaining({
            fullName: "Ada Lovelace",
            birthPlace: "London",
            deathYear: 0,
            story: "Math",
          }),
        }),
      }),
    );
    expect(result.current.proofGenerationStep).toBe(
      "Zero-knowledge proof verified. Submitting transaction...",
    );
  });
});
