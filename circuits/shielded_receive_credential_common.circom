pragma circom 2.2.3;

include "lib/identity.circom";

// Issuance authenticates the identity alias, complete receive key, counter and
// expiry. Presentation separately checks the current counter checkpoint and
// binds the credential to an operation. Counter and expiry never change the
// existing spending or decryption key derivation.
template ShieldedReceiveCredential() {
    signal output authorizationAlias;
    signal input authorizationCounter;
    signal input expiresAt;
    signal input identityCommitment;
    signal input ownerCommitment;
    signal input viewKeyLo;
    signal input viewKeyHi;
    signal input keyMode;
    signal input identitySuiteId;
    signal input independentKeySuiteId;
    signal input independentKeyDerivationVersion;
    signal input receiveCodeVersion;
    signal input spendingSecret;

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
    identitySuiteId === suiteId;
    independentKeySuiteId === 1;
    independentKeyDerivationVersion === 1;
    receiveCodeVersion === 1;
    keyMode * (1 - keyMode) === 0;

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

    (1 - keyMode) * (spendingSecret - ownerSecret.out) === 0;
    component spendNonzero = IsZero();
    spendNonzero.in <== spendingSecret;
    spendNonzero.out === 0;
    component owner = Poseidon(2);
    owner.inputs[0] <== 1013;
    owner.inputs[1] <== spendingSecret;
    owner.out === ownerCommitment;

    // Canonical across both purposes and both key modes. Neither spending
    // nor viewing keys enter the alias derivation.
    component aliasHash = Poseidon(3);
    aliasHash.inputs[0] <== 202610210001;
    aliasHash.inputs[1] <== identityCommitment;
    aliasHash.inputs[2] <== derivedSecretField;
    authorizationAlias <== aliasHash.out;
    component counterBits = Num2Bits(64);
    counterBits.in <== authorizationCounter;
    component expiryBits = Num2Bits(64);
    expiryBits.in <== expiresAt;

    component viewLoBits = Num2Bits(128);
    viewLoBits.in <== viewKeyLo;
    component viewHiBits = Num2Bits(128);
    viewHiBits.in <== viewKeyHi;
    component viewNonzero = IsZero();
    viewNonzero.in <== viewKeyLo + viewKeyHi;
    viewNonzero.out === 0;
}
