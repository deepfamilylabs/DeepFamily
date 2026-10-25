pragma circom 2.2.3;

include "receive_common.circom";

// The publisher is the actual endorsement account (checked by the source
// contract), not the recipient. Both the legacy fact and hidden role opening
// are authenticated before this leaf enters the source tree. The contract
// accepts only the current lineage endorsement root.
template SourceFactAttestation() {
    signal output factLeaf;
    signal output childRoleCommitment;
    signal output endorsementRoleCommitment;
    signal input chainId;
    signal input sourceAddress;
    signal input childIdentity;
    signal input parentIdentity;
    signal input endorser;
    signal input parentVersion;
    signal input endorsementRoot;
    signal input childVersion;
    signal input fatherIdentity;
    signal input motherIdentity;
    signal input rootIsMother;
    signal input writtenAt;
    signal input endorsementDepth;
    signal input endorsementIndex;
    signal input endorsementSiblings[64];
    signal input xChild;
    signal input xEndorse;
    signal input sourceFactSalt;

    component scope = AuthorizationDomain();
    scope.chainId <== chainId;
    scope.authorizerScope <== sourceAddress;
    rootIsMother * (rootIsMother - 1) === 0;
    parentIdentity === fatherIdentity + rootIsMother * (motherIdentity - fatherIdentity);
    component addressBits = Num2Bits(160);
    addressBits.in <== endorser;
    component timeBits = Num2Bits(64);
    timeBits.in <== writtenAt;
    component childVersionBits = Num2Bits(64);
    childVersionBits.in <== childVersion;
    component parentVersionBits = Num2Bits(64);
    parentVersionBits.in <== parentVersion;
    component parents = Poseidon(3);
    parents.inputs[0] <== 1009;
    parents.inputs[1] <== fatherIdentity;
    parents.inputs[2] <== motherIdentity;
    component endorsement = Poseidon(5);
    endorsement.inputs[0] <== 1007;
    endorsement.inputs[1] <== childIdentity;
    endorsement.inputs[2] <== parents.out;
    endorsement.inputs[3] <== childVersion;
    endorsement.inputs[4] <== endorser + writtenAt * (1 << 160);
    component membership = ShieldedMerkleRoot(64);
    membership.leaf <== endorsement.out;
    membership.depth <== endorsementDepth;
    membership.index <== endorsementIndex;
    membership.siblings <== endorsementSiblings;
    membership.out === endorsementRoot;
    component fact = SourceFact();
    fact.childIdentity <== childIdentity;
    fact.parentIdentity <== parentIdentity;
    fact.endorser <== endorser;
    fact.xChild <== xChild;
    fact.xEndorse <== xEndorse;
    fact.parentVersion <== parentVersion;
    fact.sourceFactSalt <== sourceFactSalt;
    factLeaf <== fact.leaf;
    component child = Poseidon(2);
    child.inputs[0] <== 74201;
    child.inputs[1] <== xChild;
    childRoleCommitment <== child.out;
    component roleEndorsement = Poseidon(2);
    roleEndorsement.inputs[0] <== 74202;
    roleEndorsement.inputs[1] <== xEndorse;
    endorsementRoleCommitment <== roleEndorsement.out;
    component nz[8];
    nz[0] = NonZero(); nz[0].in <== childIdentity;
    nz[1] = NonZero(); nz[1].in <== parentIdentity;
    nz[2] = NonZero(); nz[2].in <== endorser;
    nz[3] = NonZero(); nz[3].in <== childVersion;
    nz[4] = NonZero(); nz[4].in <== parentVersion;
    nz[5] = NonZero(); nz[5].in <== xChild;
    nz[6] = NonZero(); nz[6].in <== xEndorse;
    nz[7] = NonZero(); nz[7].in <== sourceFactSalt;
}

component main { public [chainId,sourceAddress,childIdentity,parentIdentity,endorser,parentVersion,endorsementRoot] } = SourceFactAttestation();
