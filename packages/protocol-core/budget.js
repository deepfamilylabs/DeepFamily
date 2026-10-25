import { poseidon2, poseidon3, poseidon4, poseidon5, poseidon7, poseidon8 } from "poseidon-lite";
import { asUint8Array, bigintFrom, bytesToHex, concatBytes, wipeBytes } from "./bytes.js";
import { MAX_UINT32, MAX_UINT64, MAX_UINT128, SNARK_SCALAR_FIELD } from "./constants.js";
import { ProtocolError, protocolAssert } from "./errors.js";
import {
  RECEIVE_MAX_CAPABILITIES, computeFamilyTag, computeRoleTag, buildCapabilityPublicSignals,
  encodeReceiveCode, verifyReceiveCode,
} from "./receive-code.js";
import { decryptShieldedNote, encryptShieldedNote, splitShieldedViewPublicKey } from "./shielded-hpke.js";
import {
  computeShieldedCiphertextHashField, computeShieldedOwnerCommitment,
  computeShieldedScopedPurpose,
  computeShieldedSpendNullifier, computeShieldedValueNoteCommitment,
  generateShieldedRandomField, normalizeShieldedScope,
} from "./shielded-inheritance.js";
import { encodeShieldedValueNotePayload } from "./shielded-note-codec.js";

export const BUDGET_NOTE_VERSION = 1;
export const BUDGET_NOTE_PAYLOAD_BYTES = 314;
export const FUND_PUBLIC_SIGNAL_COUNT = 20;
export const BUDGET_ELIGIBILITY_DELAY = 7200n;
const MAX_FIELD = SNARK_SCALAR_FIELD - 1n;
const MAGIC = Uint8Array.of(0x44, 0x46, 0x42, 0x4e, 1, 2); // DFBN, version 1, budget
const fail = (condition, message) => protocolAssert(condition, "INVALID_BUDGET", message);
const field = (value, label) => bigintFrom(value, label, MAX_FIELD);
const nonzero = (value, label) => {
  const result = field(value, label);
  fail(result > 0n, `${label} must be nonzero`);
  return result;
};
const uint64 = (value, label) => bigintFrom(value, label, MAX_UINT64);
const amount = (value, label) => bigintFrom(value, label, MAX_UINT128);
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
function policyOf(input) {
  const familyCommitment = nonzero(input.familyCommitment, "familyCommitment");
  const parentVersion = uint64(input.parentVersion, "parentVersion");
  const rate = amount(input.rate, "rate");
  fail(rate > 0n, "rate must be nonzero");
  const periodDays = bigintFrom(input.periodDays, "periodDays", MAX_UINT32);
  fail(periodDays > 0n, "periodDays must be nonzero");
  return { familyCommitment, parentVersion, rate, periodDays,
    policySalt: nonzero(input.policySalt, "policySalt"),
    allocationKeyCommitment: nonzero(input.allocationKeyCommitment, "allocationKeyCommitment") };
}
export function computePolicyCommitment(input, scope) {
  const policy = policyOf(input);
  return poseidon7([computeShieldedScopedPurpose(1010n, scope), policy.familyCommitment,
    policy.parentVersion, policy.rate, policy.policySalt, policy.allocationKeyCommitment, policy.periodDays]);
}
export function computeBudgetKey(input, scope) {
  return poseidon3([computeShieldedScopedPurpose(75001n, scope),
    nonzero(input.codeAlias, "codeAlias"), nonzero(input.policyCommitment, "policyCommitment")]);
}
function noteOf(input) {
  const policy = policyOf(input);
  const viewingKey = asUint8Array(input.viewingKey, "viewingKey");
  fail(viewingKey.length === 32, "viewingKey must be 32 bytes");
  const { viewKeyLo, viewKeyHi } = splitShieldedViewPublicKey(viewingKey);
  fail(viewKeyLo !== 0n || viewKeyHi !== 0n, "viewingKey must be nonzero");
  const eligibleFrom = uint64(input.eligibleFrom, "eligibleFrom");
  fail(eligibleFrom > 0n, "eligibleFrom must be nonzero");
  const remaining = amount(input.remaining, "remaining");
  fail(remaining % policy.rate === 0n, "remaining must be a whole number of periods");
  uint64(remaining / policy.rate, "remainingPeriods");
  return { kind: "budget", version: BUDGET_NOTE_VERSION, ...policy,
    codeAlias: nonzero(input.codeAlias, "codeAlias"), codeNonce: nonzero(input.codeNonce, "codeNonce"),
    ownerCommitment: nonzero(input.ownerCommitment, "ownerCommitment"), viewingKey: new Uint8Array(viewingKey),
    eligibleFrom, remaining,
    nonce: nonzero(input.nonce, "nonce") };
}
export function computeBudgetNoteCommitment(input, scope) {
  const note = noteOf(input);
  const policyCommitment = computePolicyCommitment(note, scope);
  const budgetKey = computeBudgetKey({ codeAlias: note.codeAlias, policyCommitment }, scope);
  const { viewKeyLo, viewKeyHi } = splitShieldedViewPublicKey(note.viewingKey);
  const keys = poseidon4([75003n, note.ownerCommitment, viewKeyLo, viewKeyHi]);
  const metadata = poseidon3([75004n, note.nonce, field(input.ciphertextHashField, "ciphertextHashField")]);
  return poseidon8([computeShieldedScopedPurpose(75002n, scope), policyCommitment, budgetKey,
    keys, note.eligibleFrom, note.rate, note.remaining, metadata]);
}

