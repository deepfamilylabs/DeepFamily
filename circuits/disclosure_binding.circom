pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// DisclosureBinding v1 public signals (order is protocol ABI):
// 1. identityCommitment
// 2. disclosureBinding
// 3. minter
// 4. suiteCommitment

template DisclosureBinding() {
    signal input nameField;
    signal input derivedSecretField;
    signal input packedBirthGenderField;
    signal input minter;
    signal input selfSuiteId;

    signal output identityCommitment;
    signal output disclosureBinding;
    signal output minterOut;
    signal output suiteCommitment;

    component minterBits = Num2Bits(160);
    minterBits.in <== minter;
    component selfSuiteIdBits = Num2Bits(32);
    selfSuiteIdBits.in <== selfSuiteId;
    signal selfSuiteIdInv;
    selfSuiteIdInv <-- selfSuiteId != 0 ? 1 / selfSuiteId : 0;
    selfSuiteId * selfSuiteIdInv === 1;

    component suitePoseidon = Poseidon(4);
    suitePoseidon.inputs[0] <== 1000;
    suitePoseidon.inputs[1] <== selfSuiteId;
    suitePoseidon.inputs[2] <== 0;
    suitePoseidon.inputs[3] <== 0;
    suiteCommitment <== suitePoseidon.out;

    component nameSecretPoseidon = Poseidon(4);
    nameSecretPoseidon.inputs[0] <== 1001;
    nameSecretPoseidon.inputs[1] <== nameField;
    nameSecretPoseidon.inputs[2] <== derivedSecretField;
    nameSecretPoseidon.inputs[3] <== suiteCommitment;

    component identityPoseidon = Poseidon(4);
    identityPoseidon.inputs[0] <== 1002;
    identityPoseidon.inputs[1] <== nameSecretPoseidon.out;
    identityPoseidon.inputs[2] <== packedBirthGenderField;
    identityPoseidon.inputs[3] <== suiteCommitment;

    component disclosurePoseidon = Poseidon(4);
    disclosurePoseidon.inputs[0] <== 1003;
    disclosurePoseidon.inputs[1] <== nameField;
    disclosurePoseidon.inputs[2] <== packedBirthGenderField;
    disclosurePoseidon.inputs[3] <== suiteCommitment;

    identityCommitment <== identityPoseidon.out;
    disclosureBinding <== disclosurePoseidon.out;
    minterOut <== minter;
}

component main = DisclosureBinding();
