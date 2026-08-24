import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { generatePersonRelationProof } from "../lib/personCommitmentProof.js";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import { makeMetadataEnvelope } from "./helpers/testHelper.mjs";

describe("Real person commitment proof", function () {
  this.timeout(120_000);

  it("accepts the maximum uint8 gender through the generated Solidity verifier", async () => {
    const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [signer] = await hre.ethers.getSigners();
    const signerAddress = await signer.getAddress();
    const person = {
      fullName: "Custom Gender 255",
      derivedSecretField: 0n,
      isBirthBC: false,
      birthYear: 1990,
      birthMonth: 5,
      birthDay: 15,
      gender: 255,
    };
    const generated = await generatePersonRelationProof(person, null, null, signerAddress, {
      contentDigest: hre.ethers.id("real-person-gender-255"),
    });

    await expect(
      deepFamily
        .connect(signer)
        .addPersonVersion(
          generated.proofEnvelope,
          generated.publicSignalsStruct,
          0,
          0,
          makeMetadataEnvelope(hre.ethers, 1, { tag: "gender-255" }),
        ),
    ).to.emit(deepFamily, "PersonHashZKVerified");
  });

  it("accepts a self=2/father=1/mother=1 proof through the generated Solidity verifier", async () => {
    const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [signer] = await hre.ethers.getSigners();
    const signerAddress = await signer.getAddress();
    const person = {
      fullName: "Mixed Suite Child",
      derivedSecretField: 101n,
      isBirthBC: false,
      birthYear: 2001,
      birthMonth: 2,
      birthDay: 3,
      gender: 2,
    };
    const father = {
      fullName: "Mixed Suite Father",
      derivedSecretField: 202n,
      isBirthBC: false,
      birthYear: 1970,
      birthMonth: 4,
      birthDay: 5,
      gender: 1,
    };
    const mother = {
      fullName: "Mixed Suite Mother",
      derivedSecretField: 303n,
      isBirthBC: false,
      birthYear: 1972,
      birthMonth: 6,
      birthDay: 7,
      gender: 2,
    };
    const generated = await generatePersonRelationProof(person, father, mother, signerAddress, {
      selfSuiteId: 2,
      fatherSuiteId: 1,
      motherSuiteId: 1,
      contentDigest: hre.ethers.id("real-person-mixed-suite"),
    });

    expect(generated.selfSuiteId).to.equal(2n);
    expect(generated.fatherSuiteId).to.equal(1n);
    expect(generated.motherSuiteId).to.equal(1n);
    expect(generated.publicSignalsStruct.fatherIdentityCommitment).not.to.equal(0n);
    expect(generated.publicSignalsStruct.motherIdentityCommitment).not.to.equal(0n);

    await expect(
      deepFamily
        .connect(signer)
        .addPersonVersion(
          generated.proofEnvelope,
          generated.publicSignalsStruct,
          0,
          0,
          makeMetadataEnvelope(hre.ethers, 2, { tag: "mixed-suite" }),
        ),
    )
      .to.emit(deepFamily, "PersonHashZKVerified")
      .withArgs(generated.person.personHash, signerAddress);

    expect(await deepFamily.personVersionsCount(generated.person.personHash)).to.equal(1n);
    const stored = await deepFamily.personVersionAt(generated.person.personHash, 0);
    expect(stored.fatherHash).to.equal(generated.father.personHash);
    expect(stored.motherHash).to.equal(generated.mother.personHash);
    expect(stored.fatherVersionIndex).to.equal(0n);
    expect(stored.motherVersionIndex).to.equal(0n);
  });
});
