pragma circom 2.2.3;

include "receive_common.circom";

// A capability is optional and binds one family credential to the exact common
// receive authorization. Multiple capabilities may bind the same code, even if
// their issueNonces differ: the code alias derives from the canonical subject
// secret, not an issuance-specific u.
template BudgetCapability() {
    signal output capabilityBinding;
    signal output familyTag;
    signal output childRoleIndex;
    signal output endorsementRoleIndex;
    signal output trustedRoleIndex;
    signal input chainId;
    signal input authorizerScope;
    signal input issuanceRoot;
    signal input commonBinding;
    signal input parentVersion;
    signal input derivedSecretField;
    signal input issueNonce;
    signal input familyRoot;
    signal input endorser;
    signal input xChild;
    signal input xEndorse;
    signal input xTrust;
    signal input credentialSalt;
    signal input credentialDepth;
    signal input credentialIndex;
    signal input credentialSiblings[32];
    signal input nonce;
    signal input ownerCommitment;
    signal input viewKeyLo;
    signal input viewKeyHi;
    signal input expiresAt;
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
    common.codeRootSecret <== derivedSecretField;
    common.codeSecret <== codeSecret;
    common.ownerSecret <== ownerSecret;
    commonBinding === common.commonBinding;
    component credential = CredentialCommitment();
    credential.chainId <== chainId;
    credential.authorizerScope <== authorizerScope;
    credential.derivedSecretField <== derivedSecretField;
    credential.issueNonce <== issueNonce;
    credential.familyRoot <== familyRoot;
    credential.endorser <== endorser;
    credential.parentVersion <== parentVersion;
    credential.xChild <== xChild;
    credential.xEndorse <== xEndorse;
    credential.xTrust <== xTrust;
    credential.credentialSalt <== credentialSalt;
    component membership = ShieldedMerkleRoot(32);
    membership.leaf <== credential.credentialCommitment;
    membership.depth <== credentialDepth;
    membership.index <== credentialIndex;
    membership.siblings <== credentialSiblings;
    issuanceRoot === membership.out;
    component family = Poseidon(3);
    family.inputs[0] <== 73104;
    family.inputs[1] <== familyRoot;
    family.inputs[2] <== nonce;
    familyTag <== family.out;
    component child = Poseidon(2);
    child.inputs[0] <== 74321;
    child.inputs[1] <== xChild;
    childRoleIndex <== child.out;
    component endorsement = Poseidon(2);
    endorsement.inputs[0] <== 74322;
    endorsement.inputs[1] <== xEndorse;
    endorsementRoleIndex <== endorsement.out;
    component trust = Poseidon(2);
    trust.inputs[0] <== 74323;
    trust.inputs[1] <== xTrust;
    trustedRoleIndex <== trust.out;
    component binding = Poseidon(8);
    binding.inputs[0] <== 74004;
    binding.inputs[1] <== commonBinding;
    binding.inputs[2] <== parentVersion;
    binding.inputs[3] <== familyTag;
    binding.inputs[4] <== childRoleIndex;
    binding.inputs[5] <== endorsementRoleIndex;
    binding.inputs[6] <== trustedRoleIndex;
    binding.inputs[7] <== issuanceRoot;
    capabilityBinding <== binding.out;
}

component main { public [chainId,authorizerScope,issuanceRoot,commonBinding,parentVersion] } = BudgetCapability();
