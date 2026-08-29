import "../hardhat-test-setup.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "chai";
import hre from "hardhat";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import {
  STUB_CIRCUIT_ID,
  addPerson,
  makeAddPersonPublicSignals,
  makeStubProof,
  makeTestPerson,
  setupStubVerifiers,
} from "./helpers/testHelper.mjs";
import {
  ZERO_BYTES32,
  asUint8Array,
  computePersonVersionContentCommitment,
  decryptPersonVersionRuntime,
  encryptPersonVersionEnvelope,
  parseCanonicalPersonVersion,
  parseFormat1Envelope,
  wipePreparedPersonVersionContent,
} from "../packages/protocol-core/index.js";

const PERSON_RELATION = 0;
const SECOND_PERSON_CIRCUIT_ID = STUB_CIRCUIT_ID + 1;
const vectorPath = fileURLToPath(
  new URL("../protocol-vectors/onchain-biography-v1.json", import.meta.url),
);
const protocolVector = JSON.parse(fs.readFileSync(vectorPath, "utf8"));
const protocolVectorMetadata = parseCanonicalPersonVersion(
  asUint8Array(protocolVector.metadata.canonicalJsonHex),
);

function sequentialProtocolRandom(start = 0) {
  let next = start;
  return (length) => Uint8Array.from({ length }, () => next++ & 0xff);
}

function parameterSnapshot(parameter) {
  const snapshot = {
    name: parameter.name,
    type: parameter.type,
    internalType: parameter.internalType,
  };
  if (Object.hasOwn(parameter, "indexed")) snapshot.indexed = parameter.indexed;
  if (parameter.components) {
    snapshot.components = parameter.components.map(parameterSnapshot);
  }
  return snapshot;
}

function abiEntry(abi, type, name) {
  const matches = abi.filter((entry) => entry.type === type && entry.name === name);
  expect(matches, `${type} ${name}`).to.have.length(1);
  return matches[0];
}

function scalar(name, type, internalType = type) {
  return { name, type, internalType };
}

function eventField(name, type, indexed, internalType = type) {
  return { name, type, internalType, indexed };
}

function tuple(name, internalType, components) {
  return { name, type: "tuple", internalType, components };
}

function allParameterNames(abi) {
  const names = [];
  const visit = (parameter) => {
    if (parameter.name) names.push(parameter.name);
    parameter.components?.forEach(visit);
  };
  for (const entry of abi) {
    entry.inputs?.forEach(visit);
    entry.outputs?.forEach(visit);
  }
  return names;
}

async function deployStubAdapter() {
  const PersonVerifier = await hre.ethers.getContractFactory(
    "contracts/test/StubPersonCommitmentVerifier.sol:StubPersonCommitmentVerifier",
  );
  const personVerifier = await PersonVerifier.deploy(true);
  await personVerifier.waitForDeployment();

  const DisclosureVerifier = await hre.ethers.getContractFactory(
    "contracts/test/StubDisclosureBindingVerifier.sol:StubDisclosureBindingVerifier",
  );
  const disclosureVerifier = await DisclosureVerifier.deploy(true);
  await disclosureVerifier.waitForDeployment();

  const Adapter = await hre.ethers.getContractFactory("Groth16VerifierAdapter");
  const adapter = await Adapter.deploy(
    await personVerifier.getAddress(),
    await disclosureVerifier.getAddress(),
  );
  await adapter.waitForDeployment();
  return adapter;
}

async function encryptedVectorForCurrentDeployment(deepFamily, versionCommitment) {
  const network = await hre.ethers.provider.getNetwork();
  const context = {
    chainId: network.chainId,
    deepFamilyProxy: await deepFamily.getAddress(),
    personHash: protocolVectorMetadata.person.personHash,
    fatherHash: ZERO_BYTES32,
    fatherVersionIndex: 0n,
    motherHash: ZERO_BYTES32,
    motherVersionIndex: 0n,
    versionCommitment,
  };
  const encrypted = await encryptPersonVersionEnvelope({
    metadata: protocolVectorMetadata,
    rawPassphrase: protocolVector.identity.rawPassphrase,
    identitySuiteId: 1,
    context,
    randomBytes: sequentialProtocolRandom(),
  });
  return { context, encrypted };
}

