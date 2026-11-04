pragma circom 2.2.3;
include "common/shielded_private_transfer_common.circom";

component main { public [chainId, pool, inputRoots, inputNullifiers, outputCommitments, ciphertextHashes, receiveBindings] } = ShieldedPrivateTransfer(4);
