import "../hardhat-test-setup.mjs";
import assert from "node:assert/strict";
import { expect } from "chai";
import hre from "hardhat";
import { poseidon2, poseidon3 } from "poseidon-lite";
import {
  buildShieldedIdentityAuthorizationState,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
} from "@deepfamily/protocol-core";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import { addPerson, makeTestPerson, setupStubVerifiers } from "./helpers/testHelper.mjs";

const MAX = hre.ethers.MaxUint256;

async function authFixture() {
  const verifier = await hre.ethers.deployContract("IdentityCounterVerifierMock");
  const t3 = await hre.ethers.deployContract("PoseidonT3");
  const t4 = await hre.ethers.deployContract("PoseidonT4");
  const State = await hre.ethers.getContractFactory("IdentityAuthorizationState", {
    libraries: { PoseidonT3: await t3.getAddress(), PoseidonT4: await t4.getAddress() },
  });
  const state = await State.deploy(await verifier.getAddress());
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;
  let nonce = 10_000n;
  const increment = async (alias, counter = 0n) => {
    const inputs = [
      ++nonce,
      chainId,
      BigInt(await state.getAddress()),
      alias,
      0n,
      1n,
      counter,
      counter + 1n,
    ];
    return state.incrementCounter(
      inputs[0],
      alias,
      0n,
      1n,
      counter,
      counter + 1n,
      hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256[8]"], [inputs]),
    );
  };
  return { state, increment };
}

async function collectPages(read, count, pageSize = 2n, start = 0n) {
  const rows = [];
  for (let offset = start; offset < count + start; offset += pageSize) {
    rows.push(...(await read(offset, pageSize)));
  }
  return rows;
}