describe("fresh-v1 contract edge regressions", function () {
  this.timeout(180_000);

  describe("DeepFamilyReader constructor bindings", () => {
    it("rejects a codeless Archive returned by an otherwise callable source", async () => {
      const [, eoa] = await hre.ethers.getSigners();
      const Source = await hre.ethers.getContractFactory("MutableMetadataArchiveSourceMock");
      const source = await Source.deploy();
      await source.waitForDeployment();
      await source.setMetadataArchive(await eoa.getAddress());

      const Reader = await hre.ethers.getContractFactory("DeepFamilyReader");
      await expect(Reader.deploy(await source.getAddress())).to.be.revertedWithCustomError(
        Reader,
        "InvalidMetadataArchiveAddress",
      );
    });

    it("rejects an Archive whose immutable reverse binding names another source", async () => {
      const Source = await hre.ethers.getContractFactory("MutableMetadataArchiveSourceMock");
      const source = await Source.deploy();
      const otherSource = await Source.deploy();
      await Promise.all([source.waitForDeployment(), otherSource.waitForDeployment()]);

      const Archive = await hre.ethers.getContractFactory("MetadataArchiveV1");
      const wrongArchive = await Archive.deploy(await otherSource.getAddress());
      await wrongArchive.waitForDeployment();
      await source.setMetadataArchive(await wrongArchive.getAddress());

      const Reader = await hre.ethers.getContractFactory("DeepFamilyReader");
      await expect(Reader.deploy(await source.getAddress())).to.be.revertedWithCustomError(
        Reader,
        "MetadataArchiveBindingMismatch",
      );
    });

    it("keeps the constructor-selected Archive immutable if the source getter later changes", async () => {
      const Source = await hre.ethers.getContractFactory("MutableMetadataArchiveSourceMock");
      const source = await Source.deploy();
      await source.waitForDeployment();
      const sourceAddress = await source.getAddress();

      const Archive = await hre.ethers.getContractFactory("MetadataArchiveV1");
      const originalArchive = await Archive.deploy(sourceAddress);
      const laterArchive = await Archive.deploy(sourceAddress);
      await Promise.all([originalArchive.waitForDeployment(), laterArchive.waitForDeployment()]);
      await source.setMetadataArchive(await originalArchive.getAddress());

      const StoryArchive = await hre.ethers.getContractFactory("StoryArchiveV1");
      const originalStoryArchive = await StoryArchive.deploy(sourceAddress);
      const laterStoryArchive = await StoryArchive.deploy(sourceAddress);
      await Promise.all([
        originalStoryArchive.waitForDeployment(),
        laterStoryArchive.waitForDeployment(),
      ]);
      await source.setStoryArchive(await originalStoryArchive.getAddress());

      const Reader = await hre.ethers.getContractFactory("DeepFamilyReader");
      const reader = await Reader.deploy(sourceAddress);
      await reader.waitForDeployment();
      await source.setMetadataArchive(await laterArchive.getAddress());
      await source.setStoryArchive(await laterStoryArchive.getAddress());

      expect(await source.metadataArchive()).to.equal(await laterArchive.getAddress());
      expect(await source.storyArchive()).to.equal(await laterStoryArchive.getAddress());
      expect(await reader.DEEP_FAMILY()).to.equal(sourceAddress);
      expect(await reader.METADATA_ARCHIVE()).to.equal(await originalArchive.getAddress());
      expect(await reader.STORY_ARCHIVE()).to.equal(await originalStoryArchive.getAddress());
    });
  });

  describe("per-purpose permanent verifier routes", () => {
    it("keeps two PersonRelation circuit routes usable and rejects replacing either route", async () => {
      const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
      const [signer] = await hre.ethers.getSigners();
      const first = await setupStubVerifiers(hre.ethers, deepFamily);
      const secondAdapter = await deployStubAdapter();
      const firstAddress = await first.adapter.getAddress();
      const secondAddress = await secondAdapter.getAddress();

      await deepFamily.setCircuitVerifier(PERSON_RELATION, SECOND_PERSON_CIRCUIT_ID, secondAddress);
      expect(await deepFamily.verifierRegistry(PERSON_RELATION, STUB_CIRCUIT_ID)).to.equal(
        firstAddress,
      );
      expect(await deepFamily.verifierRegistry(PERSON_RELATION, SECOND_PERSON_CIRCUIT_ID)).to.equal(
        secondAddress,
      );

      const firstHash = await addPerson(hre.ethers, deepFamily, signer, null, {
        person: makeTestPerson("Permanent Route One A"),
        proofOverrides: { circuitId: STUB_CIRCUIT_ID },
      });
      const secondHash = await addPerson(hre.ethers, deepFamily, signer, null, {
        person: makeTestPerson("Permanent Route Two A"),
        proofOverrides: { circuitId: SECOND_PERSON_CIRCUIT_ID },
      });

      await expect(
        deepFamily.setCircuitVerifier(PERSON_RELATION, STUB_CIRCUIT_ID, secondAddress),
      ).to.be.revertedWithCustomError(deepFamily, "VerifierRouteAlreadySet");
      await expect(
        deepFamily.setCircuitVerifier(PERSON_RELATION, SECOND_PERSON_CIRCUIT_ID, firstAddress),
      ).to.be.revertedWithCustomError(deepFamily, "VerifierRouteAlreadySet");

      const firstHashAfterRejectedOverwrite = await addPerson(
        hre.ethers,
        deepFamily,
        signer,
        null,
        {
          person: makeTestPerson("Permanent Route One B"),
          proofOverrides: { circuitId: STUB_CIRCUIT_ID },
        },
      );
      const secondHashAfterRejectedOverwrite = await addPerson(
        hre.ethers,
        deepFamily,
        signer,
        null,
        {
          person: makeTestPerson("Permanent Route Two B"),
          proofOverrides: { circuitId: SECOND_PERSON_CIRCUIT_ID },
        },
      );

      for (const personHash of [
        firstHash,
        secondHash,
        firstHashAfterRejectedOverwrite,
        secondHashAfterRejectedOverwrite,
      ]) {
        expect(await deepFamily.personVersionsCount(personHash)).to.equal(1n);
      }
      expect(await deepFamily.verifierRegistry(PERSON_RELATION, STUB_CIRCUIT_ID)).to.equal(
        firstAddress,
      );
      expect(await deepFamily.verifierRegistry(PERSON_RELATION, SECOND_PERSON_CIRCUIT_ID)).to.equal(
        secondAddress,
      );
    });
  });

  describe("opaque Archive acceptance versus production decoding", () => {
    it("archives a structurally valid envelope with invalid GCM authentication that clients reject", async () => {
      const { deepFamily, metadataArchive } =
        await hre.networkHelpers.loadFixture(deployIntegratedFixture);
      const [signer] = await hre.ethers.getSigners();
      await setupStubVerifiers(hre.ethers, deepFamily);
      const prepared = computePersonVersionContentCommitment({
        metadata: protocolVectorMetadata,
        derivedSecretField: BigInt(protocolVector.identity.derivedSecretField),
      });

      try {
        const { context, encrypted } = await encryptedVectorForCurrentDeployment(
          deepFamily,
          prepared.versionCommitment,
        );
        const corruptedEnvelope = encrypted.envelope.slice();
        corruptedEnvelope[corruptedEnvelope.length - 1] ^= 0x01;
        expect(() => parseFormat1Envelope(corruptedEnvelope)).not.to.throw();

        const signerAddress = await signer.getAddress();
        const identityCommitment = BigInt(protocolVector.identity.identityCommitment);
        const publicSignals = makeAddPersonPublicSignals(identityCommitment, signerAddress, {
          selfSuiteId: 1,
          versionCommitment: prepared.versionCommitment,
        });
        await (
          await deepFamily
            .connect(signer)
            .addPersonVersion(
              makeStubProof(),
              publicSignals,
              0,
              0,
              hre.ethers.hexlify(corruptedEnvelope),
            )
        ).wait();

        const metadata = await metadataArchive.metadataRef(context.personHash, 1);
        const runtimeCode = await hre.ethers.provider.getCode(metadata.pointer);
        expect(metadata.payloadHash).to.equal(hre.ethers.keccak256(corruptedEnvelope));
        await assert.rejects(
          decryptPersonVersionRuntime({
            runtimeCode,
            payloadLength: metadata.payloadLength,
            payloadHash: metadata.payloadHash,
            rawPassphrase: protocolVector.identity.rawPassphrase,
            context,
          }),
          (error) => error?.code === "AES_GCM_AUTHENTICATION_FAILED",
        );
      } finally {
        wipePreparedPersonVersionContent(prepared);
      }
    });

    it("archives an authenticated envelope whose false chain commitment clients reject", async () => {
      const { deepFamily, metadataArchive } =
        await hre.networkHelpers.loadFixture(deployIntegratedFixture);
      const [signer] = await hre.ethers.getSigners();
      await setupStubVerifiers(hre.ethers, deepFamily);
      const prepared = computePersonVersionContentCommitment({
        metadata: protocolVectorMetadata,
        derivedSecretField: BigInt(protocolVector.identity.derivedSecretField),
      });
      const falseVersionCommitment = prepared.versionCommitment + 1n;

      try {
        const { context, encrypted } = await encryptedVectorForCurrentDeployment(
          deepFamily,
          falseVersionCommitment,
        );
        const signerAddress = await signer.getAddress();
        const identityCommitment = BigInt(protocolVector.identity.identityCommitment);
        const publicSignals = makeAddPersonPublicSignals(identityCommitment, signerAddress, {
          selfSuiteId: 1,
          versionCommitment: falseVersionCommitment,
        });
        await (
          await deepFamily
            .connect(signer)
            .addPersonVersion(
              makeStubProof(),
              publicSignals,
              0,
              0,
              hre.ethers.hexlify(encrypted.envelope),
            )
        ).wait();

        const metadata = await metadataArchive.metadataRef(context.personHash, 1);
        const runtimeCode = await hre.ethers.provider.getCode(metadata.pointer);
        expect(metadata.payloadHash).to.equal(encrypted.payloadHash);
        await assert.rejects(
          decryptPersonVersionRuntime({
            runtimeCode,
            payloadLength: metadata.payloadLength,
            payloadHash: metadata.payloadHash,
            rawPassphrase: protocolVector.identity.rawPassphrase,
            context,
          }),
          (error) => error?.code === "VERSION_COMMITMENT_MISMATCH",
        );
      } finally {
        wipePreparedPersonVersionContent(prepared);
      }
    });
  });

  describe("fresh-v1 ABI snapshots", () => {
    it("freezes AddVersion structs, PersonVersion storage getter and emitted event", async () => {
      const { abi } = await hre.artifacts.readArtifact("DeepFamily");
      const addPersonVersion = abiEntry(abi, "function", "addPersonVersion");
      expect(addPersonVersion.inputs.map(parameterSnapshot)).to.deep.equal([
        tuple("proof", "struct DeepFamily.ProofEnvelope", [
          scalar("circuitId", "uint32"),
          scalar("proofEncodingId", "uint8"),
          scalar("proofData", "bytes"),
        ]),
        tuple("publicSignals", "struct DeepFamily.PersonProofPublicSignals", [
          scalar("identityCommitment", "uint256"),
          scalar("fatherIdentityCommitment", "uint256"),
          scalar("motherIdentityCommitment", "uint256"),
          scalar("submitterAndSelfSuiteId", "uint256"),
          scalar("versionCommitment", "uint256"),
        ]),
        scalar("fatherVersionIndex", "uint256"),
        scalar("motherVersionIndex", "uint256"),
        scalar("metadataEnvelope", "bytes"),
      ]);
      expect(addPersonVersion.outputs).to.deep.equal([]);
      expect(addPersonVersion.stateMutability).to.equal("nonpayable");
      expect(addPersonVersion.inputs.map(({ name }) => name)).not.to.include.members([
        "commitment",
        "contentCommitment",
        "versionCommitment",
      ]);

      const personVersionFields = [
        scalar("personHash", "bytes32"),
        scalar("fatherHash", "bytes32"),
        scalar("motherHash", "bytes32"),
        scalar("versionIndex", "uint256"),
        scalar("fatherVersionIndex", "uint256"),
        scalar("motherVersionIndex", "uint256"),
        scalar("versionCommitment", "uint256"),
        scalar("addedBy", "address"),
        scalar("timestamp", "uint96"),
      ];
      const personVersions = abiEntry(abi, "function", "personVersions");
      expect(personVersions.inputs.map(parameterSnapshot)).to.deep.equal([
        scalar("", "bytes32"),
        scalar("", "uint256"),
      ]);
      expect(personVersions.outputs.map(parameterSnapshot)).to.deep.equal(personVersionFields);

      const added = abiEntry(abi, "event", "PersonVersionAdded");
      expect(added.anonymous).to.equal(false);
      expect(added.inputs.map(parameterSnapshot)).to.deep.equal([
        eventField("personHash", "bytes32", true),
        eventField("versionIndex", "uint256", true),
        eventField("addedBy", "address", true),
        eventField("timestamp", "uint256", false),
        eventField("fatherHash", "bytes32", false),
        eventField("fatherVersionIndex", "uint256", false),
        eventField("motherHash", "bytes32", false),
        eventField("motherVersionIndex", "uint256", false),
        eventField("versionCommitment", "uint256", false),
      ]);

      expect(allParameterNames(abi)).not.to.include.members([
        "tag",
        "metadataCID",
        "metadataArchiveId",
        "proofSystemId",
      ]);
    });

    it("freezes the one-way Archive binding and permanent verifier registry ABI", async () => {
      const { abi } = await hre.artifacts.readArtifact("DeepFamily");
      const setArchive = abiEntry(abi, "function", "setMetadataArchive");
      expect(setArchive.inputs.map(parameterSnapshot)).to.deep.equal([
        scalar("archive", "address"),
      ]);
      expect(setArchive.outputs).to.deep.equal([]);
      expect(setArchive.stateMutability).to.equal("nonpayable");

      const getArchive = abiEntry(abi, "function", "metadataArchive");
      expect(getArchive.inputs).to.deep.equal([]);
      expect(getArchive.outputs.map(parameterSnapshot)).to.deep.equal([scalar("", "address")]);
      expect(getArchive.stateMutability).to.equal("view");

      const archiveSet = abiEntry(abi, "event", "MetadataArchiveSet");
      expect(archiveSet.inputs.map(parameterSnapshot)).to.deep.equal([
        eventField("archive", "address", true),
      ]);

      const setVerifier = abiEntry(abi, "function", "setCircuitVerifier");
      expect(setVerifier.inputs.map(parameterSnapshot)).to.deep.equal([
        scalar("purpose", "uint8", "enum DeepFamily.ProofPurpose"),
        scalar("circuitId", "uint32"),
        scalar("adapter", "address"),
      ]);
      const verifierSet = abiEntry(abi, "event", "CircuitVerifierSet");
      expect(verifierSet.inputs.map(parameterSnapshot)).to.deep.equal([
        eventField("purpose", "uint8", true),
        eventField("circuitId", "uint32", true),
        eventField("adapter", "address", true),
      ]);
    });

    it("freezes MetadataRef, MetadataStored and Reader aggregate return structs", async () => {
      const archiveArtifact = await hre.artifacts.readArtifact("MetadataArchiveV1");
      const metadataRefFields = [
        scalar("pointer", "address"),
        scalar("payloadHash", "bytes32"),
        scalar("payloadLength", "uint32"),
      ];
      const metadataTuple = tuple(
        "metadata",
        "struct IMetadataArchiveV1.MetadataRef",
        metadataRefFields,
      );

      const store = abiEntry(archiveArtifact.abi, "function", "store");
      expect(store.inputs.map(parameterSnapshot)).to.deep.equal([
        scalar("personHash", "bytes32"),
        scalar("versionIndex", "uint256"),
        scalar("envelope", "bytes"),
      ]);
      expect(store.outputs.map(parameterSnapshot)).to.deep.equal([metadataTuple]);
      expect(store.stateMutability).to.equal("nonpayable");

      const metadataRef = abiEntry(archiveArtifact.abi, "function", "metadataRef");
      expect(metadataRef.inputs.map(parameterSnapshot)).to.deep.equal([
        scalar("personHash", "bytes32"),
        scalar("versionIndex", "uint256"),
      ]);
      expect(metadataRef.outputs.map(parameterSnapshot)).to.deep.equal([metadataTuple]);
      expect(metadataRef.stateMutability).to.equal("view");

      const stored = abiEntry(archiveArtifact.abi, "event", "MetadataStored");
      expect(stored.inputs.map(parameterSnapshot)).to.deep.equal([
        eventField("personHash", "bytes32", true),
        eventField("versionIndex", "uint256", true),
        eventField("pointer", "address", false),
        eventField("payloadHash", "bytes32", false),
        eventField("payloadLength", "uint32", false),
      ]);

      const deepFamilyGetter = abiEntry(archiveArtifact.abi, "function", "DEEP_FAMILY");
      expect(deepFamilyGetter.inputs).to.deep.equal([]);
      expect(deepFamilyGetter.outputs.map(parameterSnapshot)).to.deep.equal([
        scalar("", "address"),
      ]);
      expect(deepFamilyGetter.stateMutability).to.equal("view");

      const readerArtifact = await hre.artifacts.readArtifact("DeepFamilyReader");
      const details = abiEntry(readerArtifact.abi, "function", "getVersionDetails");
      expect(details.inputs.map(parameterSnapshot)).to.deep.equal([
        scalar("personHash", "bytes32"),
        scalar("versionIndex", "uint256"),
      ]);
      expect(details.outputs.map(parameterSnapshot)).to.deep.equal([
        tuple("version", "struct DeepFamily.PersonVersion", [
          scalar("personHash", "bytes32"),
          scalar("fatherHash", "bytes32"),
          scalar("motherHash", "bytes32"),
          scalar("versionIndex", "uint256"),
          scalar("fatherVersionIndex", "uint256"),
          scalar("motherVersionIndex", "uint256"),
          scalar("versionCommitment", "uint256"),
          scalar("addedBy", "address"),
          scalar("timestamp", "uint96"),
        ]),
        metadataTuple,
        scalar("endorsementCount", "uint256"),
        scalar("tokenId", "uint256"),
      ]);
    });
  });
});
