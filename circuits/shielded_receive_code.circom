pragma circom 2.2.3;

include "lib/identity.circom";

// A receive code proves that the holder of identityCommitment chose these payment
// keys: ownerCommitment derives from the same private identity secret, and the
// X25519 viewing key is bound to the proof so it cannot be replaced in transit.
// Payers verify the proof in the browser; there is no on-chain verifier or registry.
// Neither key depends on the chain or pool, so one code serves every deployment.
// The viewing key itself is generated locally; the circuit proves the identity
// holder authorized it, not how it was derived.
template ShieldedReceiveCode() {
    signal input identityCommitment;
    signal input ownerCommitment;
    signal input viewKeyLo;
    signal input viewKeyHi;

    signal input nameField;
    signal input derivedSecretField;
    signal input isBirthBC;
    signal input birthYear;
    signal input birthMonth;
    signal input birthDay;
    signal input gender;
    signal input suiteId;

    component suite = AtomicSuiteCommitment();
    suite.suiteId <== suiteId;

    component identity = IdentityCommitmentCore();
    identity.nameField <== nameField;
    identity.derivedSecretField <== derivedSecretField;
    identity.isBirthBC <== isBirthBC;
    identity.birthYear <== birthYear;
    identity.birthMonth <== birthMonth;
    identity.birthDay <== birthDay;
    identity.gender <== gender;
    identity.suiteCommitment <== suite.suiteCommitment;
    identity.identityCommitment === identityCommitment;

    component secretNonzero = IsZero();
    secretNonzero.in <== derivedSecretField;
    secretNonzero.out === 0;

    component ownerSecret = Poseidon(2);
    ownerSecret.inputs[0] <== 1012;
    ownerSecret.inputs[1] <== derivedSecretField;

    component owner = Poseidon(2);
    owner.inputs[0] <== 1013;
    owner.inputs[1] <== ownerSecret.out;
    owner.out === ownerCommitment;

    component viewLoBits = Num2Bits(128);
    viewLoBits.in <== viewKeyLo;
    component viewHiBits = Num2Bits(128);
    viewHiBits.in <== viewKeyHi;
    component viewNonzero = IsZero();
    viewNonzero.in <== viewKeyLo + viewKeyHi;
    viewNonzero.out === 0;
}

component main {
    public [identityCommitment, ownerCommitment, viewKeyLo, viewKeyHi]
} = ShieldedReceiveCode();
