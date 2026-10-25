pragma circom 2.2.3;

include "lib/identity.circom";
include "shielded_merkle_common.circom";

// receive authorization is global to one chain/registry, so the same code
// can authorize letters and multiple asset pools. Business proofs bind the
// actual consumer and action separately.
template NonZero() {
    signal input in;
    component zero = IsZero();
    zero.in <== in;
    zero.out === 0;
}

template AuthorizationDomain() {
    signal input chainId;
    signal input authorizerScope;
    signal output domain;
    component chainBits = Num2Bits(64);
    chainBits.in <== chainId;
    component scopeBits = Num2Bits(160);
    scopeBits.in <== authorizerScope;
    component chainNZ = NonZero();
    chainNZ.in <== chainId;
    component scopeNZ = NonZero();
    scopeNZ.in <== authorizerScope;
    component hash = Poseidon(3);
    hash.inputs[0] <== 74000;
    hash.inputs[1] <== chainId;
    hash.inputs[2] <== authorizerScope;
    domain <== hash.out;
}

// A receive code does not depend on a family credential. Qualified capabilities
// use canonical derivedSecretField as codeRootSecret to bind their subject to
// this same code. Per-code owner/view keys need not be fixed identity keys.
template ReceiveCommon() {
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
    signal output codeAlias;
    signal output commonBinding;
    signal output revocationTag;

    component scope = AuthorizationDomain();
    scope.chainId <== chainId;
    scope.authorizerScope <== authorizerScope;
    component owner = Poseidon(2);
    owner.inputs[0] <== 1013;
    owner.inputs[1] <== ownerSecret;
    ownerCommitment === owner.out;
    component alias = Poseidon(4);
    alias.inputs[0] <== 73103;
    alias.inputs[1] <== codeRootSecret;
    alias.inputs[2] <== nonce;
    alias.inputs[3] <== codeSecret;
    codeAlias <== alias.out;
    component revocationSecret = Poseidon(4);
    revocationSecret.inputs[0] <== 74020;
    revocationSecret.inputs[1] <== codeRootSecret;
    revocationSecret.inputs[2] <== nonce;
    revocationSecret.inputs[3] <== codeSecret;
    component revocation = Poseidon(2);
    revocation.inputs[0] <== 74021;
    revocation.inputs[1] <== revocationSecret.out;
    revocationTag <== revocation.out;
    component keys = Poseidon(5);
    keys.inputs[0] <== 74001;
    keys.inputs[1] <== codeAlias;
    keys.inputs[2] <== ownerCommitment;
    keys.inputs[3] <== viewKeyLo;
    keys.inputs[4] <== viewKeyHi;
    component header = Poseidon(4);
    header.inputs[0] <== 74002;
    header.inputs[1] <== keys.out;
    header.inputs[2] <== nonce;
    header.inputs[3] <== expiresAt;
    component binding = Poseidon(4);
    binding.inputs[0] <== 74003;
    binding.inputs[1] <== scope.domain;
    binding.inputs[2] <== header.out;
    binding.inputs[3] <== revocationTag;
    commonBinding <== binding.out;
    component lo = Num2Bits(128);
    lo.in <== viewKeyLo;
    component hi = Num2Bits(128);
    hi.in <== viewKeyHi;
    component expiry = Num2Bits(64);
    expiry.in <== expiresAt;
    component nz[6];
    nz[0] = NonZero(); nz[0].in <== nonce;
    nz[1] = NonZero(); nz[1].in <== ownerSecret;
    nz[2] = NonZero(); nz[2].in <== codeRootSecret;
    nz[3] = NonZero(); nz[3].in <== codeSecret;
    nz[4] = NonZero(); nz[4].in <== expiresAt;
    nz[5] = NonZero(); nz[5].in <== ownerCommitment;
}

// Fact and trust openings are authenticated by the source registry before
// entering these roots. Random role secrets are part of those leaves; a holder
// cannot replace them when issuing Q or when generating a new receive code.
template SourceFact() {
    signal input childIdentity;
    signal input parentIdentity;
    signal input endorser;
    signal input xChild;
    signal input xEndorse;
    signal input parentVersion;
    signal input sourceFactSalt;
    signal output leaf;
    component hash = Poseidon(8);
    hash.inputs[0] <== 71002;
    hash.inputs[1] <== childIdentity;
    hash.inputs[2] <== parentIdentity;
    hash.inputs[3] <== endorser;
    hash.inputs[4] <== xChild;
    hash.inputs[5] <== xEndorse;
    hash.inputs[6] <== parentVersion;
    hash.inputs[7] <== sourceFactSalt;
    leaf <== hash.out;
}

template SourceTrust() {
    signal input parentIdentity;
    signal input endorser;
    signal input xTrust;
    signal input parentVersion;
    signal input sourceTrustSalt;
    signal output leaf;
    component hash = Poseidon(6);
    hash.inputs[0] <== 71003;
    hash.inputs[1] <== parentIdentity;
    hash.inputs[2] <== endorser;
    hash.inputs[3] <== xTrust;
    hash.inputs[4] <== parentVersion;
    hash.inputs[5] <== sourceTrustSalt;
    leaf <== hash.out;
}

template CredentialCommitment() {
    signal input chainId;
    signal input authorizerScope;
    signal input derivedSecretField;
    signal input issueNonce;
    signal input familyRoot;
    signal input endorser;
    signal input parentVersion;
    signal input xChild;
    signal input xEndorse;
    signal input xTrust;
    signal input credentialSalt;
    signal output credentialCommitment;
    component scope = AuthorizationDomain();
    scope.chainId <== chainId;
    scope.authorizerScope <== authorizerScope;
    component subject = Poseidon(3);
    subject.inputs[0] <== 73204;
    subject.inputs[1] <== derivedSecretField;
    subject.inputs[2] <== issueNonce;
    component factMessage = Poseidon(7);
    factMessage.inputs[0] <== 73101;
    factMessage.inputs[1] <== subject.out;
    factMessage.inputs[2] <== familyRoot;
    factMessage.inputs[3] <== endorser;
    factMessage.inputs[4] <== parentVersion;
    factMessage.inputs[5] <== xChild;
    factMessage.inputs[6] <== xEndorse;
    component trustMessage = Poseidon(5);
    trustMessage.inputs[0] <== 73102;
    trustMessage.inputs[1] <== familyRoot;
    trustMessage.inputs[2] <== endorser;
    trustMessage.inputs[3] <== parentVersion;
    trustMessage.inputs[4] <== xTrust;
    component credential = Poseidon(5);
    credential.inputs[0] <== 73400;
    credential.inputs[1] <== factMessage.out;
    credential.inputs[2] <== trustMessage.out;
    credential.inputs[3] <== credentialSalt;
    credential.inputs[4] <== scope.domain;
    credentialCommitment <== credential.out;
    component versionBits = Num2Bits(64);
    versionBits.in <== parentVersion;
    component addressBits = Num2Bits(160);
    addressBits.in <== endorser;
    component nz[9];
    nz[0] = NonZero(); nz[0].in <== derivedSecretField;
    nz[1] = NonZero(); nz[1].in <== issueNonce;
    nz[2] = NonZero(); nz[2].in <== familyRoot;
    nz[3] = NonZero(); nz[3].in <== endorser;
    nz[4] = NonZero(); nz[4].in <== xChild;
    nz[5] = NonZero(); nz[5].in <== xEndorse;
    nz[6] = NonZero(); nz[6].in <== xTrust;
    nz[7] = NonZero(); nz[7].in <== credentialSalt;
    nz[8] = NonZero(); nz[8].in <== parentVersion;
}
