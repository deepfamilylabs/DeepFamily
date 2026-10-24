import { bech32m } from "@scure/base";
import { protocolAssert } from "./errors.js";
import {
  decodeShieldedReceiveCredential,
  encodeShieldedReceiveCredential,
} from "./shielded-receive-credential.js";

export const SHIELDED_BUDGET_RECEIVE_CODE_VERSION = 1;
const PREFIX = "dfbudget";
const FUND_BYTES = 405;
const ANONYMOUS_BYTES = 373;
const PACKET_BYTES = 1 + FUND_BYTES + ANONYMOUS_BYTES;

function matchingCredentials(fundCode, anonymousCode) {
  const fund = decodeShieldedReceiveCredential(fundCode);
  const anonymous = decodeShieldedReceiveCredential(anonymousCode);
  protocolAssert(
    fund.disclosure === "fund" && anonymous.disclosure === "anonymous",
    "INVALID_SHIELDED_BUDGET_RECEIVE_CODE",
    "A budget receive code needs separate Fund and anonymous credentials",
  );
  // The Fund issuer adds I at index 3. Every other authenticated public field
  // must agree, including R, counter, expiry, receiving keys, mode and suites.
  const sharedFundSignals = [...fund.publicSignals.slice(0, 3), ...fund.publicSignals.slice(4)];
  protocolAssert(
    sharedFundSignals.length === anonymous.publicSignals.length &&
      sharedFundSignals.every((value, index) => value === anonymous.publicSignals[index]),
    "INVALID_SHIELDED_BUDGET_RECEIVE_CODE",
    "Budget and letter credentials must authenticate the same receiving material and validity",
  );
  return {
    fundCode: encodeShieldedReceiveCredential(fund),
    anonymousCode: encodeShieldedReceiveCredential(anonymous),
  };
}

/** Prefix dispatch only; callers must decode and verify both issuer proofs. */
export function isShieldedBudgetReceiveCode(code) {
  return typeof code === "string" && /^dfbudget1/iu.test(code.replace(/\s+/gu, ""));
}

/** Bundle two independently issued credentials without changing their proof statements. */
export function encodeShieldedBudgetReceiveCode(input) {
  const { fundCode, anonymousCode } = matchingCredentials(input.fundCode, input.anonymousCode);
  const fundBytes = bech32m.fromWords(bech32m.decode(fundCode, false).words);
  const anonymousBytes = bech32m.fromWords(bech32m.decode(anonymousCode, false).words);
  const packet = new Uint8Array(PACKET_BYTES);
  packet[0] = SHIELDED_BUDGET_RECEIVE_CODE_VERSION;
  packet.set(fundBytes, 1);
  packet.set(anonymousBytes, 1 + FUND_BYTES);
  return bech32m.encode(PREFIX, bech32m.toWords(packet), false);
}

/** Parse and match fields only. Authenticity requires both fixed issuer verification keys. */
export function decodeShieldedBudgetReceiveCode(code) {
  let packet;
  try {
    const decoded = bech32m.decode(code.replace(/\s+/gu, ""), false);
    packet = bech32m.fromWords(decoded.words);
    if (
      decoded.prefix !== PREFIX || packet.length !== PACKET_BYTES ||
      packet[0] !== SHIELDED_BUDGET_RECEIVE_CODE_VERSION
    ) throw new Error();
  } catch {
    protocolAssert(
      false,
      "INVALID_SHIELDED_BUDGET_RECEIVE_CODE_ENCODING",
      "Budget receive code is incomplete or mistyped",
    );
  }
  const fundCode = bech32m.encode("dffund", bech32m.toWords(packet.subarray(1, 1 + FUND_BYTES)), false);
  const anonymousCode = bech32m.encode("dfrecv", bech32m.toWords(packet.subarray(1 + FUND_BYTES)), false);
  return matchingCredentials(fundCode, anonymousCode);
}
