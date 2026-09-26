import "../hardhat-test-setup.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "chai";
import hre from "hardhat";
import * as snarkjs from "snarkjs";
import {
  buildInheritanceClaimWitness,
  buildLineageMerkleProofFromPath,
  computeIdentityFromDerivedSecret,
  computeInheritanceCredential,
  computeInheritanceEligibleFrom,
  computeLineageTrustedLeaf,
  hashLineageNodes,
  replayLineageTree,
} from "@deepfamily/protocol-core";
import { encodeGroth16AbcProofData, normalizeGroth16Proof } from "@deepfamily/proof-core";
import { loadStorageLayoutFromArtifactObject } from "../scripts/lib/storageLayout.mjs";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import {
  addPerson,
  buildPersonCommitmentCircuitInput,
  makeAddPersonPublicSignals,
  makeMetadataEnvelope,
  makeStubProof,
  makeTestPerson,
  setupStubVerifiers,
} from "./helpers/testHelper.mjs";

const TRUSTED_TREE = 1;
const ENDORSEMENT_TREE = 0;
const DEEP = 10n ** 18n;
const REAL_SIZES_TO_REPORT = new Set([2, 4, 8, 9, 15, 16, 17, 31, 32, 33]);
// Match the repository's 15M eSpace single-transaction test budget with 20% headroom.
// This local EDR regression gate is not a guarantee about a live network's gas policy.
const SINGLE_TX_TEST_BUDGET = 15_000_000n;
const coder = hre.ethers.AbiCoder.defaultAbiCoder();
const ZK_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../frontend/public/zk",
);
const CLAIM_WASM = path.join(ZK_DIRECTORY, "family_inheritance_claim.wasm");
const CLAIM_ZKEY = path.join(ZK_DIRECTORY, "family_inheritance_claim_final.zkey");

function reportGas(measurements) {
  if (process.env.LINEAGE_GAS_REPORT === "1") console.table(measurements);
}

function assertGasBudget(label, estimate, receipt) {
  expect(receipt.status, label).to.equal(1);
  expect(receipt.gasUsed, label).to.be.greaterThan(0n);
  expect((estimate * 120n + 99n) / 100n, `${label} with 20% headroom`).to.be.lessThan(
    SINGLE_TX_TEST_BUDGET,
  );
  expect(
    (receipt.gasUsed * 120n + 99n) / 100n,
    `${label} receipt with 20% headroom`,
  ).to.be.lessThan(SINGLE_TX_TEST_BUDGET);
}

function row(label, tree, size, depth, estimate, receipt) {
  assertGasBudget(label, estimate, receipt);
  return {
    operation: label,
    tree,
    size: String(size),
    depth: String(depth),
    estimate: String(estimate),
    gasUsed: String(receipt.gasUsed),
  };
}

async function measureInheritance(method, args, label, id) {
  const estimate = await method.estimateGas(...args);
  const receipt = await (await method(...args)).wait();
  assertGasBudget(`${label} id ${id}`, estimate, receipt);
  return {
    display: {
      operation: label,
      id: String(id),
      estimate: String(estimate),
      gasUsed: String(receipt.gasUsed),
    },
    gasUsed: receipt.gasUsed,
  };
}

async function replayedTree(lineageIndex, treeId) {
  const events = await lineageIndex.queryFilter(lineageIndex.filters.LeafWritten(treeId));
  events.sort((left, right) => left.blockNumber - right.blockNumber || left.index - right.index);
  return replayLineageTree(
    events.map(({ args }) => ({ leafIndex: args.leafIndex, leaf: args.leaf })),
  );
}

