pragma circom 2.2.3;

include "shielded_funding_common.circom";
include "shielded_lineage_common.circom";

// Fund consumes only the donor VALUE note. Mode 0 starts a unique enrollment
// after proving current lineage; mode 1 reads a historical budget template,
// preserving its enrollment without consuming or counting its old value.
template ShieldedFund() {
    signal input chainId;
    signal input pool;
    signal input fundMode;
    signal input budgetKind;
    signal input publicBudget[10];
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
    signal input periodDays;
    signal input policySalt;
    signal input allocationKey;
    signal input allocationKeyCommitment;
    signal input heirIdentityCommitment;
    signal input heirOwnerCommitment;
    signal input eligibleFrom;
    signal input enrollmentSalt;

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

    signal input oldBudgetKind;
    signal input oldHeirOwnerCommitment;
    signal input oldBudgetRemaining;
    signal input oldBudgetRemainingPeriods;
    signal input oldBudgetNonce;
    signal input oldBudgetCiphertextHash;
    signal input oldBudgetDepth;
    signal input oldBudgetIndex;
    signal input oldBudgetSiblings[32];
    signal input budgetUseNonce;
    signal input budgetPeriods;
    signal input budgetNonce;
    signal input changeNonce;

    component sharedScope = ShieldedPoolDomain();
    sharedScope.chainId <== chainId;
    sharedScope.pool <== pool;

    component allocationTag = ShieldedScopedTag();
    allocationTag.poolDomain <== sharedScope.domain;
    allocationTag.purpose <== 1028;
    component budgetUseTag = ShieldedScopedTag();
    budgetUseTag.poolDomain <== sharedScope.domain;
    budgetUseTag.purpose <== 1026;
    component initialEnrollmentTag = ShieldedScopedTag();
    initialEnrollmentTag.poolDomain <== sharedScope.domain;
    initialEnrollmentTag.purpose <== 1027;

    fundMode * (1 - fundMode) === 0;
    signal initial <== 1 - fundMode;
    budgetKind * (1 - budgetKind) === 0;
    oldBudgetKind * (1 - oldBudgetKind) === 0;
    component shardBits[2];
    for (var i = 0; i < 2; i++) {
        shardBits[i] = Num2Bits(128);
        shardBits[i].in <== inputShardIds[i];
    }
    initial * (inputShardIds[1] - inputShardIds[0]) === 0;
    initial * (inputRoots[1] - inputRoots[0]) === 0;
    component asOfBits = Num2Bits(64);
    asOfBits.in <== asOf;

    component donor = ShieldedDonorValueInput();
    donor.poolDomain <== sharedScope.domain;
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
    policy.poolDomain <== sharedScope.domain;
    policy.rootIdentityCommitment <== rootIdentityCommitment;
    policy.rootVersionIndex <== rootVersionIndex;
    policy.rate <== rate;
    policy.policySalt <== policySalt;
    policy.allocationKeyCommitment <== allocationKeyCommitment;
    policy.periodDays <== periodDays;
    component keyNotZero = IsZero();
    keyNotZero.in <== allocationKey;
    initial * keyNotZero.out === 0;
    fundMode * allocationKey === 0;
    component keyCommitment = Poseidon(2);
    keyCommitment.inputs[0] <== allocationTag.tag;
    keyCommitment.inputs[1] <== allocationKey;
    initial * (keyCommitment.out - allocationKeyCommitment) === 0;

    component heirNotZero = IsZero();
    heirNotZero.in <== heirIdentityCommitment;
    heirNotZero.out === 0;
    component ownerNotZero = IsZero();
    ownerNotZero.in <== heirOwnerCommitment;
    (1 - budgetKind) * ownerNotZero.out === 0;
    budgetKind * heirOwnerCommitment === 0;

    // Canonical inactive witnesses prevent continuation from accidentally
    // depending on current lineage or on the allocator's private key.
    fundMode * endorsementRoot === 0;
    fundMode * trustedRoot === 0;
    fundMode * asOf === 0;
    fundMode * heirVersionIndex === 0;
    fundMode * fatherIdentityCommitment === 0;
    fundMode * motherIdentityCommitment === 0;
    fundMode * rootIsMother === 0;
    fundMode * endorser === 0;
    fundMode * writtenAt === 0;
    fundMode * endorsementDepth === 0;
    fundMode * endorsementIndex === 0;
    fundMode * trustedDepth === 0;
    fundMode * trustedIndex === 0;
    for (var i = 0; i < 64; i++) {
        fundMode * endorsementSiblings[i] === 0;
        fundMode * trustedSiblings[i] === 0;
    }
    component directChild = ShieldedDirectChildCurrent();
    directChild.enabled <== initial;
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
    initial * (eligibleFrom - asOf - 7200) === 0;

    component enrollment = ShieldedPrivateEnrollment();
    enrollment.poolDomain <== sharedScope.domain;
    enrollment.policyCommitment <== policy.commitment;
    enrollment.heirIdentityCommitment <== heirIdentityCommitment;
    enrollment.eligibleFrom <== eligibleFrom;
    enrollment.enrollmentSalt <== enrollmentSalt;

    component terms = ShieldedIdentityBudgetTerms();
    terms.poolDomain <== sharedScope.domain;
    terms.rootIdentityCommitment <== rootIdentityCommitment;
    terms.rootVersionIndex <== rootVersionIndex;
    terms.heirIdentityCommitment <== heirIdentityCommitment;
    terms.eligibleFrom <== eligibleFrom;
    terms.rate <== rate;
    terms.periodDays <== periodDays;

    initial * oldBudgetKind === 0;
    initial * oldHeirOwnerCommitment === 0;
    oldBudgetKind * oldHeirOwnerCommitment === 0;
    component oldOwnerNotZero = IsZero();
    oldOwnerNotZero.in <== oldHeirOwnerCommitment;
    signal oldPrivate <== fundMode * (1 - oldBudgetKind);
    oldPrivate * oldOwnerNotZero.out === 0;
    signal privateContinuation <== oldPrivate * (1 - budgetKind);
    privateContinuation * (heirOwnerCommitment - oldHeirOwnerCommitment) === 0;
    initial * oldBudgetRemaining === 0;
    initial * oldBudgetRemainingPeriods === 0;
    initial * oldBudgetNonce === 0;
    initial * oldBudgetCiphertextHash === 0;
    initial * oldBudgetDepth === 0;
    initial * oldBudgetIndex === 0;
    initial * budgetUseNonce === 0;
    for (var i = 0; i < 32; i++) initial * oldBudgetSiblings[i] === 0;
    component oldAmountBits = Num2Bits(128);
    oldAmountBits.in <== oldBudgetRemaining;
    component oldPeriodsBits = Num2Bits(64);
    oldPeriodsBits.in <== oldBudgetRemainingPeriods;
    oldBudgetRemaining === rate * oldBudgetRemainingPeriods;
    component oldNonceNotZero = IsZero();
    oldNonceNotZero.in <== oldBudgetNonce;
    fundMode * oldNonceNotZero.out === 0;
    component oldBudget = ShieldedBoundBudgetCommitment();
    oldBudget.poolDomain <== sharedScope.domain;
    oldBudget.budgetKind <== oldBudgetKind;
    oldBudget.policyCommitment <== policy.commitment;
    oldBudget.enrollmentCommitment <== enrollment.commitment;
    oldBudget.termsCommitment <== terms.commitment;
    oldBudget.ownerCommitment <== oldHeirOwnerCommitment;
    oldBudget.rate <== rate;
    oldBudget.remaining <== oldBudgetRemaining;
    oldBudget.nonce <== oldBudgetNonce;
    oldBudget.ciphertextHash <== oldBudgetCiphertextHash;
    component oldMembership = ShieldedMerkleRoot(32);
    oldMembership.leaf <== oldBudget.commitment;
    oldMembership.depth <== oldBudgetDepth;
    oldMembership.index <== oldBudgetIndex;
    oldMembership.siblings <== oldBudgetSiblings;
    fundMode * (oldMembership.out - inputRoots[1]) === 0;
    component useNonceNotZero = IsZero();
    useNonceNotZero.in <== budgetUseNonce;
    fundMode * useNonceNotZero.out === 0;
    component useTag = Poseidon(4);
    useTag.inputs[0] <== budgetUseTag.tag;
    useTag.inputs[1] <== policySalt;
    useTag.inputs[2] <== oldBudget.commitment;
    useTag.inputs[3] <== budgetUseNonce;
    component enrollmentTag = Poseidon(4);
    enrollmentTag.inputs[0] <== initialEnrollmentTag.tag;
    enrollmentTag.inputs[1] <== allocationKey;
    enrollmentTag.inputs[2] <== policy.commitment;
    enrollmentTag.inputs[3] <== heirIdentityCommitment;
    inputNullifiers[1] === enrollmentTag.out + fundMode * (useTag.out - enrollmentTag.out);

    component periodsBits = Num2Bits(64);
    periodsBits.in <== budgetPeriods;
    component periodsNotZero = IsZero();
    periodsNotZero.in <== budgetPeriods;
    periodsNotZero.out === 0;
    signal budgetAmount <== rate * budgetPeriods;
    component amountBits = Num2Bits(128);
    amountBits.in <== budgetAmount;
    component budgetNonceNotZero = IsZero();
    budgetNonceNotZero.in <== budgetNonce;
    budgetNonceNotZero.out === 0;
    component budget = ShieldedBoundBudgetCommitment();
    budget.poolDomain <== sharedScope.domain;
    budget.budgetKind <== budgetKind;
    budget.policyCommitment <== policy.commitment;
    budget.enrollmentCommitment <== enrollment.commitment;
    budget.termsCommitment <== terms.commitment;
    budget.ownerCommitment <== heirOwnerCommitment;
    budget.rate <== rate;
    budget.remaining <== budgetAmount;
    budget.nonce <== budgetNonce;
    budget.ciphertextHash <== ciphertextHashes[0];
    budget.commitment === outputCommitments[0];
    publicBudget[0] === budgetKind * rootIdentityCommitment;
    publicBudget[1] === budgetKind * rootVersionIndex;
    publicBudget[2] === budgetKind * heirIdentityCommitment;
    publicBudget[3] === budgetKind * rate;
    publicBudget[4] === budgetKind * eligibleFrom;
    publicBudget[5] === budgetKind * policy.commitment;
    publicBudget[6] === budgetKind * enrollment.commitment;
    publicBudget[7] === budgetKind * budgetAmount;
    publicBudget[8] === budgetKind * budgetNonce;
    publicBudget[9] === budgetKind * periodDays;
    signal changeAmount <== donorAmount - budgetAmount;
    component change = ShieldedDonorChange();
    change.poolDomain <== sharedScope.domain;
    change.ownerCommitment <== donor.ownerCommitment;
    change.amount <== changeAmount;
    change.nonce <== changeNonce;
    change.ciphertextHash <== ciphertextHashes[1];
    change.noteCommitment === outputCommitments[1];
}

component main {
    public [chainId, pool, fundMode, budgetKind, publicBudget, inputShardIds, inputRoots, inputNullifiers,
        outputCommitments, ciphertextHashes, endorsementRoot, trustedRoot, asOf]
} = ShieldedFund();
