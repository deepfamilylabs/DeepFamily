import "../hardhat-test-setup.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "chai";
import hre from "hardhat";
import * as snarkjs from "snarkjs";
import {
  INHERITANCE_PERIOD_SECONDS,
  buildInheritanceClaimWitness,
  computeIdentityFromDerivedSecret,
  computeInheritanceCredential,
  computeInheritanceEligibleFrom,
  replayLineageTree,
} from "@deepfamily/protocol-core";
import { encodeGroth16AbcProofData, normalizeGroth16Proof } from "@deepfamily/proof-core";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import { addPerson, makeTestPerson, setupStubVerifiers } from "./helpers/testHelper.mjs";

const ZK_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../frontend/public/zk",
);
const WASM = path.join(ZK_DIRECTORY, "family_inheritance_claim.wasm");
const ZKEY = path.join(ZK_DIRECTORY, "family_inheritance_claim_final.zkey");
const ENDORSEMENT_TREE = 0;
const TRUSTED_TREE = 1;
const PERIOD = INHERITANCE_PERIOD_SECONDS;
const DEEP = 10n ** 18n;

const identityOf = (person) =>
  computeIdentityFromDerivedSecret({
    identity: person,
    identitySuiteId: 1,
    derivedSecretField: person.derivedSecretField,
  });

async function replayedTree(lineageIndex, treeId) {
  const events = await lineageIndex.queryFilter(lineageIndex.filters.LeafWritten(treeId));
  events.sort((left, right) => left.blockNumber - right.blockNumber || left.index - right.index);
  return replayLineageTree(
    events.map(({ args }) => ({ leafIndex: args.leafIndex, leaf: args.leaf })),
  );
}

