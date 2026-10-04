import { poseidon3 } from "poseidon-lite";

// Independent fixture arithmetic checks that circuits and protocol helpers agree.
export const DEFAULT_SHIELDED_FIXTURE_CHAIN_ID = 1030n;
export const DEFAULT_SHIELDED_FIXTURE_POOL = BigInt("0x1111111111111111111111111111111111111111");

export function shieldedFixtureScope(witness) {
  return {
    chainId: BigInt(witness.chainId),
    poolAddress: `0x${BigInt(witness.pool).toString(16).padStart(40, "0")}`,
  };
}

export function shieldedFixtureTag(purpose, chainId, pool) {
  return poseidon3([1032n, poseidon3([1031n, BigInt(chainId), BigInt(pool)]), BigInt(purpose)]);
}
