import { beforeEach, describe, expect, it, vi } from "vitest";
import { Contract, Interface, id, keccak256, type Signer } from "ethers";
import { PRIVATE_LETTER_ABI } from "../../../shared/clients/privateLetterClient";
import { captureWalletDraft } from "../../../shared/clients/walletDraft";
import { passiveWalletRpc } from "../../../shared/clients/test-helpers/walletRpc";
import { PrivateLetterPreparationExpiredError, readPrivateLetters, submitPrivateLetter } from "./privateLetterChain";
const mocks = vi.hoisted(() => ({ readBlob: vi.fn(), contract: vi.fn(), validateCheckpoint: vi.fn(), wait: vi.fn() }));
vi.mock("@deepfamily/protocol-core", async original => ({ ...await original<typeof import("@deepfamily/protocol-core")>(), readArchiveBlob: mocks.readBlob }));
vi.mock("../../../shared/clients/privateLetterClient", async original => ({ ...await original<typeof import("../../../shared/clients/privateLetterClient")>(), createPrivateLetterContract: mocks.contract }));
vi.mock("./shieldedIdentityAuthorizationChain", () => ({ createIdentityAuthorizationContract: () => ({ validateCheckpoint: mocks.validateCheckpoint }) }));
vi.mock("@deepfamily/chain-client", async original => ({
  ...await original<typeof import("@deepfamily/chain-client")>(), executeChainTransaction: mocks.wait,
}));
beforeEach(() => { vi.clearAllMocks(); mocks.validateCheckpoint.mockReset().mockResolvedValue(0n); });
function fixture() {
  const iface = new Interface(PRIVATE_LETTER_ABI);
  const blob = { payloadHash: `0x${"33".repeat(32)}`, pointer: "0x2222222222222222222222222222222222222222", payloadLength: 3n, segmentCount: 1n };
  const record = { blob, recipientBinding: 9n, deadline: 1200n, registeredAt: 1000n };
  const event = iface.encodeEventLog(iface.getEvent("LetterRegistered")!, [7, blob, 9, 1200, 1000]);
  const provider = { getBlockNumber: async () => 20, getBlock: vi.fn(async () => ({ hash: "0xanchor" })), getCode: vi.fn(),
    getLogs: vi.fn(async (_filter: { topics: unknown[] }) => [{ ...event, blockNumber: 15, index: 0, transactionHash: "0xtransaction" }]) };
  const contract = { runner: { provider }, interface: iface, creationBlock: async () => 10, letterCount: vi.fn(async () => 1n),
    getAddress: async () => "0x1111111111111111111111111111111111111111", letterRecord: vi.fn(async () => record) };
  mocks.readBlob.mockResolvedValue({ payloadHash: blob.payloadHash, payload: Uint8Array.of(1, 2, 3) });
  return { provider, contract, record };
}
describe("authenticated private letter recovery", () => {
  it("normalizes provider read failures without retrying or querying private messages", async () => {
    const f = fixture();
    f.provider.getBlock.mockRejectedValueOnce(Object.assign(new Error("RPC unavailable"), { code: "NETWORK_ERROR" }));
    await expect(readPrivateLetters(f.contract as unknown as Contract)).rejects.toMatchObject({
      chainError: { category: "network", operation: "read", code: "NETWORK_ERROR", retryable: true },
    });
    expect(f.provider.getBlock).toHaveBeenCalledOnce();
    expect(f.provider.getLogs).not.toHaveBeenCalled();
  });
  it("accepts only the configured archive events and matching records before fetching ciphertext", async () => {
    const f = fixture(); const letters = await readPrivateLetters(f.contract as unknown as Contract);
    expect(letters).toMatchObject([{ messageId: "7", recipientBinding: "9", transactionHash: "0xtransaction", ciphertext: Uint8Array.of(1, 2, 3) }]);
    expect(f.provider.getLogs.mock.calls[0][0].topics).toHaveLength(1);
    expect(mocks.readBlob).toHaveBeenCalledWith(expect.objectContaining({ blockTag: 20, payloadHash: f.record.blob.payloadHash }));
  });
  it.each([false, true])("rejects an incomplete event response, including an empty range (%s)", async (empty) => {
    const f = fixture();
    f.contract.letterCount.mockResolvedValue(2n);
    if (empty) f.provider.getLogs.mockResolvedValue([]);
    await expect(readPrivateLetters(f.contract as unknown as Contract)).rejects.toThrow("history is incomplete");
    expect(f.contract.letterCount).toHaveBeenCalledWith({ blockTag: 20 });
  });
  it("accepts a genuinely empty archive", async () => {
    const f = fixture();
    f.contract.letterCount.mockResolvedValue(0n);
    f.provider.getLogs.mockResolvedValue([]);
    await expect(readPrivateLetters(f.contract as unknown as Contract)).resolves.toEqual([]);
  });
  it("recovers from block receipts for a legacy archive without a counter", async () => {
    const f = fixture();
    f.contract.letterCount.mockRejectedValue(Object.assign(new Error("missing selector"), { code: "CALL_EXCEPTION", data: "0x" }));
    const [event] = await f.provider.getLogs({ topics: [] });
    f.provider.getLogs.mockClear();
    const address = await f.contract.getAddress();
    const provider = { ...f.provider,
      getBlock: async (n: number) => ({ hash: "0xanchor", transactions: n === 15 ? ["0xtransaction"] : [] }),
      getTransactionReceipt: async () => ({ blockHash: "0xanchor", hash: "0xtransaction", logs: [{ ...event, address }] }),
    };
    const contract = { ...f.contract, runner: { provider } } as unknown as Contract;
    await expect(readPrivateLetters(contract)).resolves.toMatchObject([{ messageId: "7" }]);
    expect(f.provider.getLogs).not.toHaveBeenCalled();
  });
  it("rejects an event whose authenticated record or archive pointer changed", async () => {
    const f = fixture(); f.record.recipientBinding = 99n;
    await expect(readPrivateLetters(f.contract as unknown as Contract)).rejects.toThrow("does not match");
    const g = fixture(); g.record.blob.pointer = "0x4444444444444444444444444444444444444444";
    await expect(readPrivateLetters(g.contract as unknown as Contract)).rejects.toThrow("does not match");
  });
  it("rejects archive replay if the anchor block reorganized", async () => {
    const f = fixture(); f.provider.getBlock.mockResolvedValueOnce({ hash: "0xanchor" }).mockResolvedValueOnce({ hash: "0xother" });
    await expect(readPrivateLetters(f.contract as unknown as Contract)).rejects.toThrow("reorganized");
  });
});

