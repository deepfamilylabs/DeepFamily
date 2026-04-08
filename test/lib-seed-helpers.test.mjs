import '../hardhat-test-setup.mjs'
import { expect } from 'chai'
import hre from 'hardhat'
import seedHelpers from '../lib/seedHelpers.js'
import { deployIntegratedFixture } from './fixtures/integrated.mjs'
import { setupStubVerifiers } from './helpers/testHelper.mjs'

const { ethers } = hre
const {
  addPersonVersion,
  endorseVersion,
  mintPersonVersionNFT,
  computePersonHash,
  checkPersonExists,
} = seedHelpers

describe("SeedHelpers Library Tests", function () {
  this.timeout(120_000);

  async function setupSeedFixture() {
    const { deepFamily: deployedDeepFamily, token: deployedToken } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture)

    const [signer] = await ethers.getSigners();
    const signerAddr = await signer.getAddress();

    const deepFamily = deployedDeepFamily.connect(signer)
    const token = deployedToken.connect(signer)

    await setupStubVerifiers(hre.ethers, deployedDeepFamily)

    return { deepFamily, token, signer, signerAddr };
  }

  describe("computePersonHash", function () {
    it("should correctly compute person hash", function () {
      const personData = {
        fullName: "TestPerson",
        passphrase: "",
        isBirthBC: false,
        birthYear: 1990,
        birthMonth: 1,
        birthDay: 1,
        gender: 1,
      };

      const hash = computePersonHash({ personData });

      expect(hash).to.be.a("string");
      expect(hash).to.match(/^0x[0-9a-f]{64}$/);
    });

    it("should produce same hash for same information", function () {
      const personData = {
        fullName: "SamePerson",
        passphrase: "",
        isBirthBC: false,
        birthYear: 1995,
        birthMonth: 6,
        birthDay: 15,
        gender: 2,
      };

      const hash1 = computePersonHash({ personData });
      const hash2 = computePersonHash({ personData });

      expect(hash1).to.equal(hash2);
    });

    it("should produce different hash for different names", function () {
      const personData1 = {
        fullName: "PersonAlpha",
        passphrase: "",
        isBirthBC: false,
        birthYear: 2000,
        birthMonth: 1,
        birthDay: 1,
        gender: 1,
      };

      const personData2 = { ...personData1, fullName: "PersonBeta" };

      const hash1 = computePersonHash({ personData: personData1 });
      const hash2 = computePersonHash({ personData: personData2 });

      expect(hash1).to.not.equal(hash2);
    });
  });

  describe("checkPersonExists", function () {
    it("should return exists=false for non-existent person", async function () {
      const { deepFamily } = await setupSeedFixture()
      const personData = {
        fullName: `NonExistent_${Date.now()}`,
        passphrase: "",
        isBirthBC: false,
        birthYear: 1980,
        birthMonth: 1,
        birthDay: 1,
        gender: 1,
      };

      const hash = computePersonHash({ personData });
      const result = await checkPersonExists({ deepFamily, personHash: hash });

      expect(result.exists).to.be.false;
      expect(result.totalVersions).to.equal(0);
    });
  });

  describe("addPersonVersion", function () {
    it("should successfully add a new person", async function () {
      const { deepFamily, signer } = await setupSeedFixture()
      const personData = {
        fullName: `NewPerson_${Date.now()}`,
        passphrase: "",
        isBirthBC: false,
        birthYear: 1985,
        birthMonth: 3,
        birthDay: 10,
        gender: 1,
      };

      const result = await addPersonVersion({
        deepFamily,
        signer,
        personData,
        tag: "v1",
        ipfs: "QmTest1",
      });

      expect(result.personHash).to.be.a("string");
      expect(result.personHash).to.match(/^0x[0-9a-f]{64}$/);
      expect(result.tx).to.exist;
      expect(result.receipt).to.exist;

      const checkResult = await checkPersonExists({
        deepFamily,
        personHash: result.personHash,
      });
      expect(checkResult.exists).to.be.true;
      expect(checkResult.totalVersions).to.equal(1);
    });

    it("should successfully add person with parent info", async function () {
      const { deepFamily, signer } = await setupSeedFixture()
      const fatherData = {
        fullName: `Father_${Date.now()}`,
        passphrase: "",
        isBirthBC: false,
        birthYear: 1960,
        birthMonth: 1,
        birthDay: 1,
        gender: 1,
      };

      const fatherResult = await addPersonVersion({
        deepFamily,
        signer,
        personData: fatherData,
        tag: "v1",
        ipfs: "QmFather",
      });

      const childData = {
        fullName: `Child_${Date.now()}`,
        passphrase: "",
        isBirthBC: false,
        birthYear: 1990,
        birthMonth: 5,
        birthDay: 20,
        gender: 2,
      };

      const childResult = await addPersonVersion({
        deepFamily,
        signer,
        personData: childData,
        fatherData,
        fatherVersion: 1,
        tag: "v1",
        ipfs: "QmChild",
      });

      expect(childResult.personHash).to.be.a("string");
      expect(childResult.personHash).to.match(/^0x[0-9a-f]{64}$/);

      const versionDetails = await deepFamily.getVersionDetails(childResult.personHash, 1);
      const version = versionDetails[0];
      expect(version.fatherHash.toLowerCase()).to.equal(
        fatherResult.personHash.toLowerCase()
      );
      expect(Number(version.fatherVersionIndex)).to.equal(1);
    });
  });

  describe("endorseVersion and mintPersonVersionNFT", function () {
    async function createEndorsedPersonFixture() {
      const { deepFamily, token, signer, signerAddr } = await setupSeedFixture()
      const testPersonData = {
        fullName: `MintTestPerson_${Date.now()}`,
        passphrase: "",
        isBirthBC: false,
        birthYear: 1975,
        birthMonth: 7,
        birthDay: 4,
        gender: 1,
      };

      const result = await addPersonVersion({
        deepFamily,
        signer,
        personData: testPersonData,
        tag: "v1",
        ipfs: "QmMintTest",
      });

      return {
        deepFamily,
        token,
        signer,
        signerAddr,
        testPersonData,
        testPersonHash: result.personHash,
      }
    }

    it("should successfully endorse a version", async function () {
      const { deepFamily, token, signer, signerAddr, testPersonHash } = await createEndorsedPersonFixture()
      const result = await endorseVersion({
        deepFamily,
        token,
        signer,
        personHash: testPersonHash,
        versionIndex: 1,
        autoApprove: true,
      });

      expect(result.tx).to.exist;
      expect(result.receipt).to.exist;
      expect(result.fee).to.be.a("bigint");

      const endorsedIndex = await deepFamily.endorsedVersionIndex(testPersonHash, signerAddr);
      expect(Number(endorsedIndex)).to.equal(1);
    });

    it("should successfully mint NFT", async function () {
      const { deepFamily, token, signer, signerAddr, testPersonHash, testPersonData } =
        await createEndorsedPersonFixture()
      await endorseVersion({
        deepFamily,
        token,
        signer,
        personHash: testPersonHash,
        versionIndex: 1,
        autoApprove: true,
      })

      const supplementInfo = {
        birthPlace: "US-CA-San Francisco",
        isDeathBC: false,
        deathYear: 2050,
        deathMonth: 12,
        deathDay: 31,
        deathPlace: "US-CA-San Francisco",
        story: "Life story of test person",
      };

      const result = await mintPersonVersionNFT({
        deepFamily,
        signer,
        personHash: testPersonHash,
        versionIndex: 1,
        tokenURI: "ipfs://test-nft-metadata",
        basicInfo: testPersonData,
        supplementInfo,
      });

      expect(result.tx).to.exist;
      expect(result.receipt).to.exist;
      expect(result.tokenId).to.exist;

      const owner = await deepFamily.ownerOf(result.tokenId);
      expect(owner).to.equal(signerAddr);

      console.log(`    NFT minted, TokenID: ${result.tokenId}`);
    });

    it("should not be able to mint NFT for non-endorsed version", async function () {
      const { deepFamily, signer } = await setupSeedFixture()
      const newPersonData = {
        fullName: `NoEndorse_${Date.now()}`,
        passphrase: "",
        isBirthBC: false,
        birthYear: 1988,
        birthMonth: 8,
        birthDay: 8,
        gender: 2,
      };

      const addResult = await addPersonVersion({
        deepFamily,
        signer,
        personData: newPersonData,
        tag: "v1",
        ipfs: "QmNoEndorse",
      });

      const supplementInfo = {
        birthPlace: "Test Place",
        isDeathBC: false,
        deathYear: 0,
        deathMonth: 0,
        deathDay: 0,
        deathPlace: "",
        story: "",
      };

      await expect(
        mintPersonVersionNFT({
          deepFamily,
          signer,
          personHash: addResult.personHash,
          versionIndex: 1,
          tokenURI: "ipfs://test",
          basicInfo: newPersonData,
          supplementInfo,
        })
      ).to.be.rejectedWith(/must endorse this version first/i);
    });
  });

  describe("complete workflow", function () {
    it("should complete full workflow from adding to minting", async function () {
      const { deepFamily, token, signer } = await setupSeedFixture()
      const personData = {
        fullName: `FullWorkflow_${Date.now()}`,
        passphrase: "",
        isBirthBC: false,
        birthYear: 1992,
        birthMonth: 11,
        birthDay: 15,
        gender: 2,
      };

      console.log(`    1. Adding person...`);
      const addResult = await addPersonVersion({
        deepFamily,
        signer,
        personData,
        tag: "v1",
        ipfs: "QmWorkflow",
      });

      expect(addResult.personHash).to.exist;

      console.log(`    2. Verifying person exists...`);
      const existsResult = await checkPersonExists({
        deepFamily,
        personHash: addResult.personHash,
        versionIndex: 1,
      });

      expect(existsResult.exists).to.be.true;
      expect(existsResult.totalVersions).to.equal(1);

      console.log(`    3. Endorsing version...`);
      const endorseResult = await endorseVersion({
        deepFamily,
        token,
        signer,
        personHash: addResult.personHash,
        versionIndex: 1,
        autoApprove: true,
      });

      expect(endorseResult.tx).to.exist;

      console.log(`    4. Minting NFT...`);
      const supplementInfo = {
        birthPlace: "Workflow City",
        isDeathBC: false,
        deathYear: 2080,
        deathMonth: 12,
        deathDay: 31,
        deathPlace: "Workflow City",
        story: "Life story of complete workflow test",
      };

      const mintResult = await mintPersonVersionNFT({
        deepFamily,
        signer,
        personHash: addResult.personHash,
        versionIndex: 1,
        tokenURI: "ipfs://workflow-nft",
        basicInfo: personData,
        supplementInfo,
      });

      expect(mintResult.tokenId).to.exist;
      console.log(`    ✓ Workflow complete, TokenID: ${mintResult.tokenId}`);
    });
  });
});
