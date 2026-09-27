pragma circom 2.2.3;

include "shielded_funding_common.circom";
include "shielded_lineage_common.circom";

// Action 2: spend only the donor's VALUE note. The second input is a read-only
// POLICY_NOTE template; its public nullifier is a one-time unlinkable use tag.
// Its policy value is zero and must never be counted as funding.
template ShieldedAllocate() {
    signal input publicSignals[32];

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
    signal input viewKeyHi;
    signal input viewKeyLo;
    signal input registrationDepth;
    signal input registrationIndex;
    signal input registrationSiblings[32];

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

    publicSignals[0] === 2;
    for (var i = 9; i <= 20; i++) {
        publicSignals[i] === 0;
    }
    publicSignals[25] === 0;
    publicSignals[26] === 0;
    component chainBits = Num2Bits(64);
    chainBits.in <== publicSignals[1];
    component poolBits = Num2Bits(160);
    poolBits.in <== publicSignals[2];
    component donorShardBits = Num2Bits(128);
    donorShardBits.in <== publicSignals[3];
    component policyShardBits = Num2Bits(128);
    policyShardBits.in <== publicSignals[5];
    component registryShardBits = Num2Bits(128);
    registryShardBits.in <== publicSignals[31];
    component asOfBits = Num2Bits(64);
    asOfBits.in <== publicSignals[29];

    component donor = ShieldedDonorValueInput();
    donor.ownerSecret <== donorOwnerSecret;
    donor.amount <== donorAmount;
    donor.nonce <== donorNonce;
    donor.ciphertextHash <== donorCiphertextHash;
    donor.shardRoot <== publicSignals[4];
    donor.depth <== donorDepth;
    donor.index <== donorIndex;
    donor.siblings <== donorSiblings;
    donor.spendNullifier === publicSignals[7];

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
    policyMembership.root <== publicSignals[6];
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
    enrollmentTag.out === publicSignals[8];

    component registeredHeir = ShieldedRegisteredHeir();
    registeredHeir.heirIdentityCommitment <== heirIdentityCommitment;
    registeredHeir.heirOwnerCommitment <== heirOwnerCommitment;
    registeredHeir.viewKeyHi <== viewKeyHi;
    registeredHeir.viewKeyLo <== viewKeyLo;
    registeredHeir.registryRoot <== publicSignals[30];
    registeredHeir.depth <== registrationDepth;
    registeredHeir.index <== registrationIndex;
    registeredHeir.siblings <== registrationSiblings;

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
    directChild.endorsementRoot <== publicSignals[27];
    directChild.trustedRoot <== publicSignals[28];
    directChild.asOf <== publicSignals[29];

    component enrollment = ShieldedPrivateEnrollment();
    enrollment.policyCommitment <== policy.commitment;
    enrollment.heirIdentityCommitment <== heirIdentityCommitment;
    enrollment.eligibleFrom <== eligibleFrom;
    enrollment.enrollmentSalt <== enrollmentSalt;
    // The pool accepts asOf only for two hours. Fixing this offset prevents
    // an allocator from choosing a distant future qualification start.
    eligibleFrom === publicSignals[29] + 7200;

    component budget = ShieldedBudgetOutput();
    budget.policyCommitment <== policy.commitment;
    budget.enrollmentCommitment <== enrollment.commitment;
    budget.heirOwnerCommitment <== heirOwnerCommitment;
    budget.rate <== rate;
    budget.periods <== budgetPeriods;
    budget.nonce <== budgetNonce;
    budget.ciphertextHash <== publicSignals[23];
    budget.noteCommitment === publicSignals[21];

    signal changeAmount <== donorAmount - budget.amount;
    component change = ShieldedDonorChange();
    change.ownerCommitment <== donor.ownerCommitment;
    change.amount <== changeAmount;
    change.nonce <== changeNonce;
    change.ciphertextHash <== publicSignals[24];
    change.noteCommitment === publicSignals[22];
}

component main { public [publicSignals] } = ShieldedAllocate();