function submissionFixture(isCurrent = () => true) {
  const address = "0x1111111111111111111111111111111111111111";
  const iface = new Interface(PRIVATE_LETTER_ABI);
  const letter = { delivery: { messageId: "7", checkpointId: "1", asOf: "900", deadline: "1200", recipientBinding: "9" }, ciphertext: "0x010203", proof: "0x1234" };
  const blob = { payloadHash: keccak256(letter.ciphertext), pointer: "0x2222222222222222222222222222222222222222", payloadLength: 3n, segmentCount: 1n };
  const contract = {
    interface: iface, AUTHORIZATION_STATE: async () => address,
    letterRecord: vi.fn(async () => ({ registeredAt: 0n })),
    registerLetter: vi.fn(async () => ({ hash: "0xtx", replaceableTransaction: vi.fn(() => ({ hash: "0xtx" })) })),
    queryFilter: vi.fn(async () => [{ transactionHash: "0xprior" }]),
    creationBlock: async () => 1, filters: { LetterRegistered: vi.fn() },
  };
  const provider = { send: passiveWalletRpc(() => ({ account: address, chainId: 31337n })), getNetwork: async () => ({ chainId: 31337n }), getBlockNumber: vi.fn(async () => 20), getBlock: vi.fn(async () => ({ timestamp: 1000 })) };
  const signer = { provider, getAddress: async () => address } as unknown as Signer;
  const registration = iface.encodeEventLog(iface.getEvent("LetterRegistered")!, [7, blob, 9, 1200, 1000]);
  mocks.contract.mockReturnValue(contract);
  mocks.wait.mockImplementation(async input => {
    await input.beforeSend();
    input.assertActive?.();
    await input.send();
    return { transactionHash: "0xtx", receipt: { status: 1, hash: "0xtx", logs: [{ ...registration, address }] } };
  });
  const draft = captureWalletDraft({ signer, chainId: 31337n, account: address, isCurrent });
  return { input: { address, draft, letter }, contract, provider, iface, blob };
}

