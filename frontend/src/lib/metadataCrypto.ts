import { sha256 } from "@noble/hashes/sha2";
import { normalizePassphraseForHash } from "./passphraseStrength";

export const METADATA_AAD = "deepfamily/person-version@1.0";
export const METADATA_SCHEMA = "deepfamily/person-version@1.0";
export const METADATA_VERSION = "df-meta-v1";
export const DEFAULT_ITERATIONS = 100000;
export const MAX_ITERATIONS = 1000000;
export const MAX_ENCRYPTED_PAYLOAD_CHARS = 2000000;
export const MAX_SALT_BYTES = 64;
export const MAX_IV_BYTES = 64;
export const MAX_CIPHERTEXT_BYTES = 2000000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type EncryptedMetadataPayload = {
  version: string;
  schema: string;
  cipher: string;
  aad: string;
  kdf: { alg: string; iter: number; salt: string };
  iv: string;
  ciphertext: string;
  tag: string;
};

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

export const encryptMetadataJson = async (
  plaintext: string,
  password: string,
  opts?: {
    aad?: string;
    iterations?: number;
    schema?: string;
    version?: string;
  },
): Promise<{ payload: EncryptedMetadataPayload; plainHash: string }> => {
  const cryptoObj = getWebCrypto();

  const normalizedPassword = normalizePassphraseForHash(password || "");
  const salt = new Uint8Array(new ArrayBuffer(16));
  const iv = new Uint8Array(new ArrayBuffer(12));
  cryptoObj.getRandomValues(salt);
  cryptoObj.getRandomValues(iv);
  const aad = opts?.aad ?? METADATA_AAD;
  const iterations = opts?.iterations ?? DEFAULT_ITERATIONS;
  const keyMaterial = await cryptoObj.subtle.importKey(
    "raw",
    encoder.encode(normalizedPassword),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await cryptoObj.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
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

  const payload: EncryptedMetadataPayload = {
    version: opts?.version ?? METADATA_VERSION,
    schema: opts?.schema ?? METADATA_SCHEMA,
    cipher: "AES-256-GCM",
    aad,
    kdf: {
      alg: "PBKDF2-SHA256",
      iter: iterations,
      salt: toBase64(salt),
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

const coerceIterations = (iter: unknown): number => {
  if (typeof iter !== "number" || !Number.isFinite(iter)) {
    throw new Error("Invalid encrypted payload: invalid kdf.iter");
  }
  const intIter = Math.floor(iter);
  if (intIter < 1) throw new Error("Invalid encrypted payload: invalid kdf.iter");
  if (intIter > MAX_ITERATIONS) throw new Error("Invalid encrypted payload: kdf.iter too large");
  return intIter;
};

export const decryptMetadataPayload = async (
  payloadOrJson: string | EncryptedMetadataPayload,
  password: string,
  opts?: {
    aad?: string;
    iterations?: number;
  },
): Promise<{
  plaintext: string;
  data: any;
  hash: string;
  payload: EncryptedMetadataPayload;
}> => {
  const cryptoObj = getWebCrypto();

  const normalizedPassword = normalizePassphraseForHash(password || "");
  if (typeof payloadOrJson === "string" && payloadOrJson.length > MAX_ENCRYPTED_PAYLOAD_CHARS) {
    throw new Error("Invalid encrypted payload: payload is too large");
  }

  const payload: EncryptedMetadataPayload =
    typeof payloadOrJson === "string" ? JSON.parse(payloadOrJson) : payloadOrJson;

  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid encrypted payload: not an object");
  }
  if (typeof payload?.version !== "string" || !payload.version) {
    throw new Error("Invalid encrypted payload: missing version");
  }
  if (typeof payload?.schema !== "string" || !payload.schema) {
    throw new Error("Invalid encrypted payload: missing schema");
  }
  if (payload?.cipher && payload.cipher !== "AES-256-GCM") {
    throw new Error("Invalid encrypted payload: unsupported cipher");
  }
  if (payload?.kdf?.alg && payload.kdf.alg !== "PBKDF2-SHA256") {
    throw new Error("Invalid encrypted payload: unsupported kdf algorithm");
  }

  const salt = safeFromBase64(payload?.kdf?.salt || "", {
    maxBytes: MAX_SALT_BYTES,
    label: "kdf.salt",
  });
  const iv = safeFromBase64(payload?.iv || "", { maxBytes: MAX_IV_BYTES, label: "iv" });
  if (salt.length !== 16) throw new Error("Invalid encrypted payload: salt length mismatch");
  if (iv.length !== 12) throw new Error("Invalid encrypted payload: iv length mismatch");

  const aad = opts?.aad ?? payload?.aad ?? payload?.schema ?? METADATA_AAD;
  if (typeof aad !== "string" || !aad) throw new Error("Invalid encrypted payload: missing aad");
  if (aad.length > 256) throw new Error("Invalid encrypted payload: aad too long");

  const iterations =
    opts?.iterations ??
    (payload?.kdf?.iter != null ? coerceIterations(payload.kdf.iter) : DEFAULT_ITERATIONS);

  const keyMaterial = await cryptoObj.subtle.importKey(
    "raw",
    encoder.encode(normalizedPassword),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await cryptoObj.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  const cipherBytes = safeFromBase64(payload?.ciphertext || "", {
    maxBytes: MAX_CIPHERTEXT_BYTES,
    label: "ciphertext",
  });
  if (cipherBytes.length < 16) throw new Error("Invalid encrypted payload: ciphertext too short");
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

export const parseEncryptedPayload = (json: string): EncryptedMetadataPayload | null => {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
};
