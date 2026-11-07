pragma circom 2.2.3;

include "common/shielded_receive_credential_common.circom";

// Fund disclosure authenticates the same alias and selectively reveals the
// inheritance identity to the funder. On-chain presentation keeps these
// credential fields private inside the operation proof.
component main {
    public [authorizationCounter, expiresAt, identityCommitment, ownerCommitment, viewKeyLo, viewKeyHi,
        keyMode, receiveCodeVersion]
} = ShieldedReceiveCredential(2);
