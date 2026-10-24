// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Signer } from "ethers";
import type { ShieldedWorkerContext } from "../../../shared/workers/shieldedAssetWorkerTypes";
import { PrivateLetterPreparationExpiredError } from "../services/privateLetterChain";
import { PrivateLettersPanel } from "./PrivateLettersPanel";

const mocks = vi.hoisted(() => ({ worker: vi.fn(), submit: vi.fn(), lock: null as null | (() => void), walletChange: null as null | (() => void), walletGeneration: 0 }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../../shared/workers/shieldedAssetWorkerClient", () => ({
  shieldedAssetWorkerCall: mocks.worker,
  subscribeShieldedAssetWorkerLock: (listener: () => void) => { mocks.lock = listener; return () => { mocks.lock = null; }; },
}));
vi.mock("../../wallet", () => ({
  getWalletConnectionGeneration: () => mocks.walletGeneration,
  subscribeWalletConnectionChange: (listener: () => void) => { mocks.walletChange = listener; return () => { mocks.walletChange = null; }; },
}));
vi.mock("../services/privateLetterChain", async original => ({ ...await original<typeof import("../services/privateLetterChain")>(), submitPrivateLetter: mocks.submit }));

const context: ShieldedWorkerContext = {
  rpcUrl: "http://localhost:8545", chainId: "31337", factoryAddress: "0x1111111111111111111111111111111111111111",
  factoryDeploymentBlock: 1, familyAddress: "0x2222222222222222222222222222222222222222",
  lineageIndexAddress: "0x3333333333333333333333333333333333333333", poolAddress: "0x4444444444444444444444444444444444444444",
  poolDeploymentBlock: 1, assetKind: "native", lettersAddress: "0x5555555555555555555555555555555555555555",
};
const letter = { delivery: { messageId: "7", checkpointId: "1", asOf: "900", expiresAt: "1200", recipientBinding: "9" }, ciphertext: "0x010203", proof: "0x1234" };
type InboxResult = { letters: { messageId: string; body: string; registeredAt: string; attachment: null }[]; unavailable: number };
const tr = (key: string) => `shielded.privateLetters.${key}`;
const props = () => ({ mode: "write" as const, context, signer: {} as Signer, disabled: false, wallet: null, recoveryReady: true, budgetCommitment: "", onBudgetChange: vi.fn() });
function fillLetter() {
  fireEvent.change(screen.getByLabelText(tr("recipientCode")), { target: { value: "anonymous-code" } });
  fireEvent.change(screen.getByLabelText(tr("body")), { target: { value: "Private letter text" } });
}
function InboxPage({ sessionScope = "original", instance = "original" }: { sessionScope?: string; instance?: string }) {
  const [busy, setBusy] = useState(false);
  return <>
    <button disabled={busy}>Another task</button>
    <PrivateLettersPanel key={instance} {...props()} mode="inbox" sessionScope={sessionScope} disabled={busy} onBusyChange={setBusy} />
  </>;
}
beforeEach(() => { vi.clearAllMocks(); mocks.walletGeneration = 0; mocks.worker.mockReset().mockResolvedValue(letter); mocks.submit.mockReset(); });
afterEach(cleanup);

