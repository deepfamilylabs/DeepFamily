pragma circom 2.2.3;

include "budget_common.circom";

// The payer proves only their own VALUE spend and the public code's match to
// a privately opened future policy. The registry separately verifies the
// receive-code/capability proofs and their current revocation/expiry state.
// This action never spends the recipient's previous contribution.
template Fund() {
    signal input chainId;
    signal input pool;
    signal input commonBinding;
    signal input codeAlias;
    signal input nonce;
    signal input ownerCommitment;
    signal input viewKeyLo;
    signal input viewKeyHi;
    signal input capabilityBinding;
    signal input familyTag;
    signal input parentVersion;
    signal input policyCommitment;
    signal input budgetKey;
    signal input eligibleFrom;
    signal input inputRoot;
    signal input inputNullifier;
    signal input outputCommitments[2];
    signal input ciphertextHashes[2];

    signal input donorOwnerSecret;
    signal input donorAmount;
    signal input donorNonce;
    signal input donorCiphertextHash;
    signal input donorDepth;
    signal input donorIndex;
    signal input donorSiblings[32];
    signal input familyCommitment;
    signal input rate;
    signal input periodDays;
    signal input policySalt;
    signal input allocationKeyCommitment;
    signal input budgetPeriods;
    signal input budgetNonce;
    signal input changeNonce;

    component scope = ShieldedPoolDomain();
    scope.chainId <== chainId;
    scope.pool <== pool;
    component family = Poseidon(3);
    family.inputs[0] <== 73104;
    family.inputs[1] <== familyCommitment;
    family.inputs[2] <== nonce;
    familyTag === family.out;
    component policy = ShieldedPrivatePolicy();
    policy.poolDomain <== scope.domain;
    // private policies contain F, never the actual parent's identity.
    policy.rootIdentityCommitment <== familyCommitment;
    policy.rootVersionIndex <== parentVersion;
    policy.rate <== rate;
    policy.periodDays <== periodDays;
    policy.policySalt <== policySalt;
    policy.allocationKeyCommitment <== allocationKeyCommitment;
    policyCommitment === policy.commitment;
    component key = BudgetKey();
    key.poolDomain <== scope.domain;
    key.codeAlias <== codeAlias;
    key.policyCommitment <== policyCommitment;
    budgetKey === key.key;
    component donor = ShieldedDonorValueInput();
    donor.poolDomain <== scope.domain;
    donor.ownerSecret <== donorOwnerSecret;
    donor.amount <== donorAmount;
    donor.nonce <== donorNonce;
    donor.ciphertextHash <== donorCiphertextHash;
    donor.shardRoot <== inputRoot;
    donor.depth <== donorDepth;
    donor.index <== donorIndex;
    donor.siblings <== donorSiblings;
    inputNullifier === donor.spendNullifier;
    component periodsBits = Num2Bits(64);
    periodsBits.in <== budgetPeriods;
    component periodsNZ = NonZero();
    periodsNZ.in <== budgetPeriods;
    signal amount <== rate * budgetPeriods;
    component budget = BudgetNote();
    budget.poolDomain <== scope.domain;
    budget.policyCommitment <== policyCommitment;
    budget.budgetKey <== budgetKey;
    budget.ownerCommitment <== ownerCommitment;
    budget.viewKeyLo <== viewKeyLo;
    budget.viewKeyHi <== viewKeyHi;
    budget.eligibleFrom <== eligibleFrom;
    budget.rate <== rate;
    budget.remaining <== amount;
    budget.nonce <== budgetNonce;
    budget.ciphertextHash <== ciphertextHashes[0];
    outputCommitments[0] === budget.commitment;
    component change = ShieldedDonorChange();
    change.valueNoteTag <== donor.valueNoteTag;
    change.ownerCommitment <== donor.ownerCommitment;
    change.amount <== donorAmount - amount;
    change.nonce <== changeNonce;
    change.ciphertextHash <== ciphertextHashes[1];
    outputCommitments[1] === change.noteCommitment;
    component nz[4];
    nz[0] = NonZero(); nz[0].in <== commonBinding;
    nz[1] = NonZero(); nz[1].in <== capabilityBinding;
    nz[2] = NonZero(); nz[2].in <== nonce;
    nz[3] = NonZero(); nz[3].in <== parentVersion;
}

component main { public [chainId,pool,commonBinding,codeAlias,nonce,ownerCommitment,viewKeyLo,viewKeyHi,capabilityBinding,familyTag,parentVersion,policyCommitment,budgetKey,eligibleFrom,inputRoot,inputNullifier,outputCommitments,ciphertextHashes] } = Fund();