/** Compact budget opening; all recovery metadata fits the existing authenticated 512-byte HPKE note. */
export function encodeBudgetNotePayload(input, scope) {
  normalizeShieldedScope(scope);
  const note = noteOf(input);
  const bytes = concatBytes(MAGIC, fixed(note.familyCommitment, 32), fixed(note.parentVersion, 8),
    fixed(note.rate, 16), fixed(note.periodDays, 4), fixed(note.policySalt, 32),
    fixed(note.allocationKeyCommitment, 32), fixed(note.codeAlias, 32), fixed(note.codeNonce, 32),
    fixed(note.ownerCommitment, 32), note.viewingKey,
    fixed(note.eligibleFrom, 8), fixed(note.remaining, 16), fixed(note.nonce, 32));
  fail(bytes.length === BUDGET_NOTE_PAYLOAD_BYTES, "Invalid budget payload length");
  return bytes;
}
export function decodeBudgetNotePayload(input, scope) {
  normalizeShieldedScope(scope);
  const bytes = asUint8Array(input, "budget payload");
  fail(bytes.length === BUDGET_NOTE_PAYLOAD_BYTES && MAGIC.every((value, i) => bytes[i] === value), "Unsupported or truncated budget payload");
  let offset = MAGIC.length;
  const read = width => {
    const value = BigInt(bytesToHex(bytes.subarray(offset, offset + width)));
    offset += width;
    return value;
  };
  const note = { familyCommitment: read(32), parentVersion: read(8), rate: read(16), periodDays: read(4),
    policySalt: read(32), allocationKeyCommitment: read(32), codeAlias: read(32), codeNonce: read(32),
    ownerCommitment: read(32), viewingKey: bytes.slice(offset, offset + 32) };
  offset += 32;
  return noteOf({ ...note, eligibleFrom: read(8), remaining: read(16), nonce: read(32) });
}
export function verifyBudgetNotePayload(input, scope) {
  const note = decodeBudgetNotePayload(input.payload, scope);
  const ciphertextHashField = computeShieldedCiphertextHashField(input.ciphertext);
  const noteCommitment = computeBudgetNoteCommitment({ ...note, ciphertextHashField }, scope);
  fail(noteCommitment === nonzero(input.noteCommitment, "noteCommitment"), "Budget payload does not match the published note commitment");
  return { note, ciphertextHashField, noteCommitment,
    policyCommitment: computePolicyCommitment(note, scope),
    budgetKey: computeBudgetKey({ codeAlias: note.codeAlias,
      policyCommitment: computePolicyCommitment(note, scope) }, scope) };
}
export async function decryptBudgetNote(input, scope) {
  let payload;
  try {
    payload = await decryptShieldedNote({ ...normalizeShieldedScope(scope), hpkeIkm: input.hpkeIkm, ciphertext: input.ciphertext });
    return verifyBudgetNotePayload({ ...input, payload }, scope);
  } catch (error) {
    throw new ProtocolError("BUDGET_DECRYPTION_FAILED", "Could not authenticate budget note", { cause: error });
  } finally { wipeBytes(payload); }
}

