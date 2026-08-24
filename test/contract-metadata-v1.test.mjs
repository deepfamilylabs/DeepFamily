import "../hardhat-test-setup.mjs";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "chai";
import hre from "hardhat";
import { AbiCoder } from "ethers";
import {
  DFM1_MAX_CONTENT_CIPHERTEXT_BYTES,
  DFM1_MAX_ENVELOPE_BYTES,
  ZERO_BYTES32,
  asUint8Array,
  computePersonVersionContentCommitment,
  decryptPersonVersionRuntime,
  encryptPersonVersionEnvelope,
  gzipV1,
  parseCanonicalPersonVersion,
  parseFormat1Envelope,
  serializeCanonicalPersonVersion,
  wipeBytes,
  wipePreparedPersonVersionContent,
} from "../packages/protocol-core/index.js";

const PERSON_RELATION = 0;
const DISCLOSURE_BINDING = 1;
const PERSON_CIRCUIT_ID = 101;
const DISCLOSURE_CIRCUIT_ID = 201;
const VERSION_HASH_DOMAIN = hre.ethers.id("DeepFamily:VersionHash:v1");
const protocolVectorPath = fileURLToPath(
  new URL("../protocol-vectors/onchain-biography-v1.json", import.meta.url),
);
const protocolVector = JSON.parse(fs.readFileSync(protocolVectorPath, "utf8"));
const protocolVectorMetadata = parseCanonicalPersonVersion(
  asUint8Array(protocolVector.metadata.canonicalJsonHex),
);
const XorShiftAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function xorshiftAscii(seed, length) {
  let state = seed >>> 0;
  let output = "";
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    output += XorShiftAlphabet[(state >>> 0) & 63];
  }
  return output;
}

function compressedMetadataLength(metadata) {
  const canonicalJson = serializeCanonicalPersonVersion(metadata);
  const compressed = gzipV1(canonicalJson);
  try {
    return compressed.length;
  } finally {
    wipeBytes(canonicalJson);
    wipeBytes(compressed);
  }
}

function makeMaximumEnvelopeMetadata() {
  const target = DFM1_MAX_CONTENT_CIPHERTEXT_BYTES;
  const tryCandidate = (seed, biographyLength) => {
    const metadata = structuredClone(protocolVectorMetadata);
    metadata.biography = xorshiftAscii(seed, biographyLength);
    return compressedMetadataLength(metadata) === target ? metadata : null;
  };

  // This exact candidate makes the common path fast. The bounded deterministic
  // fallback keeps the test resilient to small canonical-vector/gzip changes.
  const known = tryCandidate(0x12345679, 20_922);
  if (known) return known;

  for (let seedOffset = 0; seedOffset < 16; seedOffset += 1) {
    const seed = (0x12345678 + seedOffset) >>> 0;
    let low = 20_000;
    let high = 22_000;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const metadata = structuredClone(protocolVectorMetadata);
      metadata.biography = xorshiftAscii(seed, middle);
      if (compressedMetadataLength(metadata) < target) low = middle + 1;
      else high = middle;
    }
    for (
      let length = Math.max(20_000, low - 96);
      length <= Math.min(22_000, low + 96);
      length += 1
    ) {
      const metadata = tryCandidate(seed, length);
      if (metadata) return metadata;
    }
  }
  throw new Error(`Could not deterministically construct a ${target}-byte gzip payload`);
}

function sequentialProtocolRandom(start = 0) {
  let next = start;
  return (length) => Uint8Array.from({ length }, () => next++ & 0xff);
}

function makeProof(circuitId = PERSON_CIRCUIT_ID, overrides = {}) {
  return {
    circuitId,
    proofEncodingId: 1,
    proofData: AbiCoder.defaultAbiCoder().encode(
      ["uint256[2]", "uint256[2][2]", "uint256[2]"],
      [
        [0, 0],
        [
          [0, 0],
          [0, 0],
        ],
        [0, 0],
      ],
    ),
    ...overrides,
  };
}

function makeEnvelope({ suiteId = 1, formatVersion = 1, length = 20, mutate } = {}) {
  const bytes = new Uint8Array(length);
  bytes.set([0x44, 0x46, 0x4d, 0x31, formatVersion], 0);
  new DataView(bytes.buffer).setUint32(16, suiteId, false);
  mutate?.(bytes);
  return hre.ethers.hexlify(bytes);
}

