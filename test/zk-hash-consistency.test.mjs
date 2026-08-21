import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { poseidon4 } from "poseidon-lite";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import {
  setupStubVerifiers,
  computePersonHash,
  computeSuiteCommitment,
  computeNameField,
  computeDisclosureBinding,
  makeStubProof,
  makeAddPersonPublicSignals,
  makeMetadataEnvelope,
} from "./helpers/testHelper.mjs";

const SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function packBirthGenderField({ birthYear, birthMonth, birthDay, gender, isBirthBC }) {
  return (
    (BigInt(birthYear) << 25n) |
    (BigInt(birthMonth) << 17n) |
    (BigInt(birthDay) << 9n) |
    (BigInt(gender) << 1n) |
    (isBirthBC ? 1n : 0n)
  );
}

function computeNameSecretCommitment(nameField, derivedSecretField, suiteCommitment) {
  return poseidon4([1001n, nameField, derivedSecretField, suiteCommitment]);
}

function computeIdentityCommitment(nameSecretCommitment, packedBirthGenderField, suiteCommitment) {
  return poseidon4([1002n, nameSecretCommitment, packedBirthGenderField, suiteCommitment]);
}

function fullIdentityCommitment(
  ethers,
  {
    fullName,
    derivedSecretField = 0n,
    isBirthBC = false,
    birthYear = 0,
    birthMonth = 0,
    birthDay = 0,
    gender = 0,
    identitySuiteId = 1,
  },
) {
  const suite = computeSuiteCommitment(identitySuiteId);
  const nameField = computeNameField(ethers, fullName);
  const nsc = computeNameSecretCommitment(nameField, derivedSecretField, suite);
  const packed = packBirthGenderField({ birthYear, birthMonth, birthDay, gender, isBirthBC });
  const ic = computeIdentityCommitment(nsc, packed, suite);
  return { suite, nameField, nsc, packed, ic, personHash: computePersonHash(ethers, ic) };
}