/** Exact output-free Fund statement; money ciphertext hashes must come from the published bytes. */
export function buildFundPublicSignals(input, scope) {
  const normalized = normalizeShieldedScope(scope);
  fail(input.outputCommitments?.length === 2 && input.ciphertextHashes?.length === 2, "Fund requires two outputs");
  return [normalized.chainId, BigInt(normalized.poolAddress), nonzero(input.commonBinding, "commonBinding"),
    nonzero(input.codeAlias, "codeAlias"), nonzero(input.nonce, "nonce"), nonzero(input.ownerCommitment, "ownerCommitment"),
    bigintFrom(input.viewKeyLo, "viewKeyLo", MAX_UINT128), bigintFrom(input.viewKeyHi, "viewKeyHi", MAX_UINT128),
    nonzero(input.capabilityBinding, "capabilityBinding"), nonzero(input.familyTag, "familyTag"),
    uint64(input.parentVersion, "parentVersion"), nonzero(input.policyCommitment, "policyCommitment"),
    nonzero(input.budgetKey, "budgetKey"), uint64(input.eligibleFrom, "eligibleFrom"),
    nonzero(input.inputRoot, "inputRoot"), nonzero(input.inputNullifier, "inputNullifier"),
    ...input.outputCommitments.map((value, index) => nonzero(value, `outputCommitments[${index}]`)),
    ...input.ciphertextHashes.map((value, index) => field(value, `ciphertextHashes[${index}]`))];
}
function membershipOf(input, leaf, label = "donor") {
  const depth = Number(bigintFrom(input.depth, `${label}.depth`, 32n));
  const index = bigintFrom(input.index, `${label}.index`, (1n << BigInt(depth)) - 1n);
  fail(Array.isArray(input.siblings) && input.siblings.length >= depth && input.siblings.length <= 32, `Invalid ${label} Merkle siblings`);
  const siblings = input.siblings.map((value, i) => field(value, `${label}.siblings[${i}]`));
  while (siblings.length < 32) siblings.push(0n);
  let root = leaf;
  for (let level = 0; level < depth; level++) {
    root = (index >> BigInt(level)) & 1n ? poseidon2([siblings[level], root]) : poseidon2([root, siblings[level]]);
  }
  if (input.root !== undefined) fail(root === nonzero(input.root, `${label}.root`), `${label} note does not match its Merkle root`);
  return { depth: BigInt(depth), index, siblings, root };
}

/**
 * Prepare one deposit action. The pool chooses create/append atomically from budgetKey;
 * neither branch consumes an existing recipient note. All private witness proving runs
 * through the supplied local prover. Its returned public statement must match exactly.
 */
