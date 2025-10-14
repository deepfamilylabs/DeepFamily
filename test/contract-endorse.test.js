const { expect } = require('chai');
const hre = require('hardhat');
const { buildBasicInfo } = require('../lib/namePoseidon');
const { generateNamePoseidonProof } = require('../lib/namePoseidonProof');
const { generatePersonHashProof } = require('../lib/personHashProof');

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
    await hre.deployments.fixture(['Integrated']);
    const deepDeployment = await hre.deployments.get('DeepFamily');
    const tokenDeployment = await hre.deployments.get('DeepFamilyToken');
    const deepFamily = await hre.ethers.getContractAt('DeepFamily', deepDeployment.address);
    const token = await hre.ethers.getContractAt('DeepFamilyToken', tokenDeployment.address);
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
});
