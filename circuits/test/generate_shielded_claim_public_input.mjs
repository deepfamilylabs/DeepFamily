import { poseidon5 } from "poseidon-lite";
import { buildShieldedClaimFixture } from "./generate_shielded_claim_input.mjs";

export function buildShieldedPublicClaimFixture({
  budgetId = 1n,
  firstPeriod = 0n,
  claimCount = 2n,
  amount = 200n,
  chainId = 31337n,
  pool = 0x1234n,
} = {}) {
  const fixture = buildShieldedClaimFixture();
  const identityFields = [
    "nameField",
    "derivedSecretField",
    "isBirthBC",
    "birthYear",
    "birthMonth",
    "birthDay",
    "gender",
    "suiteId",
  ];
  const outputNonces = [77777n, 88888n];
  const ciphertextHashes = [44444n, 33333n];
  const witness = {
    chainId: String(chainId),
    pool: String(pool),
    budgetId: String(budgetId),
    heirIdentityCommitment: String(fixture.heirIdentityCommitment),
    firstPeriod: String(firstPeriod),
    claimCount: String(claimCount),
    amount: String(amount),
    outputCommitments: outputNonces.map((nonce, i) =>
      poseidon5([
        1014n,
        fixture.ownerCommitment,
        i === 0 ? BigInt(amount) : 0n,
        nonce,
        ciphertextHashes[i],
      ]).toString(),
    ),
    ciphertextHashes: ciphertextHashes.map(String),
    ...Object.fromEntries(identityFields.map((name) => [name, fixture.witness[name]])),
    outputNonces: outputNonces.map(String),
  };
  return {
    witness,
    heirIdentityCommitment: fixture.heirIdentityCommitment,
    ownerSecret: fixture.ownerSecret,
    ownerCommitment: fixture.ownerCommitment,
  };
}
