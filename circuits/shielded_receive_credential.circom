pragma circom 2.2.3;

include "shielded_receive_credential_common.circom";

// A receive credential hides identityCommitment. Deleting the identity from a
// Fund credential cannot turn that proof into this distinct relation.
component main {
    public [authorizationCounter, expiresAt, ownerCommitment, viewKeyLo, viewKeyHi,
        keyMode, identitySuiteId, independentKeySuiteId, independentKeyDerivationVersion, receiveCodeVersion]
} = ShieldedReceiveCredential();
