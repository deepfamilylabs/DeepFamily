pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "@zk-kit/binary-merkle-root.circom/src/binary-merkle-root.circom";
include "lib/identity.circom";
include "shielded_funding_common.circom";

// Claim consumes one or two distinct budgets with one policy/enrollment/owner.
// An absent second input repeats the first root and has a bound dummy nullifier.
// All twelve period nullifiers are public, and inactive slots carry
// domain-separated dummies.
template ShieldedClaim() {
    signal input chainId;
    signal input pool;
    signal input inputShardIds[2];
    signal input inputRoots[2];
    signal input inputNullifiers[2];
    signal input periodNullifiers[12];
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
    signal input endorsementSiblings[64];

    signal input rootVersionIndex;
    signal input trustedDepth;
    signal input trustedIndex;
    signal input trustedSiblings[64];

    // The policy and enrollment are private. Initial allocation must separately
    // prove that eligibleFrom was valid at its block and that value was conserved.
    signal input budgetKind;
    signal input secondBudgetKind;
    signal input policyCommitmentInput;
    signal input enrollmentCommitmentInput;
    signal input policySalt;
    signal input allocationKeyCommitment;
    signal input enrollmentSalt;
    signal input eligibleFrom;
    signal input rate;
    signal input remaining;
    signal input remainingPeriods;
    signal input budgetNonce;
    signal input budgetCiphertextHash;

    // Compact LeanIMT membership path for the old budget note.
    signal input noteDepth;
    signal input noteIndex;
    signal input noteSiblings[32];
    signal input hasSecondInput;
    signal input secondRemaining;
    signal input secondRemainingPeriods;
    signal input secondBudgetNonce;
    signal input secondBudgetCiphertextHash;
    signal input secondNoteDepth;
    signal input secondNoteIndex;
    signal input secondNoteSiblings[32];

    // All 12 slots are public nullifiers. claimCount is private; inactive slots
    // have domain-separated dummy nullifiers and zero periodIndex witnesses.
    signal input claimCount;
    signal input periodIndices[12];
    signal input newBudgetNonce;
    signal input payoutNonce;

    component chainBits = Num2Bits(64);
    chainBits.in <== chainId;
    component poolBits = Num2Bits(160);
    poolBits.in <== pool;
    component asOfBits = Num2Bits(64);
    asOfBits.in <== asOf;
    hasSecondInput * (1 - hasSecondInput) === 0;
    budgetKind * (1 - budgetKind) === 0;
    secondBudgetKind * (1 - secondBudgetKind) === 0;
    (1 - hasSecondInput) * secondBudgetKind === 0;
    signal secondPrivate <== hasSecondInput * (1 - secondBudgetKind);
    signal requiresOpening <== 1 - budgetKind + budgetKind * secondPrivate;
    signal remainderKind <== 1 - requiresOpening;
    (1 - requiresOpening) * policySalt === 0;
    (1 - requiresOpening) * allocationKeyCommitment === 0;
    (1 - requiresOpening) * enrollmentSalt === 0;
    component policyCommitmentNotZero = IsZero();
    policyCommitmentNotZero.in <== policyCommitmentInput;
    policyCommitmentNotZero.out === 0;
    component enrollmentCommitmentNotZero = IsZero();
    enrollmentCommitmentNotZero.in <== enrollmentCommitmentInput;
    enrollmentCommitmentNotZero.out === 0;
    (1 - hasSecondInput) * (inputShardIds[1] - inputShardIds[0]) === 0;
    (1 - hasSecondInput) * (inputRoots[1] - inputRoots[0]) === 0;
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

    rootIsMother * (1 - rootIsMother) === 0;
    signal rootIdentityCommitment <==
        fatherIdentityCommitment + rootIsMother * (motherIdentityCommitment - fatherIdentityCommitment);
    component rootIsZero = IsZero();
    rootIsZero.in <== rootIdentityCommitment;
    rootIsZero.out === 0;

    component parents = Poseidon(3);
    parents.inputs[0] <== 1009;
    parents.inputs[1] <== fatherIdentityCommitment;
    parents.inputs[2] <== motherIdentityCommitment;
    component endorserBits = Num2Bits(160);
    endorserBits.in <== endorser;
    component writtenAtBits = Num2Bits(64);
    writtenAtBits.in <== writtenAt;
    signal endorserAndTime <== writtenAt * (1 << 160) + endorser;
    component endorsementLeaf = Poseidon(5);
    endorsementLeaf.inputs[0] <== 1007;
    endorsementLeaf.inputs[1] <== heir.identityCommitment;
    endorsementLeaf.inputs[2] <== parents.out;
    endorsementLeaf.inputs[3] <== versionIndex;
    endorsementLeaf.inputs[4] <== endorserAndTime;
    component trustedLeaf = Poseidon(4);
    trustedLeaf.inputs[0] <== 1008;
    trustedLeaf.inputs[1] <== rootIdentityCommitment;
    trustedLeaf.inputs[2] <== rootVersionIndex;
    trustedLeaf.inputs[3] <== endorser;

    component endorsementDepthBits = Num2Bits(7);
    endorsementDepthBits.in <== endorsementDepth;
    component trustedDepthBits = Num2Bits(7);
    trustedDepthBits.in <== trustedDepth;
    component endorsementDepthOk = LessEqThan(7);
    endorsementDepthOk.in[0] <== endorsementDepth;
    endorsementDepthOk.in[1] <== 64;
    endorsementDepthOk.out === 1;
    component trustedDepthOk = LessEqThan(7);
    trustedDepthOk.in[0] <== trustedDepth;
    trustedDepthOk.in[1] <== 64;
    trustedDepthOk.out === 1;
    component endorsementMerkle = BinaryMerkleRoot(64);
    endorsementMerkle.leaf <== endorsementLeaf.out;
    endorsementMerkle.depth <== endorsementDepth;
    endorsementMerkle.index <== endorsementIndex;
    endorsementMerkle.siblings <== endorsementSiblings;
    endorsementMerkle.out === endorsementRoot;
    component trustedMerkle = BinaryMerkleRoot(64);
    trustedMerkle.leaf <== trustedLeaf.out;
    trustedMerkle.depth <== trustedDepth;
    trustedMerkle.index <== trustedIndex;
    trustedMerkle.siblings <== trustedSiblings;
    trustedMerkle.out === trustedRoot;

    component derivedSecretNotZero = IsZero();
    derivedSecretNotZero.in <== derivedSecretField;
    derivedSecretNotZero.out === 0;
    component policySaltNotZero = IsZero();
    policySaltNotZero.in <== policySalt;
    requiresOpening * policySaltNotZero.out === 0;
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
    component remainingBits = Num2Bits(128);
    remainingBits.in <== remaining;
    component remainingPeriodsBits = Num2Bits(64);
    remainingPeriodsBits.in <== remainingPeriods;
    remaining === rate * remainingPeriods;
    component eligibleFromBits = Num2Bits(64);
    eligibleFromBits.in <== eligibleFrom;

    component allocationKeyCommitmentNotZero = IsZero();
    allocationKeyCommitmentNotZero.in <== allocationKeyCommitment;
    requiresOpening * allocationKeyCommitmentNotZero.out === 0;
    component policy = Poseidon(6);
    policy.inputs[0] <== 1010;
    policy.inputs[1] <== rootIdentityCommitment;
    policy.inputs[2] <== rootVersionIndex;
    policy.inputs[3] <== rate;
    policy.inputs[4] <== policySalt;
    policy.inputs[5] <== allocationKeyCommitment;
    component enrollment = Poseidon(5);
    enrollment.inputs[0] <== 1011;
    enrollment.inputs[1] <== policy.out;
    enrollment.inputs[2] <== heir.identityCommitment;
    enrollment.inputs[3] <== eligibleFrom;
    enrollment.inputs[4] <== enrollmentSalt;
    requiresOpening * (policy.out - policyCommitmentInput) === 0;
    requiresOpening * (enrollment.out - enrollmentCommitmentInput) === 0;
    component terms = ShieldedIdentityBudgetTerms();
    terms.rootIdentityCommitment <== rootIdentityCommitment;
    terms.rootVersionIndex <== rootVersionIndex;
    terms.heirIdentityCommitment <== heir.identityCommitment;
    terms.eligibleFrom <== eligibleFrom;
    terms.rate <== rate;
    component ownerSecret = Poseidon(2);
    ownerSecret.inputs[0] <== 1012;
    ownerSecret.inputs[1] <== derivedSecretField;
    component ownerCommitment = Poseidon(2);
    ownerCommitment.inputs[0] <== 1013;
    ownerCommitment.inputs[1] <== ownerSecret.out;

    component oldBudget = ShieldedBoundBudgetCommitment();
    oldBudget.budgetKind <== budgetKind;
    oldBudget.policyCommitment <== policyCommitmentInput;
    oldBudget.enrollmentCommitment <== enrollmentCommitmentInput;
    oldBudget.termsCommitment <== terms.commitment;
    oldBudget.ownerCommitment <== ownerCommitment.out;
    oldBudget.rate <== rate;
    oldBudget.remaining <== remaining;
    oldBudget.nonce <== budgetNonce;
    oldBudget.ciphertextHash <== budgetCiphertextHash;

    component noteDepthBits = Num2Bits(6);
    noteDepthBits.in <== noteDepth;
    component noteDepthOk = LessEqThan(6);
    noteDepthOk.in[0] <== noteDepth;
    noteDepthOk.in[1] <== 32;
    noteDepthOk.out === 1;
    component noteMerkle = BinaryMerkleRoot(32);
    noteMerkle.leaf <== oldBudget.commitment;
    noteMerkle.depth <== noteDepth;
    noteMerkle.index <== noteIndex;
    noteMerkle.siblings <== noteSiblings;
    noteMerkle.out === inputRoots[0];

    component spend = Poseidon(3);
    spend.inputs[0] <== 1016;
    spend.inputs[1] <== ownerSecret.out;
    spend.inputs[2] <== oldBudget.commitment;
    spend.out === inputNullifiers[0];
    component dummySpend = Poseidon(3);
    dummySpend.inputs[0] <== 1021;
    dummySpend.inputs[1] <== ownerSecret.out;
    dummySpend.inputs[2] <== oldBudget.commitment;
    // The optional second budget uses the same policy, enrollment and owner.
    // Its value is counted only when its membership and spend are proved.
    (1 - hasSecondInput) * secondRemaining === 0;
    (1 - hasSecondInput) * secondRemainingPeriods === 0;
    (1 - hasSecondInput) * secondBudgetNonce === 0;
    (1 - hasSecondInput) * secondBudgetCiphertextHash === 0;
    (1 - hasSecondInput) * secondNoteDepth === 0;
    (1 - hasSecondInput) * secondNoteIndex === 0;
    for (var i = 0; i < 32; i++) (1 - hasSecondInput) * secondNoteSiblings[i] === 0;
    component secondAmountBits = Num2Bits(128);
    secondAmountBits.in <== secondRemaining;
    component secondPeriodsBits = Num2Bits(64);
    secondPeriodsBits.in <== secondRemainingPeriods;
    secondRemaining === rate * secondRemainingPeriods;
    component secondNonceNotZero = IsZero();
    secondNonceNotZero.in <== secondBudgetNonce;
    hasSecondInput * secondNonceNotZero.out === 0;
    component secondBudget = ShieldedBoundBudgetCommitment();
    secondBudget.budgetKind <== secondBudgetKind;
    secondBudget.policyCommitment <== policyCommitmentInput;
    secondBudget.enrollmentCommitment <== enrollmentCommitmentInput;
    secondBudget.termsCommitment <== terms.commitment;
    secondBudget.ownerCommitment <== ownerCommitment.out;
    secondBudget.rate <== rate;
    secondBudget.remaining <== secondRemaining;
    secondBudget.nonce <== secondBudgetNonce;
    secondBudget.ciphertextHash <== secondBudgetCiphertextHash;

    component secondDepthBits = Num2Bits(6);
    secondDepthBits.in <== secondNoteDepth;
    component secondDepthOk = LessEqThan(6);
    secondDepthOk.in[0] <== secondNoteDepth;
    secondDepthOk.in[1] <== 32;
    secondDepthOk.out === 1;
    component secondMembership = BinaryMerkleRoot(32);
    secondMembership.leaf <== secondBudget.commitment;
    secondMembership.depth <== secondNoteDepth;
    secondMembership.index <== secondNoteIndex;
    secondMembership.siblings <== secondNoteSiblings;
    hasSecondInput * (secondMembership.out - inputRoots[1]) === 0;
    component distinctBudgets = IsEqual();
    distinctBudgets.in[0] <== oldBudget.commitment;
    distinctBudgets.in[1] <== secondBudget.commitment;
    hasSecondInput * distinctBudgets.out === 0;
    component secondSpend = Poseidon(3);
    secondSpend.inputs[0] <== 1016;
    secondSpend.inputs[1] <== ownerSecret.out;
    secondSpend.inputs[2] <== secondBudget.commitment;
    inputNullifiers[1] === dummySpend.out + hasSecondInput * (secondSpend.out - dummySpend.out);
    signal totalRemaining <== remaining + secondRemaining;
    component totalAmountBits = Num2Bits(128);
    totalAmountBits.in <== totalRemaining;
    signal totalPeriods <== remainingPeriods + secondRemainingPeriods;
    component totalPeriodsBits = Num2Bits(64);
    totalPeriodsBits.in <== totalPeriods;
    totalRemaining === rate * totalPeriods;

    component countBits = Num2Bits(4);
    countBits.in <== claimCount;
    component countPositive = LessThan(4);
    countPositive.in[0] <== 0;
    countPositive.in[1] <== claimCount;
    countPositive.out === 1;
    component countAtMostTwelve = LessEqThan(4);
    countAtMostTwelve.in[0] <== claimCount;
    countAtMostTwelve.in[1] <== 12;
    countAtMostTwelve.out === 1;

    component active[12];
    component epochBits[12];
    component epochMature[12];
    component ascending[11];
    component realPeriod[12];
    component dummyPeriod[12];
    for (var i = 0; i < 12; i++) {
        active[i] = LessThan(4);
        active[i].in[0] <== i;
        active[i].in[1] <== claimCount;
        epochBits[i] = Num2Bits(64);
        epochBits[i].in <== periodIndices[i];
        (1 - active[i].out) * periodIndices[i] === 0;
        // Period 0 matures exactly 30 days after the private qualification
        // start; period k matures at eligibleFrom + (k + 1) * 30 days.
        epochMature[i] = LessEqThan(87);
        epochMature[i].in[0] <== eligibleFrom + (periodIndices[i] + 1) * 2592000;
        epochMature[i].in[1] <== asOf;
        active[i].out * (1 - epochMature[i].out) === 0;
        if (i > 0) {
            ascending[i - 1] = LessThan(65);
            ascending[i - 1].in[0] <== periodIndices[i - 1];
            ascending[i - 1].in[1] <== periodIndices[i];
            active[i].out * (1 - ascending[i - 1].out) === 0;
        }
        realPeriod[i] = Poseidon(4);
        realPeriod[i].inputs[0] <== 1017;
        realPeriod[i].inputs[1] <== derivedSecretField;
        realPeriod[i].inputs[2] <== policyCommitmentInput;
        realPeriod[i].inputs[3] <== periodIndices[i];
        dummyPeriod[i] = Poseidon(4);
        dummyPeriod[i].inputs[0] <== 1019;
        dummyPeriod[i].inputs[1] <== ownerSecret.out;
        dummyPeriod[i].inputs[2] <== oldBudget.commitment;
        dummyPeriod[i].inputs[3] <== i;
        periodNullifiers[i] ===
            dummyPeriod[i].out + active[i].out * (realPeriod[i].out - dummyPeriod[i].out);
    }

    signal payout <== rate * claimCount;
    component payoutBits = Num2Bits(128);
    payoutBits.in <== payout;
    signal newRemaining <== totalRemaining - payout;
    component newRemainingBits = Num2Bits(128);
    newRemainingBits.in <== newRemaining;
    signal newRemainingPeriods <== totalPeriods - claimCount;
    component newRemainingPeriodsBits = Num2Bits(64);
    newRemainingPeriodsBits.in <== newRemainingPeriods;
    newRemaining === rate * newRemainingPeriods;

    component nextBudget = ShieldedBoundBudgetCommitment();
    nextBudget.budgetKind <== remainderKind;
    nextBudget.policyCommitment <== policyCommitmentInput;
    nextBudget.enrollmentCommitment <== enrollmentCommitmentInput;
    nextBudget.termsCommitment <== terms.commitment;
    nextBudget.ownerCommitment <== ownerCommitment.out;
    nextBudget.rate <== rate;
    nextBudget.remaining <== newRemaining;
    nextBudget.nonce <== newBudgetNonce;
    nextBudget.ciphertextHash <== ciphertextHashes[0];
    nextBudget.commitment === outputCommitments[0];

    component payoutNote = Poseidon(5);
    payoutNote.inputs[0] <== 1014;
    payoutNote.inputs[1] <== ownerCommitment.out;
    payoutNote.inputs[2] <== payout;
    payoutNote.inputs[3] <== payoutNonce;
    payoutNote.inputs[4] <== ciphertextHashes[1];
    payoutNote.out === outputCommitments[1];
}

component main {
    public [
        chainId,
        pool,
        inputShardIds,
        inputRoots,
        inputNullifiers,
        periodNullifiers,
        outputCommitments,
        ciphertextHashes,
        endorsementRoot,
        trustedRoot,
        asOf
    ]
} = ShieldedClaim();
