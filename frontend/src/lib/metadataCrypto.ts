import { sha256 } from "@noble/hashes/sha2";
import type { IdentitySaltMode } from "./identityHash";
import {
  DEFAULT_FILE_KDF_CONFIG,
  type Argon2idParams,
  type FileEncryptionKdfConfig,
  bytesToBase64,
  base64ToBytes,
  deriveFileEncryptionKeyBytes,
  generateRandomSalt,
} from "./secretDerivation";
import { normalizePassphraseForHash } from "./passphraseStrength";

export const METADATA_AAD = "deepfamily/person-version@2.0";
export const METADATA_SCHEMA = "deepfamily/person-version@2.0";
export const METADATA_VERSION = "df-meta-v2";
export const MAX_ENCRYPTED_PAYLOAD_CHARS = 2000000;
export const MAX_SALT_BYTES = 64;
export const MAX_IV_BYTES = 64;
export const MAX_CIPHERTEXT_BYTES = 2000000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type EncryptedMetadataPayloadV2 = {
  version: string;
  schema: string;
  cipher: "AES-256-GCM";
  aad: string;
  kdf: {
    alg: "Argon2id";
    kdfVersion: number;
    memoryKiB: number;
    iterations: number;
    parallelism: number;
    outputBytes: number;
    salt: string;
  };
  iv: string;
  ciphertext: string;
  tag: string;
};

export type MetadataRecoveryV2 = {
  identityMode?: IdentitySaltMode;
  identityKdf: {
    algorithm: "Argon2id";
    kdfVersion: number;
    params: Argon2idParams;
    saltHex: string;
  };
};

export type AnyEncryptedMetadataPayload = EncryptedMetadataPayloadV2;

export const toBase64 = (data: Uint8Array) => {
  let binary = "";
  data.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

export const fromBase64 = (b64: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(b64);
  const buf = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const toHex = (data: Uint8Array) =>
  Array.from(data)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export const sha256Hex = (input: string) => toHex(sha256(encoder.encode(input)));

export const passwordFingerprint = (password: string) => {
  const normalized = normalizePassphraseForHash(password || "");
  return sha256Hex(normalized);
};

const getWebCrypto = (): Crypto => {
  const cryptoObj = (globalThis as any)?.crypto as Crypto | undefined;
  if (!cryptoObj?.subtle) {
    throw new Error("Web Crypto is not available in this environment");
  }
  return cryptoObj;
};

const toArrayBufferBytes = (input: Uint8Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(input.byteLength));
  out.set(input);
  return out;
};

export const encryptMetadataJsonV2 = async (
  plaintext: string,
  password: string,
  opts?: {
    aad?: string;
    schema?: string;
    version?: string;
    fileKdfConfig?: FileEncryptionKdfConfig;
  },
): Promise<{ payload: EncryptedMetadataPayloadV2; plainHash: string }> => {
  const cryptoObj = getWebCrypto();
  const normalizedPassword = normalizePassphraseForHash(password || "");
  const aad = opts?.aad ?? METADATA_AAD;
  const config = opts?.fileKdfConfig ?? DEFAULT_FILE_KDF_CONFIG;
  const salt = generateRandomSalt(16);
  const iv = new Uint8Array(new ArrayBuffer(12));
  cryptoObj.getRandomValues(iv);

  const keyBytes = await deriveFileEncryptionKeyBytes({
    password: normalizedPassword,
    salt,
    config,
  });
  const rawKeyBytes = toArrayBufferBytes(keyBytes);

  const key = await cryptoObj.subtle.importKey(
    "raw",
    rawKeyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  const ciphertextBuffer = await cryptoObj.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(plaintext),
  );

  const ciphertext = new Uint8Array(ciphertextBuffer);
  const tag = ciphertext.slice(ciphertext.length - 16);
  const plainHash = sha256Hex(plaintext);

  const payload: EncryptedMetadataPayloadV2 = {
    version: opts?.version ?? METADATA_VERSION,
    schema: opts?.schema ?? METADATA_SCHEMA,
    cipher: "AES-256-GCM",
    aad,
    kdf: {
      alg: "Argon2id",
      kdfVersion: config.kdfVersion,
      memoryKiB: config.params.memoryKiB,
      iterations: config.params.iterations,
      parallelism: config.params.parallelism,
      outputBytes: config.params.outputBytes,
      salt: bytesToBase64(salt),
    },
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    tag: toBase64(tag),
  };

  return { payload, plainHash };
};

const estimateBase64Bytes = (b64: string): number => {
  if (!b64) return 0;
  const trimmed = b64.trim();
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0;
  return Math.floor((trimmed.length * 3) / 4) - padding;
};

const safeFromBase64 = (
  b64: string,
  opts: { maxBytes: number; label: string },
): Uint8Array<ArrayBuffer> => {
  const value = (b64 ?? "").trim();
  if (!value) throw new Error(`Invalid encrypted payload: missing ${opts.label}`);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error(`Invalid encrypted payload: ${opts.label} is not valid base64`);
  }
  const estimatedBytes = estimateBase64Bytes(value);
  if (estimatedBytes < 0 || estimatedBytes > opts.maxBytes) {
    throw new Error(`Invalid encrypted payload: ${opts.label} is too large`);
  }
  try {
    return fromBase64(value);
  } catch {
    throw new Error(`Invalid encrypted payload: ${opts.label} base64 decode failed`);
  }
};

