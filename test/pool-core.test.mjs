import "../hardhat-test-setup.mjs";
import assert from "node:assert/strict";
import { expect } from "chai";
import hre from "hardhat";
import { poseidon2 } from "poseidon-lite";
import { computeShieldedCiphertextHashField, replayLineageTree } from "@deepfamily/protocol-core";

// This suite isolates canonical ABI, ledger and value-boundary wiring with explicit
// echo verifiers. Cryptographic acceptance is checked by protocol-real-evm.test.mjs.
describe("Canonical pool", function () {
  const abi = hre.ethers.AbiCoder.defaultAbiCoder();
  const ciphertext = byte => `0x${byte.repeat(512)}`;
  const data = (commitment = 100n, overrides = {}) => ({
    inputShardIds: [], inputRoots: [], inputNullifiers: [],
    outputCommitments: [commitment, commitment + 1n],
    outputCiphertexts: [ciphertext("01"), ciphertext("02")], ...overrides,
  });
  const echo = signals => abi.encode(["uint256[]"], [signals]);
  const boundary = (purpose, signals) => abi.encode(["uint8", "uint256[]"], [purpose, signals]);
  const outputs = action => [...action.outputCommitments,
    ...action.outputCiphertexts.map(computeShieldedCiphertextHashField)];
  async function setup() {
    const [owner, recipient] = await hre.ethers.getSigners();
    const poseidon = await hre.ethers.deployContract("PoseidonT3");
    const registry = await hre.ethers.deployContract("PoolReceiveRegistryMock");
    const verifier = await hre.ethers.deployContract("PoolProofVerifierMock");
    const valueVerifier = await hre.ethers.deployContract("PoolBoundaryVerifierMock");
    const token = await hre.ethers.deployContract("PoolTokenMock");
    const args = [await valueVerifier.getAddress(), await registry.getAddress(),
      ...Array(3).fill(await verifier.getAddress())];
    const libraries = { PoseidonT3: await poseidon.getAddress() };
    const native = await (await hre.ethers.getContractFactory("ShieldedNativePool", { libraries })).deploy(...args);
    const erc20 = await (await hre.ethers.getContractFactory("ShieldedErc20Pool", { libraries })).deploy(await token.getAddress(), ...args);
    const chainId = (await hre.ethers.provider.getNetwork()).chainId;
    const prefix = async pool => [chainId, BigInt(await pool.getAddress())];
    const shield = async (pool, action, amount = 1000n, isNative = true) => {
      if (!isNative) { await token.mint(owner.address, amount); await token.approve(await pool.getAddress(), amount); }
      return pool.shield(amount, action, boundary(2, [...await prefix(pool), ...outputs(action), amount]), isNative ? { value: amount } : {});
    };
    return { owner, recipient, token, native, erc20, registry, prefix, shield, args, libraries };
  }

  it("exposes only the canonical receive ABI without legacy configuration or placeholder fields", async () => {
    const { native, erc20 } = await setup();
    assert.equal(await native.protocolVersion(), 1n);
    assert.equal(await erc20.protocolVersion(), 1n);
    for (const name of ["fund", "claim", "privateTransfer", "AUTHORIZATION_STATE", "RECEIVE_VERIFIER", "LINEAGE_INDEX", "receiveActionHash"])
      assert.equal(native.interface.getFunction(name), null);
    const action = native.interface.getFunction("shield").inputs[1];
    assert.deepEqual(action.components.map(field => field.name),
      ["inputShardIds", "inputRoots", "inputNullifiers", "outputCommitments", "outputCiphertexts"]);
  });

  it("uses empty Shield inputs, exact collateral and completed roots, with atomic rejection", async () => {
    const { native, erc20, token, prefix, shield } = await setup();
    const deposit = data();
    const proof = boundary(2, [...await prefix(native), ...outputs(deposit), 1000n]);
    await expect(native.shield(1000n, { ...deposit, inputShardIds: [0], inputRoots: [0], inputNullifiers: [0] }, proof, { value: 1000n }))
      .to.be.revertedWithCustomError(native, "InvalidActionData");
    await expect(native.shield(1000n, deposit, proof, { value: 999n })).to.be.revertedWithCustomError(native, "UnexpectedNativeValue");
    await expect(native.shield(999n, deposit, proof, { value: 999n })).to.be.revertedWithCustomError(native, "InvalidZKProof");
    assert.equal(await native.totalShielded(), 0n);
    await shield(native, deposit);
    const root = (await native.noteShard(0)).root;
    const replay = replayLineageTree(deposit.outputCommitments.map((leaf, i) => ({ leafIndex: BigInt(i), leaf })));
    assert.equal(root, replay.root);
    assert.equal(await native.isKnownNoteRoot(0, deposit.outputCommitments[0]), false);
    assert.equal(await native.isKnownNoteRoot(0, root), true);
    assert.equal(await native.totalShielded(), 1000n);
    const feeDeposit = data(200n);
    await token.setChargeFee(true);
    await expect(shield(erc20, feeDeposit, 1000n, false)).to.be.revertedWithCustomError(erc20, "UnexpectedTokenTransfer");
    assert.equal(await erc20.totalShielded(), 0n);
    assert.equal(await token.balanceOf(await erc20.getAddress()), 0n);
    assert.equal((await erc20.noteShard(0)).size, 0n);
    await token.setChargeFee(false);
    await shield(erc20, feeDeposit, 1000n, false);
    assert.equal(await erc20.totalShielded(), 1000n);
    assert.equal(await token.balanceOf(await erc20.getAddress()), 1000n);
  });

  it("authenticates exact single/four-input withdrawals and rolls back spent/output state on failure", async () => {
    const { native, erc20, token, recipient, prefix, shield } = await setup();
    await shield(native, data());
    const root = (await native.noteShard(0)).root;
    const single = data(200n, { inputShardIds: [0n], inputRoots: [root], inputNullifiers: [31n] });
    const signals = [...await prefix(native), ...single.inputShardIds, ...single.inputRoots, ...single.inputNullifiers,
      ...outputs(single), 100n, BigInt(recipient.address)];
    const proof = boundary(6, signals);
    await expect(native.unshield(recipient.address, 101n, single, proof)).to.be.revertedWithCustomError(native, "InvalidZKProof");
    await expect(native.unshield(recipient.address, 100n, { ...single, inputShardIds: [1n << 128n] }, proof))
      .to.be.revertedWithCustomError(native, "InvalidFieldElement");
    assert.equal(await native.nullifierSpent(31n), false);
    assert.equal(await native.commitmentExists(200n), false);
    await native.unshield(recipient.address, 100n, single, proof);
    assert.equal(await native.totalShielded(), 900n);
    assert.equal(await native.nullifierSpent(31n), true);
    const four = data(300n, { inputShardIds: Array(4).fill(0n), inputRoots: Array(4).fill(root),
      inputNullifiers: [41n, 42n, 43n, 44n] });
    const proof4 = boundary(6, [...await prefix(native), ...four.inputShardIds, ...four.inputRoots,
      ...four.inputNullifiers, ...outputs(four), 20n, BigInt(recipient.address)]);
    const duplicate = { ...four, inputNullifiers: [41n, 42n, 43n, 41n] };
    await expect(native.unshield(recipient.address, 20n, duplicate, proof4)).to.be.revertedWithCustomError(native, "NullifierAlreadySpent");
    await native.unshield(recipient.address, 20n, four, proof4);
    for (const nf of four.inputNullifiers) assert.equal(await native.nullifierSpent(nf), true);
    assert.equal(await native.totalShielded(), 880n);

    await shield(erc20, data(400n), 1000n, false);
    const tokenRoot = (await erc20.noteShard(0)).root;
    const withdrawal = data(500n, { inputShardIds: [0n], inputRoots: [tokenRoot], inputNullifiers: [51n] });
    const tokenProof = boundary(6, [...await prefix(erc20), ...withdrawal.inputShardIds, ...withdrawal.inputRoots,
      ...withdrawal.inputNullifiers, ...outputs(withdrawal), 100n, BigInt(recipient.address)]);
    await token.setChargeFee(true);
    await expect(erc20.unshield(recipient.address, 100n, withdrawal, tokenProof)).to.be.revertedWithCustomError(erc20, "UnexpectedTokenTransfer");
    assert.equal(await erc20.nullifierSpent(51n), false);
    assert.equal(await erc20.commitmentExists(500n), false);
    assert.equal(await erc20.totalShielded(), 1000n);
  });

  it("keeps current eligibility on both create/append and binds the immutable record clock", async () => {
    const { native, registry, prefix, shield } = await setup();
    await shield(native, data());
    const root = (await native.noteShard(0)).root;
    const code = { codeAlias: 61n, commonBinding: 62n, revocationTag: 63n, nonce: 64n,
      ownerCommitment: 65n, viewKeyLo: 66n, viewKeyHi: 67n, expiresAt: 2_000_000_000n };
    const cap = { issuanceRoot: 71n, parentVersion: 1n, capabilityBinding: 72n, familyTag: 73n,
      childTag: 74n, endorsementTag: 75n, trustedTag: 76n };
    const now = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp);
    const deposit = { policyCommitment: 81n, budgetKey: 82n, eligibleFrom: now + 7200n };
    const fundData = (nf, cm) => data(cm, { inputShardIds: [0n], inputRoots: [root], inputNullifiers: [nf] });
    const fundProof = async action => echo([...await prefix(native), code.commonBinding, code.codeAlias, code.nonce,
      code.ownerCommitment, code.viewKeyLo, code.viewKeyHi, cap.capabilityBinding, cap.familyTag, cap.parentVersion,
      deposit.policyCommitment, deposit.budgetKey, deposit.eligibleFrom, root, action.inputNullifiers[0], ...outputs(action)]);
    const initial = fundData(91n, 600n);
    await registry.setStatus(true, false);
    await expect(native.depositBudget(code, cap, "0x", "0x", deposit, initial, await fundProof(initial)))
      .to.be.revertedWithCustomError(native, "InvalidReceiveProof");
    assert.equal((await native.budgetRecords(deposit.budgetKey)).exists, false);
    await registry.setStatus(true, true);
    await native.depositBudget(code, cap, "0x", "0x", deposit, initial, await fundProof(initial));
    const append = fundData(92n, 700n);
    await expect(native.depositBudget(code, cap, "0x", "0x", { ...deposit, eligibleFrom: deposit.eligibleFrom + 1n }, append, await fundProof(append)))
      .to.be.revertedWithCustomError(native, "InvalidBudget");
    await registry.setStatus(true, false);
    await expect(native.depositBudget(code, cap, "0x", "0x", deposit, append, await fundProof(append)))
      .to.be.revertedWithCustomError(native, "InvalidReceiveProof");
    assert.equal(await native.nullifierSpent(92n), false);
    assert.equal(await native.commitmentExists(700n), false);
    await registry.setStatus(true, true);
    await native.depositBudget(code, cap, "0x", "0x", deposit, append, await fundProof(append));
    assert.equal((await native.budgetRecords(deposit.budgetKey)).eligibleFrom, deposit.eligibleFrom);
  });

  it("rolls back rejected and reentrant native payouts, then permits a valid retry", async () => {
    const { native, prefix, shield } = await setup();
    await shield(native, data());
    const receiver = await hre.ethers.deployContract("ShieldedNativeReceiverMock");
    const address = await receiver.getAddress();
    const action = data(800n, { inputShardIds: [0n],
      inputRoots: [(await native.noteShard(0)).root], inputNullifiers: [93n] });
    const proof = boundary(6, [...await prefix(native), ...action.inputShardIds,
      ...action.inputRoots, ...action.inputNullifiers, ...outputs(action), 100n, BigInt(address)]);
    const call = native.interface.encodeFunctionData("unshield", [address, 100n, action, proof]);
    for (const mode of [1, 2]) {
      await receiver.configure(mode, await native.getAddress(), call);
      await expect(native.unshield(address, 100n, action, proof))
        .to.be.revertedWithCustomError(native, "NativeTransferFailed");
      assert.equal(await native.nullifierSpent(93n), false);
      assert.equal(await native.commitmentExists(800n), false);
      assert.equal((await native.noteShard(0)).size, 2n);
      assert.equal(await native.totalShielded(), 1000n);
    }
    await receiver.configure(0, address, "0x");
    await native.unshield(address, 100n, action, proof);
    assert.equal(await native.totalShielded(), 900n);
    assert.equal(await hre.ethers.provider.getBalance(address), 100n);
  });

  it("rejects token callbacks and external collateral loss without changing the ledger", async () => {
    const { owner, recipient, prefix, args, libraries } = await setup();
    const token = await hre.ethers.deployContract("ShieldedPoolBehaviorTokenMock", [18]);
    const pool = await (await hre.ethers.getContractFactory("ShieldedErc20Pool", { libraries }))
      .deploy(await token.getAddress(), ...args);
    await token.mint(owner.address, 1000n);
    await token.approve(await pool.getAddress(), 1000n);
    const action = data();
    const proof = boundary(2, [...await prefix(pool), ...outputs(action), 1000n]);
    await token.setCallback(await pool.getAddress(), pool.interface.encodeFunctionData("shield", [1000n, action, proof]));
    await token.setBehavior(5, owner.address, await pool.getAddress());
    await expect(pool.shield(1000n, action, proof)).to.be.revertedWithCustomError(token, "TokenCallbackFailed");
    assert.equal(await pool.totalShielded(), 0n);
    assert.equal(await token.balanceOf(owner.address), 1000n);
    await token.setBehavior(0, owner.address, await pool.getAddress());
    await pool.shield(1000n, action, proof);
    await token.burn(await pool.getAddress(), 1n);
    const withdrawal = data(900n, { inputShardIds: [0n],
      inputRoots: [(await pool.noteShard(0)).root], inputNullifiers: [94n] });
    const exitProof = boundary(6, [...await prefix(pool), ...withdrawal.inputShardIds,
      ...withdrawal.inputRoots, ...withdrawal.inputNullifiers, ...outputs(withdrawal), 100n, BigInt(recipient.address)]);
    await expect(pool.unshield(recipient.address, 100n, withdrawal, exitProof))
      .to.be.revertedWithCustomError(pool, "InsufficientCollateral");
    assert.equal(await pool.totalShielded(), 1000n);
    assert.equal(await pool.nullifierSpent(94n), false);
    assert.equal(await pool.commitmentExists(900n), false);
    assert.equal(await token.balanceOf(recipient.address), 0n);
  });

  it("keeps compact paths and completed roots at depth 32 and shard rollover", async () => {
    const { owner, token, prefix, args, libraries } = await setup();
    for (const [name, seed, shardId, leafIndex] of [
      ["ShieldedPoolDepthHarness", "seedSyntheticLeftSubtree", 0n, 1n << 31n],
      ["ShieldedPoolRolloverHarness", "seedFullShard", 1n, 0n],
    ]) {
      const pool = await (await hre.ethers.getContractFactory(name, { libraries }))
        .deploy(await token.getAddress(), ...args);
      if (seed === "seedSyntheticLeftSubtree") await pool[seed](123n);
      else await pool[seed]();
      await token.mint(owner.address, 1000n);
      await token.approve(await pool.getAddress(), 1000n);
      const action = data(1000n);
      await pool.shield(1000n, action, boundary(2, [...await prefix(pool), ...outputs(action), 1000n]));
      const path = await pool.getNoteMerkleProof(shardId, leafIndex);
      const pair = poseidon2(action.outputCommitments);
      assert.equal(path.leaf, 1000n);
      assert.equal(path.proofRoot, shardId === 0n ? poseidon2([123n, pair]) : pair);
      assert.deepEqual([...path.siblings], shardId === 0n ? [1001n, 123n] : [1001n]);
      assert.equal(path.proofIndex, shardId === 0n ? 2n : 0n);
      assert.equal(await pool.isKnownNoteRoot(shardId, 1000n), false);
      assert.equal(await pool.isKnownNoteRoot(shardId, path.proofRoot), true);
      assert.equal((await pool.noteShard(shardId)).depth, shardId === 0n ? 32n : 1n);
    }
  });
});

