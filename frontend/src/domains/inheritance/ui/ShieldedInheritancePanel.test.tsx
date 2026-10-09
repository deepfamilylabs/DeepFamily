// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, type Signer } from "ethers";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";
import { ShieldedInheritancePanel } from "./ShieldedInheritancePanel";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  cancel: vi.fn(async () => {}),
  lock: vi.fn(),
  update: vi.fn(),
  verify: vi.fn(),
  submit: vi.fn(),
  identity: null as any,
  funds: null as any,
  generation: 0,
  receipt: vi.fn(),
  center: null as any,
  busy: vi.fn(),
  locked: null as (() => void) | null,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../config", () => ({ useConfig: () => ({ rpcUrl: "https://rpc.example" }) }));
vi.mock("../../transactions", () => ({ useTransactionCenter: () => mocks.center }));
vi.mock("../../../shared/config/env", () => ({ getShieldedPoolFactoryDeploymentBlock: () => 10 }));
vi.mock("../../../shared/workers/shieldedAssetWorkerClient", () => ({
  shieldedAssetWorkerCall: mocks.call,
  cancelShieldedAssetPreview: mocks.cancel,
  getShieldedAssetWorkerGeneration: () => mocks.generation,
  subscribeShieldedAssetWorkerLock: (listener: () => void) => {
    mocks.locked = listener;
    return () => {
      mocks.locked = null;
    };
  },
}));
vi.mock("./ShieldedIdentitySessionContext", () => ({
  useShieldedPageIdentitySession: () => ({
    identity: mocks.identity,
    funds: mocks.funds,
    lock: mocks.lock,
    update: mocks.update,
    touch: vi.fn(),
    setBusy: mocks.busy,
  }),
}));
vi.mock("../services/shieldedReceiveCode", () => ({
  verifyShieldedReceiveCode: mocks.verify,
  createShieldedReceiveCodeForRecipient: vi.fn(),
}));
vi.mock("../services/shieldedPoolFlows", () => ({
  submitShield: mocks.submit,
  submitFund: mocks.submit,
  submitClaim: mocks.submit,
  submitPrivateTransfer: mocks.submit,
  submitUnshield: mocks.submit,
}));
vi.mock("../../person", async () => {
  const React = await import("react");
  return {
    PersonHashCalculator: React.forwardRef((_props: any, ref: any) => {
      const input = React.useRef<HTMLInputElement>(null);
      React.useImperativeHandle(ref, () => ({
        getPublicFormData: () => ({
          fullName: "Child",
          gender: 1,
          birthYear: 2000,
          birthMonth: 1,
          birthDay: 1,
          isBirthBC: false,
        }),
        getSecretInputs: () => ({ passphrase: input.current?.value ?? "" }),
        clearSecretInputs: () => {
          if (input.current) input.current.value = "";
        },
      }));
      return <input ref={input} aria-label="identity passphrase" type="password" />;
    }),
  };
});
const address = "0x00000000000000000000000000000000000000aa";
const identity = {
  handle: "identity:1",
  identitySuiteId: 1,
  identityCommitment: "1",
  personHash: "0x" + "01".repeat(32),
  identity: { fullName: "Child" },
};
const funds = {
  ownerCommitment: "2",
  viewingKey: "0x" + "02".repeat(32),
  fundsFingerprint: "0x" + "03".repeat(32),
  rootSource: "random",
  recoveryVerified: false,
};
const modules = {
  chainId: 31337n,
  poolAddress: address,
  assetKind: "native",
  assetSymbol: "CFX",
  assetAddress: address,
  tokenDecimals: 18,
  poolDeploymentBlock: 20,
  pool: {},
  factory: { target: address },
  deepFamily: { target: address },
  lineageIndex: { target: address },
} as unknown as ShieldedPageModules;
const emptyWallet = {
  toBlock: 30,
  blockHash: "0xabc",
  notes: [],
  policies: [],
  templates: [],
  claims: [],
  parentVersions: [0],
  children: [],
};
const signer = {
  getAddress: vi.fn(async () => address),
  signMessage: vi.fn(async () => "signature"),
  provider: {
    getNetwork: vi.fn(async () => ({ chainId: 31337n })),
    getBlockNumber: vi.fn(async () => 40),
    getTransactionCount: vi.fn(async () => 7),
    getTransactionReceipt: mocks.receipt,
  },
} as unknown as Signer;
const label = (key: string) => `shielded.walletKeys.${key}`;
const renderPanel = (signingWallet = signer, selectedModules = modules) =>
  render(
    <ShieldedInheritancePanel
      modules={selectedModules}
      signer={signingWallet}
      account={address}
      publicActivityAddresses={new Set()}
    />,
  );
