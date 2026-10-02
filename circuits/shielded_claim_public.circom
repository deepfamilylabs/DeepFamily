pragma circom 2.2.3;

include "lib/identity.circom";

// Public budget eligibility and sequential period accounting are checked by the
// pool. This proof binds their payout to the beneficiary's identity secret.
template ShieldedClaimPublic() {
    signal input chainId;
    signal input pool;
    signal input budgetId;
    signal input heirIdentityCommitment;
    signal input firstPeriod;
    signal input claimCount;
    signal input amount;
    signal input outputCommitments[2];
    signal input ciphertextHashes[2];

    signal input nameField;
    signal input derivedSecretField;
    signal input isBirthBC;
    signal input birthYear;
    signal input birthMonth;
    signal input birthDay;
    signal input gender;
    signal input suiteId;
    signal input outputNonces[2];

    component chainBits = Num2Bits(64);
    chainBits.in <== chainId;
    component poolBits = Num2Bits(160);
    poolBits.in <== pool;
    component budgetBits = Num2Bits(64);
    budgetBits.in <== budgetId;
    component budgetNonzero = IsZero();
    budgetNonzero.in <== budgetId;
    budgetNonzero.out === 0;
    component periodBits = Num2Bits(64);
    periodBits.in <== firstPeriod;
    component endPeriodBits = Num2Bits(64);
    endPeriodBits.in <== firstPeriod + claimCount;
    component countBits = Num2Bits(4);
    countBits.in <== claimCount;
    component countPositive = LessThan(4);
    countPositive.in[0] <== 0;
    countPositive.in[1] <== claimCount;
    countPositive.out === 1;
    component countBound = LessEqThan(4);
    countBound.in[0] <== claimCount;
    countBound.in[1] <== 12;
    countBound.out === 1;
    component amountBits = Num2Bits(128);
    amountBits.in <== amount;
    component amountNonzero = IsZero();
    amountNonzero.in <== amount;
    amountNonzero.out === 0;
    component secretNonzero = IsZero();
    secretNonzero.in <== derivedSecretField;
    secretNonzero.out === 0;

    component suite = AtomicSuiteCommitment();
    suite.suiteId <== suiteId;
    component heir = IdentityCommitmentCore();
    heir.nameField <== nameField;
    heir.derivedSecretField <== derivedSecretField;
    heir.isBirthBC <== isBirthBC;
    heir.birthYear <== birthYear;
    heir.birthMonth <== birthMonth;
    heir.birthDay <== birthDay;
    heir.gender <== gender;
    heir.suiteCommitment <== suite.suiteCommitment;
    heir.identityCommitment === heirIdentityCommitment;
    component ownerSecret = Poseidon(2);
    ownerSecret.inputs[0] <== 1012;
    ownerSecret.inputs[1] <== derivedSecretField;
    component owner = Poseidon(2);
    owner.inputs[0] <== 1013;
    owner.inputs[1] <== ownerSecret.out;

    component nonceNonzero[2];
    component notes[2];
    for (var i = 0; i < 2; i++) {
        nonceNonzero[i] = IsZero();
        nonceNonzero[i].in <== outputNonces[i];
        nonceNonzero[i].out === 0;
        notes[i] = Poseidon(5);
        notes[i].inputs[0] <== 1014;
        notes[i].inputs[1] <== owner.out;
        notes[i].inputs[2] <== i == 0 ? amount : 0;
        notes[i].inputs[3] <== outputNonces[i];
        notes[i].inputs[4] <== ciphertextHashes[i];
        notes[i].out === outputCommitments[i];
    }
}

component main {public [chainId, pool, budgetId, heirIdentityCommitment,
    firstPeriod, claimCount, amount, outputCommitments, ciphertextHashes]} = ShieldedClaimPublic();
