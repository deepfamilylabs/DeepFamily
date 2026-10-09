import { argon2id } from "hash-wasm";
import { getBytes, sha256 } from "ethers";
import {
  asUint8Array,
  bigintFrom,
  bytesToHex,
  concatBytes,
  copyBytes,
  decodeUtf8Fatal,
  equalHexConstantTime,
  utf8Bytes,
  wipeBytes,
} from "./bytes.js";
import { MAX_UINT64 } from "./constants.js";
import { ProtocolError, protocolAssert } from "./errors.js";
import { assertAddress } from "./identity.js";
import {
  buildShieldedAssetSigningMessage,
  deriveShieldedAssetKeyMaterial,
} from "./shielded-asset-keys.js";

export const SHIELDED_ASSET_VAULT_VERSION = 1;
export const SHIELDED_ASSET_VAULT_MAX_BYTES = 65_536;
export const SHIELDED_ASSET_VAULT_KDF = Object.freeze({
  memoryKiB: 65_536,
  iterations: 3,
  parallelism: 1,
});
const MAGIC = utf8Bytes("DFAVLT01");
const HEADER_BYTES = 51;

function cryptoApi() {
  protocolAssert(
    globalThis.crypto?.subtle && typeof globalThis.crypto.getRandomValues === "function",
    "SECURE_CRYPTO_UNAVAILABLE",
    "Web Crypto is required for the asset vault",
  );
  return globalThis.crypto;
}

function onlyKeys(value, keys, label) {
  protocolAssert(
    value && typeof value === "object" && !Array.isArray(value),
    "INVALID_ASSET_VAULT",
    `${label} must be an object`,
  );
  protocolAssert(
    Object.keys(value).every((key) => keys.includes(key)),
    "INVALID_ASSET_VAULT",
    `${label} has unsupported fields`,
  );
}

function version(value, expected, label) {
  protocolAssert(value === expected, "UNSUPPORTED_ASSET_VAULT_VERSION", `Unsupported ${label}`);
  return expected;
}

function nonzeroAddress(value, label) {
  const address = assertAddress(value, label).toLowerCase();
  protocolAssert(BigInt(address) > 0n, "INVALID_ASSET_DISCOVERY", `${label} must be nonzero`);
  return address;
}

export function normalizeShieldedAssetDiscovery(discovery) {
  protocolAssert(
    Array.isArray(discovery) && discovery.length > 0 && discovery.length <= 64,
    "INVALID_ASSET_DISCOVERY",
    "One to 64 discovery contexts are required",
  );
  const seen = new Set();
  return discovery.map((item) => {
    onlyKeys(
      item,
      [
        "chainId",
        "factoryAddress",
        "factoryDeploymentBlock",
        "lineageIndexAddress",
        "verifierAddress",
        "protocolVersion",
      ],
      "Discovery context",
    );
    const chainId = bigintFrom(item.chainId, "chainId", MAX_UINT64);
    protocolAssert(
      chainId > 0n &&
        Number.isSafeInteger(item.factoryDeploymentBlock) &&
        item.factoryDeploymentBlock >= 0,
      "INVALID_ASSET_DISCOVERY",
      "Discovery chain and deployment block are invalid",
    );
    const factoryAddress = nonzeroAddress(item.factoryAddress, "factoryAddress");
    const id = `${chainId}:${factoryAddress}`;
    protocolAssert(!seen.has(id), "INVALID_ASSET_DISCOVERY", "Duplicate discovery context");
    seen.add(id);
    return {
      chainId: chainId.toString(),
      factoryAddress,
      factoryDeploymentBlock: item.factoryDeploymentBlock,
      lineageIndexAddress: nonzeroAddress(item.lineageIndexAddress, "lineageIndexAddress"),
      verifierAddress: nonzeroAddress(item.verifierAddress, "verifierAddress"),
      protocolVersion: version(item.protocolVersion, 3, "pool protocol version"),
    };
  });
}

function normalizeSignatureMetadata(input) {
  onlyKeys(
    input,
    [
      "signerAddress",
      "message",
      "messageHash",
      "messageVersion",
      "signatureVersion",
      "rootKdfVersion",
      "method",
    ],
    "Signature metadata",
  );
  const signerAddress = nonzeroAddress(input.signerAddress, "signerAddress");
  const message = buildShieldedAssetSigningMessage(signerAddress);
  const messageHash = sha256(utf8Bytes(message));
  protocolAssert(
    input.message === message &&
      equalHexConstantTime(input.messageHash, messageHash) &&
      input.method === "personal_sign",
    "INVALID_ASSET_VAULT",
    "Signature metadata does not match the frozen signing specification",
  );
  return {
    signerAddress,
    message,
    messageHash,
    messageVersion: version(input.messageVersion, 1, "signing message version"),
    signatureVersion: version(input.signatureVersion, 1, "signature normalization version"),
    rootKdfVersion: version(input.rootKdfVersion, 1, "signature root KDF version"),
    method: "personal_sign",
  };
}

