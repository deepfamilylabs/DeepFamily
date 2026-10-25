pragma circom 2.2.3;

include "receive_common.circom";

// The source contract additionally authenticates the publisher's authority to
// manage the actual parent/version's trusted recommenders. A current lineage
// trusted-root membership binds this exact xTrust opening to that relationship.
template SourceTrustAttestation() {
    signal output trustLeaf;
    signal output trustRoleCommitment;
    signal input chainId;
    signal input sourceAddress;
    signal input parentIdentity;
    signal input endorser;
    signal input parentVersion;
    signal input trustedRoot;
    signal input xTrust;
    signal input sourceTrustSalt;
    signal input trustedDepth;
    signal input trustedIndex;
    signal input trustedSiblings[64];

    component scope = AuthorizationDomain();
    scope.chainId <== chainId;
    scope.authorizerScope <== sourceAddress;
    component addressBits = Num2Bits(160);
    addressBits.in <== endorser;
    component versionBits = Num2Bits(64);
    versionBits.in <== parentVersion;
    component lineageTrust = Poseidon(4);
    lineageTrust.inputs[0] <== 1008;
    lineageTrust.inputs[1] <== parentIdentity;
    lineageTrust.inputs[2] <== parentVersion;
    lineageTrust.inputs[3] <== endorser;
    component membership = ShieldedMerkleRoot(64);
    membership.leaf <== lineageTrust.out;
    membership.depth <== trustedDepth;
    membership.index <== trustedIndex;
    membership.siblings <== trustedSiblings;
    membership.out === trustedRoot;
    component trust = SourceTrust();
    trust.parentIdentity <== parentIdentity;
    trust.endorser <== endorser;
    trust.xTrust <== xTrust;
    trust.parentVersion <== parentVersion;
    trust.sourceTrustSalt <== sourceTrustSalt;
    trustLeaf <== trust.leaf;
    component role = Poseidon(2);
    role.inputs[0] <== 74203;
    role.inputs[1] <== xTrust;
    trustRoleCommitment <== role.out;
    component nz[5];
    nz[0] = NonZero(); nz[0].in <== parentIdentity;
    nz[1] = NonZero(); nz[1].in <== endorser;
    nz[2] = NonZero(); nz[2].in <== parentVersion;
    nz[3] = NonZero(); nz[3].in <== xTrust;
    nz[4] = NonZero(); nz[4].in <== sourceTrustSalt;
}

component main { public [chainId,sourceAddress,parentIdentity,endorser,parentVersion,trustedRoot] } = SourceTrustAttestation();
