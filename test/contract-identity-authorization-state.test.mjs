import "../hardhat-test-setup.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { expect } from "chai";
import hre from "hardhat";
import {
  buildShieldedIdentityAuthorizationState,
  computeIdentityFromDerivedSecret,
  encodeGroth16AbcProofData,
  getShieldedIdentityAuthorizationWitness,
  normalizeGroth16Proof,
  prepareShieldedIdentityCounterAuthorization,
} from "@deepfamily/protocol-core";

const field = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const encode = (inputs) => hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256[6]"], [inputs]);

async function deployState(verifier) {
  const t3 = await hre.ethers.deployContract("PoseidonT3");
  const t4 = await hre.ethers.deployContract("PoseidonT4");
  const State = await hre.ethers.getContractFactory("IdentityAuthorizationState", {
    libraries: { PoseidonT3: await t3.getAddress(), PoseidonT4: await t4.getAddress() },
  });
  return State.deploy(await verifier.getAddress());
}

async function fixture() {
  const verifier = await hre.ethers.deployContract("IdentityCounterVerifierMock");
  const state = await deployState(verifier);
  return { state, verifier };
}

async function mockUpdate(state, alias, counter, nonce) {
  const inputs = [
    nonce,
    (await hre.ethers.provider.getNetwork()).chainId,
    BigInt(await state.getAddress()),
    alias,
    counter,
    counter + 1n,
  ];
  return state.incrementCounter(nonce, alias, counter, counter + 1n, encode(inputs));
}

async function assertProof(state, records, alias) {
  const rebuilt = buildShieldedIdentityAuthorizationState(records);
  const expected = getShieldedIdentityAuthorizationWitness(rebuilt, alias);
  const actual = await state.getCounterProof(alias);
  assert.equal(await state.currentRoot(), rebuilt.root);
  assert.equal(actual.authorizationCounter, expected.authorizationCounter);
  assert.equal(actual.stateRoot, expected.stateRoot);
  assert.equal(actual.depth, expected.depth);
  assert.deepEqual([...actual.siblings], expected.siblings);
  assert.equal(actual.oldKey, expected.oldKey);
  assert.equal(actual.oldValue, expected.oldValue);
  assert.equal(actual.isOld0, expected.isOld0 === 1n);
  assert.equal(actual.absent, expected.absent === 1n);
  assert.equal(await state.authorizationCounter(alias), expected.authorizationCounter);
}

