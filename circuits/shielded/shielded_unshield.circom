pragma circom 2.2.3;
include "common/shielded_unshield_common.circom";

component main { public [chainId, pool, inputShardIds, inputRoots, inputNullifiers, outputCommitments, ciphertextHashes, amount, recipient] } = ShieldedUnshield(1);
