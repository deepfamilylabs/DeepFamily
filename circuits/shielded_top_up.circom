pragma circom 2.2.3;

include "shielded_funding_common.circom";

// Action 3: fund a NEW independent child budget from only the donor's VALUE
// note. An existing budget note is a read-only policy/enrollment template.
// Its balance must not be counted as a source, even if that note was spent.
// The new budget keeps the template's heir identity and owner commitment.
template ShieldedTopUp() {
    signal input chainId;
    signal input pool;
    signal input inputShardIds[2];
    signal input inputRoots[2];
    signal input inputNullifiers[2];
    signal input outputCommitments[2];
    signal input ciphertextHashes[2];

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
    signal input eligibleFrom;
    signal input enrollmentSalt;

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

    component chainBits = Num2Bits(64);
    chainBits.in <== chainId;
    component poolBits = Num2Bits(160);
    poolBits.in <== pool;
    component donorShardBits = Num2Bits(128);
    donorShardBits.in <== inputShardIds[0];
    component budgetShardBits = Num2Bits(128);
    budgetShardBits.in <== inputShardIds[1];

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

    component heirNotZero = IsZero();
    heirNotZero.in <== heirIdentityCommitment;
    heirNotZero.out === 0;
    component heirOwnerNotZero = IsZero();
    heirOwnerNotZero.in <== heirOwnerCommitment;
    heirOwnerNotZero.out === 0;

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
    oldBudgetMembership.root <== inputRoots[1];
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
    useTag.out === inputNullifiers[1];

    // The new budget is only the newly funded amount. The old budget is still
    // independently spendable and contributes no value to this equality.
    component newBudget = ShieldedBudgetOutput();
    newBudget.policyCommitment <== policy.commitment;
    newBudget.enrollmentCommitment <== enrollment.commitment;
    newBudget.heirOwnerCommitment <== heirOwnerCommitment;
    newBudget.rate <== rate;
    newBudget.periods <== topUpPeriods;
    newBudget.nonce <== newBudgetNonce;
    newBudget.ciphertextHash <== ciphertextHashes[0];
    newBudget.noteCommitment === outputCommitments[0];

    signal changeAmount <== donorAmount - newBudget.amount;
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
        ciphertextHashes
    ]
} = ShieldedTopUp();
