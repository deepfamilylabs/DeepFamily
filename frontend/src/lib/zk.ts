import { Contract, JsonRpcSigner, JsonRpcProvider, toUtf8Bytes, keccak256, solidityPackedKeccak256 } from 'ethers'
import DeepFamilyAbi from '../abi/DeepFamily.json'
// @ts-ignore
import * as snarkjs from 'snarkjs'

type Groth16Proof = {
  a: [string | bigint, string | bigint]
  b: [[string | bigint, string | bigint], [string | bigint, string | bigint]]
  c: [string | bigint, string | bigint]
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

export async function submitAddPersonZK(
  signer: JsonRpcSigner,
  contractAddress: string,
  proof: Groth16Proof,
  publicSignals: Array<string | number | bigint>,
  fatherVersionIndex: number,
  motherVersionIndex: number,
  tag: string,
  metadataCID: string,
) {
  ensurePublicSignalsShape(publicSignals)

  const contract = new Contract(contractAddress, DeepFamilyAbi as any, signer)
  const a = [toBigInt(proof.a[0]), toBigInt(proof.a[1])]
  const b = [
    [toBigInt(proof.b[0][0]), toBigInt(proof.b[0][1])],
    [toBigInt(proof.b[1][0]), toBigInt(proof.b[1][1])],
  ]
  const c = [toBigInt(proof.c[0]), toBigInt(proof.c[1])]
  const pub = publicSignals.map(toBigInt)

  const tx = await contract.addPersonZK(a, b, c, pub, fatherVersionIndex, motherVersionIndex, tag, metadataCID)
  return tx
}

// Person data input interface
export interface PersonData {
  fullName: string
  birthYear: number
  birthMonth: number
  birthDay: number
  isBirthBC: boolean
  gender: number // 1=male, 2=female
}

// Hash a full name to 32 bytes using keccak256
export function hashFullName(fullName: string): number[] {
  const hash = keccak256(toUtf8Bytes(fullName))
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hash.slice(2 + i * 2, 4 + i * 2), 16)
  }
  return Array.from(bytes)
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
      isBirthBC: person.isBirthBC ? 1 : 0,
      birthYear: person.birthYear,
      birthMonth: person.birthMonth,
      birthDay: person.birthDay,
      gender: person.gender,
      
      father_fullNameHash: hashFullName(fatherData.fullName),
      father_isBirthBC: fatherData.isBirthBC ? 1 : 0,
      father_birthYear: fatherData.birthYear,
      father_birthMonth: fatherData.birthMonth,
      father_birthDay: fatherData.birthDay,
      father_gender: fatherData.gender,
      
      mother_fullNameHash: hashFullName(motherData.fullName),
      mother_isBirthBC: motherData.isBirthBC ? 1 : 0,
      mother_birthYear: motherData.birthYear,
      mother_birthMonth: motherData.birthMonth,
      mother_birthDay: motherData.birthDay,
      mother_gender: motherData.gender,
      
      hasFather: father ? 1 : 0,
      hasMother: mother ? 1 : 0,
      submitter: submitterAddress.replace('0x', '')
    }

    console.log('📊 Circuit input prepared:', {
      fullNameHashLength: input.fullNameHash.length,
      hasFather: input.hasFather,
      hasMother: input.hasMother,
      submitterLength: input.submitter.length,
      submitter: input.submitter
    })

    // Add cache-busting timestamp to force reload of wasm file
    const timestamp = Date.now()
    
    // Generate proof using snarkjs
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      `/zk/person_hash_zk.wasm?t=${timestamp}`,
      `/zk/person_hash_zk_final.zkey?t=${timestamp}`
    )

    return { proof, publicSignals }
  } catch (error) {
    console.error('Error generating ZK proof:', error)
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
    console.error('Error verifying proof:', error)
    return false
  }
}


