pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Public signals order (frozen by T3.3):
// 1. identityCommitment
// 2. fatherIdentityCommitment
// 3. motherIdentityCommitment
// 4. submitter
// 5. schemaVersion
// 6. cryptoSuiteVersion
// 7. hashAlgoId

template IdentityCommitmentCoreV2() {
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
    component genderCheck = Num2Bits(3);
    genderCheck.in <== gender;

    packedBirthGenderField <== birthYear * 16777216 + birthMonth * 65536 + birthDay * 256 + gender * 2 + isBirthBC;

    signal domainNameSecret <== 1001;
    signal domainIdentity <== 1002;

    component nameSecretPoseidon = Poseidon(4);
    nameSecretPoseidon.inputs[0] <== domainNameSecret;
    nameSecretPoseidon.inputs[1] <== nameField;
    nameSecretPoseidon.inputs[2] <== derivedSecretField;
    nameSecretPoseidon.inputs[3] <== suiteCommitment;
    nameSecretCommitment <== nameSecretPoseidon.out;

    component identityPoseidon = Poseidon(4);
    identityPoseidon.inputs[0] <== domainIdentity;
    identityPoseidon.inputs[1] <== nameSecretCommitment;
    identityPoseidon.inputs[2] <== packedBirthGenderField;
    identityPoseidon.inputs[3] <== suiteCommitment;
    identityCommitment <== identityPoseidon.out;
}

template PersonCommitmentV2() {
    signal input nameField;
    signal input derivedSecretField;
    signal input isBirthBC;
    signal input birthYear;
    signal input birthMonth;
    signal input birthDay;
    signal input gender;
    signal input fatherNameField;
    signal input fatherDerivedSecretField;
    signal input fatherIsBirthBC;
    signal input fatherBirthYear;
    signal input fatherBirthMonth;
    signal input fatherBirthDay;
    signal input fatherGender;
    signal input motherNameField;
    signal input motherDerivedSecretField;
    signal input motherIsBirthBC;
    signal input motherBirthYear;
    signal input motherBirthMonth;
    signal input motherBirthDay;
    signal input motherGender;
    signal input hasFather;
    signal input hasMother;
    signal input submitter;
    signal input schemaVersion;
    signal input cryptoSuiteVersion;
    signal input hashAlgoId;

    signal output identityCommitment;
    signal output fatherIdentityCommitment;
    signal output motherIdentityCommitment;
    signal output submitterOut;
    signal output schemaVersionOut;
    signal output cryptoSuiteVersionOut;
    signal output hashAlgoIdOut;

    component hasFatherBit = Num2Bits(1); hasFatherBit.in <== hasFather;
    component hasMotherBit = Num2Bits(1); hasMotherBit.in <== hasMother;
    component submitterBits = Num2Bits(160); submitterBits.in <== submitter;
    component schemaVersionBits = Num2Bits(16); schemaVersionBits.in <== schemaVersion;
    component cryptoSuiteVersionBits = Num2Bits(16); cryptoSuiteVersionBits.in <== cryptoSuiteVersion;
    component hashAlgoIdBits = Num2Bits(16); hashAlgoIdBits.in <== hashAlgoId;

    signal domainSuite <== 1000;
    component suitePoseidon = Poseidon(4);
    suitePoseidon.inputs[0] <== domainSuite;
    suitePoseidon.inputs[1] <== schemaVersion;
    suitePoseidon.inputs[2] <== cryptoSuiteVersion;
    suitePoseidon.inputs[3] <== hashAlgoId;

    component personCore = IdentityCommitmentCoreV2();
    personCore.nameField <== nameField;
    personCore.derivedSecretField <== derivedSecretField;
    personCore.isBirthBC <== isBirthBC;
    personCore.birthYear <== birthYear;
    personCore.birthMonth <== birthMonth;
    personCore.birthDay <== birthDay;
    personCore.gender <== gender;
    personCore.suiteCommitment <== suitePoseidon.out;

    component fatherCore = IdentityCommitmentCoreV2();
    fatherCore.nameField <== fatherNameField;
    fatherCore.derivedSecretField <== fatherDerivedSecretField;
    fatherCore.isBirthBC <== fatherIsBirthBC;
    fatherCore.birthYear <== fatherBirthYear;
    fatherCore.birthMonth <== fatherBirthMonth;
    fatherCore.birthDay <== fatherBirthDay;
    fatherCore.gender <== fatherGender;
    fatherCore.suiteCommitment <== suitePoseidon.out;

    component motherCore = IdentityCommitmentCoreV2();
    motherCore.nameField <== motherNameField;
    motherCore.derivedSecretField <== motherDerivedSecretField;
    motherCore.isBirthBC <== motherIsBirthBC;
    motherCore.birthYear <== motherBirthYear;
    motherCore.birthMonth <== motherBirthMonth;
    motherCore.birthDay <== motherBirthDay;
    motherCore.gender <== motherGender;
    motherCore.suiteCommitment <== suitePoseidon.out;

    identityCommitment <== personCore.identityCommitment;
    fatherIdentityCommitment <== hasFather * fatherCore.identityCommitment;
    motherIdentityCommitment <== hasMother * motherCore.identityCommitment;
    submitterOut <== submitter;
    schemaVersionOut <== schemaVersion;
    cryptoSuiteVersionOut <== cryptoSuiteVersion;
    hashAlgoIdOut <== hashAlgoId;
}

component main = PersonCommitmentV2();