export async function prepareBudgetDeposit(input, scope) {
  const normalized = normalizeShieldedScope(scope);
  const asOf = uint64(input.asOf, "asOf");
  fail(asOf > 0n, "asOf must be nonzero");
  fail(input.authorizerScope !== undefined, "The pool eligibility registry scope is required");
  const encoded = typeof input.code === "string" ? input.code : encodeReceiveCode(input.code);
  const code = await verifyReceiveCode({ code: encoded, verifyAuthorization: input.verifyAuthorization,
    verifyCapability: input.verifyCapability, chainId: normalized.chainId, authorizerScope: input.authorizerScope, asOf });
  const policy = policyOf(input.policy);
  const familyTag = computeFamilyTag({ familyCommitment: policy.familyCommitment, nonce: code.nonce });
  const capabilityIndex = input.capabilityIndex === undefined
    ? code.capabilities.findIndex(cap => cap.familyTag === familyTag && cap.parentVersion === policy.parentVersion)
    : Number(bigintFrom(input.capabilityIndex, "capabilityIndex", BigInt(RECEIVE_MAX_CAPABILITIES - 1)));
  const capability = code.capabilities[capabilityIndex];
  fail(capability?.familyTag === familyTag && capability?.parentVersion === policy.parentVersion, "Receive code does not qualify for this family policy");
  buildCapabilityPublicSignals(code, capability);
  if (input.checkEligibility !== undefined) {
    fail(typeof input.checkEligibility === "function" && await input.checkEligibility(code, capability) === true, "Current budget eligibility has been revoked");
  }
  fail(typeof input.readBudgetRecord === "function", "Current pool budget record reader is required");
  fail(typeof input.proveFund === "function", "A local Fund prover is required");
  const policyCommitment = computePolicyCommitment(policy, normalized);
  const budgetKey = computeBudgetKey({ codeAlias: code.codeAlias, policyCommitment }, normalized);
  const record = await input.readBudgetRecord(budgetKey);
  const exists = record != null && record.exists !== false && BigInt(record.eligibleFrom ?? 0n) !== 0n;
  let eligibleFrom;
  if (exists) {
    fail(nonzero(record.commonBinding, "record.commonBinding") === code.commonBinding
      && nonzero(record.policyCommitment, "record.policyCommitment") === policyCommitment,
    "Existing budget record belongs to another receive code or policy");
    eligibleFrom = uint64(record.eligibleFrom, "record.eligibleFrom");
  } else eligibleFrom = uint64(asOf + BUDGET_ELIGIBILITY_DELAY, "eligibleFrom");
  const periods = uint64(input.budgetPeriods, "budgetPeriods");
  fail(periods > 0n, "budgetPeriods must be nonzero");
  const remaining = amount(policy.rate * periods, "budgetAmount");
  const donor = input.donor;
  const donorOwnerSecret = nonzero(donor.ownerSecret, "donor.ownerSecret");
  const donorOwnerCommitment = computeShieldedOwnerCommitment(donorOwnerSecret);
  if (donor.ownerCommitment !== undefined) fail(donorOwnerCommitment === nonzero(donor.ownerCommitment, "donor.ownerCommitment"), "Donor spending key does not control its note");
  const donorAmount = amount(donor.amount, "donor.amount");
  fail(donorAmount >= remaining, "Donor note has insufficient funds");
  const donorNonce = nonzero(donor.nonce, "donor.nonce");
  const donorCiphertextHash = donor.ciphertext !== undefined
    ? computeShieldedCiphertextHashField(donor.ciphertext)
    : field(donor.ciphertextHashField, "donor.ciphertextHashField");
  const donorNoteCommitment = computeShieldedValueNoteCommitment({ ownerCommitment: donorOwnerCommitment,
    amount: donorAmount, nonce: donorNonce, ciphertextHashField: donorCiphertextHash }, normalized);
  const membership = membershipOf(donor.membership, donorNoteCommitment);
  const inputNullifier = computeShieldedSpendNullifier({ ownerSecret: donorOwnerSecret, noteCommitment: donorNoteCommitment }, normalized);
  const budgetNonce = input.budgetNonce === undefined ? generateShieldedRandomField() : nonzero(input.budgetNonce, "budgetNonce");
  const changeNonce = input.changeNonce === undefined ? generateShieldedRandomField() : nonzero(input.changeNonce, "changeNonce");
  const note = noteOf({ ...policy, codeAlias: code.codeAlias, codeNonce: code.nonce,
    ownerCommitment: code.ownerCommitment, viewingKey: code.viewingKey,
    eligibleFrom, remaining, nonce: budgetNonce });
  const changeNote = { ownerCommitment: donorOwnerCommitment, amount: donorAmount - remaining, nonce: changeNonce };
  const payload = encodeBudgetNotePayload(note, normalized);
  const changePayload = encodeShieldedValueNotePayload(changeNote, normalized);
  let budgetCiphertext, changeCiphertext;
  try {
    [budgetCiphertext, changeCiphertext] = await Promise.all([
      encryptShieldedNote({ ...normalized, recipientPublicKey: code.viewingKey, payload }),
      encryptShieldedNote({ ...normalized, recipientPublicKey: donor.viewingKey, payload: changePayload }),
    ]);
  } finally { wipeBytes(payload); wipeBytes(changePayload); }
  const ciphertextHashes = [budgetCiphertext, changeCiphertext].map(computeShieldedCiphertextHashField);
  const outputCommitments = [computeBudgetNoteCommitment({ ...note, ciphertextHashField: ciphertextHashes[0] }, normalized),
    computeShieldedValueNoteCommitment({ ...changeNote, ciphertextHashField: ciphertextHashes[1] }, normalized)];
  const { viewKeyLo, viewKeyHi } = splitShieldedViewPublicKey(code.viewingKey);
  const publicInput = { commonBinding: code.commonBinding, codeAlias: code.codeAlias, nonce: code.nonce,
    ownerCommitment: code.ownerCommitment, viewKeyLo, viewKeyHi, capabilityBinding: capability.capabilityBinding,
    familyTag, parentVersion: policy.parentVersion, policyCommitment, budgetKey, eligibleFrom,
    inputRoot: membership.root, inputNullifier, outputCommitments, ciphertextHashes };
  const publicSignals = buildFundPublicSignals(publicInput, normalized);
  const witness = { chainId: normalized.chainId, pool: BigInt(normalized.poolAddress), ...publicInput,
    donorOwnerSecret, donorAmount, donorNonce, donorCiphertextHash,
    donorDepth: membership.depth, donorIndex: membership.index, donorSiblings: membership.siblings,
    familyCommitment: policy.familyCommitment, rate: policy.rate, periodDays: policy.periodDays,
    policySalt: policy.policySalt, allocationKeyCommitment: policy.allocationKeyCommitment,
    budgetPeriods: periods, budgetNonce, changeNonce };
  const result = await input.proveFund(witness);
  fail(result?.proof !== undefined && Array.isArray(result.publicSignals), "Fund prover did not return a proof statement");
  const actualSignals = result.publicSignals.map((value, i) => field(value, `proof.publicSignals[${i}]`));
  fail(actualSignals.length === publicSignals.length && actualSignals.every((value, i) => value === publicSignals[i]), "Fund prover returned a different public statement");
  if (input.verifyFund !== undefined) fail(await input.verifyFund(result.proof, publicSignals) === true, "Invalid Fund proof");
  return { kind: exists ? "append" : "create", code, capabilityIndex, policyCommitment, budgetKey, eligibleFrom,
    note, changeNote, outputCommitments, ciphertextHashes, outputCiphertexts: [budgetCiphertext, changeCiphertext],
    publicInput, publicSignals, proof: result.proof };
}

