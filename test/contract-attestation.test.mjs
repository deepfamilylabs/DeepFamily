import '../hardhat-test-setup.mjs'
import { expect } from 'chai'
import hre from 'hardhat'
import { deployIntegratedFixture } from './fixtures/integrated.mjs'
import {
  addPerson,
  computeAttestationKey,
  computeDisclosureBinding,
  computeIdentityCommitment,
  makeEndorseAttestationRef,
  makeMintAttestationRef,
  makeProtocolFeeAttestationRef,
  makeSealStoryAttestationRef,
  makeSetVerifierAttestationRef,
  makeStubProof,
  makeTestPerson,
  mintPerson,
  setupStubVerifiers,
} from './helpers/testHelper.mjs'

describe('Attestation reference anchoring', function () {
  this.timeout(60_000)

  async function setupPerson(deepFamily, signer, fullName = 'Attested Person') {
    const person = makeTestPerson(fullName, {
      isBirthBC: false,
      birthYear: 1999,
      birthMonth: 0,
      birthDay: 0,
      gender: 1,
    })
    const identityCommitment = computeIdentityCommitment(hre.ethers, fullName, person, 1, 1, 1)
    const personHash = await addPerson(hre.ethers, deepFamily, signer, identityCommitment, { person })
    return { person, identityCommitment, personHash }
  }

  async function setupMintAttempt(deepFamily, signer) {
    const fullName = 'Attested Mint Subject'
    const { identityCommitment, personHash } = await setupPerson(deepFamily, signer, fullName)
    await deepFamily.connect(signer).endorseVersion(
      personHash,
      1,
      await makeEndorseAttestationRef(hre.ethers, deepFamily, signer, personHash, 1),
    )

    const signerAddress = await signer.getAddress()
    const basicInfo = {
      identityCommitment: hre.ethers.zeroPadValue(hre.ethers.toBeHex(identityCommitment), 32),
      isBirthBC: false,
      birthYear: 1999,
      birthMonth: 0,
      birthDay: 0,
      gender: 1,
    }
    const coreInfo = {
      basicInfo,
      supplementInfo: {
        fullName,
        birthPlace: '',
        isDeathBC: false,
        deathYear: 0,
        deathMonth: 0,
        deathDay: 0,
        deathPlace: '',
        story: '',
      },
    }
    const publicSignals = {
      identityCommitment: BigInt(identityCommitment),
      disclosureBinding: computeDisclosureBinding(hre.ethers, fullName, basicInfo, 1, 1, 1),
      minter: BigInt(signerAddress),
      schemaVersion: 1,
      cryptoSuiteVersion: 1,
      hashAlgoId: 1,
    }
    return { personHash, proof: makeStubProof(), publicSignals, coreInfo, tokenURI: 'ipfs://mint' }
  }

  it('anchors an endorsement reference and rejects duplicate attestation keys', async () => {
    const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture)
    const [signer] = await hre.ethers.getSigners()
    await setupStubVerifiers(hre.ethers, deepFamily)
    const { personHash } = await setupPerson(deepFamily, signer)

    const ref = await makeEndorseAttestationRef(hre.ethers, deepFamily, signer, personHash, 1)
    const key = computeAttestationKey(hre.ethers, ref)

    await expect(deepFamily.connect(signer).endorseVersion(personHash, 1, ref))
      .to.emit(deepFamily, 'AttestationReferenceAnchored')
      .withArgs(
        key,
        ref.actionType,
        ref.subjectHash,
        ref.subjectType,
        ref.actionDigest,
        ref.attestationPayloadDigest,
        ref.signatureSuiteId,
        ref.signerKeyId,
        ref.uri,
        ref.issuedAt,
        ref.expiresAt,
        ref.revocationType,
        ref.revocationRef,
      )
    expect(await deepFamily.attestationRefExists(key)).to.equal(true)

    await expect(
      deepFamily.connect(signer).endorseVersion(personHash, 1, ref),
    ).to.be.revertedWithCustomError(deepFamily, 'DuplicateAttestationReference')
  })

  it('rejects invalid URI prefixes and action digest mismatches', async () => {
    const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture)
    const [signer] = await hre.ethers.getSigners()
    await setupStubVerifiers(hre.ethers, deepFamily)
    const { personHash } = await setupPerson(deepFamily, signer)

    await expect(
      deepFamily.connect(signer).endorseVersion(
        personHash,
        1,
        await makeEndorseAttestationRef(hre.ethers, deepFamily, signer, personHash, 1, {
          uri: 'https://example.invalid/attestation',
        }),
      ),
    ).to.be.revertedWithCustomError(deepFamily, 'InvalidAttestationURI')

    await expect(
      deepFamily.connect(signer).endorseVersion(
        personHash,
        1,
        await makeEndorseAttestationRef(hre.ethers, deepFamily, signer, personHash, 1, {
          actionDigest: hre.ethers.ZeroHash,
        }),
      ),
    ).to.be.revertedWithCustomError(deepFamily, 'InvalidAttestationAction')
  })

  it('rejects mint references when the coreInfo digest changes', async () => {
    const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture)
    const [signer] = await hre.ethers.getSigners()
    await setupStubVerifiers(hre.ethers, deepFamily)
    const attempt = await setupMintAttempt(deepFamily, signer)
    const ref = await makeMintAttestationRef(
      hre.ethers,
      deepFamily,
      signer,
      attempt.personHash,
      1,
      attempt.tokenURI,
      attempt.coreInfo,
    )
    const mutatedCoreInfo = {
      ...attempt.coreInfo,
      supplementInfo: {
        ...attempt.coreInfo.supplementInfo,
        story: 'changed after attestation',
      },
    }

    await expect(
      deepFamily.connect(signer).mintPersonVersionNFT(
        attempt.proof,
        attempt.publicSignals,
        1,
        attempt.tokenURI,
        mutatedCoreInfo,
        ref,
      ),
    ).to.be.revertedWithCustomError(deepFamily, 'InvalidAttestationAction')
  })

  it('anchors mint, story seal, verifier update, and protocol fee update references', async () => {
    const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture)
    const [owner, verifier, signer] = await hre.ethers.getSigners()
    await setupStubVerifiers(hre.ethers, deepFamily)

    const verifierAddress = await verifier.getAddress()
    await expect(
      deepFamily.setVerifier(
        42,
        0,
        verifierAddress,
        await makeSetVerifierAttestationRef(hre.ethers, deepFamily, owner, 42, 0, verifierAddress),
      ),
    ).to.emit(deepFamily, 'VerifierUpdated')

    await expect(
      deepFamily.updateEndorsementFee(
        250,
        await makeProtocolFeeAttestationRef(hre.ethers, deepFamily, owner, 250),
      ),
    ).to.emit(deepFamily, 'EndorsementFeeUpdated')

    const minted = await mintPerson(hre.ethers, deepFamily, signer, undefined, 'Attested Story Owner')
    const [, , tokenId] = await deepFamily.getVersionDetails(minted.personHash, 1)
    await deepFamily.connect(signer).addStoryChunk(tokenId, 0, 0, 'hello', '', hre.ethers.ZeroHash)

    await expect(
      deepFamily.connect(signer).sealStory(
        tokenId,
        await makeSealStoryAttestationRef(hre.ethers, deepFamily, signer, tokenId),
      ),
    ).to.emit(deepFamily, 'StorySealed')
  })

  it('does not expose a generic public attestation anchor entrypoint', async () => {
    const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture)
    expect(deepFamily.interface.getFunction('anchorAttestationReference')).to.equal(null)
  })
})
