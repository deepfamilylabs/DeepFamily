import "../hardhat-test-setup.mjs";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import "fake-indexeddb/auto";
import hre from "hardhat";
import {
  computeIdentityFromDerivedSecret,
  getShieldedIdentityAuthorizationWitness,
} from "@deepfamily/protocol-core";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import { addPerson, makeTestPerson, setupStubVerifiers } from "./helpers/testHelper.mjs";

// Exercise the actual browser replay implementations against deployed contracts.
// Their runners deliberately expose no person/alias getter or path RPC at all.
function replayProvider() {
  const provider = hre.ethers.provider;
  const filters = [];
  return {
    filters,
    provider: {
      getNetwork: () => provider.getNetwork(),
      getBlockNumber: () => provider.getBlockNumber(),
      getBlock: (block) => provider.getBlock(block),
      getCode: (address, blockTag) => provider.getCode(address, blockTag),
      getLogs: (filter) => {
        assert.equal(filter.topics.length, 1, "replay must not filter an identity topic");
        filters.push(filter);
        return provider.getLogs(filter);
      },
    },
  };
}

function publicReplayContract(contract, provider, views, calls) {
  return {
    interface: contract.interface,
    runner: { provider },
    getAddress: () => contract.getAddress(),
    ...Object.fromEntries(
      views.map((view) => [
        view,
        (...args) => {
          calls?.set(view, (calls.get(view) ?? 0) + 1);
          return contract[view](...args);
        },
      ]),
    ),
  };
}

