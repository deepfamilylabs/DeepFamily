pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/poseidon.circom";

// Public signals order (frozen by T3.3):
// 1. identityCommitment
// 2. disclosureBinding
// 3. minter
// 4. schemaVersion
// 5. cryptoSuiteVersion
// 6. hashAlgoId

template DisclosureBinding() {
    signal input nameField;
    signal input derivedSecretField;
    signal input packedBirthGenderField;
    signal input minter;
    signal input schemaVersion;
    signal input cryptoSuiteVersion;
    signal input hashAlgoId;

    signal output identityCommitment;
    signal output disclosureBinding;
    signal output minterOut;
    signal output schemaVersionOut;
    signal output cryptoSuiteVersionOut;
    signal output hashAlgoIdOut;

    component minterBits = Num2Bits(160); minterBits.in <== minter;
    component schemaVersionBits = Num2Bits(16); schemaVersionBits.in <== schemaVersion;
    component cryptoSuiteVersionBits = Num2Bits(16); cryptoSuiteVersionBits.in <== cryptoSuiteVersion;
    component hashAlgoIdBits = Num2Bits(16); hashAlgoIdBits.in <== hashAlgoId;

    signal domainSuite <== 1000;
    signal domainNameSecret <== 1001;
    signal domainIdentity <== 1002;
    signal domainDisclosure <== 1003;

    component suitePoseidon = Poseidon(4);
    suitePoseidon.inputs[0] <== domainSuite;
    suitePoseidon.inputs[1] <== schemaVersion;
    suitePoseidon.inputs[2] <== cryptoSuiteVersion;
    suitePoseidon.inputs[3] <== hashAlgoId;

    component nameSecretPoseidon = Poseidon(4);
    nameSecretPoseidon.inputs[0] <== domainNameSecret;
    nameSecretPoseidon.inputs[1] <== nameField;
    nameSecretPoseidon.inputs[2] <== derivedSecretField;
    nameSecretPoseidon.inputs[3] <== suitePoseidon.out;
    signal nameSecretCommitment <== nameSecretPoseidon.out;

    component identityPoseidon = Poseidon(4);
    identityPoseidon.inputs[0] <== domainIdentity;
    identityPoseidon.inputs[1] <== nameSecretCommitment;
    identityPoseidon.inputs[2] <== packedBirthGenderField;
    identityPoseidon.inputs[3] <== suitePoseidon.out;

    component disclosurePoseidon = Poseidon(4);
    disclosurePoseidon.inputs[0] <== domainDisclosure;
    disclosurePoseidon.inputs[1] <== nameField;
    disclosurePoseidon.inputs[2] <== packedBirthGenderField;
    disclosurePoseidon.inputs[3] <== suitePoseidon.out;

    identityCommitment <== identityPoseidon.out;
    disclosureBinding <== disclosurePoseidon.out;
    minterOut <== minter;
    schemaVersionOut <== schemaVersion;
    cryptoSuiteVersionOut <== cryptoSuiteVersion;
    hashAlgoIdOut <== hashAlgoId;
}

component main = DisclosureBinding();
