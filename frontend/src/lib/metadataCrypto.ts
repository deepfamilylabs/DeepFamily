import { sha256 } from '@noble/hashes/sha2'
import { normalizePassphraseForHash } from './passphraseStrength'

export const METADATA_AAD = 'deepfamily/person-version@1.0'
export const METADATA_SCHEMA = 'deepfamily/person-version@1.0'
export const METADATA_VERSION = 'df-meta-v1'
export const DEFAULT_ITERATIONS = 100000

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type EncryptedMetadataPayload = {
  version: string
  schema: string
  cipher: string
  aad: string
  kdf: { alg: string; iter: number; salt: string }
  iv: string
  ciphertext: string
  tag: string
  plainHash: string
}

export const toBase64 = (data: Uint8Array) => {
  let binary = ''
  data.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

export const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0))

export const toHex = (data: Uint8Array) => Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('')

export const sha256Hex = (input: string) => toHex(sha256(encoder.encode(input)))

export const passwordFingerprint = (password: string) => {
  const normalized = normalizePassphraseForHash(password || '')
  return sha256Hex(normalized)
}

const ensureWebCrypto = () => {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('Web Crypto is not available in this environment')
  }
}

export const encryptMetadataJson = async (
  plaintext: string,
  password: string,
  opts?: {
    aad?: string
    iterations?: number
    schema?: string
    version?: string
  }
): Promise<{ payload: EncryptedMetadataPayload; plainHash: string }> => {
  ensureWebCrypto()

  const normalizedPassword = normalizePassphraseForHash(password || '')
  const salt = window.crypto.getRandomValues(new Uint8Array(16))
  const iv = window.crypto.getRandomValues(new Uint8Array(12))
  const aad = opts?.aad ?? METADATA_AAD
  const iterations = opts?.iterations ?? DEFAULT_ITERATIONS
  const keyMaterial = await window.crypto.subtle.importKey('raw', encoder.encode(normalizedPassword), 'PBKDF2', false, ['deriveKey'])
  const key = await window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )

  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(plaintext)
  )

  const ciphertext = new Uint8Array(ciphertextBuffer)
  const tag = ciphertext.slice(ciphertext.length - 16)
  const plainHash = sha256Hex(plaintext)

  const payload: EncryptedMetadataPayload = {
    version: opts?.version ?? METADATA_VERSION,
    schema: opts?.schema ?? METADATA_SCHEMA,
    cipher: 'AES-256-GCM',
    aad,
    kdf: {
      alg: 'PBKDF2-SHA256',
      iter: iterations,
      salt: toBase64(salt)
    },
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    tag: toBase64(tag),
    plainHash: `sha256:${plainHash}`
  }

  return { payload, plainHash }
}

export const decryptMetadataPayload = async (
  payloadOrJson: string | EncryptedMetadataPayload,
  password: string,
  opts?: {
    aad?: string
    iterations?: number
  }
): Promise<{
  plaintext: string
  data: any
  hash: string
  payload: EncryptedMetadataPayload
}> => {
  ensureWebCrypto()

  const normalizedPassword = normalizePassphraseForHash(password || '')
  const payload: EncryptedMetadataPayload = typeof payloadOrJson === 'string' ? JSON.parse(payloadOrJson) : payloadOrJson
  const salt = fromBase64(payload?.kdf?.salt || '')
  const iv = fromBase64(payload?.iv || '')
  const aad = opts?.aad ?? payload?.aad ?? payload?.schema ?? METADATA_AAD
  const iterations = opts?.iterations ?? payload?.kdf?.iter ?? DEFAULT_ITERATIONS

  const keyMaterial = await window.crypto.subtle.importKey('raw', encoder.encode(normalizedPassword), 'PBKDF2', false, ['deriveKey'])
  const key = await window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )

  const cipherBytes = fromBase64(payload?.ciphertext || '')
  const plainBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
    key,
    cipherBytes
  )

  const plaintext = decoder.decode(plainBuffer)
  const hashHex = sha256Hex(plaintext)
  const hashWithPrefix = `sha256:${hashHex}`

  if (payload?.plainHash && payload.plainHash !== hashWithPrefix) {
    throw new Error('Plaintext hash verification failed')
  }

  const data = JSON.parse(plaintext)
  return { plaintext, data, hash: hashWithPrefix, payload }
}

export const parseEncryptedPayload = (json: string): EncryptedMetadataPayload | null => {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}