describe("On-chain identity counter dictionary", function () {
  this.timeout(180_000);

  it("matches canonical empty, collision, shared-prefix and full-depth openings", async function () {
    const { state } = await hre.networkHelpers.loadFixture(fixture);
    const records = new Map();
    await assertProof(state, records, 11n);
    let nonce = 101n;
    for (const alias of [11n, 15n, 11n ^ (1n << 63n), 16n, 99n]) {
      await mockUpdate(state, alias, 0n, nonce++);
      records.set(alias, 1n);
      for (const query of [11n, 15n, 16n, 18n, 99n, 123n]) await assertProof(state, records, query);
    }
    assert.equal((await state.getCounterProof(11n)).depth, 64n);
    const count = await state.nodeCount();
    for (let counter = 1n; counter < 4n; counter++) {
      await mockUpdate(state, 11n, counter, nonce++);
      records.set(11n, counter + 1n);
      await assertProof(state, records, 11n);
      await assertProof(state, records, 123n);
      assert.equal(await state.nodeCount(), count, "existing aliases must reuse every node");
    }
    const currentRoot = await state.currentRoot();
    const currentCheckpoint = await state.currentCheckpointId();
    await expect(mockUpdate(state, 11n + (1n << 64n), 0n, nonce)).to.be.revertedWithCustomError(
      state,
      "AuthorizationPathCollision",
    );
    assert.equal(await state.nodeCount(), count);
    assert.equal(await state.currentRoot(), currentRoot);
    assert.equal(await state.currentCheckpointId(), currentCheckpoint);
    assert.equal(await state.authorizationUsed(nonce), false);
    assert.equal(await state.authorizationCounter(11n + (1n << 64n)), 0n);
  });

  it("emits execution roots, binds exact proof inputs, and rejects stale alias counters", async function () {
    const { state } = await hre.networkHelpers.loadFixture(fixture);
    const records = new Map();
    const oldRoot = await state.currentRoot();
    const tx = await mockUpdate(state, 11n, 0n, 201n);
    records.set(11n, 1n);
    const actualRoot = buildShieldedIdentityAuthorizationState(records).root;
    await expect(tx)
      .to.emit(state, "CounterIncremented")
      .withArgs(2n, 11n, 0n, 1n, oldRoot, actualRoot, 201n);
    await expect(mockUpdate(state, 11n, 0n, 202n)).to.be.revertedWithCustomError(
      state,
      "StaleAuthorizationCounter",
    );
    await expect(mockUpdate(state, 12n, 0n, 201n)).to.be.revertedWithCustomError(
      state,
      "AuthorizationAlreadyUsed",
    );
    const inputs = [
      203n,
      (await hre.ethers.provider.getNetwork()).chainId,
      BigInt(await state.getAddress()),
      12n,
      0n,
      1n,
    ];
    for (let index = 0; index < inputs.length; index++) {
      const changed = [...inputs];
      changed[index] += 1n;
      await expect(
        state.incrementCounter(203n, 12n, 0n, 1n, encode(changed)),
      ).to.be.revertedWithCustomError(state, "InvalidCounterProof");
    }
    assert.equal(await state.currentRoot(), actualRoot);
    assert.equal(await state.nodeCount(), 1n);
    for (const alias of [0n, field])
      await expect(state.getCounterProof(alias)).to.be.revertedWithCustomError(
        state,
        "InvalidFieldElement",
      );
  });

  it("retains fixed-block queries and the exact existing checkpoint retirement interval", async function () {
    const { state } = await hre.networkHelpers.loadFixture(fixture);
    const initial = await state.getCheckpoint(1n);
    const tx = await mockUpdate(state, 17n, 0n, 301n);
    const receipt = await tx.wait();
    const atFirst = await state.getCounterProof(17n, { blockTag: receipt.blockNumber });
    await mockUpdate(state, 18n, 0n, 302n);
    assert.equal(
      (await state.getCounterProof(17n, { blockTag: receipt.blockNumber })).stateRoot,
      atFirst.stateRoot,
    );
    const retired = await state.getCheckpoint(1n);
    assert.equal(await state.validateCheckpoint(1n, initial.createdAt), 0n);
    await hre.networkHelpers.time.increaseTo(Number(retired.retiredAt + 899n));
    assert.equal(await state.validateCheckpoint(1n, initial.createdAt), 0n);
    await hre.networkHelpers.time.increaseTo(Number(retired.retiredAt + 900n));
    await expect(state.validateCheckpoint(1n, initial.createdAt)).to.be.revertedWithCustomError(
      state,
      "CheckpointExpired",
    );
  });

  it("accepts real independent owner authorizations and full-depth updates with every signal bound", async function () {
    const verifier = await hre.ethers.deployContract("ShieldedIdentityAuthorizationUpdateVerifier");
    const adapter = await hre.ethers.deployContract("IdentityAuthorizationVerifierAdapter", [
      await verifier.getAddress(),
    ]);
    const state = await deployState(adapter);
    const anotherState = await deployState(adapter);
    const chainId = (await hre.ethers.provider.getNetwork()).chainId;
    const directory = path.resolve("frontend/public/zk/shielded");
    const snarkjs = await import("snarkjs");
    const identityFields = {
      fullName: "Root independent authorization",
      gender: 1,
      birthYear: 2000,
      birthMonth: 1,
      birthDay: 2,
      isBirthBC: false,
    };
    async function prove(secret, authorizationCounter = 0n, target = state) {
      const material = computeIdentityFromDerivedSecret({
        identity: identityFields,
        identitySuiteId: 1,
        derivedSecretField: secret,
      });
      const context = {
        ...material,
        chainId,
        authorizationStateAddress: await target.getAddress(),
      };
      const transition = prepareShieldedIdentityCounterAuthorization({
        ...context,
        authorizationCounter,
      });
      const generated = await snarkjs.groth16.fullProve(
        {
          nameField: String(material.nameField),
          derivedSecretField: String(secret),
          suiteId: "1",
          ...Object.fromEntries(
            Object.entries(identityFields)
              .filter(([name]) => name !== "fullName")
              .map(([name, value]) => [
                name,
                String(typeof value === "boolean" ? Number(value) : value),
              ]),
          ),
          ...transition.witness,
        },
        path.join(directory, "shielded_identity_authorization_update.wasm"),
        path.join(directory, "shielded_identity_authorization_update_final.zkey"),
        undefined,
        { singleThread: true },
        { singleThread: true },
      );
      assert.deepEqual(generated.publicSignals, transition.publicSignals.map(String));
      return {
        transition,
        proof: encodeGroth16AbcProofData(normalizeGroth16Proof(generated.proof)),
      };
    }
    const first = await prove(222n);
    const second = await prove(333n);
    const execute = (target, proved, change = {}) => {
      const p = proved.transition.publicSignals;
      return target.incrementCounter(
        change.nullifier ?? p[0],
        change.alias ?? p[3],
        change.oldCounter ?? p[4],
        change.newCounter ?? p[5],
        proved.proof,
      );
    };
    try {
      // The verifier authenticates all six owner/counter/context coordinates.
      // Neither authorization depends on the other identity's tree update.
      for (let index = 0; index < first.transition.publicSignals.length; index++) {
        const changed = [...first.transition.publicSignals];
        changed[index] += 1n;
        assert.equal(await adapter.verifyProof(first.proof, changed), false);
      }
      await expect(execute(anotherState, first)).to.be.revertedWithCustomError(
        anotherState,
        "InvalidCounterProof",
      );
      await expect(
        execute(state, first, { alias: first.transition.publicSignals[3] + 1n }),
      ).to.be.revertedWithCustomError(state, "InvalidCounterProof");
      await execute(state, first);
      await expect(
        execute(state, first, {
          nullifier: first.transition.publicSignals[0] + 1n,
          oldCounter: 1n,
          newCounter: 2n,
        }),
      ).to.be.revertedWithCustomError(state, "InvalidCounterProof");
      const actualOld = await state.currentRoot();
      assert.equal(second.transition.publicSignals[4], 0n);
      const records = new Map([
        [first.transition.publicSignals[3], 1n],
        [second.transition.publicSignals[3], 1n],
      ]);
      const actualNew = buildShieldedIdentityAuthorizationState(records).root;
      await expect(execute(state, second))
        .to.emit(state, "CounterIncremented")
        .withArgs(
          3n,
          second.transition.publicSignals[3],
          0n,
          1n,
          actualOld,
          actualNew,
          second.transition.publicSignals[0],
        );
      for (const alias of records.keys()) await assertProof(state, records, alias);
      await expect(execute(state, first)).to.be.revertedWithCustomError(
        state,
        "AuthorizationAlreadyUsed",
      );
      // A genuine subsequent authorization needs only the live alias counter.
      const next = await prove(222n, 1n);
      await execute(state, next);
      records.set(first.transition.publicSignals[3], 2n);
      await assertProof(state, records, first.transition.publicSignals[3]);

      // A synthetic second alias creates the precise depth-64 boundary without
      // claiming to have found another identity whose canonical alias collides.
      // Seed only the tree with a mock, then replace that mock's runtime using a
      // test-RPC override. Production has no verifier replacement entry point.
      const seedVerifier = await hre.ethers.deployContract("IdentityCounterVerifierMock");
      const deepState = await deployState(seedVerifier);
      const alias = first.transition.publicSignals[3];
      const secondAlias = alias ^ (1n << 63n);
      const deepRecords = new Map([
        [alias, 1n],
        [secondAlias, 1n],
      ]);
      await mockUpdate(deepState, alias, 0n, 10_001n);
      await mockUpdate(deepState, secondAlias, 0n, 10_002n);
      await assertProof(deepState, deepRecords, alias);
      assert.equal((await deepState.getCounterProof(alias)).depth, 64n);
      assert.notEqual((await deepState.getCounterProof(alias)).siblings[63], 0n);
      const realAdapterCode = await hre.ethers.provider.getCode(await adapter.getAddress());
      await hre.ethers.provider.send("hardhat_setCode", [
        await seedVerifier.getAddress(),
        realAdapterCode,
      ]);
      assert.equal(
        await hre.ethers.provider.getCode(await deepState.VERIFIER()),
        realAdapterCode,
        "the full-depth update must execute the real Groth16 adapter",
      );
      const deepCount = await deepState.nodeCount();
      const deepOldRoot = await deepState.currentRoot();
      const deepAuthorization = await prove(222n, 1n, deepState);
      deepRecords.set(alias, 2n);
      const expectedDeepRoot = buildShieldedIdentityAuthorizationState(deepRecords).root;
      await expect(execute(deepState, deepAuthorization))
        .to.emit(deepState, "CounterIncremented")
        .withArgs(
          4n,
          alias,
          1n,
          2n,
          deepOldRoot,
          expectedDeepRoot,
          deepAuthorization.transition.publicSignals[0],
        );
      await assertProof(deepState, deepRecords, alias);
      await assertProof(deepState, deepRecords, secondAlias);
      assert.equal((await deepState.getCounterProof(alias)).depth, 64n);
      assert.equal(await deepState.nodeCount(), deepCount);
    } finally {
      await globalThis.curve_bn128?.terminate?.();
    }
  });
});
