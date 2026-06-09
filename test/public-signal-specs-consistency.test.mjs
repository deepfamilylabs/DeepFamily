import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'chai'
import {
  DEFAULT_PROOF_ENCODING_ID,
  DEFAULT_PROOF_SYSTEM_ID,
  PROOF_ENCODING_ID_ABI_GROTH16_ABC,
  PROOF_SYSTEM_ID_GROTH16_BN254_V1,
  DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC,
  PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC,
} from '@deepfamily/proof-core'
import {
  DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
  PERSON_COMMITMENT_PROOF_DESCRIPTOR,
} from '../lib/proofDescriptors.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function extractUintConstant(source, name) {
  const match = source.match(
    new RegExp(`uint(?:8|16|256)\\s+internal\\s+constant\\s+${name}\\s*=\\s*(\\d+)\\s*;`)
  )
  if (!match) {
    throw new Error(`Unable to find Solidity constant: ${name}`)
  }
  return Number(match[1])
}

describe('ProofConstants consistency tests', () => {
  const proofConstantsSource = readFileSync(
    path.resolve(__dirname, '../contracts/libraries/ProofConstants.sol'),
    'utf8',
  )
  const deepFamilySource = readFileSync(
    path.resolve(__dirname, '../contracts/DeepFamily.sol'),
    'utf8',
  )

  const solidityConstants = {
    proofSystemId: extractUintConstant(proofConstantsSource, 'PROOF_SYSTEM_ID_GROTH16_BN254_V1'),
    proofEncodingId: extractUintConstant(proofConstantsSource, 'PROOF_ENCODING_ID_ABI_GROTH16_ABC'),
    personCommitmentPurpose: extractUintConstant(
      proofConstantsSource,
      'PROOF_PURPOSE_PERSON_COMMITMENT',
    ),
    disclosureBindingPurpose: extractUintConstant(
      proofConstantsSource,
      'PROOF_PURPOSE_DISCLOSURE_BINDING',
    ),
    personSignalsLength: extractUintConstant(proofConstantsSource, 'PERSON_PUBLIC_SIGNALS_LEN'),
    disclosureSignalsLength: extractUintConstant(
      proofConstantsSource,
      'DISCLOSURE_BINDING_PUBLIC_SIGNALS_LEN',
    ),
  }

  const proofPurposeMembers = deepFamilySource
    .match(/enum\s+ProofPurpose\s*{([^}]*)}/s)[1]
    .split(',')
    .map((member) => member.trim())
    .filter(Boolean)

  it('keeps proof-system and proof-encoding ids aligned across JS and Solidity', () => {
    expect(PROOF_SYSTEM_ID_GROTH16_BN254_V1).to.equal(solidityConstants.proofSystemId)
    expect(DEFAULT_PROOF_SYSTEM_ID).to.equal(solidityConstants.proofSystemId)
    expect(PERSON_COMMITMENT_PROOF_DESCRIPTOR.proofSystemId).to.equal(solidityConstants.proofSystemId)
    expect(DISCLOSURE_BINDING_PROOF_DESCRIPTOR.proofSystemId).to.equal(solidityConstants.proofSystemId)

    expect(PROOF_ENCODING_ID_ABI_GROTH16_ABC).to.equal(solidityConstants.proofEncodingId)
    expect(DEFAULT_PROOF_ENCODING_ID).to.equal(solidityConstants.proofEncodingId)
    expect(PERSON_COMMITMENT_PROOF_DESCRIPTOR.proofEncodingId).to.equal(solidityConstants.proofEncodingId)
    expect(DISCLOSURE_BINDING_PROOF_DESCRIPTOR.proofEncodingId).to.equal(solidityConstants.proofEncodingId)
  })

  it('keeps proof-purpose ids aligned with DeepFamily.ProofPurpose', () => {
    expect(proofPurposeMembers[solidityConstants.personCommitmentPurpose]).to.equal(
      'PersonCommitment',
    )
    expect(proofPurposeMembers[solidityConstants.disclosureBindingPurpose]).to.equal(
      'DisclosureBinding',
    )
  })

  it('keeps public-signal lengths aligned across JS authority and Solidity mirrors', () => {
    expect(PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC.length).to.equal(
      solidityConstants.personSignalsLength,
    )
    expect(PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC.fieldOrder).to.have.length(
      solidityConstants.personSignalsLength,
    )
    expect(PERSON_COMMITMENT_PROOF_DESCRIPTOR.publicSignalSpec).to.equal(
      PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC.name,
    )

    expect(DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC.length).to.equal(
      solidityConstants.disclosureSignalsLength,
    )
    expect(DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC.fieldOrder).to.have.length(
      solidityConstants.disclosureSignalsLength,
    )
    expect(DISCLOSURE_BINDING_PROOF_DESCRIPTOR.publicSignalSpec).to.equal(
      DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC.name,
    )
  })
})
