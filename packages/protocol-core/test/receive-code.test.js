import test from "node:test";
import assert from "node:assert/strict";
import { hkdfSync, createHash } from "node:crypto";
import { bech32m } from "@scure/base";
import { getBytes, hexlify } from "ethers";
import { poseidon2, poseidon3, poseidon4, poseidon8 } from "poseidon-lite";
import {
  RECEIVE_VERSION, RECEIVE_MAX_CAPABILITIES,
  computeFamilyTag, computeRoleStatusIndex, buildReceivePublicSignals,
  buildCapabilityPublicSignals, computeCapabilityBinding,
  computeReceiveAuthorization, deriveReceiveKeyMaterial,
  encodeReceiveCode, decodeReceiveCode, isReceiveCode,
  verifyReceiveCode,
} from "../receive-code.js";
import { encryptShieldedNote, decryptShieldedNote } from "../shielded-hpke.js";
import { createShieldedLetterEnvelope, encryptShieldedLetter, decryptShieldedLetter } from "../shielded-letters.js";
import { SNARK_SCALAR_FIELD } from "../constants.js";

// Codec fixtures only: these proof coordinates are deliberately not cryptographic proof evidence.
const proof = { pi_a: ["1", "2", "1"], pi_b: [["3", "4"], ["5", "6"], ["1", "0"]],
  pi_c: ["7", "8", "1"], protocol: "groth16", curve: "bn128" };
const masterKey = new Uint8Array(32).fill(37);
const scope = { chainId: 31337n, authorizerScope: "0x0000000000000000000000000000000000001234" };
const params = { ...scope, masterKey, codeIndex: 7n, codeRootSecret: 23n };
async function material(patch = {}) { return deriveReceiveKeyMaterial({ ...params, ...patch }); }
async function statement(patch = {}) {
  return { ...computeReceiveAuthorization({ ...await material(), expiresAt: 2_000_000_000n, ...patch }), proof };
}
function capability(common, familyCommitment = 37n, parentVersion = 1n) {
  const cap = { issuanceRoot: 997n, parentVersion, familyTag: computeFamilyTag({ familyCommitment, nonce: common.nonce }),
    childRoleIndex: computeRoleStatusIndex({ role: "child", roleSecret: 13n}),
    endorsementRoleIndex: computeRoleStatusIndex({ role: "endorsement", roleSecret: 17n}),
    trustedRoleIndex: computeRoleStatusIndex({ role: "trusted", roleSecret: 19n}), proof };
  return { ...cap, capabilityBinding: computeCapabilityBinding(common, cap) };
}
function raw(code) { return bech32m.fromWords(bech32m.decode(code, false).words); }
function encodeRaw(bytes, prefix = "dfreceive") { return bech32m.encode(prefix, bech32m.toWords(bytes), false); }

function independentHkdf(domain, info) {
  return Buffer.from(hkdfSync("sha256", masterKey, createHash("sha256").update(domain).digest(), info, 32));
}
function independentField(domain, info) {
  for (let index = 0; ; index++) {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(index);
    const result = BigInt(hexlify(independentHkdf(domain, Buffer.concat([info, counter]))));
    if (result > 0n && result < SNARK_SCALAR_FIELD) return result;
  }
}

test("private-index receive branches restore and match independent RFC 5869 derivation", async () => {
  const first = await material();
  assert.deepEqual(first, await material());
  assert.deepEqual(masterKey, new Uint8Array(32).fill(37));
  const base = Buffer.alloc(28);
  base.writeBigUInt64BE(scope.chainId);
  Buffer.from(getBytes(scope.authorizerScope)).copy(base, 8);
  const index = Buffer.alloc(8);
  index.writeBigUInt64BE(7n);
  const branch = Buffer.concat([base, index]);
  assert.equal(first.ownerSecret, independentField("DeepFamily:ReceiveSpend", branch));
  assert.equal(first.codeSecret, independentField("DeepFamily:ReceiveAuthorization", branch));
  assert.equal(first.nonce, independentField("DeepFamily:ReceiveNonce", branch));
  assert.equal(first.hpkeIkm, hexlify(independentHkdf("DeepFamily:ReceiveView", branch)));
  assert.equal(first.ownerCommitment, poseidon2([1013n, first.ownerSecret]));
  assert.equal(first.codeRootSecret, 23n);
  const generic = await material({ codeRootSecret: undefined });
  assert.equal(generic.codeRootSecret, independentField("DeepFamily:ReceiveRoot", base));
  for (const patch of [{ codeIndex: 8n }, { chainId: 31338n }, { authorizerScope: "0x0000000000000000000000000000000000001235" }]) {
    const other = await material(patch);
    for (const field of ["ownerSecret", "codeSecret", "nonce", "ownerCommitment", "hpkeIkm"]) assert.notEqual(first[field], other[field]);
    assert.notDeepEqual(first.viewingKey, other.viewingKey);
  }
});