async function inheritanceClaimProof(context, id, recipient) {
  const {
    familyInheritance,
    lineageIndex,
    root,
    rootHash,
    heir,
    heirHash,
    spouse,
    rootIdentity,
    manager,
    writtenAt,
  } = context;
  const inheritance = await familyInheritance.inheritanceOf(id);
  const eligibleFrom = computeInheritanceEligibleFrom({
    startTime: inheritance.startTime,
    writtenAt,
  });
  const [hasEndorsement, endorsementLeafIndex] = await lineageIndex.endorsementLeafIndex(
    heirHash,
    manager.address,
  );
  const [isTrusted, trustedLeafIndex] = await lineageIndex.trustedLeafIndex(
    rootHash,
    1,
    manager.address,
  );
  expect(hasEndorsement).to.equal(true);
  expect(isTrusted).to.equal(true);
  const spouseIdentity = computeIdentityFromDerivedSecret({
    identity: spouse,
    identitySuiteId: 1,
    derivedSecretField: spouse.derivedSecretField,
  });
  const { witness, publicSignals } = buildInheritanceClaimWitness({
    heir: { identity: heir, identitySuiteId: 1, derivedSecretField: heir.derivedSecretField },
    versionIndex: 1,
    fatherIdentityCommitment: rootIdentity.identityCommitment,
    motherIdentityCommitment: spouseIdentity.identityCommitment,
    rootIsMother: false,
    endorser: manager.address,
    writtenAt,
    endorsementTree: await replayedTree(lineageIndex, ENDORSEMENT_TREE),
    endorsementLeafIndex: Number(endorsementLeafIndex),
    root: {
      identityCommitment: rootIdentity.identityCommitment,
      versionIndex: 1,
      derivedSecretField: root.derivedSecretField,
    },
    trustedTree: await replayedTree(lineageIndex, TRUSTED_TREE),
    trustedLeafIndex: Number(trustedLeafIndex),
    eligibleFrom,
    recipient,
  });
  const { proof } = await snarkjs.groth16.fullProve(
    witness,
    CLAIM_WASM,
    CLAIM_ZKEY,
    undefined,
    undefined,
    { singleThread: true },
  );
  return {
    proofData: encodeGroth16AbcProofData(normalizeGroth16Proof(proof)),
    signals: {
      endorsementRoot: publicSignals.endorsementRoot,
      trustedRoot: publicSignals.trustedRoot,
      claimTag: publicSignals.claimTag,
      eligibleFrom: publicSignals.eligibleFrom,
      recipient,
    },
  };
}

async function measure(method, args, label, tree, lineageIndex) {
  const estimate = await method.estimateGas(...args);
  const receipt = await (await method(...args)).wait();
  return row(
    label,
    tree,
    await lineageIndex.size(tree),
    await lineageIndex.depth(tree),
    estimate,
    receipt,
  );
}

async function setupSinglePerson() {
  const deployed = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
  await setupStubVerifiers(hre.ethers, deployed.deepFamily);
  const [manager] = await hre.ethers.getSigners();
  const person = makeTestPerson("Lineage gas root", { derivedSecretField: 78631n });
  const personHash = await addPerson(hre.ethers, deployed.deepFamily, manager, undefined, {
    person,
    tag: "gas-root",
  });
  expect(await deployed.lineageIndex.size(TRUSTED_TREE)).to.equal(1n);
  return { ...deployed, manager, person, personHash };
}

function syntheticAccount(index) {
  return hre.ethers.getAddress(hre.ethers.toBeHex(0x1000n + BigInt(index), 20));
}

async function submitChildVersion({ deepFamily, manager, lineageIndex }) {
  const person = makeTestPerson("Lineage gas child", { derivedSecretField: 78632n });
  const father = makeTestPerson("Lineage gas father", { derivedSecretField: 78633n });
  const mother = makeTestPerson("Lineage gas mother", {
    derivedSecretField: 78634n,
    gender: 2,
  });
  const built = buildPersonCommitmentCircuitInput(person, father, mother, manager.address, {
    ethers: hre.ethers,
    tag: "gas-child",
  });
  const signals = makeAddPersonPublicSignals(built.person.identityCommitment, manager.address, {
    fatherIdentityCommitment: built.father.identityCommitment,
    motherIdentityCommitment: built.mother.identityCommitment,
    versionCommitment: built.versionCommitment,
  });
  const method = deepFamily.connect(manager).addPersonVersion;
  const measurement = await measure(
    method,
    [makeStubProof(), signals, 0, 0, makeMetadataEnvelope(hre.ethers, 1, { tag: "gas-child" })],
    "addPersonVersion (complete parents)",
    TRUSTED_TREE,
    lineageIndex,
  );
  return { measurement, personHash: built.person.personHash };
}

