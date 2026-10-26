import assert from "node:assert/strict";
import { Interface, keccak256 } from "ethers";
import {
  RECEIVE_POOL_INTERFACE,
  verifyReceiveProtocolReceipts,
  verifyReceiveProtocolRejections,
} from "../scripts/lib/receiveProtocolEvidence.mjs";

const address = (value) => `0x${value.toString(16).padStart(40, "0")}`;
const hash = (value) => `0x${value.toString(16).padStart(64, "0")}`;
const addresses = {
  eligibilitySource: address(11), receiveRegistry: address(12), deepFamily: address(13),
  shieldedNativePool: address(14), shieldedErc20Pool: address(15), letterArchive: address(16),
};
const code = ["31", "61", "2", "3", "4", "5", "6", "1000000"];
const capability = ["100", "1", "2", "3", "101", "102", "103"];
const data = [["0"], ["22"], ["33"], ["44", "55"], ["0x12", "0x34"]];
const deposit = ["71", "77", "1000"];
const SOURCE = new Interface(["function isRoleRevoked(uint8 role,uint256 index) view returns(bool)"]);
const ERRORS = new Interface(["error QualificationRevoked(uint8 role)", "error InvalidProof()", "error InvalidZKProof()"]);
const encodeDeposit = (cap = capability, terms = deposit) => RECEIVE_POOL_INTERFACE.encodeFunctionData("depositBudget", [code, cap, "0x1234", "0x5678", terms, data, "0xabcd"]);
function fixture() {
  const tx = {
    hash: hash(1), to: addresses.shieldedNativePool, from: address(90), chainId: 31337n,
    blockNumber: 10, blockHash: hash(10), gasLimit: 800000n, data: encodeDeposit(),
  };
  const event = (name, values) => ({ address: tx.to, ...RECEIVE_POOL_INTERFACE.encodeEventLog(RECEIVE_POOL_INTERFACE.getEvent(name), values) });
  const receipt = {
    hash: tx.hash, to: tx.to, status: 1, blockNumber: tx.blockNumber, blockHash: tx.blockHash,
    gasUsed: 600000n,
    logs: [event("ActionExecuted", [1, 0, 0]), event("NullifierSpent", [33]),
      event("NoteAppended", [0, 0, 44, 88, "0x12"]), event("NoteAppended", [0, 1, 55, 99, "0x34"]),
      event("BudgetDeposited", [77, 61, true])],
  };
  const block = { number: 10, hash: hash(10), gasLimit: 15000000n };
  const calls = [];
  const provider = {
    getNetwork: async () => ({ chainId: 31337n }),
    getTransaction: async () => tx,
    getTransactionReceipt: async () => receipt,
    getCode: async () => "0x6000",
    getBlock: async () => block,
    send: async (method, args) => {
      calls.push([method, args]);
      if (method === "eth_chainId") return "0x7a69";
      assert.equal(method, "eth_call");
      if (args[0].to.toLowerCase() === addresses.eligibilitySource) {
        const parsed = SOURCE.parseTransaction(args[0]);
        return SOURCE.encodeFunctionResult("isRoleRevoked", [parsed.args.index === 101n]);
      }
      const parsed = RECEIVE_POOL_INTERFACE.parseTransaction(args[0]);
      if (parsed.name === "budgetRecords") {
        return RECEIVE_POOL_INTERFACE.encodeFunctionResult("budgetRecords", [parsed.args[0] === 77n, 61, 71, 1000, 31, 3, 4, 5, 6]);
      }
      const indices = parsed.name === "claimBudget" ? parsed.args.claimData : parsed.args.capability;
      const errorName = indices.childRoleIndex === 101n ? "QualificationRevoked" : parsed.name === "claimBudget" ? "InvalidZKProof" : "InvalidProof";
      throw { data: ERRORS.encodeErrorResult(errorName, errorName === "QualificationRevoked" ? [0] : []) };
    },
  };
  return { tx, receipt, block, calls, provider };
}
const receiptInput = (provider) => ({ provider, expectedChainId: 31337, addresses, transactions: [{ label: "receive-native-fund", action: "fund", asset: "native", hash: hash(1) }] });
const rejected = (overrides = {}) => ({
  operation: "append", kind: "revoked", errorName: "QualificationRevoked", errorArgs: ["0"],
  blockNumber: 10, blockHash: hash(10), to: addresses.shieldedNativePool, from: address(90),
  data: encodeDeposit(), ...overrides,
});
const rejectionInput = (provider, rejections = [rejected()]) => ({ provider, expectedChainId: 31337, addresses, roleRevocations: [{ role: 0, roleIndex: "101", otherRoleIndex: "901", transactionLabel: "receive-revoke-0", rejections }] });