test("all common public signals match the fixed GenericCode ABI and hide identity fields", async () => {
  const key = await material();
  const common = computeReceiveAuthorization({ ...key, expiresAt: 2_000_000_000n });
  const alias = poseidon4([73103n, 23n, key.nonce, key.codeSecret]);
  const revocationSecret = poseidon4([74020n, 23n, key.nonce, key.codeSecret]);
  assert.equal(common.codeAlias, alias);
  assert.equal(common.revocationSecret, revocationSecret);
  assert.equal(common.revocationTag, poseidon2([74021n, revocationSecret]));
  assert.deepEqual(buildReceivePublicSignals(common), [alias, common.commonBinding, common.revocationTag,
    scope.chainId, BigInt(scope.authorizerScope), key.nonce, key.ownerCommitment, key.viewKeyLo, key.viewKeyHi, 2_000_000_000n]);
  const decoded = decodeReceiveCode(encodeReceiveCode({ ...common, proof }));
  for (const secret of ["identityCommitment", "parentIdentityCommitment", "endorser", "credential", "codeRootSecret", "codeSecret", "ownerSecret", "revocationSecret", "codeIndex", "hpkeIkm"]) {
    assert.equal(Object.hasOwn(decoded, secret), false);
  }
  const newKey = await material({ codeIndex: 8n });
  const newCommon = computeReceiveAuthorization({ ...newKey, expiresAt: common.expiresAt });
  assert.notEqual(newCommon.codeAlias, common.codeAlias);
  assert.notEqual(newCommon.revocationTag, common.revocationTag);
});

test("one code round trips ordinary receiving and multiple family capabilities", async () => {
  const common = await statement();
  assert.equal(RECEIVE_VERSION, 1);
  for (const capabilities of [[], [capability(common)], [capability(common), capability(common, 41n, 2n)]]) {
    const encoded = encodeReceiveCode({ ...common, capabilities });
    assert.equal(isReceiveCode(encoded), true);
    assert.equal(raw(encoded).length, 486 + capabilities.length * 456);
    assert.ok(encoded.length <= 2331, "Unified father/mother code must fit a single QR40-M binary payload");
    const decoded = decodeReceiveCode(encoded);
    assert.equal(encodeReceiveCode(decoded), encoded);
    assert.equal(decoded.capabilities.length, capabilities.length);
    assert.deepEqual(decoded.publicSignals, common.publicSignals);
    assert.deepEqual(decoded.capabilities.map(c => c.publicSignals), capabilities.map(c => buildCapabilityPublicSignals(common, c)));
    assert.equal(encodeReceiveCode(decodeReceiveCode(encoded.toUpperCase())), encoded);
    assert.equal(encodeReceiveCode(decodeReceiveCode(` ${encoded.slice(0, 90)}\n${encoded.slice(90)} `)), encoded);
  }
});

test("stable role indices and per-code binding match the fixed circuit", async () => {
  const common = await statement();
  const cap = capability(common);
  assert.equal(cap.familyTag, poseidon3([73104n, 37n, common.nonce]));
  assert.equal(cap.childRoleIndex, poseidon2([74321n, 13n]));
  assert.equal(cap.endorsementRoleIndex, poseidon2([74322n, 17n]));
  assert.equal(cap.trustedRoleIndex, poseidon2([74323n, 19n]));
  assert.equal(cap.capabilityBinding, poseidon8([74004n, common.commonBinding, 1n, cap.familyTag, cap.childRoleIndex, cap.endorsementRoleIndex, cap.trustedRoleIndex, cap.issuanceRoot]));
  assert.deepEqual(buildCapabilityPublicSignals(common, cap), [cap.capabilityBinding, cap.familyTag,
    cap.childRoleIndex, cap.endorsementRoleIndex, cap.trustedRoleIndex, common.chainId, common.authorizerScope,
    cap.issuanceRoot, common.commonBinding, cap.parentVersion]);
  assert.throws(() => computeRoleStatusIndex({ role: "unknown", roleSecret: 13n}));
});

