pragma circom 2.2.3;

include "shielded_claim_common.circom";

component main {
    public [
        chainId,
        pool,
        inputShardIds,
        inputRoots,
        inputNullifiers,
        periodNullifiers,
        outputCommitments,
        ciphertextHashes,
        endorsementRoot,
        trustedRoot,
        asOf
    ]
} = ShieldedClaim(64);