describe("Global current-state snapshot pagination", function () {
  this.timeout(120_000);

  it("exports every authorization node with bounded pages, stable IDs and fixed-block consistency", async function () {
    const { state, increment } = await hre.networkHelpers.loadFixture(authFixture);
    const empty = await state.getStateSnapshotHeader();
    assert.deepEqual([...empty], [1n, 0n, 0n, 0n, 1n]);
    assert.deepEqual([...(await state.getNodePage(1, 256))], []);
    for (const [start, limit] of [
      [0n, 1n],
      [2n, 1n],
      [1n, 0n],
      [1n, 257n],
      [MAX, 1n],
    ])
      await expect(state.getNodePage(start, limit)).to.be.revertedWithCustomError(
        state,
        "InvalidSnapshotPage",
      );

    const expected = new Map();
    // Real inserts exercise a full maximum-size response, without synthetic storage writes.
    for (let alias = 1n; alias <= 129n; ++alias) {
      await increment(alias);
      expected.set(alias, 1n);
    }
    const header = await state.getStateSnapshotHeader();
    assert.equal(header.formatVersion, 1n);
    assert.equal(header.nodeCount, 257n);
    assert.equal((await state.getNodePage(1, 256)).length, 256);
    assert.equal((await state.getNodePage(257, 256)).length, 1);
    assert.deepEqual([...(await state.getNodePage(258, 1))], []);
    await expect(state.getNodePage(259, 1)).to.be.revertedWithCustomError(
      state,
      "InvalidSnapshotPage",
    );
    const nodes = await collectPages(
      (start, limit) => state.getNodePage(start, limit),
      257n,
      13n,
      1n,
    );
    const seen = new Set();
    const entries = new Map();
    const hash = (id, depth = 0) => {
      if (id === 0n) return 0n;
      assert.ok(id > 0n && id <= header.nodeCount);
      assert.ok(!seen.has(id), "node IDs must not be cyclic or reused by different parents");
      seen.add(id);
      const node = nodes[Number(id - 1n)];
      let computed;
      if (node.counter !== 0n) {
        assert.equal(node.left, 0n);
        assert.equal(node.right, 0n);
        assert.ok(!entries.has(node.key));
        entries.set(node.key, node.counter);
        computed = poseidon3([node.key, node.counter, 1n]);
      } else {
        assert.ok(depth < 64);
        assert.equal(node.key, 0n);
        assert.ok(node.left !== 0n || node.right !== 0n);
        computed = poseidon2([hash(node.left, depth + 1), hash(node.right, depth + 1)]);
      }
      assert.equal(node.hash, computed);
      return computed;
    };
    assert.equal(hash(header.rootNodeId), header.root);
    assert.equal(BigInt(seen.size), header.nodeCount);
    assert.deepEqual([...entries].sort(), [...expected].sort());
    assert.equal(buildShieldedIdentityAuthorizationState(entries).root, header.root);
    assert.deepEqual(
      [...(await state.getStateSnapshotHeader())],
      [...header],
      "views cannot mutate state",
    );

    const fixedBlock = await hre.ethers.provider.getBlockNumber();
    const before = [...(await state.getNodePage(1, 256))].map((row) => [...row]);
    await increment(1n, 1n);
    const current = await state.getStateSnapshotHeader();
    assert.equal(current.nodeCount, header.nodeCount);
    assert.equal(current.rootNodeId, header.rootNodeId);
    assert.notEqual(current.root, header.root);
    assert.equal(current.checkpointId, header.checkpointId + 1n);
    assert.deepEqual(
      [...(await state.getStateSnapshotHeader({ blockTag: fixedBlock }))],
      [...header],
    );
    assert.deepEqual(
      [...(await state.getNodePage(1, 256, { blockTag: fixedBlock }))].map((row) => [...row]),
      before,
    );
  });

  it("exports lineage slot openings through replacement, cancellation, renewal and trust changes", async function () {
    const { deepFamily, lineageIndex, token } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    await setupStubVerifiers(hre.ethers, deepFamily);
    const [manager] = await hre.ethers.getSigners();
    assert.equal(await lineageIndex.versionMetadataCount(), 0n);
    for (const read of [
      (start, limit) => lineageIndex.getVersionPage(start, limit),
      (start, limit) => lineageIndex.getEndorsementPage(start, limit),
      (start, limit) => lineageIndex.getTrustedPage(start, limit),
      (start, limit) => lineageIndex.getLeafPage(0, start, limit),
      (start, limit) => lineageIndex.getLeafPage(1, start, limit),
    ]) {
      assert.deepEqual([...(await read(0, 256))], []);
      for (const [start, limit] of [
        [1n, 1n],
        [0n, 0n],
        [0n, 257n],
        [MAX, 1n],
      ])
        await expect(read(start, limit)).to.be.revertedWithCustomError(
          lineageIndex,
          "InvalidSnapshotPage",
        );
    }
    await expect(lineageIndex.getLeafPage(2, 0, 1)).to.be.revertedWithCustomError(
      lineageIndex,
      "InvalidTreeId",
    );
    const root = makeTestPerson("Snapshot Root", { derivedSecretField: 901n, birthYear: 1930 });
    const spouse = makeTestPerson("Snapshot Unregistered Spouse", {
      derivedSecretField: 902n,
      gender: 2,
      birthYear: 1932,
    });
    const child = makeTestPerson("Snapshot Child", { derivedSecretField: 903n, birthYear: 1960 });
    const sibling = makeTestPerson("Snapshot Sibling", {
      derivedSecretField: 904n,
      birthYear: 1962,
    });
    const rootHash = await addPerson(hre.ethers, deepFamily, manager, undefined, { person: root });
    const childHash = await addPerson(hre.ethers, deepFamily, manager, undefined, {
      person: child,
      fatherPerson: root,
      motherPerson: spouse,
    });
    const siblingHash = await addPerson(hre.ethers, deepFamily, manager, undefined, {
      person: sibling,
      fatherPerson: root,
      motherPerson: spouse,
    });
    await token.approve(await deepFamily.getAddress(), hre.ethers.MaxUint256);
    await deepFamily.endorseVersion(childHash, 1);
    await deepFamily.endorseVersion(siblingHash, 1);

    const check = async () => {
      const roots = [await lineageIndex.root(0), await lineageIndex.root(1)];
      const checkpointId = await lineageIndex.currentCheckpointId();
      const versions = await collectPages(
        (start, limit) => lineageIndex.getVersionPage(start, limit),
        await lineageIndex.versionMetadataCount(),
      );
      for (const row of versions) {
        assert.equal(
          row.identityCommitment,
          await lineageIndex.identityCommitmentOf(row.personHash),
        );
        assert.deepEqual(
          [row.fatherIdentityCommitment, row.motherIdentityCommitment],
          [...(await lineageIndex.versionParents(row.personHash, row.versionIndex))],
        );
      }
      const endorsements = await collectPages(
        (start, limit) => lineageIndex.getEndorsementPage(start, limit),
        await lineageIndex.size(0),
        1n,
      );
      const trusted = await collectPages(
        (start, limit) => lineageIndex.getTrustedPage(start, limit),
        await lineageIndex.size(1),
      );
      for (const [treeId, rows] of [
        [0, endorsements],
        [1, trusted],
      ]) {
        const leaves = await collectPages(
          (start, limit) => lineageIndex.getLeafPage(treeId, start, limit),
          await lineageIndex.size(treeId),
        );
        assert.equal(rows.length, leaves.length);
        for (let index = 0; index < rows.length; ++index) {
          const row = rows[index];
          assert.equal(row.active, leaves[index] !== 0n);
          const slot =
            treeId === 0
              ? await lineageIndex.endorsementLeafIndex(row.personHash, row.endorser)
              : await lineageIndex.trustedLeafIndex(row.personHash, row.versionIndex, row.account);
          assert.deepEqual([...slot], [true, BigInt(index)]);
          if (treeId === 0) {
            assert.deepEqual(
              [...(await lineageIndex.getEndorsementMetadata(row.personHash, row.endorser))],
              [row.versionIndex, row.writtenAt],
            );
            if (!row.active) {
              assert.equal(row.versionIndex, 0n);
              assert.equal(row.writtenAt, 0n);
            }
          }
          if (row.active) {
            const version = versions.find(
              (item) =>
                item.personHash === row.personHash && item.versionIndex === row.versionIndex,
            );
            assert.ok(version, "every slot opening must reference an enumerated version");
            const computed =
              treeId === 0
                ? computeLineageEndorsementLeaf({
                    identityCommitment: version.identityCommitment,
                    versionIndex: version.versionIndex,
                    parentsDigest: computeLineageParentsDigest(version),
                    endorser: row.endorser,
                    writtenAt: row.writtenAt,
                  })
                : computeLineageTrustedLeaf({
                    rootIdentityCommitment: version.identityCommitment,
                    rootVersionIndex: row.versionIndex,
                    account: row.account,
                  });
            assert.equal(computed, leaves[index]);
          }
          assert.equal((await lineageIndex.getMerkleProof(treeId, index)).leaf, leaves[index]);
        }
      }
      assert.deepEqual([await lineageIndex.root(0), await lineageIndex.root(1)], roots);
      assert.equal(await lineageIndex.currentCheckpointId(), checkpointId);
      return { versions, endorsements, trusted };
    };
    const original = await check();
    const fixedBlock = await hre.ethers.provider.getBlockNumber();
    assert.equal(original.versions.length, 3);
    assert.equal(original.endorsements.length, 2);
    assert.equal(original.trusted.length, 3);
    assert.notEqual(original.versions[1].motherIdentityCommitment, 0n);
    await addPerson(hre.ethers, deepFamily, manager, undefined, {
      person: child,
      fatherPerson: root,
    });
    await deepFamily.endorseVersion(childHash, 2);
    const replaced = await check();
    assert.equal(replaced.versions.length, 4);
    assert.equal(replaced.versions[1].versionIndex, 1n);
    assert.equal(replaced.versions[3].versionIndex, 2n);
    assert.equal(replaced.versions[3].motherIdentityCommitment, 0n);
    assert.equal(replaced.endorsements.length, 2);
    assert.equal(replaced.endorsements[0].versionIndex, 2n);
    await deepFamily.cancelEndorsement(childHash);
    const cancelled = await check();
    assert.equal(cancelled.endorsements[0].personHash, childHash);
    assert.equal(cancelled.endorsements[0].endorser, manager.address);
    assert.equal(cancelled.endorsements[0].active, false);
    assert.equal(cancelled.endorsements[1].active, true);
    await deepFamily.endorseVersion(childHash, 2);
    assert.equal((await check()).endorsements[0].active, true);
    await deepFamily.removeTrustedEndorser(rootHash, 1, manager.address);
    assert.equal((await check()).trusted[0].active, false);
    await deepFamily.addTrustedEndorser(rootHash, 1, manager.address);
    assert.equal((await check()).trusted[0].active, true);
    for (const [read, prior] of [
      [
        (start, limit) => lineageIndex.getVersionPage(start, limit, { blockTag: fixedBlock }),
        original.versions,
      ],
      [
        (start, limit) => lineageIndex.getEndorsementPage(start, limit, { blockTag: fixedBlock }),
        original.endorsements,
      ],
      [
        (start, limit) => lineageIndex.getTrustedPage(start, limit, { blockTag: fixedBlock }),
        original.trusted,
      ],
    ]) {
      assert.deepEqual(
        (await read(0, 256)).map((row) => [...row]),
        prior.map((row) => [...row]),
      );
      assert.deepEqual([...(await read(prior.length, 256))], []);
      await expect(read(prior.length + 1, 1)).to.be.revertedWithCustomError(
        lineageIndex,
        "InvalidSnapshotPage",
      );
    }
  });
});