test("qualification indices link same-role codes without reusing source registration commitments", async () => {
  const first = await statement(), second = await statement({ ...await material({ codeIndex: 8n }) });
  const firstCap = capability(first), secondCap = capability(second);
  for (const field of ["childRoleIndex", "endorsementRoleIndex", "trustedRoleIndex"])
    assert.equal(firstCap[field], secondCap[field], field);
  assert.notEqual(first.codeAlias, second.codeAlias);
  assert.notEqual(first.ownerCommitment, second.ownerCommitment);
  assert.notDeepEqual(first.viewingKey, second.viewingKey);
  assert.notEqual(firstCap.familyTag, secondCap.familyTag);
  assert.notEqual(firstCap.capabilityBinding, secondCap.capabilityBinding);
  for (const [offset, role] of ["child", "endorsement", "trusted"].entries()) {
    const index = computeRoleStatusIndex({ role, roleSecret: 13n });
    assert.equal(index, poseidon2([74321n + BigInt(offset), 13n]));
    assert.notEqual(index, poseidon2([74201n + BigInt(offset), 13n]));
    assert.notEqual(index, computeRoleStatusIndex({ role, roleSecret: 17n }));
  }
  assert.equal(new Set(["child", "endorsement", "trusted"].map(role =>
    computeRoleStatusIndex({ role, roleSecret: 13n }))).size, 3);
  assert.throws(() => computeRoleStatusIndex({ role: "child", roleSecret: 0n }));
  assert.throws(() => computeRoleStatusIndex({ role: "child", roleSecret: SNARK_SCALAR_FIELD }));
});

test("common field tampering and foreign-code capability splicing fail before proof verification", async () => {
  const common = await statement();
  for (const patch of [{ chainId: 31338n }, { authorizerScope: 4661n }, { nonce: common.nonce + 1n },
    { codeAlias: common.codeAlias + 1n }, { ownerCommitment: common.ownerCommitment + 1n },
    { viewingKey: new Uint8Array(32).fill(2) }, { expiresAt: common.expiresAt + 1n }, { revocationTag: common.revocationTag + 1n }]) {
    assert.throws(() => encodeReceiveCode({ ...common, ...patch }), /commonBinding/u);
  }
  const second = await statement({ ...await material({ codeIndex: 8n }) });
  assert.throws(() => encodeReceiveCode({ ...second, capabilities: [capability(common)] }), /does not match/u);
  const packet = raw(encodeReceiveCode(common));
  packet[8] ^= 1;
  assert.throws(() => decodeReceiveCode(encodeRaw(packet)), /commonBinding/u);
  const keys = await material();
  assert.throws(() => computeReceiveAuthorization({ ...keys, expiresAt: 1n, ownerCommitment: 2n }), /ownerSecret/u);
});

test("codec rejects corrupt encoding, noncanonical fields/proofs, duplicates and unsupported schemas", async () => {
  const common = await statement();
  const encoded = encodeReceiveCode(common);
  const bytes = raw(encoded);
  for (const packet of [bytes.slice(0, -1), Uint8Array.of(...bytes, 0), Uint8Array.of(3, ...bytes.slice(1)), Uint8Array.of(2, 9, ...bytes.slice(2))]) {
    assert.throws(() => decodeReceiveCode(encodeRaw(packet)));
  }
  for (const code of [null, "", encoded.slice(0, -1), "dfreceive1broken", encodeRaw(bytes, "dfrecv"), "a".repeat(8001)]) assert.throws(() => decodeReceiveCode(code));
  assert.equal(isReceiveCode(null), false);
  assert.equal(isReceiveCode("dfrecv1broken"), false);
  assert.equal(isReceiveCode("dfreceive1broken"), true); // detection does not authenticate
  assert.throws(() => encodeReceiveCode({ ...common, capabilities: [capability(common), capability(common)] }), /Duplicate/u);
  assert.throws(() => encodeReceiveCode({ ...common, capabilities: Array(RECEIVE_MAX_CAPABILITIES + 1).fill(capability(common)) }));
  assert.throws(() => encodeReceiveCode({ ...common, proof: { ...proof, pi_a: ["0", "0", "1"] } }), /infinity/u);
  assert.throws(() => encodeReceiveCode({ ...common, proof: { ...proof, pi_a: [SNARK_SCALAR_FIELD + 100000000000000000000000000000000000000000000000000n, "2", "1"] } }));
  assert.throws(() => encodeReceiveCode({ ...common, proof: { ...proof, pi_a: [Number.MAX_SAFE_INTEGER + 1, "2", "1"] } }), /Unsafe/u);
  assert.throws(() => encodeReceiveCode({ ...common, proof: { ...proof, protocol: "plonk" } }), /Unsupported/u);
});

