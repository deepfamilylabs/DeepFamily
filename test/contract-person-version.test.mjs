import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import {
  setupStubVerifiers,
  addPerson,
  computePersonHash,
  computeProfileIdentityCommitment,
  makeStubProof,
  makeAddPersonPublicSignals,
  makeMetadataEnvelope,
  makeTestPerson,
} from "./helpers/testHelper.mjs";

const ZERO_HASH = hre.ethers.ZeroHash;
const commitmentOf = (person) => computeProfileIdentityCommitment(hre.ethers, person);

describe("Person Version (add-person) Tests", function () {
  this.timeout(120_000);

  async function baseSetup() {
    const { deepFamily, deepFamilyReader, token } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [signer] = await hre.ethers.getSigners();
    await setupStubVerifiers(hre.ethers, deepFamily);
    return { deepFamily, reader: deepFamilyReader, token, signer };
  }

  it("rejects direct native-currency transfers and unknown calldata", async () => {
    const { deepFamily, signer } = await baseSetup();
    const target = await deepFamily.getAddress();

    await expect(signer.sendTransaction({ to: target, value: 1n })).to.be.revertedWithCustomError(
      deepFamily,
      "DirectNativeCurrencyNotAccepted",
    );
    await expect(
      signer.sendTransaction({ to: target, data: "0x12345678" }),
    ).to.be.revertedWithCustomError(deepFamily, "DirectNativeCurrencyNotAccepted");
  });

  it("adds a basic person and emits event", async () => {
    const { deepFamily, reader, signer } = await baseSetup();
    const person = makeTestPerson("Basic Person");
    const personHash = await addPerson(hre.ethers, deepFamily, signer, null, { person });
    const [, totalVersions] = await reader.listPersonVersions(personHash, 0, 0);
    expect(totalVersions).to.equal(1n);
  });

  it("prevents duplicate version (same inputs)", async () => {
    const { deepFamily, reader, signer } = await baseSetup();
    const person = makeTestPerson("Duplicate Subject");
    await addPerson(hre.ethers, deepFamily, signer, null, { person, tag: "v1" });
    await expect(
      addPerson(hre.ethers, deepFamily, signer, null, { person, tag: "v1" }),
    ).to.be.revertedWithCustomError(deepFamily, "DuplicateVersionCommitment");
  });

  it("allows only one of two pending submissions for the same version commitment", async () => {
    const { deepFamily, reader, signer } = await baseSetup();
    const person = makeTestPerson("Concurrent Duplicate Subject");
    const identityCommitment = commitmentOf(person);
    const signerAddress = await signer.getAddress();
    const publicSignals = makeAddPersonPublicSignals(identityCommitment, signerAddress, {
      tag: "same-canonical-plaintext",
    });
    const personHash = computePersonHash(hre.ethers, identityCommitment);
    const provider = hre.ethers.provider;
    const pendingTransactions = [];
    let minedPendingBlock = false;
    let firstTransaction;
    let secondTransaction;

    await provider.send("evm_setAutomine", [false]);
    try {
      const firstNonce = await signer.getNonce("pending");
      firstTransaction = await deepFamily
        .connect(signer)
        .addPersonVersion(
          makeStubProof(),
          publicSignals,
          0,
          0,
          makeMetadataEnvelope(hre.ethers, 1, { tag: "randomized-envelope-a" }),
          { nonce: firstNonce, gasLimit: 12_000_000 },
        );
      pendingTransactions.push(firstTransaction);
      secondTransaction = await deepFamily
        .connect(signer)
        .addPersonVersion(
          makeStubProof(),
          publicSignals,
          0,
          0,
          makeMetadataEnvelope(hre.ethers, 1, { tag: "randomized-envelope-b" }),
          { nonce: firstNonce + 1, gasLimit: 12_000_000 },
        );
      pendingTransactions.push(secondTransaction);

      expect(await provider.getTransactionReceipt(firstTransaction.hash)).to.equal(null);
      expect(await provider.getTransactionReceipt(secondTransaction.hash)).to.equal(null);
      await provider.send("evm_mine", []);
      minedPendingBlock = true;
    } finally {
      try {
        if (!minedPendingBlock) {
          for (const transaction of pendingTransactions.reverse()) {
            if ((await provider.getTransactionReceipt(transaction.hash)) === null) {
              await hre.networkHelpers.dropTransaction(transaction.hash);
            }
          }
        }
      } finally {
        await provider.send("evm_setAutomine", [true]);
      }
    }
    expect(await provider.send("hardhat_getAutomine", [])).to.equal(true);

    const firstReceipt = await firstTransaction.wait();
    expect(firstReceipt.status).to.equal(1);

    let revertedReceipt;
    try {
      await secondTransaction.wait();
    } catch (error) {
      revertedReceipt = error?.receipt;
    }
    expect(revertedReceipt?.status).to.equal(0);

    const [, totalVersions] = await reader.listPersonVersions(personHash, 0, 0);
    expect(totalVersions).to.equal(1n);
  });

  it("adds person without parents (zero hash preserved)", async () => {
    const { deepFamily, reader, signer } = await baseSetup();
    const person = makeTestPerson("No Parent Subject");
    const personHash = await addPerson(hre.ethers, deepFamily, signer, null, { person });

    const [versions, totalVersions] = await reader.listPersonVersions(personHash, 0, 100);
    expect(totalVersions).to.equal(1n);
    expect(versions[0].fatherHash).to.equal(ZERO_HASH);
    expect(versions[0].motherHash).to.equal(ZERO_HASH);
  });

  it("adds person with complete parent information", async () => {
    const { deepFamily, reader, signer } = await baseSetup();
    const fatherPerson = makeTestPerson("Father Version Person", { birthYear: 1970 });
    const motherPerson = makeTestPerson("Mother Version Person", { birthYear: 1972, gender: 2 });
    const childPerson = makeTestPerson("Child Version Person", { birthYear: 2001 });
    const fatherCommitment = commitmentOf(fatherPerson);
    const motherCommitment = commitmentOf(motherPerson);

    await addPerson(hre.ethers, deepFamily, signer, fatherCommitment, {
      person: fatherPerson,
      tag: "father",
    });
    await addPerson(hre.ethers, deepFamily, signer, motherCommitment, {
      person: motherPerson,
      tag: "mother",
    });

    const fatherHash = computePersonHash(hre.ethers, fatherCommitment);
    const motherHash = computePersonHash(hre.ethers, motherCommitment);

    const childHash = await addPerson(hre.ethers, deepFamily, signer, null, {
      person: childPerson,
      fatherPerson,
      motherPerson,
      fatherIdentityCommitment: fatherCommitment,
      motherIdentityCommitment: motherCommitment,
      fatherVersionIndex: 0,
      motherVersionIndex: 0,
      tag: "child",
    });

    const [versions, totalVersions] = await reader.listPersonVersions(childHash, 0, 100);
    expect(totalVersions).to.equal(1n);
    expect(versions[0].fatherHash).to.equal(fatherHash);
    expect(versions[0].motherHash).to.equal(motherHash);
  });

  it("adds multiple versions for same person", async () => {
    const { deepFamily, reader, signer } = await baseSetup();
    const person = makeTestPerson("Multi Version Subject");
    const commitment = commitmentOf(person);

    await addPerson(hre.ethers, deepFamily, signer, commitment, { person, tag: "first" });
    await addPerson(hre.ethers, deepFamily, signer, commitment, { person, tag: "second" });

    const personHash = computePersonHash(hre.ethers, commitment);
    const [versions, totalVersions] = await reader.listPersonVersions(personHash, 0, 100);
    expect(totalVersions).to.equal(2n);
    expect(versions[0].versionCommitment).to.not.equal(versions[1].versionCommitment);
  });

  it("rewards only the first eligible version and rejects a replayed version commitment", async () => {
    const { deepFamily, reader, token, signer } = await baseSetup();
    const fatherPerson = makeTestPerson("Reward Father", { birthYear: 1970 });
    const motherPerson = makeTestPerson("Reward Mother", { birthYear: 1972, gender: 2 });
    const childPerson = makeTestPerson("Reward Child", { birthYear: 2001 });
    const fatherCommitment = commitmentOf(fatherPerson);
    const motherCommitment = commitmentOf(motherPerson);
    const childCommitment = commitmentOf(childPerson);
    const signerAddress = await signer.getAddress();

    await addPerson(hre.ethers, deepFamily, signer, fatherCommitment, {
      person: fatherPerson,
      tag: "father",
    });
    await addPerson(hre.ethers, deepFamily, signer, motherCommitment, {
      person: motherPerson,
      tag: "mother",
    });

    const balanceBefore = await token.balanceOf(signerAddress);
    const firstReward = await token.getReward(1);
    const firstSignals = makeAddPersonPublicSignals(childCommitment, signerAddress, {
      fatherIdentityCommitment: fatherCommitment,
      motherIdentityCommitment: motherCommitment,
      tag: "child-v1",
    });
    await deepFamily
      .connect(signer)
      .addPersonVersion(
        makeStubProof(),
        firstSignals,
        1,
        1,
        makeMetadataEnvelope(hre.ethers, 1, { tag: "child-v1" }),
      );

    expect(await token.totalAdditions()).to.equal(1n);
    expect(await token.balanceOf(signerAddress)).to.equal(balanceBefore + firstReward);
    expect(
      await deepFamily.rewardClaimedByPerson(computePersonHash(hre.ethers, childCommitment)),
    ).to.equal(true);

    // Randomized envelope bytes cannot bypass the context-scoped commitment key.
    await expect(
      deepFamily
        .connect(signer)
        .addPersonVersion(
          makeStubProof(),
          firstSignals,
          1,
          1,
          makeMetadataEnvelope(hre.ethers, 1, { tag: "different-ciphertext" }),
        ),
    ).to.be.revertedWithCustomError(deepFamily, "DuplicateVersionCommitment");

    await addPerson(hre.ethers, deepFamily, signer, childCommitment, {
      person: childPerson,
      fatherPerson,
      motherPerson,
      fatherIdentityCommitment: fatherCommitment,
      motherIdentityCommitment: motherCommitment,
      fatherVersionIndex: 1,
      motherVersionIndex: 1,
      tag: "child-v2",
    });

    const childHash = computePersonHash(hre.ethers, childCommitment);
    const [, totalVersions] = await reader.listPersonVersions(childHash, 0, 0);
    expect(totalVersions).to.equal(2n);
    expect(await token.totalAdditions()).to.equal(1n);
    expect(await token.balanceOf(signerAddress)).to.equal(balanceBefore + firstReward);
  });

  it("rewards once when an existing person first gains non-zero parent commitments", async () => {
    const { deepFamily, reader, token, signer } = await baseSetup();
    const fatherPerson = makeTestPerson("Backfill Reward Father", { birthYear: 1970 });
    const motherPerson = makeTestPerson("Backfill Reward Mother", { birthYear: 1972, gender: 2 });
    const childPerson = makeTestPerson("Backfill Reward Child", { birthYear: 2001 });
    const fatherCommitment = commitmentOf(fatherPerson);
    const motherCommitment = commitmentOf(motherPerson);
    const childCommitment = commitmentOf(childPerson);
    const signerAddress = await signer.getAddress();

    const childHash = await addPerson(hre.ethers, deepFamily, signer, childCommitment, {
      person: childPerson,
      tag: "child-without-parents",
    });
    const fatherHash = computePersonHash(hre.ethers, fatherCommitment);
    const motherHash = computePersonHash(hre.ethers, motherCommitment);
    expect(await deepFamily.personVersionsCount(fatherHash)).to.equal(0n);
    expect(await deepFamily.personVersionsCount(motherHash)).to.equal(0n);
    expect(await deepFamily.rewardClaimedByPerson(childHash)).to.equal(false);

    const balanceBefore = await token.balanceOf(signerAddress);
    const firstReward = await token.getReward(1);
    await addPerson(hre.ethers, deepFamily, signer, childCommitment, {
      person: childPerson,
      fatherPerson,
      motherPerson,
      fatherIdentityCommitment: fatherCommitment,
      motherIdentityCommitment: motherCommitment,
      tag: "child-backfilled-v1",
    });

    expect(await token.totalAdditions()).to.equal(1n);
    expect(await token.balanceOf(signerAddress)).to.equal(balanceBefore + firstReward);
    expect(await deepFamily.rewardClaimedByPerson(childHash)).to.equal(true);

    await addPerson(hre.ethers, deepFamily, signer, childCommitment, {
      person: childPerson,
      fatherPerson,
      motherPerson,
      fatherIdentityCommitment: fatherCommitment,
      motherIdentityCommitment: motherCommitment,
      tag: "child-backfilled-v2",
    });

    const [, totalVersions] = await reader.listPersonVersions(childHash, 0, 0);
    expect(totalVersions).to.equal(3n);
    expect(await token.totalAdditions()).to.equal(1n);
    expect(await token.balanceOf(signerAddress)).to.equal(balanceBefore + firstReward);
  });

  it("allows providing parent hash with unknown (0) version index when parent exists", async () => {
    const { deepFamily, reader, signer } = await baseSetup();
    const fatherPerson = makeTestPerson("Father Zero Index", { birthYear: 1970 });
    const childPerson = makeTestPerson("Child Zero Index", { birthYear: 2004 });
    const fatherCommitment = commitmentOf(fatherPerson);

    await addPerson(hre.ethers, deepFamily, signer, fatherCommitment, {
      person: fatherPerson,
      tag: "father",
    });
    const fatherHash = computePersonHash(hre.ethers, fatherCommitment);

    const childHash = await addPerson(hre.ethers, deepFamily, signer, null, {
      person: childPerson,
      fatherPerson,
      fatherIdentityCommitment: fatherCommitment,
      fatherVersionIndex: 0,
      tag: "child",
    });

    const [childVersions] = await reader.listPersonVersions(childHash, 0, 10);
    expect(childVersions[0].fatherHash).to.equal(fatherHash);
    expect(childVersions[0].fatherVersionIndex).to.equal(0n);
    expect(childVersions[0].motherHash).to.equal(ZERO_HASH);

    const [zeroIdxChildren] = await reader.listChildren(fatherHash, 0, 0, 10);
    expect(zeroIdxChildren).to.include(childHash);
  });

  it("allows re-submitting a version to backfill parents and link trees", async () => {
    const { deepFamily, reader, signer } = await baseSetup();
    const fatherPerson = makeTestPerson("Father Linked", { birthYear: 1971 });
    const motherPerson = makeTestPerson("Mother Linked", { birthYear: 1973, gender: 2 });
    const childPerson = makeTestPerson("Child Linked", { birthYear: 2002 });
    const fatherCommitment = commitmentOf(fatherPerson);
    const motherCommitment = commitmentOf(motherPerson);
    const childCommitment = commitmentOf(childPerson);

    await addPerson(hre.ethers, deepFamily, signer, fatherCommitment, {
      person: fatherPerson,
      tag: "father",
    });
    await addPerson(hre.ethers, deepFamily, signer, motherCommitment, {
      person: motherPerson,
      tag: "mother",
    });
    await addPerson(hre.ethers, deepFamily, signer, childCommitment, {
      person: childPerson,
      tag: "orphan",
    });

    const fatherHash = computePersonHash(hre.ethers, fatherCommitment);
    const motherHash = computePersonHash(hre.ethers, motherCommitment);

    await addPerson(hre.ethers, deepFamily, signer, childCommitment, {
      person: childPerson,
      fatherPerson,
      motherPerson,
      fatherIdentityCommitment: fatherCommitment,
      motherIdentityCommitment: motherCommitment,
      fatherVersionIndex: 1,
      motherVersionIndex: 1,
      tag: "linked",
    });

    const childHash = computePersonHash(hre.ethers, childCommitment);
    const [versions, totalVersions] = await reader.listPersonVersions(childHash, 0, 10);
    expect(totalVersions).to.equal(2n);
    expect(versions[0].fatherHash).to.equal(ZERO_HASH);
    expect(versions[0].motherHash).to.equal(ZERO_HASH);
    expect(versions[1].fatherVersionIndex).to.equal(1n);
    expect(versions[1].motherVersionIndex).to.equal(1n);
    expect(versions[1].fatherHash).to.equal(fatherHash);
    expect(versions[1].motherHash).to.equal(motherHash);

    const [fatherChildren] = await reader.listChildren(fatherHash, 1, 0, 10);
    expect(fatherChildren).to.include(childHash);
    const [motherChildren] = await reader.listChildren(motherHash, 1, 0, 10);
    expect(motherChildren).to.include(childHash);
  });

  it("reverts when proof submitter does not match caller", async () => {
    const { deepFamily, reader, signer } = await baseSetup();
    const [, mismatchedCaller] = await hre.ethers.getSigners();
    const commitment = 123456789n;
    const signerAddr = await signer.getAddress();

    const proof = makeStubProof();
    const publicSignals = makeAddPersonPublicSignals(commitment, signerAddr);
    await expect(
      deepFamily
        .connect(mismatchedCaller)
        .addPersonVersion(
          proof,
          publicSignals,
          0,
          0,
          makeMetadataEnvelope(hre.ethers, 1, { tag: "v1" }),
        ),
    ).to.be.revertedWithCustomError(deepFamily, "CallerOrIdentitySuiteMismatch");
  });

  it("addPersonVersion allows zero parents when parent commitments are zero", async () => {
    const { deepFamily, reader, signer } = await baseSetup();
    const person = makeTestPerson("Zero Parent Subject");
    const commitment = commitmentOf(person);

    await addPerson(hre.ethers, deepFamily, signer, commitment, { person });
    const personHash = computePersonHash(hre.ethers, commitment);
    const [, total] = await reader.listPersonVersions(personHash, 0, 0);
    expect(total).to.equal(1n);
  });

  it("addPersonVersion rejects non-zero parent ref when corresponding commitment is zero", async () => {
    const { deepFamily, reader, signer } = await baseSetup();
    const commitment = 123456790n;
    const signerAddr = await signer.getAddress();

    const proof = makeStubProof();
    const publicSignals = makeAddPersonPublicSignals(commitment, signerAddr);
    await expect(
      deepFamily
        .connect(signer)
        .addPersonVersion(
          proof,
          publicSignals,
          1,
          0,
          makeMetadataEnvelope(hre.ethers, 1, { tag: "invalid-parent" }),
        ),
    ).to.be.revertedWithCustomError(deepFamily, "InvalidParentHash");
  });

  it("rejects father and mother version indices beyond their corresponding histories", async () => {
    const { deepFamily, signer } = await baseSetup();
    const signerAddress = await signer.getAddress();

    const fatherSignals = makeAddPersonPublicSignals(501n, signerAddress, {
      fatherIdentityCommitment: 601n,
      versionCommitment: 701n,
    });
    await expect(
      deepFamily
        .connect(signer)
        .addPersonVersion(
          makeStubProof(),
          fatherSignals,
          1,
          0,
          makeMetadataEnvelope(hre.ethers, 1, { tag: "father-index-out-of-range" }),
        ),
    ).to.be.revertedWithCustomError(deepFamily, "InvalidFatherVersionIndex");

    const motherSignals = makeAddPersonPublicSignals(502n, signerAddress, {
      motherIdentityCommitment: 602n,
      versionCommitment: 702n,
    });
    await expect(
      deepFamily
        .connect(signer)
        .addPersonVersion(
          makeStubProof(),
          motherSignals,
          0,
          1,
          makeMetadataEnvelope(hre.ethers, 1, { tag: "mother-index-out-of-range" }),
        ),
    ).to.be.revertedWithCustomError(deepFamily, "InvalidMotherVersionIndex");
  });

  it("accepts a nonzero atomic identity suite id", async () => {
    const { deepFamily, reader, signer } = await baseSetup();
    const person = makeTestPerson("Alternate Suite Subject", { identitySuiteId: 999 });
    const personHash = await addPerson(hre.ethers, deepFamily, signer, null, {
      person,
      selfSuiteId: 999,
      tag: "suite-999",
    });
    const [, totalVersions] = await reader.listPersonVersions(personHash, 0, 0);
    expect(totalVersions).to.equal(1n);
  });

  it("supports a non-default identitySuiteId in the packed public signal", async () => {
    const { deepFamily, reader, signer } = await baseSetup();
    const person = makeTestPerson("Versioned Subject", {
      identitySuiteId: 2,
    });
    const personHash = await addPerson(hre.ethers, deepFamily, signer, null, {
      person,
      selfSuiteId: 2,
      tag: "v2",
    });
    const [, totalVersions] = await reader.listPersonVersions(personHash, 0, 0);
    expect(totalVersions).to.equal(1n);
  });
});
