import '../hardhat-test-setup.mjs'
import { expect } from 'chai'
import hre from 'hardhat'
import namePoseidon from '../lib/namePoseidon.js'
import namePoseidonProof from '../lib/namePoseidonProof.js'
import personHashProof from '../lib/personHashProof.js'
import { deployIntegratedFixture } from './fixtures/integrated.mjs'

const { buildBasicInfo } = namePoseidon
const { generateNamePoseidonProof } = namePoseidonProof
const { generatePersonHashProof } = personHashProof

const endorsementEventInterface = new hre.ethers.Interface([
  'event PersonVersionEndorsed(bytes32 indexed personHash, address indexed endorser, uint256 versionIndex, address recipient, uint256 recipientShare, address protocolRecipient, uint256 protocolShare, uint256 endorsementFee, uint256 timestamp)',
]);

function getEndorsementEventArgs(receipt, deepFamily) {
  const target = deepFamily.target.toLowerCase();
  for (const log of receipt.logs || []) {
    if ((log.address || '').toLowerCase() !== target) continue;
    try {
      const parsed = endorsementEventInterface.parseLog(log);
      if (parsed?.name === 'PersonVersionEndorsed') {
        return parsed.args;
      }
    } catch (_) {
      /* ignore non-matching logs */
    }
  }
  throw new Error('PersonVersionEndorsed event not found');
}

// Tests for endorsement logic