test("authentication verifies every statement using required fixed-key callbacks and scope/time checks", async () => {
  const common = await statement();
  const code = encodeReceiveCode({ ...common, capabilities: [capability(common), capability(common, 41n)] });
  const parsed = decodeReceiveCode(code);
  const seen = [];
  const verifyAuthorization = async (p, signals) => { assert.deepEqual(p, proof); seen.push(signals); return true; };
  const verifyCapability = async (p, signals) => { assert.deepEqual(p, proof); seen.push(signals); return true; };
  assert.deepEqual(await verifyReceiveCode({ code, verifyAuthorization, verifyCapability, ...scope, asOf: common.expiresAt - 1n }), parsed);
  assert.deepEqual(seen, [parsed.publicSignals, ...parsed.capabilities.map(c => c.publicSignals)]);
  await assert.rejects(verifyReceiveCode({ code }), /verifier/u);
  await assert.rejects(verifyReceiveCode({ code, verifyAuthorization: async () => false, verifyCapability }), /Invalid receive/u);
  await assert.rejects(verifyReceiveCode({ code, verifyAuthorization, verifyCapability: async () => false }), /Invalid budget/u);
  await assert.rejects(verifyReceiveCode({ code, verifyAuthorization }), /capability verifier/u);
  await assert.rejects(verifyReceiveCode({ code, verifyAuthorization, verifyCapability, chainId: 1n }), /another chain/u);
  await assert.rejects(verifyReceiveCode({ code, verifyAuthorization, verifyCapability, authorizerScope: 99n }), /another registry/u);
  for (const asOf of [common.expiresAt, common.expiresAt + 1n])
    await assert.rejects(verifyReceiveCode({ code, verifyAuthorization, verifyCapability, asOf }), /expired/u);
});

test("the same restored per-code HPKE key decrypts notes and letters from the published code", async () => {
  const created = await material();
  const code = encodeReceiveCode({ ...computeReceiveAuthorization({ ...created, expiresAt: 2_000_000_000n }), proof });
  const published = decodeReceiveCode(code);
  const recovery = await material();
  const noteScope = { chainId: scope.chainId, poolAddress: "0x0000000000000000000000000000000000004321" };
  const payload = new TextEncoder().encode("independent contribution payload");
  const ciphertext = await encryptShieldedNote({ ...noteScope, recipientPublicKey: published.viewingKey, payload });
  assert.equal(ciphertext.length, 512);
  assert.deepEqual(await decryptShieldedNote({ ...noteScope, hpkeIkm: recovery.hpkeIkm, ciphertext }), payload);
  await assert.rejects(decryptShieldedNote({ ...noteScope, hpkeIkm: (await material({ codeIndex: 8n })).hpkeIkm, ciphertext }));
  await assert.rejects(decryptShieldedNote({ ...noteScope, chainId: 1n, hpkeIkm: recovery.hpkeIkm, ciphertext }));
  const letterScope = { chainId: scope.chainId, lettersAddress: "0x0000000000000000000000000000000000005678", messageId: 101n };
  const envelope = createShieldedLetterEnvelope({ body: "一封匿名家书", salt: 33n });
  const letter = await encryptShieldedLetter({ ...letterScope, recipientPublicKey: published.viewingKey, envelope });
  assert.deepEqual(await decryptShieldedLetter({ ...letterScope, hpkeIkm: recovery.hpkeIkm, ciphertext: letter, relationCommitment: 0n, expectedBinding: 37n }), envelope);
  await assert.rejects(decryptShieldedLetter({ ...letterScope, messageId: 102n, hpkeIkm: recovery.hpkeIkm, ciphertext: letter, relationCommitment: 0n, expectedBinding: 37n }));
});

test("key derivation rejects missing private indexes, weak roots and noncanonical inputs", async () => {
  for (const patch of [{ codeIndex: undefined }, { codeIndex: -1n }, { codeIndex: Number.MAX_SAFE_INTEGER + 1 },
    { masterKey: new Uint8Array(31) }, { masterKey: new Uint8Array(32) }, { authorizerScope: 0n },
    { chainId: 0n }, { codeRootSecret: 0n }, { codeRootSecret: SNARK_SCALAR_FIELD }]) {
    await assert.rejects(material(patch));
  }
});
