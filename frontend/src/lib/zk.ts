import { keccak256 } from 'ethers'
import { normalizeNameForHash, normalizePassphraseForHash } from './passphraseStrength'
import { sanitizeErrorForLogging } from './errors'
// @ts-ignore
import * as snarkjs from 'snarkjs'

export type Groth16Proof = {
  pi_a: [string | bigint, string | bigint, string | bigint]
  pi_b: [[string | bigint, string | bigint], [string | bigint, string | bigint], [string | bigint, string | bigint]]
  pi_c: [string | bigint, string | bigint, string | bigint]
  protocol: string
  curve: string
}

type ZkArtifacts = {
  wasm: Uint8Array
  zkey: Uint8Array
}

const textEncoder = new TextEncoder()


let personHashArtifactsPromise: Promise<ZkArtifacts> | null = null
let namePoseidonArtifactsPromise: Promise<ZkArtifacts> | null = null

async function loadArtifacts(wasmUrl: string, zkeyUrl: string): Promise<ZkArtifacts> {
  const [wasmRes, zkeyRes] = await Promise.all([fetch(wasmUrl), fetch(zkeyUrl)])
  if (!wasmRes.ok) {
    throw new Error(`Failed to load wasm from ${wasmUrl}: ${wasmRes.status}`)
  }
  if (!zkeyRes.ok) {
    throw new Error(`Failed to load zkey from ${zkeyUrl}: ${zkeyRes.status}`)
  }

  const [wasmBuffer, zkeyBuffer] = await Promise.all([wasmRes.arrayBuffer(), zkeyRes.arrayBuffer()])
  return {
    wasm: new Uint8Array(wasmBuffer),
    zkey: new Uint8Array(zkeyBuffer)
  }
}

async function loadPersonHashArtifacts(): Promise<ZkArtifacts> {
  if (!personHashArtifactsPromise) {
    personHashArtifactsPromise = (async () => {
      try {
        return await loadArtifacts('/zk/person_hash_zk.wasm', '/zk/person_hash_zk_final.zkey')
      } catch (error) {
        personHashArtifactsPromise = null
        throw error
      }
    })()
  }
  return personHashArtifactsPromise
}

async function loadNamePoseidonArtifacts(): Promise<ZkArtifacts> {
  if (!namePoseidonArtifactsPromise) {
    namePoseidonArtifactsPromise = (async () => {
      try {
        return await loadArtifacts('/zk/name_poseidon_zk.wasm', '/zk/name_poseidon_zk_final.zkey')
      } catch (error) {
        namePoseidonArtifactsPromise = null
        throw error
      }
    })()
  }
  return namePoseidonArtifactsPromise
}

function toBigInt(v: string | number | bigint): bigint {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return BigInt(v)
  if (typeof v === 'string') {
    if (v.startsWith('0x') || v.startsWith('0X')) return BigInt(v)
    return BigInt(v)
  }
  throw new Error('unsupported type')
}

/**
 * Validates public signals shape for ZK proof
 * Used for pre-validation before calling addPersonZK
 */
export function ensurePublicSignalsShape(publicSignals: Array<string | number | bigint>) {
  if (!Array.isArray(publicSignals) || publicSignals.length !== 7) {
    throw new Error('publicSignals length must be 7')
  }
  const TWO_POW_128 = 1n << 128n
  for (let i = 0; i < 6; i++) {
    const limb = toBigInt(publicSignals[i])
    if (limb < 0n || limb >= TWO_POW_128) throw new Error(`publicSignals[${i}] not in [0,2^128)`) 
  }
  const submitter = toBigInt(publicSignals[6])
  const TWO_POW_160 = 1n << 160n
  if (submitter < 0n || submitter >= TWO_POW_160) throw new Error('submitter out of uint160 range')
}

// Note: submitAddPersonZK has been moved to useContract.ts hook for unified contract interaction

// Person data input interface
export interface PersonData {
  fullName: string
  passphrase: string
  birthYear: number
  birthMonth: number
  birthDay: number
  isBirthBC: boolean
  gender: number // 1=male, 2=female
}

// Hash helpers convert UTF-8 string to keccak bytes array (32 elements)
function keccakStringToBytes(value: string): number[] {
  const hash = keccak256(textEncoder.encode(value || ''))
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hash.slice(2 + i * 2, 4 + i * 2), 16)
  }
  return Array.from(bytes)
}

export function hashFullName(fullName: string): number[] {
  const normalized = normalizeNameForHash(fullName)
  return keccakStringToBytes(normalized)
}

type PassphraseInput = string | number | bigint | Array<string | number | bigint> | undefined | null

export function hashPassphrase(passphrase: PassphraseInput): number[] {
  if (Array.isArray(passphrase)) {
    return passphrase.slice(0, 32).map((v) => Number(v) & 0xff)
  }
  const normalized = passphrase == null ? '' : normalizePassphraseForHash(String(passphrase))
  if (normalized.length === 0) {
    return Array(32).fill(0)
  }
  return keccakStringToBytes(normalized)
}

