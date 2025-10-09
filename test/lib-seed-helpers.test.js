const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const {
  addPersonVersion,
  endorseVersion,
  mintPersonNFT,
  computePersonHash,
  checkPersonExists,
} = require("../lib/seedHelpers");

describe("SeedHelpers Library Tests", function () {
  this.timeout(120_000);

  let deepFamily, token, signer, signerAddr;

  before(async function () {
    // Deploy contracts
    await hre.deployments.fixture(["Integrated"]);

    const deepDeployment = await hre.deployments.get("DeepFamily");
    const tokenDeployment = await hre.deployments.get("DeepFamilyToken");

    [signer] = await ethers.getSigners();
    signerAddr = await signer.getAddress();

    deepFamily = await ethers.getContractAt("DeepFamily", deepDeployment.address, signer);
    token = await ethers.getContractAt("DeepFamilyToken", tokenDeployment.address, signer);

    console.log(`  DeepFamily: ${deepDeployment.address}`);
    console.log(`  DeepFamilyToken: ${tokenDeployment.address}`);
    console.log(`  Signer: ${signerAddr}\n`);
  });

  describe("computePersonHash", function () {
    it("should correctly compute person hash", async function () {
      const personData = {
        fullName: "TestPerson",
        passphrase: "",
        isBirthBC: false,
        birthYear: 1990,
        birthMonth: 1,
        birthDay: 1,
        gender: 1,
      };

      const hash = await computePersonHash({ deepFamily, personData });

      expect(hash).to.be.a("string");
      expect(hash).to.match(/^0x[0-9a-f]{64}$/);
    });

    it("should produce same hash for same information", async function () {
      const personData = {
        fullName: "SamePerson",
        passphrase: "secret",
        isBirthBC: false,
        birthYear: 1995,
        birthMonth: 6,
        birthDay: 15,
        gender: 2,
      };

      const hash1 = await computePersonHash({ deepFamily, personData });
      const hash2 = await computePersonHash({ deepFamily, personData });

      expect(hash1).to.equal(hash2);
    });

    it("should produce different hash for different passphrase", async function () {
      const personData1 = {
        fullName: "PassphrasePerson",
        passphrase: "secret1",
        isBirthBC: false,
        birthYear: 2000,
        birthMonth: 1,
        birthDay: 1,
        gender: 1,
      };

      const personData2 = { ...personData1, passphrase: "secret2" };

      const hash1 = await computePersonHash({ deepFamily, personData: personData1 });
      const hash2 = await computePersonHash({ deepFamily, personData: personData2 });

      expect(hash1).to.not.equal(hash2);
    });
  });

  describe("checkPersonExists", function () {
    it("should return exists=false for non-existent person", async function () {
      const personData = {
        fullName: `NonExistent_${Date.now()}`,
        passphrase: "",
        isBirthBC: false,
        birthYear: 1980,
        birthMonth: 1,
        birthDay: 1,
        gender: 1,
      };

      const hash = await computePersonHash({ deepFamily, personData });
      const result = await checkPersonExists({ deepFamily, personHash: hash });

      expect(result.exists).to.be.false;
      expect(result.totalVersions).to.equal(0);
    });
  });

  describe("addPersonVersion", function () {
    it("should successfully add a new person", async function () {
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

      // Verify person has been added
      const checkResult = await checkPersonExists({
        deepFamily,
        personHash: result.personHash,
      });
      expect(checkResult.exists).to.be.true;
      expect(checkResult.totalVersions).to.equal(1);
    });

    it("should successfully add person with parent info", async function () {
      // First add father
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

      // Add child
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

      // Verify relationship
      const versionDetails = await deepFamily.getVersionDetails(childResult.personHash, 1);
      // getVersionDetails returns (PersonVersion version, uint256 endorsementCount, uint256 tokenId)
      // Access the first return value (version) using index [0] or named property .version
      const version = versionDetails[0];
      // Convert both hashes to lowercase for comparison (avoid case sensitivity issues)
      expect(version.fatherHash.toLowerCase()).to.equal(
        fatherResult.personHash.toLowerCase()
      );
      expect(Number(version.fatherVersionIndex)).to.equal(1);
    });
  });

  describe("endorseVersion and mintPersonNFT", function () {
    let testPersonHash, testPersonData;

    before(async function () {
      // Create a test person
      testPersonData = {
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

      testPersonHash = result.personHash;
      console.log(`    Test person created: ${testPersonHash}`);
    });

    it("should successfully endorse a version", async function () {
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

      // Verify endorsement status
      const endorsedIndex = await deepFamily.endorsedVersionIndex(testPersonHash, signerAddr);
      expect(Number(endorsedIndex)).to.equal(1);
    });

    it("should successfully mint NFT", async function () {
      const supplementInfo = {
        birthPlace: "US-CA-San Francisco",
        isDeathBC: false,
        deathYear: 2050,
        deathMonth: 12,
        deathDay: 31,
        deathPlace: "US-CA-San Francisco",
        story: "Life story of test person",
      };

      const result = await mintPersonNFT({
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

      // Verify NFT ownership
      const owner = await deepFamily.ownerOf(result.tokenId);
      expect(owner).to.equal(signerAddr);

      console.log(`    NFT minted, TokenID: ${result.tokenId}`);
    });

    it("should not be able to mint NFT for non-endorsed version", async function () {
      // Create another person but don't endorse
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

      // Attempt to mint should fail
      await expect(
        mintPersonNFT({
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
      // 1. Create person
      const personData = {
        fullName: `FullWorkflow_${Date.now()}`,
        passphrase: "workflow-secret",
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

      // 2. Verify person exists
      console.log(`    2. Verifying person exists...`);
      const existsResult = await checkPersonExists({
        deepFamily,
        personHash: addResult.personHash,
        versionIndex: 1,
      });

      expect(existsResult.exists).to.be.true;
      expect(existsResult.totalVersions).to.equal(1);

      // 3. Endorse
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

      // 4. Mint NFT
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

      const mintResult = await mintPersonNFT({
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