describe("Canonical VALUE boundary verifier adapter", function () {
  it("pins Shield, Unshield and Unshield4 and rejects all other purposes/encodings/arities", async () => {
    const mock = async (id, width) => hre.ethers.deployContract("BoundaryGeneratedVerifierMock", [id, width]);
    const shield = await mock(101, 7), unshield = await mock(102, 11), unshield4 = await mock(103, 20);
    const adapter = await hre.ethers.deployContract("ShieldedBoundaryVerifierAdapter",
      [await shield.getAddress(), await unshield.getAddress(), await unshield4.getAddress()]);
    const proof = (id, width) => hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256[2]", "uint256[2][2]", "uint256[2]"], [[id, width], [[0, 0], [0, 0]], [0, 0]]);
    for (const [purpose, id, width] of [[2, 101, 7], [6, 102, 11], [6, 103, 20]]) {
      const signals = [id, ...Array(width - 1).fill(0)];
      assert.equal(await adapter.verifyProof(purpose, 1, proof(id, width), signals), true);
      assert.equal(await adapter.verifyProof(purpose, 1, proof(id + 1, width), signals), false);
      await expect(adapter.verifyProof(purpose, 0, proof(id, width), signals)).to.be.revertedWithCustomError(adapter, "UnsupportedProofEncoding");
      await expect(adapter.verifyProof(purpose, 1, "0x", signals)).to.be.revertedWithCustomError(adapter, "MalformedProofData");
    }
    for (const purpose of [0, 1, 3, 4, 5, 7])
      await expect(adapter.verifyProof(purpose, 1, proof(101, 7), Array(7).fill(0))).to.be.revertedWithCustomError(adapter, "UnsupportedPurpose");
    for (const [purpose, width] of [[2, 11], [2, 20], [6, 7], [6, 12]])
      await expect(adapter.verifyProof(purpose, 1, proof(101, width), Array(width).fill(0))).to.be.revertedWithCustomError(adapter, "MalformedProofData");
  });
});
