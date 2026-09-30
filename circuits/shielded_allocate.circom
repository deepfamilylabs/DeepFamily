pragma circom 2.2.3;

include "shielded_funding_common.circom";
include "shielded_lineage_common.circom";

// Action 2: spend only the donor's VALUE note. The second input is a read-only
// POLICY_NOTE template; its public nullifier is a one-time unlinkable use tag.
// Its policy value is zero and must never be counted as funding. The payer
// checks the heir's receive code before proving; the claim circuit binds the
// budget's owner to the heir's identity secret.
template ShieldedAllocate() {
    signal input chainId;
    signal input pool;
    signal input inputShardIds[2];
    signal input inputRoots[2];
    signal input inputNullifiers[2];
    signal input outputCommitments[2];
    signal input ciphertextHashes[2];
    signal input endorsementRoot;
    signal input trustedRoot;
    signal input asOf;

    signal input donorOwnerSecret;
    signal input donorAmount;
    signal input donorNonce;
    signal input donorCiphertextHash;
    signal input donorDepth;
    signal input donorIndex;
    signal input donorSiblings[32];

    signal input rootIdentityCommitment;
    signal input rootVersionIndex;
    signal input rate;
    signal input policySalt;
    signal input allocationKey;
    signal input policyNonce;
    signal input policyCiphertextHash;
    signal input policyDepth;
    signal input policyIndex;
    signal input policySiblings[32];

    signal input heirIdentityCommitment;
    signal input heirOwnerCommitment;

    signal input heirVersionIndex;
    signal input fatherIdentityCommitment;
    signal input motherIdentityCommitment;
    signal input rootIsMother;
    signal input endorser;
    signal input writtenAt;
    signal input endorsementDepth;
    signal input endorsementIndex;
    signal input endorsementSiblings[64];
    signal input trustedDepth;
    signal input trustedIndex;
    signal input trustedSiblings[64];

    signal input eligibleFrom;
    signal input enrollmentSalt;
    signal input budgetPeriods;
    signal input budgetNonce;
    signal input changeNonce;

    component chainBits = Num2Bits(64);
    chainBits.in <== chainId;
    component poolBits = Num2Bits(160);
    poolBits.in <== pool;
    component donorShardBits = Num2Bits(128);
    donorShardBits.in <== inputShardIds[0];
    component policyShardBits = Num2Bits(128);
    policyShardBits.in <== inputShardIds[1];
    component asOfBits = Num2Bits(64);
    asOfBits.in <== asOf;

    component donor = ShieldedDonorValueInput();
    donor.ownerSecret <== donorOwnerSecret;
    donor.amount <== donorAmount;
    donor.nonce <== donorNonce;
    donor.ciphertextHash <== donorCiphertextHash;
    donor.shardRoot <== inputRoots[0];
    donor.depth <== donorDepth;
    donor.index <== donorIndex;
    donor.siblings <== donorSiblings;
    donor.spendNullifier === inputNullifiers[0];

    component policy = ShieldedPrivatePolicy();
    policy.rootIdentityCommitment <== rootIdentityCommitment;
    policy.rootVersionIndex <== rootVersionIndex;
    policy.rate <== rate;
    policy.policySalt <== policySalt;
    component allocationKeyNotZero = IsZero();
    allocationKeyNotZero.in <== allocationKey;
    allocationKeyNotZero.out === 0;
    component keyCommitment = Poseidon(2);
    keyCommitment.inputs[0] <== 1028;
    keyCommitment.inputs[1] <== allocationKey;
    policy.allocationKeyCommitment <== keyCommitment.out;
    component policyNonceNotZero = IsZero();
    policyNonceNotZero.in <== policyNonce;
    policyNonceNotZero.out === 0;
    component policyNote = Poseidon(4);
    policyNote.inputs[0] <== 1024;
    policyNote.inputs[1] <== policy.commitment;
    policyNote.inputs[2] <== policyNonce;
    policyNote.inputs[3] <== policyCiphertextHash;
    component policyMembership = ShieldedMembership32();
    policyMembership.leaf <== policyNote.out;
    policyMembership.root <== inputRoots[1];
    policyMembership.depth <== policyDepth;
    policyMembership.index <== policyIndex;
    policyMembership.siblings <== policySiblings;
    // One initial allocation per policy and person. Top-ups read the resulting
    // budget as a template. This fixed tag is never reused by claims, so a
    // family member who knows the policy cannot match it to a later payout.
    component enrollmentTag = Poseidon(4);
    enrollmentTag.inputs[0] <== 1027;
    enrollmentTag.inputs[1] <== allocationKey;
    enrollmentTag.inputs[2] <== policy.commitment;
    enrollmentTag.inputs[3] <== heirIdentityCommitment;
    enrollmentTag.out === inputNullifiers[1];

    component heirOwnerNotZero = IsZero();
    heirOwnerNotZero.in <== heirOwnerCommitment;
    heirOwnerNotZero.out === 0;

    component directChild = ShieldedDirectChildCurrent();
    directChild.heirIdentityCommitment <== heirIdentityCommitment;
    directChild.rootIdentityCommitment <== rootIdentityCommitment;
    directChild.rootVersionIndex <== rootVersionIndex;
    directChild.heirVersionIndex <== heirVersionIndex;
    directChild.fatherIdentityCommitment <== fatherIdentityCommitment;
    directChild.motherIdentityCommitment <== motherIdentityCommitment;
    directChild.rootIsMother <== rootIsMother;
    directChild.endorser <== endorser;
    directChild.writtenAt <== writtenAt;
    directChild.endorsementDepth <== endorsementDepth;
    directChild.endorsementIndex <== endorsementIndex;
    directChild.endorsementSiblings <== endorsementSiblings;
    directChild.trustedDepth <== trustedDepth;
    directChild.trustedIndex <== trustedIndex;
    directChild.trustedSiblings <== trustedSiblings;
    directChild.endorsementRoot <== endorsementRoot;
    directChild.trustedRoot <== trustedRoot;
    directChild.asOf <== asOf;

    component enrollment = ShieldedPrivateEnrollment();
    enrollment.policyCommitment <== policy.commitment;
    enrollment.heirIdentityCommitment <== heirIdentityCommitment;
    enrollment.eligibleFrom <== eligibleFrom;
    enrollment.enrollmentSalt <== enrollmentSalt;
    // The pool accepts asOf only for two hours. Fixing this offset prevents
    // an allocator from choosing a distant future qualification start.
    eligibleFrom === asOf + 7200;

    component budget = ShieldedBudgetOutput();
    budget.policyCommitment <== policy.commitment;
    budget.enrollmentCommitment <== enrollment.commitment;
    budget.heirOwnerCommitment <== heirOwnerCommitment;
    budget.rate <== rate;
    budget.periods <== budgetPeriods;
    budget.nonce <== budgetNonce;
    budget.ciphertextHash <== ciphertextHashes[0];
    budget.noteCommitment === outputCommitments[0];

    signal changeAmount <== donorAmount - budget.amount;
    component change = ShieldedDonorChange();
    change.ownerCommitment <== donor.ownerCommitment;
    change.amount <== changeAmount;
    change.nonce <== changeNonce;
    change.ciphertextHash <== ciphertextHashes[1];
    change.noteCommitment === outputCommitments[1];
}

component main {
    public [
        chainId,
        pool,
        inputShardIds,
        inputRoots,
        inputNullifiers,
        outputCommitments,
        ciphertextHashes,
        endorsementRoot,
        trustedRoot,
        asOf
    ]
} = ShieldedAllocate();
