import '../hardhat-test-setup.mjs'
import { expect } from 'chai'
import hre from 'hardhat'
import { deployIntegratedFixture } from './fixtures/integrated.mjs'
import {
  setupStubVerifiers,
  addPerson,
  computeDisclosureBinding,
  computeProfileIdentityCommitment,
  makeStubProof,
  makeTestPerson,
  makeEndorseAttestationRef,
  makeMintAttestationRef,
} from './helpers/testHelper.mjs'

const endorsementEventInterface = new hre.ethers.Interface([
  'event PersonVersionEndorsed(bytes32 indexed personHash, address indexed endorser, uint256 versionIndex, address recipient, uint256 recipientShare, address protocolRecipient, uint256 protocolShare, uint256 endorsementFee, uint256 timestamp)',
])
const commitmentOf = (person) => computeProfileIdentityCommitment(hre.ethers, person)

function getEndorsementEventArgs(receipt, deepFamily) {
  const target = deepFamily.target.toLowerCase()
  for (const log of receipt.logs || []) {
    if ((log.address || '').toLowerCase() !== target) continue
    try {
      const parsed = endorsementEventInterface.parseLog(log)
      if (parsed?.name === 'PersonVersionEndorsed') return parsed.args
    } catch (_) {}
  }
  throw new Error('PersonVersionEndorsed event not found')
}

async function endorseVersion(deepFamily, signer, personHash, versionIndex = 1) {
  return deepFamily.connect(signer).endorseVersion(
    personHash,
    versionIndex,
    await makeEndorseAttestationRef(hre.ethers, deepFamily, signer, personHash, versionIndex),
  )
}

async function mintPersonVersionNFT(deepFamily, signer, personHash, proof, ps, versionIndex, tokenURI, coreInfo) {
  return deepFamily.connect(signer).mintPersonVersionNFT(
    proof,
    ps,
    versionIndex,
    tokenURI,
    coreInfo,
    await makeMintAttestationRef(hre.ethers, deepFamily, signer, personHash, versionIndex, tokenURI, coreInfo),
  )
}