export const CLAIM_PUBLIC_SIGNAL_COUNT = 23;

export function buildClaimPublicSignals(input, scope) {
  const normalized = normalizeShieldedScope(scope);
  fail(input.outputCommitments?.length === 2 && input.ciphertextHashes?.length === 2, "Claim requires two outputs");
  return [normalized.chainId, BigInt(normalized.poolAddress), nonzero(input.codeAlias, "codeAlias"),
    nonzero(input.nonce, "nonce"), nonzero(input.ownerCommitment, "ownerCommitment"),
    bigintFrom(input.viewKeyLo, "viewKeyLo", MAX_UINT128), bigintFrom(input.viewKeyHi, "viewKeyHi", MAX_UINT128),
    nonzero(input.policyCommitment, "policyCommitment"), nonzero(input.budgetKey, "budgetKey"),
    uint64(input.eligibleFrom, "eligibleFrom"), uint64(input.asOf, "asOf"),
    nonzero(input.inputRoot, "inputRoot"), nonzero(input.inputNullifier, "inputNullifier"),
    nonzero(input.periodNullifier, "periodNullifier"),
    ...input.outputCommitments.map((value, index) => nonzero(value, `outputCommitments[${index}]`)),
    ...input.ciphertextHashes.map((value, index) => field(value, `ciphertextHashes[${index}]`)),
    authorizerScopeOf(input.authorizerScope), nonzero(input.issuanceRoot, "issuanceRoot"),
    nonzero(input.childTag, "childTag"), nonzero(input.endorsementTag, "endorsementTag"), nonzero(input.trustedTag, "trustedTag")];
}

/** Subject/policy/period allowance stays canonical across different codes and contributions. */
export function computePeriodNullifier(input, scope) {
  return poseidon4([computeShieldedScopedPurpose(1017n, scope),
    nonzero(input.derivedSecretField, "derivedSecretField"),
    nonzero(input.policyCommitment, "policyCommitment"), uint64(input.periodIndex, "periodIndex")]);
}

function authorizerScopeOf(value) {
  const numeric = typeof value === "string" && /^0x[\da-f]{40}$/iu.test(value) ? BigInt(value) : value;
  const scope = bigintFrom(numeric, "authorizerScope", (1n << 160n) - 1n);
  fail(scope > 0n, "authorizerScope must be nonzero");
  return scope;
}

