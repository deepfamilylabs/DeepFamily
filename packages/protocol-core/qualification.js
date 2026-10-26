import { computeHmac, getAddress, getBytes, hexlify, keccak256, sha256, toBeHex, toUtf8Bytes } from "ethers";
import { bigintFrom, concatBytes, copyBytes, wipeBytes } from "./bytes.js";
import { SNARK_SCALAR_FIELD, MAX_UINT64 } from "./constants.js";
import { protocolAssert } from "./errors.js";
import { deriveShieldedViewPublicKey, encryptShieldedNote, decryptShieldedNote } from "./shielded-hpke.js";

const PREFIX = "dfqualrequest.";
const MAGIC = Uint8Array.of(0x44, 0x46, 0x51, 0x48, 1);
const fail = (ok, message) => protocolAssert(ok, "INVALID_QUALIFICATION", message);
const hex32 = (value, name) => { fail(typeof value === "string" && /^0x[\da-f]{64}$/u.test(value), `Invalid ${name}`); return value; };
const integer = (value, name, max = SNARK_SCALAR_FIELD - 1n, zero = false) => {
  const result = bigintFrom(value, name, max); fail(zero || result > 0n, `${name} must be nonzero`); return String(result);
};
const address = (value, name) => { const result = getAddress(value); fail(BigInt(result) > 0n, `Invalid ${name}`); return result; };
const hashOfIdentity = value => keccak256(toBeHex(BigInt(value), 32));
const scope = input => ({ chainId: integer(input.chainId, "chainId", MAX_UINT64), registryAddress: address(input.registryAddress, "registryAddress") });
function base64(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, ""); }
function unbase64(value) {
  fail(/^[A-Za-z0-9_-]+$/u.test(value), "Invalid qualification request encoding");
  return Uint8Array.from(atob(value.replace(/-/gu, "+").replace(/_/gu, "/")), c => c.charCodeAt(0));
}
function requestBody(input) {
  const result = { version: 1, ...scope(input), sourceAddress: address(input.sourceAddress, "sourceAddress"),
    childIdentity: integer(input.childIdentity, "childIdentity"), parentIdentity: integer(input.parentIdentity, "parentIdentity"),
    parentVersion: integer(input.parentVersion, "parentVersion", MAX_UINT64), endorser: address(input.endorser, "endorser"),
    nonce: hex32(input.nonce, "request nonce"), recipientPublicKey: hex32(input.recipientPublicKey, "handoff key") };
  fail(BigInt(result.recipientPublicKey) !== 0n, "Invalid handoff key");
  return result;
}
export function encodeQualificationRequest(input) {
  const body = requestBody(input), text = JSON.stringify(body);
  return { request: PREFIX + base64(toUtf8Bytes(text)), requestId: sha256(toUtf8Bytes(text)), ...body,
    childPersonHash: hashOfIdentity(body.childIdentity), parentPersonHash: hashOfIdentity(body.parentIdentity) };
}
export function decodeQualificationRequest(request) {
  fail(typeof request === "string" && request.startsWith(PREFIX) && request.length <= 4096, "Invalid qualification request");
  let text, decoded;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(unbase64(request.slice(PREFIX.length))); decoded = JSON.parse(text); }
  catch { fail(false, "Invalid qualification request encoding"); }
  fail(decoded?.version === 1, "Invalid qualification request version");
  const canonical = encodeQualificationRequest(decoded);
  fail(canonical.request === request, "Noncanonical qualification request");
  return canonical;
}