describe('Endorse Tests', function () {
  this.timeout(180_000);

  async function deployContracts() {
    const { deepFamily, token } = await hre.networkHelpers.loadFixture(deployIntegratedFixture)
    const signers = await hre.ethers.getSigners();
    return { deepFamily, token, signers };
  }

  async function createBasicPerson() {
    const { deepFamily, token, signers } = await deployContracts();
    const p = { fullname: 'Eva Sample', birthyear: '1985', gender: '2', tag: 'v1', ipfs: 'QmEva1' };
    await hre.run('add-person', p);
    const basicInfo = buildBasicInfo({
      fullName: p.fullname,
      birthYear: 1985,
      birthMonth: 0,
      birthDay: 0,
      gender: 2,
    });
    const personHash = await deepFamily.getPersonHash(basicInfo);
    return { deepFamily, token, signers, personHash };
  }

  async function createChildWithParents() {
    const { deepFamily, token, signers } = await deployContracts();
    const father = { fullname: 'Father Example', birthyear: '1960', gender: '1', tag: 'v1', ipfs: 'QmFather1' };
    const mother = { fullname: 'Mother Example', birthyear: '1962', gender: '2', tag: 'v1', ipfs: 'QmMother1' };
    const child = {
      fullname: 'Child Example',
      birthyear: '1990',
      gender: '1',
      fathername: father.fullname,
      fatherbirthyear: father.birthyear,
      fathergender: father.gender,
      mothername: mother.fullname,
      motherbirthyear: mother.birthyear,
      mothergender: mother.gender,
      fatherversion: '1',
      motherversion: '1',
      tag: 'v1',
      ipfs: 'QmChild1'
    };

    await hre.run('add-person', father);
    await hre.run('add-person', mother);
    await hre.run('add-person', child);

    const childInfo = buildBasicInfo({
      fullName: child.fullname,
      birthYear: Number(child.birthyear),
      birthMonth: 0,
      birthDay: 0,
      gender: Number(child.gender),
    });
    const personHash = await deepFamily.getPersonHash(childInfo);
    return {
      deepFamily,
      token,
      signers,
      personHash,
      childInfo,
      childName: child.fullname
    };
  }

  it('endorses version 1 and increments count', async () => {
    const { deepFamily, personHash } = await createBasicPerson();
    await hre.run('endorse', { person: personHash, vindex: '1' });
    // versionEndorsementCount stored at arrayIndex = versionIndex - 1
    const endorsementCount = await deepFamily.versionEndorsementCount(personHash, 0);
    expect(endorsementCount).to.equal(1n);
  });

  it('second endorsement of same version by the same account reverts', async () => {
    const { deepFamily, personHash } = await createBasicPerson();
    await hre.run('endorse', { person: personHash, vindex: '1' });
    await expect(
      deepFamily.endorseVersion(personHash, 1)
    ).to.be.revertedWithCustomError(deepFamily, 'AlreadyEndorsed');
    const endorsementCount = await deepFamily.versionEndorsementCount(personHash, 0);
    expect(endorsementCount).to.equal(1n);
  });

  it('transfers protocol share to contract owner when owner is set', async () => {
    const { deepFamily, token, signers, personHash } = await createChildWithParents();
    const [endorser, newOwner] = signers;
    const fee = await token.recentReward();
    expect(fee).to.be.gt(0n);

    await deepFamily.transferOwnership(newOwner.address);
    const tokenWithEndorser = token.connect(endorser);
    await tokenWithEndorser.approve(deepFamily.target, fee);

    const ownerBalanceBefore = await token.balanceOf(newOwner.address);
    const endorserBalanceBefore = await token.balanceOf(endorser.address);

    await expect(deepFamily.connect(endorser).endorseVersion(personHash, 1)).to.emit(
      deepFamily,
      'PersonVersionEndorsed'
    );

    const bps = await deepFamily.protocolEndorsementFeeBps();
    const protocolShare = (fee * bps) / 10_000n;

    const ownerBalanceAfter = await token.balanceOf(newOwner.address);
    const endorserBalanceAfter = await token.balanceOf(endorser.address);

    expect(ownerBalanceAfter).to.equal(ownerBalanceBefore + protocolShare);
    expect(endorserBalanceAfter).to.equal(endorserBalanceBefore - protocolShare);
  });

  it('pays addedBy recipient when different from endorser', async () => {
    const { deepFamily, token, signers } = await deployContracts();
    const [endorser, addedBy, protocolOwner] = signers;

    // Route protocol share away from the endorser to isolate net spending
    await deepFamily.transferOwnership(protocolOwner.address);

    // Seed a family so the protocol reward is non-zero and endorser owns tokens
    await hre.run('add-person', {
      fullname: 'Parent One',
      birthyear: '1950',
      gender: '1',
      tag: 'v1',
      ipfs: 'QmParent1'
    });
    await hre.run('add-person', {
      fullname: 'Parent Two',
      birthyear: '1952',
      gender: '2',
      tag: 'v1',
      ipfs: 'QmParent2'
    });
    await hre.run('add-person', {
      fullname: 'Child Seed',
      birthyear: '1980',
      gender: '1',
      fathername: 'Parent One',
      fatherbirthyear: '1950',
      fathergender: '1',
      mothername: 'Parent Two',
      motherbirthyear: '1952',
      mothergender: '2',
      fatherversion: '1',
      motherversion: '1',
      tag: 'v1',
      ipfs: 'QmChildSeed'
    });

    const reward = await token.recentReward();
    expect(reward).to.be.gt(0n);

    // Added-by account creates a new person directly via ZK call
    const personData = {
      fullName: 'Endorse Target',
      passphrase: '',
      isBirthBC: false,
      birthYear: 1995,
      birthMonth: 0,
      birthDay: 0,
      gender: 2,
    };

    const { proof, publicSignals } = await generatePersonHashProof(
      personData,
      null,
      null,
      addedBy.address,
    );

    await deepFamily
      .connect(addedBy)
      .addPersonZK(
        proof.a,
        proof.b,
        proof.c,
        publicSignals,
        0,
        0,
        'v1',
        'QmTarget'
      );

    const basicInfo = buildBasicInfo({
      fullName: personData.fullName,
      birthYear: personData.birthYear,
      birthMonth: personData.birthMonth,
      birthDay: personData.birthDay,
      gender: personData.gender,
    });
    const personHash = await deepFamily.getPersonHash(basicInfo);

    const fee = await token.recentReward();
    expect(fee).to.equal(reward); // unchanged after add

    await token.connect(endorser).approve(deepFamily.target, fee);

    const addedByBalanceBefore = await token.balanceOf(addedBy.address);
    const endorserBalanceBefore = await token.balanceOf(endorser.address);
    const ownerBalanceBefore = await token.balanceOf(protocolOwner.address);

    const tx = await deepFamily.connect(endorser).endorseVersion(personHash, 1);
    const receipt = await tx.wait();
    const eventArgs = getEndorsementEventArgs(receipt, deepFamily);
    const feeUsed = BigInt(eventArgs.endorsementFee);
    const recipientShare = BigInt(eventArgs.recipientShare);
    const protocolShare = BigInt(eventArgs.protocolShare);

    expect(eventArgs.recipient).to.equal(addedBy.address);
    expect(eventArgs.protocolRecipient).to.equal(protocolOwner.address);
    expect(recipientShare + protocolShare).to.equal(feeUsed);

    const addedByBalanceAfter = await token.balanceOf(addedBy.address);
    const endorserBalanceAfter = await token.balanceOf(endorser.address);
    const ownerBalanceAfter = await token.balanceOf(protocolOwner.address);

    expect(addedByBalanceAfter - addedByBalanceBefore).to.equal(recipientShare);
    expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(protocolShare);
    expect(endorserBalanceBefore - endorserBalanceAfter).to.equal(feeUsed);
  });

  it('burns protocol share when owner is zero address', async () => {
    const { deepFamily, token, signers, personHash } = await createChildWithParents();
    const [endorser] = signers;
    const fee = await token.recentReward();
    expect(fee).to.be.gt(0n);

    const tokenWithEndorser = token.connect(endorser);
    await tokenWithEndorser.approve(deepFamily.target, fee);

    await deepFamily.renounceOwnership();
    const supplyBefore = await token.totalSupply();
    const endorserBalanceBefore = await token.balanceOf(endorser.address);
    const bps = await deepFamily.protocolEndorsementFeeBps();
    const protocolShare = (fee * bps) / 10_000n;

    await expect(deepFamily.connect(endorser).endorseVersion(personHash, 1)).to.emit(
      deepFamily,
      'PersonVersionEndorsed'
    );

    const supplyAfter = await token.totalSupply();
    const endorserBalanceAfter = await token.balanceOf(endorser.address);

    expect(supplyAfter).to.equal(supplyBefore - protocolShare);
    expect(endorserBalanceAfter).to.equal(endorserBalanceBefore - protocolShare);
  });

  it('routes recipient share to NFT holder when version has been minted', async () => {
    const { deepFamily, token, signers, personHash, childInfo, childName } = await createChildWithParents();
    const [endorser, nftHolder] = signers;
    expect(await token.recentReward()).to.be.gt(0n);

    // Mint a second child to refresh recentReward and give the endorser extra balance
    await hre.run('add-person', {
      fullname: 'Bonus Child',
      birthyear: '1992',
      gender: '2',
      fathername: 'Father Example',
      fatherbirthyear: '1960',
      fathergender: '1',
      mothername: 'Mother Example',
      motherbirthyear: '1962',
      mothergender: '2',
      fatherversion: '1',
      motherversion: '1',
      tag: 'v2',
      ipfs: 'QmBonus'
    });
    const fee = await token.recentReward();
    expect(fee).to.be.gt(0n);

    // Fund the future NFT holder so they can endorse and mint
    await token.connect(endorser).transfer(nftHolder.address, fee);
    await token.connect(nftHolder).approve(deepFamily.target, fee);
    await deepFamily.connect(nftHolder).endorseVersion(personHash, 1);

    const proofBundle = await generateNamePoseidonProof(childName, "", { minter: nftHolder.address });
    const coreInfo = {
      basicInfo: childInfo,
      supplementInfo: {
        fullName: childName,
        birthPlace: 'City',
        isDeathBC: false,
        deathYear: 0,
        deathMonth: 0,
        deathDay: 0,
        deathPlace: '',
        story: 'Story'
      }
    };

    await deepFamily
      .connect(nftHolder)
      .mintPersonNFT(
        proofBundle.proof.a,
        proofBundle.proof.b,
        proofBundle.proof.c,
        proofBundle.publicSignals,
        personHash,
        1,
        'ipfs://child',
        coreInfo
      );

    const tokenWithEndorser = token.connect(endorser);
    await tokenWithEndorser.approve(deepFamily.target, fee);

    const holderBalanceBefore = await token.balanceOf(nftHolder.address);

    const tx = await deepFamily.connect(endorser).endorseVersion(personHash, 1);
    const receipt = await tx.wait();
    const eventArgs = getEndorsementEventArgs(receipt, deepFamily);
    const feeUsed = BigInt(eventArgs.endorsementFee);
    const recipientShare = BigInt(eventArgs.recipientShare);
    const protocolShare = BigInt(eventArgs.protocolShare);

    expect(eventArgs.recipient).to.equal(nftHolder.address);
    expect(eventArgs.protocolRecipient).to.equal(await deepFamily.owner());
    expect(recipientShare + protocolShare).to.equal(feeUsed);

    const holderBalanceAfter = await token.balanceOf(nftHolder.address);

    expect(holderBalanceAfter).to.equal(holderBalanceBefore + recipientShare);
  });

  it('reverts when allowance is insufficient', async () => {
    const { deepFamily, token, signers, personHash } = await createChildWithParents();
    const [endorser] = signers;
    const fee = await token.recentReward();
    expect(fee).to.be.gt(0n);

    await token.connect(endorser).approve(deepFamily.target, fee - 1n);
    await expect(
      deepFamily.connect(endorser).endorseVersion(personHash, 1)
    ).to.be.revertedWithCustomError(token, 'ERC20InsufficientAllowance');
  });

  it('updates endorsement counts when switching versions', async () => {
    const { deepFamily, personHash } = await createBasicPerson();
    // Add a second version for the same person
    await hre.run('add-person', {
      fullname: 'Eva Sample',
      birthyear: '1985',
      gender: '2',
      tag: 'v2',
      ipfs: 'QmEva2'
    });

    const [endorser] = await hre.ethers.getSigners();
    await deepFamily.connect(endorser).endorseVersion(personHash, 1);
    let countV1 = await deepFamily.versionEndorsementCount(personHash, 0);
    let countV2 = await deepFamily.versionEndorsementCount(personHash, 1);
    expect(countV1).to.equal(1n);
    expect(countV2).to.equal(0n);

    await deepFamily.connect(endorser).endorseVersion(personHash, 2);
    countV1 = await deepFamily.versionEndorsementCount(personHash, 0);
    countV2 = await deepFamily.versionEndorsementCount(personHash, 1);
    expect(countV1).to.equal(0n);
    expect(countV2).to.equal(1n);
  });

  describe('listUserEndorsements', () => {
    it('returns empty list when user has no endorsements', async () => {
      const { deepFamily, signers } = await deployContracts();
      const [user] = signers;

      const result = await deepFamily.listUserEndorsements(user.address, 0, 10);

      expect(result.personHashes).to.have.lengthOf(0);
      expect(result.versionIndices).to.have.lengthOf(0);
      expect(result.endorsementCounts).to.have.lengthOf(0);
      expect(result.tokenIds).to.have.lengthOf(0);
      expect(result.totalCount).to.equal(0n);
      expect(result.hasMore).to.be.false;
      expect(result.nextOffset).to.equal(0n);
    });

    it('returns single endorsement after user endorses one person', async () => {
      const { deepFamily, personHash } = await createBasicPerson();
      const [endorser] = await hre.ethers.getSigners();

      await deepFamily.connect(endorser).endorseVersion(personHash, 1);

      const result = await deepFamily.listUserEndorsements(endorser.address, 0, 10);

      expect(result.personHashes).to.have.lengthOf(1);
      expect(result.personHashes[0]).to.equal(personHash);
      expect(result.versionIndices[0]).to.equal(1n);
      expect(result.endorsementCounts[0]).to.equal(1n);
      expect(result.tokenIds[0]).to.equal(0n); // Not minted yet
      expect(result.totalCount).to.equal(1n);
      expect(result.hasMore).to.be.false;
    });

    it('returns multiple endorsements when user endorses different persons', async () => {
      const { deepFamily } = await deployContracts();
      const [endorser] = await hre.ethers.getSigners();

      // Create three different persons
      const person1 = { fullname: 'Alice Test', birthyear: '1980', gender: '2', tag: 'v1', ipfs: 'QmAlice' };
      const person2 = { fullname: 'Bob Test', birthyear: '1985', gender: '1', tag: 'v1', ipfs: 'QmBob' };
      const person3 = { fullname: 'Carol Test', birthyear: '1990', gender: '2', tag: 'v1', ipfs: 'QmCarol' };

      await hre.run('add-person', person1);
      await hre.run('add-person', person2);
      await hre.run('add-person', person3);

      const hash1 = await deepFamily.getPersonHash(buildBasicInfo({
        fullName: person1.fullname,
        birthYear: Number(person1.birthyear),
        birthMonth: 0,
        birthDay: 0,
        gender: Number(person1.gender),
      }));

      const hash2 = await deepFamily.getPersonHash(buildBasicInfo({
        fullName: person2.fullname,
        birthYear: Number(person2.birthyear),
        birthMonth: 0,
        birthDay: 0,
        gender: Number(person2.gender),
      }));

      const hash3 = await deepFamily.getPersonHash(buildBasicInfo({
        fullName: person3.fullname,
        birthYear: Number(person3.birthyear),
        birthMonth: 0,
        birthDay: 0,
        gender: Number(person3.gender),
      }));

      await deepFamily.connect(endorser).endorseVersion(hash1, 1);
      await deepFamily.connect(endorser).endorseVersion(hash2, 1);
      await deepFamily.connect(endorser).endorseVersion(hash3, 1);

      const result = await deepFamily.listUserEndorsements(endorser.address, 0, 10);

      expect(result.personHashes).to.have.lengthOf(3);
      expect(result.personHashes[0]).to.equal(hash1);
      expect(result.personHashes[1]).to.equal(hash2);
      expect(result.personHashes[2]).to.equal(hash3);
      expect(result.versionIndices[0]).to.equal(1n);
      expect(result.versionIndices[1]).to.equal(1n);
      expect(result.versionIndices[2]).to.equal(1n);
      expect(result.totalCount).to.equal(3n);
      expect(result.hasMore).to.be.false;
    });

    it('reflects version change when user switches endorsement', async () => {
      const { deepFamily, personHash } = await createBasicPerson();
      const [endorser] = await hre.ethers.getSigners();

      // Add second version
      await hre.run('add-person', {
        fullname: 'Eva Sample',
        birthyear: '1985',
        gender: '2',
        tag: 'v2',
        ipfs: 'QmEva2'
      });

      // First endorse version 1
      await deepFamily.connect(endorser).endorseVersion(personHash, 1);
      let result = await deepFamily.listUserEndorsements(endorser.address, 0, 10);
      expect(result.personHashes).to.have.lengthOf(1);
      expect(result.versionIndices[0]).to.equal(1n);

      // Switch to version 2
      await deepFamily.connect(endorser).endorseVersion(personHash, 2);
      result = await deepFamily.listUserEndorsements(endorser.address, 0, 10);
      expect(result.personHashes).to.have.lengthOf(1);
      expect(result.versionIndices[0]).to.equal(2n); // Changed to version 2
      expect(result.personHashes[0]).to.equal(personHash); // Same person
    });

    it('supports pagination correctly', async () => {
      const { deepFamily } = await deployContracts();
      const [endorser] = await hre.ethers.getSigners();

      // Create 5 persons
      const persons = [];
      for (let i = 0; i < 5; i++) {
        const person = {
          fullname: `Person ${i}`,
          birthyear: String(1980 + i),
          gender: String((i % 2) + 1),
          tag: 'v1',
          ipfs: `QmPerson${i}`
        };
        await hre.run('add-person', person);
        const hash = await deepFamily.getPersonHash(buildBasicInfo({
          fullName: person.fullname,
          birthYear: Number(person.birthyear),
          birthMonth: 0,
          birthDay: 0,
          gender: Number(person.gender),
        }));
        persons.push(hash);
        await deepFamily.connect(endorser).endorseVersion(hash, 1);
      }

      // First page: offset=0, limit=2
      let result = await deepFamily.listUserEndorsements(endorser.address, 0, 2);
      expect(result.personHashes).to.have.lengthOf(2);
      expect(result.personHashes[0]).to.equal(persons[0]);
      expect(result.personHashes[1]).to.equal(persons[1]);
      expect(result.totalCount).to.equal(5n);
      expect(result.hasMore).to.be.true;
      expect(result.nextOffset).to.equal(2n);

      // Second page: offset=2, limit=2
      result = await deepFamily.listUserEndorsements(endorser.address, 2, 2);
      expect(result.personHashes).to.have.lengthOf(2);
      expect(result.personHashes[0]).to.equal(persons[2]);
      expect(result.personHashes[1]).to.equal(persons[3]);
      expect(result.totalCount).to.equal(5n);
      expect(result.hasMore).to.be.true;
      expect(result.nextOffset).to.equal(4n);

      // Last page: offset=4, limit=2
      result = await deepFamily.listUserEndorsements(endorser.address, 4, 2);
      expect(result.personHashes).to.have.lengthOf(1);
      expect(result.personHashes[0]).to.equal(persons[4]);
      expect(result.totalCount).to.equal(5n);
      expect(result.hasMore).to.be.false;
      expect(result.nextOffset).to.equal(5n);
    });

    it('includes NFT tokenId when version has been minted', async () => {
      const { deepFamily, token, signers, personHash, childInfo, childName } = await createChildWithParents();
      const [endorser, minter] = signers;
      const fee = await token.recentReward();

      // Fund minter and let them endorse and mint
      await token.connect(endorser).transfer(minter.address, fee);
      await token.connect(minter).approve(deepFamily.target, fee);
      await deepFamily.connect(minter).endorseVersion(personHash, 1);

      const proofBundle = await generateNamePoseidonProof(childName, "", { minter: minter.address });
      const coreInfo = {
        basicInfo: childInfo,
        supplementInfo: {
          fullName: childName,
          birthPlace: 'City',
          isDeathBC: false,
          deathYear: 0,
          deathMonth: 0,
          deathDay: 0,
          deathPlace: '',
          story: 'Story'
        }
      };

      await deepFamily
        .connect(minter)
        .mintPersonNFT(
          proofBundle.proof.a,
          proofBundle.proof.b,
          proofBundle.proof.c,
          proofBundle.publicSignals,
          personHash,
          1,
          'ipfs://child',
          coreInfo
        );

      const result = await deepFamily.listUserEndorsements(minter.address, 0, 10);

      expect(result.personHashes).to.have.lengthOf(1);
      expect(result.tokenIds[0]).to.equal(1n); // NFT minted with tokenId 1
    });
  });

  describe('cancelEndorsement', () => {
    it('reverts when trying to cancel non-existent endorsement', async () => {
      const { deepFamily, personHash } = await createBasicPerson();
      const [user] = await hre.ethers.getSigners();

      await expect(
        deepFamily.connect(user).cancelEndorsement(personHash)
      ).to.be.revertedWithCustomError(deepFamily, 'NotEndorsed');
    });

    it('successfully cancels endorsement and decrements count', async () => {
      const { deepFamily, personHash } = await createBasicPerson();
      const [endorser] = await hre.ethers.getSigners();

      // First endorse
      await deepFamily.connect(endorser).endorseVersion(personHash, 1);

      let count = await deepFamily.versionEndorsementCount(personHash, 0);
      expect(count).to.equal(1n);

      // Cancel endorsement
      await expect(
        deepFamily.connect(endorser).cancelEndorsement(personHash)
      ).to.emit(deepFamily, 'EndorsementCancelled');

      // Verify count decremented
      count = await deepFamily.versionEndorsementCount(personHash, 0);
      expect(count).to.equal(0n);

      // Verify endorsement cleared
      const endorsedVersion = await deepFamily.endorsedVersionIndex(personHash, endorser.address);
      expect(endorsedVersion).to.equal(0n);
    });

    it('removes person from user endorsed list', async () => {
      const { deepFamily, personHash } = await createBasicPerson();
      const [endorser] = await hre.ethers.getSigners();

      await deepFamily.connect(endorser).endorseVersion(personHash, 1);

      let result = await deepFamily.listUserEndorsements(endorser.address, 0, 10);
      expect(result.personHashes).to.have.lengthOf(1);
      expect(result.personHashes[0]).to.equal(personHash);

      // Cancel endorsement
      await deepFamily.connect(endorser).cancelEndorsement(personHash);

      // Verify removed from list
      result = await deepFamily.listUserEndorsements(endorser.address, 0, 10);
      expect(result.personHashes).to.have.lengthOf(0);
      expect(result.totalCount).to.equal(0n);
    });

    it('allows re-endorsing the same version after cancellation', async () => {
      const { deepFamily, personHash } = await createBasicPerson();
      const [endorser] = await hre.ethers.getSigners();

      // Initial endorsement
      await deepFamily.connect(endorser).endorseVersion(personHash, 1);

      // Cancel
      await deepFamily.connect(endorser).cancelEndorsement(personHash);

      // Re-endorse the same version
      await deepFamily.connect(endorser).endorseVersion(personHash, 1);

      const endorsedVersion = await deepFamily.endorsedVersionIndex(personHash, endorser.address);
      expect(endorsedVersion).to.equal(1n);

      const count = await deepFamily.versionEndorsementCount(personHash, 0);
      expect(count).to.equal(1n);
    });

    it('correctly handles swap-and-pop when cancelling from middle of list', async () => {
      const { deepFamily } = await deployContracts();
      const [endorser] = await hre.ethers.getSigners();

      // Create and endorse 3 different persons
      const person1 = { fullname: 'Person A', birthyear: '1980', gender: '1', tag: 'v1', ipfs: 'QmA' };
      const person2 = { fullname: 'Person B', birthyear: '1985', gender: '2', tag: 'v1', ipfs: 'QmB' };
      const person3 = { fullname: 'Person C', birthyear: '1990', gender: '1', tag: 'v1', ipfs: 'QmC' };

      await hre.run('add-person', person1);
      await hre.run('add-person', person2);
      await hre.run('add-person', person3);

      const hash1 = await deepFamily.getPersonHash(buildBasicInfo({
        fullName: person1.fullname,
        birthYear: Number(person1.birthyear),
        birthMonth: 0,
        birthDay: 0,
        gender: Number(person1.gender),
      }));

      const hash2 = await deepFamily.getPersonHash(buildBasicInfo({
        fullName: person2.fullname,
        birthYear: Number(person2.birthyear),
        birthMonth: 0,
        birthDay: 0,
        gender: Number(person2.gender),
      }));

      const hash3 = await deepFamily.getPersonHash(buildBasicInfo({
        fullName: person3.fullname,
        birthYear: Number(person3.birthyear),
        birthMonth: 0,
        birthDay: 0,
        gender: Number(person3.gender),
      }));

      await deepFamily.connect(endorser).endorseVersion(hash1, 1);
      await deepFamily.connect(endorser).endorseVersion(hash2, 1);
      await deepFamily.connect(endorser).endorseVersion(hash3, 1);

      // Verify all three in list
      let result = await deepFamily.listUserEndorsements(endorser.address, 0, 10);
      expect(result.personHashes).to.have.lengthOf(3);

      // Cancel the middle one (hash2)
      await deepFamily.connect(endorser).cancelEndorsement(hash2);

      // Verify only 2 remain
      result = await deepFamily.listUserEndorsements(endorser.address, 0, 10);
      expect(result.personHashes).to.have.lengthOf(2);
      expect(result.totalCount).to.equal(2n);

      // The list should still contain hash1 and hash3 (order may change due to swap-and-pop)
      const hashes = result.personHashes;
      expect(hashes).to.include(hash1);
      expect(hashes).to.include(hash3);
      expect(hashes).to.not.include(hash2);
    });

    it('allows cancellation even after minting NFT', async () => {
      const { deepFamily, token, signers, personHash, childInfo, childName } = await createChildWithParents();
      const [endorser, minter] = signers;
      const fee = await token.recentReward();

      // Fund minter and let them endorse and mint
      await token.connect(endorser).transfer(minter.address, fee);
      await token.connect(minter).approve(deepFamily.target, fee);
      await deepFamily.connect(minter).endorseVersion(personHash, 1);

      const proofBundle = await generateNamePoseidonProof(childName, "", { minter: minter.address });
      const coreInfo = {
        basicInfo: childInfo,
        supplementInfo: {
          fullName: childName,
          birthPlace: 'City',
          isDeathBC: false,
          deathYear: 0,
          deathMonth: 0,
          deathDay: 0,
          deathPlace: '',
          story: 'Story'
        }
      };

      await deepFamily
        .connect(minter)
        .mintPersonNFT(
          proofBundle.proof.a,
          proofBundle.proof.b,
          proofBundle.proof.c,
          proofBundle.publicSignals,
          personHash,
          1,
          'ipfs://child',
          coreInfo
        );

      // NFT minted, now try to cancel endorsement
      await deepFamily.connect(minter).cancelEndorsement(personHash);

      // Verify endorsement was cancelled
      const endorsedVersion = await deepFamily.endorsedVersionIndex(personHash, minter.address);
      expect(endorsedVersion).to.equal(0n);

      // NFT should still exist
      const tokenId = await deepFamily.versionToTokenId(personHash, 1);
      expect(tokenId).to.equal(1n);
      const owner = await deepFamily.ownerOf(tokenId);
      expect(owner).to.equal(minter.address);
    });

    it('emits EndorsementCancelled event with correct parameters', async () => {
      const { deepFamily, personHash } = await createBasicPerson();
      const [endorser] = await hre.ethers.getSigners();

      await deepFamily.connect(endorser).endorseVersion(personHash, 1);

      const tx = await deepFamily.connect(endorser).cancelEndorsement(personHash);
      const receipt = await tx.wait();

      // Find EndorsementCancelled event
      const event = receipt.logs.find(log => {
        try {
          const parsed = deepFamily.interface.parseLog(log);
          return parsed?.name === 'EndorsementCancelled';
        } catch (_) {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
      const parsed = deepFamily.interface.parseLog(event);
      expect(parsed.args.personHash).to.equal(personHash);
      expect(parsed.args.user).to.equal(endorser.address);
      expect(parsed.args.versionIndex).to.equal(1n);
    });
  });
});
