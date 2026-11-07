// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePersonCommitmentProof } from "./usePersonCommitmentProof";

const mocks = vi.hoisted(() => ({
  zkWorkerCall: vi.fn(),
}));

vi.mock("../../../../../shared/workers/zkWorkerClient", () => ({
  zkWorkerCall: (...args: any[]) => mocks.zkWorkerCall(...args),
}));

vi.mock("../../../../../shared/zk/zk", () => ({
  formatGroth16ProofForContract: () => ({
    circuitId: 1,
    proofEncodingId: 1,
    proofData: "0xproof",
  }),
}));

vi.mock("../../../../../shared/zk/publicSignalSpecs", () => ({
  decodePersonRelationPublicSignals: () => ({
    identityCommitment: 1n,
    fatherIdentityCommitment: 0n,
    motherIdentityCommitment: 0n,
    submitterAndSelfSuiteId: 2n,
    versionCommitment: 3n,
  }),
}));

const t = (_key: string, fallback?: string) => fallback ?? _key;
const input = {
  personData: {
    fullName: "Ada Lovelace",
    derivedSecretField: 1n,
    birthYear: 1815,
    birthMonth: 12,
    birthDay: 10,
    isBirthBC: false,
    gender: 2,
    identitySuiteId: 1,
  },
  fatherData: null,
  motherData: null,
  submitterAddress: "0x00000000000000000000000000000000000000aa",
  contentDigestLo: "4",
  contentDigestHi: "5",
};

const generatedProof = {
  proof: { pi_a: [], pi_b: [], pi_c: [] },
  publicSignals: ["1", "0", "0", "2", "3"],
};

afterEach(cleanup);

describe("usePersonCommitmentProof", () => {
  beforeEach(() => {
    mocks.zkWorkerCall.mockReset();
    mocks.zkWorkerCall.mockImplementation((method: string) => {
      if (method === "generatePersonRelationProof") {
        return Promise.resolve({
          proof: { pi_a: [], pi_b: [], pi_c: [] },
          publicSignals: ["1", "0", "0", "2", "3"],
        });
      }
      if (method === "verifyPersonRelationProof") {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error(`unexpected zk method ${method}`));
    });
  });

  it("generates and verifies a person commitment proof", async () => {
    const { result } = renderHook(() => usePersonCommitmentProof(t as any));

    let proofResult: Awaited<ReturnType<typeof result.current.generatePersonCommitmentProof>>;
    await act(async () => {
      proofResult = await result.current.generatePersonCommitmentProof({
        personData: {
          fullName: "Ada Lovelace",
          derivedSecretField: 1n,
          birthYear: 1815,
          birthMonth: 12,
          birthDay: 10,
          isBirthBC: false,
          gender: 2,
          identitySuiteId: 1,
        },
        fatherData: null,
        motherData: null,
        submitterAddress: "0x00000000000000000000000000000000000000aa",
        contentDigestLo: "4",
        contentDigestHi: "5",
      });
    });

    expect(mocks.zkWorkerCall).toHaveBeenNthCalledWith(
      1,
      "generatePersonRelationProof",
      expect.objectContaining({
        submitterAddress: "0x00000000000000000000000000000000000000aa",
        selfSuiteId: 1,
        fatherSuiteId: 0,
        motherSuiteId: 0,
        contentDigestLo: "4",
        contentDigestHi: "5",
      }),
      { timeoutMs: 240_000 },
    );
    expect(mocks.zkWorkerCall).toHaveBeenNthCalledWith(
      2,
      "verifyPersonRelationProof",
      expect.any(Object),
      { timeoutMs: 120_000 },
    );
    expect(proofResult!).toEqual({
      proof: { circuitId: 1, proofEncodingId: 1, proofData: "0xproof" },
      publicSignals: {
        identityCommitment: 1n,
        fatherIdentityCommitment: 0n,
        motherIdentityCommitment: 0n,
        submitterAndSelfSuiteId: 2n,
        versionCommitment: 3n,
      },
    });
  });

  it.each(["reset", "unmount"] as const)(
    "does not start verification after %s while generation is pending",
    async (cancellation) => {
      let finishGeneration!: (value: typeof generatedProof) => void;
      mocks.zkWorkerCall.mockReturnValueOnce(
        new Promise((resolve) => {
          finishGeneration = resolve;
        }),
      );
      const { result, unmount } = renderHook(() => usePersonCommitmentProof(t as any));
      let pending!: ReturnType<typeof result.current.generatePersonCommitmentProof>;
      act(() => {
        pending = result.current.generatePersonCommitmentProof(input);
      });
      expect(result.current.proofStep).toBe("generating");

      act(() => {
        if (cancellation === "reset") result.current.reset();
        else unmount();
      });
      await act(async () => {
        finishGeneration(generatedProof);
        await expect(pending).rejects.toMatchObject({ code: "ADD_VERSION_PREVIEW_REJECTED" });
      });

      expect(mocks.zkWorkerCall).toHaveBeenCalledTimes(1);
      if (cancellation === "reset") expect(result.current.proofStep).toBe("");
    },
  );

  it("rejects a stale verification result after reset", async () => {
    let finishVerification!: (value: { ok: boolean }) => void;
    mocks.zkWorkerCall.mockImplementation((method: string) => {
      if (method === "generatePersonRelationProof") return Promise.resolve(generatedProof);
      return new Promise((resolve) => {
        finishVerification = resolve;
      });
    });
    const { result } = renderHook(() => usePersonCommitmentProof(t as any));
    let pending!: ReturnType<typeof result.current.generatePersonCommitmentProof>;
    await act(async () => {
      pending = result.current.generatePersonCommitmentProof(input);
      await Promise.resolve();
    });
    expect(result.current.proofStep).toBe("verifying");
    act(() => result.current.reset());
    await act(async () => {
      finishVerification({ ok: true });
      await expect(pending).rejects.toMatchObject({ code: "ADD_VERSION_PREVIEW_REJECTED" });
    });
    expect(result.current.proofStep).toBe("");
  });

  it("verifies only the newer request when proof generation overlaps", async () => {
    let finishOriginal!: (value: typeof generatedProof) => void;
    mocks.zkWorkerCall.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOriginal = resolve;
      }),
    );
    const { result } = renderHook(() => usePersonCommitmentProof(t as any));
    let original!: ReturnType<typeof result.current.generatePersonCommitmentProof>;
    act(() => {
      original = result.current.generatePersonCommitmentProof(input);
    });
    await act(async () => {
      await expect(result.current.generatePersonCommitmentProof(input)).resolves.toMatchObject({
        proof: { proofData: "0xproof" },
      });
    });
    await act(async () => {
      finishOriginal(generatedProof);
      await expect(original).rejects.toMatchObject({ code: "ADD_VERSION_PREVIEW_REJECTED" });
    });
    expect(
      mocks.zkWorkerCall.mock.calls.filter(([method]) => method === "verifyPersonRelationProof"),
    ).toHaveLength(1);
  });
});