describe('Endorse Tests', function () {
  this.timeout(180_000)

  async function deployContracts() {
    const { deepFamily, deepFamilyReader, token } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture)
    const signers = await hre.ethers.getSigners()
    await setupStubVerifiers(hre.ethers, deepFamily)
    return { deepFamily, reader: deepFamilyReader, token, signers }
  }

  async function createBasicPerson() {
    const { deepFamily, reader, token, signers } = await deployContracts()
    const person = makeTestPerson('Basic Endorse Person')
    const commitment = commitmentOf(person)
    const personHash = await addPerson(hre.ethers, deepFamily, signers[0], commitment, { person, tag: 'v1' })
    return { deepFamily, reader, token, signers, personHash, commitment, person }
  }

  async function createChildWithParents() {
    const { deepFamily, token, signers } = await deployContracts()
    const signer = signers[0]

    const fatherPerson = makeTestPerson('Endorse Father', { birthYear: 1970 })
    const motherPerson = makeTestPerson('Endorse Mother', { birthYear: 1972, gender: 2 })
    const childPerson = makeTestPerson('Endorse Child', { birthYear: 2000 })
    const fatherCommitment = commitmentOf(fatherPerson)
    const motherCommitment = commitmentOf(motherPerson)
    const childCommitment = commitmentOf(childPerson)

    await addPerson(hre.ethers, deepFamily, signer, fatherCommitment, { person: fatherPerson, tag: 'father' })
    await addPerson(hre.ethers, deepFamily, signer, motherCommitment, { person: motherPerson, tag: 'mother' })

    const personHash = await addPerson(hre.ethers, deepFamily, signer, childCommitment, {
      person: childPerson,
      fatherPerson,
      motherPerson,
      fatherIdentityCommitment: fatherCommitment,
      motherIdentityCommitment: motherCommitment,
      fatherVersionIndex: 1,
      motherVersionIndex: 1,
      tag: 'child',
    })

    return { deepFamily, token, signers, personHash, childCommitment, childName: 'Child Example' }
  }

  it('endorses version 1 and increments count', async () => {
    const { deepFamily, signers, personHash } = await createBasicPerson()
    await endorseVersion(deepFamily, signers[0], personHash, 1)
    const endorsementCount = await deepFamily.versionEndorsementCount(personHash, 0)
    expect(endorsementCount).to.equal(1n)
  })

  it('second endorsement of same version by the same account reverts', async () => {
    const { deepFamily, signers, personHash } = await createBasicPerson()
    await endorseVersion(deepFamily, signers[0], personHash, 1)
    await expect(
      endorseVersion(deepFamily, signers[0], personHash, 1)
    ).to.be.revertedWithCustomError(deepFamily, 'AlreadyEndorsed')
    const endorsementCount = await deepFamily.versionEndorsementCount(personHash, 0)
    expect(endorsementCount).to.equal(1n)
  })

  it('transfers protocol share to contract owner when owner is set', async () => {
    const { deepFamily, token, signers, personHash } = await createChildWithParents()
    const [endorser, newOwner] = signers
    const fee = await token.recentReward()
    expect(fee).to.be.gt(0n)

    await deepFamily.transferOwnership(newOwner.address)
    await token.connect(endorser).approve(deepFamily.target, fee)

    const ownerBalanceBefore = await token.balanceOf(newOwner.address)

    await expect(endorseVersion(deepFamily, endorser, personHash, 1)).to.emit(
      deepFamily,
      'PersonVersionEndorsed'
    )

    const bps = await deepFamily.protocolEndorsementFeeBps()
    const protocolShare = (fee * bps) / 10_000n

    const ownerBalanceAfter = await token.balanceOf(newOwner.address)
    expect(ownerBalanceAfter).to.equal(ownerBalanceBefore + protocolShare)
  })

  it('pays addedBy recipient when different from endorser', async () => {
    const { deepFamily, token, signers } = await deployContracts()
    const [endorser, addedBy, protocolOwner] = signers

    await deepFamily.transferOwnership(protocolOwner.address)

    const fatherPerson = makeTestPerson('Payout Father', { birthYear: 1970 })
    const motherPerson = makeTestPerson('Payout Mother', { birthYear: 1972, gender: 2 })
    const childPerson = makeTestPerson('Payout Child', { birthYear: 2001 })
    const fatherCommitment = commitmentOf(fatherPerson)
    const motherCommitment = commitmentOf(motherPerson)
    const childCommitment = commitmentOf(childPerson)

    await addPerson(hre.ethers, deepFamily, endorser, fatherCommitment, { person: fatherPerson, tag: 'father' })
    await addPerson(hre.ethers, deepFamily, endorser, motherCommitment, { person: motherPerson, tag: 'mother' })
    await addPerson(hre.ethers, deepFamily, endorser, childCommitment, {
      person: childPerson,
      fatherPerson,
      motherPerson,
      fatherIdentityCommitment: fatherCommitment,
      motherIdentityCommitment: motherCommitment,
      fatherVersionIndex: 1,
      motherVersionIndex: 1,
      tag: 'child',
    })

    const reward = await token.recentReward()
    expect(reward).to.be.gt(0n)

    const targetPerson = makeTestPerson('Payout Target')
    const targetCommitment = commitmentOf(targetPerson)
    const targetHash = await addPerson(hre.ethers, deepFamily, addedBy, targetCommitment, { person: targetPerson, tag: 'target' })

    const fee = await token.recentReward()
    await token.connect(endorser).approve(deepFamily.target, fee)

    const addedByBalanceBefore = await token.balanceOf(addedBy.address)

    const tx = await endorseVersion(deepFamily, endorser, targetHash, 1)
    const receipt = await tx.wait()
    const eventArgs = getEndorsementEventArgs(receipt, deepFamily)

    expect(eventArgs.recipient).to.equal(addedBy.address)
    const addedByBalanceAfter = await token.balanceOf(addedBy.address)
    expect(addedByBalanceAfter - addedByBalanceBefore).to.equal(BigInt(eventArgs.recipientShare))
  })

  it('burns protocol share when owner is zero address', async () => {
    const { deepFamily, token, signers, personHash } = await createChildWithParents()
    const [endorser] = signers
    const fee = await token.recentReward()
    expect(fee).to.be.gt(0n)

    await token.connect(endorser).approve(deepFamily.target, fee)
    await deepFamily.renounceOwnership()
    const supplyBefore = await token.totalSupply()
    const bps = await deepFamily.protocolEndorsementFeeBps()
    const protocolShare = (fee * bps) / 10_000n

    await expect(endorseVersion(deepFamily, endorser, personHash, 1)).to.emit(
      deepFamily,
      'PersonVersionEndorsed'
    )

    const supplyAfter = await token.totalSupply()
    expect(supplyAfter).to.equal(supplyBefore - protocolShare)
  })

  it('routes recipient share to NFT holder when version has been minted', async () => {
    const { deepFamily, token, signers } = await deployContracts()
    const [endorser, nftHolder] = signers

    const fatherPerson = makeTestPerson('Holder Father', { birthYear: 1970 })
    const motherPerson = makeTestPerson('Holder Mother', { birthYear: 1972, gender: 2 })
    const childPerson = makeTestPerson('Child For Holder', { birthYear: 1999 })
    const fC = commitmentOf(fatherPerson)
    const mC = commitmentOf(motherPerson)
    const cC = commitmentOf(childPerson)

    await addPerson(hre.ethers, deepFamily, endorser, fC, { person: fatherPerson, tag: 'father' })
    await addPerson(hre.ethers, deepFamily, endorser, mC, { person: motherPerson, tag: 'mother' })
    const personHash = await addPerson(hre.ethers, deepFamily, endorser, cC, {
      person: childPerson,
      fatherPerson,
      motherPerson,
      fatherIdentityCommitment: fC, motherIdentityCommitment: mC,
      fatherVersionIndex: 1, motherVersionIndex: 1, tag: 'child',
    })

    const fee = await token.recentReward()
    expect(fee).to.be.gt(0n)

    await token.connect(endorser).transfer(nftHolder.address, fee)
    await token.connect(nftHolder).approve(deepFamily.target, fee)
    await endorseVersion(deepFamily, nftHolder, personHash, 1)

    const FULLNAME = childPerson.fullName
    const basicInfo = {
      identityCommitment: hre.ethers.zeroPadValue(hre.ethers.toBeHex(cC), 32),
      isBirthBC: false,
      birthYear: 1999,
      birthMonth: 0,
      birthDay: 0,
      gender: 1,
    }
    const dbVal = computeDisclosureBinding(hre.ethers, FULLNAME, basicInfo, 1, 1, 1)
    const nftHolderAddr = await nftHolder.getAddress()
    const proof = makeStubProof()
    const ps = {
      identityCommitment: BigInt(cC),
      disclosureBinding: dbVal,
      minter: BigInt(nftHolderAddr),
      schemaVersion: 1, cryptoSuiteVersion: 1, hashAlgoId: 1,
    }
    const coreInfo = {
      basicInfo,
      supplementInfo: { fullName: FULLNAME, birthPlace: '', isDeathBC: false, deathYear: 0, deathMonth: 0, deathDay: 0, deathPlace: '', story: '' },
    }
    await mintPersonVersionNFT(deepFamily, nftHolder, personHash, proof, ps, 1, 'ipfs://child', coreInfo)

    const holderBalanceBefore = await token.balanceOf(nftHolder.address)
    await token.connect(endorser).approve(deepFamily.target, fee)

    const tx = await endorseVersion(deepFamily, endorser, personHash, 1)
    const receipt = await tx.wait()
    const eventArgs = getEndorsementEventArgs(receipt, deepFamily)

    expect(eventArgs.recipient).to.equal(nftHolder.address)
    const holderBalanceAfter = await token.balanceOf(nftHolder.address)
    expect(holderBalanceAfter).to.equal(holderBalanceBefore + BigInt(eventArgs.recipientShare))
  })

  it('reverts when allowance is insufficient', async () => {
    const { deepFamily, token, signers, personHash } = await createChildWithParents()
    const [endorser] = signers
    const fee = await token.recentReward()
    expect(fee).to.be.gt(0n)

    await token.connect(endorser).approve(deepFamily.target, fee - 1n)
    await expect(
      endorseVersion(deepFamily, endorser, personHash, 1)
    ).to.be.revertedWithCustomError(token, 'ERC20InsufficientAllowance')
  })

  it('updates endorsement counts when switching versions', async () => {
    const { deepFamily, signers, commitment, personHash, person } = await createBasicPerson()
    await addPerson(hre.ethers, deepFamily, signers[0], commitment, { person, tag: 'second' })

    const [endorser] = signers
    await endorseVersion(deepFamily, endorser, personHash, 1)
    let firstVersionCount = await deepFamily.versionEndorsementCount(personHash, 0)
    let secondVersionCount = await deepFamily.versionEndorsementCount(personHash, 1)
    expect(firstVersionCount).to.equal(1n)
    expect(secondVersionCount).to.equal(0n)

    await endorseVersion(deepFamily, endorser, personHash, 2)
    firstVersionCount = await deepFamily.versionEndorsementCount(personHash, 0)
    secondVersionCount = await deepFamily.versionEndorsementCount(personHash, 1)
    expect(firstVersionCount).to.equal(0n)
    expect(secondVersionCount).to.equal(1n)
  })

  describe('listUserEndorsements', () => {
    it('returns empty list when user has no endorsements', async () => {
      const { reader, signers } = await deployContracts()
      const result = await reader.listUserEndorsements(signers[0].address, 0, 10)
      expect(result.personHashes).to.have.lengthOf(0)
      expect(result.totalCount).to.equal(0n)
    })

    it('returns single endorsement after user endorses one person', async () => {
      const { deepFamily, reader, personHash } = await createBasicPerson()
      const [endorser] = await hre.ethers.getSigners()
      await endorseVersion(deepFamily, endorser, personHash, 1)

      const result = await reader.listUserEndorsements(endorser.address, 0, 10)
      expect(result.personHashes).to.have.lengthOf(1)
      expect(result.personHashes[0]).to.equal(personHash)
      expect(result.versionIndices[0]).to.equal(1n)
      expect(result.totalCount).to.equal(1n)
    })

    it('returns multiple endorsements', async () => {
      const { deepFamily, reader, signers } = await deployContracts()
      const [endorser] = signers
      const hashes = []
      for (let i = 0; i < 3; i++) {
        const person = makeTestPerson(`Endorse List ${i}`)
        const h = await addPerson(hre.ethers, deepFamily, endorser, null, { person, tag: `v${i}` })
        hashes.push(h)
        await endorseVersion(deepFamily, endorser, h, 1)
      }
      const result = await reader.listUserEndorsements(endorser.address, 0, 10)
      expect(result.personHashes).to.have.lengthOf(3)
      expect(result.totalCount).to.equal(3n)
    })

    it('supports pagination correctly', async () => {
      const { deepFamily, reader, signers } = await deployContracts()
      const [endorser] = signers
      const persons = []
      for (let i = 0; i < 5; i++) {
        const person = makeTestPerson(`Endorse Page ${i}`)
        const h = await addPerson(hre.ethers, deepFamily, endorser, null, { person, tag: `v${i}` })
        persons.push(h)
        await endorseVersion(deepFamily, endorser, h, 1)
      }

      let result = await reader.listUserEndorsements(endorser.address, 0, 2)
      expect(result.personHashes).to.have.lengthOf(2)
      expect(result.hasMore).to.be.true
      expect(result.nextOffset).to.equal(2n)

      result = await reader.listUserEndorsements(endorser.address, 4, 2)
      expect(result.personHashes).to.have.lengthOf(1)
      expect(result.hasMore).to.be.false
    })
  })

  describe('cancelEndorsement', () => {
    it('reverts when trying to cancel non-existent endorsement', async () => {
      const { deepFamily, reader, personHash } = await createBasicPerson()
      await expect(
        deepFamily.cancelEndorsement(personHash)
      ).to.be.revertedWithCustomError(deepFamily, 'NotEndorsed')
    })

    it('successfully cancels endorsement and decrements count', async () => {
      const { deepFamily, reader, personHash } = await createBasicPerson()
      const [endorser] = await hre.ethers.getSigners()
      await endorseVersion(deepFamily, endorser, personHash, 1)

      await expect(
        deepFamily.connect(endorser).cancelEndorsement(personHash)
      ).to.emit(deepFamily, 'EndorsementCancelled')

      const count = await deepFamily.versionEndorsementCount(personHash, 0)
      expect(count).to.equal(0n)
      const endorsedVersion = await deepFamily.endorsedVersionIndex(personHash, endorser.address)
      expect(endorsedVersion).to.equal(0n)
    })

    it('removes person from user endorsed list', async () => {
      const { deepFamily, reader, personHash } = await createBasicPerson()
      const [endorser] = await hre.ethers.getSigners()
      await endorseVersion(deepFamily, endorser, personHash, 1)

      let result = await reader.listUserEndorsements(endorser.address, 0, 10)
      expect(result.personHashes).to.have.lengthOf(1)

      await deepFamily.connect(endorser).cancelEndorsement(personHash)

      result = await reader.listUserEndorsements(endorser.address, 0, 10)
      expect(result.personHashes).to.have.lengthOf(0)
    })

    it('allows re-endorsing after cancellation', async () => {
      const { deepFamily, personHash } = await createBasicPerson()
      const [endorser] = await hre.ethers.getSigners()

      await endorseVersion(deepFamily, endorser, personHash, 1)
      await deepFamily.connect(endorser).cancelEndorsement(personHash)
      await endorseVersion(deepFamily, endorser, personHash, 1)

      const endorsedVersion = await deepFamily.endorsedVersionIndex(personHash, endorser.address)
      expect(endorsedVersion).to.equal(1n)
    })

    it('correctly handles swap-and-pop when cancelling from middle of list', async () => {
      const { deepFamily, reader, signers } = await deployContracts()
      const [endorser] = signers
      const hashes = []
      for (let i = 0; i < 3; i++) {
        const person = makeTestPerson(`Cancel List ${i}`)
        const h = await addPerson(hre.ethers, deepFamily, endorser, null, { person, tag: `v${i}` })
        hashes.push(h)
        await endorseVersion(deepFamily, endorser, h, 1)
      }

      await deepFamily.connect(endorser).cancelEndorsement(hashes[1])

      const result = await reader.listUserEndorsements(endorser.address, 0, 10)
      expect(result.personHashes).to.have.lengthOf(2)
      expect(result.personHashes).to.include(hashes[0])
      expect(result.personHashes).to.include(hashes[2])
      expect(result.personHashes).to.not.include(hashes[1])
    })
  })
})
