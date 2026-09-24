// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ethers } from "ethers";
import { INHERITANCE_PERIOD_SECONDS } from "@deepfamily/protocol-core";
import type { IdentityFormHandle } from "../model/inheritanceTypes";
import { useInheritanceClaim } from "./useInheritanceClaim";

const PERIOD = INHERITANCE_PERIOD_SECONDS;
const START = 1_700_000_000n;
const RECIPIENT = "0x00000000000000000000000000000000000000c1";

const mocks = vi.hoisted(() => ({
  legitimacy: [] as unknown[],
  rows: [] as unknown[],
  zkWorkerCall: vi.fn(),
  submitClaim: vi.fn(),
  prepareClaim: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../services/inheritanceIdentity", () => ({
  // The person hash follows the name, so editing a form changes who is derived.
  deriveIdentityFromForm: vi.fn(async (form: IdentityFormHandle | null) => {
    const name = form?.getPublicFormData().fullName ?? "";
    return {
      identitySuiteId: 1,
      identity: {
        fullName: name,
        gender: 0,
        birthYear: 0,
        birthMonth: 0,
        birthDay: 0,
        isBirthBC: false,
      },
      derivedSecretField: String(name.length + 100),
      identityCommitment: String(name.length + 1),
      personHash: `hash:${name}`,
    };
  }),
}));

vi.mock("../services/inheritanceChain", () => ({
  assertIdentityKnown: vi.fn(),
  assertVersionKnown: vi.fn(),
  loadLineageSnapshot: vi.fn(async () => ({ blockNumber: 9 })),
  findHeirLegitimacy: vi.fn(() => mocks.legitimacy),
  listInheritancesForCredential: vi.fn(async () => mocks.rows),
  readInheritanceRow: vi.fn(async (_contract: unknown, id: bigint) =>
    (mocks.rows as Array<{ id: bigint }>).find((row) => row.id === id),
  ),
  latestBlockTime: vi.fn(async () => START + PERIOD + 1n),
}));

vi.mock("../services/inheritanceFlows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/inheritanceFlows")>()),
  assertWalletChain: vi.fn(async () => undefined),
  prepareClaim: mocks.prepareClaim,
  submitClaim: mocks.submitClaim,
}));

vi.mock("../services/inheritanceModules", () => ({
  connectInheritanceWriters: () => ({ inheritance: { interface: null }, token: {} }),
}));

vi.mock("../../../shared/workers/zkWorkerClient", () => ({
  zkWorkerCall: mocks.zkWorkerCall,
}));

function formRef(name: string) {
  const handle: IdentityFormHandle & { name: string } = {
    name,
    getPublicFormData() {
      return {
        fullName: this.name,
        gender: 0,
        birthYear: 0,
        birthMonth: 0,
        birthDay: 0,
        isBirthBC: false,
      };
    },
    getSecretInputs: () => ({ passphrase: "secret" }),
  };
  return { current: handle };
}

const session = {
  modules: { chainId: 31337, provider: {}, inheritance: {}, lineageIndex: {} },
  signer: {},
  account: RECIPIENT,
} as any;

describe("useInheritanceClaim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.legitimacy = [
      {
        versionIndex: 2,
        endorser: "0x00000000000000000000000000000000000000e1",
        writtenAt: START - PERIOD,
      },
    ];
    mocks.rows = [{ id: 3n, startTime: START, amountPerPeriod: 10n, balance: 15n, claimed: 0n }];
    mocks.prepareClaim.mockReturnValue({
      ready: true,
      eligibleFrom: START,
      owed: 20n,
      claimable: 15n,
      witness: { claimTag: "1" },
      signals: { claimTag: 1n },
    });
    mocks.zkWorkerCall.mockResolvedValue({ proof: { pi_a: [] }, publicSignals: [] });
    mocks.submitClaim.mockResolvedValue({ amount: 15n, transactionHash: "0xclaim" });
  });

  it("lists the root version's inheritances with what the heir can claim now", async () => {
    const { result } = renderHook(() =>
      useInheritanceClaim(session, formRef("Child"), formRef("Parent")),
    );
    await act(() => result.current.search(1));

    expect(result.current.state).toMatchObject({
      step: "found",
      lookup: { heirPersonHash: "hash:Child", rootPersonHash: "hash:Parent", versionIndex: 2 },
    });
    const lookup = (result.current.state as any).lookup;
    // Two periods have started since START; the balance caps the payout at 15.
    expect(lookup.rows[0]).toMatchObject({ id: 3n, ready: true, owed: 20n, claimable: 15n });
  });

  it("proves, submits, and books the payout against the row", async () => {
    const { result } = renderHook(() =>
      useInheritanceClaim(session, formRef("Child"), formRef("Parent")),
    );
    await act(() => result.current.search(1));
    await act(() => result.current.claim(3n, RECIPIENT));

    expect(mocks.prepareClaim).toHaveBeenCalledWith(
      expect.objectContaining({ rootVersionIndex: 1, recipient: ethers.getAddress(RECIPIENT) }),
    );
    expect(mocks.zkWorkerCall).toHaveBeenCalledWith(
      "generateInheritanceClaimProof",
      { witness: { claimTag: "1" } },
      expect.any(Object),
    );
    expect(result.current.state).toMatchObject({ step: "claimed", amount: 15n, id: 3n });
    const row = (result.current.state as any).lookup.rows[0];
    expect(row).toMatchObject({ claimed: 15n, balance: 0n, owed: 5n, claimable: 0n });
  });

  it("refuses to claim for someone other than the person the search found", async () => {
    const heir = formRef("Child");
    const { result } = renderHook(() => useInheritanceClaim(session, heir, formRef("Parent")));
    await act(() => result.current.search(1));
    heir.current.name = "Sibling";
    await act(() => result.current.claim(3n, RECIPIENT));

    expect(result.current.state).toMatchObject({
      step: "error",
      error: { type: "identityChanged" },
    });
    expect(mocks.zkWorkerCall).not.toHaveBeenCalled();
  });

  it("explains when no trusted endorsement links the heir to the root", async () => {
    mocks.legitimacy = [];
    const { result } = renderHook(() =>
      useInheritanceClaim(session, formRef("Child"), formRef("Parent")),
    );
    await act(() => result.current.search(1));

    expect(result.current.state).toMatchObject({
      step: "error",
      error: { type: "notLegitHeir", message: "inheritance.errors.notLegitHeir" },
    });
  });
});
