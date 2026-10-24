pragma circom 2.2.3;
include "lib/shielded_private_transfer.circom";

component main { public [chainId, pool, inputShardIds, inputRoots, inputNullifiers, outputCommitments, ciphertextHashes, receiveBindings] } = ShieldedPrivateTransfer(4);