async function normalizePayload(input) {
  onlyKeys(
    input,
    [
      "assetRoot",
      "rootSource",
      "signatureMetadata",
      "discovery",
      "assetSuite",
      "branchVersion",
      "rootGenerationVersion",
      "fundsFingerprint",
    ],
    "Asset vault payload",
  );
  const assetRoot = copyBytes(input.assetRoot, "assetRoot");
  try {
    protocolAssert(
      assetRoot.length === 32 &&
        (input.rootSource === "random" || input.rootSource === "walletSignature"),
      "INVALID_ASSET_VAULT",
      "Invalid root or root source",
    );
    const assetSuite = version(input.assetSuite ?? 1, 1, "asset suite");
    const branchVersion = version(input.branchVersion ?? 1, 1, "asset branch version");
    const rootGenerationVersion = version(
      input.rootGenerationVersion ?? 1,
      1,
      "root generation version",
    );
    const signatureMetadata =
      input.rootSource === "walletSignature"
        ? normalizeSignatureMetadata(input.signatureMetadata)
        : undefined;
    protocolAssert(
      input.rootSource !== "random" || input.signatureMetadata === undefined,
      "INVALID_ASSET_VAULT",
      "Random roots have no signature metadata",
    );
    const keys = await deriveShieldedAssetKeyMaterial(assetRoot);
    if (input.fundsFingerprint !== undefined) {
      protocolAssert(
        equalHexConstantTime(input.fundsFingerprint, keys.fundsFingerprint),
        "ASSET_FINGERPRINT_MISMATCH",
        "Asset vault fingerprint does not match its actual root",
      );
    }
    return {
      assetRoot: bytesToHex(assetRoot),
      rootSource: input.rootSource,
      assetSuite,
      branchVersion,
      rootGenerationVersion,
      fundsFingerprint: keys.fundsFingerprint,
      ...(signatureMetadata ? { signatureMetadata } : {}),
      discovery: normalizeShieldedAssetDiscovery(input.discovery),
    };
  } finally {
    wipeBytes(assetRoot);
  }
}

/** The default credential has 128 random bits; the caller must preserve it separately. */
export function generateShieldedVaultUnlockCredential() {
  const bytes = cryptoApi().getRandomValues(new Uint8Array(16));
  try {
    return bytesToHex(bytes);
  } finally {
    wipeBytes(bytes);
  }
}

async function vaultKey(unlockCredential, salt) {
  const credential =
    typeof unlockCredential === "string"
      ? utf8Bytes(unlockCredential)
      : copyBytes(unlockCredential, "unlockCredential");
  protocolAssert(
    credential.length >= 16 && credential.length <= 1024,
    "INVALID_VAULT_CREDENTIAL",
    "Vault credential must contain 16 to 1024 bytes",
  );
  const password = concatBytes(utf8Bytes("DeepFamily:VaultKDF:v1\0"), credential);
  let output;
  try {
    output = await argon2id({
      password,
      salt,
      memorySize: SHIELDED_ASSET_VAULT_KDF.memoryKiB,
      iterations: SHIELDED_ASSET_VAULT_KDF.iterations,
      parallelism: SHIELDED_ASSET_VAULT_KDF.parallelism,
      hashLength: 32,
      outputType: "binary",
    });
    return await cryptoApi().subtle.importKey("raw", output, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  } finally {
    wipeBytes(credential);
    wipeBytes(password);
    wipeBytes(output);
  }
}

/** The schema explicitly excludes identity records, passphrases, secrets and raw signatures. */
export async function encryptShieldedAssetVault(input) {
  onlyKeys(
    input,
    [
      "assetRoot",
      "rootSource",
      "signatureMetadata",
      "discovery",
      "assetSuite",
      "branchVersion",
      "rootGenerationVersion",
      "fundsFingerprint",
      "unlockCredential",
    ],
    "Vault export",
  );
  const { unlockCredential, ...material } = input;
  const payload = await normalizePayload(material);
  const plaintext = utf8Bytes(JSON.stringify(payload));
  protocolAssert(
    plaintext.length + HEADER_BYTES + 16 <= SHIELDED_ASSET_VAULT_MAX_BYTES,
    "ASSET_VAULT_TOO_LARGE",
    "Asset vault exceeds the file limit",
  );
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC);
  header[8] = SHIELDED_ASSET_VAULT_VERSION;
  header[9] = 1; // Argon2id profile 1; parameters are still explicit and authenticated.
  const view = new DataView(header.buffer);
  view.setUint32(10, SHIELDED_ASSET_VAULT_KDF.memoryKiB, false);
  view.setUint32(14, SHIELDED_ASSET_VAULT_KDF.iterations, false);
  header[18] = SHIELDED_ASSET_VAULT_KDF.parallelism;
  cryptoApi().getRandomValues(header.subarray(19, 35));
  cryptoApi().getRandomValues(header.subarray(35, 47));
  view.setUint32(47, plaintext.length, false);
  try {
    const key = await vaultKey(unlockCredential, header.subarray(19, 35));
    const ciphertext = new Uint8Array(
      await cryptoApi().subtle.encrypt(
        { name: "AES-GCM", iv: header.subarray(35, 47), additionalData: header, tagLength: 128 },
        key,
        plaintext,
      ),
    );
    return concatBytes(header, ciphertext);
  } finally {
    wipeBytes(plaintext);
  }
}

