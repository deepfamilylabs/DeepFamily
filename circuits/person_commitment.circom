pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// PersonRelation v1 public signals (order is protocol ABI):
// 1. identityCommitment
// 2. fatherIdentityCommitment
// 3. motherIdentityCommitment
// 4. submitterAndSelfSuiteId
// 5. versionCommitment

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

template PersonRelation() {
    signal input nameField;
    signal input derivedSecretField;
    signal input isBirthBC;
    signal input birthYear;
    signal input birthMonth;
    signal input birthDay;
    signal input gender;
    signal input selfSuiteId;

    signal input fatherNameField;
    signal input fatherDerivedSecretField;
    signal input fatherIsBirthBC;
    signal input fatherBirthYear;
    signal input fatherBirthMonth;
    signal input fatherBirthDay;
    signal input fatherGender;
    signal input fatherSuiteId;

    signal input motherNameField;
    signal input motherDerivedSecretField;
    signal input motherIsBirthBC;
    signal input motherBirthYear;
    signal input motherBirthMonth;
    signal input motherBirthDay;
    signal input motherGender;
    signal input motherSuiteId;

    signal input hasFather;
    signal input hasMother;
    signal input submitter;
    signal input contentDigestLo;
    signal input contentDigestHi;

    signal output identityCommitment;
    signal output fatherIdentityCommitment;
    signal output motherIdentityCommitment;
    signal output submitterAndSelfSuiteId;
    signal output versionCommitment;

    component hasFatherBit = Num2Bits(1);
    hasFatherBit.in <== hasFather;
    component hasMotherBit = Num2Bits(1);
    hasMotherBit.in <== hasMother;
    component submitterBits = Num2Bits(160);
    submitterBits.in <== submitter;
    component digestLoBits = Num2Bits(128);
    digestLoBits.in <== contentDigestLo;
    component digestHiBits = Num2Bits(128);
    digestHiBits.in <== contentDigestHi;

    component selfSuite = AtomicSuiteCommitment();
    selfSuite.suiteId <== selfSuiteId;
    component fatherSuite = AtomicSuiteCommitment();
    fatherSuite.suiteId <== fatherSuiteId;
    component motherSuite = AtomicSuiteCommitment();
    motherSuite.suiteId <== motherSuiteId;

    signal selfSuiteIdInv;
    signal fatherSuiteIdInv;
    signal motherSuiteIdInv;
    selfSuiteIdInv <-- selfSuiteId != 0 ? 1 / selfSuiteId : 0;
    fatherSuiteIdInv <-- fatherSuiteId != 0 ? 1 / fatherSuiteId : 0;
    motherSuiteIdInv <-- motherSuiteId != 0 ? 1 / motherSuiteId : 0;
    selfSuiteId * selfSuiteIdInv === 1;
    fatherSuiteId * fatherSuiteIdInv === hasFather;
    motherSuiteId * motherSuiteIdInv === hasMother;
    (1 - hasFather) * fatherSuiteIdInv === 0;
    (1 - hasMother) * motherSuiteIdInv === 0;

    // A null parent has one canonical witness: every role-specific input is zero.
    (1 - hasFather) * fatherNameField === 0;
    (1 - hasFather) * fatherDerivedSecretField === 0;
    (1 - hasFather) * fatherIsBirthBC === 0;
    (1 - hasFather) * fatherBirthYear === 0;
    (1 - hasFather) * fatherBirthMonth === 0;
    (1 - hasFather) * fatherBirthDay === 0;
    (1 - hasFather) * fatherGender === 0;
    (1 - hasFather) * fatherSuiteId === 0;

    (1 - hasMother) * motherNameField === 0;
    (1 - hasMother) * motherDerivedSecretField === 0;
    (1 - hasMother) * motherIsBirthBC === 0;
    (1 - hasMother) * motherBirthYear === 0;
    (1 - hasMother) * motherBirthMonth === 0;
    (1 - hasMother) * motherBirthDay === 0;
    (1 - hasMother) * motherGender === 0;
    (1 - hasMother) * motherSuiteId === 0;

    component selfCore = IdentityCommitmentCore();
    selfCore.nameField <== nameField;
    selfCore.derivedSecretField <== derivedSecretField;
    selfCore.isBirthBC <== isBirthBC;
    selfCore.birthYear <== birthYear;
    selfCore.birthMonth <== birthMonth;
    selfCore.birthDay <== birthDay;
    selfCore.gender <== gender;
    selfCore.suiteCommitment <== selfSuite.suiteCommitment;

    component fatherCore = IdentityCommitmentCore();
    fatherCore.nameField <== fatherNameField;
    fatherCore.derivedSecretField <== fatherDerivedSecretField;
    fatherCore.isBirthBC <== fatherIsBirthBC;
    fatherCore.birthYear <== fatherBirthYear;
    fatherCore.birthMonth <== fatherBirthMonth;
    fatherCore.birthDay <== fatherBirthDay;
    fatherCore.gender <== fatherGender;
    fatherCore.suiteCommitment <== fatherSuite.suiteCommitment;

    component motherCore = IdentityCommitmentCore();
    motherCore.nameField <== motherNameField;
    motherCore.derivedSecretField <== motherDerivedSecretField;
    motherCore.isBirthBC <== motherIsBirthBC;
    motherCore.birthYear <== motherBirthYear;
    motherCore.birthMonth <== motherBirthMonth;
    motherCore.birthDay <== motherBirthDay;
    motherCore.gender <== motherGender;
    motherCore.suiteCommitment <== motherSuite.suiteCommitment;

    signal selfCommitmentInv;
    signal fatherCommitmentInv;
    signal motherCommitmentInv;
    selfCommitmentInv <--
        selfCore.identityCommitment != 0 ? 1 / selfCore.identityCommitment : 0;
    fatherCommitmentInv <--
        hasFather != 0 && fatherCore.identityCommitment != 0
            ? 1 / fatherCore.identityCommitment
            : 0;
    motherCommitmentInv <--
        hasMother != 0 && motherCore.identityCommitment != 0
            ? 1 / motherCore.identityCommitment
            : 0;
    selfCore.identityCommitment * selfCommitmentInv === 1;
    fatherCore.identityCommitment * fatherCommitmentInv === hasFather;
    motherCore.identityCommitment * motherCommitmentInv === hasMother;
    (1 - hasFather) * fatherCommitmentInv === 0;
    (1 - hasMother) * motherCommitmentInv === 0;

    identityCommitment <== selfCore.identityCommitment;
    fatherIdentityCommitment <== hasFather * fatherCore.identityCommitment;
    motherIdentityCommitment <== hasMother * motherCore.identityCommitment;
    submitterAndSelfSuiteId <==
        submitter + selfSuiteId * 1461501637330902918203684832716283019655932542976;

    component versionPoseidon = Poseidon(4);
    versionPoseidon.inputs[0] <== 1004;
    // This is deliberately the exact same signal used by selfCore.
    versionPoseidon.inputs[1] <== derivedSecretField;
    versionPoseidon.inputs[2] <== contentDigestLo;
    versionPoseidon.inputs[3] <== contentDigestHi;
    versionCommitment <== versionPoseidon.out;
}

component main = PersonRelation();
