pragma circom 2.2.3;

// Authorize one identity counter increment. The state contract checks the live
// counter and updates its own dictionary; the proof never carries a tree path.
include "lib/identity.circom";

template ShieldedIdentityAuthorizationUpdate() {
    signal output authNullifier;
    signal input chainId;
    signal input consumer;
    signal input aliasR;
    signal input oldCounter;
    signal input newCounter;

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
    component nonzeroSecret = IsZero();
    nonzeroSecret.in <== derivedSecretField;
    nonzeroSecret.out === 0;
    component canonicalAlias = Poseidon(3);
    canonicalAlias.inputs[0] <== 202610210001;
    canonicalAlias.inputs[1] <== identity.identityCommitment;
    canonicalAlias.inputs[2] <== derivedSecretField;
    canonicalAlias.out === aliasR;
    component aliasZero = IsZero();
    aliasZero.in <== aliasR;
    aliasZero.out === 0;

    component chainBits = Num2Bits(64);
    chainBits.in <== chainId;
    component consumerBits = Num2Bits(160);
    consumerBits.in <== consumer;
    component chainZero = IsZero();
    chainZero.in <== chainId;
    chainZero.out === 0;
    component consumerZero = IsZero();
    consumerZero.in <== consumer;
    consumerZero.out === 0;
    component oldBits = Num2Bits(64);
    oldBits.in <== oldCounter;
    component newBits = Num2Bits(64);
    newBits.in <== newCounter;
    // Both operands are uint64: this cannot be satisfied by field wrapping or
    // uint64 overflow. In particular MAX_UINT64 cannot be incremented.
    newCounter === oldCounter + 1;
    // Makes actual chain/address part of the authorization relation, rather
    // than merely declaring unused public context. Alias distinguishes
    // identities even if a synthetic fixture reuses an identity-derived secret.
    component authorization = Poseidon(6);
    authorization.inputs[0] <== 202610210201;
    authorization.inputs[1] <== derivedSecretField;
    authorization.inputs[2] <== aliasR;
    authorization.inputs[3] <== chainId;
    authorization.inputs[4] <== consumer;
    authorization.inputs[5] <== oldCounter;
    authNullifier <== authorization.out;
    component authorizationZero = IsZero();
    authorizationZero.in <== authNullifier;
    authorizationZero.out === 0;
}

component main {
    public [chainId, consumer, aliasR, oldCounter, newCounter]
} = ShieldedIdentityAuthorizationUpdate();