describe("FamilyInheritance", function () {
  this.timeout(300_000);

  async function setup() {
    const deployed = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const { deepFamily, token, familyInheritance } = deployed;
    await setupStubVerifiers(hre.ethers, deepFamily);
    const [manager, depositor, outsider, recipient, other] = await hre.ethers.getSigners();

    const root = makeTestPerson("Inheritance Root", { derivedSecretField: 5001n, birthYear: 1930 });
    const spouse = makeTestPerson("Inheritance Spouse", {
      derivedSecretField: 5002n,
      birthYear: 1932,
      gender: 2,
    });
    const heir = makeTestPerson("Inheritance Heir", { derivedSecretField: 5003n, birthYear: 1960 });
    const rootHash = await addPerson(hre.ethers, deepFamily, manager, undefined, {
      person: root,
      tag: "root",
    });
    const heirHash = await addPerson(hre.ethers, deepFamily, manager, undefined, {
      person: heir,
      fatherPerson: root,
      motherPerson: spouse,
      tag: "heir",
    });

    // The manager created the root version, so it is a trusted endorser of that version.
    await token.connect(manager).approve(await deepFamily.getAddress(), hre.ethers.MaxUint256);
    const endorsement = await (
      await deepFamily.connect(manager).endorseVersion(heirHash, 1)
    ).wait();
    const writtenAt = BigInt((await endorsement.getBlock()).timestamp);

    await token.connect(manager).transfer(depositor.address, 10_000n * DEEP);
    await token
      .connect(depositor)
      .approve(await familyInheritance.getAddress(), hre.ethers.MaxUint256);
    const rootIdentity = identityOf(root);
    const credential = computeInheritanceCredential({
      rootIdentityCommitment: rootIdentity.identityCommitment,
      rootVersionIndex: 1,
      rootDerivedSecretField: root.derivedSecretField,
    });
    const created = await (
      await familyInheritance
        .connect(depositor)
        .createInheritance(credential, 1_000n * DEEP, 3_500n * DEEP)
    ).wait();
    const startTime = BigInt((await created.getBlock()).timestamp);

    return {
      ...deployed,
      manager,
      depositor,
      outsider,
      recipient,
      other,
      root,
      spouse,
      heir,
      rootHash,
      heirHash,
      rootIdentity,
      credential,
      writtenAt,
      startTime,
      id: 1n,
    };
  }

  async function prove(context, overrides = {}) {
    const { lineageIndex, manager, heir, heirHash, rootHash, rootIdentity, root, spouse } = context;
    const endorser = overrides.endorser ?? manager.address;
    const [, endorsementLeafIndex] = await lineageIndex.endorsementLeafIndex(heirHash, endorser);
    const [, trustedLeafIndex] = await lineageIndex.trustedLeafIndex(rootHash, 1, endorser);
    const eligibleFrom =
      overrides.eligibleFrom ??
      computeInheritanceEligibleFrom({
        startTime: context.startTime,
        writtenAt: context.writtenAt,
      });
    const { witness, publicSignals } = buildInheritanceClaimWitness({
      heir: { identity: heir, identitySuiteId: 1, derivedSecretField: heir.derivedSecretField },
      versionIndex: 1,
      fatherIdentityCommitment: rootIdentity.identityCommitment,
      motherIdentityCommitment: identityOf(spouse).identityCommitment,
      rootIsMother: false,
      endorser,
      writtenAt: overrides.writtenAt ?? context.writtenAt,
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
      recipient: overrides.recipient ?? context.recipient.address,
    });
    const { proof } = await snarkjs.groth16.fullProve(witness, WASM, ZKEY, undefined, undefined, {
      singleThread: true,
    });
    return {
      proofData: encodeGroth16AbcProofData(normalizeGroth16Proof(proof)),
      signals: {
        endorsementRoot: publicSignals.endorsementRoot,
        trustedRoot: publicSignals.trustedRoot,
        claimTag: publicSignals.claimTag,
        eligibleFrom: publicSignals.eligibleFrom,
        recipient: overrides.recipient ?? context.recipient.address,
      },
    };
  }

  it("pays a proven heir each started period, keeps arrears owed and resumes after a deposit", async () => {
    const context = await setup();
    const { familyInheritance, token, recipient, depositor, id } = context;
    const claim = await prove(context);
    await hre.networkHelpers.time.increaseTo(claim.signals.eligibleFrom);

    await expect(familyInheritance.claim(id, claim.signals, claim.proofData))
      .to.emit(familyInheritance, "InheritanceClaimed")
      .withArgs(id, claim.signals.claimTag, recipient.address, 1_000n * DEEP);
    expect(await token.balanceOf(recipient.address)).to.equal(1_000n * DEEP);
    await expect(
      familyInheritance.claim(id, claim.signals, claim.proofData),
    ).to.be.revertedWithCustomError(familyInheritance, "NothingToClaim");

    // Periods not yet claimed accumulate; the balance caps the payout and the rest stays owed.
    await hre.networkHelpers.time.increase(PERIOD * 3n);
    await familyInheritance.claim(id, claim.signals, claim.proofData);
    expect(await token.balanceOf(recipient.address)).to.equal(3_500n * DEEP);
    expect((await familyInheritance.inheritanceOf(id)).balance).to.equal(0n);
    expect(await familyInheritance.claimed(id, claim.signals.claimTag)).to.equal(3_500n * DEEP);
    await expect(
      familyInheritance.claim(id, claim.signals, claim.proofData),
    ).to.be.revertedWithCustomError(familyInheritance, "NothingToClaim");

    await expect(familyInheritance.connect(depositor).deposit(id, 2_000n * DEEP))
      .to.emit(familyInheritance, "InheritanceDeposited")
      .withArgs(id, depositor.address, 2_000n * DEEP);
    await familyInheritance.claim(id, claim.signals, claim.proofData);
    expect(await token.balanceOf(recipient.address)).to.equal(4_000n * DEEP);
    expect((await familyInheritance.inheritanceOf(id)).balance).to.equal(1_500n * DEEP);
  });

  it("binds the recipient, the claim tag and the eligibility date into the proof", async () => {
    const context = await setup();
    const { familyInheritance, other, id } = context;
    const claim = await prove(context);
    await hre.networkHelpers.time.increaseTo(claim.signals.eligibleFrom + PERIOD);

    for (const tampered of [
      { recipient: other.address },
      { claimTag: claim.signals.claimTag + 1n },
      { eligibleFrom: claim.signals.eligibleFrom + PERIOD },
    ]) {
      await expect(
        familyInheritance.claim(id, { ...claim.signals, ...tampered }, claim.proofData),
      ).to.be.revertedWithCustomError(familyInheritance, "InvalidZKProof");
    }
    await expect(
      familyInheritance.claim(id, claim.signals, `${claim.proofData}00`),
    ).to.be.revertedWithCustomError(familyInheritance, "MalformedProofData");
  });

  it("rejects off-grid, premature and future eligibility dates before verifying", async () => {
    const context = await setup();
    const { familyInheritance, id, startTime } = context;
    const claim = await prove(context);
    await hre.networkHelpers.time.increaseTo(claim.signals.eligibleFrom);
    for (const eligibleFrom of [
      claim.signals.eligibleFrom + 1n,
      startTime - PERIOD,
      claim.signals.eligibleFrom + PERIOD * 5n,
    ]) {
      await expect(
        familyInheritance.claim(id, { ...claim.signals, eligibleFrom }, claim.proofData),
      ).to.be.revertedWithCustomError(familyInheritance, "InvalidEligibility");
    }
  });

  it("refuses a proof whose lineage roots expired after an endorsement changed", async () => {
    const context = await setup();
    const { familyInheritance, deepFamily, manager, heirHash, id } = context;
    const claim = await prove(context);
    await deepFamily.connect(manager).cancelEndorsement(heirHash);
    await hre.networkHelpers.time.increaseTo(claim.signals.eligibleFrom);
    await expect(
      familyInheritance.claim(id, claim.signals, claim.proofData),
    ).to.be.revertedWithCustomError(familyInheritance, "UnknownLineageRoot");
  });

  it("cannot even build a claim for an endorsement from an untrusted account", async () => {
    const context = await setup();
    const { deepFamily, token, manager, outsider, heirHash, root, spouse } = context;
    // One more complete-parent child mints the manager enough DEEP to fund the outsider's fee.
    await addPerson(hre.ethers, deepFamily, manager, undefined, {
      person: makeTestPerson("Inheritance Sibling", { derivedSecretField: 5004n }),
      fatherPerson: root,
      motherPerson: spouse,
      tag: "sibling",
    });
    await token.connect(manager).transfer(outsider.address, await token.recentReward());
    await token.connect(outsider).approve(await deepFamily.getAddress(), hre.ethers.MaxUint256);
    await deepFamily.connect(outsider).endorseVersion(heirHash, 1);
    let error;
    try {
      await prove(context, { endorser: outsider.address });
    } catch (caught) {
      error = caught;
    }
    expect(error?.code).to.equal("LINEAGE_LEAF_MISMATCH");
  });

  it("validates creation inputs and exposes no way to take a deposit back", async () => {
    const { familyInheritance, depositor } = await setup();
    const field = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    for (const credential of [0n, field]) {
      await expect(
        familyInheritance.connect(depositor).createInheritance(credential, 1n, 1n),
      ).to.be.revertedWithCustomError(familyInheritance, "InvalidCredential");
    }
    await expect(
      familyInheritance.connect(depositor).createInheritance(1n, 0n, 1n),
    ).to.be.revertedWithCustomError(familyInheritance, "InvalidAmount");
    await expect(
      familyInheritance.connect(depositor).createInheritance(1n, 1n, 0n),
    ).to.be.revertedWithCustomError(familyInheritance, "InvalidAmount");
    await expect(
      familyInheritance.connect(depositor).deposit(99n, 1n),
    ).to.be.revertedWithCustomError(familyInheritance, "InheritanceNotFound");

    const mutating = familyInheritance.interface.fragments
      .filter((fragment) => fragment.type === "function" && !fragment.constant)
      .map((fragment) => fragment.name)
      .sort();
    expect(mutating).to.deep.equal(["claim", "createInheritance", "deposit"]);
  });
});