function makePublicSignals(signerAddress, overrides = {}) {
  const suiteId = BigInt(overrides.suiteId ?? 1);
  return {
    identityCommitment: overrides.identityCommitment ?? 123456n,
    fatherIdentityCommitment: overrides.fatherIdentityCommitment ?? 0n,
    motherIdentityCommitment: overrides.motherIdentityCommitment ?? 0n,
    submitterAndSelfSuiteId:
      overrides.submitterAndSelfSuiteId ?? BigInt(signerAddress) | (suiteId << 160n),
    versionCommitment: overrides.versionCommitment ?? 9001n,
  };
}

function personHashOf(identityCommitment) {
  return hre.ethers.keccak256(hre.ethers.zeroPadValue(hre.ethers.toBeHex(identityCommitment), 32));
}

async function deployAdapter({ personShouldVerify = true, disclosureShouldVerify = true } = {}) {
  const PersonStub = await hre.ethers.getContractFactory(
    "contracts/test/StubPersonCommitmentVerifier.sol:StubPersonCommitmentVerifier",
  );
  const personVerifier = await PersonStub.deploy(personShouldVerify);
  await personVerifier.waitForDeployment();

  const DisclosureStub = await hre.ethers.getContractFactory(
    "contracts/test/StubDisclosureBindingVerifier.sol:StubDisclosureBindingVerifier",
  );
  const disclosureVerifier = await DisclosureStub.deploy(disclosureShouldVerify);
  await disclosureVerifier.waitForDeployment();

  const Adapter = await hre.ethers.getContractFactory("Groth16VerifierAdapter");
  const adapter = await Adapter.deploy(
    await personVerifier.getAddress(),
    await disclosureVerifier.getAddress(),
  );
  await adapter.waitForDeployment();
  return { adapter, personVerifier, disclosureVerifier };
}

async function deployCore({ configureArchive = true, registerRoutes = true, archiveFactory } = {}) {
  const [owner] = await hre.ethers.getSigners();
  const Token = await hre.ethers.getContractFactory("DeepFamilyToken");
  const token = await Token.deploy();
  await token.waitForDeployment();

  const Poseidon = await hre.ethers.getContractFactory("PoseidonT5");
  const poseidon = await Poseidon.deploy();
  await poseidon.waitForDeployment();
  const AdultAgeGate = await hre.ethers.getContractFactory("AdultAgeGate");
  const adultAgeGate = await AdultAgeGate.deploy();
  await adultAgeGate.waitForDeployment();

  const DeepFamily = await hre.ethers.getContractFactory("DeepFamily", {
    libraries: {
      PoseidonT5: await poseidon.getAddress(),
      AdultAgeGate: await adultAgeGate.getAddress(),
    },
  });
  const implementation = await DeepFamily.deploy();
  await implementation.waitForDeployment();
  const initData = DeepFamily.interface.encodeFunctionData("initialize", [
    await token.getAddress(),
    await owner.getAddress(),
  ]);
  const Proxy = await hre.ethers.getContractFactory("UUPSProxy");
  const proxy = await Proxy.deploy(await implementation.getAddress(), initData);
  await proxy.waitForDeployment();
  const deepFamily = DeepFamily.attach(await proxy.getAddress());

  let archive;
  if (configureArchive) {
    if (archiveFactory) {
      archive = await archiveFactory(await proxy.getAddress());
    } else {
      const Archive = await hre.ethers.getContractFactory("MetadataArchiveV1");
      archive = await Archive.deploy(await proxy.getAddress());
      await archive.waitForDeployment();
    }
    await deepFamily.setMetadataArchive(await archive.getAddress());
  }

  let adapter;
  if (registerRoutes) {
    ({ adapter } = await deployAdapter());
    await deepFamily.setCircuitVerifier(
      PERSON_RELATION,
      PERSON_CIRCUIT_ID,
      await adapter.getAddress(),
    );
    await deepFamily.setCircuitVerifier(
      DISCLOSURE_BINDING,
      DISCLOSURE_CIRCUIT_ID,
      await adapter.getAddress(),
    );
  }

  return {
    owner,
    token,
    poseidon,
    adultAgeGate,
    implementation,
    proxy,
    deepFamily,
    archive,
    adapter,
  };
}

