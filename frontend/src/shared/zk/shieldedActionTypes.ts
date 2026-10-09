import type { BigNumberish, BytesLike } from "ethers";

/** Public transaction data. It contains no note openings or proof witness. */
export type ShieldedPoolActionData = {
  fundMode: BigNumberish;
  budgetKind: BigNumberish;
  inputShardIds: ReadonlyArray<BigNumberish>;
  inputRoots: ReadonlyArray<BigNumberish>;
  inputNullifiers: ReadonlyArray<BigNumberish>;
  periodNullifiers: ReadonlyArray<BigNumberish>;
  outputCommitments: readonly [BigNumberish, BigNumberish];
  outputCiphertexts: readonly [BytesLike, BytesLike];
  relation0: BigNumberish;
  relation1: BigNumberish;
  asOf: BigNumberish;
};
