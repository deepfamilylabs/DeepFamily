import '../hardhat-test-setup.mjs'
import { expect } from 'chai'
import personCommitmentProof from '../lib/personCommitmentProof.js'
import disclosureBindingProof from '../lib/disclosureBindingProof.js'

const {
  assertPersonCommitmentPublicSignalsMatch,
  computePersonHashFromInput,
  buildPersonCommitmentInput,
} = personCommitmentProof
const {
  assertDisclosureBindingPublicSignalsMatch,
  buildDisclosureBindingInput,
} = disclosureBindingProof

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

  it('rejects every mismatched person-commitment public signal', function () {
    const result = buildPersonCommitmentInput(
      {
        fullName: 'Child Example',
        derivedSecretField: 11n,
        isBirthBC: false,
        birthYear: 2000,
        birthMonth: 1,
        birthDay: 2,
        gender: 1,
      },
      {
        fullName: 'Father Example',
        derivedSecretField: 12n,
        isBirthBC: false,
        birthYear: 1970,
        birthMonth: 3,
        birthDay: 4,
        gender: 1,
      },
      null,
      '0x1234567890123456789012345678901234567890',
      { schemaVersion: 2, cryptoSuiteVersion: 3, hashAlgoId: 4 },
    )
    const expectedSignals = [
      result.person.identityCommitment,
      result.father.identityCommitment,
      0n,
      BigInt(result.submitter),
      2n,
      3n,
      4n,
    ]
    const fieldNames = [
      'identityCommitment',
      'fatherIdentityCommitment',
      'motherIdentityCommitment',
      'submitter',
      'schemaVersion',
      'cryptoSuiteVersion',
      'hashAlgoId',
    ]

    expect(() => assertPersonCommitmentPublicSignalsMatch(result, expectedSignals)).not.to.throw()
    fieldNames.forEach((fieldName, index) => {
      const mismatched = [...expectedSignals]
      mismatched[index] += 1n
      expect(() => assertPersonCommitmentPublicSignalsMatch(result, mismatched))
        .to.throw(`${fieldName} public signal mismatch`)
    })
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

  it('rejects every mismatched disclosure-binding public signal', function () {
    const result = buildDisclosureBindingInput(
      {
        fullName: 'Alice Smith',
        derivedSecretField: 13n,
        isBirthBC: false,
        birthYear: 1990,
        birthMonth: 5,
        birthDay: 15,
        gender: 2,
      },
      '0x1234567890123456789012345678901234567890',
      { schemaVersion: 2, cryptoSuiteVersion: 3, hashAlgoId: 4 },
    )
    const expectedSignals = [
      result.person.identityCommitment,
      result.disclosureBinding,
      BigInt(result.input.minter),
      2n,
      3n,
      4n,
    ]
    const fieldNames = [
      'identityCommitment',
      'disclosureBinding',
      'minter',
      'schemaVersion',
      'cryptoSuiteVersion',
      'hashAlgoId',
    ]

    expect(() => assertDisclosureBindingPublicSignalsMatch(result, expectedSignals)).not.to.throw()
    fieldNames.forEach((fieldName, index) => {
      const mismatched = [...expectedSignals]
      mismatched[index] += 1n
      expect(() => assertDisclosureBindingPublicSignalsMatch(result, mismatched))
        .to.throw(`${fieldName} public signal mismatch`)
    })
  })
})
