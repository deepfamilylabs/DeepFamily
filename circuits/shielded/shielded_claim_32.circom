pragma circom 2.2.3;

include "common/shielded_claim_common.circom";

component main {
    public [
        chainId,
        pool,
        inputRoots,
        inputNullifiers,
        periodNullifiers,
        outputCommitments,
        ciphertextHashes,
        endorsementRoot,
        trustedRoot,
        asOf
    ]
} = ShieldedClaim(32);