/** Validate the full bounded header before running Argon2id; no strength downgrade. */
export async function decryptShieldedAssetVault({ file, unlockCredential, expectedFingerprint }) {
  const source = asUint8Array(file, "file");
  protocolAssert(
    source.length >= HEADER_BYTES + 16 && source.length <= SHIELDED_ASSET_VAULT_MAX_BYTES,
    "INVALID_ASSET_VAULT",
    "Invalid asset vault file length",
  );
  const bytes = copyBytes(source);
  let plaintext;
  try {
    protocolAssert(
      bytes.length >= HEADER_BYTES + 16 && bytes.length <= SHIELDED_ASSET_VAULT_MAX_BYTES,
      "INVALID_ASSET_VAULT",
      "Invalid asset vault file length",
    );
    const header = bytes.subarray(0, HEADER_BYTES);
    protocolAssert(
      bytesToHex(header.subarray(0, 8)) === bytesToHex(MAGIC),
      "INVALID_ASSET_VAULT",
      "Invalid asset vault magic",
    );
    const view = new DataView(header.buffer, header.byteOffset, HEADER_BYTES);
    protocolAssert(
      header[8] === 1 &&
        header[9] === 1 &&
        view.getUint32(10, false) === SHIELDED_ASSET_VAULT_KDF.memoryKiB &&
        view.getUint32(14, false) === SHIELDED_ASSET_VAULT_KDF.iterations &&
        header[18] === SHIELDED_ASSET_VAULT_KDF.parallelism,
      "UNSUPPORTED_ASSET_VAULT_VERSION",
      "Unsupported vault version or Argon2id parameters",
    );
    protocolAssert(
      view.getUint32(47, false) === bytes.length - HEADER_BYTES - 16,
      "INVALID_ASSET_VAULT",
      "Invalid asset vault payload length",
    );
    const key = await vaultKey(unlockCredential, header.subarray(19, 35));
    try {
      plaintext = new Uint8Array(
        await cryptoApi().subtle.decrypt(
          { name: "AES-GCM", iv: header.subarray(35, 47), additionalData: header, tagLength: 128 },
          key,
          bytes.subarray(HEADER_BYTES),
        ),
      );
    } catch {
      throw new ProtocolError("ASSET_VAULT_DECRYPTION_FAILED", "Could not decrypt asset vault");
    }
    let parsed;
    try {
      parsed = JSON.parse(decodeUtf8Fatal(plaintext));
    } catch {
      throw new ProtocolError("INVALID_ASSET_VAULT", "Invalid asset vault payload");
    }
    const payload = await normalizePayload(parsed);
    protocolAssert(
      expectedFingerprint === undefined ||
        equalHexConstantTime(expectedFingerprint, payload.fundsFingerprint),
      "ASSET_FINGERPRINT_MISMATCH",
      "Asset vault does not match the expected funds fingerprint",
    );
    const assetRoot = getBytes(payload.assetRoot);
    return {
      ...payload,
      assetRoot,
      keyMaterial: await deriveShieldedAssetKeyMaterial(assetRoot),
      verifiedPath: "file",
    }; // This never grants verified re-sign ability.
  } finally {
    wipeBytes(bytes);
    wipeBytes(plaintext);
  }
}
