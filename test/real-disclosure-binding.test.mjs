import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { generateDisclosureBindingProof } from "../lib/disclosureBindingProof.js";
import { generatePersonRelationProof } from "../lib/personCommitmentProof.js";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import { makeMetadataEnvelope } from "./helpers/testHelper.mjs";

describe("Real disclosure binding proof", function () {
  this.timeout(90_000);

  it("mints through the generated disclosure verifier with uint8 gender packing", async () => {
    const { deepFamily, groth16VerifierAdapter } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [signer] = await hre.ethers.getSigners();
    const signerAddress = await signer.getAddress();
    const person = {
      fullName: "Real Disclosure Gender 255",
      derivedSecretField: 0n,
      isBirthBC: false,
      birthYear: 1990,
      birthMonth: 5,
      birthDay: 15,
      gender: 255,
    };

    const personProof = await generatePersonRelationProof(person, null, null, signerAddress, {
      contentDigest: hre.ethers.id("real-disclosure-gender-255"),
    });
    await deepFamily
      .connect(signer)
      .addPersonVersion(
        personProof.proofEnvelope,
        personProof.publicSignalsStruct,
        0,
        0,
        makeMetadataEnvelope(hre.ethers, 1, { tag: "real-disclosure" }),
      );

    const personHash = personProof.person.personHash;
    await deepFamily.connect(signer).endorseVersion(personHash, 1);

    const disclosureProof = await generateDisclosureBindingProof(person, signerAddress);
    expect(disclosureProof.person.identityCommitment).to.equal(
      personProof.person.identityCommitment,
    );
    expect(
      await groth16VerifierAdapter.verifyProof(
        1,
        disclosureProof.proofEnvelope.proofEncodingId,
        disclosureProof.proofEnvelope.proofData,
        disclosureProof.publicSignals,
      ),
    ).to.equal(true);
    const signalNames = ["identityCommitment", "disclosureBinding", "minter", "suiteCommitment"];
    for (const [index, name] of signalNames.entries()) {
      const tamperedSignals = [...disclosureProof.publicSignals];
      tamperedSignals[index] = tamperedSignals[index] === 0n ? 1n : tamperedSignals[index] - 1n;
      expect(
        await groth16VerifierAdapter.verifyProof(
          1,
          disclosureProof.proofEnvelope.proofEncodingId,
          disclosureProof.proofEnvelope.proofData,
          tamperedSignals,
        ),
        `${name} must remain cryptographically bound to the same proof`,
      ).to.equal(false);
    }

    const coreInfo = {
      basicInfo: {
        identityCommitment: hre.ethers.zeroPadValue(
          hre.ethers.toBeHex(personProof.person.identityCommitment),
          32,
        ),
        isBirthBC: person.isBirthBC,
        birthYear: person.birthYear,
        birthMonth: person.birthMonth,
        birthDay: person.birthDay,
        gender: person.gender,
      },
      supplementInfo: {
        fullName: person.fullName,
        birthPlace: "",
        isDeathBC: false,
        deathYear: 0,
        deathMonth: 0,
        deathDay: 0,
        deathPlace: "",
        story: "",
      },
    };
    const tokenURI = "ipfs://real-disclosure-proof";

    await expect(
      deepFamily
        .connect(signer)
        .mintPersonVersionNFT(
          disclosureProof.proofEnvelope,
          disclosureProof.publicSignalsStruct,
          1,
          tokenURI,
          coreInfo,
        ),
    )
      .to.emit(deepFamily, "PersonNFTMinted")
      .withArgs(personHash, 1n, signerAddress, 1n, tokenURI, () => true);

    expect(await deepFamily.versionToTokenId(personHash, 1)).to.equal(1n);
    const stored = await deepFamily.nftCoreInfo(1);
    expect(stored.basicInfo.gender).to.equal(255n);
  });
});
