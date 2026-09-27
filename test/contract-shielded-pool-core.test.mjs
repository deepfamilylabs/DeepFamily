import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { replayLineageTree } from "@deepfamily/protocol-core";

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const ciphertext = (byte) => `0x${byte.repeat(512)}`;

describe("ShieldedDeepPool contract boundaries", function () {
  async function setup(poolContractName = "ShieldedDeepPool") {
    const [depositor, recipient] = await hre.ethers.getSigners();
    const token = await hre.ethers.deployContract("ShieldedPoolTokenMock");
    const lineage = await hre.ethers.deployContract("ShieldedPoolLineageMock");
    const keyRegistry = await hre.ethers.deployContract("ShieldedPoolKeyRegistryMock");
    const verifier = await hre.ethers.deployContract("ShieldedPoolVerifierMock");
    const poseidon = await hre.ethers.deployContract("PoseidonT3");
    await Promise.all([
      token.waitForDeployment(),
      lineage.waitForDeployment(),
      keyRegistry.waitForDeployment(),
      verifier.waitForDeployment(),
      poseidon.waitForDeployment(),
    ]);
    const Pool = await hre.ethers.getContractFactory(poolContractName, {
      libraries: { PoseidonT3: await poseidon.getAddress() },
    });
    const pool = await Pool.deploy(
      await token.getAddress(),
      await lineage.getAddress(),
      await keyRegistry.getAddress(),
      Array(8).fill(await verifier.getAddress()),
    );
    await pool.waitForDeployment();
    await token.mint(depositor.address, 1_000n);
    await token.connect(depositor).approve(await pool.getAddress(), 1_000n);
    return { pool, token, lineage, keyRegistry, depositor, recipient };
  }

  const actionData = (overrides = {}) => ({
    inputShardIds: [0n, 0n],
    inputRoots: [0n, 0n],
    inputNullifiers: [0n, 0n],
    periodNullifiers: Array(12).fill(0n),
    outputCommitments: [101n, 102n],
    outputCiphertexts: [ciphertext("01"), ciphertext("02")],
    relation0: 0n,
    relation1: 0n,
    asOf: 0n,
    registryRoot: 0n,
    registryShardId: 0n,
    ...overrides,
  });

  async function proofFor(pool, action, data, amount = 0n, recipient = hre.ethers.ZeroAddress) {
    const network = await hre.ethers.provider.getNetwork();
    const ciphertextHash = (ciphertext) => BigInt(hre.ethers.keccak256(ciphertext)) % FIELD;
    const signals = [
      BigInt(action),
      network.chainId,
      BigInt(await pool.getAddress()),
      data.inputShardIds[0],
      data.inputRoots[0],
      data.inputShardIds[1],
      data.inputRoots[1],
      ...data.inputNullifiers,
      ...data.periodNullifiers,
      ...data.outputCommitments,
      ciphertextHash(data.outputCiphertexts[0]),
      ciphertextHash(data.outputCiphertexts[1]),
      amount,
      BigInt(recipient),
      data.relation0,
      data.relation1,
      data.asOf,
      data.registryRoot,
      data.registryShardId,
    ];
    expect(signals).to.have.length(32);
    // The test mock compares these bytes to contract-built public signals. It proves wiring,
    // not soundness of any shielded note transition.
    return hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256[32]"], [signals]);
  }

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
    const exposedRootSpend = actionData({
      inputRoots: [firstAppend.args.root, firstAppend.args.root],
      inputNullifiers: [191n, 192n],
      outputCommitments: [191n, 192n],
    });
    await expect(
      pool.privateTransfer(exposedRootSpend, await proofFor(pool, 6, exposedRootSpend)),
    ).to.be.revertedWithCustomError(pool, "SingleLeafNoteRoot");

    const firstRoot = (await pool.noteShard(0)).root;
    const transfer = actionData({
      inputRoots: [firstRoot, firstRoot],
      inputNullifiers: [201n, 202n],
      outputCommitments: [103n, 104n],
      outputCiphertexts: [ciphertext("03"), ciphertext("04")],
    });
    await pool.privateTransfer(transfer, await proofFor(pool, 6, transfer));
    expect(await pool.nullifierSpent(201n)).to.equal(true);
    expect(await pool.totalShielded()).to.equal(100n);

    const events = await pool.queryFilter(pool.filters.NoteAppended());
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
    const withdrawal = actionData({
      inputRoots: [withdrawRoot, withdrawRoot],
      inputNullifiers: [301n, 302n],
      outputCommitments: [105n, 106n],
      outputCiphertexts: [ciphertext("05"), ciphertext("06")],
    });
    await pool.unshield(
      recipient.address,
      30n,
      withdrawal,
      await proofFor(pool, 7, withdrawal, 30n, recipient.address),
    );
    expect(await token.balanceOf(recipient.address)).to.equal(30n);
    expect(await pool.totalShielded()).to.equal(70n);
    expect(await token.balanceOf(await pool.getAddress())).to.equal(70n);
    const actionEvents = await pool.queryFilter(pool.filters.ActionExecuted());
    const finalNotes = await pool.queryFilter(pool.filters.NoteAppended());
    expect(actionEvents.map(({ args }) => args.action)).to.deep.equal([0n, 6n, 7n]);
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
      pool.privateTransfer(transfer, await proofFor(pool, 6, transfer)),
    ).to.be.revertedWithCustomError(pool, "NullifierAlreadySpent");
  });

  it("rejects changed public inputs, duplicate commitments, and old lineage roots", async () => {
    const { pool, lineage, token } = await setup();
    const deposit = actionData();
    const proof = await proofFor(pool, 0, deposit, 100n);
    const shortCiphertext = actionData({
      outputCiphertexts: ["0x01", ciphertext("02")],
    });
    await expect(
      pool.shield(100n, shortCiphertext, await proofFor(pool, 0, shortCiphertext, 100n)),
    ).to.be.revertedWithCustomError(pool, "InvalidCiphertext");
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
      periodNullifiers: Array.from({ length: 12 }, (_, i) => 500n + BigInt(i)),
      outputCommitments: [107n, 108n],
      outputCiphertexts: [ciphertext("07"), ciphertext("08")],
      relation0: 700n,
      relation1: 800n,
      asOf,
    });
    const claimProof = await proofFor(pool, 5, claim);
    await lineage.setRoot(0, 701n);
    await expect(pool.claim(claim, claimProof)).to.be.revertedWithCustomError(
      pool,
      "UnknownLineageRoot",
    );
    await lineage.setRoot(0, 700n);
    await pool.claim(claim, claimProof);
    expect(await pool.nullifierSpent(500n)).to.equal(true);
    expect(await pool.nullifierSpent(511n)).to.equal(true);

    const nextClaim = actionData({
      inputRoots: [root, root],
      inputNullifiers: [403n, 404n],
      periodNullifiers: Array.from({ length: 12 }, (_, i) => 600n + BigInt(i)),
      outputCommitments: [109n, 110n],
      outputCiphertexts: [ciphertext("09"), ciphertext("0a")],
      relation0: 700n,
      relation1: 800n,
      asOf,
    });
    await hre.networkHelpers.time.increase(7200);
    await expect(
      pool.claim(nextClaim, await proofFor(pool, 5, nextClaim)),
    ).to.be.revertedWithCustomError(pool, "InvalidClaimTime");
  });

  it("accepts only committed registry roots for private allocation and top-ups", async () => {
    const { pool, keyRegistry, lineage } = await setup();
    const deposit = actionData();
    await pool.shield(100n, deposit, await proofFor(pool, 0, deposit, 100n));
    const root = (await pool.noteShard(0)).root;
    const asOf = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp);
    await lineage.setRoot(0, 700n);
    await lineage.setRoot(1, 800n);
    const allocation = actionData({
      inputRoots: [root, root],
      inputNullifiers: [701n, 702n],
      outputCommitments: [111n, 112n],
      outputCiphertexts: [ciphertext("0b"), ciphertext("0c")],
      relation0: 700n,
      relation1: 800n,
      asOf,
      registryRoot: 900n,
      registryShardId: 2n,
    });
    const allocationProof = await proofFor(pool, 2, allocation);
    await expect(pool.allocate(allocation, allocationProof)).to.be.revertedWithCustomError(
      pool,
      "UnknownKeyRegistryRoot",
    );
    await keyRegistry.setKnownRoot(2n, 900n, true, 1n);
    await expect(pool.allocate(allocation, allocationProof)).to.be.revertedWithCustomError(
      pool,
      "SingleLeafKeyRegistryRoot",
    );
    const oneKeyTopUp = actionData({
      inputRoots: [root, root],
      inputNullifiers: [705n, 706n],
      outputCommitments: [115n, 116n],
      registryRoot: 900n,
      registryShardId: 2n,
    });
    await expect(
      pool.topUp(oneKeyTopUp, await proofFor(pool, 3, oneKeyTopUp)),
    ).to.be.revertedWithCustomError(pool, "SingleLeafKeyRegistryRoot");
    await keyRegistry.setKnownRoot(2n, 900n, true, 2n);
    await lineage.setRoot(0, 701n);
    await expect(pool.allocate(allocation, allocationProof)).to.be.revertedWithCustomError(
      pool,
      "UnknownLineageRoot",
    );
    await lineage.setRoot(0, 700n);
    await pool.allocate(allocation, allocationProof);
    const toppedRoot = (await pool.noteShard(0)).root;
    const topUp = actionData({
      inputRoots: [toppedRoot, toppedRoot],
      inputNullifiers: [703n, 704n],
      outputCommitments: [113n, 114n],
      outputCiphertexts: [ciphertext("0d"), ciphertext("0e")],
      registryRoot: 900n,
      registryShardId: 2n,
    });
    await pool.topUp(topUp, await proofFor(pool, 3, topUp));
    expect(await pool.nullifierSpent(704n)).to.equal(true);
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
    const secondShardRoot = (await pool.noteShard(1)).root;
    const transfer = actionData({
      inputShardIds: [0n, 1n],
      inputRoots: [1n, secondShardRoot],
      inputNullifiers: [201n, 202n],
      outputCommitments: [103n, 104n],
      outputCiphertexts: [ciphertext("03"), ciphertext("04")],
    });
    await pool.privateTransfer(transfer, await proofFor(pool, 6, transfer));
    expect((await pool.noteShard(1)).size).to.equal(4n);
  });

  it("measures synthetic 32-level append costs for allocation and 12-slot claim", async () => {
    async function runCase(syntheticDepth32) {
      const { pool, lineage, keyRegistry } = await setup(
        syntheticDepth32 ? "ShieldedPoolDepthHarness" : "ShieldedDeepPool",
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
      await keyRegistry.setKnownRoot(0n, 900n, true, 2n);

      const deposit = actionData();
      const shieldReceipt = await (
        await pool.shield(100n, deposit, await proofFor(pool, 0, deposit, 100n))
      ).wait();
      const asOf = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp);
      const allocation = actionData({
        inputRoots: Array(2).fill((await pool.noteShard(0)).root),
        inputNullifiers: [201n, 202n],
        outputCommitments: [103n, 104n],
        outputCiphertexts: [ciphertext("03"), ciphertext("04")],
        relation0: 700n,
        relation1: 800n,
        asOf,
        registryRoot: 900n,
      });
      const allocationReceipt = await (
        await pool.allocate(allocation, await proofFor(pool, 2, allocation))
      ).wait();
      const claim = actionData({
        inputRoots: Array(2).fill((await pool.noteShard(0)).root),
        inputNullifiers: [301n, 302n],
        periodNullifiers: Array.from({ length: 12 }, (_, index) => 401n + BigInt(index)),
        outputCommitments: [105n, 106n],
        outputCiphertexts: [ciphertext("05"), ciphertext("06")],
        relation0: 700n,
        relation1: 800n,
        asOf,
      });
      const claimReceipt = await (await pool.claim(claim, await proofFor(pool, 5, claim))).wait();
      const size = (await pool.noteShard(0)).size;
      return {
        shield: shieldReceipt.gasUsed,
        allocation: allocationReceipt.gasUsed,
        claim: claimReceipt.gasUsed,
        size,
      };
    }

    const shallow = await runCase(false);
    const depth32 = await runCase(true);
    expect(shallow.size).to.equal(6n);
    expect(depth32.size).to.equal((1n << 31n) + 6n);
    for (const action of ["shield", "allocation", "claim"]) {
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