async function addVersion(deepFamily, signer, overrides = {}) {
  const signerAddress = await signer.getAddress();
  const suiteId = overrides.suiteId ?? 1;
  const publicSignals = makePublicSignals(signerAddress, { suiteId, ...overrides.publicSignals });
  const envelope = overrides.envelope ?? makeEnvelope({ suiteId });
  const tx = await deepFamily
    .connect(signer)
    .addPersonVersion(
      overrides.proof ?? makeProof(),
      publicSignals,
      overrides.fatherVersionIndex ?? 0,
      overrides.motherVersionIndex ?? 0,
      envelope,
    );
  return { tx, publicSignals, envelope };
}

describe("DeepFamily encrypted metadata v1", function () {
  this.timeout(120_000);

  describe("metadata archive binding", () => {
    it("requires one correctly reverse-bound archive and only permits proxy configuration", async () => {
      const { deepFamily, implementation, proxy } = await deployCore({
        configureArchive: false,
        registerRoutes: false,
      });
      const [, nonOwner, eoa] = await hre.ethers.getSigners();
      const Archive = await hre.ethers.getContractFactory("MetadataArchiveV1");
      const archive = await Archive.deploy(await proxy.getAddress());
      await archive.waitForDeployment();

      await expect(
        implementation.setMetadataArchive(await archive.getAddress()),
      ).to.be.revertedWithCustomError(implementation, "UUPSUnauthorizedCallContext");
      await expect(
        deepFamily.connect(nonOwner).setMetadataArchive(await archive.getAddress()),
      ).to.be.revertedWithCustomError(deepFamily, "OwnableUnauthorizedAccount");
      await expect(
        deepFamily.setMetadataArchive(hre.ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(deepFamily, "InvalidMetadataArchive");
      await expect(
        deepFamily.setMetadataArchive(await eoa.getAddress()),
      ).to.be.revertedWithCustomError(deepFamily, "InvalidMetadataArchive");

      const wrongArchive = await Archive.deploy(await implementation.getAddress());
      await wrongArchive.waitForDeployment();
      await expect(
        deepFamily.setMetadataArchive(await wrongArchive.getAddress()),
      ).to.be.revertedWithCustomError(deepFamily, "InvalidMetadataArchive");

      await expect(deepFamily.setMetadataArchive(await archive.getAddress()))
        .to.emit(deepFamily, "MetadataArchiveSet")
        .withArgs(await archive.getAddress());
      expect(await deepFamily.metadataArchive()).to.equal(await archive.getAddress());

      await expect(
        deepFamily.setMetadataArchive(hre.ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(deepFamily, "MetadataArchiveAlreadySet");
      await expect(
        deepFamily.setMetadataArchive(await wrongArchive.getAddress()),
      ).to.be.revertedWithCustomError(deepFamily, "MetadataArchiveAlreadySet");
    });

    it("rejects AddVersion while the archive is unset", async () => {
      const { deepFamily, owner } = await deployCore({ configureArchive: false });
      const signals = makePublicSignals(await owner.getAddress());
      await expect(
        deepFamily.addPersonVersion(makeProof(), signals, 0, 0, makeEnvelope()),
      ).to.be.revertedWithCustomError(deepFamily, "MetadataArchiveNotSet");
    });

    it("rolls back version and duplicate-key state when Archive.store fails", async () => {
      const deployed = await deployCore({
        archiveFactory: async (proxyAddress) => {
          const Stub = await hre.ethers.getContractFactory("StubMetadataArchive");
          const archive = await Stub.deploy(proxyAddress, true);
          await archive.waitForDeployment();
          return archive;
        },
      });
      const { deepFamily, owner, archive } = deployed;
      const signals = makePublicSignals(await owner.getAddress());
      const personHash = personHashOf(signals.identityCommitment);
      const versionHash = hre.ethers.keccak256(
        AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "bytes32", "bytes32", "uint256", "bytes32", "uint256", "uint256"],
          [
            VERSION_HASH_DOMAIN,
            personHash,
            hre.ethers.ZeroHash,
            0,
            hre.ethers.ZeroHash,
            0,
            signals.versionCommitment,
          ],
        ),
      );

      await expect(
        deepFamily.addPersonVersion(makeProof(), signals, 0, 0, makeEnvelope()),
      ).to.be.revertedWithCustomError(archive, "StoreFailed");
      expect(await deepFamily.personVersionsCount(personHash)).to.equal(0n);
      expect(await deepFamily.versionExists(personHash, versionHash)).to.equal(false);
    });
  });

  describe("universal envelope prefix and packed signal", () => {
    it("rejects envelope lengths 1 through 19", async () => {
      const { deepFamily, owner } = await deployCore();
      const signals = makePublicSignals(await owner.getAddress());
      for (let length = 1; length < 20; length++) {
        await expect(
          deepFamily.addPersonVersion(makeProof(), signals, 0, 0, `0x${"01".repeat(length)}`),
        ).to.be.revertedWithCustomError(deepFamily, "InvalidMetadataEnvelope");
      }
    });

    it("rejects wrong magic, zero format, and zero self suite", async () => {
      const { deepFamily, owner } = await deployCore();
      const signals = makePublicSignals(await owner.getAddress());

      await expect(
        deepFamily.addPersonVersion(
          makeProof(),
          signals,
          0,
          0,
          makeEnvelope({ mutate: (bytes) => (bytes[0] = 0x00) }),
        ),
      ).to.be.revertedWithCustomError(deepFamily, "InvalidEnvelopePrefix");
      await expect(
        deepFamily.addPersonVersion(makeProof(), signals, 0, 0, makeEnvelope({ formatVersion: 0 })),
      ).to.be.revertedWithCustomError(deepFamily, "InvalidEnvelopePrefix");
      await expect(
        deepFamily.addPersonVersion(makeProof(), signals, 0, 0, makeEnvelope({ suiteId: 0 })),
      ).to.be.revertedWithCustomError(deepFamily, "InvalidIdentitySuite");
    });

    it("parses suite 2 as big-endian and rejects caller, suite, or high-bit mismatch", async () => {
      const { deepFamily, owner } = await deployCore();
      const [, other] = await hre.ethers.getSigners();
      const envelope = makeEnvelope({ suiteId: 2 });
      const valid = makePublicSignals(await owner.getAddress(), { suiteId: 2 });
      await deepFamily.addPersonVersion(makeProof(), valid, 0, 0, envelope);

      for (const badPacked of [
        BigInt(await other.getAddress()) | (2n << 160n),
        BigInt(await owner.getAddress()) | (1n << 160n),
        valid.submitterAndSelfSuiteId | (1n << 192n),
      ]) {
        const signals = makePublicSignals(await owner.getAddress(), {
          suiteId: 2,
          identityCommitment: valid.identityCommitment + badPacked,
          submitterAndSelfSuiteId: badPacked,
          versionCommitment: valid.versionCommitment + badPacked,
        });
        await expect(
          deepFamily.addPersonVersion(makeProof(), signals, 0, 0, envelope),
        ).to.be.revertedWithCustomError(deepFamily, "CallerOrIdentitySuiteMismatch");
      }
    });

    it("does not interpret format-specific selector bytes and accepts unknown nonzero formats", async () => {
      const { deepFamily, owner } = await deployCore();
      const firstSignals = makePublicSignals(await owner.getAddress(), { versionCommitment: 11n });
      const selectorGarbage = makeEnvelope({
        mutate: (bytes) => bytes.fill(0xff, 5, 16),
      });
      await deepFamily.addPersonVersion(makeProof(), firstSignals, 0, 0, selectorGarbage);

      const secondSignals = makePublicSignals(await owner.getAddress(), {
        versionCommitment: 12n,
      });
      await deepFamily.addPersonVersion(
        makeProof(),
        secondSignals,
        0,
        0,
        makeEnvelope({ formatVersion: 99 }),
      );
    });

    it("keeps a maximum-size envelope below the eSpace single-tx limit with 20% headroom", async () => {
      const { deepFamily, archive, owner } = await deployCore();
      // eSpace transaction pools cap one transaction at half of the 30M block gas limit.
      const espaceSingleTransactionGasLimit = 15_000_000n;
      const signals = makePublicSignals(await owner.getAddress(), {
        versionCommitment: 16_384n,
      });
      const envelope = makeEnvelope({ length: 16_384 });
      const args = [makeProof(), signals, 0, 0, envelope];
      const estimate = await deepFamily.addPersonVersion.estimateGas(...args);
      const latestBlock = await hre.ethers.provider.getBlock("latest");
      expect(latestBlock).not.to.equal(null);
      expect(latestBlock.gasLimit).to.be.at.least(espaceSingleTransactionGasLimit);
      expect((estimate * 120n + 99n) / 100n).to.be.lessThan(espaceSingleTransactionGasLimit);

      const tx = await deepFamily.addPersonVersion(...args);
      const receipt = await tx.wait();
      expect(receipt.gasUsed).to.be.at.most(estimate);
      const personHash = personHashOf(signals.identityCommitment);
      const metadataRef = await archive.metadataRef(personHash, 1);
      expect(metadataRef.payloadLength).to.equal(16_384n);
      const runtimeCode = await hre.ethers.provider.getCode(metadataRef.pointer);
      expect(hre.ethers.getBytes(runtimeCode)).to.have.length(16_385);
    });

    it("encrypts, archives, validates and production-decrypts an exact 16,384-byte envelope", async () => {
      const { deepFamily, archive, owner } = await deployCore();
      const metadata = makeMaximumEnvelopeMetadata();
      const derivedSecretField = BigInt(protocolVector.identity.derivedSecretField);
      const identityCommitment = BigInt(protocolVector.identity.identityCommitment);
      const prepared = computePersonVersionContentCommitment({ metadata, derivedSecretField });
      const proxyAddress = await deepFamily.getAddress();
      const network = await hre.ethers.provider.getNetwork();
      const context = {
        chainId: network.chainId,
        deepFamilyProxy: proxyAddress,
        personHash: metadata.person.personHash,
        fatherHash: ZERO_BYTES32,
        fatherVersionIndex: 0n,
        motherHash: ZERO_BYTES32,
        motherVersionIndex: 0n,
        versionCommitment: prepared.versionCommitment,
      };

      try {
        expect(personHashOf(identityCommitment)).to.equal(metadata.person.personHash);
        const encrypted = await encryptPersonVersionEnvelope({
          metadata,
          rawPassphrase: protocolVector.identity.rawPassphrase,
          identitySuiteId: 1,
          context,
          randomBytes: sequentialProtocolRandom(),
        });
        const parsed = parseFormat1Envelope(encrypted.envelope);
        expect(parsed.contentCiphertextLength).to.equal(DFM1_MAX_CONTENT_CIPHERTEXT_BYTES);
        expect(encrypted.envelope).to.have.length(DFM1_MAX_ENVELOPE_BYTES);

        const signals = makePublicSignals(await owner.getAddress(), {
          identityCommitment,
          versionCommitment: prepared.versionCommitment,
        });
        await (
          await deepFamily.addPersonVersion(
            makeProof(),
            signals,
            0,
            0,
            hre.ethers.hexlify(encrypted.envelope),
          )
        ).wait();

        const metadataRef = await archive.metadataRef(metadata.person.personHash, 1);
        expect(metadataRef.payloadLength).to.equal(BigInt(DFM1_MAX_ENVELOPE_BYTES));
        expect(metadataRef.payloadHash).to.equal(encrypted.payloadHash);
        const runtimeCode = await hre.ethers.provider.getCode(metadataRef.pointer);
        const runtimeBytes = hre.ethers.getBytes(runtimeCode);
        expect(runtimeBytes).to.have.length(DFM1_MAX_ENVELOPE_BYTES + 1);
        expect(runtimeBytes[0]).to.equal(0);
        expect(hre.ethers.keccak256(runtimeBytes.slice(1))).to.equal(metadataRef.payloadHash);

        const decrypted = await decryptPersonVersionRuntime({
          runtimeCode,
          payloadLength: metadataRef.payloadLength,
          payloadHash: metadataRef.payloadHash,
          rawPassphrase: protocolVector.identity.rawPassphrase,
          context,
        });
        expect(decrypted.metadataUnlockValidated).to.equal(true);
        expect(decrypted.metadata.person).to.deep.equal(metadata.person);
        expect(decrypted.metadata.parents).to.deep.equal(metadata.parents);
        expect(decrypted.metadata.tag).to.equal(metadata.tag);
        expect(hre.ethers.id(decrypted.metadata.biography)).to.equal(
          hre.ethers.id(metadata.biography),
        );
      } finally {
        wipePreparedPersonVersionContent(prepared);
      }
    });
  });

  describe("version commitment, routes, and Reader", () => {
    it("deduplicates only the context-scoped versionCommitment, not envelope bytes", async () => {
      const { deepFamily, owner } = await deployCore();
      const signerAddress = await owner.getAddress();
      const first = makePublicSignals(signerAddress, { versionCommitment: 777n });
      await deepFamily.addPersonVersion(makeProof(), first, 0, 0, makeEnvelope());

      const differentEnvelope = makeEnvelope({ mutate: (bytes) => (bytes[15] = 0xaa) });
      await expect(
        deepFamily.addPersonVersion(makeProof(), first, 0, 0, differentEnvelope),
      ).to.be.revertedWithCustomError(deepFamily, "DuplicateVersionCommitment");

      const second = makePublicSignals(signerAddress, { versionCommitment: 778n });
      await deepFamily.addPersonVersion(makeProof(), second, 0, 0, differentEnvelope);
      expect(await deepFamily.personVersionsCount(personHashOf(first.identityCommitment))).to.equal(
        2n,
      );
    });

    it("uses immutable purpose+circuit routes and never replaces an existing route", async () => {
      const { deepFamily, owner } = await deployCore({ registerRoutes: false });
      const { adapter } = await deployAdapter();
      const address = await adapter.getAddress();

      await expect(
        deepFamily.setCircuitVerifier(PERSON_RELATION, 0, address),
      ).to.be.revertedWithCustomError(deepFamily, "InvalidCircuitId");
      await expect(
        deepFamily.setCircuitVerifier(PERSON_RELATION, 1, hre.ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(deepFamily, "InvalidVerifierAddress");
      await deepFamily.setCircuitVerifier(DISCLOSURE_BINDING, 55, address);
      await deepFamily.setCircuitVerifier(PERSON_RELATION, 55, address);
      expect(await deepFamily.verifierRegistry(PERSON_RELATION, 55)).to.equal(address);
      expect(await deepFamily.verifierRegistry(DISCLOSURE_BINDING, 55)).to.equal(address);
      await expect(
        deepFamily.setCircuitVerifier(PERSON_RELATION, 55, address),
      ).to.be.revertedWithCustomError(deepFamily, "VerifierRouteAlreadySet");

      const signals = makePublicSignals(await owner.getAddress());
      await expect(
        deepFamily.addPersonVersion(makeProof(999), signals, 0, 0, makeEnvelope()),
      ).to.be.revertedWithCustomError(deepFamily, "VerifierRouteNotSet");
      await expect(
        deepFamily.addPersonVersion(makeProof(0), signals, 0, 0, makeEnvelope()),
      ).to.be.revertedWithCustomError(deepFamily, "InvalidCircuitId");
    });

    it("Reader freezes proxy/archive bindings and keeps array/ref indices distinct", async () => {
      const { deepFamily, proxy, archive, owner } = await deployCore();
      const Reader = await hre.ethers.getContractFactory("DeepFamilyReader");
      const reader = await Reader.deploy(await proxy.getAddress());
      await reader.waitForDeployment();
      expect(await reader.DEEP_FAMILY()).to.equal(await proxy.getAddress());
      expect(await reader.METADATA_ARCHIVE()).to.equal(await archive.getAddress());

      const signerAddress = await owner.getAddress();
      const personHash = personHashOf(123456n);
      await deepFamily.addPersonVersion(
        makeProof(),
        makePublicSignals(signerAddress, { versionCommitment: 1001n }),
        0,
        0,
        makeEnvelope({ mutate: (bytes) => (bytes[15] = 1) }),
      );
      await deepFamily.addPersonVersion(
        makeProof(),
        makePublicSignals(signerAddress, { versionCommitment: 1002n }),
        0,
        0,
        makeEnvelope({ mutate: (bytes) => (bytes[15] = 2) }),
      );

      const first = await reader.getVersionDetails(personHash, 1);
      const second = await reader.getVersionDetails(personHash, 2);
      expect(first.version.versionIndex).to.equal(1n);
      expect(first.version.versionCommitment).to.equal(1001n);
      expect(first.metadata.pointer).to.equal((await archive.metadataRef(personHash, 1)).pointer);
      expect(second.version.versionIndex).to.equal(2n);
      expect(second.version.versionCommitment).to.equal(1002n);
      expect(second.metadata.pointer).to.equal((await archive.metadataRef(personHash, 2)).pointer);
      await expect(reader.getVersionMetadataRef(personHash, 0)).to.be.revertedWithCustomError(
        reader,
        "InvalidVersionIndex",
      );
    });

    it("Reader rejects an unset Archive during construction", async () => {
      const { proxy } = await deployCore({ configureArchive: false, registerRoutes: false });
      const Reader = await hre.ethers.getContractFactory("DeepFamilyReader");
      await expect(Reader.deploy(await proxy.getAddress())).to.be.revertedWithCustomError(
        Reader,
        "InvalidMetadataArchiveAddress",
      );
    });
  });
});
