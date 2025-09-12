import { Contract, JsonRpcSigner, JsonRpcProvider, toUtf8Bytes, keccak256, solidityPackedKeccak256 } from 'ethers'
import DeepFamilyAbi from '../abi/DeepFamily.json'
// @ts-ignore
import * as snarkjs from 'snarkjs'

type Groth16Proof = {
  pi_a: [string | bigint, string | bigint, string | bigint]
  pi_b: [[string | bigint, string | bigint], [string | bigint, string | bigint], [string | bigint, string | bigint]]
  pi_c: [string | bigint, string | bigint, string | bigint]
  protocol: string
  curve: string
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

  // Debug: Check proof structure
  console.log('🔍 Proof structure:', proof)
  console.log('🔍 Proof keys:', Object.keys(proof))
  console.log('🔍 Proof.pi_a:', proof.pi_a)
  console.log('🔍 Proof.pi_b:', proof.pi_b)
  console.log('🔍 Proof.pi_c:', proof.pi_c)

  // Validate proof structure (snarkjs format uses pi_a, pi_b, pi_c)
  if (!proof || !proof.pi_a || !proof.pi_b || !proof.pi_c) {
    throw new Error('Invalid proof structure: missing pi_a, pi_b, or pi_c components')
  }
  
  if (!Array.isArray(proof.pi_a) || proof.pi_a.length !== 3) {
    throw new Error('Invalid proof.pi_a: expected array of length 3')
  }
  
  if (!Array.isArray(proof.pi_b) || proof.pi_b.length !== 3 || !Array.isArray(proof.pi_b[0]) || !Array.isArray(proof.pi_b[1]) || !Array.isArray(proof.pi_b[2])) {
    throw new Error('Invalid proof.pi_b: expected 3x2 array structure')
  }
  
  if (!Array.isArray(proof.pi_c) || proof.pi_c.length !== 3) {
    throw new Error('Invalid proof.pi_c: expected array of length 3')
  }

  const contract = new Contract(contractAddress, DeepFamilyAbi.abi, signer)
  // Convert snarkjs format to contract format (take first 2 elements)
  const a = [toBigInt(proof.pi_a[0]), toBigInt(proof.pi_a[1])]
  const b = [
    [toBigInt(proof.pi_b[0][0]), toBigInt(proof.pi_b[0][1])],
    [toBigInt(proof.pi_b[1][0]), toBigInt(proof.pi_b[1][1])],
  ]
  const c = [toBigInt(proof.pi_c[0]), toBigInt(proof.pi_c[1])]
  const pub = publicSignals.map(toBigInt)

  // Debug: Log contract call parameters
  console.log('🔍 Contract call parameters:')
  console.log('  a:', a.map(x => x.toString()))
  console.log('  b:', b.map(row => row.map(x => x.toString())))
  console.log('  c:', c.map(x => x.toString()))
  console.log('  publicSignals:', pub.map(x => x.toString()))
  console.log('  fatherVersionIndex:', fatherVersionIndex)
  console.log('  motherVersionIndex:', motherVersionIndex)
  console.log('  tag:', tag)
  console.log('  metadataCID:', metadataCID)
  
  // Check public signals length
  console.log('🔍 Public signals validation:')
  console.log('  Length:', pub.length, '(expected: 7)')
  
  // Check limbs are in valid range (< 2^128)
  const TWO_POW_128 = 1n << 128n
  for (let i = 0; i < 6; i++) {
    const inRange = pub[i] < TWO_POW_128
    console.log(`  Limb[${i}]:`, pub[i].toString(), inRange ? '✅' : '❌ OUT OF RANGE')
  }
  
  // Check submitter
  const TWO_POW_160 = 1n << 160n
  const submitter = pub[6]
  const submitterInRange = submitter < TWO_POW_160
  console.log('  Submitter:', submitter.toString(), submitterInRange ? '✅' : '❌ OUT OF RANGE')
  
  // Get actual sender address for comparison
  const senderAddress = await signer.getAddress()
  const expectedSubmitter = BigInt(senderAddress)
  console.log('  Expected submitter:', expectedSubmitter.toString())
  console.log('  Submitter match:', submitter === expectedSubmitter ? '✅' : '❌ MISMATCH')

  try {
    console.log('🚀 Estimating gas for contract.addPersonZK...')
    
    // First estimate gas
    const gasEstimate = await contract.addPersonZK.estimateGas(a, b, c, pub, fatherVersionIndex, motherVersionIndex, tag, metadataCID)
    console.log('⛽ Estimated gas:', gasEstimate.toString())
    
    // Add 20% buffer to gas estimate
    const gasLimit = gasEstimate * 120n / 100n
    console.log('⛽ Gas limit (with buffer):', gasLimit.toString())
    
    console.log('🚀 Calling contract.addPersonZK...')
    const tx = await contract.addPersonZK(a, b, c, pub, fatherVersionIndex, motherVersionIndex, tag, metadataCID, {
      gasLimit: gasLimit
    })
    console.log('✅ Transaction sent successfully:', tx.hash)
    return tx
  } catch (contractError: any) {
    console.error('❌ Contract call failed:', contractError)
    
    // Check for specific error types
    if (contractError?.message?.includes('gas')) {
      throw new Error(`Gas related error: ${contractError.message}`)
    } else if (contractError?.message?.includes('out of gas')) {
      throw new Error('Transaction ran out of gas - ZK proof verification requires high gas limit')
    } else if (contractError?.reason) {
      throw new Error(`Contract error: ${contractError.reason}`)
    } else if (contractError?.code === 'CALL_EXCEPTION') {
      throw new Error('Contract call failed - likely a require() condition failed in the smart contract')
    } else {
      throw contractError
    }
  }
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
      
      hasFather: father && father.fullName.trim() ? 1 : 0,
      hasMother: mother && mother.fullName.trim() ? 1 : 0,
      submitter: BigInt(submitterAddress).toString()
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

    console.log('🔍 Generated proof object:', proof)
    console.log('🔍 Generated publicSignals:', publicSignals)
    console.log('🔍 Proof type:', typeof proof)
    console.log('🔍 Proof keys:', Object.keys(proof || {}))

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


