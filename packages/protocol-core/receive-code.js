import { bech32m } from "@scure/base";
import { computeHmac, getBytes, sha256 } from "ethers";
import { poseidon2, poseidon3, poseidon4, poseidon5, poseidon8 } from "poseidon-lite";
import { bigintFrom, bytesToHex, concatBytes, copyBytes, utf8Bytes, wipeBytes } from "./bytes.js";
import { MAX_UINT64, SNARK_SCALAR_FIELD } from "./constants.js";
import { protocolAssert } from "./errors.js";
import { deriveShieldedViewPublicKey, splitShieldedViewPublicKey } from "./shielded-hpke.js";
import { receiveProofFromWords, receiveProofWords } from "./shielded-receive-proof-codec.js";

export const RECEIVE_VERSION = 1;
export const RECEIVE_PREFIX = "dfreceive";
export const RECEIVE_MAX_CAPABILITIES = 2;
export const RECEIVE_PUBLIC_SIGNAL_COUNT = 10;
export const CAPABILITY_PUBLIC_SIGNAL_COUNT = 10;
const MAX_FIELD = SNARK_SCALAR_FIELD - 1n;
const MAX_ADDRESS = (1n << 160n) - 1n;
const COMMON_BYTES = 486;
const CAPABILITY_BYTES = 456;
const fail = (condition, message) => protocolAssert(condition, "INVALID_RECEIVE_CODE", message);
const field = (value, label) => bigintFrom(value, label, MAX_FIELD);
const nonzero = (value, label) => {
  const result = field(value, label);
  fail(result !== 0n, `${label} must be nonzero`);
  return result;
};
const uint64 = (value, label) => bigintFrom(value, label, MAX_UINT64);

function scope(value) {
  const parsed =
    typeof value === "string" && /^0x[\da-f]{40}$/iu.test(value) ? BigInt(value) : value;
  const result = bigintFrom(parsed, "authorizerScope", MAX_ADDRESS);
  fail(result > 0n, "authorizerScope must be a nonzero registry address");
  return result;
}
function fixed(value, width) {
  let remaining = BigInt(value);
  const bytes = new Uint8Array(width);
  for (let index = width - 1; index >= 0; index--) {
    bytes[index] = Number(remaining & 255n);
    remaining >>= 8n;
  }
  fail(remaining === 0n, "Integer exceeds its encoding");
  return bytes;
}
function bytes32(value, label) {
  const result = copyBytes(value, label);
  fail(result.length === 32, `${label} must be 32 bytes`);
  return result;
}
function proofWords(proof) {
  fail(!proof?.protocol || proof.protocol === "groth16", "Unsupported proof protocol");
  fail(!proof?.curve || proof.curve === "bn128", "Unsupported proof curve");
  // Avoid converting an already rounded JavaScript Number to a proof coordinate.
  for (const value of [proof?.pi_a, proof?.pi_b, proof?.pi_c].flat(2)) {
    if (typeof value === "number") fail(Number.isSafeInteger(value), "Unsafe proof coordinate");
  }
  return receiveProofWords(proof);
}
function commonOf(input) {
  const chainId = uint64(input.chainId, "chainId");
  fail(chainId > 0n, "chainId must be nonzero");
  const authorizerScope = scope(input.authorizerScope);
  const nonce = nonzero(input.nonce, "nonce");
  const codeAlias = nonzero(input.codeAlias, "codeAlias");
  const ownerCommitment = nonzero(input.ownerCommitment, "ownerCommitment");
  const revocationTag = nonzero(input.revocationTag, "revocationTag");
  const expiresAt = uint64(input.expiresAt, "expiresAt");
  fail(expiresAt > 0n, "expiresAt must be nonzero");
  const viewingKey = bytes32(input.viewingKey, "viewingKey");
  const { viewKeyLo, viewKeyHi } = splitShieldedViewPublicKey(viewingKey);
  fail(viewKeyLo !== 0n || viewKeyHi !== 0n, "Viewing key must be nonzero");
  const domain = poseidon3([74000n, chainId, authorizerScope]);
  const keys = poseidon5([74001n, codeAlias, ownerCommitment, viewKeyLo, viewKeyHi]);
  const header = poseidon4([74002n, keys, nonce, expiresAt]);
  const commonBinding = poseidon4([74003n, domain, header, revocationTag]);
  if (input.commonBinding !== undefined) {
    fail(
      commonBinding === nonzero(input.commonBinding, "commonBinding"),
      "Receive fields do not match commonBinding",
    );
  }
  return {
    chainId,
    authorizerScope,
    nonce,
    codeAlias,
    commonBinding,
    revocationTag,
    ownerCommitment,
    viewingKey,
    expiresAt,
  };
}

