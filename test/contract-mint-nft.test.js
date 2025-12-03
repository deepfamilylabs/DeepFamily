const { expect } = require('chai');
const hre = require('hardhat');
const { buildBasicInfo } = require('../lib/namePoseidon');
const { generateNamePoseidonProof } = require('../lib/namePoseidonProof');

const toTimestamp = (year, month, day) => Math.floor(Date.UTC(year, month - 1, day) / 1000);

// Tests for mint-nft task & underlying contract invariants

describe('Mint NFT Tests', function () {
  this.timeout(60_000);

  async function prepare(endorsed = true) {
    await hre.deployments.fixture(['Integrated']);
    const deepDeployment = await hre.deployments.get('DeepFamily');
    const deepFamily = await hre.ethers.getContractAt('DeepFamily', deepDeployment.address);
    const [signer] = await hre.ethers.getSigners();
    const FULLNAME = 'Mint Subject';
    const params = { fullname: FULLNAME, birthyear: '1999', gender: '1', tag: 'v1', ipfs: 'QmMint1' };
    await hre.run('add-person', params);

    const basicInfo = buildBasicInfo({
      fullName: FULLNAME,
      birthYear: 1999,
      birthMonth: 0,
      birthDay: 0,
      gender: 1,
    });
    const fullNameCommitment = basicInfo.fullNameCommitment;
    const personHash = await deepFamily.getPersonHash(basicInfo);
    const proofBundle = await generateNamePoseidonProof(FULLNAME, "", { minter: signer.address });
    const { proof, publicSignals } = proofBundle;
    if (endorsed) {
      await hre.run('endorse', { person: personHash, vindex: '1' });
    }
    return { deepFamily, personHash, FULLNAME, fullNameCommitment, basicInfo, proof, publicSignals };
  }

  async function prepareAgeCase({
    fullName = 'Age Gate Subject',
    birthYear = 0,
    birthMonth = 0,
    birthDay = 0,
    birthBC = false,
  }) {
    await hre.deployments.fixture(['Integrated']);
    const deepDeployment = await hre.deployments.get('DeepFamily');
    const deepFamily = await hre.ethers.getContractAt('DeepFamily', deepDeployment.address);
    const [signer] = await hre.ethers.getSigners();

    await hre.run('add-person', {
      fullname: fullName,
      birthyear: String(birthYear),
      birthmonth: String(birthMonth),
      birthday: String(birthDay),
      birthbc: birthBC ? 'true' : 'false',
      gender: '1',
      tag: 'v1',
      ipfs: 'QmAge',
    });

    const basicInfo = buildBasicInfo({
      fullName,
      isBirthBC: birthBC,
      birthYear,
      birthMonth,
      birthDay,
      gender: 1,
    });
    const personHash = await deepFamily.getPersonHash(basicInfo);
    const { proof, publicSignals } = await generateNamePoseidonProof(fullName, "", { minter: signer.address });
    await hre.run('endorse', { person: personHash, vindex: '1' });

    return { deepFamily, personHash, basicInfo, proof, publicSignals, fullName };
  }

  it('fails mint through task before endorsement (task layer error)', async () => {
    const { personHash } = await prepare(false);
    await expect(
      hre.run('mint-nft', {
        person: personHash,
        vindex: '1',
        tokenuri: 'ipfs://meta',
        fullname: 'Mint Subject',
        birthyear: '1999',
        gender: '1',
        birthplace: 'City',
        story: 'Story'
      })
    ).to.be.rejectedWith(/must endorse this version first/i);
  });

  it('mints NFT and sets mappings', async () => {
    const { deepFamily, personHash } = await prepare(true);
    await hre.run('mint-nft', {
      person: personHash,
      vindex: '1',
      tokenuri: 'ipfs://meta2',
      fullname: 'Mint Subject',
      birthyear: '1999',
      gender: '1',
      birthplace: 'City',
      story: 'Story'
    });
    const tokenCounter = await deepFamily.tokenCounter();
    expect(tokenCounter).to.equal(1n);
    const mappedPerson = await deepFamily.tokenIdToPerson(1n);
    expect(mappedPerson).to.equal(personHash);
    const versionIdx = await deepFamily.tokenIdToVersionIndex(1n);
    expect(versionIdx).to.equal(1n);
    const versionToken = await deepFamily.versionToTokenId(personHash, 1n);
    expect(versionToken).to.equal(1n);
  });

  it('prevents double mint of same version', async () => {
    const { deepFamily, personHash } = await prepare(true);
    const commonArgs = {
      person: personHash,
      vindex: '1',
      tokenuri: 'ipfs://meta',
      fullname: 'Mint Subject',
      birthyear: '1999',
      gender: '1',
      birthplace: 'City',
      story: 'Story'
    };
    await hre.run('mint-nft', commonArgs);
    await expect(hre.run('mint-nft', commonArgs)).to.be.rejectedWith(/VersionAlreadyMinted/);
  });

  it('rejects empty fullName in supplementInfo via direct contract call', async () => {
    const { deepFamily, personHash, basicInfo, proof, publicSignals } = await prepare(true);

    const coreInfo = {
      basicInfo: basicInfo,
      supplementInfo: {
        fullName: '', // Empty fullName should fail
        birthPlace: 'City',
        isDeathBC: false,
        deathYear: 0,
        deathMonth: 0,
        deathDay: 0,
        deathPlace: '',
        story: 'Story'
      }
    };

    await expect(
      deepFamily.mintPersonNFT(proof.a, proof.b, proof.c, publicSignals, personHash, 1, 'ipfs://meta', coreInfo)
    ).to.be.revertedWithCustomError(deepFamily, 'InvalidFullName');
  });

  it('rejects oversized fullName in supplementInfo via direct contract call', async () => {
    const { deepFamily, personHash, basicInfo, proof, publicSignals } = await prepare(true);

    const longName = 'A'.repeat(1001); // Exceeds MAX_LONG_TEXT_LENGTH
    const coreInfo = {
      basicInfo: basicInfo,
      supplementInfo: {
        fullName: longName,
        birthPlace: 'City',
        isDeathBC: false,
        deathYear: 0,
        deathMonth: 0,
        deathDay: 0,
        deathPlace: '',
        story: 'Story'
      }
    };

    await expect(
      deepFamily.mintPersonNFT(proof.a, proof.b, proof.c, publicSignals, personHash, 1, 'ipfs://meta', coreInfo)
    ).to.be.revertedWithCustomError(deepFamily, 'InvalidFullName');
  });

  it('rejects mismatched fullName and fullNameCommitment via direct contract call', async () => {
    const { deepFamily, personHash, basicInfo, proof, publicSignals } = await prepare(true);

    const coreInfo = {
      basicInfo: basicInfo,
      supplementInfo: {
        fullName: 'Different Name', // Doesn't match the hash in basicInfo
        birthPlace: 'City',
        isDeathBC: false,
        deathYear: 0,
        deathMonth: 0,
        deathDay: 0,
        deathPlace: '',
        story: 'Story'
      }
    };

    await expect(
      deepFamily.mintPersonNFT(proof.a, proof.b, proof.c, publicSignals, personHash, 1, 'ipfs://meta', coreInfo)
    ).to.be.revertedWithCustomError(deepFamily, 'BasicInfoMismatch');
  });

  it('accepts valid fullName that matches fullNameCommitment via direct contract call', async () => {
    const { deepFamily, personHash, FULLNAME, basicInfo, proof, publicSignals } = await prepare(true);

    const coreInfo = {
      basicInfo: basicInfo,
      supplementInfo: {
        fullName: FULLNAME, // Matches the hash in basicInfo
        birthPlace: 'City',
        isDeathBC: false,
        deathYear: 0,
        deathMonth: 0,
        deathDay: 0,
        deathPlace: '',
        story: 'Story'
      }
    };

    await expect(
      deepFamily.mintPersonNFT(proof.a, proof.b, proof.c, publicSignals, personHash, 1, 'ipfs://meta', coreInfo)
    ).to.not.be.reverted;

    // Verify the NFT was minted
    const tokenCounter = await deepFamily.tokenCounter();
    expect(tokenCounter).to.equal(1n);
  });

  it('reverts when proof minter does not match caller', async () => {
    const { deepFamily, personHash, FULLNAME, basicInfo } = await prepare(true);
    const [, otherSigner] = await hre.ethers.getSigners();
    const mismatchBundle = await generateNamePoseidonProof(FULLNAME, "", { minter: otherSigner.address });

    const coreInfo = {
      basicInfo,
      supplementInfo: {
        fullName: FULLNAME,
        birthPlace: 'City',
        isDeathBC: false,
        deathYear: 0,
        deathMonth: 0,
        deathDay: 0,
        deathPlace: '',
        story: 'Story'
      }
    };

    await expect(
      deepFamily.mintPersonNFT(
        mismatchBundle.proof.a,
        mismatchBundle.proof.b,
        mismatchBundle.proof.c,
        mismatchBundle.publicSignals,
        personHash,
        1,
        'ipfs://meta',
        coreInfo
      )
    ).to.be.revertedWithCustomError(deepFamily, 'CallerMismatch');
  });

  describe('Age gate', () => {
    function supplement(fullName) {
      return {
        fullName,
        birthPlace: 'City',
        isDeathBC: false,
        deathYear: 0,
        deathMonth: 0,
        deathDay: 0,
        deathPlace: '',
        story: 'Story',
      };
    }

    async function setNextBlockTimestamp(ts) {
      const { timestamp: latestTs } = await hre.ethers.provider.getBlock('latest');
      const next = Math.max(Number(latestTs) + 1, ts);
      await hre.network.provider.send('evm_setNextBlockTimestamp', [next]);
      await hre.network.provider.send('evm_mine');
      return next;
    }

    async function planMintDate() {
      const { timestamp: latestTs } = await hre.ethers.provider.getBlock('latest');
      const baseYear = new Date(latestTs * 1000).getUTCFullYear();
      const mintYear = baseYear + 1;
      const mintMonth = 6; // June
      const mintDay = 15;
      const mintTs = toTimestamp(mintYear, mintMonth, mintDay);
      return { mintYear, mintMonth, mintDay, mintTs };
    }

    it('reverts when age is 18 but birth month not reached', async () => {
      const { mintYear, mintMonth, mintDay, mintTs } = await planMintDate();
      const { deepFamily, personHash, basicInfo, proof, publicSignals, fullName } = await prepareAgeCase({
        birthYear: mintYear - 18,
        birthMonth: mintMonth + 1,
        birthDay: mintDay,
      });
      await setNextBlockTimestamp(mintTs);

      await expect(
        deepFamily.mintPersonNFT(
          proof.a,
          proof.b,
          proof.c,
          publicSignals,
          personHash,
          1,
          'ipfs://age-under',
          { basicInfo, supplementInfo: supplement(fullName) }
        )
      ).to.be.revertedWithCustomError(deepFamily, 'MustBeAdult');
    });

    it('reverts when age is exactly 18 but birthday day not reached', async () => {
      const { mintYear, mintMonth, mintDay, mintTs } = await planMintDate();
      const { deepFamily, personHash, basicInfo, proof, publicSignals, fullName } = await prepareAgeCase({
        birthYear: mintYear - 18,
        birthMonth: mintMonth,
        birthDay: mintDay + 5,
      });
      await setNextBlockTimestamp(mintTs);

      await expect(
        deepFamily.mintPersonNFT(
          proof.a,
          proof.b,
          proof.c,
          publicSignals,
          personHash,
          1,
          'ipfs://age-day',
          { basicInfo, supplementInfo: supplement(fullName) }
        )
      ).to.be.revertedWithCustomError(deepFamily, 'MustBeAdult');
    });

    it('allows mint when age is exactly 18 with birth day unknown in current month', async () => {
      const { mintYear, mintMonth, mintDay, mintTs } = await planMintDate();
      const { deepFamily, personHash, basicInfo, proof, publicSignals, fullName } = await prepareAgeCase({
        birthYear: mintYear - 18,
        birthMonth: mintMonth,
        birthDay: 0,
      });
      await setNextBlockTimestamp(mintTs);

      await expect(
        deepFamily.mintPersonNFT(
          proof.a,
          proof.b,
          proof.c,
          publicSignals,
          personHash,
          1,
          'ipfs://age-unknown-day',
          { basicInfo, supplementInfo: supplement(fullName) }
        )
      ).to.not.be.reverted;
    });

    it('allows mint when birth year is unknown (0)', async () => {
      const { mintTs } = await planMintDate();
      const { deepFamily, personHash, basicInfo, proof, publicSignals, fullName } = await prepareAgeCase({
        birthYear: 0,
        birthMonth: 0,
        birthDay: 0,
      });
      await setNextBlockTimestamp(mintTs);

      await expect(
        deepFamily.mintPersonNFT(
          proof.a,
          proof.b,
          proof.c,
          publicSignals,
          personHash,
          1,
          'ipfs://age-unknown-year',
          { basicInfo, supplementInfo: supplement(fullName) }
        )
      ).to.not.be.reverted;
    });
  });
});
