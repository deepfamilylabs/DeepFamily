pragma circom 2.2.3;

include "shielded_funding_common.circom";

// Action 3: fund a NEW independent child budget from only the donor's VALUE
// note. An existing budget note is a read-only policy/enrollment template.
// Its balance must not be counted as a source, even if that note was spent.
template ShieldedTopUp() {
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
    signal input allocationKeyCommitment;
    signal input heirIdentityCommitment;
    signal input heirOwnerCommitment;
    signal input viewKeyHi;
    signal input viewKeyLo;
    signal input registrationSalt;
    signal input eligibleFrom;
    signal input enrollmentSalt;
    signal input registrationDepth;
    signal input registrationIndex;
    signal input registrationSiblings[32];

    signal input oldBudgetRemaining;
    signal input oldBudgetRemainingPeriods;
    signal input oldBudgetNonce;
    signal input oldBudgetCiphertextHash;
    signal input oldBudgetDepth;
    signal input oldBudgetIndex;
    signal input oldBudgetSiblings[32];
    signal input budgetUseNonce;

    signal input topUpPeriods;
    signal input newBudgetNonce;
    signal input changeNonce;

    publicSignals[0] === 3;
    for (var i = 9; i <= 20; i++) {
        publicSignals[i] === 0;
    }
    publicSignals[25] === 0;
    publicSignals[26] === 0;
    publicSignals[29] === 0;
    publicSignals[27] === 0;
    publicSignals[28] === 0;
    component chainBits = Num2Bits(64);
    chainBits.in <== publicSignals[1];
    component poolBits = Num2Bits(160);
    poolBits.in <== publicSignals[2];
    component donorShardBits = Num2Bits(128);
    donorShardBits.in <== publicSignals[3];
    component budgetShardBits = Num2Bits(128);
    budgetShardBits.in <== publicSignals[5];
    component registryShardBits = Num2Bits(128);
    registryShardBits.in <== publicSignals[31];

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

    component registeredHeir = ShieldedRegisteredHeir();
    registeredHeir.heirIdentityCommitment <== heirIdentityCommitment;
    registeredHeir.heirOwnerCommitment <== heirOwnerCommitment;
    registeredHeir.viewKeyHi <== viewKeyHi;
    registeredHeir.viewKeyLo <== viewKeyLo;
    registeredHeir.registrationSalt <== registrationSalt;
    registeredHeir.registryRoot <== publicSignals[30];
    registeredHeir.depth <== registrationDepth;
    registeredHeir.index <== registrationIndex;
    registeredHeir.siblings <== registrationSiblings;

    component policy = ShieldedPrivatePolicy();
    policy.rootIdentityCommitment <== rootIdentityCommitment;
    policy.rootVersionIndex <== rootVersionIndex;
    policy.rate <== rate;
    policy.policySalt <== policySalt;
    policy.allocationKeyCommitment <== allocationKeyCommitment;
    component enrollment = ShieldedPrivateEnrollment();
    enrollment.policyCommitment <== policy.commitment;
    enrollment.heirIdentityCommitment <== heirIdentityCommitment;
    enrollment.eligibleFrom <== eligibleFrom;
    enrollment.enrollmentSalt <== enrollmentSalt;

    component oldRemainingBits = Num2Bits(128);
    oldRemainingBits.in <== oldBudgetRemaining;
    component oldPeriodsBits = Num2Bits(64);
    oldPeriodsBits.in <== oldBudgetRemainingPeriods;
    oldBudgetRemaining === rate * oldBudgetRemainingPeriods;
    component oldNonceNotZero = IsZero();
    oldNonceNotZero.in <== oldBudgetNonce;
    oldNonceNotZero.out === 0;
    component oldBudget = Poseidon(8);
    oldBudget.inputs[0] <== 1015;
    oldBudget.inputs[1] <== policy.commitment;
    oldBudget.inputs[2] <== enrollment.commitment;
    oldBudget.inputs[3] <== heirOwnerCommitment;
    oldBudget.inputs[4] <== rate;
    oldBudget.inputs[5] <== oldBudgetRemaining;
    oldBudget.inputs[6] <== oldBudgetNonce;
    oldBudget.inputs[7] <== oldBudgetCiphertextHash;
    component oldBudgetMembership = ShieldedMembership32();
    oldBudgetMembership.leaf <== oldBudget.out;
    oldBudgetMembership.root <== publicSignals[6];
    oldBudgetMembership.depth <== oldBudgetDepth;
    oldBudgetMembership.index <== oldBudgetIndex;
    oldBudgetMembership.siblings <== oldBudgetSiblings;
    component useNonceNotZero = IsZero();
    useNonceNotZero.in <== budgetUseNonce;
    useNonceNotZero.out === 0;
    component useTag = Poseidon(4);
    useTag.inputs[0] <== 1026;
    useTag.inputs[1] <== policySalt;
    useTag.inputs[2] <== oldBudget.out;
    useTag.inputs[3] <== budgetUseNonce;
    useTag.out === publicSignals[8];

    // The new budget is only the newly funded amount. The old budget is still
    // independently spendable and contributes no value to this equality.
    component newBudget = ShieldedBudgetOutput();
    newBudget.policyCommitment <== policy.commitment;
    newBudget.enrollmentCommitment <== enrollment.commitment;
    newBudget.heirOwnerCommitment <== heirOwnerCommitment;
    newBudget.rate <== rate;
    newBudget.periods <== topUpPeriods;
    newBudget.nonce <== newBudgetNonce;
    newBudget.ciphertextHash <== publicSignals[23];
    newBudget.noteCommitment === publicSignals[21];

    signal changeAmount <== donorAmount - newBudget.amount;
    component change = ShieldedDonorChange();
    change.ownerCommitment <== donor.ownerCommitment;
    change.amount <== changeAmount;
    change.nonce <== changeNonce;
    change.ciphertextHash <== publicSignals[24];
    change.noteCommitment === publicSignals[22];
}

component main { public [publicSignals] } = ShieldedTopUp();