function memberSlot(layout, treeId, memberName) {
  const array = layout.storage.find((entry) => entry.label === "_trees");
  if (!array || Number(array.offset) !== 0) throw new Error("Unexpected _trees storage layout");
  const arrayType = layout.types[array.type];
  const treeType = layout.types[arrayType?.base];
  const treeWords = BigInt(treeType?.numberOfBytes ?? 0) / 32n;
  const member = treeType?.members?.find((entry) => entry.label === memberName);
  if (!member || treeWords === 0n || BigInt(treeType.numberOfBytes) % 32n !== 0n) {
    throw new Error(`Unexpected Tree.${memberName} storage layout`);
  }
  return BigInt(array.slot) + BigInt(treeId) * treeWords + BigInt(member.slot);
}

function nodeSlot(nodesSlot, level, index) {
  const levelSlot = hre.ethers.keccak256(coder.encode(["uint256", "uint256"], [level, nodesSlot]));
  return hre.ethers.keccak256(coder.encode(["uint256", "uint256"], [index, levelSlot]));
}

async function setWord(address, slot, value) {
  await hre.networkHelpers.setStorageAt(address, slot, value);
}

async function treeStorageSlots() {
  const layout = loadStorageLayoutFromArtifactObject(
    await hre.artifacts.readArtifact("DeepFamilyLineageIndex"),
  );
  return {
    size: memberSlot(layout, TRUSTED_TREE, "size"),
    depth: memberSlot(layout, TRUSTED_TREE, "depth"),
    root: memberSlot(layout, TRUSTED_TREE, "root"),
    nodes: memberSlot(layout, TRUSTED_TREE, "nodes"),
  };
}

/**
 * Place one internally consistent leaf-0 path into local EDR storage. The sibling nodes stand
 * for whole subtrees, but their leaves are not materialized. This measures one update path only;
 * it is not an end-to-end proof or a way to create billions of real on-chain records.
 */
async function seedSyntheticPath({ lineageIndex, personHash, manager }, depth) {
  const address = await lineageIndex.getAddress();
  const slots = await treeStorageSlots();
  const [exists, leafIndex] = await lineageIndex.trustedLeafIndex(personHash, 1, manager.address);
  expect(exists).to.equal(true);
  expect(leafIndex).to.equal(0n);
  const identityCommitment = await lineageIndex.identityCommitmentOf(personHash);
  const leaf = computeLineageTrustedLeaf({
    rootIdentityCommitment: identityCommitment,
    rootVersionIndex: 1,
    account: manager.address,
  });
  expect(await lineageIndex.root(TRUSTED_TREE)).to.equal(leaf);

  let root = leaf;
  let deletedRoot = 0n;
  for (let level = 0; level < depth; level += 1) {
    const sibling = 10_000n + BigInt(level);
    await setWord(address, nodeSlot(slots.nodes, level, 0), root);
    await setWord(address, nodeSlot(slots.nodes, level, 1), sibling);
    root = hashLineageNodes(root, sibling);
    deletedRoot = hashLineageNodes(deletedRoot, sibling);
  }
  await setWord(address, nodeSlot(slots.nodes, depth, 0), root);
  await setWord(address, slots.size, 1n << BigInt(depth));
  await setWord(address, slots.depth, BigInt(depth));
  await setWord(address, slots.root, root);
  expect(await lineageIndex.size(TRUSTED_TREE)).to.equal(1n << BigInt(depth));
  expect(await lineageIndex.depth(TRUSTED_TREE)).to.equal(BigInt(depth));
  expect(await lineageIndex.root(TRUSTED_TREE)).to.equal(root);
  return { root, deletedRoot, identityCommitment };
}