/** Exact GenericCode output-first public-signal order. Parsing does not verify the proof. */
export function buildReceivePublicSignals(input) {
  const common = commonOf(input);
  const { viewKeyLo, viewKeyHi } = splitShieldedViewPublicKey(common.viewingKey);
  return [
    common.codeAlias,
    common.commonBinding,
    common.revocationTag,
    common.chainId,
    common.authorizerScope,
    common.nonce,
    common.ownerCommitment,
    viewKeyLo,
    viewKeyHi,
    common.expiresAt,
  ];
}

/** Recompute the GenericCode statement from private authorization witnesses. */
export function computeReceiveAuthorization(input) {
  const codeRootSecret = nonzero(input.codeRootSecret, "codeRootSecret");
  const codeSecret = nonzero(input.codeSecret, "codeSecret");
  const nonce = nonzero(input.nonce, "nonce");
  const ownerSecret = nonzero(input.ownerSecret, "ownerSecret");
  const ownerCommitment = poseidon2([1013n, ownerSecret]);
  if (input.ownerCommitment !== undefined)
    fail(
      field(input.ownerCommitment, "ownerCommitment") === ownerCommitment,
      "ownerSecret does not control ownerCommitment",
    );
  const codeAlias = poseidon4([73103n, codeRootSecret, nonce, codeSecret]);
  const revocationSecret = poseidon4([74020n, codeRootSecret, nonce, codeSecret]);
  const revocationTag = poseidon2([74021n, revocationSecret]);
  const common = commonOf({ ...input, nonce, codeAlias, revocationTag, ownerCommitment });
  return { ...common, revocationSecret, publicSignals: buildReceivePublicSignals(common) };
}

function capabilityOf(input) {
  return {
    issuanceRoot: nonzero(input.issuanceRoot, "issuanceRoot"),
    parentVersion: uint64(input.parentVersion, "parentVersion"),
    familyTag: nonzero(input.familyTag, "familyTag"),
    childRoleIndex: nonzero(input.childRoleIndex, "childRoleIndex"),
    endorsementRoleIndex: nonzero(input.endorsementRoleIndex, "endorsementRoleIndex"),
    trustedRoleIndex: nonzero(input.trustedRoleIndex, "trustedRoleIndex"),
    capabilityBinding: nonzero(input.capabilityBinding, "capabilityBinding"),
  };
}

/** Recompute the exact QualifiedCapability output binding from public receive fields and tags. */
export function computeCapabilityBinding(commonInput, capabilityInput) {
  const common = commonOf(commonInput);
  return poseidon8([
    74004n,
    common.commonBinding,
    uint64(capabilityInput.parentVersion, "parentVersion"),
    nonzero(capabilityInput.familyTag, "familyTag"),
    nonzero(capabilityInput.childRoleIndex, "childRoleIndex"),
    nonzero(capabilityInput.endorsementRoleIndex, "endorsementRoleIndex"),
    nonzero(capabilityInput.trustedRoleIndex, "trustedRoleIndex"),
    nonzero(capabilityInput.issuanceRoot, "issuanceRoot"),
  ]);
}

/** The same commonBinding binds all optional family capabilities to one receive code. */
export function buildCapabilityPublicSignals(commonInput, capabilityInput) {
  const common = commonOf(commonInput);
  const cap = capabilityOf(capabilityInput);
  fail(
    cap.capabilityBinding === computeCapabilityBinding(common, cap),
    "Budget capability does not match receive fields",
  );
  return [
    cap.capabilityBinding,
    cap.familyTag,
    cap.childRoleIndex,
    cap.endorsementRoleIndex,
    cap.trustedRoleIndex,
    common.chainId,
    common.authorizerScope,
    cap.issuanceRoot,
    common.commonBinding,
    cap.parentVersion,
  ];
}

