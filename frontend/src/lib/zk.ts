import { Contract, JsonRpcSigner, JsonRpcProvider, toUtf8Bytes, keccak256, solidityPackedKeccak256 } from 'ethers'
import DeepFamilyAbi from '../abi/DeepFamily.json'
// @ts-ignore
import * as snarkjs from 'snarkjs'
import { REASON_FRIENDLY_MAP, extractRevertReason } from './errors'

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

// Safe stringify that handles BigInt values for logging
function safeStringify(value: any) {
  try {
    return JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)
  } catch {
    return '[unstringifiable]'
  }
}

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
  // Note: snarkjs outputs G2 points as [[bx1, bx2], [by1, by2]] but Solidity verifier expects
  // the pairs in swapped order per limb for bn128 (see common Groth16 mappings).
  // Use [[b00, b01], [b10, b11]] = [[pi_b[0][1], pi_b[0][0]], [pi_b[1][1], pi_b[1][0]]]
  const b = [
    [toBigInt(proof.pi_b[0][1]), toBigInt(proof.pi_b[0][0])],
    [toBigInt(proof.pi_b[1][1]), toBigInt(proof.pi_b[1][0])],
  ]
  const c = [toBigInt(proof.pi_c[0]), toBigInt(proof.pi_c[1])]
  const pub = publicSignals.map(toBigInt)
  const addPersonArgs = [a, b, c, pub, fatherVersionIndex, motherVersionIndex, tag, metadataCID] as const

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
    let gasLimit: bigint | undefined
    
    try {
      const gasEstimate = await contract.addPersonZK.estimateGas(...addPersonArgs)
      console.log('⛽ Estimated gas:', gasEstimate.toString())
      gasLimit = gasEstimate * 120n / 100n
      console.log('⛽ Gas limit (with buffer):', gasLimit.toString())
    } catch (estimateError: any) {
      console.warn('⚠️ Gas estimation failed, attempting static call and fallback gas limit.', estimateError)
      const decodedReason = extractRevertReason(contract, estimateError)
      if (decodedReason) {
        ;(estimateError as any).__dfDecodedReason = decodedReason
      }

      try {
        await contract.addPersonZK.staticCall(...addPersonArgs)
        gasLimit = 6_500_000n
        console.log(`⛽ Static call succeeded after estimate failure; using fallback gas limit: ${gasLimit.toString()}`)
      } catch (staticError: any) {
        const staticReason = extractRevertReason(contract, staticError)
        if (staticReason) {
          ;(staticError as any).__dfDecodedReason = staticReason
        }
        throw staticError
      }
    }
    
    console.log('🚀 Calling contract.addPersonZK...')
    const tx = await contract.addPersonZK(...addPersonArgs, gasLimit ? { gasLimit } : {})
    console.log('✅ Transaction sent successfully:', tx.hash)
    
    // Wait for transaction confirmation and get receipt
    console.log('⏳ Waiting for transaction confirmation...')
    const receipt = await tx.wait()
    console.log('✅ Transaction confirmed in block:', receipt.blockNumber)
    
    // Parse all events from the transaction receipt
    const events = {
      PersonHashZKVerified: null as any,
      PersonVersionAdded: null as any,
      TokenRewardDistributed: null as any
    }
    
    let personHash = 'unknown'
    let versionIndex = 0
    let rewardAmount = 0
    
    console.log(`🔍 Total logs in receipt: ${receipt.logs.length}`)
    
    for (const log of receipt.logs) {
      try {
        const parsedEvent = contract.interface.parseLog(log)
        if (parsedEvent) {
          console.log(`📊 Event detected: ${parsedEvent.name}`, parsedEvent.args)
          
          switch (parsedEvent.name) {
            case 'PersonHashZKVerified':
              events.PersonHashZKVerified = {
                personHash: parsedEvent.args.personHash,
                prover: parsedEvent.args.prover
              }
              console.log('✅ PersonHashZKVerified:', events.PersonHashZKVerified)
              break
              
            case 'PersonVersionAdded':
              events.PersonVersionAdded = {
                personHash: parsedEvent.args.personHash,
                versionIndex: Number(parsedEvent.args.versionIndex),
                addedBy: parsedEvent.args.addedBy,
                timestamp: Number(parsedEvent.args.timestamp),
                fatherHash: parsedEvent.args.fatherHash,
                fatherVersionIndex: Number(parsedEvent.args.fatherVersionIndex),
                motherHash: parsedEvent.args.motherHash,
                motherVersionIndex: Number(parsedEvent.args.motherVersionIndex),
                tag: parsedEvent.args.tag
              }
              personHash = events.PersonVersionAdded.personHash
              versionIndex = events.PersonVersionAdded.versionIndex
              console.log('✅ PersonVersionAdded:', events.PersonVersionAdded)
              break
              
            case 'TokenRewardDistributed':
              events.TokenRewardDistributed = {
                miner: parsedEvent.args.miner,
                personHash: parsedEvent.args.personHash,
                versionIndex: Number(parsedEvent.args.versionIndex),
                reward: parsedEvent.args.reward.toString()
              }
              // Convert from wei to token units (divide by 10^18)
              rewardAmount = Number(parsedEvent.args.reward) / Math.pow(10, 18)
              console.log('🎁 TokenRewardDistributed:', events.TokenRewardDistributed)
              console.log('💰 Reward amount (converted):', rewardAmount, 'DEEP')
              break
          }
        }
      } catch (error) {
        // Log unparseable events for debugging
        console.log('🔍 Unparseable log:', {
          address: log.address,
          topics: log.topics,
          data: log.data
        })
        continue
      }
    }
    
    console.log('📊 All events parsed:', events)
    
    // Additional debugging for TokenRewardDistributed
    if (!events.TokenRewardDistributed) {
      console.log('⚠️ No TokenRewardDistributed event found')
      if (events.PersonVersionAdded) {
        console.log('🔍 Father hash:', events.PersonVersionAdded.fatherHash)
        console.log('🔍 Mother hash:', events.PersonVersionAdded.motherHash)
        console.log('💡 Token reward requires both parent hashes to exist in system')
      }
    }
    
    return {
      hash: personHash,
      index: versionIndex,
      rewardAmount,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
      events
    }
  } catch (contractError: any) {
    console.error('❌ Contract call failed:', contractError)
    console.error('📋 Full error object:', safeStringify(contractError))
    console.error('📋 Error properties:', {
      code: contractError?.code,
      reason: contractError?.reason,
      data: contractError?.data,
      message: contractError?.message,
      error: contractError?.error,
      transaction: contractError?.transaction
    })
    
    // Parse the specific error message to provide better user feedback
    let errorType = 'UNKNOWN_ERROR'
    let errorMessage = 'Unknown error occurred'
    let userMessage = 'An unexpected error occurred'
    let errorReason: string | null = null
    
    // Check for revert reasons (custom errors from smart contract)
    const reasonRaw = extractRevertReason(contract, contractError)
    const reason = typeof reasonRaw === 'string' ? reasonRaw.replace(/\(\)$/, '') : reasonRaw
    
    console.log('📋 Extracted revert reason:', reason)
    
    if (reason) {
      errorReason = reason
      errorType = reason
      errorMessage = REASON_FRIENDLY_MAP[reason] || `Contract reverted: ${reason}`
      userMessage = errorMessage
      ;(contractError as any).__dfReason = reason
    }
    // Check for gas-related errors
    else if (contractError?.code === 'REPLACEMENT_UNDERPRICED' || contractError?.message?.toLowerCase?.().includes('replacement fee too low')) {
      errorReason = 'REPLACEMENT_UNDERPRICED'
      errorType = errorReason
      errorMessage = REASON_FRIENDLY_MAP[errorReason] || 'Replacement transaction fee too low'
      userMessage = errorMessage
    }
    // Check for gas-related errors
    else if (contractError?.message?.includes('gas') || contractError?.code === 'UNPREDICTABLE_GAS_LIMIT') {
      errorReason = 'GAS_ERROR'
      errorType = errorReason
      errorMessage = REASON_FRIENDLY_MAP[errorReason] || 'Gas estimation failed or insufficient gas'
      userMessage = errorMessage
    }
    // Check for out of gas errors
    else if (contractError?.message?.includes('out of gas')) {
      errorReason = 'OUT_OF_GAS'
      errorType = errorReason
      errorMessage = REASON_FRIENDLY_MAP[errorReason] || 'Transaction ran out of gas during execution'
      userMessage = errorMessage
    }
    // Check for user rejection
    else if (contractError?.code === 'ACTION_REJECTED' || contractError?.message?.includes('rejected')) {
      errorReason = 'USER_REJECTED'
      errorType = errorReason
      errorMessage = REASON_FRIENDLY_MAP[errorReason] || 'User rejected the transaction'
      userMessage = errorMessage
    }
    // Check for network errors
    else if (contractError?.code === 'NETWORK_ERROR') {
      errorReason = 'NETWORK_ERROR'
      errorType = errorReason
      errorMessage = REASON_FRIENDLY_MAP[errorReason] || 'Network connection error'
      userMessage = errorMessage
    }
    // Check for insufficient funds
    else if (contractError?.message?.includes('insufficient funds')) {
      errorReason = 'INSUFFICIENT_FUNDS'
      errorType = errorReason
      errorMessage = REASON_FRIENDLY_MAP[errorReason] || 'Insufficient funds for gas'
      userMessage = errorMessage
    }
    // General call exception
    else if (contractError?.code === 'CALL_EXCEPTION') {
      errorReason = 'CALL_EXCEPTION'
      errorType = errorReason
      errorMessage = REASON_FRIENDLY_MAP[errorReason] || 'Contract call failed - likely a require() condition failed'
      userMessage = errorMessage
    }
    
    console.error('📋 Error analysis:', {
      errorType,
      errorMessage,
      userMessage,
      originalError: contractError
    })
    
    // Throw enhanced error with additional information
    const enhancedError = new Error(userMessage)
    ;(enhancedError as any).type = errorType
    ;(enhancedError as any).details = errorMessage
    ;(enhancedError as any).originalError = contractError
    ;(enhancedError as any).reason = (contractError as any).__dfReason || reason || errorReason
    ;(enhancedError as any).humanMessage = userMessage
    
    throw enhancedError
  }
}

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
  const hash = keccak256(toUtf8Bytes(value || ''))
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hash.slice(2 + i * 2, 4 + i * 2), 16)
  }
  return Array.from(bytes)
}

export function hashFullName(fullName: string): number[] {
  return keccakStringToBytes(fullName)
}

type PassphraseInput = string | number | bigint | Array<string | number | bigint> | undefined | null

export function hashPassphrase(passphrase: PassphraseInput): number[] {
  if (Array.isArray(passphrase)) {
    return passphrase.slice(0, 32).map((v) => Number(v) & 0xff)
  }
  const normalized = passphrase == null ? '' : String(passphrase)
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
      
      hasFather: father && father.fullName.trim() ? 1 : 0,
      hasMother: mother && mother.fullName.trim() ? 1 : 0,
      submitter: BigInt(submitterAddress).toString()
    }

    console.log('📊 Circuit input prepared:', {
      fullNameHashLength: input.fullNameHash.length,
      saltHashLength: input.saltHash.length,
      hasFather: input.hasFather,
      hasMother: input.hasMother,
      submitterLength: input.submitter.length,
      submitter: input.submitter
    })

    const { wasm, zkey } = await loadPersonHashArtifacts()

    // Generate proof using snarkjs
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey)

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
    console.error('Error generating name poseidon ZK proof:', error)
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
    console.error('Error verifying name poseidon proof:', error)
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
