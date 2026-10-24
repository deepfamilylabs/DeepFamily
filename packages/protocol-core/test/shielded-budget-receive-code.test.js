import test from "node:test";
import assert from "node:assert/strict";
import { bech32m } from "@scure/base";
import {
  SHIELDED_BUDGET_RECEIVE_CODE_VERSION,
  decodeShieldedBudgetReceiveCode,
  decodeShieldedReceiveCredential,
  encodeShieldedBudgetReceiveCode,
  encodeShieldedReceiveCredential,
  isShieldedBudgetReceiveCode,
} from "../index.js";

// Transport fixtures only. Each contained proof still needs its own fixed issuer key.
const proof = {
  pi_a: ["1", "2", "1"],
  pi_b: [["3", "4"], ["5", "6"], ["1", "0"]],
  pi_c: ["7", "8", "1"],
  protocol: "groth16",
  curve: "bn128",
};
const shared = {
  authorizationAlias: 13n,
  authorizationCounter: 4n,
  expiresAt: 1900000000n,
  ownerCommitment: 23n,
  viewingKey: new Uint8Array(32).fill(17),
  proof,
};
const credentials = (keyMode = 0, anonymousPatch = {}) => ({
  fundCode: encodeShieldedReceiveCredential({ ...shared, keyMode, disclosure: "fund", identityCommitment: 19n }),
  anonymousCode: encodeShieldedReceiveCredential({ ...shared, keyMode, ...anonymousPatch, disclosure: "anonymous" }),
});
function rawBundle({ fundCode, anonymousCode }, version = 1) {
  const fund = bech32m.fromWords(bech32m.decode(fundCode, false).words);
  const anonymous = bech32m.fromWords(bech32m.decode(anonymousCode, false).words);
  return bech32m.encode("dfbudget", bech32m.toWords(Uint8Array.of(version, ...fund, ...anonymous)), false);
}

test("one budget code preserves independent Fund and anonymous credentials in both key modes", () => {
  assert.equal(SHIELDED_BUDGET_RECEIVE_CODE_VERSION, 1);
  for (const keyMode of [0, 1]) {
    const input = credentials(keyMode);
    const code = encodeShieldedBudgetReceiveCode(input);
    assert.match(code, /^dfbudget1/u);
    assert.equal(isShieldedBudgetReceiveCode(code), true);
    assert.deepEqual(decodeShieldedBudgetReceiveCode(code), input);
    const packet = bech32m.fromWords(bech32m.decode(code, false).words);
    assert.equal(packet.length, 779);
    const { fundCode, anonymousCode } = decodeShieldedBudgetReceiveCode(code);
    assert.equal(decodeShieldedReceiveCredential(fundCode).disclosure, "fund");
    assert.equal(decodeShieldedReceiveCredential(anonymousCode).disclosure, "anonymous");
    assert.throws(() => decodeShieldedReceiveCredential(code));
  }
});

test("budget code normalizes presentation without changing either credential or proof", () => {
  const input = credentials();
  const code = encodeShieldedBudgetReceiveCode({
    fundCode: input.fundCode.toUpperCase(),
    anonymousCode: ` ${input.anonymousCode.slice(0, 90)}\n${input.anonymousCode.slice(90)} `,
  });
  assert.equal(code, rawBundle(input));
  assert.deepEqual(decodeShieldedBudgetReceiveCode(code.toUpperCase()), input);
  assert.deepEqual(decodeShieldedBudgetReceiveCode(` ${code.slice(0, 100)}\n${code.slice(100)} `), input);
  assert.equal(isShieldedBudgetReceiveCode(` ${code.toUpperCase()} `), true);
});

test("encoding and decoding reject mixed receiving identities, keys, modes and authorization validity", () => {
  for (const patch of [
    { authorizationAlias: 29n },
    { authorizationCounter: 5n },
    { expiresAt: shared.expiresAt + 1n },
    { ownerCommitment: 31n },
    { viewingKey: new Uint8Array(32).fill(18) },
    { keyMode: 1 },
  ]) {
    const input = credentials(0, patch);
    assert.throws(() => encodeShieldedBudgetReceiveCode(input), /same receiving material/u);
    // A checksum-valid envelope assembled outside our encoder must fail too.
    assert.throws(() => decodeShieldedBudgetReceiveCode(rawBundle(input)), /same receiving material/u);
  }
});

test("a bundle requires both distinct credential disclosures", () => {
  const { fundCode, anonymousCode } = credentials();
  for (const input of [
    { fundCode, anonymousCode: fundCode },
    { fundCode: anonymousCode, anonymousCode },
    { fundCode: anonymousCode, anonymousCode: fundCode },
  ]) assert.throws(() => encodeShieldedBudgetReceiveCode(input), /separate Fund and anonymous/u);
  assert.throws(() => decodeShieldedBudgetReceiveCode(fundCode));
  assert.throws(() => decodeShieldedBudgetReceiveCode(anonymousCode));
  assert.equal(isShieldedBudgetReceiveCode(fundCode), false);
  assert.equal(isShieldedBudgetReceiveCode(anonymousCode), false);
  assert.equal(isShieldedBudgetReceiveCode(null), false);
});

test("decoding rejects unsupported versions, lengths, checksum, prefix and inner suite fields", () => {
  const input = credentials();
  const code = encodeShieldedBudgetReceiveCode(input);
  for (const version of [0, 2, 255]) assert.throws(() => decodeShieldedBudgetReceiveCode(rawBundle(input, version)));
  const bytes = bech32m.fromWords(bech32m.decode(code, false).words);
  for (const packet of [bytes.slice(0, -1), Uint8Array.of(...bytes, 0)]) {
    assert.throws(() => decodeShieldedBudgetReceiveCode(bech32m.encode("dfbudget", bech32m.toWords(packet), false)));
  }
  assert.throws(() => decodeShieldedBudgetReceiveCode(code.slice(0, -1)));
  assert.throws(() => decodeShieldedBudgetReceiveCode(bech32m.encode("dfrecv", bech32m.toWords(bytes), false)));
  const invalidSuite = bytes.slice();
  invalidSuite[1 + 405 + 2] = 2;
  assert.throws(() => decodeShieldedBudgetReceiveCode(bech32m.encode("dfbudget", bech32m.toWords(invalidSuite), false)));
  assert.throws(() => decodeShieldedBudgetReceiveCode(null));
  // Prefix detection never claims that the code is checksum-valid or authenticated.
  assert.equal(isShieldedBudgetReceiveCode("dfbudget1broken"), true);
  assert.throws(() => decodeShieldedBudgetReceiveCode("dfbudget1broken"));
});
