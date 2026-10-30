import type { BigNumberish, BytesLike } from "ethers";

export type ShieldedReceiveAuthorization = {
  checkpointId: BigNumberish; asOf: BigNumberish; deadline: BigNumberish; recipientBinding: BigNumberish; proof: string;
};

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
  receiveAuthorizations?: ShieldedReceiveAuthorization[];
  /** Metadata binding the public roots and asOf to one lineage checkpoint. */
  lineageCheckpointId: BigNumberish;
};
