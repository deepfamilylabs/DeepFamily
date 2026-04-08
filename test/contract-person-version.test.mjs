import '../hardhat-test-setup.mjs'
import { expect } from 'chai'
import hre from 'hardhat'
import { deployIntegratedFixture } from './fixtures/integrated.mjs'
import {
  setupStubVerifiers,
  addPerson,
  computePersonHash,
  computeProfileIdentityCommitment,
  makeStubProof,
  makeAddPersonPublicSignals,
  makeTestPerson,
} from './helpers/testHelper.mjs'

const ZERO_HASH = hre.ethers.ZeroHash
const commitmentOf = (person) => computeProfileIdentityCommitment(hre.ethers, person)

describe('Person Version (add-person) Tests', function () {
  this.timeout(120_000)

  async function baseSetup() {
    const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture)
    const [signer] = await hre.ethers.getSigners()
    await setupStubVerifiers(hre.ethers, deepFamily)
    return { deepFamily, signer }
  }

  it('adds a basic person and emits event', async () => {
    const { deepFamily, signer } = await baseSetup()
    const person = makeTestPerson('Basic Person')
    const personHash = await addPerson(hre.ethers, deepFamily, signer, null, { person })
    const [, totalVersions] = await deepFamily.listPersonVersions(personHash, 0, 0)
    expect(totalVersions).to.equal(1n)
  })

  it('prevents duplicate version (same inputs)', async () => {
    const { deepFamily, signer } = await baseSetup()
    const person = makeTestPerson('Duplicate Subject')
    await addPerson(hre.ethers, deepFamily, signer, null, { person, tag: 'v1', metadataCID: 'QmCIDx' })
    await expect(
      addPerson(hre.ethers, deepFamily, signer, null, { person, tag: 'v1', metadataCID: 'QmCIDx' })
    ).to.be.revertedWithCustomError(deepFamily, 'DuplicateVersion')
  })

  it('adds person without parents (zero hash preserved)', async () => {
    const { deepFamily, signer } = await baseSetup()
    const person = makeTestPerson('No Parent Subject')
    const personHash = await addPerson(hre.ethers, deepFamily, signer, null, { person })

    const [versions, totalVersions] = await deepFamily.listPersonVersions(personHash, 0, 100)
    expect(totalVersions).to.equal(1n)
    expect(versions[0].fatherHash).to.equal(ZERO_HASH)
    expect(versions[0].motherHash).to.equal(ZERO_HASH)
  })

  it('adds person with complete parent information', async () => {
    const { deepFamily, signer } = await baseSetup()
    const fatherPerson = makeTestPerson('Father Version Person', { birthYear: 1970 })
    const motherPerson = makeTestPerson('Mother Version Person', { birthYear: 1972, gender: 2 })
    const childPerson = makeTestPerson('Child Version Person', { birthYear: 2001 })
    const fatherCommitment = commitmentOf(fatherPerson)
    const motherCommitment = commitmentOf(motherPerson)

    await addPerson(hre.ethers, deepFamily, signer, fatherCommitment, { person: fatherPerson, tag: 'father' })
    await addPerson(hre.ethers, deepFamily, signer, motherCommitment, { person: motherPerson, tag: 'mother' })

    const fatherHash = computePersonHash(hre.ethers, fatherCommitment)
    const motherHash = computePersonHash(hre.ethers, motherCommitment)

    const childHash = await addPerson(hre.ethers, deepFamily, signer, null, {
      person: childPerson,
      fatherPerson,
      motherPerson,
      fatherIdentityCommitment: fatherCommitment,
      motherIdentityCommitment: motherCommitment,
      fatherVersionIndex: 0,
      motherVersionIndex: 0,
      tag: 'child',
    })

    const [versions, totalVersions] = await deepFamily.listPersonVersions(childHash, 0, 100)
    expect(totalVersions).to.equal(1n)
    expect(versions[0].fatherHash).to.equal(fatherHash)
    expect(versions[0].motherHash).to.equal(motherHash)
  })

  it('adds multiple versions for same person', async () => {
    const { deepFamily, signer } = await baseSetup()
    const person = makeTestPerson('Multi Version Subject')
    const commitment = commitmentOf(person)

    await addPerson(hre.ethers, deepFamily, signer, commitment, { person, tag: 'first' })
    await addPerson(hre.ethers, deepFamily, signer, commitment, { person, tag: 'second' })

    const personHash = computePersonHash(hre.ethers, commitment)
    const [versions, totalVersions] = await deepFamily.listPersonVersions(personHash, 0, 100)
    expect(totalVersions).to.equal(2n)
    expect(versions[0].tag).to.equal('first')
    expect(versions[1].tag).to.equal('second')
  })

  it('allows providing parent hash with unknown (0) version index when parent exists', async () => {
    const { deepFamily, signer } = await baseSetup()
    const fatherPerson = makeTestPerson('Father Zero Index', { birthYear: 1970 })
    const childPerson = makeTestPerson('Child Zero Index', { birthYear: 2004 })
    const fatherCommitment = commitmentOf(fatherPerson)

    await addPerson(hre.ethers, deepFamily, signer, fatherCommitment, { person: fatherPerson, tag: 'father' })
    const fatherHash = computePersonHash(hre.ethers, fatherCommitment)

    const childHash = await addPerson(hre.ethers, deepFamily, signer, null, {
      person: childPerson,
      fatherPerson,
      fatherIdentityCommitment: fatherCommitment,
      fatherVersionIndex: 0,
      tag: 'child',
    })

    const [childVersions] = await deepFamily.listPersonVersions(childHash, 0, 10)
    expect(childVersions[0].fatherHash).to.equal(fatherHash)
    expect(childVersions[0].fatherVersionIndex).to.equal(0n)
    expect(childVersions[0].motherHash).to.equal(ZERO_HASH)

    const [zeroIdxChildren] = await deepFamily.listChildren(fatherHash, 0, 0, 10)
    expect(zeroIdxChildren).to.include(childHash)
  })

  it('allows re-submitting a version to backfill parents and link trees', async () => {
    const { deepFamily, signer } = await baseSetup()
    const fatherPerson = makeTestPerson('Father Linked', { birthYear: 1971 })
    const motherPerson = makeTestPerson('Mother Linked', { birthYear: 1973, gender: 2 })
    const childPerson = makeTestPerson('Child Linked', { birthYear: 2002 })
    const fatherCommitment = commitmentOf(fatherPerson)
    const motherCommitment = commitmentOf(motherPerson)
    const childCommitment = commitmentOf(childPerson)

    await addPerson(hre.ethers, deepFamily, signer, fatherCommitment, { person: fatherPerson, tag: 'father' })
    await addPerson(hre.ethers, deepFamily, signer, motherCommitment, { person: motherPerson, tag: 'mother' })
    await addPerson(hre.ethers, deepFamily, signer, childCommitment, { person: childPerson, tag: 'orphan' })

    const fatherHash = computePersonHash(hre.ethers, fatherCommitment)
    const motherHash = computePersonHash(hre.ethers, motherCommitment)

    await addPerson(hre.ethers, deepFamily, signer, childCommitment, {
      person: childPerson,
      fatherPerson,
      motherPerson,
      fatherIdentityCommitment: fatherCommitment,
      motherIdentityCommitment: motherCommitment,
      fatherVersionIndex: 1,
      motherVersionIndex: 1,
      tag: 'linked',
    })

    const childHash = computePersonHash(hre.ethers, childCommitment)
    const [versions, totalVersions] = await deepFamily.listPersonVersions(childHash, 0, 10)
    expect(totalVersions).to.equal(2n)
    expect(versions[0].fatherHash).to.equal(ZERO_HASH)
    expect(versions[0].motherHash).to.equal(ZERO_HASH)
    expect(versions[1].fatherVersionIndex).to.equal(1n)
    expect(versions[1].motherVersionIndex).to.equal(1n)
    expect(versions[1].fatherHash).to.equal(fatherHash)
    expect(versions[1].motherHash).to.equal(motherHash)

    const [fatherChildren] = await deepFamily.listChildren(fatherHash, 1, 0, 10)
    expect(fatherChildren).to.include(childHash)
    const [motherChildren] = await deepFamily.listChildren(motherHash, 1, 0, 10)
    expect(motherChildren).to.include(childHash)
  })

  it('reverts when proof submitter does not match caller', async () => {
    const { deepFamily, signer } = await baseSetup()
    const [, mismatchedCaller] = await hre.ethers.getSigners()
    const commitment = 123456789n
    const signerAddr = await signer.getAddress()

    const proof = makeStubProof()
    const publicSignals = makeAddPersonPublicSignals(commitment, signerAddr)
    await expect(
      deepFamily.connect(mismatchedCaller).addPersonVersion(
        proof, publicSignals, 0, 0, 'v1', 'ipfs://mismatch'
      )
    ).to.be.revertedWithCustomError(deepFamily, 'CallerMismatch')
  })

  it('addPersonVersion allows zero parents when parent commitments are zero', async () => {
    const { deepFamily, signer } = await baseSetup()
    const person = makeTestPerson('Zero Parent Subject')
    const commitment = commitmentOf(person)

    await addPerson(hre.ethers, deepFamily, signer, commitment, { person })
    const personHash = computePersonHash(hre.ethers, commitment)
    const [, total] = await deepFamily.listPersonVersions(personHash, 0, 0)
    expect(total).to.equal(1n)
  })

  it('addPersonVersion rejects non-zero parent ref when corresponding commitment is zero', async () => {
    const { deepFamily, signer } = await baseSetup()
    const commitment = 123456790n
    const signerAddr = await signer.getAddress()

    const proof = makeStubProof()
    const publicSignals = makeAddPersonPublicSignals(commitment, signerAddr)
    await expect(
      deepFamily.connect(signer).addPersonVersion(
        proof, publicSignals, 1, 0, 'invalid-parent', 'ipfs://bad-parent'
      )
    ).to.be.revertedWithCustomError(deepFamily, 'InvalidParentHash')
  })

  it('allows hashAlgoId == 0', async () => {
    const { deepFamily, signer } = await baseSetup()
    const person = makeTestPerson('Zero Algo Subject', { hashAlgoId: 0 })
    const personHash = await addPerson(hre.ethers, deepFamily, signer, null, {
      person,
      hashAlgoId: 0,
      tag: 'v0',
      metadataCID: 'ipfs://zero-algo',
    })
    const [, totalVersions] = await deepFamily.listPersonVersions(personHash, 0, 0)
    expect(totalVersions).to.equal(1n)
  })

  it('supports non-default schemaVersion and cryptoSuiteVersion in public signals', async () => {
    const { deepFamily, signer } = await baseSetup()
    const person = makeTestPerson('Versioned Subject', {
      schemaVersion: 2,
      cryptoSuiteVersion: 3,
      hashAlgoId: 1,
    })
    const personHash = await addPerson(hre.ethers, deepFamily, signer, null, {
      person,
      schemaVersion: 2,
      cryptoSuiteVersion: 3,
      hashAlgoId: 1,
      tag: 'v2',
      metadataCID: 'ipfs://versioned',
    })
    const [, totalVersions] = await deepFamily.listPersonVersions(personHash, 0, 0)
    expect(totalVersions).to.equal(1n)
  })
})
