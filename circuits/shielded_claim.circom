pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "@zk-kit/binary-merkle-root.circom/src/binary-merkle-root.circom";
include "lib/identity.circom";

// Isolated prototype for action 5 of the shielded pool's fixed 32-signal ABI.
// No production verifier or deployment should use this circuit without the other
// action circuits, a fresh ceremony, end-to-end tests, and an independent audit.
//
// publicSignals:
//  0 action, 1 chainId, 2 pool, 3 inputShard0, 4 inputRoot0,
//  5 inputShard1, 6 inputRoot1, 7 inputNullifier0, 8 inputNullifier1,
//  9..20 periodNullifiers, 21 budgetOutput, 22 payoutOutput,
//  23 budgetCiphertextHash, 24 payoutCiphertextHash,
//  25 externalAmount, 26 externalRecipient, 27 endorsementRoot,
//  28 trustedRoot, 29 asOf.
template ShieldedClaim() {
    signal input publicSignals[32];

    // Identity witness, following family_inheritance_claim.circom.
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

    // All 12 slots are public nullifiers. claimCount is private; inactive slots
    // have domain-separated dummy nullifiers and zero periodIndex witnesses.
    signal input claimCount;
    signal input periodIndices[12];
    signal input newBudgetNonce;
    signal input payoutNonce;

    publicSignals[0] === 5;
    publicSignals[3] === publicSignals[5];
    publicSignals[4] === publicSignals[6];
    publicSignals[25] === 0;
    publicSignals[26] === 0;
    publicSignals[30] === 0;
    publicSignals[31] === 0;
    component chainBits = Num2Bits(64);
    chainBits.in <== publicSignals[1];
    component poolBits = Num2Bits(160);
    poolBits.in <== publicSignals[2];
    component asOfBits = Num2Bits(64);
    asOfBits.in <== publicSignals[29];

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
    endorsementMerkle.out === publicSignals[27];
    component trustedMerkle = BinaryMerkleRoot(64);
    trustedMerkle.leaf <== trustedLeaf.out;
    trustedMerkle.depth <== trustedDepth;
    trustedMerkle.index <== trustedIndex;
    trustedMerkle.siblings <== trustedSiblings;
    trustedMerkle.out === publicSignals[28];

    component derivedSecretNotZero = IsZero();
    derivedSecretNotZero.in <== derivedSecretField;
    derivedSecretNotZero.out === 0;
    component policySaltNotZero = IsZero();
    policySaltNotZero.in <== policySalt;
    policySaltNotZero.out === 0;
    component enrollmentSaltNotZero = IsZero();
    enrollmentSaltNotZero.in <== enrollmentSalt;
    enrollmentSaltNotZero.out === 0;
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
    allocationKeyCommitmentNotZero.out === 0;
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
    component ownerSecret = Poseidon(2);
    ownerSecret.inputs[0] <== 1012;
    ownerSecret.inputs[1] <== derivedSecretField;
    component ownerCommitment = Poseidon(2);
    ownerCommitment.inputs[0] <== 1013;
    ownerCommitment.inputs[1] <== ownerSecret.out;

    component oldBudget = Poseidon(8);
    oldBudget.inputs[0] <== 1015;
    oldBudget.inputs[1] <== policy.out;
    oldBudget.inputs[2] <== enrollment.out;
    oldBudget.inputs[3] <== ownerCommitment.out;
    oldBudget.inputs[4] <== rate;
    oldBudget.inputs[5] <== remaining;
    oldBudget.inputs[6] <== budgetNonce;
    oldBudget.inputs[7] <== budgetCiphertextHash;

    component noteDepthBits = Num2Bits(6);
    noteDepthBits.in <== noteDepth;
    component noteDepthOk = LessEqThan(6);
    noteDepthOk.in[0] <== noteDepth;
    noteDepthOk.in[1] <== 32;
    noteDepthOk.out === 1;
    component noteMerkle = BinaryMerkleRoot(32);
    noteMerkle.leaf <== oldBudget.out;
    noteMerkle.depth <== noteDepth;
    noteMerkle.index <== noteIndex;
    noteMerkle.siblings <== noteSiblings;
    noteMerkle.out === publicSignals[4];

    component spend = Poseidon(3);
    spend.inputs[0] <== 1016;
    spend.inputs[1] <== ownerSecret.out;
    spend.inputs[2] <== oldBudget.out;
    spend.out === publicSignals[7];
    component dummySpend = Poseidon(3);
    dummySpend.inputs[0] <== 1021;
    dummySpend.inputs[1] <== ownerSecret.out;
    dummySpend.inputs[2] <== oldBudget.out;
    dummySpend.out === publicSignals[8];

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
        epochMature[i].in[1] <== publicSignals[29];
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
        realPeriod[i].inputs[2] <== policy.out;
        realPeriod[i].inputs[3] <== periodIndices[i];
        dummyPeriod[i] = Poseidon(4);
        dummyPeriod[i].inputs[0] <== 1019;
        dummyPeriod[i].inputs[1] <== ownerSecret.out;
        dummyPeriod[i].inputs[2] <== oldBudget.out;
        dummyPeriod[i].inputs[3] <== i;
        publicSignals[9 + i] ===
            dummyPeriod[i].out + active[i].out * (realPeriod[i].out - dummyPeriod[i].out);
    }

    signal payout <== rate * claimCount;
    component payoutBits = Num2Bits(128);
    payoutBits.in <== payout;
    signal newRemaining <== remaining - payout;
    component newRemainingBits = Num2Bits(128);
    newRemainingBits.in <== newRemaining;
    signal newRemainingPeriods <== remainingPeriods - claimCount;
    component newRemainingPeriodsBits = Num2Bits(64);
    newRemainingPeriodsBits.in <== newRemainingPeriods;
    newRemaining === rate * newRemainingPeriods;

    component nextBudget = Poseidon(8);
    nextBudget.inputs[0] <== 1015;
    nextBudget.inputs[1] <== policy.out;
    nextBudget.inputs[2] <== enrollment.out;
    nextBudget.inputs[3] <== ownerCommitment.out;
    nextBudget.inputs[4] <== rate;
    nextBudget.inputs[5] <== newRemaining;
    nextBudget.inputs[6] <== newBudgetNonce;
    nextBudget.inputs[7] <== publicSignals[23];
    nextBudget.out === publicSignals[21];

    component payoutNote = Poseidon(5);
    payoutNote.inputs[0] <== 1014;
    payoutNote.inputs[1] <== ownerCommitment.out;
    payoutNote.inputs[2] <== payout;
    payoutNote.inputs[3] <== payoutNonce;
    payoutNote.inputs[4] <== publicSignals[24];
    payoutNote.out === publicSignals[22];
}

component main { public [publicSignals] } = ShieldedClaim();
