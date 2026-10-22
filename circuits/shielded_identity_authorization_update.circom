pragma circom 2.2.3;

// Owner-authorized transition of the canonical identity authorization dictionary.
// The consumer checks the actual chain/address and live prior root before use.
include "lib/identity.circom";
include "circomlib/circuits/smt/smtverifier.circom";
include "circomlib/circuits/smt/smtprocessor.circom";

template ShieldedIdentityAuthorizationUpdate() {
    signal output authNullifier;
    signal input chainId;
    signal input consumer;
    signal input aliasR;
    signal input oldRoot;
    signal input newRoot;
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
    signal input siblings[64];
    signal input oldKey;
    signal input oldValue;
    signal input isOld0;

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

    component chainBits = Num2Bits(64);
    chainBits.in <== chainId;
    component consumerBits = Num2Bits(160);
    consumerBits.in <== consumer;
    component oldBits = Num2Bits(64);
    oldBits.in <== oldCounter;
    component newBits = Num2Bits(64);
    newBits.in <== newCounter;
    component oldValueBits = Num2Bits(64);
    oldValueBits.in <== oldValue;
    // Both operands are uint64: this cannot be satisfied by field wrapping or
    // uint64 overflow. In particular MAX_UINT64 cannot be incremented.
    newCounter === oldCounter + 1;
    component initiallyAbsent = IsZero();
    initiallyAbsent.in <== oldCounter;
    signal insert <== initiallyAbsent.out;
    isOld0 * (1 - isOld0) === 0;
    // Canonical dictionary state never explicitly stores zero-valued counters.
    // Zero must prove absence; positive values must prove same-key membership.
    (1 - insert) * isOld0 === 0;
    (1 - insert) * (oldKey - aliasR) === 0;
    (1 - insert) * (oldValue - oldCounter) === 0;
    signal emptyInsert <== insert * isOld0;
    emptyInsert * oldKey === 0;
    emptyInsert * oldValue === 0;

    component prior = SMTVerifier(64);
    prior.enabled <== 1;
    prior.root <== oldRoot;
    prior.key <== aliasR;
    prior.value <== oldCounter;
    prior.oldKey <== oldKey;
    prior.oldValue <== oldValue;
    prior.isOld0 <== isOld0;
    prior.fnc <== insert;

    component process = SMTProcessor(64);
    process.oldRoot <== oldRoot;
    process.oldKey <== oldKey;
    process.oldValue <== oldValue;
    process.isOld0 <== isOld0;
    process.newKey <== aliasR;
    process.newValue <== newCounter;
    process.fnc[0] <== insert;
    process.fnc[1] <== 1 - insert;
    for (var i = 0; i < 64; i++) {
        prior.siblings[i] <== siblings[i];
        process.siblings[i] <== siblings[i];
    }
    process.newRoot === newRoot;

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
}

component main {
    public [chainId, consumer, aliasR, oldRoot, newRoot, oldCounter, newCounter]
} = ShieldedIdentityAuthorizationUpdate();