function chooseAction(action: string) {
  fireEvent.change(screen.getByLabelText(label("action")), { target: { value: action } });
}

describe("Worker-backed shielded wallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity = null;
    mocks.funds = null;
    mocks.generation = 0;
    mocks.center = null;
    mocks.locked = null;
    mocks.call.mockImplementation(async (method: string) =>
      method === "recover" ? emptyWallet : { identity, funds },
    );
    mocks.lock.mockImplementation(() => {
      mocks.generation++;
    });
    (signer.signMessage as any).mockResolvedValue("signature");
    (signer.getAddress as any).mockResolvedValue(address);
  });
  afterEach(cleanup);
  it("defaults explicit new creation to random without generating keys on render", () => {
    renderPanel();
    expect((screen.getByLabelText(label("newSource")) as HTMLSelectElement).value).toBe("random");
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("offers the three funding entries and recommends independent funds", () => {
    renderPanel();
    chooseAction("fund");
    expect((screen.getByLabelText(label("fundingEntry")) as HTMLSelectElement).value).toBe(
      "privateIndependent",
    );
    expect(screen.queryByText(label("generateConvenient"))).toBeNull();
  });
  it("public funding does not ask for child code or child credentials", () => {
    mocks.identity = identity;
    renderPanel();
    chooseAction("fund");
    fireEvent.change(screen.getByLabelText(label("fundingEntry")), { target: { value: "public" } });
    expect(screen.queryByLabelText(label("receiveCode"))).toBeNull();
    expect(screen.queryByText(label("generateConvenient"))).toBeNull();
    expect(screen.getByText(label("publicHint"))).toBeTruthy();
  });
  it("confines payer credential generation to the convenient entry", () => {
    mocks.identity = identity;
    renderPanel();
    chooseAction("fund");
    fireEvent.change(screen.getByLabelText(label("fundingEntry")), {
      target: { value: "privateConvenient" },
    });
    expect(screen.getByText(label("generateConvenient"))).toBeTruthy();
    expect(screen.getAllByText(label("convenientHint")).length).toBeGreaterThan(0);
  });
  it("random creation is explicit and passes no wallet signature", async () => {
    renderPanel();
    fireEvent.click(screen.getByText(label("createNew")));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.call).toHaveBeenCalledWith(
      "createFunds",
      expect.objectContaining({ intent: "create", rootSource: "random" }),
    );
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(mocks.lock).toHaveBeenCalled();
  });
  it("signature rejection never creates a random fallback", async () => {
    (signer.signMessage as any).mockRejectedValue(new Error("rejected"));
    renderPanel();
    fireEvent.change(screen.getByLabelText(label("newSource")), {
      target: { value: "walletSignature" },
    });
    fireEvent.click(screen.getByText(label("createNew")));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("rejected"));
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("a cancelled late signature cannot reopen the session", async () => {
    let resolve!: (value: string) => void;
    (signer.signMessage as any).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    renderPanel();
    fireEvent.change(screen.getByLabelText(label("newSource")), {
      target: { value: "walletSignature" },
    });
    fireEvent.click(screen.getByText(label("createNew")));
    await waitFor(() => expect(signer.signMessage).toHaveBeenCalled());
    fireEvent.click(screen.getByText(label("lock")));
    await act(async () => resolve("late-secret"));
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("cancelling while resolving the signer address prevents the wallet signature request", async () => {
    let resolve!: (value: string) => void;
    (signer.getAddress as any).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    renderPanel();
    fireEvent.change(screen.getByLabelText(label("newSource")), {
      target: { value: "walletSignature" },
    });
    fireEvent.click(screen.getByText(label("createNew")));
    await waitFor(() => expect(signer.getAddress).toHaveBeenCalled());
    fireEvent.click(screen.getByText(label("lock")));
    await act(async () => resolve(address));
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("blocks an unverified random root from receiving and spending", () => {
    mocks.identity = identity;
    mocks.funds = funds;
    renderPanel();
    fireEvent.change(screen.getByLabelText(label("slot")), { target: { value: "asset" } });
    expect((screen.getByText(label("createCode")) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText(label("preview")) as HTMLButtonElement).disabled).toBe(true);
  });
  it("root-only recovery is available while identity receiving-code proof stays blocked", () => {
    mocks.funds = { ...funds, recoveryVerified: true };
    renderPanel();
    fireEvent.change(screen.getByLabelText(label("slot")), { target: { value: "asset" } });
    expect((screen.getByText(label("recover")) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByText(label("createCode")) as HTMLButtonElement).disabled).toBe(true);
    chooseAction("claim");
    expect((screen.getByText(label("preview")) as HTMLButtonElement).disabled).toBe(true);
  });
  it("transfers identity credentials directly to Worker and clears the input", async () => {
    renderPanel();
    const password = screen.getByLabelText("identity passphrase") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "private-passphrase" } });
    fireEvent.click(screen.getByText(label("unlockIdentity")));
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith(
        "unlockIdentity",
        expect.objectContaining({ rawPassphrase: "private-passphrase" }),
      ),
    );
    expect(password.value).toBe("");
  });
  it("failed Shielded Key import clears its secret without creating a replacement root", async () => {
    mocks.call.mockRejectedValue(new Error("Invalid funds key"));
    renderPanel();
    fireEvent.change(screen.getByLabelText(label("restorePath")), {
      target: { value: "shieldedKey" },
    });
    const input = screen.getByLabelText(label("shieldedKeyInput")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "invalid-private-funds-key" } });
    fireEvent.click(screen.getByText(label("importRecovery")));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Invalid funds key"));
    expect(mocks.call).toHaveBeenCalledWith(
      "importRecoveryMaterial",
      expect.objectContaining({
        format: "shieldedKey",
        material: "invalid-private-funds-key",
      }),
    );
    expect(mocks.call.mock.calls.some(([method]) => method === "createFunds")).toBe(false);
    expect(input.value).toBe("");
  });
  it("offers only words, Shielded Key and signature as normal recovery paths", () => {
    renderPanel();
    const select = screen.getByLabelText(label("restorePath")) as HTMLSelectElement;
    expect(select.value).toBe("mnemonic");
    expect(Array.from(select.options, (option) => option.value)).toEqual([
      "mnemonic",
      "shieldedKey",
      "signature",
    ]);
    expect(screen.queryByText(label("export"))).toBeNull();
    expect(screen.queryByText(label("verifyResign"))).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
  it.each(["mnemonic", "shieldedKey"] as const)(
    "transfers %s directly to the Worker and clears the input before completion",
    async (format) => {
      let complete!: (value: any) => void;
      mocks.call.mockImplementation(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      renderPanel();
      fireEvent.change(screen.getByLabelText(label("restorePath")), { target: { value: format } });
      const input = screen.getByLabelText(
        label(format === "mnemonic" ? "mnemonicInput" : "shieldedKeyInput"),
      ) as HTMLTextAreaElement;
      fireEvent.change(input, { target: { value: "private-recovery-material" } });
      fireEvent.click(screen.getByText(label("importRecovery")));
      await waitFor(() =>
        expect(mocks.call).toHaveBeenCalledWith(
          "importRecoveryMaterial",
          expect.objectContaining({ format, material: "private-recovery-material" }),
        ),
      );
      expect(input.value).toBe("");
      expect(mocks.lock).toHaveBeenCalled();
      await act(async () => complete({ identity: null, funds }));
      expect(mocks.update).toHaveBeenCalled();
      expect(mocks.call.mock.calls.some(([method]) => method === "createFunds")).toBe(false);
    },
  );
  it("requires an off-device save and manually re-entered backup in a fresh session", async () => {
    mocks.funds = { ...funds, backupRequired: true };
    mocks.call.mockImplementation(async (method) =>
      method === "exportRecoveryMaterial"
        ? {
            material: "original-secret-words",
            format: "mnemonic",
            version: 1,
            fundsFingerprint: funds.fundsFingerprint,
          }
        : { identity: null, funds: { ...funds, recoveryVerified: true, backupRequired: false } },
    );
    renderPanel();
    fireEvent.click(screen.getByText(label("exportRecovery")));
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith(
        "exportRecoveryMaterial",
        expect.objectContaining({ format: "mnemonic" }),
      ),
    );
    const exported = screen.getByLabelText(
      label("exportedRecoveryMaterial"),
    ) as HTMLTextAreaElement;
    const imported = screen.getByLabelText(label("mnemonicInput")) as HTMLTextAreaElement;
    expect(exported.value).toBe("original-secret-words");
    expect(imported.value).toBe("");
    expect((screen.getByText(label("beginIndependentImport")) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByText(label("importRecovery")) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: label("savedExternal") }));
    fireEvent.click(screen.getByText(label("beginIndependentImport")));
    expect(mocks.lock).toHaveBeenCalled();
    expect(exported.value).toBe("");
    expect(imported.value).toBe("");
    expect(screen.getByText(label("reenterBackup"))).toBeTruthy();
    fireEvent.change(imported, { target: { value: "manually-entered-backup" } });
    fireEvent.click(screen.getByText(label("importRecovery")));
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith(
        "importRecoveryMaterial",
        expect.objectContaining({
          format: "mnemonic",
          material: "manually-entered-backup",
          expectedFingerprint: funds.fundsFingerprint,
        }),
      ),
    );
    expect(imported.value).toBe("");
    expect(mocks.call.mock.calls.some(([method]) => method === "restoreSignature")).toBe(false);
  });
  it("does not let a newly created signature root replace backup verification by re-signing", () => {
    mocks.funds = { ...funds, rootSource: "walletSignature", backupRequired: true };
    renderPanel();
    const select = screen.getByLabelText(label("restorePath")) as HTMLSelectElement;
    expect(select.options[2].disabled).toBe(true);
    expect(screen.queryByText(label("verifyResign"))).toBeNull();
    expect(screen.getByText(label("exportRecovery"))).toBeTruthy();
  });
  it("does not promote a new signature candidate into a trusted original fingerprint", async () => {
    mocks.call.mockResolvedValue({
      identity: null,
      funds: { ...funds, rootSource: "walletSignature" },
    });
    renderPanel();
    fireEvent.change(screen.getByLabelText(label("restorePath")), {
      target: { value: "signature" },
    });
    fireEvent.click(screen.getByText(label("restoreSignature")));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect((screen.getByLabelText(label("expectedFingerprint")) as HTMLInputElement).value).toBe(
      "",
    );
    expect(mocks.call).toHaveBeenCalledWith(
      "restoreSignature",
      expect.objectContaining({
        expectedFingerprint: undefined,
      }),
    );
  });
  it("does not export a recovery card for an unverified candidate root", () => {
    mocks.funds = { ...funds, rootSource: "imported", backupRequired: false };
    renderPanel();
    const download = screen.getByText(label("downloadRecoveryInfo")) as HTMLButtonElement;
    expect(download.disabled).toBe(true);
    expect((screen.getByText(label("exportRecovery")) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText(label("expectedFingerprint")) as HTMLInputElement).value).toBe(
      "",
    );
  });
  it("clears recovery secrets on path changes and manual locking", async () => {
    mocks.funds = { ...funds, backupRequired: true };
    mocks.call.mockResolvedValue({
      material: "secret-root",
      format: "mnemonic",
      version: 1,
      fundsFingerprint: funds.fundsFingerprint,
    });
    renderPanel();
    const input = screen.getByLabelText(label("mnemonicInput")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "secret-input" } });
    fireEvent.change(screen.getByLabelText(label("restorePath")), {
      target: { value: "shieldedKey" },
    });
    expect(input.value).toBe("");
    fireEvent.click(screen.getByText(label("exportRecovery")));
    await waitFor(() =>
      expect(
        (screen.getByLabelText(label("exportedRecoveryMaterial")) as HTMLTextAreaElement).value,
      ).toBe("secret-root"),
    );
    fireEvent.click(screen.getByText(label("lock")));
    expect(
      (screen.getByLabelText(label("exportedRecoveryMaterial")) as HTMLTextAreaElement).value,
    ).toBe("");
  });
  it("clears displayed secrets when the Worker is terminated outside this panel", async () => {
    mocks.funds = { ...funds, backupRequired: true };
    mocks.call.mockResolvedValue({
      material: "secret-root",
      format: "mnemonic",
      version: 1,
      fundsFingerprint: funds.fundsFingerprint,
    });
    renderPanel();
    fireEvent.click(screen.getByText(label("exportRecovery")));
    await waitFor(() =>
      expect(
        (screen.getByLabelText(label("exportedRecoveryMaterial")) as HTMLTextAreaElement).value,
      ).toBe("secret-root"),
    );
    act(() => mocks.locked?.());
    expect(
      (screen.getByLabelText(label("exportedRecoveryMaterial")) as HTMLTextAreaElement).value,
    ).toBe("");
  });
  it("locks and clears recovery inputs when the selected pool changes", () => {
    const rendered = renderPanel();
    const input = screen.getByLabelText(label("mnemonicInput")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "secret-recovery-input" } });
    rendered.rerender(
      <ShieldedInheritancePanel
        modules={{ ...modules, poolAddress: "0x00000000000000000000000000000000000000bb" }}
        signer={signer}
        account={address}
        publicActivityAddresses={new Set()}
      />,
    );
    expect(mocks.lock).toHaveBeenCalled();
    expect(input.value).toBe("");
  });
  it("shows failed pool balances as unknown and retains good raw balances", async () => {
    mocks.identity = identity;
    mocks.call.mockResolvedValue({
      complete: false,
      pools: [
        {
          assetAddress: "asset1",
          poolAddress: "pool1",
          status: "recovered",
          rawValueBalance: "123",
          rawBudgetBalance: "456",
        },
        { assetAddress: "asset2", poolAddress: "pool2", status: "failed" },
      ],
    });
    renderPanel();
    fireEvent.click(screen.getByText(label("discoverAll")));
    await waitFor(() => expect(screen.getByText(label("discoveryPartial"))).toBeTruthy());
    expect(screen.getByText(/asset1:.*123.*456/)).toBeTruthy();
    expect(screen.getByText(/asset2:.*poolUnknown/)).toBeTruthy();
  });
  it("candidate selection and preview do not submit a transaction", async () => {
    mocks.identity = identity;
    mocks.call.mockImplementation(async (method: string) =>
      method === "recover"
        ? {
            ...emptyWallet,
            notes: [
              {
                commitment: "11",
                ownerCommitment: "2",
                slot: "identity",
                kind: "value",
                amount: "1000000000000000000",
              },
            ],
          }
        : {
            handle: "action:1",
            action: "unshield",
            amount: "500000000000000000",
            slot: "identity",
            inputs: ["11"],
            inputAmounts: ["1000000000000000000"],
            steps: [
              { action: "unshield", inputs: ["11"], outputAmounts: ["500000000000000000", "0"] },
            ],
            outputAmounts: ["500000000000000000", "0"],
            recipient: address,
          },
    );
    renderPanel();
    fireEvent.click(screen.getByText(label("recover")));
    await waitFor(() => expect(screen.getByText(/valueBalance/)).toBeTruthy());
    chooseAction("unshield");
    fireEvent.change(screen.getByLabelText(label("amount")), { target: { value: "0.5" } });
    fireEvent.click(screen.getByText(label("selectAllCandidates")));
    fireEvent.click(screen.getByText(label("preview")));
    await waitFor(() => expect(screen.getByText(label("confirmStep"))).toBeTruthy());
    expect(mocks.call).toHaveBeenCalledWith(
      "preview",
      expect.objectContaining({ candidates: ["11"], amount: "500000000000000000" }),
      expect.anything(),
    );
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("synchronizes a signature candidate verified by recovered history", async () => {
    mocks.funds = { ...funds, rootSource: "walletSignature" };
    const recovered = { identity: null, funds: { ...mocks.funds, recoveryVerified: true } };
    mocks.call.mockResolvedValue({ ...emptyWallet, sessionState: recovered });
    renderPanel();
    fireEvent.click(screen.getByText(label("recover")));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(recovered));
  });
  it("retains the same new funding policy through a preparatory merge", async () => {
    mocks.identity = identity;
    mocks.call.mockResolvedValue({
      handle: "merge:1",
      policyHandle: "policy:1",
      action: "privateTransfer",
      amount: "1",
      slot: "identity",
      steps: [],
      inputs: [],
      inputAmounts: [],
      outputAmounts: ["1", "0"],
    });
    renderPanel();
    chooseAction("fund");
    fireEvent.change(screen.getByLabelText(label("fundingEntry")), { target: { value: "public" } });
    fireEvent.change(screen.getByLabelText(label("rate")), { target: { value: "1" } });
    fireEvent.click(screen.getByText(label("preview")));
    await waitFor(() => expect(screen.getByText(label("confirmStep"))).toBeTruthy());
    fireEvent.click(screen.getByText(label("preview")));
    await waitFor(() =>
      expect(mocks.call).toHaveBeenLastCalledWith(
        "preview",
        expect.objectContaining({ policyHandle: "policy:1" }),
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByText(label("discardDraft")));
    fireEvent.click(screen.getByText(label("preview")));
    await waitFor(() =>
      expect(mocks.call).toHaveBeenLastCalledWith(
        "preview",
        expect.objectContaining({ policyHandle: undefined }),
        expect.anything(),
      ),
    );
  });
  it("destroys the secret session during an external-wallet jump and accepts a current request after visible return", async () => {
    let resolve!: (value: string) => void;
    (signer.signMessage as any).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    renderPanel();
    fireEvent.change(screen.getByLabelText(label("newSource")), {
      target: { value: "walletSignature" },
    });
    fireEvent.click(screen.getByText(label("createNew")));
    await waitFor(() => expect(signer.signMessage).toHaveBeenCalled());
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent(document, new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => resolve("late-secret"));
    expect(mocks.lock).toHaveBeenCalled();
    expect(mocks.call).toHaveBeenCalledWith(
      "createFunds",
      expect.objectContaining({
        rootSource: "walletSignature",
        signerAddress: getAddress(address),
        signature: "late-secret",
      }),
    );
    expect(mocks.update).toHaveBeenCalled();
  });
  it("discards a wallet signature delivered while the page is still hidden", async () => {
    let resolve!: (value: string) => void;
    (signer.signMessage as any).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    renderPanel();
    fireEvent.change(screen.getByLabelText(label("newSource")), {
      target: { value: "walletSignature" },
    });
    fireEvent.click(screen.getByText(label("createNew")));
    await waitFor(() => expect(signer.signMessage).toHaveBeenCalled());
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => resolve("hidden-secret"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("reviews a step's fee and follows its receipt after the secret session is locked", async () => {
    mocks.identity = identity;
    mocks.call.mockImplementation(async (method: string) =>
      method === "prove"
        ? { action: "shield", amount: "1", data: {}, proof: {} }
        : {
            handle: "action:1",
            action: "shield",
            amount: "1",
            slot: "identity",
            steps: [],
            inputs: [],
            inputAmounts: [],
            outputAmounts: ["1", "0"],
          },
    );
    mocks.submit.mockImplementation(async (params: any) => {
      await params.onGasEstimate({
        gasEstimate: 100n,
        gasLimit: 120n,
        maximumGasPrice: 1n,
        maximumGasFee: 120n,
      });
      params.onBroadcast("0xpending");
      throw new Error("connection lost after broadcast");
    });
    mocks.receipt.mockResolvedValue({ status: 1 });
    renderPanel();
    fireEvent.change(screen.getByLabelText(label("amount")), { target: { value: "1" } });
    fireEvent.click(screen.getByText(label("preview")));
    await waitFor(() => expect(screen.getByText(label("confirmStep"))).toBeTruthy());
    fireEvent.click(screen.getByText(label("confirmStep")));
    await waitFor(() => expect(screen.getByText(label("confirmGas"))).toBeTruthy());
    expect(mocks.receipt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(label("confirmGas")));
    await waitFor(() => expect(screen.getByText(label("checkReceipt"))).toBeTruthy());
    fireEvent.click(screen.getByText(label("lock")));
    fireEvent.click(screen.getByText(label("checkReceipt")));
    await waitFor(() => expect(screen.getByText(/receiptChecked/)).toBeTruthy());
    expect(mocks.receipt).toHaveBeenCalledWith("0xpending");
  });
  it("changing the gas wallet clears the preview without replacing the asset root", async () => {
    mocks.identity = identity;
    mocks.funds = { ...funds, recoveryVerified: true };
    mocks.call.mockResolvedValue({
      handle: "action:1",
      action: "shield",
      amount: "1",
      slot: "identity",
      steps: [],
      inputs: [],
      inputAmounts: [],
      outputAmounts: ["1", "0"],
    });
    const rendered = renderPanel();
    fireEvent.change(screen.getByLabelText(label("amount")), { target: { value: "1" } });
    fireEvent.click(screen.getByText(label("preview")));
    await waitFor(() => expect(screen.getByText(label("confirmStep"))).toBeTruthy());
    rendered.rerender(
      <ShieldedInheritancePanel
        modules={modules}
        signer={signer}
        account="0x00000000000000000000000000000000000000bb"
        publicActivityAddresses={new Set()}
      />,
    );
    expect(screen.queryByText(label("confirmStep"))).toBeNull();
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.call.mock.calls.some(([method]) => method === "createFunds")).toBe(false);
  });
  it("keeps an unknown submission blocked and finds its receipt from public outputs after locking", async () => {
    mocks.identity = identity;
    const queryFilter = vi.fn(async () => [
      { args: { commitment: 100n }, transactionHash: "0xfound" },
      { args: { commitment: 101n }, transactionHash: "0xfound" },
    ]);
    const noteFilter = vi.fn(() => "unfiltered-notes");
    const selectedModules = {
      ...modules,
      pool: { queryFilter, filters: { NoteAppended: noteFilter } },
    } as unknown as ShieldedPageModules;
    mocks.call.mockImplementation(async (method: string) =>
      method === "prove"
        ? { action: "shield", amount: "1", data: { outputCommitments: [100n, 101n] }, proof: {} }
        : {
            handle: "action:1",
            action: "shield",
            amount: "1",
            slot: "identity",
            steps: [],
            inputs: [],
            inputAmounts: [],
            outputAmounts: ["1", "0"],
          },
    );
    mocks.submit.mockImplementation(async (params: any) => {
      params.onSubmitting({ nonce: 7, fromBlock: 30, signerAddress: address });
      throw new Error("submission response lost");
    });
    mocks.receipt.mockResolvedValue({ status: 1 });
    renderPanel(signer, selectedModules);
    fireEvent.change(screen.getByLabelText(label("amount")), { target: { value: "1" } });
    fireEvent.click(screen.getByText(label("preview")));
    await waitFor(() => expect(screen.getByText(label("confirmStep"))).toBeTruthy());
    fireEvent.click(screen.getByText(label("confirmStep")));
    await waitFor(() => expect(screen.getByText(label("checkReceipt"))).toBeTruthy());
    expect((screen.getByText(label("preview")) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText(label("lock")));
    fireEvent.click(screen.getByText(label("checkReceipt")));
    await waitFor(() => expect(screen.getByText(/receiptChecked/)).toBeTruthy());
    expect(queryFilter).toHaveBeenCalledWith("unfiltered-notes", 30, 40);
    expect(noteFilter).toHaveBeenCalledWith();
    expect(mocks.receipt).toHaveBeenCalledWith("0xfound");
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("releases the pending guard only for an explicit wallet rejection", async () => {
    mocks.identity = identity;
    mocks.call.mockImplementation(async (method: string) =>
      method === "prove"
        ? { action: "shield", amount: "1", data: { outputCommitments: [100n, 101n] }, proof: {} }
        : {
            handle: "action:1",
            action: "shield",
            amount: "1",
            slot: "identity",
            steps: [],
            inputs: [],
            inputAmounts: [],
            outputAmounts: ["1", "0"],
          },
    );
    mocks.submit.mockImplementation(async (params: any) => {
      params.onSubmitting({ nonce: 7, fromBlock: 30, signerAddress: address });
      throw Object.assign(new Error("wallet rejected"), { code: "ACTION_REJECTED" });
    });
    renderPanel();
    fireEvent.change(screen.getByLabelText(label("amount")), { target: { value: "1" } });
    fireEvent.click(screen.getByText(label("preview")));
    await waitFor(() => expect(screen.getByText(label("confirmStep"))).toBeTruthy());
    fireEvent.click(screen.getByText(label("confirmStep")));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("wallet rejected"));
    expect(screen.queryByText(label("checkReceipt"))).toBeNull();
    expect((screen.getByText(label("preview")) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(label("confirmStep"))).toBeNull();
  });
  it("restores pending public submission tracking after navigating back to the pool", async () => {
    mocks.identity = identity;
    const record = {
      id: "old-action",
      kind: "shielded",
      label: "CFX",
      phase: "busy",
      transactionHash: "0xold",
      shieldedSubmission: {
        chainId: "31337",
        poolAddress: address,
        kind: "action",
        nonce: 7,
        fromBlock: 30,
        signerAddress: address,
        outputCommitments: ["100", "101"],
      },
    };
    mocks.center = { records: [record], upsert: vi.fn((next: any) => Object.assign(record, next)) };
    mocks.receipt.mockResolvedValue({ status: 1 });
    const selectedModules = {
      ...modules,
      pool: { runner: { provider: signer.provider } },
    } as unknown as ShieldedPageModules;
    renderPanel(signer, selectedModules);
    expect((screen.getByText(label("preview")) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText(label("checkReceipt")));
    await waitFor(() => expect(screen.getByText(/receiptChecked/)).toBeTruthy());
    expect(mocks.receipt).toHaveBeenCalledWith("0xold");
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(record.phase).toBe("done");
  });
  it("cancelling fee review cannot let the old callback disable the next session's idle lock", async () => {
    mocks.identity = identity;
    mocks.call.mockImplementation(async (method: string) =>
      method === "prove"
        ? { action: "shield", amount: "1", data: { outputCommitments: [100n, 101n] }, proof: {} }
        : {
            handle: "action:1",
            action: "shield",
            amount: "1",
            slot: "identity",
            steps: [],
            inputs: [],
            inputAmounts: [],
            outputAmounts: ["1", "0"],
          },
    );
    const broadcast = vi.fn();
    mocks.submit.mockImplementation(async (params: any) => {
      await params.onGasEstimate({
        gasEstimate: 100n,
        gasLimit: 120n,
        maximumGasPrice: 1n,
        maximumGasFee: 120n,
      });
      broadcast();
    });
    renderPanel();
    fireEvent.change(screen.getByLabelText(label("amount")), { target: { value: "1" } });
    fireEvent.click(screen.getByText(label("preview")));
    await waitFor(() => expect(screen.getByText(label("confirmStep"))).toBeTruthy());
    fireEvent.click(screen.getByText(label("confirmStep")));
    await waitFor(() => expect(screen.getByText(label("cancel"))).toBeTruthy());
    fireEvent.click(screen.getByText(label("cancel")));
    await act(async () => {});
    expect(broadcast).not.toHaveBeenCalled();
    expect(mocks.busy).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText(label("confirmGas"))).toBeNull();
  });
});
