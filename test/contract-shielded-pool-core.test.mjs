import { deployIdentityAuthorizationState } from "./helpers/shieldedReceiveAuthorization.mjs";
import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import {
  buildShieldedPoolPublicSignals,
  encodePublicShieldedBudgetEnvelope,
  replayLineageTree,
} from "@deepfamily/protocol-core";

const ciphertext = (byte) => `0x${byte.repeat(512)}`;
// ProofConstants.PROOF_PURPOSE_SHIELDED_ACTION_BASE.
const ACTION_PURPOSE_BASE = 2;
const emptyAuthorization = () => ({
  checkpointId: 0n,
  asOf: 0n,
  expiresAt: 0n,
  recipientBinding: 0n,
  proof: "0x",
});

describe("ShieldedErc20Pool contract boundaries", function () {
  async function setup(poolContractName = "ShieldedErc20Pool") {
    const [depositor, recipient] = await hre.ethers.getSigners();
    const token = await hre.ethers.deployContract("ShieldedPoolTokenMock");
    const lineage = await hre.ethers.deployContract("ShieldedPoolLineageMock");
    const verifier = await hre.ethers.deployContract("ShieldedPoolVerifierMock");
    const counterVerifier = await hre.ethers.deployContract("IdentityCounterVerifierMock");
    const authorizationState = await deployIdentityAuthorizationState(
      hre,
      await counterVerifier.getAddress(),
    );
    const receiveVerifier = await hre.ethers.deployContract("PrivateLetterVerifierMock");
    const poseidon = await hre.ethers.deployContract("PoseidonT3");
    await Promise.all([
      token.waitForDeployment(),
      lineage.waitForDeployment(),
      verifier.waitForDeployment(),
      poseidon.waitForDeployment(),
    ]);
    const Pool = await hre.ethers.getContractFactory(poolContractName, {
      libraries: { PoseidonT3: await poseidon.getAddress() },
    });
    const pool = await Pool.deploy(
      await token.getAddress(),
      await lineage.getAddress(),
      await verifier.getAddress(),
      await authorizationState.getAddress(),
      await receiveVerifier.getAddress(),
    );
    await pool.waitForDeployment();
    await token.mint(depositor.address, 1_000n);
    await token.connect(depositor).approve(await pool.getAddress(), 1_000n);
    return { pool, token, lineage, authorizationState, receiveVerifier, depositor, recipient };
  }

  const actionData = (overrides = {}) => ({
    inputShardIds: [0n, 0n],
    inputRoots: [0n, 0n],
    inputNullifiers: [0n, 0n],
    periodNullifiers: Array(3).fill(0n),
    outputCommitments: [101n, 102n],
    outputCiphertexts: [ciphertext("01"), ciphertext("02")],
    relation0: 0n,
    relation1: 0n,
    asOf: 0n,
    lineageCheckpointId: 0n,
    fundMode: 0n,
    budgetKind: 0n,
    receiveAuthorizations: [emptyAuthorization(), emptyAuthorization()],
    ...overrides,
  });

  const valueActionData = (overrides = {}) => {
    const data = actionData(overrides);
    const pad = (values, filler) =>
      Array.from({ length: 4 }, (_, slot) => values[slot] ?? filler(slot));
    return {
      ...data,
      inputShardIds: pad(data.inputShardIds, () => data.inputShardIds[0]),
      inputRoots: pad(data.inputRoots, () => data.inputRoots[0]),
      inputNullifiers: pad(
        data.inputNullifiers,
        (slot) => data.inputNullifiers[0] * 100n + BigInt(slot),
      ),
    };
  };

  async function proofFor(pool, action, data, amount = 0n, recipient) {
    const network = await hre.ethers.provider.getNetwork();
    if (
      action === 1 &&
      data.budgetKind === 0n &&
      data.receiveAuthorizations[0].recipientBinding === 0n
    ) {
      await authorize(pool, data, 0, 3);
    }
    const signals = buildShieldedPoolPublicSignals({
      action,
      chainId: network.chainId,
      poolAddress: await pool.getAddress(),
      ...data,
      receiveBindings: data.receiveAuthorizations.map((item) => item.recipientBinding),
      amount,
      recipient,
    });
    // The test mock compares these bytes to the purpose and public signals that the contract
    // builds, so a match also shows the pool and protocol-core agree on each action's layout.
    // It proves wiring, not soundness of any shielded note transition.
    return hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "uint256[]"],
      [ACTION_PURPOSE_BASE + action, signals],
    );
  }

  async function authorize(
    pool,
    data,
    slot,
    action,
    { expiresAt, checkpointId = 1n, asOf, binding = 777n } = {},
  ) {
    const latest = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp);
    const state = await hre.ethers.getContractAt(
      "IdentityAuthorizationState",
      await pool.AUTHORIZATION_STATE(),
    );
    const authorization = {
      checkpointId,
      asOf: asOf ?? latest,
      expiresAt: expiresAt ?? latest + 3600n,
      recipientBinding: binding,
      proof: "0x",
    };
    const hash = BigInt(await pool.receiveActionHash(data));
    const root = (await state.getCheckpoint(checkpointId)).root;
    const inputs = [
      (await hre.ethers.provider.getNetwork()).chainId,
      BigInt(await pool.getAddress()),
      BigInt(action),
      BigInt(slot),
      hash & ((1n << 128n) - 1n),
      hash >> 128n,
      checkpointId,
      root,
      authorization.asOf,
      authorization.expiresAt,
      binding,
    ];
    authorization.proof = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256[11]"], [inputs]);
    data.receiveAuthorizations[slot] = authorization;
    return authorization;
  }

  it("authenticates every private Fund, including top-ups, before atomically spending notes", async () => {
    const { pool } = await setup();
    const deposit = actionData();
    await pool.shield(100n, deposit, await proofFor(pool, 0, deposit, 100n));
    const root = (await pool.noteShard(0)).root;
    const funding = actionData({
      fundMode: 1n,
      inputRoots: [root, root],
      inputNullifiers: [901n, 902n],
      outputCommitments: [903n, 904n],
    });
    const proof = await proofFor(pool, 1, funding);
    const original = structuredClone(funding);
    const missing = structuredClone(funding);
    missing.receiveAuthorizations[0] = emptyAuthorization();
    await expect(pool.fund(missing, proof)).to.be.revertedWithCustomError(
      pool,
      "InvalidReceiveAuthorization",
    );
    const wrongExpiry = structuredClone(funding);
    wrongExpiry.receiveAuthorizations[0].expiresAt += 1n;
    await expect(pool.fund(wrongExpiry, proof)).to.be.revertedWithCustomError(
      pool,
      "InvalidReceiveProof",
    );
    const wrongBody = {
      ...funding,
      outputCiphertexts: [ciphertext("11"), funding.outputCiphertexts[1]],
    };
    await expect(pool.fund(wrongBody, proof)).to.be.revertedWithCustomError(
      pool,
      "InvalidReceiveProof",
    );
    const changeReceipt = structuredClone(funding);
    changeReceipt.receiveAuthorizations[1] = changeReceipt.receiveAuthorizations[0];
    await expect(pool.fund(changeReceipt, proof)).to.be.revertedWithCustomError(
      pool,
      "InvalidReceiveAuthorization",
    );
    await expect(pool.fund(funding, "0x")).to.be.revertedWithCustomError(pool, "InvalidZKProof");
    expect(await pool.nullifierSpent(901n)).to.equal(false);
    expect(await pool.commitmentExists(903n)).to.equal(false);
    expect((await pool.noteShard(0)).size).to.equal(2n);
    expect(funding).to.deep.equal(original);
    await pool.fund(funding, proof);
    expect(await pool.nullifierSpent(901n)).to.equal(true);
  });

  it("binds transfer receipts to their exact output slots and rejects unauthenticated expiry metadata", async () => {
    const { pool } = await setup();
    const deposit = actionData();
    await pool.shield(100n, deposit, await proofFor(pool, 0, deposit, 100n));
    const root = (await pool.noteShard(0)).root;
    const transfer = valueActionData({
      inputRoots: [root, root],
      inputNullifiers: [921n, 922n],
      outputCommitments: [923n, 924n],
    });
    await authorize(pool, transfer, 0, 4);
    await authorize(pool, transfer, 1, 4, { binding: 778n });
    const proof = await proofFor(pool, 3, transfer);
    const swapped = {
      ...transfer,
      receiveAuthorizations: [...transfer.receiveAuthorizations].reverse(),
    };
    await expect(pool.privateTransfer(swapped, proof)).to.be.revertedWithCustomError(
      pool,
      "InvalidReceiveProof",
    );
    const noBinding = structuredClone(transfer);
    noBinding.receiveAuthorizations[0].recipientBinding = 0n;
    await expect(pool.privateTransfer(noBinding, proof)).to.be.revertedWithCustomError(
      pool,
      "InvalidReceiveAuthorization",
    );
    await pool.privateTransfer(transfer, proof);
  });

  it("rejects expired codes at the exact expiry and retired shared counter checkpoints", async () => {
    const { pool, authorizationState } = await setup();
    const deposit = actionData();
    await pool.shield(100n, deposit, await proofFor(pool, 0, deposit, 100n));
    const root = (await pool.noteShard(0)).root;
    const funding = actionData({
      fundMode: 1n,
      inputRoots: [root, root],
      inputNullifiers: [941n, 942n],
      outputCommitments: [943n, 944n],
    });
    const expiry = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp) + 20n;
    await authorize(pool, funding, 0, 3, { expiresAt: expiry });
    const proof = await proofFor(pool, 1, funding);
    await hre.networkHelpers.time.increaseTo(expiry);
    await expect(pool.fund.staticCall(funding, proof)).to.be.revertedWithCustomError(
      pool,
      "ExpiredReceiveCode",
    );
    await authorize(pool, funding, 0, 3, { expiresAt: expiry + 7200n });
    const checkpointProof = await proofFor(pool, 1, funding);
    const inputs = [
      961n,
      (await hre.ethers.provider.getNetwork()).chainId,
      BigInt(await authorizationState.getAddress()),
      99101n,
      0n,
      1n,
    ];
    const updateProof = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256[6]"], [inputs]);
    await authorizationState.incrementCounter(961n, 99101n, 0n, 1n, updateProof);
    const { retiredAt } = await authorizationState.getCheckpoint(1n);
    await hre.networkHelpers.time.increaseTo(retiredAt + 899n);
    await pool.fund.staticCall(funding, checkpointProof);
    await hre.networkHelpers.time.increaseTo(retiredAt + 900n);
    await expect(pool.fund.staticCall(funding, checkpointProof)).to.be.revertedWithCustomError(
      authorizationState,
      "CheckpointExpired",
    );
    expect(await pool.nullifierSpent(941n)).to.equal(false);
  });

  it("rejects every unauthenticated time, state and recipient field before spending transfer inputs", async () => {
    const { pool, authorizationState } = await setup();
    const deposit = actionData();
    await pool.shield(100n, deposit, await proofFor(pool, 0, deposit, 100n));
    const root = (await pool.noteShard(0)).root;
    const transfer = valueActionData({
      inputRoots: [root, root],
      inputNullifiers: [971n, 972n],
      outputCommitments: [973n, 974n],
    });
    await authorize(pool, transfer, 0, 4);
    await authorize(pool, transfer, 1, 4, { binding: 778n });
    const proof = await proofFor(pool, 3, transfer);
    for (const slot of [0, 1]) {
      for (const field of ["asOf", "expiresAt", "recipientBinding"]) {
        const changed = structuredClone(transfer);
        // Keep a valid state time to ensure the exact proof binding rejects the metadata.
        changed.receiveAuthorizations[slot][field] += field === "asOf" ? -1n : 1n;
        await expect(pool.privateTransfer(changed, proof)).to.be.revertedWithCustomError(
          pool,
          "InvalidReceiveProof",
        );
      }
      const missingProof = structuredClone(transfer);
      missingProof.receiveAuthorizations[slot].proof = "0x";
      await expect(pool.privateTransfer(missingProof, proof)).to.be.revertedWithCustomError(
        pool,
        "InvalidReceiveAuthorization",
      );
      const unknown = structuredClone(transfer);
      unknown.receiveAuthorizations[slot].checkpointId = 2n;
      await expect(pool.privateTransfer(unknown, proof)).to.be.revertedWithCustomError(
        authorizationState,
        "UnknownCheckpoint",
      );
    }
    expect(await pool.nullifierSpent(971n)).to.equal(false);
    expect(await pool.commitmentExists(973n)).to.equal(false);
    await pool.privateTransfer(transfer, proof);
  });

  it("checks expiry independently for every transfer output and accepts a fresh matching receipt", async () => {
    const { pool } = await setup();
    const deposit = actionData();
    await pool.shield(100n, deposit, await proofFor(pool, 0, deposit, 100n));
    const root = (await pool.noteShard(0)).root;
    const transfer = valueActionData({
      inputRoots: [root, root],
      inputNullifiers: [981n, 982n],
      outputCommitments: [983n, 984n],
    });
    const deadline = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp) + 20n;
    await authorize(pool, transfer, 0, 4, { expiresAt: deadline + 3600n });
    await authorize(pool, transfer, 1, 4, { expiresAt: deadline, binding: 778n });
    const proof = await proofFor(pool, 3, transfer);
    await hre.networkHelpers.time.increaseTo(deadline - 1n);
    await pool.privateTransfer.staticCall(transfer, proof);
    await hre.networkHelpers.time.increaseTo(deadline);
    await expect(pool.privateTransfer.staticCall(transfer, proof)).to.be.revertedWithCustomError(
      pool,
      "ExpiredReceiveCode",
    );
    expect(await pool.nullifierSpent(981n)).to.equal(false);
    expect(await pool.commitmentExists(983n)).to.equal(false);
    await authorize(pool, transfer, 1, 4, { expiresAt: deadline + 3600n, binding: 778n });
    await pool.privateTransfer(transfer, proof);
    expect(await pool.nullifierSpent(981n)).to.equal(true);
  });

  it("routes four-slot VALUE proofs and spends every real and placeholder nullifier", async () => {
    const { pool, recipient } = await setup();
    const deposit = actionData();
    await pool.shield(100n, deposit, await proofFor(pool, 0, deposit, 100n));
    const root = (await pool.noteShard(0)).root;
    const transfer = valueActionData({
      inputShardIds: Array(4).fill(0n),
      inputRoots: Array(4).fill(root),
      inputNullifiers: Array.from({ length: 4 }, (_, i) => BigInt(501 + i)),
      outputCommitments: [5031n, 5032n],
    });
    const proof = await proofFor(pool, 3, transfer);
    const wrongPurpose = hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "uint256[]"],
      [
        7,
        buildShieldedPoolPublicSignals({
          action: 3,
          chainId: (await hre.ethers.provider.getNetwork()).chainId,
          poolAddress: await pool.getAddress(),
          ...transfer,
        }),
      ],
    );
    await expect(pool.privateTransfer(transfer, wrongPurpose)).to.be.revertedWithCustomError(
      pool,
      "InvalidZKProof",
    );
    const shortInputs = {
      ...transfer,
      inputShardIds: transfer.inputShardIds.slice(0, 2),
      inputRoots: transfer.inputRoots.slice(0, 2),
      inputNullifiers: transfer.inputNullifiers.slice(0, 2),
    };
    await expect(pool.privateTransfer(shortInputs, proof)).to.be.revertedWithCustomError(
      pool,
      "InvalidActionData",
    );
    await expect(
      pool.unshield(recipient.address, 1n, shortInputs, proof),
    ).to.be.revertedWithCustomError(pool, "InvalidActionData");
    const oversized = {
      ...transfer,
      inputShardIds: [...transfer.inputShardIds, ...transfer.inputShardIds],
      inputRoots: [...transfer.inputRoots, ...transfer.inputRoots],
      inputNullifiers: [...transfer.inputNullifiers, ...transfer.inputNullifiers],
    };
    await expect(pool.privateTransfer(oversized, proof)).to.be.revertedWithCustomError(
      pool,
      "InvalidActionData",
    );
    await expect(pool.unshield(recipient.address, 1n, oversized, proof)).to.be.revertedWithCustomError(
      pool,
      "InvalidActionData",
    );
    const duplicate = { ...transfer, inputNullifiers: [...transfer.inputNullifiers] };
    duplicate.inputNullifiers[3] = duplicate.inputNullifiers[2];
    await expect(pool.privateTransfer(duplicate, proof)).to.be.revertedWithCustomError(
      pool,
      "NullifierAlreadySpent",
    );
    await expect(pool.fund(transfer, proof)).to.be.revertedWithCustomError(
      pool,
      "InvalidActionData",
    );
    await pool.privateTransfer(transfer, proof);
    expect(await pool.nullifierCount()).to.equal(4n);
    for (const nullifier of transfer.inputNullifiers)
      expect(await pool.nullifierSpent(nullifier)).to.equal(true);
    expect(await pool.totalShielded()).to.equal(100n);
    const nextRoot = (await pool.noteShard(0)).root;
    const withdrawal = valueActionData({
      inputShardIds: Array(4).fill(0n),
      inputRoots: Array(4).fill(nextRoot),
      inputNullifiers: Array.from({ length: 4 }, (_, i) => BigInt(601 + i)),
      outputCommitments: [6031n, 6032n],
    });
    await pool.unshield(
      recipient.address,
      30n,
      withdrawal,
      await proofFor(pool, 4, withdrawal, 30n, recipient.address),
    );
    expect(await pool.nullifierCount()).to.equal(8n);
    for (const nullifier of withdrawal.inputNullifiers)
      expect(await pool.nullifierSpent(nullifier)).to.equal(true);
    expect(await pool.totalShielded()).to.equal(70n);
  });

  it("binds shield amount and outputs, mirrors LeanIMT paths, and keeps tokens escrowed", async () => {
    const { pool, token, depositor, recipient } = await setup();
    const deposit = actionData();
    const depositProof = await proofFor(pool, 0, deposit, 100n);
    await expect(pool.connect(depositor).shield(100n, deposit, depositProof)).to.emit(
      pool,
      "NoteAppended",
    );
    expect(await token.balanceOf(await pool.getAddress())).to.equal(100n);
    expect(await pool.totalShielded()).to.equal(100n);
    expect(await pool.commitmentExists(101n)).to.equal(true);

    const firstAppend = (await pool.queryFilter(pool.filters.NoteAppended()))[0];
    expect(firstAppend.args.root).to.equal(101n);
    const exposedRootSpend = valueActionData({
      inputRoots: [firstAppend.args.root, firstAppend.args.root],
      inputNullifiers: [191n, 192n],
      outputCommitments: [191n, 192n],
    });
    await expect(
      pool.privateTransfer(exposedRootSpend, await proofFor(pool, 3, exposedRootSpend)),
    ).to.be.revertedWithCustomError(pool, "UnknownNoteRoot");

    const firstRoot = (await pool.noteShard(0)).root;
    const transfer = valueActionData({
      inputRoots: [firstRoot, firstRoot],
      inputNullifiers: [201n, 202n],
      outputCommitments: [103n, 104n],
      outputCiphertexts: [ciphertext("03"), ciphertext("04")],
    });
    await pool.privateTransfer(transfer, await proofFor(pool, 3, transfer));
    expect(await pool.nullifierSpent(201n)).to.equal(true);
    expect(await pool.totalShielded()).to.equal(100n);

    const events = await pool.queryFilter(pool.filters.NoteAppended());
    // Only completed actions add spendable roots; the root after each first output is never known.
    for (const [index, { args }] of events.entries()) {
      expect(await pool.isKnownNoteRoot(0, args.root)).to.equal(index % 2 === 1);
    }
    const reference = replayLineageTree(
      events.map(({ args }) => ({ leafIndex: args.leafIndex, leaf: args.commitment })),
    );
    expect((await pool.noteShard(0)).root).to.equal(reference.root);
    for (let index = 0; index < events.length; index += 1) {
      const expected = reference.generateProof(index);
      const actual = await pool.getNoteMerkleProof(0, index);
      expect(actual.leaf).to.equal(expected.leaf);
      expect(actual.proofRoot).to.equal(expected.root);
      expect(actual.proofIndex).to.equal(BigInt(expected.index));
      expect(actual.proofDepth).to.equal(BigInt(expected.siblings.length));
      expect([...actual.siblings]).to.deep.equal(expected.siblings);
    }

    const withdrawRoot = (await pool.noteShard(0)).root;
    const withdrawal = valueActionData({
      inputRoots: [withdrawRoot, withdrawRoot],
      inputNullifiers: [301n, 302n],
      outputCommitments: [105n, 106n],
      outputCiphertexts: [ciphertext("05"), ciphertext("06")],
    });
    await pool.unshield(
      recipient.address,
      30n,
      withdrawal,
      await proofFor(pool, 4, withdrawal, 30n, recipient.address),
    );
    expect(await token.balanceOf(recipient.address)).to.equal(30n);
    expect(await pool.totalShielded()).to.equal(70n);
    expect(await token.balanceOf(await pool.getAddress())).to.equal(70n);
    const actionEvents = await pool.queryFilter(pool.filters.ActionExecuted());
    const finalNotes = await pool.queryFilter(pool.filters.NoteAppended());
    expect(actionEvents.map(({ args }) => args.action)).to.deep.equal([0n, 3n, 4n]);
    expect(actionEvents.map(({ args }) => args.inputShardId0)).to.deep.equal([0n, 0n, 0n]);
    for (const actionEvent of actionEvents) {
      const notes = finalNotes.filter(
        (event) => event.transactionHash === actionEvent.transactionHash,
      );
      expect(notes).to.have.length(2);
      expect(actionEvent.index).to.be.lessThan(notes[0].index);
      expect(notes[0].index).to.be.lessThan(notes[1].index);
    }
    await expect(
      pool.privateTransfer(transfer, await proofFor(pool, 3, transfer)),
    ).to.be.revertedWithCustomError(pool, "NullifierAlreadySpent");
  });

  it("rejects changed public inputs, duplicate commitments, and mismatched checkpoints", async () => {
    const { pool, lineage, token } = await setup();
    const deposit = actionData();
    const proof = await proofFor(pool, 0, deposit, 100n);
    const shortCiphertext = actionData({
      outputCiphertexts: ["0x01", ciphertext("02")],
    });
    await expect(pool.shield(100n, shortCiphertext, proof)).to.be.revertedWithCustomError(
      pool,
      "InvalidCiphertext",
    );
    await expect(pool.shield(101n, deposit, proof)).to.be.revertedWithCustomError(
      pool,
      "InvalidZKProof",
    );
    expect(await token.balanceOf(await pool.getAddress())).to.equal(0n);
    await pool.shield(100n, deposit, proof);
    await expect(pool.shield(100n, deposit, proof)).to.be.revertedWithCustomError(
      pool,
      "DuplicateCommitment",
    );

    await lineage.setRoot(0, 700n);
    await lineage.setRoot(1, 800n);
    const root = (await pool.noteShard(0)).root;
    const asOf = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp);
    const claim = actionData({
      inputRoots: [root, root],
      inputNullifiers: [401n, 402n],
      periodNullifiers: Array.from({ length: 3 }, (_, i) => 500n + BigInt(i)),
      outputCommitments: [107n, 108n],
      outputCiphertexts: [ciphertext("07"), ciphertext("08")],
      relation0: 700n,
      relation1: 800n,
      asOf,
      lineageCheckpointId: await lineage.currentCheckpointId(),
    });
    const claimProof = await proofFor(pool, 2, claim);
    await lineage.setRoot(0, 701n);
    await pool.claim.staticCall(claim, claimProof);
    await expect(
      pool.claim(
        { ...claim, lineageCheckpointId: await lineage.currentCheckpointId() },
        claimProof,
      ),
    ).to.be.revertedWithCustomError(pool, "UnknownLineageRoot");
    await pool.claim(claim, claimProof);
    expect(await pool.nullifierSpent(500n)).to.equal(true);
    expect(await pool.nullifierSpent(502n)).to.equal(true);

    const nextClaim = actionData({
      inputRoots: [root, root],
      inputNullifiers: [403n, 404n],
      periodNullifiers: Array.from({ length: 3 }, (_, i) => 600n + BigInt(i)),
      outputCommitments: [109n, 110n],
      outputCiphertexts: [ciphertext("09"), ciphertext("0a")],
      relation0: 701n,
      relation1: 800n,
      asOf: BigInt((await hre.ethers.provider.getBlock("latest")).timestamp),
      lineageCheckpointId: await lineage.currentCheckpointId(),
    });
    await hre.networkHelpers.time.increase(7200);
    await expect(
      pool.claim(nextClaim, await proofFor(pool, 2, nextClaim)),
    ).to.be.revertedWithCustomError(pool, "InvalidClaimTime");
  });

  it("funds initial and historical enrollments without a key registry", async () => {
    const { pool, lineage } = await setup();
    const deposit = actionData();
    await pool.shield(100n, deposit, await proofFor(pool, 0, deposit, 100n));
    const root = (await pool.noteShard(0)).root;
    await lineage.setRoot(0, 700n);
    await lineage.setRoot(1, 800n);
    const asOf = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp);
    const funding = actionData({
      inputRoots: [root, root],
      inputNullifiers: [701n, 702n],
      outputCommitments: [111n, 112n],
      outputCiphertexts: [ciphertext("0b"), ciphertext("0c")],
      relation0: 700n,
      relation1: 800n,
      asOf,
      lineageCheckpointId: await lineage.currentCheckpointId(),
    });
    const fundProof = await proofFor(pool, 1, funding);
    await expect(pool.fund({ ...funding, fundMode: 2n }, fundProof)).to.be.revertedWithCustomError(
      pool,
      "InvalidActionData",
    );
    await lineage.setRoot(0, 701n);
    await pool.fund.staticCall(funding, fundProof);
    await expect(
      pool.fund({ ...funding, lineageCheckpointId: 0n }, fundProof),
    ).to.be.revertedWithCustomError(pool, "UnknownLineageRoot");
    await pool.fund(funding, fundProof);
    const toppedRoot = (await pool.noteShard(0)).root;
    const additionalFunding = actionData({
      fundMode: 1n,
      inputRoots: [toppedRoot, toppedRoot],
      inputNullifiers: [703n, 704n],
      outputCommitments: [113n, 114n],
      outputCiphertexts: [ciphertext("0d"), ciphertext("0e")],
    });
    const lineageAdditionalFunding = { ...additionalFunding, relation0: 700n, relation1: 800n };
    await expect(
      pool.fund(lineageAdditionalFunding, await proofFor(pool, 1, additionalFunding)),
    ).to.be.revertedWithCustomError(pool, "InvalidActionData");
    await pool.fund(additionalFunding, await proofFor(pool, 1, additionalFunding));
    expect(await pool.nullifierSpent(704n)).to.equal(true);
    const forbiddenMode = actionData({ fundMode: 1n, outputCommitments: [115n, 116n] });
    await expect(pool.shield(100n, forbiddenMode, "0x")).to.be.revertedWithCustomError(
      pool,
      "InvalidActionData",
    );
  });

  it("requires checkpoint ID zero on Shield, additional Fund, Transfer and Unshield", async () => {
    const { pool, lineage, recipient } = await setup();
    await lineage.setRoot(0, 700n);
    await lineage.setRoot(1, 800n);
    const lineageCheckpointId = await lineage.currentCheckpointId();
    const deposit = actionData();
    const depositProof = await proofFor(pool, 0, deposit, 100n);
    await expect(
      pool.shield(100n, { ...deposit, lineageCheckpointId }, depositProof),
    ).to.be.revertedWithCustomError(pool, "InvalidActionData");
    await pool.shield(100n, deposit, depositProof);
    const root = (await pool.noteShard(0)).root;
    const funding = actionData({
      inputRoots: [root, root],
      inputNullifiers: [701n, 702n],
      outputCommitments: [111n, 112n],
      fundMode: 1n,
    });
    await expect(
      pool.fund({ ...funding, lineageCheckpointId }, await proofFor(pool, 1, funding)),
    ).to.be.revertedWithCustomError(pool, "InvalidActionData");
    const transfer = valueActionData({
      inputRoots: [root, root],
      inputNullifiers: [801n, 802n],
      outputCommitments: [113n, 114n],
    });
    await expect(
      pool.privateTransfer({ ...transfer, lineageCheckpointId }, await proofFor(pool, 3, transfer)),
    ).to.be.revertedWithCustomError(pool, "InvalidActionData");
    await expect(
      pool.unshield(
        recipient.address,
        1n,
        { ...transfer, lineageCheckpointId },
        await proofFor(pool, 4, transfer, 1n, recipient.address),
      ),
    ).to.be.revertedWithCustomError(pool, "InvalidActionData");
  });

  it("public addressing uses Fund and the same shielded balance with canonical recovery data", async () => {
    const { pool, lineage, token } = await setup();
    const deposit = actionData();
    await pool.shield(100n, deposit, await proofFor(pool, 0, deposit, 100n));
    await lineage.setRoot(0, 700n);
    await lineage.setRoot(1, 800n);
    const root = (await pool.noteShard(0)).root;
    const asOf = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp);
    const publicNote = {
      binding: "identity",
      rootIdentityCommitment: 111n,
      rootVersionIndex: 1n,
      heirIdentityCommitment: 222n,
      amountPerPeriod: 10n,
      periodDays: 7n,
      eligibleFrom: asOf + 7200n,
      policyCommitment: 333n,
      enrollmentCommitment: 444n,
      remaining: 100n,
      nonce: 555n,
    };
    const scope = {
      chainId: (await hre.ethers.provider.getNetwork()).chainId,
      poolAddress: await pool.getAddress(),
    };
    const envelope = hre.ethers.hexlify(encodePublicShieldedBudgetEnvelope(publicNote, scope));
    const funding = actionData({
      budgetKind: 1n,
      inputRoots: [root, root],
      inputNullifiers: [711n, 712n],
      outputCommitments: [121n, 122n],
      outputCiphertexts: [envelope, ciphertext("0c")],
      relation0: 700n,
      relation1: 800n,
      asOf,
      lineageCheckpointId: await lineage.currentCheckpointId(),
    });
    const proof = await proofFor(pool, 1, funding);
    const replaceEnvelope = (bytes) => ({
      ...funding,
      outputCiphertexts: [hre.ethers.hexlify(bytes), funding.outputCiphertexts[1]],
    });
    for (const offset of [0, 4, 5, 218, 511]) {
      const bytes = hre.ethers.getBytes(envelope);
      bytes[offset] ^= 1;
      await expect(pool.fund(replaceEnvelope(bytes), proof)).to.be.revertedWithCustomError(
        pool,
        "InvalidCiphertext",
      );
    }
    const wrongHeir = hre.ethers.hexlify(
      encodePublicShieldedBudgetEnvelope({ ...publicNote, heirIdentityCommitment: 223n }, scope),
    );
    const zeroPeriodBytes = hre.ethers.getBytes(envelope);
    zeroPeriodBytes.fill(0, 214, 218);
    await expect(pool.fund(replaceEnvelope(zeroPeriodBytes), proof)).to.be.revertedWithCustomError(
      pool,
      "InvalidFieldElement",
    );
    const wrongPeriod = hre.ethers.hexlify(
      encodePublicShieldedBudgetEnvelope({ ...publicNote, periodDays: 1n }, scope),
    );
    await expect(
      pool.fund(
        { ...funding, outputCiphertexts: [wrongPeriod, funding.outputCiphertexts[1]] },
        proof,
      ),
    ).to.be.revertedWithCustomError(pool, "InvalidZKProof");
    await expect(
      pool.fund(
        { ...funding, outputCiphertexts: [wrongHeir, funding.outputCiphertexts[1]] },
        proof,
      ),
    ).to.be.revertedWithCustomError(pool, "InvalidZKProof");
    await expect(pool.fund({ ...funding, budgetKind: 0n }, proof)).to.be.revertedWithCustomError(
      pool,
      "InvalidReceiveAuthorization",
    );
    await expect(pool.fund({ ...funding, budgetKind: 2n }, proof)).to.be.revertedWithCustomError(
      pool,
      "InvalidActionData",
    );
    await expect(pool.claim(funding, "0x")).to.be.revertedWithCustomError(
      pool,
      "InvalidActionData",
    );
    await pool.fund(funding, proof);
    expect(await pool.totalShielded()).to.equal(100n);
    expect(await token.balanceOf(await pool.getAddress())).to.equal(100n);
    const fundedNotes = (await pool.queryFilter(pool.filters.NoteAppended())).slice(2);
    expect(fundedNotes[0].args.ciphertext).to.equal(envelope);
    expect(pool.interface.hasFunction("fundPublic")).to.equal(false);
    expect(pool.interface.hasFunction("claimPublic")).to.equal(false);
    expect(pool.interface.hasFunction("totalPublicBudget")).to.equal(false);
  });

  it("binds every VALUE input root while allowing different known roots", async () => {
    const { pool, recipient } = await setup();
    const first = actionData();
    await pool.shield(100n, first, await proofFor(pool, 0, first, 100n));
    const second = actionData({
      outputCommitments: [103n, 104n],
      outputCiphertexts: [ciphertext("03"), ciphertext("04")],
    });
    await pool.shield(100n, second, await proofFor(pool, 0, second, 100n));
    const events = await pool.queryFilter(pool.filters.NoteAppended());
    const olderRoot = events[1].args.root;
    const latestRoot = (await pool.noteShard(0)).root;
    const withdrawal = valueActionData({
      inputRoots: [latestRoot, latestRoot],
      inputNullifiers: [801n, 802n],
      outputCommitments: [121n, 122n],
      outputCiphertexts: [ciphertext("11"), ciphertext("12")],
    });
    const proof = await proofFor(pool, 4, withdrawal, 30n, recipient.address);
    const mixedRoots = {
      ...withdrawal,
      inputRoots: [latestRoot, olderRoot, ...withdrawal.inputRoots.slice(2)],
    };
    await expect(
      pool.unshield(recipient.address, 30n, mixedRoots, proof),
    ).to.be.revertedWithCustomError(pool, "InvalidZKProof");
    await pool.unshield(
      recipient.address,
      30n,
      mixedRoots,
      await proofFor(pool, 4, mixedRoots, 30n, recipient.address),
    );
    expect(await pool.nullifierSpent(802n)).to.equal(true);
  });

  it("binds both claim roots while accepting budgets from different known roots", async () => {
    const { pool, lineage } = await setup();
    const firstDeposit = actionData();
    await pool.shield(100n, firstDeposit, await proofFor(pool, 0, firstDeposit, 100n));
    const firstRoot = (await pool.noteShard(0)).root;
    const secondDeposit = actionData({
      outputCommitments: [103n, 104n],
      outputCiphertexts: [ciphertext("03"), ciphertext("04")],
    });
    await pool.shield(100n, secondDeposit, await proofFor(pool, 0, secondDeposit, 100n));
    const secondRoot = (await pool.noteShard(0)).root;
    await lineage.setRoot(0, 700n);
    await lineage.setRoot(1, 800n);
    const claim = actionData({
      inputRoots: [firstRoot, secondRoot],
      inputNullifiers: [901n, 902n],
      periodNullifiers: Array.from({ length: 3 }, (_, index) => 1001n + BigInt(index)),
      outputCommitments: [105n, 106n],
      relation0: 700n,
      relation1: 800n,
      asOf: BigInt((await hre.ethers.provider.getBlock("latest")).timestamp),
      lineageCheckpointId: await lineage.currentCheckpointId(),
    });
    const proof = await proofFor(pool, 2, claim);
    await expect(
      pool.claim({ ...claim, inputRoots: [firstRoot, firstRoot] }, proof),
    ).to.be.revertedWithCustomError(pool, "InvalidZKProof");
    await pool.claim(claim, proof);
    expect(await pool.nullifierSpent(901n)).to.equal(true);
    expect(await pool.nullifierSpent(902n)).to.equal(true);
    expect(await pool.totalShielded()).to.equal(200n);
  });

  it("rolls over a full 32-level shard without imposing a pool-wide note cap", async () => {
    const { pool } = await setup("ShieldedPoolRolloverHarness");
    await pool.seedFullShard();
    const deposit = actionData();
    await pool.shield(100n, deposit, await proofFor(pool, 0, deposit, 100n));
    expect(await pool.currentShardId()).to.equal(1n);
    expect((await pool.noteShard(0)).size).to.equal(1n << 32n);
    expect((await pool.noteShard(1)).size).to.equal(2n);
    const appended = await pool.queryFilter(pool.filters.NoteAppended());
    expect(appended.map(({ args }) => args.shardId)).to.deep.equal([1n, 1n]);
    expect(await pool.isKnownNoteRoot(1, appended[0].args.root)).to.equal(false);
    const secondShardRoot = (await pool.noteShard(1)).root;
    const transfer = valueActionData({
      inputShardIds: [0n, 1n],
      inputRoots: [1n, secondShardRoot],
      inputNullifiers: [201n, 202n],
      outputCommitments: [103n, 104n],
      outputCiphertexts: [ciphertext("03"), ciphertext("04")],
    });
    await pool.privateTransfer(transfer, await proofFor(pool, 3, transfer));
    expect((await pool.noteShard(1)).size).to.equal(4n);
  });

  it("measures synthetic 32-level append costs for funding and 3-slot claim", async () => {
    async function runCase(syntheticDepth32) {
      const { pool, lineage } = await setup(
        syntheticDepth32 ? "ShieldedPoolDepthHarness" : "ShieldedErc20Pool",
      );
      if (syntheticDepth32) {
        await pool.seedSyntheticLeftSubtree(777n);
        await expect(pool.seedSyntheticLeftSubtree(778n)).to.be.revertedWithCustomError(
          pool,
          "InvalidActionData",
        );
      }
      await lineage.setRoot(0, 700n);
      await lineage.setRoot(1, 800n);

      const deposit = actionData();
      const shieldReceipt = await (
        await pool.shield(100n, deposit, await proofFor(pool, 0, deposit, 100n))
      ).wait();
      const asOf = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp);
      const funding = actionData({
        inputRoots: Array(2).fill((await pool.noteShard(0)).root),
        inputNullifiers: [201n, 202n],
        outputCommitments: [103n, 104n],
        outputCiphertexts: [ciphertext("03"), ciphertext("04")],
        relation0: 700n,
        relation1: 800n,
        asOf,
        lineageCheckpointId: await lineage.currentCheckpointId(),
      });
      const fundReceipt = await (await pool.fund(funding, await proofFor(pool, 1, funding))).wait();
      const claim = actionData({
        inputRoots: Array(2).fill((await pool.noteShard(0)).root),
        inputNullifiers: [301n, 302n],
        periodNullifiers: Array.from({ length: 3 }, (_, index) => 401n + BigInt(index)),
        outputCommitments: [105n, 106n],
        outputCiphertexts: [ciphertext("05"), ciphertext("06")],
        relation0: 700n,
        relation1: 800n,
        asOf,
        lineageCheckpointId: await lineage.currentCheckpointId(),
      });
      const claimReceipt = await (await pool.claim(claim, await proofFor(pool, 2, claim))).wait();
      const size = (await pool.noteShard(0)).size;
      return {
        shield: shieldReceipt.gasUsed,
        fund: fundReceipt.gasUsed,
        claim: claimReceipt.gasUsed,
        size,
      };
    }

    const shallow = await runCase(false);
    const depth32 = await runCase(true);
    expect(shallow.size).to.equal(6n);
    expect(depth32.size).to.equal((1n << 31n) + 6n);
    for (const action of ["shield", "fund", "claim"]) {
      expect(depth32[action]).to.be.greaterThan(shallow[action]);
      expect(depth32[action]).to.be.lessThan(15_000_000n);
    }
    if (process.env.SHIELDED_FULL_DEPTH_GAS_REPORT === "1") {
      console.log(
        JSON.stringify({
          type: "shielded-local-synthetic-depth32-gas",
          releaseEvidence: false,
          simulatedLeftSubtree: true,
          proofVerifier: "mock",
          shallow: Object.fromEntries(
            Object.entries(shallow).map(([key, value]) => [key, value.toString()]),
          ),
          depth32: Object.fromEntries(
            Object.entries(depth32).map(([key, value]) => [key, value.toString()]),
          ),
        }),
      );
    }
  });
});
