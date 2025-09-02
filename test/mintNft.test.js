const { expect } = require('chai');
const hre = require('hardhat');

// Tests for mint-nft task & underlying contract invariants

describe('Mint NFT Tests', function () {
  this.timeout(60_000);

  async function prepare(endorsed = true) {
    await hre.deployments.fixture(['Integrated']);
    const deepDeployment = await hre.deployments.get('DeepFamily');
    const deepFamily = await hre.ethers.getContractAt('DeepFamily', deepDeployment.address);
    const FULLNAME = 'Mint Subject';
    const params = { fullname: FULLNAME, birthyear: '1999', gender: '1', tag: 'v1', ipfs: 'QmMint1' };
    await hre.run('add-person', params);
    const basicInfo = { fullName: FULLNAME, isBirthBC: false, birthYear: 1999, birthMonth: 0, birthDay: 0, gender: 1 };
    const personHash = await deepFamily.getPersonHash(basicInfo);
    if (endorsed) {
      await hre.run('endorse', { person: personHash, vindex: '1' });
    }
    return { deepFamily, personHash, FULLNAME };
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
    const versionToken = await deepFamily.versionToTokenId(personHash, 0); // array index 0
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
});
