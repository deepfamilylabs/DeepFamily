import '../hardhat-test-setup.mjs'
import { expect } from 'chai'
import hre from 'hardhat'
import personCommitmentProof from '../lib/personCommitmentProof.js'
import { deployIntegratedFixture } from './fixtures/integrated.mjs'

const { generatePersonCommitmentProof } = personCommitmentProof

describe('Real person commitment proof', function () {
  this.timeout(60_000)

  it('accepts the maximum uint8 gender through the generated Solidity verifier', async () => {
    const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture)
    const [signer] = await hre.ethers.getSigners()
    const signerAddress = await signer.getAddress()
    const person = {
      fullName: 'Custom Gender 255',
      derivedSecretField: 0n,
      isBirthBC: false,
      birthYear: 1990,
      birthMonth: 5,
      birthDay: 15,
      gender: 255,
    }
    const generated = await generatePersonCommitmentProof(
      person,
      null,
      null,
      signerAddress,
    )

    await expect(
      deepFamily.connect(signer).addPersonVersion(
        generated.proofEnvelope,
        generated.publicSignalsStruct,
        0,
        0,
        'gender-255',
        '',
      ),
    ).to.emit(deepFamily, 'PersonHashZKVerified')
  })
})