/**
 * Seed the right edge of a size 2^depth - 1 tree. The next appended leaf is the right child
 * at every level, so it must hash with a populated left sibling at every level. Sibling
 * subtrees are represented by their root nodes; their leaves are not materialized.
 */
async function seedSyntheticAppendPath({ lineageIndex, personHash }, depth) {
  const address = await lineageIndex.getAddress();
  const slots = await treeStorageSlots();
  const oldSize = (1n << BigInt(depth)) - 1n;
  const siblings = [];
  let oldBranch;
  for (let level = 0; level < depth; level += 1) {
    const index = oldSize >> BigInt(level);
    const sibling = 20_000n + BigInt(level);
    siblings.push(sibling);
    await setWord(address, nodeSlot(slots.nodes, level, index - 1n), sibling);
    if (level > 0) await setWord(address, nodeSlot(slots.nodes, level, index), oldBranch);
    oldBranch = level === 0 ? sibling : hashLineageNodes(sibling, oldBranch);
  }
  await setWord(address, nodeSlot(slots.nodes, depth, 0), oldBranch);
  await setWord(address, slots.size, oldSize);
  await setWord(address, slots.depth, BigInt(depth));
  await setWord(address, slots.root, oldBranch);
  expect(await lineageIndex.size(TRUSTED_TREE)).to.equal(oldSize);
  expect(await lineageIndex.depth(TRUSTED_TREE)).to.equal(BigInt(depth));
  expect(await lineageIndex.root(TRUSTED_TREE)).to.equal(oldBranch);
  return {
    oldSize,
    siblings,
    identityCommitment: await lineageIndex.identityCommitmentOf(personHash),
  };
}

