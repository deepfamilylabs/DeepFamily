import { Contract, JsonRpcSigner, JsonRpcProvider, toUtf8Bytes, keccak256, solidityPackedKeccak256 } from 'ethers'
import DeepFamilyAbi from '../abi/DeepFamily.json'

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
  if (!Array.isArray(publicSignals) || publicSignals.length !== 17) {
    throw new Error('publicSignals length must be 17')
  }
  const TWO_POW_64 = 1n << 64n
  for (let i = 0; i < 16; i++) {
    const limb = toBigInt(publicSignals[i])
    if (limb < 0n || limb >= TWO_POW_64) throw new Error(`publicSignals[${i}] not in [0,2^64)`) 
  }
  const submitter = toBigInt(publicSignals[16])
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