/** Independently domain-separated from all receive-code and spend-key derivations. */
export function qualificationHandoffIkm(input) {
  const walletScope = scope({ chainId: input.chainId, registryAddress: toBeHex(BigInt(input.authorizerScope), 20) });
  const master = copyBytes(input.masterKey, "masterKey");
  try {
    fail(master.length === 32 && master.some(Boolean), "Invalid wallet handoff key");
    return getBytes(computeHmac("sha256", master, toUtf8Bytes(JSON.stringify({
      domain: "DeepFamily:QualificationHandoff:v1", ...walletScope, nonce: hex32(input.nonce, "request nonce"),
    }))));
  } finally { wipeBytes(master); }
}
export async function qualificationHandoffPublicKey(input) {
  const ikm = qualificationHandoffIkm(input);
  try { return hexlify(await deriveShieldedViewPublicKey(ikm)); } finally { wipeBytes(ikm); }
}
export const QUALIFICATION_OPENING_FIELDS = ["xChild", "xEndorse", "xTrust", "sourceFactSalt", "sourceTrustSalt", "familySalt"];
function openingOf(input, kind) {
  return Object.fromEntries(QUALIFICATION_OPENING_FIELDS.map(name => [name,
    integer(input[name] ?? 0, name, SNARK_SCALAR_FIELD - 1n,
      kind === "fact" ? !["xChild", "xEndorse", "sourceFactSalt"].includes(name) : !["xTrust", "sourceTrustSalt", "familySalt"].includes(name))]));
}
function numberBytes(value, width) { return getBytes(toBeHex(BigInt(value), width)); }
const bytesNumber = bytes => BigInt(hexlify(bytes));
/** The HPKE box is recipient-bound; its contents are authenticated against the actual Source tree on import. */
export async function encryptQualificationPackage({ request: encoded, source }) {
  const request = decodeQualificationRequest(encoded);
  fail(source.kind === "fact" || source.kind === "trust", "Invalid qualification source kind");
  const opening = openingOf(source, source.kind);
  fail(getAddress(source.sourceAddress) === request.sourceAddress, "Qualification source mismatch");
  const payload = concatBytes(MAGIC, getBytes(request.requestId), Uint8Array.of(source.kind === "fact" ? 0 : 1),
    getBytes(request.sourceAddress), getBytes(address(source.controller, "controller")),
    numberBytes(integer(source.leafIndex, "leafIndex", MAX_UINT64, true), 8),
    ...QUALIFICATION_OPENING_FIELDS.map(name => numberBytes(opening[name], 32)));
  try {
    const ciphertext = await encryptShieldedNote({ chainId: request.chainId, poolAddress: request.registryAddress,
      recipientPublicKey: getBytes(request.recipientPublicKey), payload });
    return concatBytes(MAGIC, getBytes(request.requestId), ciphertext);
  } finally { wipeBytes(payload); }
}
export async function decryptQualificationPackage({ wallet, request: encoded, package: input }) {
  const request = decodeQualificationRequest(encoded), bytes = copyBytes(input, "qualification package");
  fail(bytes.length === 549 && MAGIC.every((v, i) => bytes[i] === v)
    && hexlify(bytes.subarray(5, 37)) === request.requestId, "Qualification package belongs to another request");
  fail(String(wallet.chainId) === request.chainId && getAddress(toBeHex(wallet.authorizerScope, 20)) === request.registryAddress,
    "Qualification package scope mismatch");
  const ikm = qualificationHandoffIkm({ ...wallet, nonce: request.nonce });
  let plaintext;
  try {
    fail(hexlify(await deriveShieldedViewPublicKey(ikm)) === request.recipientPublicKey, "Qualification request belongs to another wallet");
    plaintext = await decryptShieldedNote({ chainId: request.chainId, poolAddress: request.registryAddress,
      hpkeIkm: ikm, ciphertext: bytes.subarray(37) });
    fail(plaintext.length === 278 && MAGIC.every((v, i) => plaintext[i] === v)
      && hexlify(plaintext.subarray(5, 37)) === request.requestId, "Invalid qualification package binding");
    const kind = plaintext[37] === 0 ? "fact" : plaintext[37] === 1 ? "trust" : null;
    fail(kind !== null && getAddress(hexlify(plaintext.subarray(38, 58))) === request.sourceAddress, "Invalid qualification package source");
    const result = { kind, sourceAddress: request.sourceAddress, controller: getAddress(hexlify(plaintext.subarray(58, 78))),
      leafIndex: String(bytesNumber(plaintext.subarray(78, 86))) };
    QUALIFICATION_OPENING_FIELDS.forEach((name, index) => { result[name] = String(bytesNumber(plaintext.subarray(86 + index * 32, 118 + index * 32))); });
    return { ...result, ...openingOf(result, kind) };
  } finally { wipeBytes(ikm); wipeBytes(plaintext); wipeBytes(bytes); }
}

/** Canonical private lifecycle records live exclusively in the encrypted wallet backup. */
export function normalizeWalletQualifications(input = {}) {
  const list = (value, name, normalize, maximum = 128) => {
    fail(Array.isArray(value ?? []) && (value ?? []).length <= maximum, `Invalid ${name}`);
    return (value ?? []).map(normalize);
  };
  const attachment = value => value == null ? null : {
    kind: value.kind, sourceAddress: address(value.sourceAddress, "sourceAddress"), controller: address(value.controller, "controller"),
    leafIndex: integer(value.leafIndex, "leafIndex", MAX_UINT64, true), ...openingOf(value, value.kind),
  };
  const requests = list(input.requests, "qualification requests", item => {
    const request = decodeQualificationRequest(item.request);
    fail(item.id === request.requestId, "Qualification request ID mismatch");
    const fact = attachment(item.fact), trust = attachment(item.trust);
    fail((!fact || fact.kind === "fact") && (!trust || trust.kind === "trust"), "Invalid qualification attachment");
    fail((!fact || fact.sourceAddress === request.sourceAddress) && (!trust || trust.sourceAddress === request.sourceAddress),
      "Qualification attachment source mismatch");
    return { id: request.requestId, request: request.request, fact, trust,
      issue: item.issue == null ? null : Object.fromEntries(["issueNonce", "credentialSalt", "credentialCommitment", "familyRoot"]
        .map(name => [name, integer(item.issue[name], name)])),
      credentialIndex: item.credentialIndex == null ? null : integer(item.credentialIndex, "credentialIndex", (1n << 32n) - 1n, true) };
  });
  const sources = list(input.sources, "qualification sources", item => {
    const request = decodeQualificationRequest(item.request);
    fail(item.kind === "fact" || item.kind === "trust", "Invalid qualification source kind");
    fail(request.sourceAddress === getAddress(item.sourceAddress), "Qualification source mismatch");
    return { id: hex32(item.id, "source draft ID"), kind: item.kind, request: request.request,
      sourceAddress: request.sourceAddress, controller: address(item.controller, "controller"), ...openingOf(item, item.kind),
      publication: item.publication == null ? null : { transactionHash: item.publication.transactionHash == null ? null : hex32(item.publication.transactionHash, "publication transaction"),
        leafIndex: integer(item.publication.leafIndex, "leafIndex", MAX_UINT64, true) } };
  });
  const families = list(input.families, "qualification families", item => ({ parentIdentity: integer(item.parentIdentity, "parentIdentity"),
    parentVersion: integer(item.parentVersion, "parentVersion", MAX_UINT64), familySalt: integer(item.familySalt, "familySalt") }));
  for (const [items, key] of [[requests, item => item.id], [sources, item => item.id],
    [families, item => `${item.parentIdentity}:${item.parentVersion}`]])
    fail(new Set(items.map(key)).size === items.length, "Duplicate qualification lifecycle record");
  return { requests, sources, families };
}
