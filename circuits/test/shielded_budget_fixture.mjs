import { poseidon3 } from "poseidon-lite";
import { splitShieldedViewPublicKey } from "@deepfamily/protocol-core";

// Independent constants and deterministic receive keys for circuit fixtures.
// These are synthetic public keys, not encryption or key-recovery fixtures.
export const FUND_PRIVATE_BUDGET_PURPOSE = 202610210301n;
export const CLAIM_PRIVATE_BUDGET_PURPOSE = 202610210302n;

export function shieldedFixtureViewingKey(keyMode = 0) {
  return new Uint8Array(32).fill(keyMode === 1 ? 0x22 : 0x11);
}

export function shieldedFixtureViewLimbs(viewingKey, budgetKind = 0) {
  return budgetKind === 0
    ? splitShieldedViewPublicKey(viewingKey)
    : { viewKeyLo: 0n, viewKeyHi: 0n };
}

export function shieldedFixtureBudgetPurpose(budgetKind, budgetOrigin) {
  if (budgetKind === 1) return 1030n;
  if (budgetOrigin === "fund") return FUND_PRIVATE_BUDGET_PURPOSE;
  if (budgetOrigin === "claim") return CLAIM_PRIVATE_BUDGET_PURPOSE;
  throw new TypeError("fixture budgetOrigin must be fund or claim");
}

export function fixtureReceiveBinding(alias, owner, mode, lo, hi, salt) {
  return poseidon3([
    poseidon3([poseidon3([202610210102n, BigInt(alias), BigInt(owner)]), BigInt(mode), BigInt(lo)]),
    BigInt(hi),
    BigInt(salt),
  ]);
}
export function fixtureFundReceive(witness) {
  const enabled = BigInt(witness.budgetKind) === 0n;
  const alias = enabled ? 99101n : 0n;
  const salt = enabled ? 99102n : 0n;
  return {
    receiveAuthorizationAlias: String(alias),
    receiveSalt: String(salt),
    receiveBindings: [
      String(
        enabled
          ? poseidon3([
              202610220102n,
              fixtureReceiveBinding(
                alias,
                witness.heirOwnerCommitment,
                witness.keyMode,
                witness.heirViewKeyLo,
                witness.heirViewKeyHi,
                salt,
              ),
              BigInt(witness.heirIdentityCommitment),
            ])
          : 0n,
      ),
      "0",
    ],
  };
}