describe("private letter composer", () => {
  it("finishes the initial inbox read through StrictMode effect replay and releases the page", async () => {
    let finish!: (value: InboxResult) => void;
    mocks.worker.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<StrictMode><InboxPage /></StrictMode>);
    expect(mocks.worker).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Another task" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish({ letters: [{ messageId: "7", body: "StrictMode recovered letter", registeredAt: "1000", attachment: null }], unavailable: 0 }));
    expect(screen.getByText("StrictMode recovered letter")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Another task" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: tr("refresh") }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(["session change", "component replacement"])("keeps a newer inbox read busy after a pending %s", async change => {
    const finish: ((value: InboxResult) => void)[] = [];
    mocks.worker.mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
    const view = render(<StrictMode><InboxPage /></StrictMode>);
    expect(mocks.worker).toHaveBeenCalledTimes(1);
    view.rerender(<StrictMode><InboxPage
      sessionScope={change === "session change" ? "replacement" : "original"}
      instance={change === "component replacement" ? "replacement" : "original"}
    /></StrictMode>);
    expect(mocks.worker).toHaveBeenCalledTimes(2);
    await act(async () => finish[0]({ letters: [{ messageId: "7", body: "Old inbox plaintext", registeredAt: "1000", attachment: null }], unavailable: 0 }));
    expect(screen.queryByText("Old inbox plaintext")).toBeNull();
    expect((screen.getByRole("button", { name: "Another task" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish[1]({ letters: [{ messageId: "8", body: "Current inbox plaintext", registeredAt: "1001", attachment: null }], unavailable: 0 }));
    expect(screen.getByText("Current inbox plaintext")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Another task" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("releases a pending inbox read on lock and ignores its late plaintext", async () => {
    let finish!: (value: InboxResult) => void;
    mocks.worker.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<StrictMode><InboxPage /></StrictMode>);
    expect((screen.getByRole("button", { name: "Another task" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => mocks.lock?.());
    expect((screen.getByRole("button", { name: "Another task" }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => finish({ letters: [{ messageId: "7", body: "Locked inbox plaintext", registeredAt: "1000", attachment: null }], unavailable: 0 }));
    expect(screen.queryByText("Locked inbox plaintext")).toBeNull();
    expect(mocks.worker).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Another task" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("disables sending on a network without a letter archive", () => {
    render(<PrivateLettersPanel {...props()} context={{ ...context, lettersAddress: "" }} />);
    fillLetter();
    expect((screen.getByRole("button", { name: tr("send") }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it.each([false, true])("reports unavailable ciphertext without claiming an empty inbox (readable letters: %s)", async readable => {
    mocks.worker.mockResolvedValue({ letters: readable ? [{ messageId: "7", body: "Readable letter", registeredAt: "1000", attachment: null }] : [], unavailable: 2 });
    render(<PrivateLettersPanel {...props()} mode="inbox" />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", tr("unavailable"));
    expect(screen.queryByText(tr("emptyInbox"))).toBeNull();
    if (readable) expect(screen.getByText("Readable letter")).toBeTruthy();
    expect((screen.getByRole("button", { name: tr("refresh") }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("explains missing recovery keys before offering inbox recovery", () => {
    render(<PrivateLettersPanel {...props()} mode="inbox" recoveryReady={false} />);
    expect((screen.getByRole("button", { name: tr("refresh") }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(tr("recoveryKeysRequired"))).toBeTruthy();
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it("reopens the same budget composer on every attached-letter entry request", () => {
    const initial = { ...props(), budgetCommitment: "73", composeRequest: 1 };
    const view = render(<PrivateLettersPanel {...initial} />);
    expect(screen.getByLabelText(tr("budget"))).toBeTruthy();
    view.rerender(<PrivateLettersPanel {...initial} mode="inbox" recoveryReady={false} />);
    expect(screen.queryByLabelText(tr("budget"))).toBeNull();
    view.rerender(<PrivateLettersPanel {...initial} composeRequest={2} />);
    expect((screen.getByLabelText(tr("budget")) as HTMLSelectElement).value).toBe("73");
  });

  it("reuses an uncertain message and prepares a new proof only after irreversible expiry", async () => {
    mocks.submit.mockRejectedValueOnce(new Error("RPC interrupted"))
      .mockRejectedValueOnce(new PrivateLetterPreparationExpiredError())
      .mockResolvedValueOnce({ transactionHash: "0xconfirmed" });
    render(<PrivateLettersPanel {...props()} />);
    fillLetter();
    fireEvent.click(screen.getByRole("button", { name: tr("send") }));
    await screen.findByText(tr("sendFailed"));
    fireEvent.click(screen.getByRole("button", { name: tr("send") }));
    await screen.findByText(tr("preparationExpired"));
    expect(mocks.worker).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: tr("send") }));
    await screen.findByText(`${tr("sent")}: 0xconfirmed`);
    expect(mocks.worker).toHaveBeenCalledTimes(2);
    expect(mocks.worker.mock.calls.every(([method]) => method === "prepareLetter")).toBe(true);
  });

  it("clears plaintext and ignores a prepared result when the pool context changes", async () => {
    let finish!: (value: typeof letter) => void;
    mocks.worker.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const initial = { ...props(), onBusyChange: vi.fn() };
    const view = render(<PrivateLettersPanel {...initial} />);
    fillLetter();
    fireEvent.click(screen.getByRole("button", { name: tr("send") }));
    view.rerender(<PrivateLettersPanel {...initial} context={{ ...context, poolAddress: "0x6666666666666666666666666666666666666666" }} />);
    expect((screen.getByLabelText(tr("body")) as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByLabelText(tr("recipientCode")) as HTMLTextAreaElement).value).toBe("");
    await act(async () => finish(letter));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(initial.onBusyChange.mock.calls).toEqual([[true], [false]]);
  });

  it("removes recovered plaintext as soon as the secret session locks", async () => {
    mocks.worker.mockResolvedValue({ letters: [{ messageId: "7", body: "Recovered private text", registeredAt: "1000", attachment: null }], unavailable: 0 });
    render(<PrivateLettersPanel {...props()} mode="inbox" />);
    await screen.findByText("Recovered private text");
    act(() => mocks.lock?.());
    await waitFor(() => expect(screen.queryByText("Recovered private text")).toBeNull());
  });

  it("clears the old inbox when the recovered identity or key is replaced", async () => {
    mocks.worker.mockResolvedValue({ letters: [{ messageId: "7", body: "Old key's private text", registeredAt: "1000", attachment: null }], unavailable: 0 });
    const initial = props();
    const view = render(<PrivateLettersPanel {...initial} mode="inbox" sessionScope="original-key" />);
    await screen.findByText("Old key's private text");
    mocks.worker.mockResolvedValue({ letters: [], unavailable: 0 });
    view.rerender(<PrivateLettersPanel {...initial} mode="inbox" sessionScope="replacement-key" />);
    expect(screen.queryByText("Old key's private text")).toBeNull();
    await screen.findByText(tr("emptyInbox"));
  });

  it("keeps verified letters visible until a read-mode refresh returns", async () => {
    const oldLetter = { messageId: "7", body: "Verified private letter", registeredAt: "1000", attachment: null };
    mocks.worker.mockResolvedValue({ letters: [oldLetter], unavailable: 0 });
    const initial = props();
    const view = render(<PrivateLettersPanel {...initial} mode="inbox" />);
    await screen.findByText(oldLetter.body);
    let finish!: (value: { letters: typeof oldLetter[]; unavailable: number }) => void;
    mocks.worker.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    view.rerender(<PrivateLettersPanel {...initial} mode="inbox" context={{ ...context, stateReadMode: "chain" }} />);
    expect(screen.getByText(oldLetter.body)).toBeTruthy();
    expect(mocks.worker).toHaveBeenLastCalledWith("recoverLetters", {
      context: expect.objectContaining({ stateReadMode: "chain" }),
    }, expect.anything());
    await act(async () => finish({ letters: [{ ...oldLetter, body: "Newly verified private letter" }], unavailable: 0 }));
    expect(screen.queryByText(oldLetter.body)).toBeNull();
    expect(screen.getByText("Newly verified private letter")).toBeTruthy();
    expect(mocks.worker).toHaveBeenCalledTimes(2);
  });

  it.each(["connection event", "signer update"])("invalidates a pending send on a wallet %s and keeps the next operation busy", async change => {
    let finishSend!: (value: typeof letter) => void;
    let finishRecovery!: (value: { letters: []; unavailable: number }) => void;
    mocks.worker.mockImplementation((method: string) => new Promise(resolve => {
      if (method === "prepareLetter") finishSend = resolve;
      else finishRecovery = resolve;
    }));
    const initial = { ...props(), onBusyChange: vi.fn() };
    const view = render(<PrivateLettersPanel {...initial} />);
    fillLetter();
    fireEvent.click(screen.getByRole("button", { name: tr("send") }));
    if (change === "connection event") act(() => { mocks.walletGeneration++; mocks.walletChange?.(); });
    else view.rerender(<PrivateLettersPanel {...initial} signer={{} as Signer} />);
    expect((screen.getByLabelText(tr("body")) as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByLabelText(tr("recipientCode")) as HTMLTextAreaElement).value).toBe("");
    expect(initial.onBusyChange.mock.calls).toEqual([[true], [false]]);
    view.rerender(<PrivateLettersPanel {...initial} mode="inbox" />);
    await act(async () => finishSend(letter));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(initial.onBusyChange.mock.calls).toEqual([[true], [false], [true]]);
    await act(async () => finishRecovery({ letters: [], unavailable: 0 }));
    expect(initial.onBusyChange.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  it("keeps key-based inbox recovery current when only the transaction wallet changes", async () => {
    let finish!: (value: { letters: []; unavailable: number }) => void;
    mocks.worker.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const initial = { ...props(), onBusyChange: vi.fn() };
    const view = render(<PrivateLettersPanel {...initial} mode="inbox" />);
    act(() => { mocks.walletGeneration++; mocks.walletChange?.(); });
    view.rerender(<PrivateLettersPanel {...initial} mode="inbox" signer={{} as Signer} />);
    expect(initial.onBusyChange.mock.calls).toEqual([[true]]);
    await act(async () => finish({ letters: [], unavailable: 0 }));
    expect(screen.getByText(tr("emptyInbox"))).toBeTruthy();
    expect(initial.onBusyChange.mock.calls).toEqual([[true], [false]]);
  });
});