/** Claim one mature policy period after proving current qualification for the same hidden family. */
export async function prepareBudgetClaim(input, scope) {
  const normalized = normalizeShieldedScope(scope);
  fail(typeof input.proveClaim === "function", "A local Claim prover is required");
  const verified = verifyBudgetNotePayload({ payload: encodeBudgetNotePayload(input.note, normalized),
    ciphertext: input.ciphertext, noteCommitment: input.noteCommitment }, normalized);
  const note = verified.note;
  const key = input.keyMaterial;
  const ownerSecret = nonzero(key.ownerSecret, "ownerSecret");
  fail(computeShieldedOwnerCommitment(ownerSecret) === note.ownerCommitment, "Spending key does not control this budget note");
  const derivedSecretField = nonzero(input.derivedSecretField ?? key.codeRootSecret, "derivedSecretField");
  const codeSecret = nonzero(key.codeSecret, "codeSecret");
  fail(poseidon4([73103n, derivedSecretField, note.codeNonce, codeSecret]) === note.codeAlias,
    "Canonical subject and code secret do not match this budget note");
  if (key.viewingKey !== undefined) {
    const expectedKey = asUint8Array(key.viewingKey, "keyMaterial.viewingKey");
    fail(expectedKey.length === note.viewingKey.length && expectedKey.every((value, i) => value === note.viewingKey[i]),
      "Recovery viewing key does not match the budget note");
  }
  const authorizerScope = authorizerScopeOf(input.authorizerScope);
  const qualification = input.qualification;
  fail(qualification !== undefined && qualification !== null, "Current qualification is required to claim");
  if (qualification.familyRoot !== undefined) fail(nonzero(qualification.familyRoot, "qualification.familyRoot") === note.familyCommitment, "Qualification belongs to another family");
  if (qualification.parentVersion !== undefined) fail(uint64(qualification.parentVersion, "qualification.parentVersion") === note.parentVersion, "Qualification belongs to another family version");
  const issueNonce = nonzero(qualification.issueNonce, "qualification.issueNonce");
  const endorser = nonzero(qualification.endorser, "qualification.endorser");
  const xChild = nonzero(qualification.xChild, "qualification.xChild");
  const xEndorse = nonzero(qualification.xEndorse, "qualification.xEndorse");
  const xTrust = nonzero(qualification.xTrust, "qualification.xTrust");
  const credentialSalt = nonzero(qualification.credentialSalt, "qualification.credentialSalt");
  const issuanceRoot = nonzero(qualification.issuanceRoot, "qualification.issuanceRoot");
  const u = poseidon3([73204n, derivedSecretField, issueNonce]);
  const fact = poseidon7([73101n, u, note.familyCommitment, endorser, note.parentVersion, xChild, xEndorse]);
  const trust = poseidon5([73102n, note.familyCommitment, endorser, note.parentVersion, xTrust]);
  const domain = poseidon3([74000n, normalized.chainId, authorizerScope]);
  const credential = poseidon5([73400n, fact, trust, credentialSalt, domain]);
  const credentialMembership = membershipOf({ root: issuanceRoot, depth: qualification.credentialDepth,
    index: qualification.credentialIndex, siblings: qualification.credentialSiblings }, credential, "qualification");
  const roleStatus = { issuanceRoot, nonce: note.codeNonce,
    childTag: computeRoleTag({ role: "child", roleSecret: xChild, nonce: note.codeNonce }),
    endorsementTag: computeRoleTag({ role: "endorsement", roleSecret: xEndorse, nonce: note.codeNonce }),
    trustedTag: computeRoleTag({ role: "trusted", roleSecret: xTrust, nonce: note.codeNonce }) };
  if (input.checkQualification !== undefined) {
    fail(typeof input.checkQualification === "function" && await input.checkQualification(roleStatus) === true,
      "Current claim qualification has been revoked or is no longer authenticated");
  }
  const periodIndex = uint64(input.periodIndex, "periodIndex");
  const asOf = uint64(input.asOf, "asOf");
  fail(note.eligibleFrom + (periodIndex + 1n) * note.periodDays * 86400n <= asOf, "Budget period has not matured");
  fail(note.remaining >= note.rate, "Budget contribution has no remaining period");
  const remainingPeriods = uint64(note.remaining / note.rate, "remainingPeriods");
  const membership = membershipOf(input.membership, verified.noteCommitment, "budget");
  const inputNullifier = computeShieldedSpendNullifier({ ownerSecret, noteCommitment: verified.noteCommitment }, normalized);
  const periodNullifier = computePeriodNullifier({ derivedSecretField,
    policyCommitment: verified.policyCommitment, periodIndex }, normalized);
  if (input.isPeriodSpent !== undefined) {
    fail(typeof input.isPeriodSpent === "function" && await input.isPeriodSpent(periodNullifier) === false, "Budget period allowance was already claimed");
  }
  const outputBudgetNonce = input.outputBudgetNonce === undefined ? generateShieldedRandomField() : nonzero(input.outputBudgetNonce, "outputBudgetNonce");
  const valueNonce = input.valueNonce === undefined ? generateShieldedRandomField() : nonzero(input.valueNonce, "valueNonce");
  const remainderNote = noteOf({ ...note, remaining: note.remaining - note.rate, nonce: outputBudgetNonce });
  const valueNote = { ownerCommitment: note.ownerCommitment, amount: note.rate, nonce: valueNonce };
  const remainderPayload = encodeBudgetNotePayload(remainderNote, normalized);
  const valuePayload = encodeShieldedValueNotePayload(valueNote, normalized);
  let remainderCiphertext, valueCiphertext;
  try {
    [remainderCiphertext, valueCiphertext] = await Promise.all([
      encryptShieldedNote({ ...normalized, recipientPublicKey: note.viewingKey, payload: remainderPayload }),
      encryptShieldedNote({ ...normalized, recipientPublicKey: note.viewingKey, payload: valuePayload }),
    ]);
  } finally { wipeBytes(remainderPayload); wipeBytes(valuePayload); }
  const outputCiphertexts = [remainderCiphertext, valueCiphertext];
  const ciphertextHashes = outputCiphertexts.map(computeShieldedCiphertextHashField);
  const outputCommitments = [computeBudgetNoteCommitment({ ...remainderNote, ciphertextHashField: ciphertextHashes[0] }, normalized),
    computeShieldedValueNoteCommitment({ ...valueNote, ciphertextHashField: ciphertextHashes[1] }, normalized)];
  const { viewKeyLo, viewKeyHi } = splitShieldedViewPublicKey(note.viewingKey);
  const publicInput = { codeAlias: note.codeAlias, nonce: note.codeNonce, ownerCommitment: note.ownerCommitment,
    viewKeyLo, viewKeyHi, policyCommitment: verified.policyCommitment, budgetKey: verified.budgetKey,
    eligibleFrom: note.eligibleFrom, asOf, inputRoot: membership.root, inputNullifier,
    periodNullifier, outputCommitments, ciphertextHashes, authorizerScope, issuanceRoot,
    childTag: roleStatus.childTag, endorsementTag: roleStatus.endorsementTag, trustedTag: roleStatus.trustedTag };
  const publicSignals = buildClaimPublicSignals(publicInput, normalized);
  const witness = { chainId: normalized.chainId, pool: BigInt(normalized.poolAddress), ...publicInput,
    derivedSecretField, codeSecret, ownerSecret, familyCommitment: note.familyCommitment,
    parentVersion: note.parentVersion, rate: note.rate, periodDays: note.periodDays,
    policySalt: note.policySalt, allocationKeyCommitment: note.allocationKeyCommitment,
    remaining: note.remaining, remainingPeriods, budgetNonce: note.nonce,
    budgetCiphertextHash: verified.ciphertextHashField, noteDepth: membership.depth,
    noteIndex: membership.index, noteSiblings: membership.siblings, periodIndex, outputBudgetNonce, valueNonce,
    issueNonce, endorser, xChild, xEndorse, xTrust, credentialSalt,
    credentialDepth: credentialMembership.depth, credentialIndex: credentialMembership.index,
    credentialSiblings: credentialMembership.siblings };
  const result = await input.proveClaim(witness);
  fail(result?.proof !== undefined && Array.isArray(result.publicSignals), "Claim prover did not return a proof statement");
  const actualSignals = result.publicSignals.map((value, i) => field(value, `proof.publicSignals[${i}]`));
  fail(actualSignals.length === publicSignals.length && actualSignals.every((value, i) => value === publicSignals[i]), "Claim prover returned a different public statement");
  if (input.verifyClaim !== undefined) fail(await input.verifyClaim(result.proof, publicSignals) === true, "Invalid Claim proof");
  return { note: remainderNote, valueNote, periodNullifier, inputNullifier,
    outputCommitments, ciphertextHashes, outputCiphertexts, publicInput, publicSignals, proof: result.proof };
}