describe("DeepFamily lineage gas benchmark", function () {
  this.timeout(180_000);

  it("records whole-transaction gas across real tree growth and rewrite paths", async () => {
    const { deepFamily, lineageIndex, token, manager, personHash } =
      await hre.networkHelpers.loadFixture(setupSinglePerson);
    const measurements = [];

    for (let size = 2; size <= 33; size += 1) {
      const account = syntheticAccount(size);
      const result = await measure(
        deepFamily.connect(manager).addTrustedEndorser,
        [personHash, 1, account],
        `add trusted #${size}`,
        TRUSTED_TREE,
        lineageIndex,
      );
      expect(await lineageIndex.size(TRUSTED_TREE)).to.equal(BigInt(size));
      expect(await lineageIndex.depth(TRUSTED_TREE)).to.equal(BigInt(Math.ceil(Math.log2(size))));
      if (REAL_SIZES_TO_REPORT.has(size)) measurements.push(result);
    }

    measurements.push(
      await measure(
        deepFamily.connect(manager).removeTrustedEndorser,
        [personHash, 1, manager.address],
        "remove trusted leaf 0",
        TRUSTED_TREE,
        lineageIndex,
      ),
    );
    measurements.push(
      await measure(
        deepFamily.connect(manager).addTrustedEndorser,
        [personHash, 1, manager.address],
        "rewrite trusted leaf 0",
        TRUSTED_TREE,
        lineageIndex,
      ),
    );
    const [reused, reusedIndex] = await lineageIndex.trustedLeafIndex(
      personHash,
      1,
      manager.address,
    );
    expect(reused).to.equal(true);
    expect(reusedIndex).to.equal(0n);

    const { measurement, personHash: childHash } = await submitChildVersion({
      deepFamily,
      manager,
      lineageIndex,
    });
    measurements.push(measurement);
    await (
      await token.connect(manager).approve(await deepFamily.getAddress(), hre.ethers.MaxUint256)
    ).wait();
    measurements.push(
      await measure(
        deepFamily.connect(manager).endorseVersion,
        [childHash, 1],
        "endorse version",
        ENDORSEMENT_TREE,
        lineageIndex,
      ),
    );
    measurements.push(
      await measure(
        deepFamily.connect(manager).cancelEndorsement,
        [childHash],
        "cancel endorsement",
        ENDORSEMENT_TREE,
        lineageIndex,
      ),
    );
    measurements.push(
      await measure(
        deepFamily.connect(manager).endorseVersion,
        [childHash, 1],
        "re-endorse same slot",
        ENDORSEMENT_TREE,
        lineageIndex,
      ),
    );
    expect(await lineageIndex.size(ENDORSEMENT_TREE)).to.equal(1n);
    reportGas(measurements);
  });

  it("measures synthetic full-sibling paths through depth 64", async () => {
    const measurements = [];
    for (const depth of [16, 24, 32, 48, 64]) {
      const context = await hre.networkHelpers.loadFixture(setupSinglePerson);
      const { deepFamily, lineageIndex, manager, personHash } = context;
      const { root, deletedRoot } = await seedSyntheticPath(context, depth);
      const remove = await measure(
        deepFamily.connect(manager).removeTrustedEndorser,
        [personHash, 1, manager.address],
        `synthetic depth ${depth}: remove`,
        TRUSTED_TREE,
        lineageIndex,
      );
      expect(await lineageIndex.root(TRUSTED_TREE)).to.equal(deletedRoot);
      const rewrite = await measure(
        deepFamily.connect(manager).addTrustedEndorser,
        [personHash, 1, manager.address],
        `synthetic depth ${depth}: rewrite`,
        TRUSTED_TREE,
        lineageIndex,
      );
      expect(await lineageIndex.root(TRUSTED_TREE)).to.equal(root);
      measurements.push(remove, rewrite);
    }
    reportGas(measurements);
  });

  it("measures synthetic full-sibling appends through depth 64", async () => {
    const measurements = [];
    for (const depth of [16, 24, 32, 48, 64]) {
      const context = await hre.networkHelpers.loadFixture(setupSinglePerson);
      const { deepFamily, lineageIndex, manager, personHash } = context;
      const { oldSize, siblings, identityCommitment } = await seedSyntheticAppendPath(
        context,
        depth,
      );
      const account = syntheticAccount(100 + depth);
      const measurement = await measure(
        deepFamily.connect(manager).addTrustedEndorser,
        [personHash, 1, account],
        `synthetic depth ${depth}: full-sibling append`,
        TRUSTED_TREE,
        lineageIndex,
      );
      const [exists, leafIndex] = await lineageIndex.trustedLeafIndex(personHash, 1, account);
      expect(exists).to.equal(true);
      expect(leafIndex).to.equal(oldSize);
      expect(await lineageIndex.size(TRUSTED_TREE)).to.equal(oldSize + 1n);
      expect(await lineageIndex.depth(TRUSTED_TREE)).to.equal(BigInt(depth));
      const leaf = computeLineageTrustedLeaf({
        rootIdentityCommitment: identityCommitment,
        rootVersionIndex: 1,
        account,
      });
      expect(await lineageIndex.root(TRUSTED_TREE)).to.equal(
        siblings.reduce((node, sibling) => hashLineageNodes(sibling, node), leaf),
      );
      if (depth === 64) {
        const proof = await lineageIndex.getMerkleProof(TRUSTED_TREE, leafIndex);
        expect(proof.proofDepth).to.equal(64n);
        expect(proof.proofIndex).to.equal((1n << 64n) - 1n);
        expect(proof.siblings).to.deep.equal(siblings);
        const circuitProof = buildLineageMerkleProofFromPath({
          root: proof.proofRoot,
          leaf: proof.leaf,
          index: proof.proofIndex,
          siblings: proof.siblings,
        });
        expect(circuitProof.root).to.equal(await lineageIndex.root(TRUSTED_TREE));
        expect(circuitProof.depth).to.equal(64);
        expect(circuitProof.index).to.equal((1n << 64n) - 1n);
      }
      measurements.push(measurement);
    }
    reportGas(measurements);
  });

  it("accepts an append beyond 2^32 leaves and returns its compact proof", async () => {
    const context = await hre.networkHelpers.loadFixture(setupSinglePerson);
    const { deepFamily, lineageIndex, manager, personHash } = context;
    const { root: oldRoot } = await seedSyntheticPath(context, 32);
    const account = syntheticAccount(99);
    await (await deepFamily.connect(manager).addTrustedEndorser(personHash, 1, account)).wait();
    expect(await lineageIndex.size(TRUSTED_TREE)).to.equal((1n << 32n) + 1n);
    expect(await lineageIndex.depth(TRUSTED_TREE)).to.equal(33n);
    const [exists, leafIndex] = await lineageIndex.trustedLeafIndex(personHash, 1, account);
    expect(exists).to.equal(true);
    expect(leafIndex).to.equal(1n << 32n);
    const proof = await lineageIndex.getMerkleProof(TRUSTED_TREE, leafIndex);
    expect(proof.proofDepth).to.equal(1n);
    expect(proof.siblings).to.deep.equal([oldRoot]);
    expect(proof.proofIndex).to.equal(1n);
    expect(proof.proofRoot).to.equal(await lineageIndex.root(TRUSTED_TREE));
  });

  it("rejects an append beyond the depth-64 limit", async () => {
    const context = await hre.networkHelpers.loadFixture(setupSinglePerson);
    const { deepFamily, lineageIndex, manager, personHash } = context;
    const { root } = await seedSyntheticPath(context, 64);
    const proof = await lineageIndex.getMerkleProof(TRUSTED_TREE, 0);
    expect(proof.proofDepth).to.equal(64n);
    expect(proof.siblings).to.have.length(64);
    expect(proof.proofIndex).to.equal(0n);
    expect(proof.proofRoot).to.equal(root);
    expect(
      proof.siblings.reduce((node, sibling) => hashLineageNodes(node, sibling), proof.leaf),
    ).to.equal(root);
    const overflowAccount = syntheticAccount(199);
    await expect(
      deepFamily.connect(manager).addTrustedEndorser(personHash, 1, overflowAccount),
    ).to.be.revertedWithCustomError(lineageIndex, "TreeCapacityExceeded");
    expect(await lineageIndex.size(TRUSTED_TREE)).to.equal(1n << 64n);
    expect(await lineageIndex.depth(TRUSTED_TREE)).to.equal(64n);
    expect(await lineageIndex.root(TRUSTED_TREE)).to.equal(root);
    expect(await deepFamily.trustedEndorserOf(personHash, 1, overflowAccount)).to.equal(false);
  });

  it("keeps one inheritance create, deposit and proven claim bounded as IDs grow", async () => {
    const {
      deepFamily,
      familyInheritance,
      lineageIndex,
      token,
      manager,
      person: root,
      personHash: rootHash,
    } = await hre.networkHelpers.loadFixture(setupSinglePerson);
    const [, depositor, earlyRecipient, lateRecipient] = await hre.ethers.getSigners();
    // One complete-parent version funds the depositor, as in the inheritance contract tests.
    const heir = makeTestPerson("Inheritance gas child", { derivedSecretField: 78635n });
    const spouse = makeTestPerson("Inheritance gas spouse", {
      derivedSecretField: 78636n,
      gender: 2,
    });
    const heirHash = await addPerson(hre.ethers, deepFamily, manager, undefined, {
      person: heir,
      fatherPerson: root,
      motherPerson: spouse,
      tag: "inheritance-gas-funding",
    });
    await (
      await token.connect(manager).approve(await deepFamily.getAddress(), hre.ethers.MaxUint256)
    ).wait();
    const endorsement = await (
      await deepFamily.connect(manager).endorseVersion(heirHash, 1)
    ).wait();
    const writtenAt = BigInt((await endorsement.getBlock()).timestamp);
    await (await token.connect(manager).transfer(depositor.address, 200n * DEEP)).wait();
    await (
      await token
        .connect(depositor)
        .approve(await familyInheritance.getAddress(), hre.ethers.MaxUint256)
    ).wait();
    const rootIdentity = computeIdentityFromDerivedSecret({
      identity: root,
      identitySuiteId: 1,
      derivedSecretField: root.derivedSecretField,
    });
    const credential = computeInheritanceCredential({
      rootIdentityCommitment: rootIdentity.identityCommitment,
      rootVersionIndex: 1,
      rootDerivedSecretField: root.derivedSecretField,
    });

    const create = familyInheritance.connect(depositor).createInheritance;
    const createArgs = [credential, DEEP, 2n * DEEP];
    const measurements = [];
    const createGas = new Map();
    for (let id = 1; id <= 65; id += 1) {
      if (id === 2 || id === 65) {
        const measured = await measureInheritance(create, createArgs, "create inheritance", id);
        measurements.push(measured.display);
        createGas.set(id, measured.gasUsed);
      } else {
        await (await create(...createArgs)).wait();
      }
    }
    expect(await familyInheritance.inheritanceCount()).to.equal(65n);

    const deposit = familyInheritance.connect(depositor).deposit;
    const depositGas = new Map();
    for (const id of [2, 65]) {
      const measured = await measureInheritance(deposit, [id, DEEP], "deposit", id);
      measurements.push(measured.display);
      depositGas.set(id, measured.gasUsed);
      expect((await familyInheritance.inheritanceOf(id)).balance).to.equal(3n * DEEP);
    }
    // A 30k allowance covers ordinary storage/account warmness differences while catching
    // a material scan through the 63 additional inheritances in either transaction path.
    expect(createGas.get(65)).to.be.at.most(createGas.get(2) + 30_000n);
    expect(depositGas.get(65)).to.be.at.most(depositGas.get(2) + 30_000n);

    // Each inheritance has a different startTime, so its proof binds a different eligibility grid.
    const proofContext = {
      familyInheritance,
      lineageIndex,
      root,
      rootHash,
      heir,
      heirHash,
      spouse,
      rootIdentity,
      manager,
      writtenAt,
    };
    const earlyProof = await inheritanceClaimProof(proofContext, 2n, earlyRecipient.address);
    const lateProof = await inheritanceClaimProof(proofContext, 65n, lateRecipient.address);
    const readyAt =
      earlyProof.signals.eligibleFrom > lateProof.signals.eligibleFrom
        ? earlyProof.signals.eligibleFrom
        : lateProof.signals.eligibleFrom;
    await hre.networkHelpers.time.increaseTo(readyAt);
    const claim = familyInheritance.claim;
    const earlyClaim = await measureInheritance(
      claim,
      [2n, earlyProof.signals, earlyProof.proofData],
      "claim with real Groth16 proof",
      2,
    );
    const lateClaim = await measureInheritance(
      claim,
      [65n, lateProof.signals, lateProof.proofData],
      "claim with real Groth16 proof",
      65,
    );
    measurements.push(earlyClaim.display, lateClaim.display);
    expect(await token.balanceOf(earlyRecipient.address)).to.equal(DEEP);
    expect(await token.balanceOf(lateRecipient.address)).to.equal(DEEP);
    expect((await familyInheritance.inheritanceOf(2)).balance).to.equal(2n * DEEP);
    expect((await familyInheritance.inheritanceOf(65)).balance).to.equal(2n * DEEP);
    // Both recipients start with zero DEEP; allow precompile and storage cost variation.
    expect(lateClaim.gasUsed).to.be.at.most(earlyClaim.gasUsed + 50_000n);
    reportGas(measurements);
  });
});
