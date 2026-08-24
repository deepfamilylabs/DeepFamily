import "../hardhat-test-setup.mjs";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "chai";
import hre from "hardhat";
import { generatePersonRelationProof } from "../lib/personCommitmentProof.js";
import {
  ZERO_BYTES32,
  asUint8Array,
  computePersonVersionContentCommitment,
  decryptPersonVersionRuntime,
  deriveIdentityMaterial,
  encryptPersonVersionEnvelope,
  parseCanonicalPersonVersion,
  roundTripPersonVersionEnvelope,
  wipeBytes,
  wipePreparedPersonVersionContent,
} from "../packages/protocol-core/index.js";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import { makeMetadataEnvelope } from "./helpers/testHelper.mjs";

const protocolVectorPath = fileURLToPath(
  new URL("../protocol-vectors/onchain-biography-v1.json", import.meta.url),
);
const protocolVector = JSON.parse(fs.readFileSync(protocolVectorPath, "utf8"));
const protocolVectorMetadata = parseCanonicalPersonVersion(
  asUint8Array(protocolVector.metadata.canonicalJsonHex),
);

function sequentialProtocolRandom(start = 0) {
  let next = start;
  return (length) => Uint8Array.from({ length }, () => next++ & 0xff);
}

describe("Real person commitment proof", function () {
  this.timeout(120_000);

  it("accepts derivedSecretField=0 but rejects an unkeyed version signal", async () => {
    const { deepFamily, groth16VerifierAdapter } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture);
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

    // The circuit deliberately cannot prove that this witness came from Argon2id. It must still
    // require the version signal to be keyed by the exact same (even invalid) identity witness.
    expect(generated.input.derivedSecretField).to.equal("0");
    expect(generated.versionCommitment).not.to.equal(generated.contentDigestLo);
    expect(
      await groth16VerifierAdapter.verifyProof(
        0,
        generated.proofEnvelope.proofEncodingId,
        generated.proofEnvelope.proofData,
        generated.publicSignals,
      ),
    ).to.equal(true);
    const signalNames = [
      "identityCommitment",
      "fatherIdentityCommitment",
      "motherIdentityCommitment",
      "submitterAndSelfSuiteId",
      "versionCommitment",
    ];
    for (const [index, name] of signalNames.entries()) {
      const tamperedSignals = [...generated.publicSignals];
      tamperedSignals[index] =
        name === "versionCommitment"
          ? generated.contentDigestLo
          : tamperedSignals[index] === 0n
            ? 1n
            : tamperedSignals[index] - 1n;
      expect(
        await groth16VerifierAdapter.verifyProof(
          0,
          generated.proofEnvelope.proofEncodingId,
          generated.proofEnvelope.proofData,
          tamperedSignals,
        ),
        `${name} must remain cryptographically bound to the same proof`,
      ).to.equal(false);
    }

    const unkeyedPublicSignals = {
      ...generated.publicSignalsStruct,
      versionCommitment: generated.contentDigestLo,
    };
    await expect(
      deepFamily
        .connect(signer)
        .addPersonVersion(
          generated.proofEnvelope,
          unkeyedPublicSignals,
          0,
          0,
          makeMetadataEnvelope(hre.ethers, 1, { tag: "unkeyed-version-signal" }),
        ),
    ).to.be.revertedWithCustomError(deepFamily, "InvalidZKProof");

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
          makeMetadataEnvelope(hre.ethers, 1, { tag: "mixed-suite-header-mismatch" }),
        ),
    ).to.be.revertedWithCustomError(deepFamily, "CallerOrIdentitySuiteMismatch");

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

  it("round-trips production DFM1 and exposes the real-proof false-digest boundary", async () => {
    const { deepFamily, metadataArchive, deepFamilyReader } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [signer] = await hre.ethers.getSigners();
    const signerAddress = await signer.getAddress();
    const network = await hre.ethers.provider.getNetwork();
    let identityMaterial;
    let prepared;

    try {
      identityMaterial = await deriveIdentityMaterial({
        identity: protocolVectorMetadata.person,
        rawPassphrase: protocolVector.identity.rawPassphrase,
        identitySuiteId: 1,
      });
      expect(identityMaterial.personHash).to.equal(protocolVectorMetadata.person.personHash);

      prepared = computePersonVersionContentCommitment({
        metadata: protocolVectorMetadata,
        derivedSecretField: identityMaterial.derivedSecretField,
      });
      const personWitness = {
        ...identityMaterial.identity,
        derivedSecretField: identityMaterial.derivedSecretField,
      };
      const generated = await generatePersonRelationProof(
        personWitness,
        null,
        null,
        signerAddress,
        { contentDigest: prepared.contentDigest },
      );
      expect(generated.publicSignals).to.have.length(5);
      expect(generated.person.personHash).to.equal(identityMaterial.personHash);
      expect(generated.versionCommitment).to.equal(prepared.versionCommitment);

      const context = {
        chainId: network.chainId,
        deepFamilyProxy: await deepFamily.getAddress(),
        personHash: identityMaterial.personHash,
        fatherHash: ZERO_BYTES32,
        fatherVersionIndex: 0n,
        motherHash: ZERO_BYTES32,
        motherVersionIndex: 0n,
        versionCommitment: generated.versionCommitment,
      };
      const encrypted = await encryptPersonVersionEnvelope({
        metadata: protocolVectorMetadata,
        rawPassphrase: protocolVector.identity.rawPassphrase,
        identitySuiteId: 1,
        context,
        randomBytes: sequentialProtocolRandom(),
      });
      const preflight = await roundTripPersonVersionEnvelope({
        envelope: encrypted.envelope,
        rawPassphrase: protocolVector.identity.rawPassphrase,
        context,
        expectedMetadata: protocolVectorMetadata,
        submitterAndSelfSuiteId: generated.publicSignalsStruct.submitterAndSelfSuiteId,
        expectedSubmitter: signerAddress,
      });
      expect(preflight.metadataUnlockValidated).to.equal(true);

      await expect(
        deepFamily
          .connect(signer)
          .addPersonVersion(
            generated.proofEnvelope,
            generated.publicSignalsStruct,
            0,
            0,
            encrypted.envelope,
          ),
      )
        .to.emit(deepFamily, "PersonHashZKVerified")
        .withArgs(identityMaterial.personHash, signerAddress);

      const details = await deepFamilyReader.getVersionDetails(identityMaterial.personHash, 1);
      expect(details.version.versionCommitment).to.equal(generated.versionCommitment);
      expect(details.metadata).to.deep.equal(
        await metadataArchive.metadataRef(identityMaterial.personHash, 1),
      );
      expect(details.metadata.payloadHash).to.equal(encrypted.payloadHash);
      expect(details.metadata.payloadLength).to.equal(BigInt(encrypted.envelope.length));

      const runtimeCode = await hre.ethers.provider.getCode(details.metadata.pointer);
      const decoded = await decryptPersonVersionRuntime({
        runtimeCode,
        payloadLength: details.metadata.payloadLength,
        payloadHash: details.metadata.payloadHash,
        rawPassphrase: protocolVector.identity.rawPassphrase,
        context,
      });
      expect(decoded.metadataUnlockValidated).to.equal(true);
      expect(decoded.metadata).to.deep.equal(protocolVectorMetadata);

      const rerandomized = await encryptPersonVersionEnvelope({
        metadata: protocolVectorMetadata,
        rawPassphrase: protocolVector.identity.rawPassphrase,
        identitySuiteId: 1,
        context,
        randomBytes: sequentialProtocolRandom(97),
      });
      expect(rerandomized.payloadHash).not.to.equal(encrypted.payloadHash);
      await expect(
        deepFamily
          .connect(signer)
          .addPersonVersion(
            generated.proofEnvelope,
            generated.publicSignalsStruct,
            0,
            0,
            rerandomized.envelope,
          ),
      ).to.be.revertedWithCustomError(deepFamily, "DuplicateVersionCommitment");
      expect(await deepFamily.personVersionsCount(identityMaterial.personHash)).to.equal(1n);
      expect(await metadataArchive.metadataRef(identityMaterial.personHash, 1)).to.deep.equal(
        details.metadata,
      );

      // A proof holder can deliberately use a digest unrelated to the encrypted plaintext. The
      // proof and GCM remain valid because the false keyed commitment is consistently used in AAD;
      // only the production decoder's post-decryption recomputation can reject the record.
      const falseContentDigest = hre.ethers.id("attacker-selected-unrelated-content-digest");
      expect(falseContentDigest).not.to.equal(prepared.contentDigest);
      const maliciousProof = await generatePersonRelationProof(
        personWitness,
        null,
        null,
        signerAddress,
        { contentDigest: falseContentDigest },
      );
      expect(maliciousProof.versionCommitment).not.to.equal(generated.versionCommitment);
      const maliciousContext = {
        ...context,
        versionCommitment: maliciousProof.versionCommitment,
      };
      const maliciousEnvelope = await encryptPersonVersionEnvelope({
        metadata: protocolVectorMetadata,
        rawPassphrase: protocolVector.identity.rawPassphrase,
        identitySuiteId: 1,
        context: maliciousContext,
        randomBytes: sequentialProtocolRandom(193),
      });
      await expect(
        deepFamily
          .connect(signer)
          .addPersonVersion(
            maliciousProof.proofEnvelope,
            maliciousProof.publicSignalsStruct,
            0,
            0,
            maliciousEnvelope.envelope,
          ),
      ).to.emit(deepFamily, "PersonVersionAdded");

      const maliciousDetails = await deepFamilyReader.getVersionDetails(
        identityMaterial.personHash,
        2,
      );
      const maliciousRuntime = await hre.ethers.provider.getCode(maliciousDetails.metadata.pointer);
      let maliciousDecodeError;
      try {
        await decryptPersonVersionRuntime({
          runtimeCode: maliciousRuntime,
          payloadLength: maliciousDetails.metadata.payloadLength,
          payloadHash: maliciousDetails.metadata.payloadHash,
          rawPassphrase: protocolVector.identity.rawPassphrase,
          context: maliciousContext,
        });
      } catch (error) {
        maliciousDecodeError = error;
      }
      expect(maliciousDecodeError?.code).to.equal("VERSION_COMMITMENT_MISMATCH");
      expect(await deepFamily.personVersionsCount(identityMaterial.personHash)).to.equal(2n);
      expect(await metadataArchive.metadataRef(identityMaterial.personHash, 1)).to.deep.equal(
        details.metadata,
      );
    } finally {
      wipeBytes(identityMaterial?.identitySalt);
      wipeBytes(identityMaterial?.derivedSecretBytes);
      if (prepared) wipePreparedPersonVersionContent(prepared);
    }
  });
});
