import { computeHmac, getBytes, sha256, toBeHex, verifyMessage } from "ethers";
import { bigintFrom, bytesToHex, concatBytes, copyBytes, utf8Bytes, wipeBytes } from "./bytes.js";
import { SNARK_SCALAR_FIELD } from "./constants.js";
import { ProtocolError, protocolAssert } from "./errors.js";
import { assertAddress } from "./identity.js";
import { deriveShieldedViewPublicKey } from "./shielded-hpke.js";
import { computeShieldedOwnerCommitment } from "./shielded-inheritance.js";

export const SHIELDED_INDEPENDENT_KEY_VERSION = 1;
export const SHIELDED_INDEPENDENT_KEY_SUITE = 1;
export const SHIELDED_INDEPENDENT_KEY_BRANCH_VERSION = 1;
const CURVE_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_CURVE_ORDER = CURVE_ORDER >> 1n;

function rootBytes(value) {
  let bytes;
  try {
    bytes = copyBytes(value, "independentKeyRoot");
  } catch {
    throw new ProtocolError("INVALID_INDEPENDENT_KEY_ROOT", "Independent key root must be 32 bytes");
  }
  if (bytes.length !== 32) {
    wipeBytes(bytes);
    throw new ProtocolError("INVALID_INDEPENDENT_KEY_ROOT", "Independent key root must be 32 bytes");
  }
  return bytes;
}

/** RFC 5869, one SHA-256 output block. Domains and counter bytes are protocol constants. */
function hkdf32(ikm, domain, info = new Uint8Array()) {
  const salt = getBytes(sha256(utf8Bytes(domain)));
  const prk = getBytes(computeHmac("sha256", salt, ikm));
  try {
    return getBytes(computeHmac("sha256", prk, concatBytes(info, Uint8Array.of(1))));
  } finally {
    wipeBytes(prk);
  }
}

export function buildShieldedIndependentKeySigningMessage(signerAddress) {
  const signer = assertAddress(signerAddress, "signerAddress").toLowerCase();
  protocolAssert(BigInt(signer) !== 0n, "INVALID_INDEPENDENT_KEY_SIGNER", "Independent key signer must be nonzero");
  return `DeepFamily Independent Key v1\nAccount: ${signer}\nPurpose: Create or restore the DeepFamily independent key\nKeep this signature private. It controls the derived funds.`;
}

/** Accept only r||s||v; normalize v and high-s before exact EIP-191 verification. */
export function normalizeShieldedIndependentKeySignature({ signerAddress, signature }) {
  let bytes;
  try {
    bytes = copyBytes(signature, "signature");
  } catch {
    throw new ProtocolError(
      "INVALID_INDEPENDENT_KEY_SIGNATURE",
      "A 65-byte personal_sign signature is required",
    );
  }
  try {
    protocolAssert(
      bytes.length === 65,
      "INVALID_INDEPENDENT_KEY_SIGNATURE",
      "A 65-byte personal_sign signature is required",
    );
    const r = BigInt(bytesToHex(bytes.subarray(0, 32)));
    let s = BigInt(bytesToHex(bytes.subarray(32, 64)));
    let v = bytes[64];
    protocolAssert(
      r > 0n && r < CURVE_ORDER && s > 0n && s < CURVE_ORDER,
      "INVALID_INDEPENDENT_KEY_SIGNATURE",
      "Invalid signature scalar",
    );
    if (v === 0 || v === 1) v += 27;
    protocolAssert(
      v === 27 || v === 28,
      "INVALID_INDEPENDENT_KEY_SIGNATURE",
      "Invalid signature recovery bit",
    );
    if (s > HALF_CURVE_ORDER) {
      s = CURVE_ORDER - s;
      v = v === 27 ? 28 : 27;
    }
    const canonical = concatBytes(
      getBytes(toBeHex(r, 32)),
      getBytes(toBeHex(s, 32)),
      Uint8Array.of(v),
    );
    try {
      const message = utf8Bytes(buildShieldedIndependentKeySigningMessage(signerAddress));
      const recovered = verifyMessage(message, bytesToHex(canonical));
      protocolAssert(
        recovered.toLowerCase() === assertAddress(signerAddress, "signerAddress").toLowerCase(),
        "INDEPENDENT_KEY_SIGNATURE_SIGNER_MISMATCH",
        "Signature does not match the selected independent key signer",
      );
      return canonical;
    } catch (error) {
      wipeBytes(canonical);
      if (error instanceof ProtocolError) throw error;
      throw new ProtocolError("INVALID_INDEPENDENT_KEY_SIGNATURE", "Invalid personal_sign signature");
    }
  } finally {
    wipeBytes(bytes);
  }
}