/** One format for ordinary receiving and zero or more independently verified budget capabilities. */
export function encodeReceiveCode(input) {
  const common = commonOf(input);
  const capabilities = input.capabilities ?? [];
  fail(
    Array.isArray(capabilities) && capabilities.length <= RECEIVE_MAX_CAPABILITIES,
    "Too many budget capabilities",
  );
  const seen = new Set();
  const payload = concatBytes(
    Uint8Array.of(RECEIVE_VERSION, capabilities.length),
    fixed(common.chainId, 8),
    fixed(common.authorizerScope, 20),
    fixed(common.nonce, 32),
    fixed(common.codeAlias, 32),
    fixed(common.commonBinding, 32),
    fixed(common.revocationTag, 32),
    fixed(common.ownerCommitment, 32),
    common.viewingKey,
    fixed(common.expiresAt, 8),
    ...proofWords(input.proof).map((value) => fixed(value, 32)),
    ...capabilities.map((inputCap) => {
      const cap = capabilityOf(inputCap);
      buildCapabilityPublicSignals(common, cap);
      const key = cap.capabilityBinding.toString();
      fail(!seen.has(key), "Duplicate budget capability");
      seen.add(key);
      return concatBytes(
        fixed(cap.issuanceRoot, 32),
        fixed(cap.parentVersion, 8),
        fixed(cap.familyTag, 32),
        fixed(cap.childRoleIndex, 32),
        fixed(cap.endorsementRoleIndex, 32),
        fixed(cap.trustedRoleIndex, 32),
        fixed(cap.capabilityBinding, 32),
        ...proofWords(inputCap.proof).map((value) => fixed(value, 32)),
      );
    }),
  );
  return bech32m.encode(RECEIVE_PREFIX, bech32m.toWords(payload), false);
}

/** Canonical transport validation only; call fixed-key proof verifiers before accepting funds. */
export function decodeReceiveCode(code) {
  fail(typeof code === "string", "Receive code must be a string");
  // Bound work before bech32 decoding attacker-controlled data.
  fail(code.length <= 3000, "Receive code exceeds maximum length");
  let bytes;
  try {
    const decoded = bech32m.decode(code.replace(/\s+/gu, ""), false);
    fail(decoded.prefix === RECEIVE_PREFIX, "Incorrect receive code prefix");
    bytes = bech32m.fromWords(decoded.words);
  } catch {
    fail(false, "Receive code is incomplete or mistyped");
  }
  fail(bytes[0] === RECEIVE_VERSION, "Unsupported receive code version");
  const count = bytes[1];
  fail(
    count <= RECEIVE_MAX_CAPABILITIES && bytes.length === COMMON_BYTES + count * CAPABILITY_BYTES,
    "Invalid receive code length",
  );
  let offset = 2;
  const read = (width) => {
    const value = BigInt(bytesToHex(bytes.subarray(offset, offset + width)));
    offset += width;
    return value;
  };
  const statement = {
    chainId: read(8),
    authorizerScope: read(20),
    nonce: read(32),
    codeAlias: read(32),
    commonBinding: read(32),
    revocationTag: read(32),
    ownerCommitment: read(32),
    viewingKey: bytes.slice(offset, offset + 32),
  };
  offset += 32;
  statement.expiresAt = read(8);
  const readProof = () => {
    const proof = receiveProofFromWords(Array.from({ length: 8 }, () => read(32)));
    proofWords(proof);
    return proof;
  };
  const proof = readProof();
  const common = commonOf(statement);
  const capabilities = [];
  const seen = new Set();
  for (let index = 0; index < count; index++) {
    const cap = capabilityOf({
      issuanceRoot: read(32),
      parentVersion: read(8),
      familyTag: read(32),
      childRoleIndex: read(32),
      endorsementRoleIndex: read(32),
      trustedRoleIndex: read(32),
      capabilityBinding: read(32),
    });
    const capProof = readProof();
    fail(!seen.has(cap.capabilityBinding.toString()), "Duplicate budget capability");
    seen.add(cap.capabilityBinding.toString());
    capabilities.push({
      ...cap,
      proof: capProof,
      publicSignals: buildCapabilityPublicSignals(common, cap),
    });
  }
  return {
    ...common,
    version: RECEIVE_VERSION,
    proof,
    publicSignals: buildReceivePublicSignals(common),
    capabilities,
  };
}

export function isReceiveCode(code) {
  return typeof code === "string" && /^\s*dfreceive1/iu.test(code);
}

