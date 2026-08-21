import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import {
  setupStubVerifiers,
  addPerson,
  mintPerson,
  computePersonHash,
  computeDisclosureBinding,
  computeIdentityCommitment,
  computeSuiteCommitment,
  makeStubProof,
  makeTestPerson,
  packBirthGenderField,
} from "./helpers/testHelper.mjs";

const toTimestamp = (year, month, day) => Math.floor(Date.UTC(year, month - 1, day) / 1000);

describe("Mint NFT Tests", function () {
  this.timeout(60_000);

  async function endorseVersion(deepFamily, signer, personHash, versionIndex = 1) {
    return deepFamily.connect(signer).endorseVersion(personHash, versionIndex);
  }

  async function mintPersonVersionNFT(
    deepFamily,
    signer,
    _personHash,
    proof,
    ps,
    versionIndex,
    tokenURI,
    coreInfo,
  ) {
    return deepFamily
      .connect(signer)
      .mintPersonVersionNFT(proof, ps, versionIndex, tokenURI, coreInfo);
  }

  async function baseSetup() {
    const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [signer] = await hre.ethers.getSigners();
    await setupStubVerifiers(hre.ethers, deepFamily);
    return { deepFamily, signer };
  }

  async function prepareMintBase() {
    const { deepFamily, signer } = await baseSetup();
    const FULLNAME = "Mint Subject";
    const person = makeTestPerson(FULLNAME, {
      isBirthBC: false,
      birthYear: 1999,
      birthMonth: 0,
      birthDay: 0,
      gender: 1,
    });
    const identityCommitment = computeIdentityCommitment(hre.ethers, FULLNAME, person, 1, 1, 1);
    const personHash = await addPerson(hre.ethers, deepFamily, signer, identityCommitment, {
      person,
    });
    await endorseVersion(deepFamily, signer, personHash, 1);
    return { deepFamily, signer, FULLNAME, personHash, identityCommitment };
  }

  async function prepareBasicInfoMintAttempt(
    fullName,
    personOverrides = {},
    basicInfoOverrides = {},
  ) {
    const { deepFamily, signer } = await baseSetup();
    const person = makeTestPerson(fullName, {
      isBirthBC: false,
      birthYear: 1999,
      birthMonth: 1,
      birthDay: 1,
      gender: 1,
      ...personOverrides,
    });
    const identityCommitment = computeIdentityCommitment(hre.ethers, fullName, person, 1, 1, 1);
    const personHash = await addPerson(hre.ethers, deepFamily, signer, identityCommitment, {
      person,
    });
    await endorseVersion(deepFamily, signer, personHash, 1);

    const basicInfo = {
      identityCommitment: hre.ethers.zeroPadValue(hre.ethers.toBeHex(identityCommitment), 32),
      isBirthBC: person.isBirthBC,
      birthYear: person.birthYear,
      birthMonth: person.birthMonth,
      birthDay: person.birthDay,
      gender: person.gender,
      ...basicInfoOverrides,
    };
    const publicSignals = {
      identityCommitment: BigInt(identityCommitment),
      disclosureBinding: computeDisclosureBinding(hre.ethers, fullName, basicInfo, 1, 1, 1),
      minter: BigInt(await signer.getAddress()),
      suiteCommitment: computeSuiteCommitment(1),
    };
    const coreInfo = {
      basicInfo,
      supplementInfo: {
        fullName,
        birthPlace: "",
        isDeathBC: false,
        deathYear: 0,
        deathMonth: 0,
        deathDay: 0,
        deathPlace: "",
        story: "",
      },
    };

    return {
      deepFamily,
      signer,
      personHash,
      identityCommitment,
      publicSignals,
      coreInfo,
    };
  }

  it("fails mint before endorsement", async () => {
    const { deepFamily, signer } = await baseSetup();
    const FULLNAME = "No Endorse";
    const person = makeTestPerson(FULLNAME, {
      isBirthBC: false,
      birthYear: 1999,
      birthMonth: 0,
      birthDay: 0,
      gender: 1,
    });
    const identityCommitment = computeIdentityCommitment(hre.ethers, FULLNAME, person, 1, 1, 1);
    const personHash = await addPerson(hre.ethers, deepFamily, signer, identityCommitment, {
      person,
    });

    const basicInfo = {
      identityCommitment: hre.ethers.zeroPadValue(hre.ethers.toBeHex(identityCommitment), 32),
      isBirthBC: false,
      birthYear: 1999,
      birthMonth: 0,
      birthDay: 0,
      gender: 1,
    };
    const disclosureBindingValue = computeDisclosureBinding(
      hre.ethers,
      FULLNAME,
      basicInfo,
      1,
      1,
      1,
    );
    const signerAddr = await signer.getAddress();

    const proof = makeStubProof();
    const publicSignals = {
      identityCommitment: BigInt(identityCommitment),
      disclosureBinding: disclosureBindingValue,
      minter: BigInt(signerAddr),
      suiteCommitment: computeSuiteCommitment(1),
    };

    const coreInfo = {
      basicInfo,
      supplementInfo: {
        fullName: FULLNAME,
        birthPlace: "",
        isDeathBC: false,
        deathYear: 0,
        deathMonth: 0,
        deathDay: 0,
        deathPlace: "",
        story: "",
      },
    };

    await expect(
      mintPersonVersionNFT(deepFamily, signer, personHash, proof, publicSignals, 1, "", coreInfo),
    ).to.be.revertedWithCustomError(deepFamily, "MustEndorseVersionFirst");
  });

  it("mints NFT and sets mappings", async () => {
    const { deepFamily, signer } = await baseSetup();
    const FULLNAME = "Mint Subject";
    const person = makeTestPerson(FULLNAME, {
      isBirthBC: false,
      birthYear: 1999,
      birthMonth: 0,
      birthDay: 0,
      gender: 1,
    });
    const identityCommitment = computeIdentityCommitment(hre.ethers, FULLNAME, person, 1, 1, 1);

    const { personHash } = await mintPerson(
      hre.ethers,
      deepFamily,
      signer,
      identityCommitment,
      FULLNAME,
      {
        tokenURI: "ipfs://meta2",
        birthPlace: "City",
        story: "Story",
      },
    );

    const tokenCounter = await deepFamily.tokenCounter();
    expect(tokenCounter).to.equal(1n);
    expect(await deepFamily.tokenIdToPerson(1n)).to.equal(personHash);
    expect(await deepFamily.tokenIdToVersionIndex(1n)).to.equal(1n);
    expect(await deepFamily.versionToTokenId(personHash, 1n)).to.equal(1n);
  });

  it("prevents double mint of same version", async () => {
    const { deepFamily, signer } = await baseSetup();
    const FULLNAME = "Double Mint";
    const identityCommitment = computeIdentityCommitment(
      hre.ethers,
      FULLNAME,
      { isBirthBC: false, birthYear: 1999, birthMonth: 0, birthDay: 0, gender: 1 },
      1,
      1,
      1,
    );

    await mintPerson(hre.ethers, deepFamily, signer, identityCommitment, FULLNAME);

    const personHash = computePersonHash(hre.ethers, identityCommitment);
    const basicInfo = {
      identityCommitment: hre.ethers.zeroPadValue(hre.ethers.toBeHex(identityCommitment), 32),
      isBirthBC: false,
      birthYear: 1999,
      birthMonth: 0,
      birthDay: 0,
      gender: 1,
    };
    const disclosureBindingValue = computeDisclosureBinding(
      hre.ethers,
      FULLNAME,
      basicInfo,
      1,
      1,
      1,
    );
    const signerAddr = await signer.getAddress();

    const proof = makeStubProof();
    const publicSignals = {
      identityCommitment: BigInt(identityCommitment),
      disclosureBinding: disclosureBindingValue,
      minter: BigInt(signerAddr),
      suiteCommitment: computeSuiteCommitment(1),
    };
    const coreInfo = {
      basicInfo,
      supplementInfo: {
        fullName: FULLNAME,
        birthPlace: "",
        isDeathBC: false,
        deathYear: 0,
        deathMonth: 0,
        deathDay: 0,
        deathPlace: "",
        story: "",
      },
    };

    await expect(
      mintPersonVersionNFT(deepFamily, signer, personHash, proof, publicSignals, 1, "", coreInfo),
    ).to.be.revertedWithCustomError(deepFamily, "VersionAlreadyMinted");
  });

  it("rejects empty fullName in supplementInfo", async () => {
    const { deepFamily, signer, personHash, identityCommitment, FULLNAME } =
      await prepareMintBase();

    const basicInfo = {
      identityCommitment: hre.ethers.zeroPadValue(hre.ethers.toBeHex(identityCommitment), 32),
      isBirthBC: false,
      birthYear: 1999,
      birthMonth: 0,
      birthDay: 0,
      gender: 1,
    };
    const disclosureBindingValue = computeDisclosureBinding(
      hre.ethers,
      FULLNAME,
      basicInfo,
      1,
      1,
      1,
    );
    const signerAddr = await signer.getAddress();

    const proof = makeStubProof();
    const publicSignals = {
      identityCommitment: BigInt(identityCommitment),
      disclosureBinding: disclosureBindingValue,
      minter: BigInt(signerAddr),
      suiteCommitment: computeSuiteCommitment(1),
    };
    const coreInfo = {
      basicInfo,
      supplementInfo: {
        fullName: "",
        birthPlace: "",
        isDeathBC: false,
        deathYear: 0,
        deathMonth: 0,
        deathDay: 0,
        deathPlace: "",
        story: "",
      },
    };

    await expect(
      mintPersonVersionNFT(deepFamily, signer, personHash, proof, publicSignals, 1, "", coreInfo),
    ).to.be.revertedWithCustomError(deepFamily, "InvalidFullName");
  });

  it("rejects mismatched supplement fullName and proof-bound fullName", async () => {
    const { deepFamily, signer, personHash, identityCommitment, FULLNAME } =
      await prepareMintBase();

    const basicInfo = {
      identityCommitment: hre.ethers.zeroPadValue(hre.ethers.toBeHex(identityCommitment), 32),
      isBirthBC: false,
      birthYear: 1999,
      birthMonth: 0,
      birthDay: 0,
      gender: 1,
    };
    const disclosureBindingValue = computeDisclosureBinding(
      hre.ethers,
      FULLNAME,
      basicInfo,
      1,
      1,
      1,
    );
    const signerAddr = await signer.getAddress();

    const proof = makeStubProof();
    const publicSignals = {
      identityCommitment: BigInt(identityCommitment),
      disclosureBinding: disclosureBindingValue,
      minter: BigInt(signerAddr),
      suiteCommitment: computeSuiteCommitment(1),
    };
    const coreInfo = {
      basicInfo,
      supplementInfo: {
        fullName: "Different Name",
        birthPlace: "",
        isDeathBC: false,
        deathYear: 0,
        deathMonth: 0,
        deathDay: 0,
        deathPlace: "",
        story: "",
      },
    };

    await expect(
      mintPersonVersionNFT(deepFamily, signer, personHash, proof, publicSignals, 1, "", coreInfo),
    ).to.be.revertedWithCustomError(deepFamily, "BasicInfoMismatch");
  });

  it("mints successfully with consistent inputs", async () => {
    const { deepFamily, signer } = await baseSetup();
    const FULLNAME = "Consistent Mint";
    const identityCommitment = null;

    const { personHash } = await mintPerson(
      hre.ethers,
      deepFamily,
      signer,
      identityCommitment,
      FULLNAME,
    );

    const tokenCounter = await deepFamily.tokenCounter();
    expect(tokenCounter).to.equal(1n);
    expect(await deepFamily.tokenIdToPerson(1n)).to.equal(personHash);
    expect(await deepFamily.versionToTokenId(personHash, 1n)).to.equal(1n);
  });

  it("mints successfully when fullname is canonicalized before proof/calldata submission", async () => {
    const { deepFamily, signer } = await baseSetup();
    const FULLNAME = "  Alice　Smith  ";
    const identityCommitment = null;

    const { receipt } = await mintPerson(
      hre.ethers,
      deepFamily,
      signer,
      identityCommitment,
      FULLNAME,
    );

    expect(receipt?.status).to.equal(1);
    expect(await deepFamily.tokenCounter()).to.equal(1n);
  });

  it("supports a non-default atomic identity suite on mint", async () => {
    const { deepFamily, signer } = await baseSetup();
    const FULLNAME = "Versioned Mint";

    const { receipt } = await mintPerson(hre.ethers, deepFamily, signer, null, FULLNAME, {
      selfSuiteId: 2,
    });

    expect(receipt?.status).to.equal(1);
    expect(await deepFamily.tokenCounter()).to.equal(1n);
  });

  it("reverts when proof minter does not match caller", async () => {
    const { deepFamily, signer, personHash, identityCommitment, FULLNAME } =
      await prepareMintBase();
    const [, otherSigner] = await hre.ethers.getSigners();
    const otherAddr = await otherSigner.getAddress();

    const basicInfo = {
      identityCommitment: hre.ethers.zeroPadValue(hre.ethers.toBeHex(identityCommitment), 32),
      isBirthBC: false,
      birthYear: 1999,
      birthMonth: 0,
      birthDay: 0,
      gender: 1,
    };
    const disclosureBindingValue = computeDisclosureBinding(
      hre.ethers,
      FULLNAME,
      basicInfo,
      1,
      1,
      1,
    );

    const proof = makeStubProof();
    const publicSignals = {
      identityCommitment: BigInt(identityCommitment),
      disclosureBinding: disclosureBindingValue,
      minter: BigInt(otherAddr),
      suiteCommitment: computeSuiteCommitment(1),
    };
    const coreInfo = {
      basicInfo,
      supplementInfo: {
        fullName: FULLNAME,
        birthPlace: "",
        isDeathBC: false,
        deathYear: 0,
        deathMonth: 0,
        deathDay: 0,
        deathPlace: "",
        story: "",
      },
    };

    await expect(
      mintPersonVersionNFT(deepFamily, signer, personHash, proof, publicSignals, 1, "", coreInfo),
    ).to.be.revertedWithCustomError(deepFamily, "CallerMismatch");
  });

  it("allows another supported nonzero identity suite on mint", async () => {
    const { deepFamily, signer } = await baseSetup();

    const { receipt } = await mintPerson(hre.ethers, deepFamily, signer, null, "Suite 999 Mint", {
      selfSuiteId: 999,
    });

    expect(receipt?.status).to.equal(1);
    expect(await deepFamily.tokenCounter()).to.equal(1n);
  });

  describe("Birth field canonical encoding", () => {
    function submitMint(attempt) {
      const { deepFamily, signer, personHash, publicSignals, coreInfo } = attempt;
      return mintPersonVersionNFT(
        deepFamily,
        signer,
        personHash,
        makeStubProof(),
        publicSignals,
        1,
        "",
        coreInfo,
      );
    }

    async function expectMintToRevert(attempt, errorName) {
      await expect(submitMint(attempt)).to.be.revertedWithCustomError(
        attempt.deepFamily,
        errorName,
      );
    }

    it("rejects birthMonth above 12", async () => {
      const attempt = await prepareBasicInfoMintAttempt(
        "Invalid Birth Month",
        {},
        { birthMonth: 13 },
      );

      await expectMintToRevert(attempt, "InvalidBirthMonth");
    });

    it("rejects birthDay above 31", async () => {
      const attempt = await prepareBasicInfoMintAttempt("Invalid Birth Day", {}, { birthDay: 32 });

      await expectMintToRevert(attempt, "InvalidBirthDay");
    });

    for (const gender of [4, 255]) {
      it(`allows gender ${gender} as a full uint8 value`, async () => {
        const attempt = await prepareBasicInfoMintAttempt(`Gender ${gender}`, { gender });

        await submitMint(attempt);

        expect(await attempt.deepFamily.tokenCounter()).to.equal(1n);
      });
    }

    it("keeps the former day/gender alias distinct after packing", () => {
      const fullName = "Packed Birth Alias";
      const canonicalBasicInfo = {
        isBirthBC: false,
        birthYear: 1999,
        birthMonth: 1,
        birthDay: 1,
        gender: 1,
      };
      const formerlyAliasedBasicInfo = {
        ...canonicalBasicInfo,
        birthDay: 0,
        gender: 129,
      };

      expect(packBirthGenderField(canonicalBasicInfo)).to.not.equal(
        packBirthGenderField(formerlyAliasedBasicInfo),
      );
      expect(
        computeDisclosureBinding(hre.ethers, fullName, canonicalBasicInfo, 1, 1, 1),
      ).to.not.equal(
        computeDisclosureBinding(hre.ethers, fullName, formerlyAliasedBasicInfo, 1, 1, 1),
      );
      expect(
        computeIdentityCommitment(hre.ethers, fullName, canonicalBasicInfo, 1, 1, 1),
      ).to.not.equal(
        computeIdentityCommitment(hre.ethers, fullName, formerlyAliasedBasicInfo, 1, 1, 1),
      );
    });
  });

  describe("Age gate", () => {
    async function setNextBlockTimestamp(ts) {
      const { timestamp: latestTs } = await hre.ethers.provider.getBlock("latest");
      const next = Math.max(Number(latestTs) + 1, ts);
      await hre.ethers.provider.send("evm_setNextBlockTimestamp", [next]);
      await hre.ethers.provider.send("evm_mine");
      return next;
    }

    async function planMintDate() {
      const { timestamp: latestTs } = await hre.ethers.provider.getBlock("latest");
      const baseYear = new Date(latestTs * 1000).getUTCFullYear();
      const mintYear = baseYear + 1;
      const mintMonth = 6;
      const mintDay = 15;
      const mintTs = toTimestamp(mintYear, mintMonth, mintDay);
      return { mintYear, mintMonth, mintDay, mintTs };
    }

    it("reverts when age is 18 but birth month not reached", async () => {
      const { mintYear, mintMonth, mintDay, mintTs } = await planMintDate();
      const { deepFamily, signer } = await baseSetup();
      const FULLNAME = "Young Month";
      const ic = computeIdentityCommitment(
        hre.ethers,
        FULLNAME,
        {
          isBirthBC: false,
          birthYear: mintYear - 18,
          birthMonth: mintMonth + 1,
          birthDay: mintDay,
          gender: 1,
        },
        1,
        1,
        1,
      );
      const person = makeTestPerson(FULLNAME, {
        isBirthBC: false,
        birthYear: mintYear - 18,
        birthMonth: mintMonth + 1,
        birthDay: mintDay,
        gender: 1,
      });
      const personHash = await addPerson(hre.ethers, deepFamily, signer, ic, { person });
      await endorseVersion(deepFamily, signer, personHash, 1);

      await setNextBlockTimestamp(mintTs);

      const basicInfo = {
        identityCommitment: hre.ethers.zeroPadValue(hre.ethers.toBeHex(ic), 32),
        isBirthBC: false,
        birthYear: mintYear - 18,
        birthMonth: mintMonth + 1,
        birthDay: mintDay,
        gender: 1,
      };
      const dbVal = computeDisclosureBinding(hre.ethers, FULLNAME, basicInfo, 1, 1, 1);
      const signerAddr = await signer.getAddress();

      const publicSignals = {
        identityCommitment: BigInt(ic),
        disclosureBinding: dbVal,
        minter: BigInt(signerAddr),
        suiteCommitment: computeSuiteCommitment(1),
      };
      const coreInfo = {
        basicInfo,
        supplementInfo: {
          fullName: FULLNAME,
          birthPlace: "",
          isDeathBC: false,
          deathYear: 0,
          deathMonth: 0,
          deathDay: 0,
          deathPlace: "",
          story: "",
        },
      };

      await expect(
        mintPersonVersionNFT(
          deepFamily,
          signer,
          personHash,
          makeStubProof(),
          publicSignals,
          1,
          "",
          coreInfo,
        ),
      ).to.be.revertedWithCustomError(deepFamily, "MustBeAdult");
    });

    it("allows mint when birth year is unknown (0)", async () => {
      const { deepFamily, signer } = await baseSetup();
      const FULLNAME = "Unknown Year";
      const ic = null;

      await mintPerson(hre.ethers, deepFamily, signer, ic, FULLNAME, {
        birthYear: 0,
        birthMonth: 0,
        birthDay: 0,
      });

      const tokenCounter = await deepFamily.tokenCounter();
      expect(tokenCounter).to.equal(1n);
    });
  });
});
