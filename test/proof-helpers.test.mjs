import '../hardhat-test-setup.mjs'
import { expect } from 'chai'
import personCommitmentProof from '../lib/personCommitmentProof.js'
import disclosureBindingProof from '../lib/disclosureBindingProof.js'

const { computePersonHashFromInput, buildPersonCommitmentInput } = personCommitmentProof
const { buildDisclosureBindingInput } = disclosureBindingProof

describe('proof helpers', function () {
  it('computePersonHashFromInput canonicalizes whitespace-variant names', function () {
    const base = {
      derivedSecretField: 0n,
      isBirthBC: false,
      birthYear: 1990,
      birthMonth: 5,
      birthDay: 15,
      gender: 1,
    }

    const a = computePersonHashFromInput({ ...base, fullName: 'Alice Smith' })
    const b = computePersonHashFromInput({ ...base, fullName: '  Alice　Smith  ' })

    expect(b.canonicalFullName).to.equal('Alice Smith')
    expect(a.identityCommitment).to.equal(b.identityCommitment)
    expect(a.personHash).to.equal(b.personHash)
  })

  it('buildPersonCommitmentInput emits circuit fields and parent flags', function () {
    const result = buildPersonCommitmentInput(
      {
        fullName: 'Child Example',
        derivedSecretField: 0n,
        isBirthBC: false,
        birthYear: 2000,
        birthMonth: 1,
        birthDay: 2,
        gender: 1,
      },
      {
        fullName: 'Father Example',
        derivedSecretField: 0n,
        isBirthBC: false,
        birthYear: 1970,
        birthMonth: 0,
        birthDay: 0,
        gender: 1,
      },
      null,
      '0x1234567890123456789012345678901234567890',
    )

    expect(result.input.hasFather).to.equal(1)
    expect(result.input.hasMother).to.equal(0)
    expect(result.input.schemaVersion).to.equal(1)
    expect(result.input.cryptoSuiteVersion).to.equal(1)
    expect(result.person.personHash).to.match(/^0x[0-9a-f]{64}$/)
    expect(result.father.personHash).to.match(/^0x[0-9a-f]{64}$/)
  })

  it('buildDisclosureBindingInput returns canonical disclosure payload aligned with person hash', function () {
    const person = {
      fullName: '  Alice　Smith  ',
      derivedSecretField: 0n,
      isBirthBC: false,
      birthYear: 1990,
      birthMonth: 5,
      birthDay: 15,
      gender: 1,
    }

    const disclosure = buildDisclosureBindingInput(
      person,
      '0x1234567890123456789012345678901234567890',
    )
    const personHash = computePersonHashFromInput(person)

    expect(disclosure.canonicalFullName).to.equal('Alice Smith')
    expect(disclosure.input.schemaVersion).to.equal(1)
    expect(disclosure.input.cryptoSuiteVersion).to.equal(1)
    expect(disclosure.person.personHash).to.equal(personHash.personHash)
  })
})
