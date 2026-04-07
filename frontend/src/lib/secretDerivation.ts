import { argon2id } from "hash-wasm";

export type Argon2idParams = {
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  outputBytes: number;
};

export type IdentityKdfConfig = {
  kdfVersion: number;
  algorithm: "Argon2id";
  params: Argon2idParams;
};

export type FileEncryptionKdfConfig = {
  kdfVersion: number;
  algorithm: "Argon2id";
  params: Argon2idParams;
};

export type DerivedSecretBundleV2 = {
  kdfVersion: number;
  algorithm: "Argon2id";
  saltHex: string;
  saltEncoding: "hex";
  params: Argon2idParams;
  derivedSecretHex: string;
  derivedSecretEncoding: "hex";
};

export const SNARK_FIELD = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617",
);

export const DEFAULT_SALT_BYTES = 16;

export const DEFAULT_IDENTITY_KDF_CONFIG: IdentityKdfConfig = {
  kdfVersion: 1,
  algorithm: "Argon2id",
  params: {
    memoryKiB: 65536,
    iterations: 3,
    parallelism: 1,
    outputBytes: 32,
  },
};

export const DEFAULT_FILE_KDF_CONFIG: FileEncryptionKdfConfig = {
  kdfVersion: 1,
  algorithm: "Argon2id",
  params: {
    memoryKiB: 65536,
    iterations: 3,
    parallelism: 1,
    outputBytes: 32,
  },
};

export function generateRandomSalt(byteLength: number = DEFAULT_SALT_BYTES): Uint8Array {
  if (!Number.isInteger(byteLength) || byteLength <= 0) {
    throw new Error("Salt length must be a positive integer");
  }
  const cryptoObj = (globalThis as any)?.crypto as Crypto | undefined;
  if (!cryptoObj?.getRandomValues) {
    throw new Error("Web Crypto is not available in this environment");
  }
  const salt = new Uint8Array(byteLength);
  cryptoObj.getRandomValues(salt);
  return salt;
}

export function bytesToHex(input: Uint8Array): string {
  return Array.from(input)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(input: string): Uint8Array {
  const value = (input ?? "").trim().replace(/^0x/i, "");
  if (!value || value.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(value)) {
    throw new Error("Invalid hex string");
  }
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < value.length; i += 2) {
    out[i / 2] = parseInt(value.slice(i, i + 2), 16);
  }
  return out;
}

export function bytesToBase64(input: Uint8Array): string {
  let binary = "";
  input.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function base64ToBytes(input: string): Uint8Array {
  const binary = atob(input);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function mapBytesToSnarkField(input: Uint8Array): bigint {
  if (!(input instanceof Uint8Array) || input.length === 0) {
    throw new Error("Input bytes are required");
  }
  const hex = bytesToHex(input);
  return BigInt(`0x${hex}`) % SNARK_FIELD;
}

export async function deriveArgon2idBytes(input: {
  password: string;
  salt: Uint8Array;
  params: Argon2idParams;
}): Promise<Uint8Array> {
  const { password, salt, params } = input;
  if (typeof password !== "string") throw new Error("Password must be a string");
  if (!(salt instanceof Uint8Array) || salt.length === 0) throw new Error("Salt is required");

  const hex = await argon2id({
    password,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memoryKiB,
    hashLength: params.outputBytes,
    outputType: "hex",
  });

  return hexToBytes(hex);
}

export async function deriveIdentitySecretV2(input: {
  passphrase: string;
  salt?: Uint8Array;
  config?: IdentityKdfConfig;
}): Promise<DerivedSecretBundleV2> {
  const config = input.config ?? DEFAULT_IDENTITY_KDF_CONFIG;
  const salt = input.salt ?? generateRandomSalt();
  const derivedSecret = await deriveArgon2idBytes({
    password: input.passphrase,
    salt,
    params: config.params,
  });

  return {
    kdfVersion: config.kdfVersion,
    algorithm: config.algorithm,
    saltHex: bytesToHex(salt),
    saltEncoding: "hex",
    params: config.params,
    derivedSecretHex: bytesToHex(derivedSecret),
    derivedSecretEncoding: "hex",
  };
}

export async function deriveFileEncryptionKeyBytes(input: {
  password: string;
  salt: Uint8Array;
  config?: FileEncryptionKdfConfig;
}): Promise<Uint8Array> {
  const config = input.config ?? DEFAULT_FILE_KDF_CONFIG;
  return await deriveArgon2idBytes({
    password: input.password,
    salt: input.salt,
    params: config.params,
  });
}