describe("receiving protocol evidence RPC observations", function () {
  it("checks canonical deposit calldata, budget event, all notes/nullifiers and pinned-block budget state", async () => {
    const { provider, calls } = fixture();
    const result = await verifyReceiveProtocolReceipts(receiptInput(provider));
    const observed = result.transactions["receive-native-fund"];
    assert.equal(result.rpcChecks, "passed");
    assert.equal(observed.publicInput.budgetKey, "77");
    assert.equal(observed.publicInput.commonBinding, "61");
    assert.equal(observed.publicInput.created, true);
    assert.deepEqual(observed.publicInput.roleIndices, ["101", "102", "103"]);
    assert.equal(observed.calldataHash, keccak256(encodeDeposit()));
    assert.equal(Object.keys(observed.proofHashes).length, 3);
    assert.ok(calls.some(([method, args]) => method === "eth_call" && args[1] === "0xa"));
  });

  it("rejects reorganized inclusion, wrong targets and wrong methods before accepting an observation", async () => {
    for (const mutate of [
      ({ block }) => { block.hash = hash(999); },
      ({ tx }) => { tx.to = addresses.shieldedErc20Pool; },
      ({ tx }) => { tx.data = RECEIVE_POOL_INTERFACE.encodeFunctionData("claimBudget", [[77, 1000, 99, 100, 101, 102, 103], data, "0x1234"]); },
      ({ receipt }) => { receipt.status = 0; },
      ({ tx }) => { tx.chainId = 71n; },
    ]) {
      const state = fixture(); mutate(state);
      await assert.rejects(verifyReceiveProtocolReceipts(receiptInput(state.provider)));
    }
  });

  it("rejects renamed first/append receipts, missing events and ciphertext/nullifier substitution", async () => {
    for (const mutate of [
      ({ receipt }) => { receipt.logs = receipt.logs.filter((log) => RECEIVE_POOL_INTERFACE.parseLog(log).name !== "BudgetDeposited"); },
      ({ receipt }) => { receipt.logs[2] = { address: addresses.shieldedNativePool, ...RECEIVE_POOL_INTERFACE.encodeEventLog(RECEIVE_POOL_INTERFACE.getEvent("NoteAppended"), [0, 0, 44, 88, "0x99"]) }; },
      ({ receipt }) => { receipt.logs[1] = { address: addresses.shieldedNativePool, ...RECEIVE_POOL_INTERFACE.encodeEventLog(RECEIVE_POOL_INTERFACE.getEvent("NullifierSpent"), [999]) }; },
    ]) {
      const state = fixture(); mutate(state);
      await assert.rejects(verifyReceiveProtocolReceipts(receiptInput(state.provider)));
    }
    const state = fixture(); const input = receiptInput(state.provider); input.transactions[0].action = "append";
    await assert.rejects(verifyReceiveProtocolReceipts(input), /classification differs/u);
  });

  it("replays revoked and substituted qualification calls at the canonical observation block", async () => {
    const state = fixture();
    const replacement = [...capability]; replacement[4] = "901";
    const result = await verifyReceiveProtocolRejections(rejectionInput(state.provider, [rejected(), rejected({kind:"index-substitution",errorName:"InvalidProof",errorArgs:[],data:encodeDeposit(replacement)})]));
    assert.deepEqual(result[0].rejections.map((item) => item.rpcChecks), ["passed", "passed"]);
    assert.equal(result[0].rejections[1].publicInput.roleIndices[0], "901");
    assert.ok(state.calls.filter(([method]) => method === "eth_call").every(([, args]) => args[1] === "0xa"));
  });

  it("rejects fabricated rejection types, stale role state and replay calls that succeed", async () => {
    for (const overrides of [
      {errorName:"InvalidProof"}, {errorArgs:["1"]}, {operation:"first"},
      {kind:"index-substitution",errorName:"InvalidProof",errorArgs:[]},
      {to:address(999)}, {blockHash:hash(999)},
    ]) {
      const state = fixture();
      await assert.rejects(verifyReceiveProtocolRejections(rejectionInput(state.provider,[rejected(overrides)])));
    }
    const state = fixture(), original = state.provider.send;
    state.provider.send = async (method,args) => args?.[0]?.data === encodeDeposit() ? "0x" : original(method,args);
    await assert.rejects(verifyReceiveProtocolRejections(rejectionInput(state.provider)), /unexpectedly succeeded/u);
  });
});