export const TRANSFER_PUBLIC_SIGNAL_COUNT = 12;
export function buildTransferPublicSignals(input, scope) {
  const normalized = normalizeShieldedScope(scope);
  fail(input.outputCommitments?.length === 2 && input.ciphertextHashes?.length === 2, "Transfer requires two outputs");
  return [normalized.chainId, BigInt(normalized.poolAddress), nonzero(input.commonBinding, "commonBinding"),
    nonzero(input.ownerCommitment, "ownerCommitment"), bigintFrom(input.viewKeyLo, "viewKeyLo", MAX_UINT128),
    bigintFrom(input.viewKeyHi, "viewKeyHi", MAX_UINT128), nonzero(input.inputRoot, "inputRoot"),
    nonzero(input.inputNullifier, "inputNullifier"),
    ...input.outputCommitments.map((value, i) => nonzero(value, `outputCommitments[${i}]`)),
    ...input.ciphertextHashes.map((value, i) => field(value, `ciphertextHashes[${i}]`))];
}

/** Ordinary transfers use only generic authorization; no current family eligibility is queried. */
export async function prepareTransfer(input, scope) {
  const normalized = normalizeShieldedScope(scope);
  fail(input.authorizerScope !== undefined, "The pool eligibility registry scope is required");
  fail(typeof input.proveTransfer === "function", "A local Transfer prover is required");
  const encoded = typeof input.code === "string" ? input.code : encodeReceiveCode(input.code);
  const code = await verifyReceiveCode({ code: encoded, verifyAuthorization: input.verifyAuthorization,
    verifyCapability: input.verifyCapability, chainId: normalized.chainId, authorizerScope: input.authorizerScope,
    asOf: uint64(input.asOf, "asOf") });
  const transferAmount = amount(input.amount, "amount");
  fail(transferAmount > 0n, "Transfer amount must be nonzero");
  const donor = input.donor;
  const donorOwnerSecret = nonzero(donor.ownerSecret, "donor.ownerSecret");
  const donorOwnerCommitment = computeShieldedOwnerCommitment(donorOwnerSecret);
  if (donor.ownerCommitment !== undefined) fail(donorOwnerCommitment === nonzero(donor.ownerCommitment, "donor.ownerCommitment"), "Donor spending key does not control its note");
  const donorAmount = amount(donor.amount, "donor.amount");
  fail(donorAmount >= transferAmount, "Donor note has insufficient funds");
  const donorNonce = nonzero(donor.nonce, "donor.nonce");
  const donorCiphertextHash = donor.ciphertext !== undefined ? computeShieldedCiphertextHashField(donor.ciphertext)
    : field(donor.ciphertextHashField, "donor.ciphertextHashField");
  const donorNoteCommitment = computeShieldedValueNoteCommitment({ ownerCommitment: donorOwnerCommitment,
    amount: donorAmount, nonce: donorNonce, ciphertextHashField: donorCiphertextHash }, normalized);
  const membership = membershipOf(donor.membership, donorNoteCommitment);
  const inputNullifier = computeShieldedSpendNullifier({ ownerSecret: donorOwnerSecret, noteCommitment: donorNoteCommitment }, normalized);
  const recipientNonce = input.recipientNonce === undefined ? generateShieldedRandomField() : nonzero(input.recipientNonce, "recipientNonce");
  const changeNonce = input.changeNonce === undefined ? generateShieldedRandomField() : nonzero(input.changeNonce, "changeNonce");
  const note = { ownerCommitment: code.ownerCommitment, amount: transferAmount, nonce: recipientNonce };
  const changeNote = { ownerCommitment: donorOwnerCommitment, amount: donorAmount - transferAmount, nonce: changeNonce };
  const payload = encodeShieldedValueNotePayload(note, normalized);
  const changePayload = encodeShieldedValueNotePayload(changeNote, normalized);
  let recipientCiphertext, changeCiphertext;
  try {
    [recipientCiphertext, changeCiphertext] = await Promise.all([
      encryptShieldedNote({ ...normalized, recipientPublicKey: code.viewingKey, payload }),
      encryptShieldedNote({ ...normalized, recipientPublicKey: donor.viewingKey, payload: changePayload }),
    ]);
  } finally { wipeBytes(payload); wipeBytes(changePayload); }
  const outputCiphertexts = [recipientCiphertext, changeCiphertext];
  const ciphertextHashes = outputCiphertexts.map(computeShieldedCiphertextHashField);
  const outputCommitments = [computeShieldedValueNoteCommitment({ ...note, ciphertextHashField: ciphertextHashes[0] }, normalized),
    computeShieldedValueNoteCommitment({ ...changeNote, ciphertextHashField: ciphertextHashes[1] }, normalized)];
  const publicInput = { commonBinding: code.commonBinding, ownerCommitment: code.ownerCommitment,
    ...splitShieldedViewPublicKey(code.viewingKey), inputRoot: membership.root, inputNullifier,
    outputCommitments, ciphertextHashes };
  const publicSignals = buildTransferPublicSignals(publicInput, normalized);
  const witness = { chainId: normalized.chainId, pool: BigInt(normalized.poolAddress), ...publicInput,
    donorOwnerSecret, donorAmount, donorNonce, donorCiphertextHash,
    donorDepth: membership.depth, donorIndex: membership.index, donorSiblings: membership.siblings,
    amount: transferAmount, recipientNonce, changeNonce };
  const result = await input.proveTransfer(witness);
  fail(result?.proof !== undefined && Array.isArray(result.publicSignals), "Transfer prover did not return a proof statement");
  const actualSignals = result.publicSignals.map((value, i) => field(value, `proof.publicSignals[${i}]`));
  fail(actualSignals.length === publicSignals.length && actualSignals.every((value, i) => value === publicSignals[i]), "Transfer prover returned a different public statement");
  if (input.verifyTransfer !== undefined) fail(await input.verifyTransfer(result.proof, publicSignals) === true, "Invalid Transfer proof");
  return { code, note, changeNote, inputNullifier, outputCommitments, ciphertextHashes, outputCiphertexts,
    publicInput, publicSignals, proof: result.proof };
}
