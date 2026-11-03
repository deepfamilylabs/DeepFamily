pragma circom 2.2.3;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";

// Shared with receipt presentation. The business proof authenticates the
// recipient in its actual output, while the presentation authenticates the
// same key, alias, expiry and counter. Both verifications are atomic on-chain.
template ShieldedReceiveRecipientBinding() {
    signal input enabled;
    signal input authorizationAlias;
    signal input ownerCommitment;
    signal input keyMode;
    signal input viewKeyLo;
    signal input viewKeyHi;
    signal input salt;
    signal output binding;
    enabled * (1 - enabled) === 0;
    keyMode * (1 - keyMode) === 0;
    (1 - enabled) * authorizationAlias === 0;
    (1 - enabled) * keyMode === 0;
    (1 - enabled) * viewKeyLo === 0;
    (1 - enabled) * viewKeyHi === 0;
    (1 - enabled) * salt === 0;
    component aliasZero = IsZero();
    aliasZero.in <== authorizationAlias;
    enabled * aliasZero.out === 0;
    component saltZero = IsZero();
    saltZero.in <== salt;
    enabled * saltZero.out === 0;
    component viewLoBits = Num2Bits(128);
    viewLoBits.in <== viewKeyLo;
    component viewHiBits = Num2Bits(128);
    viewHiBits.in <== viewKeyHi;
    component viewZero = IsZero();
    viewZero.in <== viewKeyLo + viewKeyHi;
    enabled * viewZero.out === 0;
    component first = Poseidon(3);
    first.inputs[0] <== 202610210102;
    first.inputs[1] <== authorizationAlias;
    first.inputs[2] <== ownerCommitment;
    component second = Poseidon(3);
    second.inputs[0] <== first.out;
    second.inputs[1] <== keyMode;
    second.inputs[2] <== viewKeyLo;
    component third = Poseidon(3);
    third.inputs[0] <== second.out;
    third.inputs[1] <== viewKeyHi;
    third.inputs[2] <== salt;
    binding <== enabled * third.out;
}
