pragma circom 2.2.3;
include "lib/shielded_unshield.circom";

component main { public [chainId, pool, inputShardIds, inputRoots, inputNullifiers, outputCommitments, ciphertextHashes, amount, recipient] } = ShieldedUnshield(4);