// Generate ZK proof for adding a person
export async function generatePersonProof(
  person: PersonData,
  father: PersonData | null,
  mother: PersonData | null,
  submitterAddress: string
): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
  try {
    // Create default parent data if they don't exist
    const defaultParent: PersonData = {
      fullName: '',
      passphrase: '',
      birthYear: 0,
      birthMonth: 1,
      birthDay: 1,
      isBirthBC: false,
      gender: 1
    }

    const fatherData = father || defaultParent
    const motherData = mother || defaultParent

    // Prepare circuit input
    const input = {
      fullNameHash: hashFullName(person.fullName),
      saltHash: hashPassphrase(person.passphrase),
      isBirthBC: person.isBirthBC ? 1 : 0,
      birthYear: person.birthYear,
      birthMonth: person.birthMonth,
      birthDay: person.birthDay,
      gender: person.gender,
      
      father_fullNameHash: hashFullName(fatherData.fullName),
      father_saltHash: hashPassphrase(fatherData.passphrase),
      father_isBirthBC: fatherData.isBirthBC ? 1 : 0,
      father_birthYear: fatherData.birthYear,
      father_birthMonth: fatherData.birthMonth,
      father_birthDay: fatherData.birthDay,
      father_gender: fatherData.gender,
      
      mother_fullNameHash: hashFullName(motherData.fullName),
      mother_saltHash: hashPassphrase(motherData.passphrase),
      mother_isBirthBC: motherData.isBirthBC ? 1 : 0,
      mother_birthYear: motherData.birthYear,
      mother_birthMonth: motherData.birthMonth,
      mother_birthDay: motherData.birthDay,
      mother_gender: motherData.gender,
      
      hasFather: father && normalizeNameForHash(father.fullName || '').length ? 1 : 0,
      hasMother: mother && normalizeNameForHash(mother.fullName || '').length ? 1 : 0,
      submitter: BigInt(submitterAddress).toString()
    }

    const { wasm, zkey } = await loadPersonHashArtifacts()

    // Generate proof using snarkjs
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey)

    return { proof, publicSignals }
  } catch (error) {
    console.error('Error generating ZK proof:', sanitizeErrorForLogging(error))
    throw new Error(`Failed to generate ZK proof: ${error}`)
  }
}

// Verify a ZK proof (optional, for debugging)
export async function verifyProof(
  proof: Groth16Proof,
  publicSignals: string[]
): Promise<boolean> {
  try {
    const vKeyResponse = await fetch('/zk/person_hash_zk.vkey.json')
    const vKey = await vKeyResponse.json()
    
    const result = await snarkjs.groth16.verify(vKey, publicSignals, proof)
    return result
  } catch (error) {
    console.error('Error verifying proof:', sanitizeErrorForLogging(error))
    return false
  }
}

export async function generateNamePoseidonProof(
  fullName: string,
  passphrase: string,
  minterAddress: string
): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
  try {
    if (!minterAddress || minterAddress.length === 0) {
      throw new Error('Minter address is required to generate the name poseidon proof')
    }

    const minterDecimal = BigInt(minterAddress).toString()

    const input = {
      fullNameHash: hashFullName(fullName),
      saltHash: hashPassphrase(passphrase),
      minter: minterDecimal
    }

    const { wasm, zkey } = await loadNamePoseidonArtifacts()
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey)

    return { proof, publicSignals }
  } catch (error) {
    console.error('Error generating name poseidon ZK proof:', sanitizeErrorForLogging(error))
    throw new Error(`Failed to generate name poseidon ZK proof: ${error}`)
  }
}

export async function verifyNamePoseidonProof(
  proof: Groth16Proof,
  publicSignals: string[]
): Promise<boolean> {
  try {
    const vKeyResponse = await fetch('/zk/name_poseidon_zk.vkey.json')
    const vKey = await vKeyResponse.json()
    return snarkjs.groth16.verify(vKey, publicSignals, proof)
  } catch (error) {
    console.error('Error verifying name poseidon proof:', sanitizeErrorForLogging(error))
    return false
  }
}

export function formatGroth16ProofForContract(proof: Groth16Proof) {
  if (!proof || !proof.pi_a || !proof.pi_b || !proof.pi_c) {
    throw new Error('Invalid proof structure')
  }

  if (!Array.isArray(proof.pi_a) || proof.pi_a.length < 2) {
    throw new Error('Invalid proof.pi_a length')
  }

  if (!Array.isArray(proof.pi_b) || proof.pi_b.length < 2) {
    throw new Error('Invalid proof.pi_b length')
  }

  if (!Array.isArray(proof.pi_c) || proof.pi_c.length < 2) {
    throw new Error('Invalid proof.pi_c length')
  }

  const a: [bigint, bigint] = [toBigInt(proof.pi_a[0]), toBigInt(proof.pi_a[1])]
  const b: [[bigint, bigint], [bigint, bigint]] = [
    [toBigInt(proof.pi_b[0][1]), toBigInt(proof.pi_b[0][0])],
    [toBigInt(proof.pi_b[1][1]), toBigInt(proof.pi_b[1][0])]
  ]
  const c: [bigint, bigint] = [toBigInt(proof.pi_c[0]), toBigInt(proof.pi_c[1])]

  return { a, b, c }
}

export function toBigIntArray(values: Array<string | number | bigint>): bigint[] {
  return values.map(toBigInt)
}
