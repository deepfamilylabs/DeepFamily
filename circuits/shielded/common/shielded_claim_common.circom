pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "shielded_merkle_common.circom";
include "../../lib/identity.circom";
include "shielded_funding_common.circom";
include "shielded_lineage_common.circom";

// Claim consumes one budget note and preserves its policy, enrollment and owner.
// All three period nullifiers are public, and inactive slots carry
// domain-separated dummies. Shard routing is checked by the pool against inputRoots.
template ShieldedClaim(LINEAGE_DEPTH) {
    signal input chainId;
    signal input pool;
    signal input inputRoots[1];
    signal input inputNullifiers[1];
    signal input periodNullifiers[3];
    signal input outputCommitments[2];
    signal input ciphertextHashes[2];
    signal input endorsementRoot;
    signal input trustedRoot;
    signal input asOf;

    // Identity witness follows the active person commitment circuit.
    signal input nameField;
    signal input derivedSecretField;
    signal input isBirthBC;
    signal input birthYear;
    signal input birthMonth;
    signal input birthDay;
    signal input gender;
    signal input suiteId;

    signal input versionIndex;
    signal input fatherIdentityCommitment;
    signal input motherIdentityCommitment;
    signal input rootIsMother;
    signal input endorser;
    signal input writtenAt;
    signal input endorsementDepth;
    signal input endorsementIndex;
    signal input endorsementSiblings[LINEAGE_DEPTH];

    signal input rootVersionIndex;
    signal input trustedDepth;
    signal input trustedIndex;
    signal input trustedSiblings[LINEAGE_DEPTH];

    // The policy and enrollment are private. Initial allocation must separately
    // prove that eligibleFrom was valid at its block and that value was conserved.
    signal input keyMode;
    signal input ownerSecret;
    signal input heirViewKeyLo;
    signal input heirViewKeyHi;
    signal input inputBudgetIsClaim[1];
    signal input policyCommitmentInput;
    signal input enrollmentCommitmentInput;
    signal input policySalt;
    signal input allocationKeyCommitment;
    signal input enrollmentSalt;
    signal input eligibleFrom;
    signal input rate;
    signal input periodDays;
    signal input remainingPeriods;
    signal input budgetNonce;
    signal input budgetCiphertextHash;

    // Compact LeanIMT membership path for the old budget note.
    signal input noteDepth;
    signal input noteIndex;
    signal input noteSiblings[32];

    // The first slot always claims a period, including period 0. Zero indices
    // in the second and third slots select the corresponding dummy nullifiers.
    signal input periodIndices[3];
    signal input newBudgetNonce;
    signal input payoutNonce;

    component sharedScope = ShieldedPoolDomain();
    sharedScope.chainId <== chainId;
    sharedScope.pool <== pool;

    component budgetTags = ShieldedBudgetNoteTags();
    budgetTags.poolDomain <== sharedScope.domain;

    component policyTag = ShieldedScopedTag();
    policyTag.poolDomain <== sharedScope.domain;
    policyTag.purpose <== 1010;
    component enrollmentTag = ShieldedScopedTag();
    enrollmentTag.poolDomain <== sharedScope.domain;
    enrollmentTag.purpose <== 1011;
    component spendTag = ShieldedScopedTag();
    spendTag.poolDomain <== sharedScope.domain;
    spendTag.purpose <== 1016;
    component periodTag = ShieldedScopedTag();
    periodTag.poolDomain <== sharedScope.domain;
    periodTag.purpose <== 1017;
    component dummyPeriodTag = ShieldedScopedTag();
    dummyPeriodTag.poolDomain <== sharedScope.domain;
    dummyPeriodTag.purpose <== 1019;
    component valueTag = ShieldedScopedTag();
    valueTag.poolDomain <== sharedScope.domain;
    valueTag.purpose <== 1014;

    component asOfBits = Num2Bits(64);
    asOfBits.in <== asOf;
    // Identity budgets carry a zero salt. Owner-bound budgets open a nonzero salt.
    component policySaltZero = IsZero();
    policySaltZero.in <== policySalt;
    signal budgetKind <== policySaltZero.out;
    inputBudgetIsClaim[0] * (1 - inputBudgetIsClaim[0]) === 0;
    budgetKind * inputBudgetIsClaim[0] === 0;
    keyMode * (1 - keyMode) === 0;
    budgetKind * keyMode === 0;
    signal requiresOpening <== 1 - budgetKind;
    budgetKind * allocationKeyCommitment === 0;
    budgetKind * enrollmentSalt === 0;
    component policyCommitmentNotZero = IsZero();
    policyCommitmentNotZero.in <== policyCommitmentInput;
    policyCommitmentNotZero.out === 0;
    component enrollmentCommitmentNotZero = IsZero();
    enrollmentCommitmentNotZero.in <== enrollmentCommitmentInput;
    enrollmentCommitmentNotZero.out === 0;
    component rootVersionBits = Num2Bits(64);
    rootVersionBits.in <== rootVersionIndex;

    component suite = AtomicSuiteCommitment();
    suite.suiteId <== suiteId;
    component heir = IdentityCommitmentCore();
    heir.nameField <== nameField;
    heir.derivedSecretField <== derivedSecretField;
    heir.isBirthBC <== isBirthBC;
    heir.birthYear <== birthYear;
    heir.birthMonth <== birthMonth;
    heir.birthDay <== birthDay;
    heir.gender <== gender;
    heir.suiteCommitment <== suite.suiteCommitment;

    // Fund proves the same current direct-child rule at 64 levels.
    component directChild = ShieldedDirectChildCurrent(LINEAGE_DEPTH);
    directChild.heirIdentityCommitment <== heir.identityCommitment;
    directChild.rootVersionIndex <== rootVersionIndex;
    directChild.heirVersionIndex <== versionIndex;
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
    signal rootIdentityCommitment <== directChild.rootIdentityCommitment;

    component derivedSecretNotZero = IsZero();
    derivedSecretNotZero.in <== derivedSecretField;
    derivedSecretNotZero.out === 0;
    component enrollmentSaltNotZero = IsZero();
    enrollmentSaltNotZero.in <== enrollmentSalt;
    requiresOpening * enrollmentSaltNotZero.out === 0;
    component budgetNonceNotZero = IsZero();
    budgetNonceNotZero.in <== budgetNonce;
    budgetNonceNotZero.out === 0;
    component newBudgetNonceNotZero = IsZero();
    newBudgetNonceNotZero.in <== newBudgetNonce;
    newBudgetNonceNotZero.out === 0;
    component payoutNonceNotZero = IsZero();
    payoutNonceNotZero.in <== payoutNonce;
    payoutNonceNotZero.out === 0;
    component rateBits = Num2Bits(128);
    rateBits.in <== rate;
    component rateNotZero = IsZero();
    rateNotZero.in <== rate;
    rateNotZero.out === 0;
    component periodDaysBits = Num2Bits(32);
    periodDaysBits.in <== periodDays;
    component periodDaysNotZero = IsZero();
    periodDaysNotZero.in <== periodDays;
    periodDaysNotZero.out === 0;
    component remainingPeriodsBits = Num2Bits(64);
    remainingPeriodsBits.in <== remainingPeriods;
    signal remaining <== rate * remainingPeriods;
    component remainingBits = Num2Bits(128);
    remainingBits.in <== remaining;
    component eligibleFromBits = Num2Bits(64);
    eligibleFromBits.in <== eligibleFrom;

    component allocationKeyCommitmentNotZero = IsZero();
    allocationKeyCommitmentNotZero.in <== allocationKeyCommitment;
    requiresOpening * allocationKeyCommitmentNotZero.out === 0;
    component policy = Poseidon(7);
    policy.inputs[0] <== policyTag.tag;
    policy.inputs[1] <== rootIdentityCommitment;
    policy.inputs[2] <== rootVersionIndex;
    policy.inputs[3] <== rate;
    policy.inputs[4] <== policySalt;
    policy.inputs[5] <== allocationKeyCommitment;
    policy.inputs[6] <== periodDays;
    component enrollment = Poseidon(5);
    enrollment.inputs[0] <== enrollmentTag.tag;
    enrollment.inputs[1] <== policy.out;
    enrollment.inputs[2] <== heir.identityCommitment;
    enrollment.inputs[3] <== eligibleFrom;
    enrollment.inputs[4] <== enrollmentSalt;
    requiresOpening * (policy.out - policyCommitmentInput) === 0;
    requiresOpening * (enrollment.out - enrollmentCommitmentInput) === 0;
    component terms = ShieldedIdentityBudgetTerms();
    terms.poolDomain <== sharedScope.domain;
    terms.rootIdentityCommitment <== rootIdentityCommitment;
    terms.rootVersionIndex <== rootVersionIndex;
    terms.heirIdentityCommitment <== heir.identityCommitment;
    terms.eligibleFrom <== eligibleFrom;
    terms.rate <== rate;
    terms.periodDays <== periodDays;
    component legacyOwnerSecret = Poseidon(2);
    legacyOwnerSecret.inputs[0] <== 1012;
    legacyOwnerSecret.inputs[1] <== derivedSecretField;
    (1 - keyMode) * (ownerSecret - legacyOwnerSecret.out) === 0;
    component ownerSecretNonzero = IsZero();
    ownerSecretNonzero.in <== ownerSecret;
    ownerSecretNonzero.out === 0;
    component ownerCommitment = Poseidon(2);
    ownerCommitment.inputs[0] <== 1013;
    ownerCommitment.inputs[1] <== ownerSecret;

    component oldBudget = ShieldedBoundBudgetCommitment();
    oldBudget.privateNoteTag <== budgetTags.fundPrivateNoteTag
        + inputBudgetIsClaim[0] * (budgetTags.claimPrivateNoteTag - budgetTags.fundPrivateNoteTag);
    oldBudget.identityNoteTag <== budgetTags.identityNoteTag;
    oldBudget.budgetKind <== budgetKind;
    oldBudget.keyMode <== keyMode;
    oldBudget.authorizationTag <== budgetTags.authorizationTag;
    oldBudget.policyCommitment <== policyCommitmentInput;
    oldBudget.enrollmentCommitment <== enrollmentCommitmentInput;
    oldBudget.termsCommitment <== terms.commitment;
    oldBudget.ownerCommitment <== ownerCommitment.out;
    oldBudget.viewKeyLo <== heirViewKeyLo;
    oldBudget.viewKeyHi <== heirViewKeyHi;
    oldBudget.rate <== rate;
    oldBudget.remaining <== remaining;
    oldBudget.nonce <== budgetNonce;
    oldBudget.ciphertextHash <== budgetCiphertextHash;

    component noteMerkle = ShieldedMerkleRoot(32);
    noteMerkle.leaf <== oldBudget.commitment;
    noteMerkle.depth <== noteDepth;
    noteMerkle.index <== noteIndex;
    noteMerkle.siblings <== noteSiblings;
    noteMerkle.out === inputRoots[0];

    component spend = Poseidon(3);
    spend.inputs[0] <== spendTag.tag;
    spend.inputs[1] <== ownerSecret;
    spend.inputs[2] <== oldBudget.commitment;
    spend.out === inputNullifiers[0];

    signal active[3];
    active[0] <== 1;
    component periodIndexZero[2];
    component epochBits[3];
    component epochMature[3];
    component ascending[2];
    component realPeriod[3];
    component dummyPeriod[2];
    for (var i = 0; i < 3; i++) {
        epochBits[i] = Num2Bits(64);
        epochBits[i].in <== periodIndices[i];
        if (i > 0) {
            periodIndexZero[i - 1] = IsZero();
            periodIndexZero[i - 1].in <== periodIndices[i];
            active[i] <== 1 - periodIndexZero[i - 1].out;
            ascending[i - 1] = LessThan(65);
            ascending[i - 1].in[0] <== periodIndices[i - 1];
            ascending[i - 1].in[1] <== periodIndices[i];
            active[i] * (1 - ascending[i - 1].out) === 0;
        }
        // The 64-bit index plus one is at most 2^64; the positive uint32
        // periodDays and 86400 seconds/day keep maturity below 2^113,
        // including the uint64 eligibility start. This comparison therefore
        // cannot wrap in the field or truncate a distant future maturity.
        epochMature[i] = LessEqThan(113);
        epochMature[i].in[0] <== eligibleFrom + (periodIndices[i] + 1) * periodDays * 86400;
        epochMature[i].in[1] <== asOf;
        active[i] * (1 - epochMature[i].out) === 0;
        realPeriod[i] = Poseidon(5);
        realPeriod[i].inputs[0] <== periodTag.tag;
        realPeriod[i].inputs[1] <== derivedSecretField;
        realPeriod[i].inputs[2] <== heir.identityCommitment;
        realPeriod[i].inputs[3] <== policyCommitmentInput;
        realPeriod[i].inputs[4] <== periodIndices[i];
        if (i == 0) {
            periodNullifiers[i] === realPeriod[i].out;
        } else {
            dummyPeriod[i - 1] = Poseidon(4);
            dummyPeriod[i - 1].inputs[0] <== dummyPeriodTag.tag;
            dummyPeriod[i - 1].inputs[1] <== ownerSecret;
            dummyPeriod[i - 1].inputs[2] <== oldBudget.commitment;
            dummyPeriod[i - 1].inputs[3] <== i;
            periodNullifiers[i] === dummyPeriod[i - 1].out
                + active[i] * (realPeriod[i].out - dummyPeriod[i - 1].out);
        }
    }
    active[2] * (1 - active[1]) === 0;
    signal claimCount <== active[0] + active[1] + active[2];

    signal payout <== rate * claimCount;
    component payoutBits = Num2Bits(128);
    payoutBits.in <== payout;
    signal newRemainingPeriods <== remainingPeriods - claimCount;
    component newRemainingPeriodsBits = Num2Bits(64);
    newRemainingPeriodsBits.in <== newRemainingPeriods;
    signal newRemaining <== rate * newRemainingPeriods;
    component newRemainingBits = Num2Bits(128);
    newRemainingBits.in <== newRemaining;

    component nextBudget = ShieldedBoundBudgetCommitment();
    nextBudget.privateNoteTag <== budgetTags.claimPrivateNoteTag;
    nextBudget.identityNoteTag <== budgetTags.identityNoteTag;
    nextBudget.budgetKind <== budgetKind;
    nextBudget.keyMode <== keyMode;
    nextBudget.authorizationTag <== budgetTags.authorizationTag;
    nextBudget.policyCommitment <== policyCommitmentInput;
    nextBudget.enrollmentCommitment <== enrollmentCommitmentInput;
    nextBudget.termsCommitment <== terms.commitment;
    nextBudget.ownerCommitment <== ownerCommitment.out;
    nextBudget.viewKeyLo <== heirViewKeyLo;
    nextBudget.viewKeyHi <== heirViewKeyHi;
    nextBudget.rate <== rate;
    nextBudget.remaining <== newRemaining;
    nextBudget.nonce <== newBudgetNonce;
    nextBudget.ciphertextHash <== ciphertextHashes[0];
    nextBudget.commitment === outputCommitments[0];

    component payoutOwner = Poseidon(3);
    payoutOwner.inputs[0] <== 1013;
    payoutOwner.inputs[1] <== ownerSecret;
    payoutOwner.inputs[2] <== payoutNonce;
    component payoutNote = Poseidon(5);
    payoutNote.inputs[0] <== valueTag.tag;
    payoutNote.inputs[1] <== payoutOwner.out;
    payoutNote.inputs[2] <== payout;
    payoutNote.inputs[3] <== payoutNonce;
    payoutNote.inputs[4] <== ciphertextHashes[1];
    payoutNote.out === outputCommitments[1];
}

