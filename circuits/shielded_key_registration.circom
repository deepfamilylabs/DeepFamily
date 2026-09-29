pragma circom 2.2.3;

include "lib/identity.circom";

// Public signals, in registry verifier ABI order:
// ownerCommitment, viewKeyLo, viewKeyHi, chainId, registryAddress,
// registrationTag, registrationLeaf.
//
// The private identity passphrase-derived secret authorizes the selected viewing key.
// Neither the identity commitment nor its person hash is a public signal.
// X25519 key generation itself happens locally; the circuit binds the selected
// public key to this proof so its public signals cannot be replaced in flight.
template ShieldedKeyRegistration() {
    signal input ownerCommitment;
    signal input viewKeyLo;
    signal input viewKeyHi;
    signal input chainId;
    signal input registryAddress;
    signal input registrationTag;
    signal input registrationLeaf;

    signal input identityCommitment;
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
    component chainBits = Num2Bits(64);
    chainBits.in <== chainId;
    component addressBits = Num2Bits(160);
    addressBits.in <== registryAddress;

    component tag = Poseidon(5);
    tag.inputs[0] <== 1022;
    tag.inputs[1] <== derivedSecretField;
    tag.inputs[2] <== identityCommitment;
    tag.inputs[3] <== chainId;
    tag.inputs[4] <== registryAddress;
    tag.out === registrationTag;

    component salt = Poseidon(5);
    salt.inputs[0] <== 1029;
    salt.inputs[1] <== derivedSecretField;
    salt.inputs[2] <== identityCommitment;
    salt.inputs[3] <== chainId;
    salt.inputs[4] <== registryAddress;
    component saltNonzero = IsZero();
    saltNonzero.in <== salt.out;
    saltNonzero.out === 0;

    component leaf = Poseidon(6);
    leaf.inputs[0] <== 1023;
    leaf.inputs[1] <== identityCommitment;
    leaf.inputs[2] <== ownerCommitment;
    leaf.inputs[3] <== viewKeyHi;
    leaf.inputs[4] <== viewKeyLo;
    leaf.inputs[5] <== salt.out;
    leaf.out === registrationLeaf;
}

component main {
    public [
        ownerCommitment,
        viewKeyLo,
        viewKeyHi,
        chainId,
        registryAddress,
        registrationTag,
        registrationLeaf
    ]
} = ShieldedKeyRegistration();