describe("Private state reconstruction against current on-chain nodes", function () {
  this.timeout(120_000);
  let directory;
  let clients;
  let bundleUrl;
  before(async function () {
    directory = await mkdtemp(path.join(os.tmpdir(), "deepfamily-state-replay-"));
    const outfile = path.join(directory, "clients.mjs");
    await build({
      stdin: {
        contents: [
          'export { loadShieldedIdentityAuthorizationState, loadShieldedIdentityAuthorizationWitnessForMode } from "./frontend/src/shared/clients/shieldedIdentityAuthorizationChain.ts";',
          'export { loadLineageSnapshot, findHeirLegitimacy } from "./frontend/src/domains/inheritance/services/inheritanceChain.ts";',
          'export { loadPersistedIdentityAuthorizationWitness } from "./frontend/src/shared/clients/persistedIdentityAuthorization.ts";',
          'export { loadPersistedLineageSnapshot } from "./frontend/src/domains/inheritance/services/persistedLineageSnapshot.ts";',
        ].join("\n"),
        resolveDir: process.cwd(),
        loader: "ts",
      },
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
      define: { "import.meta.env": "{}" },
      logLevel: "silent",
    });
    bundleUrl = pathToFileURL(outfile).href;
    clients = await import(bundleUrl);
  });
  after(async function () {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("replays actual execution roots when owner proof roots are independent and reuses only public updates", async function () {
    const verifier = await hre.ethers.deployContract("IdentityCounterVerifierMock");
    const t3 = await hre.ethers.deployContract("PoseidonT3");
    const t4 = await hre.ethers.deployContract("PoseidonT4");
    const State = await hre.ethers.getContractFactory("IdentityAuthorizationState", {
      libraries: { PoseidonT3: await t3.getAddress(), PoseidonT4: await t4.getAddress() },
    });
    const state = await State.deploy(await verifier.getAddress());
    const replay = replayProvider();
    const publicState = publicReplayContract(state, replay.provider, [
      "creationBlock",
      "currentCheckpointId",
      "currentRoot",
      "getCheckpoint",
      "getStateSnapshotHeader",
      "getNodePage",
    ]);
    const compare = async () => {
      const loaded = await clients.loadShieldedIdentityAuthorizationState(publicState);
      assert.equal(loaded.state.root, await state.currentRoot());
      for (const alias of [11n, 15n, 16n, 11n ^ (1n << 63n)]) {
        const expected = getShieldedIdentityAuthorizationWitness(loaded.state, alias);
        const actual = await state.getCounterProof(alias);
        assert.equal(actual.authorizationCounter, expected.authorizationCounter);
        assert.equal(actual.stateRoot, expected.stateRoot);
        assert.equal(actual.depth, expected.depth);
        assert.deepEqual([...actual.siblings], expected.siblings);
        assert.equal(actual.oldKey, expected.oldKey);
        assert.equal(actual.oldValue, expected.oldValue);
        assert.equal(actual.isOld0, expected.isOld0 === 1n);
        assert.equal(actual.absent, expected.absent === 1n);
      }
      return loaded;
    };
    const increment = async (alias, counter, nonce) => {
      const input = [
        nonce,
        (await hre.ethers.provider.getNetwork()).chainId,
        BigInt(await state.getAddress()),
        alias,
        0n,
        1n,
        counter,
        counter + 1n,
      ];
      await state.incrementCounter(
        nonce,
        alias,
        0n,
        1n,
        counter,
        counter + 1n,
        hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256[8]"], [input]),
      );
    };
    let loaded = await compare();
    for (const [alias, counter, nonce] of [
      [11n, 0n, 901n],
      [15n, 0n, 902n],
      [11n ^ (1n << 63n), 0n, 903n],
      [11n, 1n, 904n],
    ]) {
      const priorBlock = loaded.blockNumber;
      replay.filters.length = 0;
      await increment(alias, counter, nonce);
      loaded = await compare();
      assert.equal(replay.filters.length, 1);
      assert.equal(replay.filters[0].fromBlock, priorBlock + 1);
    }
    const scope = {
      chainId: (await hre.ethers.provider.getNetwork()).chainId,
      authorizationStateAddress: await state.getAddress(),
    };
    const rebuilt = await clients.loadShieldedIdentityAuthorizationWitnessForMode(
      publicState,
      11n,
      undefined,
      scope,
    );
    assert.equal(rebuilt.witness.authorizationCounter, 2n);
    let pathReads = 0;
    const withPath = {
      ...publicState,
      getCounterProof: (...args) => {
        pathReads += 1;
        return state.getCounterProof(...args);
      },
    };
    const direct = await clients.loadShieldedIdentityAuthorizationWitnessForMode(
      withPath,
      11n,
      "chain",
      scope,
    );
    assert.equal(pathReads, 1);
    assert.deepEqual(direct.witness, rebuilt.witness);
    await assert.rejects(
      clients.loadShieldedIdentityAuthorizationWitnessForMode(
        {
          ...withPath,
          currentRoot: () => {
            throw new Error("Global replay read failed");
          },
        },
        11n,
        undefined,
        scope,
      ),
      /Global replay read failed/,
    );
    assert.equal(pathReads, 1, "failed rebuild must never fall back to a path RPC");
  });

  it("replays current lineage slots through replacement, cancellation, renewal and trust removal", async function () {
    const { deepFamily, lineageIndex, token } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    await setupStubVerifiers(hre.ethers, deepFamily);
    const [manager] = await hre.ethers.getSigners();
    const root = makeTestPerson("Rebuild Root", { derivedSecretField: 701n, birthYear: 1930 });
    const spouse = makeTestPerson("Unregistered Rebuild Spouse", {
      derivedSecretField: 702n,
      birthYear: 1932,
      gender: 2,
    });
    const child = makeTestPerson("Rebuild Child", { derivedSecretField: 703n, birthYear: 1960 });
    const rootHash = await addPerson(hre.ethers, deepFamily, manager, undefined, { person: root });
    const childHash = await addPerson(hre.ethers, deepFamily, manager, undefined, {
      person: child,
      fatherPerson: root,
      motherPerson: spouse,
    });
    await token.approve(await deepFamily.getAddress(), hre.ethers.MaxUint256);
    const replay = replayProvider();
    const index = publicReplayContract(lineageIndex, replay.provider, [
      "currentCheckpointId",
      "getCheckpoint",
      "root",
    ]);
    const family = publicReplayContract(deepFamily, replay.provider, []);
    const compare = async (versionIndex) => {
      const snapshot = await clients.loadLineageSnapshot(index, family);
      for (const [treeId, tree] of [
        [0, snapshot.endorsementTree],
        [1, snapshot.trustedTree],
      ]) {
        assert.equal(tree.root, await lineageIndex.root(treeId));
        for (let leafIndex = 0n; leafIndex < tree.sizeBigInt; leafIndex++) {
          const proof = tree.generateProof(leafIndex);
          const actual = await lineageIndex.getMerkleProof(treeId, leafIndex);
          assert.equal(actual.leaf, proof.leaf);
          assert.equal(actual.proofRoot, proof.root);
          assert.equal(actual.proofIndex, BigInt(proof.index));
          assert.deepEqual([...actual.siblings], proof.siblings);
        }
      }
      const rootIdentity = snapshot.versions.get(rootHash.toLowerCase())[0].identityCommitment;
      const childIdentity = snapshot.versions.get(childHash.toLowerCase())[0].identityCommitment;
      assert.deepEqual(
        clients
          .findHeirLegitimacy({
            snapshot,
            heir: { personHash: childHash, identityCommitment: childIdentity },
            root: { identityCommitment: rootIdentity },
            rootVersionIndex: 1,
          })
          .map((source) => source.versionIndex),
        versionIndex === null ? [] : [versionIndex],
      );
      return snapshot;
    };
    await compare(null);
    await deepFamily.endorseVersion(childHash, 1);
    await compare(1);
    await addPerson(hre.ethers, deepFamily, manager, undefined, {
      person: child,
      fatherPerson: root,
    });
    await deepFamily.endorseVersion(childHash, 2);
    const replaced = await compare(2);
    assert.equal(replaced.versions.get(childHash.toLowerCase()).length, 2);
    assert.notEqual(replaced.versions.get(childHash.toLowerCase())[0].motherIdentityCommitment, 0n);
    await deepFamily.cancelEndorsement(childHash);
    await compare(null);
    await deepFamily.endorseVersion(childHash, 2);
    await compare(2);
    await deepFamily.removeTrustedEndorser(rootHash, 1, manager.address);
    await compare(null);
    await deepFamily.addTrustedEndorser(rootHash, 1, manager.address);
    await compare(2);
  });

  it("bootstraps real authorization pages once, reopens persistent nodes and applies only later global events", async function () {
    const verifier = await hre.ethers.deployContract("IdentityCounterVerifierMock");
    const t3 = await hre.ethers.deployContract("PoseidonT3");
    const t4 = await hre.ethers.deployContract("PoseidonT4");
    const State = await hre.ethers.getContractFactory("IdentityAuthorizationState", {
      libraries: { PoseidonT3: await t3.getAddress(), PoseidonT4: await t4.getAddress() },
    });
    const state = await State.deploy(await verifier.getAddress());
    const chainId = (await hre.ethers.provider.getNetwork()).chainId;
    const scope = { chainId, authorizationStateAddress: await state.getAddress() };
    let nonce = 8000n;
    const increment = async (alias, oldCounter) => {
      const inputs = [
        ++nonce,
        chainId,
        BigInt(await state.getAddress()),
        alias,
        0n,
        1n,
        oldCounter,
        oldCounter + 1n,
      ];
      await state.incrementCounter(
        inputs[0],
        alias,
        0n,
        1n,
        oldCounter,
        oldCounter + 1n,
        hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256[8]"], [inputs]),
      );
    };
    const deepAlias = 11n ^ (1n << 63n);
    await increment(11n, 0n);
    await increment(deepAlias, 0n);
    const views = [
      "creationBlock",
      "currentRoot",
      "currentCheckpointId",
      "getCheckpoint",
      "getStateSnapshotHeader",
      "getNodePage",
    ];
    const firstProvider = replayProvider();
    const calls = new Map();
    const first = publicReplayContract(state, firstProvider.provider, views, calls);
    const compare = async (client, contract, alias) => {
      const loaded = await client.loadPersistedIdentityAuthorizationWitness(contract, alias, scope);
      const actual = await state.getCounterProof(alias);
      assert.equal(loaded.stateRoot, await state.currentRoot());
      assert.equal(loaded.witness.authorizationCounter, actual.authorizationCounter);
      assert.equal(loaded.witness.depth, actual.depth);
      assert.deepEqual(loaded.witness.siblings, [...actual.siblings]);
      assert.equal(loaded.witness.oldKey, actual.oldKey);
      assert.equal(loaded.witness.oldValue, actual.oldValue);
      assert.equal(loaded.witness.isOld0 === 1n, actual.isOld0);
      assert.equal(loaded.witness.absent === 1n, actual.absent);
      return loaded;
    };
    const cold = await compare(clients, first, 11n);
    assert.equal(cold.witness.depth, 64n);
    assert.equal(calls.get("getNodePage"), 1);
    assert.equal(
      firstProvider.filters.length,
      0,
      "current-state bootstrap must not replay old events",
    );
    const restarted = await import(`${bundleUrl}?authorization-restart`);
    const secondProvider = replayProvider();
    const warm = publicReplayContract(
      state,
      secondProvider.provider,
      views.filter((name) => name !== "getNodePage"),
    );
    warm.getNodePage = () => {
      throw new Error("Ready public nodes must survive a Worker/provider restart");
    };
    const resumed = await compare(restarted, warm, 11n);
    assert.deepEqual(resumed.witness, cold.witness);
    await compare(restarted, warm, 53n);
    assert.equal(secondProvider.filters.length, 0);
    await increment(11n, 1n);
    await increment(15n, 0n);
    const updated = await compare(restarted, warm, 11n);
    assert.equal(updated.witness.authorizationCounter, 2n);
    await compare(restarted, warm, 15n);
    await compare(restarted, warm, deepAlias);
    assert.equal(secondProvider.filters.length, 1);
    assert.equal(secondProvider.filters[0].fromBlock, resumed.blockNumber + 1);
  });

  it("bootstraps real lineage openings once and keeps durable local qualification current through global deltas", async function () {
    const { deepFamily, lineageIndex, token } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    await setupStubVerifiers(hre.ethers, deepFamily);
    const [manager] = await hre.ethers.getSigners();
    const root = makeTestPerson("Durable Root", { derivedSecretField: 1701n, birthYear: 1930 });
    const spouse = makeTestPerson("Durable Unregistered Spouse", {
      derivedSecretField: 1702n,
      gender: 2,
      birthYear: 1932,
    });
    const child = makeTestPerson("Durable Child", { derivedSecretField: 1703n, birthYear: 1960 });
    const rootHash = await addPerson(hre.ethers, deepFamily, manager, undefined, { person: root });
    const childHash = await addPerson(hre.ethers, deepFamily, manager, undefined, {
      person: child,
      fatherPerson: root,
      motherPerson: spouse,
    });
    await token.approve(await deepFamily.getAddress(), hre.ethers.MaxUint256);
    await deepFamily.endorseVersion(childHash, 1);
    const identity = (person) =>
      computeIdentityFromDerivedSecret({
        identity: person,
        identitySuiteId: 1,
        derivedSecretField: person.derivedSecretField,
      });
    const rootIdentity = identity(root).identityCommitment;
    const childIdentity = identity(child).identityCommitment;
    const request = {
      parentIdentityCommitments: [rootIdentity],
      eligibility: [
        {
          heirIdentityCommitment: childIdentity,
          rootIdentityCommitment: rootIdentity,
          rootVersionIndex: 1,
        },
      ],
    };
    const views = [
      "DEEP_FAMILY",
      "root",
      "size",
      "currentCheckpointId",
      "getCheckpoint",
      "versionMetadataCount",
      "getLeafPage",
      "getVersionPage",
      "getEndorsementPage",
      "getTrustedPage",
    ];
    const firstProvider = replayProvider();
    const calls = new Map();
    const firstIndex = publicReplayContract(lineageIndex, firstProvider.provider, views, calls);
    const firstFamily = publicReplayContract(deepFamily, firstProvider.provider, ["lineageIndex"]);
    const compare = async (client, index, family, expectedVersion) => {
      const snapshot = await client.loadPersistedLineageSnapshot(index, family, request);
      for (const [id, tree] of [
        [0, snapshot.endorsementTree],
        [1, snapshot.trustedTree],
      ]) {
        assert.equal(tree.root, await lineageIndex.root(id));
        assert.equal(tree.sizeBigInt, await lineageIndex.size(id));
      }
      const sources = client.findHeirLegitimacy({
        snapshot,
        heir: { personHash: childHash, identityCommitment: childIdentity },
        root: { identityCommitment: rootIdentity },
        rootVersionIndex: 1,
      });
      assert.deepEqual(
        sources.map((source) => source.versionIndex),
        expectedVersion === null ? [] : [expectedVersion],
      );
      for (const source of sources) {
        for (const [id, tree, slot] of [
          [0, snapshot.endorsementTree, source.endorsementLeafIndex],
          [1, snapshot.trustedTree, source.trustedLeafIndex],
        ]) {
          const local = tree.generateProof(slot);
          const actual = await lineageIndex.getMerkleProof(id, slot);
          assert.equal(local.leaf, actual.leaf);
          assert.equal(local.root, actual.proofRoot);
          assert.equal(BigInt(local.index), actual.proofIndex);
          assert.deepEqual(local.siblings, [...actual.siblings]);
        }
      }
      return snapshot;
    };
    const cold = await compare(clients, firstIndex, firstFamily, 1);
    assert.equal(calls.get("getLeafPage"), 2);
    assert.equal(calls.get("getVersionPage"), 1);
    assert.equal(calls.get("getEndorsementPage"), 1);
    assert.equal(calls.get("getTrustedPage"), 1);
    assert.equal(
      firstProvider.filters.length,
      0,
      "fresh lineage bootstrap uses current pages, not old history",
    );
    assert.notEqual(cold.versions.get(childHash.toLowerCase())[0].motherIdentityCommitment, 0n);
    const restarted = await import(`${bundleUrl}?lineage-restart`);
    const secondProvider = replayProvider();
    const secondCalls = new Map();
    const warmIndex = publicReplayContract(
      lineageIndex,
      secondProvider.provider,
      views.filter((name) => name !== "getLeafPage"),
      secondCalls,
    );
    warmIndex.getLeafPage = () => {
      throw new Error("Ready lineage leaves must survive a Worker/provider restart");
    };
    const warmFamily = publicReplayContract(deepFamily, secondProvider.provider, ["lineageIndex"]);
    const warm = await compare(restarted, warmIndex, warmFamily, 1);
    assert.equal(warm.blockHash, cold.blockHash);
    assert.equal(secondProvider.filters.length, 0);
    assert.equal(secondCalls.get("getVersionPage"), undefined);
    assert.equal(secondCalls.get("getEndorsementPage"), undefined);
    assert.equal(secondCalls.get("getTrustedPage"), undefined);
    await addPerson(hre.ethers, deepFamily, manager, undefined, {
      person: child,
      fatherPerson: root,
    });
    await deepFamily.endorseVersion(childHash, 2);
    const replacement = await compare(restarted, warmIndex, warmFamily, 2);
    assert.equal(replacement.versions.get(childHash.toLowerCase()).length, 2);
    assert.equal(secondCalls.get("getVersionPage"), 1);
    assert.equal(secondProvider.filters[0].fromBlock, warm.blockNumber + 1);
    await deepFamily.cancelEndorsement(childHash);
    await compare(restarted, warmIndex, warmFamily, null);
    await deepFamily.endorseVersion(childHash, 2);
    await compare(restarted, warmIndex, warmFamily, 2);
    await deepFamily.removeTrustedEndorser(rootHash, 1, manager.address);
    await compare(restarted, warmIndex, warmFamily, null);
    await deepFamily.addTrustedEndorser(rootHash, 1, manager.address);
    await compare(restarted, warmIndex, warmFamily, 2);
    assert.equal(secondProvider.filters.length, 5);
  });
});
