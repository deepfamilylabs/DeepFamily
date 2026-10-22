import { beforeEach, describe, expect, it, vi } from "vitest";
import { Contract, Interface, id, keccak256, type Signer } from "ethers";
import { PRIVATE_LETTER_ABI, PrivateLetterPreparationExpiredError, readPrivateLetters, submitPrivateLetter } from "./privateLetterChain";
const mocks = vi.hoisted(() => ({ readBlob: vi.fn(), contract: vi.fn(), validateCheckpoint: vi.fn(), wait: vi.fn() }));
vi.mock("@deepfamily/protocol-core", async original => ({ ...await original<typeof import("@deepfamily/protocol-core")>(), readArchiveBlob: mocks.readBlob }));
vi.mock("ethers", async original => ({ ...await original<typeof import("ethers")>(), Contract: class { constructor() { return mocks.contract(); } } }));
vi.mock("./shieldedIdentityAuthorizationChain", () => ({ createIdentityAuthorizationContract: () => ({ validateCheckpoint: mocks.validateCheckpoint }) }));
vi.mock("./shieldedTransactionReceipt", () => ({ waitForShieldedTransaction: mocks.wait }));
beforeEach(() => { vi.clearAllMocks(); mocks.validateCheckpoint.mockReset().mockResolvedValue(0n); });
function fixture() {
  const iface = new Interface(PRIVATE_LETTER_ABI);
  const blob = { payloadHash: `0x${"33".repeat(32)}`, pointer: "0x2222222222222222222222222222222222222222", payloadLength: 3n, segmentCount: 1n };
  const record = { blob, recipientBinding: 9n, relationCommitment: 0n, expiresAt: 1200n, registeredAt: 1000n };
  const event = iface.encodeEventLog(iface.getEvent("LetterRegistered")!, [7, blob, 9, 0, 1200, 1000]);
  const provider = { getBlockNumber: async () => 20, getBlock: vi.fn(async () => ({ hash: "0xanchor" })), getCode: vi.fn(),
    getLogs: vi.fn(async (_filter: { topics: unknown[] }) => [{ ...event, blockNumber: 15, index: 0, transactionHash: "0xtransaction" }]) };
  const contract = { runner: { provider }, interface: iface, creationBlock: async () => 10,
    getAddress: async () => "0x1111111111111111111111111111111111111111", letterRecord: vi.fn(async () => record) };
  mocks.readBlob.mockResolvedValue({ payloadHash: blob.payloadHash, payload: Uint8Array.of(1, 2, 3) });
  return { provider, contract, record };
}
describe("authenticated private letter recovery", () => {
  it("accepts only the configured archive events and matching records before fetching ciphertext", async () => {
    const f = fixture(); const letters = await readPrivateLetters(f.contract as unknown as Contract);
    expect(letters).toMatchObject([{ messageId: "7", recipientBinding: "9", relationCommitment: "0", transactionHash: "0xtransaction", ciphertext: Uint8Array.of(1, 2, 3) }]);
    expect(f.provider.getLogs.mock.calls[0][0].topics).toHaveLength(1);
    expect(mocks.readBlob).toHaveBeenCalledWith(expect.objectContaining({ blockTag: 20, payloadHash: f.record.blob.payloadHash }));
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

function submissionFixture() {
  const address = "0x1111111111111111111111111111111111111111";
  const iface = new Interface(PRIVATE_LETTER_ABI);
  const letter = { delivery: { messageId: "7", checkpointId: "1", asOf: "900", expiresAt: "1200", recipientBinding: "9" }, ciphertext: "0x010203", proof: "0x1234" };
  const blob = { payloadHash: keccak256(letter.ciphertext), pointer: "0x2222222222222222222222222222222222222222", payloadLength: 3n, segmentCount: 1n };
  const contract = {
    interface: iface, AUTHORIZATION_STATE: async () => address,
    letterRecord: vi.fn(async () => ({ registeredAt: 0n })),
    registerLetter: vi.fn(async () => ({ hash: "0xtx" })),
    registerAttachedLetter: vi.fn(async () => ({ hash: "0xtx" })),
    queryFilter: vi.fn(async () => [{ transactionHash: "0xprior" }]),
    creationBlock: async () => 1, filters: { LetterRegistered: vi.fn() },
  };
  const provider = { getNetwork: async () => ({ chainId: 31337n }), getBlock: vi.fn(async () => ({ timestamp: 1000 })) };
  const signer = { provider } as unknown as Signer;
  const registration = iface.encodeEventLog(iface.getEvent("LetterRegistered")!, [7, blob, 9, 0, 1200, 1000]);
  mocks.contract.mockReturnValue(contract);
  mocks.wait.mockResolvedValue({ transactionHash: "0xtx", receipt: { logs: [{ ...registration, address }] } });
  return { input: { address, signer, chainId: "31337", letter }, contract, provider, iface, blob };
}

describe("private letter retry and receipt confirmation", () => {
  it("reconciles an already registered message before checking its now-expired receive code", async () => {
    const f = submissionFixture();
    f.contract.letterRecord.mockResolvedValue({ registeredAt: 1000n, recipientBinding: 9n, relationCommitment: 0n, expiresAt: 1200n, blob: f.blob } as never);
    f.provider.getBlock.mockResolvedValue({ timestamp: 1300 });
    await expect(submitPrivateLetter(f.input)).resolves.toEqual({ transactionHash: "0xprior" });
    expect(f.contract.registerLetter).not.toHaveBeenCalled();
    expect(mocks.validateCheckpoint).not.toHaveBeenCalled();
  });
  it("rejects a retry if the existing registration authenticates a different expiry", async () => {
    const f = submissionFixture();
    f.contract.letterRecord.mockResolvedValue({ registeredAt: 1000n, recipientBinding: 9n, relationCommitment: 0n, expiresAt: 1300n, blob: f.blob } as never);
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
    const f = submissionFixture();
    let current = true;
    mocks.validateCheckpoint.mockImplementation(async () => { current = false; });
    const onWalletRequest = vi.fn();
    await expect(submitPrivateLetter({ ...f.input, isCurrent: () => current, onWalletRequest })).rejects.toThrow("wallet changed");
    expect(onWalletRequest).not.toHaveBeenCalled();
    expect(f.contract.registerLetter).not.toHaveBeenCalled();
  });
  it("requires the event to authenticate the ciphertext, relation and expiry", async () => {
    const f = submissionFixture();
    await expect(submitPrivateLetter(f.input)).resolves.toEqual({ transactionHash: "0xtx" });
    expect(f.contract.registerLetter).toHaveBeenCalledWith(f.input.letter.delivery, f.input.letter.ciphertext, f.input.letter.proof, { chainId: 31337n });
    for (const values of [
      [7, { ...f.blob, payloadHash: `0x${"44".repeat(32)}` }, 9, 0, 1200, 1000],
      [7, f.blob, 9, 8, 1200, 1000],
      [7, f.blob, 9, 0, 1300, 1000],
    ]) {
      const event = f.iface.encodeEventLog(f.iface.getEvent("LetterRegistered")!, values);
      mocks.wait.mockResolvedValue({ transactionHash: "0xtx", receipt: { logs: [{ ...event, address: f.input.address }] } });
      await expect(submitPrivateLetter(f.input)).rejects.toThrow("did not register");
    }
  });
});