describe("private letter retry and receipt confirmation", () => {
  it("reconciles an already registered message before checking its now-expired receive code", async () => {
    const f = submissionFixture();
    f.contract.letterRecord.mockResolvedValue({ registeredAt: 1000n, recipientBinding: 9n, deadline: 1200n, blob: f.blob } as never);
    f.provider.getBlock.mockResolvedValue({ timestamp: 1300 });
    await expect(submitPrivateLetter(f.input)).resolves.toEqual({ transactionHash: "0xprior" });
    expect(f.contract.registerLetter).not.toHaveBeenCalled();
    expect(mocks.validateCheckpoint).not.toHaveBeenCalled();
  });
  it("rejects a retry if the existing registration authenticates a different expiry", async () => {
    const f = submissionFixture();
    f.contract.letterRecord.mockResolvedValue({ registeredAt: 1000n, recipientBinding: 9n, deadline: 1300n, blob: f.blob } as never);
    await expect(submitPrivateLetter(f.input)).rejects.toThrow("another registered letter");
    expect(f.contract.registerLetter).not.toHaveBeenCalled();
  });
  it("allows a fresh preparation only once the original code or checkpoint can no longer execute", async () => {
    const f = submissionFixture();
    f.provider.getBlock.mockResolvedValue({ timestamp: 1200 });
    await expect(submitPrivateLetter(f.input)).rejects.toBeInstanceOf(PrivateLetterPreparationExpiredError);
    f.provider.getBlock.mockResolvedValue({ timestamp: 1000 });
    mocks.validateCheckpoint.mockRejectedValue({ code: "CALL_EXCEPTION", data: id("CheckpointExpired()").slice(0, 10) });
    await expect(submitPrivateLetter(f.input)).rejects.toBeInstanceOf(PrivateLetterPreparationExpiredError);
    expect(f.contract.registerLetter).not.toHaveBeenCalled();
  });
  it("preserves an uncertain message on RPC failure instead of treating it as expiry", async () => {
    const f = submissionFixture();
    mocks.validateCheckpoint.mockRejectedValue(new Error("RPC unavailable"));
    await expect(submitPrivateLetter(f.input)).rejects.toThrow("RPC unavailable");
    expect(f.contract.registerLetter).not.toHaveBeenCalled();
  });
  it("checks the wallet operation again after the asynchronous checkpoint validation", async () => {
    let current = true;
    const f = submissionFixture(() => current);
    mocks.validateCheckpoint.mockImplementation(async () => { current = false; });
    const onWalletRequest = vi.fn();
    await expect(submitPrivateLetter({ ...f.input, onWalletRequest })).rejects.toThrow("draft is no longer active");
    expect(onWalletRequest).not.toHaveBeenCalled();
    expect(f.contract.registerLetter).not.toHaveBeenCalled();
  });
  it("requires the event to authenticate the recipient, ciphertext and expiry", async () => {
    const f = submissionFixture();
    await expect(submitPrivateLetter(f.input)).resolves.toEqual({ transactionHash: "0xtx" });
    expect(f.contract.registerLetter).toHaveBeenCalledWith(f.input.letter.delivery, f.input.letter.ciphertext, f.input.letter.proof, { chainId: 31337n });
    for (const values of [
      [7, { ...f.blob, payloadHash: `0x${"44".repeat(32)}` }, 9, 1200, 1000],
      [7, f.blob, 8, 1200, 1000],
      [7, f.blob, 9, 1300, 1000],
    ]) {
      const event = f.iface.encodeEventLog(f.iface.getEvent("LetterRegistered")!, values);
      mocks.wait.mockResolvedValue({ transactionHash: "0xtx", receipt: { status: 1, hash: "0xtx", logs: [{ ...event, address: f.input.address }] } });
      await expect(submitPrivateLetter(f.input)).rejects.toThrow("did not register");
    }
  });
});


it("publishes broadcast callbacks and frozen expected call scope", async () => {
  const f = submissionFixture();
  const onBroadcast = vi.fn();
  mocks.wait.mockImplementationOnce(async (input) => {
    input.onSubmitted("0xtx");
    return {transactionHash:"0xtx", receipt:{status:1, logs:[{
      ...f.iface.encodeEventLog(f.iface.getEvent("LetterRegistered")!, [7, f.blob, 9, 1200, 1000]), address:f.input.address,
    }]}};
  });
  await submitPrivateLetter({...f.input, onBroadcast});
  expect(onBroadcast).toHaveBeenCalledWith("0xtx");
  expect(mocks.wait).toHaveBeenCalledWith(expect.objectContaining({
    expected: {chainId:31337n,from:f.input.address,to:f.input.address,
      data:f.iface.encodeFunctionData("registerLetter",[f.input.letter.delivery,f.input.letter.ciphertext,f.input.letter.proof]),value:0n},
    requireSuccess:false,
  }));
});

it("retains confirmation context when a successful receipt lacks the authenticated event", async () => {
  const f = submissionFixture();
  mocks.wait.mockResolvedValueOnce({transactionHash:"0xtx",receipt:{status:1,hash:"0xtx",logs:[]}});
  await expect(submitPrivateLetter(f.input)).rejects.toMatchObject({
    transactionHash:"0xtx",transactionConfirmed:true,verificationFailure:"mismatch",
  });
});

it("reports the wallet and confirmation stages only when those stages begin", async () => {
  const f = submissionFixture();
  const stages: string[] = [];
  const finishWalletRequest = vi.fn();
  const onWalletRequest = vi.fn(() => finishWalletRequest);
  mocks.wait.mockImplementationOnce(async input => {
    expect(stages).toEqual(["checking"]);
    await input.send();
    expect(stages).toEqual(["checking", "submitting"]);
    input.onSubmitted("0xtx");
    return { transactionHash: "0xtx", receipt: { status: 1, logs: [{
      ...f.iface.encodeEventLog(f.iface.getEvent("LetterRegistered")!, [7, f.blob, 9, 1200, 1000]), address: f.input.address,
    }] } };
  });
  await submitPrivateLetter({ ...f.input, onStage: stage => stages.push(stage), onWalletRequest });
  expect(stages).toEqual(["checking", "submitting", "confirming"]);
  expect(onWalletRequest).toHaveBeenCalledOnce();
  expect(finishWalletRequest).toHaveBeenCalledOnce();
});