export const decryptMetadataPayloadV2 = async (
  payloadOrJson: string | EncryptedMetadataPayloadV2,
  password: string,
): Promise<{
  plaintext: string;
  data: any;
  hash: string;
  payload: EncryptedMetadataPayloadV2;
}> => {
  const cryptoObj = getWebCrypto();
  const normalizedPassword = normalizePassphraseForHash(password || "");
  if (typeof payloadOrJson === "string" && payloadOrJson.length > MAX_ENCRYPTED_PAYLOAD_CHARS) {
    throw new Error("Invalid encrypted payload: payload is too large");
  }

  const payload: EncryptedMetadataPayloadV2 =
    typeof payloadOrJson === "string" ? JSON.parse(payloadOrJson) : payloadOrJson;

  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid encrypted payload: not an object");
  }
  if (payload?.kdf?.alg !== "Argon2id") {
    throw new Error("Invalid encrypted payload: unsupported kdf algorithm");
  }

  const salt = safeFromBase64(payload?.kdf?.salt || "", {
    maxBytes: MAX_SALT_BYTES,
    label: "kdf.salt",
  });
  const iv = safeFromBase64(payload?.iv || "", { maxBytes: MAX_IV_BYTES, label: "iv" });
  if (salt.length !== 16) throw new Error("Invalid encrypted payload: salt length mismatch");
  if (iv.length !== 12) throw new Error("Invalid encrypted payload: iv length mismatch");

  const aad = payload?.aad ?? payload?.schema ?? METADATA_AAD;
  if (typeof aad !== "string" || !aad) throw new Error("Invalid encrypted payload: missing aad");

  const config: FileEncryptionKdfConfig = {
    kdfVersion: payload.kdf.kdfVersion,
    algorithm: "Argon2id",
    params: {
      memoryKiB: payload.kdf.memoryKiB,
      iterations: payload.kdf.iterations,
      parallelism: payload.kdf.parallelism,
      outputBytes: payload.kdf.outputBytes,
    },
  };

  const keyBytes = await deriveFileEncryptionKeyBytes({
    password: normalizedPassword,
    salt,
    config,
  });
  const rawKeyBytes = toArrayBufferBytes(keyBytes);
  const key = await cryptoObj.subtle.importKey(
    "raw",
    rawKeyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  const cipherBytes = safeFromBase64(payload?.ciphertext || "", {
    maxBytes: MAX_CIPHERTEXT_BYTES,
    label: "ciphertext",
  });
  const tagBytes = safeFromBase64(payload?.tag || "", { maxBytes: 32, label: "tag" });
  if (tagBytes.length !== 16) throw new Error("Invalid encrypted payload: tag length mismatch");
  const tailTag = cipherBytes.slice(cipherBytes.length - 16);
  for (let i = 0; i < 16; i += 1) {
    if (tailTag[i] !== tagBytes[i]) throw new Error("Invalid encrypted payload: tag mismatch");
  }

  const plainBuffer = await cryptoObj.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key,
    cipherBytes,
  );

  const plaintext = decoder.decode(plainBuffer);
  const hashHex = sha256Hex(plaintext);
  const hashWithPrefix = `sha256:${hashHex}`;
  const data = JSON.parse(plaintext);
  return { plaintext, data, hash: hashWithPrefix, payload };
};

export const decryptMetadataPayload = async (
  payloadOrJson: string | EncryptedMetadataPayloadV2,
  password: string,
): Promise<{
  plaintext: string;
  data: any;
  hash: string;
  payload: EncryptedMetadataPayloadV2;
}> => {
  return await decryptMetadataPayloadV2(payloadOrJson, password);
};

export const parseEncryptedPayload = (json: string): AnyEncryptedMetadataPayload | null => {
  try {
    const payload = JSON.parse(json);
    return payload?.kdf?.alg === "Argon2id" ? payload : null;
  } catch {
    return null;
  }
};
