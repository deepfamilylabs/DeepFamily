const { expect } = require('chai');
const hre = require('hardhat');

// Tests for nameToPersonHashes indexing & pagination

describe('Name Query Tests', function () {
  this.timeout(60_000);

  async function addPerson(fullName, year, gender, tag) {
    await hre.run('add-person', { fullname: fullName, birthyear: String(year), gender: String(gender), tag, ipfs: 'QmCID' + tag });
  }

  it('indexes multiple persons with same name and paginates', async () => {
    await hre.deployments.fixture(['Integrated']);
    const deepDeployment = await hre.deployments.get('DeepFamily');
    const deepFamily = await hre.ethers.getContractAt('DeepFamily', deepDeployment.address);

    // Add 3 persons with same name but different birth years -> different personHash
    await addPerson('Same Name', 1990, 1, 'v1');
    await addPerson('Same Name', 1991, 1, 'v1');
    await addPerson('Same Name', 1992, 1, 'v1');

    // Query with limit 2
    const res1 = await deepFamily.listPersonHashesByFullName('Same Name', 0, 2);
    const hashes1 = res1[0];
    const total1 = res1[1];
    const hasMore1 = res1[2];
    const nextOffset1 = res1[3];
    expect(total1).to.equal(3n);
    expect(hashes1.length).to.equal(2);
    expect(hasMore1).to.equal(true);
    expect(nextOffset1).to.equal(2n);

    // Next page
    const res2 = await deepFamily.listPersonHashesByFullName('Same Name', Number(nextOffset1), 2);
    const hashes2 = res2[0];
    const hasMore2 = res2[2];
    const nextOffset2 = res2[3];
    expect(hashes2.length).to.equal(1);
    expect(hasMore2).to.equal(false);
    expect(nextOffset2).to.equal(3n);

    // limit=0 returns only totalCount
    const res3 = await deepFamily.listPersonHashesByFullName('Same Name', 0, 0);
    expect(res3[0].length).to.equal(0); // empty array
    expect(res3[1]).to.equal(3n);
  });
});
