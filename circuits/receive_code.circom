pragma circom 2.2.3;

include "receive_common.circom";

// Public signals: outputs first, then inputs in the main declaration below.
// No family credential, identity commitment, fixed public key or credential ID.
template ReceiveCode() {
    signal output codeAlias;
    signal output commonBinding;
    signal output revocationTag;
    signal input chainId;
    signal input authorizerScope;
    signal input nonce;
    signal input ownerCommitment;
    signal input viewKeyLo;
    signal input viewKeyHi;
    signal input expiresAt;
    signal input codeRootSecret;
    signal input codeSecret;
    signal input ownerSecret;
    component common = ReceiveCommon();
    common.chainId <== chainId;
    common.authorizerScope <== authorizerScope;
    common.nonce <== nonce;
    common.ownerCommitment <== ownerCommitment;
    common.viewKeyLo <== viewKeyLo;
    common.viewKeyHi <== viewKeyHi;
    common.expiresAt <== expiresAt;
    common.codeRootSecret <== codeRootSecret;
    common.codeSecret <== codeSecret;
    common.ownerSecret <== ownerSecret;
    codeAlias <== common.codeAlias;
    commonBinding <== common.commonBinding;
    revocationTag <== common.revocationTag;
}

component main { public [chainId,authorizerScope,nonce,ownerCommitment,viewKeyLo,viewKeyHi,expiresAt] } = ReceiveCode();