/** Callbacks must use the protocol's pinned verification keys, never keys embedded in the code. */
export async function verifyReceiveCode({
  code,
  verifyAuthorization,
  verifyCapability,
  chainId,
  authorizerScope,
  asOf,
}) {
  fail(
    typeof verifyAuthorization === "function",
    "A fixed receive authorization verifier is required",
  );
  const parsed = decodeReceiveCode(code);
  if (chainId !== undefined)
    fail(parsed.chainId === uint64(chainId, "chainId"), "Receive code belongs to another chain");
  if (authorizerScope !== undefined)
    fail(
      parsed.authorizerScope === scope(authorizerScope),
      "Receive code belongs to another registry",
    );
  if (asOf !== undefined) fail(uint64(asOf, "asOf") < parsed.expiresAt, "Receive code has expired");
  fail(
    (await verifyAuthorization(parsed.proof, parsed.publicSignals)) === true,
    "Invalid receive authorization proof",
  );
  if (parsed.capabilities.length)
    fail(typeof verifyCapability === "function", "A fixed budget capability verifier is required");
  for (const cap of parsed.capabilities) {
    fail(
      (await verifyCapability(cap.proof, cap.publicSignals)) === true,
      "Invalid budget capability proof",
    );
  }
  return parsed;
}

export function computeFamilyTag({ familyCommitment, nonce }) {
  return poseidon3([
    73104n,
    nonzero(familyCommitment, "familyCommitment"),
    nonzero(nonce, "nonce"),
  ]);
}

/** Stable, domain-separated role indices intentionally link codes sharing a qualification. */
export function computeRoleStatusIndex({ role, roleSecret }) {
  const domains = { child: 74321n, endorsement: 74322n, trusted: 74323n };
  fail(Object.hasOwn(domains, role), "Unknown eligibility role");
  return poseidon2([domains[role], nonzero(roleSecret, "roleSecret")]);
}

// RFC 5869 with one SHA-256 output block. All derivation context is fixed-width.
function hkdf32(ikm, domain, info) {
  const salt = getBytes(sha256(utf8Bytes(domain)));
  const prk = getBytes(computeHmac("sha256", salt, ikm));
  try {
    return getBytes(computeHmac("sha256", prk, concatBytes(info, Uint8Array.of(1))));
  } finally {
    wipeBytes(prk);
  }
}
function deriveField(root, domain, info) {
  for (let counter = 0; counter <= 0xffff_ffff; counter++) {
    const sample = hkdf32(root, domain, concatBytes(info, fixed(counter, 4)));
    try {
      const candidate = BigInt(bytesToHex(sample));
      if (candidate > 0n && candidate < SNARK_SCALAR_FIELD) return candidate;
    } finally {
      wipeBytes(sample);
    }
  }
  fail(false, " receive key derivation exhausted its counter");
}

/**
 * Restore a per-code branch using a private uint64 codeIndex. The index is never encoded.
 * Qualified wallets must pass their canonical identity derivedSecretField as codeRootSecret.
 * Use a high-entropy 32-byte master key; this function does not stretch passwords.
 */
export async function deriveReceiveKeyMaterial(input) {
  const master = bytes32(input.masterKey, "masterKey");
  let hpkeIkm;
  try {
    fail(master.some(Boolean), "masterKey must not be zero");
    const chainId = uint64(input.chainId, "chainId");
    fail(chainId > 0n, "chainId must be nonzero");
    const authorizerScope = scope(input.authorizerScope);
    // No implicit index zero: callers must persist the index they explicitly selected.
    const codeIndex = uint64(input.codeIndex, "codeIndex");
    const base = concatBytes(fixed(chainId, 8), fixed(authorizerScope, 20));
    const branch = concatBytes(base, fixed(codeIndex, 8));
    const codeRootSecret =
      input.codeRootSecret === undefined
        ? deriveField(master, "DeepFamily:ReceiveRoot", base)
        : nonzero(input.codeRootSecret, "codeRootSecret");
    const ownerSecret = deriveField(master, "DeepFamily:ReceiveSpend", branch);
    const codeSecret = deriveField(master, "DeepFamily:ReceiveAuthorization", branch);
    const nonce = deriveField(master, "DeepFamily:ReceiveNonce", branch);
    hpkeIkm = hkdf32(master, "DeepFamily:ReceiveView", branch);
    const viewingKey = await deriveShieldedViewPublicKey(hpkeIkm);
    const ownerCommitment = poseidon2([1013n, ownerSecret]);
    return {
      chainId,
      authorizerScope,
      codeRootSecret,
      codeSecret,
      nonce,
      ownerSecret,
      ownerCommitment,
      hpkeIkm: bytesToHex(hpkeIkm),
      viewingKey,
      ...splitShieldedViewPublicKey(viewingKey),
    };
  } finally {
    wipeBytes(master);
    wipeBytes(hpkeIkm);
  }
}