describe("Hash Consistency Tests", function () {
  this.timeout(60_000);

  let deepFamily;

  beforeEach(async () => {
    const deployed = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    deepFamily = deployed.deepFamily;
    await setupStubVerifiers(hre.ethers, deepFamily);
  });

  describe("suiteCommitment", () => {
    it("matches Poseidon4(1000, identitySuiteId, 0, 0)", () => {
      const expected = poseidon4([1000n, 1n, 0n, 0n]);
      expect(computeSuiteCommitment(1)).to.equal(expected);
    });

    it("varies with the atomic identity suite id", () => {
      const all = [1, 2, 3, 999].map((suiteId) => computeSuiteCommitment(suiteId));
      expect(new Set(all.map(String)).size).to.equal(all.length);
    });
  });

  describe("nameField", () => {
    it("is deterministic for same input", () => {
      const a = computeNameField(hre.ethers, "John Doe");
      const b = computeNameField(hre.ethers, "John Doe");
      expect(a).to.equal(b);
    });

    it("uses domain-separated keccak256 mod SNARK_FIELD", () => {
      const fullName = "Alice Smith";
      const domainBytes = hre.ethers.toUtf8Bytes("deepfamily:name-prehash:v2");
      const nameBytes = hre.ethers.toUtf8Bytes(fullName);
      const prehash = hre.ethers.keccak256(hre.ethers.concat([domainBytes, nameBytes]));
      const expected = BigInt(prehash) % SNARK_FIELD;
      expect(computeNameField(hre.ethers, fullName)).to.equal(expected);
    });

    it("different names produce different fields", () => {
      const a = computeNameField(hre.ethers, "Alice");
      const b = computeNameField(hre.ethers, "Bob");
      expect(a).to.not.equal(b);
    });
  });

  describe("identity commitment chain", () => {
    const testCases = [
      {
        name: "Basic case",
        fullName: "John Doe",
        birthYear: 1990,
        birthMonth: 5,
        birthDay: 15,
        gender: 1,
      },
      { name: "BC birth", fullName: "Ancient Person", isBirthBC: true, birthYear: 500, gender: 2 },
      { name: "Zero values", fullName: "Unknown Person", birthYear: 0, gender: 0 },
      {
        name: "Full date",
        fullName: "Full Date Person",
        birthYear: 1985,
        birthMonth: 12,
        birthDay: 25,
        gender: 1,
      },
      {
        name: "Long name",
        fullName: "Very Long Name With Many Characters",
        birthYear: 2000,
        gender: 3,
      },
    ];

    testCases.forEach(({ name, ...input }) => {
      it(`produces consistent identity commitment for: ${name}`, () => {
        const result = fullIdentityCommitment(hre.ethers, { ...input });
        expect(result.ic).to.be.a("bigint");
        expect(result.ic > 0n).to.be.true;
        expect(result.personHash).to.match(/^0x[0-9a-f]{64}$/);

        const result2 = fullIdentityCommitment(hre.ethers, { ...input });
        expect(result.ic).to.equal(result2.ic);
        expect(result.personHash).to.equal(result2.personHash);
      });
    });
  });

  describe("personHash on-chain consistency", () => {
    it("JS computePersonHash matches on-chain emitted personHash", async () => {
      const [signer] = await hre.ethers.getSigners();
      const identityCommitment = 123456789n;
      const expectedPersonHash = computePersonHash(hre.ethers, identityCommitment);

      const proof = makeStubProof();
      const signerAddr = await signer.getAddress();
      const publicSignals = makeAddPersonPublicSignals(identityCommitment, signerAddr);
      const tx = await deepFamily
        .connect(signer)
        .addPersonVersion(
          proof,
          publicSignals,
          0,
          0,
          makeMetadataEnvelope(hre.ethers, 1, { tag: "test" }),
        );
      const receipt = await tx.wait();

      const iface = new hre.ethers.Interface([
        "event PersonVersionAdded(bytes32 indexed personHash, uint256 indexed versionIndex, address indexed addedBy, uint256 timestamp, bytes32 fatherHash, uint256 fatherVersionIndex, bytes32 motherHash, uint256 motherVersionIndex, uint256 versionCommitment)",
      ]);
      const deepAddr = (deepFamily.target || deepFamily.address).toLowerCase();
      let emittedPersonHash = null;
      for (const log of receipt.logs || []) {
        if ((log.address || "").toLowerCase() !== deepAddr) continue;
        try {
          const parsed = iface.parseLog(log);
          if (parsed && parsed.name === "PersonVersionAdded") {
            emittedPersonHash = parsed.args.personHash;
            break;
          }
        } catch (_) {}
      }

      expect(emittedPersonHash).to.equal(expectedPersonHash);
    });

    it("different identity commitments produce different personHashes", () => {
      const hash1 = computePersonHash(hre.ethers, 100n);
      const hash2 = computePersonHash(hre.ethers, 101n);
      expect(hash1).to.not.equal(hash2);
    });
  });

  describe("disclosureBinding", () => {
    it("is deterministic for same inputs", () => {
      const basicInfo = {
        isBirthBC: false,
        birthYear: 1999,
        birthMonth: 5,
        birthDay: 15,
        gender: 1,
      };
      const a = computeDisclosureBinding(hre.ethers, "Alice", basicInfo, 1);
      const b = computeDisclosureBinding(hre.ethers, "Alice", basicInfo, 1);
      expect(a).to.equal(b);
    });

    it("matches Poseidon4(1003, nameField, packedBirthGenderField, suiteCommitment)", () => {
      const fullName = "Test User";
      const basicInfo = {
        isBirthBC: false,
        birthYear: 1999,
        birthMonth: 5,
        birthDay: 15,
        gender: 1,
      };
      const nameField = computeNameField(hre.ethers, fullName);
      const packedBirthGenderField = packBirthGenderField(basicInfo);
      const suite = computeSuiteCommitment(1);
      const expected = poseidon4([1003n, nameField, packedBirthGenderField, suite]);
      expect(computeDisclosureBinding(hre.ethers, fullName, basicInfo, 1)).to.equal(expected);
    });

    it("varies with different names", () => {
      const basicInfo = {
        isBirthBC: false,
        birthYear: 1999,
        birthMonth: 5,
        birthDay: 15,
        gender: 1,
      };
      const a = computeDisclosureBinding(hre.ethers, "Alice", basicInfo, 1);
      const b = computeDisclosureBinding(hre.ethers, "Bob", basicInfo, 1);
      expect(a).to.not.equal(b);
    });

    it("varies with different birth or gender data", () => {
      const a = computeDisclosureBinding(
        hre.ethers,
        "Alice",
        { isBirthBC: false, birthYear: 1999, birthMonth: 5, birthDay: 15, gender: 1 },
        1,
      );
      const b = computeDisclosureBinding(
        hre.ethers,
        "Alice",
        { isBirthBC: false, birthYear: 2000, birthMonth: 5, birthDay: 15, gender: 1 },
        1,
      );
      expect(a).to.not.equal(b);
    });
  });
});
