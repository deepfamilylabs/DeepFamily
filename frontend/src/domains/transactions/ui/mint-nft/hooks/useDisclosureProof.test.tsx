// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDisclosureProof } from "./useDisclosureProof";

const personHash = `0x${"12".repeat(32)}`;
const identityResult = {
  identitySuiteId: 1,
  identity: {
    fullName: "Ada Lovelace",
    gender: 2,
    birthYear: 1815,
    birthMonth: 12,
    birthDay: 10,
    isBirthBC: false,
  },
  derivedSecretField: "1",
  identityCommitment: "1",
  personHash,
  nameField: "2",
  suiteCommitment: "3",
  packedBirthGenderField: "4",
};
const generatedProof = {
  proof: { pi_a: [], pi_b: [], pi_c: [] },
  publicSignals: ["1", "99", "2", "3"],
};

function proofArgs() {
  return {
    address: "0x00000000000000000000000000000000000000aa",
    personInfo: identityResult.identity,
    formData: {
      birthPlace: "London",
      isDeathBC: false,
      deathYear: "",
      deathMonth: "",
      deathDay: "",
      deathPlace: "",
      storyTitle: "",
      story: "Math",
      tokenURI: "ipfs://token",
    },
    targetPersonHash: personHash,
    selfSuiteId: 1,
    getPassphrase: () => "secret",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const mocks = vi.hoisted(() => ({
  zkWorkerCall: vi.fn(),
  cryptoWorkerCall: vi.fn(),
  formatGroth16ProofForContract: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../../../../../shared/workers/zkWorkerClient", () => ({
  zkWorkerCall: (...args: any[]) => mocks.zkWorkerCall(...args),
}));

vi.mock("../../../../../shared/workers/cryptoWorkerClient", () => ({
  cryptoWorkerCall: (...args: any[]) => mocks.cryptoWorkerCall(...args),
}));

vi.mock("../../../../../shared/zk/zk", () => ({
  computeDisclosureBinding: () => 99n,
  formatGroth16ProofForContract: (...args: any[]) => mocks.formatGroth16ProofForContract(...args),
}));

vi.mock("../../../../../shared/zk/proofDescriptors", () => ({
  DISCLOSURE_BINDING_PROOF_DESCRIPTOR: { circuitId: 1, proofEncodingId: 1 },
}));

vi.mock("../../../../../shared/zk/publicSignalSpecs", () => ({
  decodeDisclosureBindingPublicSignals: () => ({
    identityCommitment: 1n,
    disclosureBinding: 99n,
    minter: 2n,
    suiteCommitment: 3n,
  }),
}));

vi.mock("../../../../../shared/identity/fullName", () => ({
  safeCanonicalizeFullName: (value: string) => value.trim(),
}));

describe("useDisclosureProof", () => {
  afterEach(cleanup);

  beforeEach(() => {
    mocks.zkWorkerCall.mockReset();
    mocks.cryptoWorkerCall.mockReset();
    mocks.formatGroth16ProofForContract.mockReset();
    mocks.formatGroth16ProofForContract.mockReturnValue({
      circuitId: 1,
      proofEncodingId: 1,
      proofData: "0xproof",
    });
    mocks.cryptoWorkerCall.mockResolvedValue(identityResult);
    mocks.zkWorkerCall.mockImplementation((method: string) => {
      if (method === "generateDisclosureBindingProof") {
        return Promise.resolve({
          proof: { pi_a: [], pi_b: [], pi_c: [] },
          publicSignals: ["1", "99", "2", "3"],
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
          storyTitle: "  Mathematical legacy  ",
          story: "Math",
          tokenURI: "ipfs://token",
        },
        targetPersonHash: personHash,
        selfSuiteId: 1,
        getPassphrase: () => "secret",
      });
    });

    expect(mocks.cryptoWorkerCall).toHaveBeenCalledWith(
      "deriveIdentityMaterialV1",
      expect.objectContaining({
        identity: expect.objectContaining({ fullName: "Ada Lovelace" }),
        rawPassphrase: "secret",
        identitySuiteId: 1,
      }),
      { timeoutMs: 240_000 },
    );
    expect(mocks.zkWorkerCall).toHaveBeenNthCalledWith(
      1,
      "generateDisclosureBindingProof",
      expect.objectContaining({
        minterAddress: "0x00000000000000000000000000000000000000aa",
        selfSuiteId: 1,
      }),
      { timeoutMs: 240_000 },
    );
    expect(proofResult!).toEqual(
      expect.objectContaining({
        computedPersonHash: personHash,
        proofEnvelope: { circuitId: 1, proofEncodingId: 1, proofData: "0xproof" },
        tokenURI: "ipfs://token",
        coreInfo: expect.objectContaining({
          supplementInfo: expect.objectContaining({
            fullName: "Ada Lovelace",
            birthPlace: "London",
            deathYear: 0,
          }),
        }),
      }),
    );
    expect(proofResult!.coreInfo.supplementInfo).not.toHaveProperty("storyTitle");
    expect(mocks.formatGroth16ProofForContract).toHaveBeenCalledWith(expect.anything(), {
      circuitId: 1,
      proofEncodingId: 1,
    });
    expect(result.current.proofStep).toBe("verified");
  });

  it.each(["reset", "unmount"] as const)(
    "does not start a proof when identity derivation returns after %s",
    async (cancel) => {
      const identity = deferred<typeof identityResult>();
      mocks.cryptoWorkerCall.mockReturnValue(identity.promise);
      const hook = renderHook(() => useDisclosureProof());
      let pending!: Promise<unknown>;
      act(() => {
        pending = hook.result.current.generateDisclosureProof(proofArgs());
      });
      const rejected = expect(pending).rejects.toMatchObject({ code: "ARCHIVE_PREVIEW_REJECTED" });
      act(() => {
        if (cancel === "reset") hook.result.current.reset();
        else hook.unmount();
      });
      await act(async () => {
        identity.resolve(identityResult);
        await rejected;
      });
      expect(mocks.zkWorkerCall).not.toHaveBeenCalled();
      expect(mocks.formatGroth16ProofForContract).not.toHaveBeenCalled();
      if (cancel === "reset") expect(hook.result.current.proofStep).toBe("");
    },
  );

  it.each(["reset", "unmount"] as const)(
    "does not verify a generated proof returned after %s",
    async (cancel) => {
      const generation = deferred<typeof generatedProof>();
      mocks.zkWorkerCall.mockImplementation((method: string) => {
        if (method === "generateDisclosureBindingProof") return generation.promise;
        return Promise.resolve({ ok: true });
      });
      const hook = renderHook(() => useDisclosureProof());
      let pending!: Promise<unknown>;
      act(() => {
        pending = hook.result.current.generateDisclosureProof(proofArgs());
      });
      const rejected = expect(pending).rejects.toMatchObject({ code: "ARCHIVE_PREVIEW_REJECTED" });
      await waitFor(() => expect(hook.result.current.proofStep).toBe("generating"));
      act(() => {
        if (cancel === "reset") hook.result.current.reset();
        else hook.unmount();
      });
      await act(async () => {
        generation.resolve(generatedProof);
        await rejected;
      });
      expect(mocks.zkWorkerCall).toHaveBeenCalledTimes(1);
      expect(mocks.formatGroth16ProofForContract).not.toHaveBeenCalled();
      if (cancel === "reset") expect(hook.result.current.proofStep).toBe("");
    },
  );

  it("keeps a newer proof's result when an old verification finishes later", async () => {
    const verification = deferred<{ ok: boolean }>();
    let verifications = 0;
    mocks.zkWorkerCall.mockImplementation((method: string) => {
      if (method === "generateDisclosureBindingProof") return Promise.resolve(generatedProof);
      if (++verifications === 1) return verification.promise;
      return Promise.resolve({ ok: true });
    });
    const { result } = renderHook(() => useDisclosureProof());
    let previous!: Promise<unknown>;
    act(() => {
      previous = result.current.generateDisclosureProof(proofArgs());
    });
    const rejected = expect(previous).rejects.toMatchObject({ code: "ARCHIVE_PREVIEW_REJECTED" });
    await waitFor(() => expect(result.current.proofStep).toBe("verifying"));
    act(() => result.current.reset());
    await act(async () => {
      await result.current.generateDisclosureProof(proofArgs());
    });
    expect(result.current.proofStep).toBe("verified");
    await act(async () => {
      verification.resolve({ ok: false });
      await rejected;
    });
    expect(result.current.proofStep).toBe("verified");
    expect(mocks.formatGroth16ProofForContract).toHaveBeenCalledTimes(1);
  });
});
