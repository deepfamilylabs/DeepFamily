pragma circom 2.2.3;

// Identity templates shared by every circuit that recomputes a DeepFamily identity commitment.
// Moving them here must leave each including circuit's R1CS byte-identical.

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

template IdentityCommitmentCore() {
    signal input nameField;
    signal input derivedSecretField;
    signal input isBirthBC;
    signal input birthYear;
    signal input birthMonth;
    signal input birthDay;
    signal input gender;
    signal input suiteCommitment;

    signal output packedBirthGenderField;
    signal output nameSecretCommitment;
    signal output identityCommitment;

    component bcBit = Num2Bits(1);
    bcBit.in <== isBirthBC;
    component birthYearCheck = Num2Bits(16);
    birthYearCheck.in <== birthYear;
    component birthMonthBits = Num2Bits(4);
    birthMonthBits.in <== birthMonth;
    component birthMonthCheck = LessEqThan(4);
    birthMonthCheck.in[0] <== birthMonth;
    birthMonthCheck.in[1] <== 12;
    birthMonthCheck.out === 1;
    component birthDayCheck = Num2Bits(5);
    birthDayCheck.in <== birthDay;
    component genderCheck = Num2Bits(8);
    genderCheck.in <== gender;

    // Non-overlapping layout: birthYear[25..40], birthMonth[17..24],
    // birthDay[9..16], gender[1..8], isBirthBC[0].
    packedBirthGenderField <==
        birthYear * 33554432 + birthMonth * 131072 + birthDay * 512 + gender * 2 + isBirthBC;

    component nameSecretPoseidon = Poseidon(4);
    nameSecretPoseidon.inputs[0] <== 1001;
    nameSecretPoseidon.inputs[1] <== nameField;
    nameSecretPoseidon.inputs[2] <== derivedSecretField;
    nameSecretPoseidon.inputs[3] <== suiteCommitment;
    nameSecretCommitment <== nameSecretPoseidon.out;

    component identityPoseidon = Poseidon(4);
    identityPoseidon.inputs[0] <== 1002;
    identityPoseidon.inputs[1] <== nameSecretCommitment;
    identityPoseidon.inputs[2] <== packedBirthGenderField;
    identityPoseidon.inputs[3] <== suiteCommitment;
    identityCommitment <== identityPoseidon.out;
}

template AtomicSuiteCommitment() {
    signal input suiteId;
    signal output suiteCommitment;

    component suiteIdBits = Num2Bits(32);
    suiteIdBits.in <== suiteId;

    component suitePoseidon = Poseidon(4);
    suitePoseidon.inputs[0] <== 1000;
    suitePoseidon.inputs[1] <== suiteId;
    suitePoseidon.inputs[2] <== 0;
    suitePoseidon.inputs[3] <== 0;
    suiteCommitment <== suitePoseidon.out;
}
