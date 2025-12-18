// ZK proof generation / verification via snarkjs.
// Intentionally separated from `zk.ts` so the main thread can import helpers/types
// without bundling snarkjs (the heavy dependency) into the UI bundle.

import { normalizeNameForHash } from './passphraseStrength'
import type { Groth16Proof, PersonData } from './zk'
import { hashFullName, hashPassphrase } from './zk'
// @ts-ignore
import * as snarkjs from 'snarkjs'

type ZkArtifacts = {
  wasm: Uint8Array
  zkey: Uint8Array
}

let personHashArtifactsPromise: Promise<ZkArtifacts> | null = null
let namePoseidonArtifactsPromise: Promise<ZkArtifacts> | null = null
let personHashVkeyPromise: Promise<any> | null = null
let namePoseidonVkeyPromise: Promise<any> | null = null

async function loadArtifacts(wasmUrl: string, zkeyUrl: string): Promise<ZkArtifacts> {
  const [wasmRes, zkeyRes] = await Promise.all([fetch(wasmUrl), fetch(zkeyUrl)])
  if (!wasmRes.ok) throw new Error(`Failed to load wasm from ${wasmUrl}: ${wasmRes.status}`)
  if (!zkeyRes.ok) throw new Error(`Failed to load zkey from ${zkeyUrl}: ${zkeyRes.status}`)
  const [wasmBuffer, zkeyBuffer] = await Promise.all([wasmRes.arrayBuffer(), zkeyRes.arrayBuffer()])
  return { wasm: new Uint8Array(wasmBuffer), zkey: new Uint8Array(zkeyBuffer) }
}

async function loadJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load json from ${url}: ${res.status}`)
  return await res.json()
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

async function loadPersonHashVkey(): Promise<any> {
  if (!personHashVkeyPromise) {
    personHashVkeyPromise = (async () => {
      try {
        return await loadJson('/zk/person_hash_zk.vkey.json')
      } catch (error) {
        personHashVkeyPromise = null
        throw error
      }
    })()
  }
  return personHashVkeyPromise
}

async function loadNamePoseidonVkey(): Promise<any> {
  if (!namePoseidonVkeyPromise) {
    namePoseidonVkeyPromise = (async () => {
      try {
        return await loadJson('/zk/name_poseidon_zk.vkey.json')
      } catch (error) {
        namePoseidonVkeyPromise = null
        throw error
      }
    })()
  }
  return namePoseidonVkeyPromise
}

export async function generatePersonProof(
  person: PersonData,
  father: PersonData | null,
  mother: PersonData | null,
  submitterAddress: string
): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
  // Create default parent data if they don't exist
  const defaultParent: PersonData = {
    fullName: '',
    passphrase: '',
    birthYear: 0,
    birthMonth: 1,
    birthDay: 1,
    isBirthBC: false,
    gender: 1,
  }

  const fatherData = father || defaultParent
  const motherData = mother || defaultParent

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
    submitter: BigInt(submitterAddress).toString(),
  }

  const { wasm, zkey } = await loadPersonHashArtifacts()
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey)
  return { proof, publicSignals }
}

export async function verifyProof(proof: Groth16Proof, publicSignals: string[]): Promise<boolean> {
  const vKey = await loadPersonHashVkey()
  return await snarkjs.groth16.verify(vKey, publicSignals, proof)
}

export async function generateNamePoseidonProof(
  fullName: string,
  passphrase: string,
  minterAddress: string
): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
  if (!minterAddress || minterAddress.length === 0) {
    throw new Error('Minter address is required to generate the name poseidon proof')
  }

  const input = {
    fullNameHash: hashFullName(fullName),
    saltHash: hashPassphrase(passphrase),
    minter: BigInt(minterAddress).toString(),
  }

  const { wasm, zkey } = await loadNamePoseidonArtifacts()
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey)
  return { proof, publicSignals }
}

export async function verifyNamePoseidonProof(proof: Groth16Proof, publicSignals: string[]): Promise<boolean> {
  const vKey = await loadNamePoseidonVkey()
  return await snarkjs.groth16.verify(vKey, publicSignals, proof)
}