/** Only this explicit creation entry point obtains fresh entropy. Recovery never calls it. */
export function createShieldedIndependentKeyRoot({ intent, rootSource = "random" } = {}) {
  protocolAssert(
    intent === "create",
    "EXPLICIT_INDEPENDENT_KEY_CREATION_REQUIRED",
    "Explicit new independent key creation is required",
  );
  protocolAssert(
    rootSource === "random",
    "INVALID_INDEPENDENT_KEY_ROOT_SOURCE",
    "Signature roots require explicit signature derivation",
  );
  protocolAssert(
    typeof globalThis.crypto?.getRandomValues === "function",
    "SECURE_RANDOM_UNAVAILABLE",
    "A cryptographic random source is required",
  );
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

export async function deriveShieldedIndependentKeyRootFromSignature(input) {
  const signerAddress = assertAddress(input.signerAddress, "signerAddress").toLowerCase();
  const message = buildShieldedIndependentKeySigningMessage(signerAddress);
  const messageBytes = utf8Bytes(message);
  const canonical = normalizeShieldedIndependentKeySignature(input);
  try {
    const messageHash = sha256(messageBytes);
    const independentKeyRoot = hkdf32(
      canonical,
      "DeepFamily:WalletIndependentKeyRoot:v1",
      concatBytes(getBytes(messageHash), getBytes(signerAddress)),
    );
    return {
      independentKeyRoot,
      sourceMetadata: {
        signerAddress,
        message,
        messageHash,
        messageVersion: 1,
        signatureVersion: 1,
        rootKdfVersion: 1,
        method: "personal_sign",
      },
    };
  } finally {
    wipeBytes(canonical);
  }
}

export function computeShieldedIndependentKeyFingerprint({
  ownerCommitment,
  viewPublicKey,
  independentKeySuite = 1,
  branchVersion = 1,
}) {
  protocolAssert(
    independentKeySuite === SHIELDED_INDEPENDENT_KEY_SUITE && branchVersion === SHIELDED_INDEPENDENT_KEY_BRANCH_VERSION,
    "UNSUPPORTED_INDEPENDENT_KEY_VERSION",
    "Unsupported independent key branch specification",
  );
  const owner = bigintFrom(ownerCommitment, "ownerCommitment", SNARK_SCALAR_FIELD - 1n);
  protocolAssert(owner > 0n, "ZERO_SHIELDED_SECRET", "Owner commitment must be nonzero");
  const view = copyBytes(viewPublicKey, "viewPublicKey");
  protocolAssert(
    view.length === 32,
    "INVALID_SHIELDED_KEY_LENGTH",
    "View public key must be 32 bytes",
  );
  return sha256(
    concatBytes(
      utf8Bytes("DeepFamily:IndependentKeyFingerprint:v1\0"),
      Uint8Array.of(independentKeySuite, branchVersion),
      getBytes(toBeHex(owner, 32)),
      view,
    ),
  );
}

/** Independent key derivation binds both branches to an independent key credential secret. */
export async function deriveShieldedIndependentKeyMaterial(input) {
  const root = rootBytes(input?.independentKeyRoot);
  let independentKeyIdentitySecret;
  let ikm;
  let boundRoot;
  let hpke;
  let sample;
  try {
    try {
      independentKeyIdentitySecret = copyBytes(input?.independentKeyIdentitySecret, "independentKeyIdentitySecret");
    } catch {
      throw new ProtocolError(
        "INVALID_INDEPENDENT_KEY_IDENTITY_SECRET",
        "Independent-key identity secret must be 32 bytes",
      );
    }
    protocolAssert(
      independentKeyIdentitySecret.length === 32,
      "INVALID_INDEPENDENT_KEY_IDENTITY_SECRET",
      "Independent-key identity secret must be 32 bytes",
    );
    ikm = concatBytes(root, independentKeyIdentitySecret);
    boundRoot = hkdf32(ikm, "DeepFamily:IdentityBoundIndependentKeyRoot:v1");
    wipeBytes(ikm);
    let ownerSecret;
    for (let counter = 0; counter <= 0xffff_ffff; counter += 1) {
      const info = new Uint8Array(4);
      new DataView(info.buffer).setUint32(0, counter, false);
      sample = hkdf32(boundRoot, "DeepFamily:IndependentKeySpend:v1", info);
      const candidate = BigInt(bytesToHex(sample));
      wipeBytes(sample);
      if (candidate > 0n && candidate < SNARK_SCALAR_FIELD) {
        ownerSecret = candidate;
        break;
      }
    }
    protocolAssert(
      ownerSecret !== undefined,
      "INDEPENDENT_KEY_DERIVATION_FAILED",
      "Independent key spend derivation exhausted its counter",
    );
    hpke = hkdf32(boundRoot, "DeepFamily:IndependentKeyView:v1");
    const ownerCommitment = computeShieldedOwnerCommitment(ownerSecret);
    const viewPublicKey = await deriveShieldedViewPublicKey(hpke);
    return {
      ownerSecret,
      ownerCommitment,
      hpkeIkm: bytesToHex(hpke),
      viewPublicKey,
      keyFingerprint: computeShieldedIndependentKeyFingerprint({ ownerCommitment, viewPublicKey }),
      keyMode: 1,
      independentKeySuite: SHIELDED_INDEPENDENT_KEY_SUITE,
      branchVersion: SHIELDED_INDEPENDENT_KEY_BRANCH_VERSION,
    };
  } finally {
    wipeBytes(root);
    wipeBytes(independentKeyIdentitySecret);
    wipeBytes(ikm);
    wipeBytes(boundRoot);
    wipeBytes(hpke);
    wipeBytes(sample);
  }
}
