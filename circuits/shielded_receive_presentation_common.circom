pragma circom 2.2.3;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Canonical compressed authorization dictionary. Keys follow little-endian
// paths; a zero counter proves absence rather than a stored zero-valued leaf.
template ShieldedReceiveCounterLookup() {
    signal input authorizationAlias;
    signal input authorizationCounter;
    signal input stateRoot;
    signal input depth;
    signal input siblings[64];
    signal input oldKey;
    signal input oldValue;
    signal input isOld0;
    signal input absent;

    absent * (1 - absent) === 0;
    isOld0 * (1 - isOld0) === 0;
    component counterZero = IsZero();
    counterZero.in <== authorizationCounter;
    absent === counterZero.out;
    signal present <== 1 - absent;
    present * isOld0 === 0;
    present * (oldKey - authorizationAlias) === 0;
    present * (oldValue - authorizationCounter) === 0;
    signal empty <== absent * isOld0;
    empty * oldKey === 0;
    empty * oldValue === 0;
    signal collision <== absent * (1 - isOld0);
    component oldAliasEqual = IsEqual();
    oldAliasEqual.in[0] <== oldKey;
    oldAliasEqual.in[1] <== authorizationAlias;
    collision * oldAliasEqual.out === 0;
    component oldKeyZero = IsZero();
    oldKeyZero.in <== oldKey;
    collision * oldKeyZero.out === 0;
    component oldValueZero = IsZero();
    oldValueZero.in <== oldValue;
    collision * oldValueZero.out === 0;

    component aliasBits = Num2Bits_strict();
    aliasBits.in <== authorizationAlias;
    component oldKeyBits = Num2Bits_strict();
    oldKeyBits.in <== oldKey;
    component depthBits = Num2Bits(7);
    depthBits.in <== depth;
    component depthIs[65];
    var depthSum = 0;
    for (var i = 0; i <= 64; i++) {
        depthIs[i] = IsEqual();
        depthIs[i].in[0] <== depth;
        depthIs[i].in[1] <== i;
        depthSum += depthIs[i].out;
    }
    depthSum === 1;

    component oldLeaf = Poseidon(3);
    oldLeaf.inputs[0] <== oldKey;
    oldLeaf.inputs[1] <== oldValue;
    oldLeaf.inputs[2] <== 1;
    component currentLeaf = Poseidon(3);
    currentLeaf.inputs[0] <== authorizationAlias;
    currentLeaf.inputs[1] <== authorizationCounter;
    currentLeaf.inputs[2] <== 1;
    signal absentLeaf <== (1 - isOld0) * oldLeaf.out;
    signal current[65];
    current[64] <== currentLeaf.out + absent * (absentLeaf - currentLeaf.out);
    signal active[64];
    signal collisionActive[64];
    signal left[64];
    signal right[64];
    component siblingZero[64];
    component branch[64];
    for (var i = 63; i >= 0; i--) {
        var activeSum = 0;
        for (var j = i + 1; j <= 64; j++) activeSum += depthIs[j].out;
        active[i] <== activeSum;
        // Padding never contributes another representation of the same path.
        (1 - active[i]) * siblings[i] === 0;
        collisionActive[i] <== collision * active[i];
        collisionActive[i] * (aliasBits.out[i] - oldKeyBits.out[i]) === 0;
        siblingZero[i] = IsZero();
        siblingZero[i].in <== siblings[i];
        // Stop at the deepest nonzero sibling; redundant unary suffixes fail.
        depthIs[i + 1].out * siblingZero[i].out === 0;
        left[i] <== current[i + 1] + aliasBits.out[i] * (siblings[i] - current[i + 1]);
        right[i] <== siblings[i] + aliasBits.out[i] * (current[i + 1] - siblings[i]);
        branch[i] = Poseidon(2);
        branch[i].inputs[0] <== left[i];
        branch[i].inputs[1] <== right[i];
        current[i] <== current[i + 1] + active[i] * (branch[i].out - current[i + 1]);
    }
    current[0] === stateRoot;
}

// A compact fund-budget note path. Its fixed padding and index range match the
// original receipt relation, including synthetic paths at the full depth 32.
template ShieldedReceiveBudgetLookup() {
    signal input leaf;
    signal input root;
    signal input depth;
    signal input index;
    signal input siblings[32];
    component depthBits = Num2Bits(6);
    depthBits.in <== depth;
    component indexBits = Num2Bits(32);
    indexBits.in <== index;
    component depthIs[33];
    var depthSum = 0;
    for (var i = 0; i <= 32; i++) {
        depthIs[i] = IsEqual();
        depthIs[i].in[0] <== depth;
        depthIs[i].in[1] <== i;
        depthSum += depthIs[i].out;
    }
    depthSum === 1;
    signal current[33];
    current[0] <== leaf;
    signal active[32];
    signal left[32];
    signal right[32];
    component branch[32];
    for (var i = 0; i < 32; i++) {
        var activeSum = 0;
        for (var j = i + 1; j <= 32; j++) activeSum += depthIs[j].out;
        active[i] <== activeSum;
        (1 - active[i]) * siblings[i] === 0;
        (1 - active[i]) * indexBits.out[i] === 0;
        left[i] <== current[i] + indexBits.out[i] * (siblings[i] - current[i]);
        right[i] <== siblings[i] + indexBits.out[i] * (current[i] - siblings[i]);
        branch[i] = Poseidon(2);
        branch[i].inputs[0] <== left[i];
        branch[i].inputs[1] <== right[i];
        current[i + 1] <== current[i] + active[i] * (branch[i].out - current[i]);
    }
    current[32] === root;
}

// KIND: 1 anonymous (letters or transfers), 2 Fund, 3 attached letters.
// The issuer's exact public statement is the first output prefix. It is linked
// privately to the issuer Groth16 proof by the external verifier; this circuit
// alone does not authenticate an issuer. Only the operation suffix is public
// on chain. Keeping that boundary outside the circuit avoids recursive pairing.
template ShieldedReceivePresentation(KIND) {
    assert(KIND == 1 || KIND == 2 || KIND == 3);
    var OFFSET = 0;
    if (KIND == 2) OFFSET = 1;
    var CREDENTIAL_COUNT = 11 + OFFSET;
    var OPERATION_COUNT = 11;
    if (KIND == 3) OPERATION_COUNT = 14;
    signal output credentialSignals[CREDENTIAL_COUNT];
    signal output operationSignals[OPERATION_COUNT];
    signal input credentialPublicSignals[CREDENTIAL_COUNT];
    signal input chainId;
    signal input consumer;
    signal input action;
    signal input messageId;
    signal input cipherLo;
    signal input cipherHi;
    signal input checkpointId;
    signal input stateRoot;
    signal input asOf;
    signal input expiresAt;
    signal input binding;
    signal input salt;
    signal input depth;
    signal input siblings[64];
    signal input oldKey;
    signal input oldValue;
    signal input isOld0;
    signal input absent;
    for (var i = 0; i < CREDENTIAL_COUNT; i++)
        credentialSignals[i] <== credentialPublicSignals[i];
    operationSignals[0] <== chainId;
    operationSignals[1] <== consumer;
    operationSignals[2] <== action;
    operationSignals[3] <== messageId;
    operationSignals[4] <== cipherLo;
    operationSignals[5] <== cipherHi;
    operationSignals[6] <== checkpointId;
    operationSignals[7] <== stateRoot;
    operationSignals[8] <== asOf;
    operationSignals[9] <== expiresAt;
    operationSignals[10] <== binding;

    signal alias <== credentialPublicSignals[0];
    signal counter <== credentialPublicSignals[1];
    signal owner <== credentialPublicSignals[3 + OFFSET];
    signal viewLo <== credentialPublicSignals[4 + OFFSET];
    signal viewHi <== credentialPublicSignals[5 + OFFSET];
    signal mode <== credentialPublicSignals[6 + OFFSET];
    expiresAt === credentialPublicSignals[2];
    // Restate the issuer's fixed suite and key bounds so every prefix field
    // participates in the presentation's public verification-key relation.
    mode * (1 - mode) === 0;
    credentialPublicSignals[7 + OFFSET] === 1;
    credentialPublicSignals[8 + OFFSET] === 1;
    credentialPublicSignals[9 + OFFSET] === 1;
    credentialPublicSignals[10 + OFFSET] === 2;
    component viewLoBits = Num2Bits(128);
    viewLoBits.in <== viewLo;
    component viewHiBits = Num2Bits(128);
    viewHiBits.in <== viewHi;
    component viewZero = IsZero();
    viewZero.in <== viewLo + viewHi;
    viewZero.out === 0;
    signal uint64Values[5];
    uint64Values[0] <== chainId;
    uint64Values[1] <== asOf;
    uint64Values[2] <== expiresAt;
    uint64Values[3] <== counter;
    uint64Values[4] <== oldValue;
    component uint64Bits[5];
    for (var i = 0; i < 5; i++) {
        uint64Bits[i] = Num2Bits(64);
        uint64Bits[i].in <== uint64Values[i];
    }
    component beforeExpiry = LessThan(64);
    beforeExpiry.in[0] <== asOf;
    beforeExpiry.in[1] <== expiresAt;
    beforeExpiry.out === 1;
    component consumerBits = Num2Bits(160);
    consumerBits.in <== consumer;
    component messageBits = Num2Bits(128);
    messageBits.in <== messageId;
    component cipherLoBits = Num2Bits(128);
    cipherLoBits.in <== cipherLo;
    component cipherHiBits = Num2Bits(128);
    cipherHiBits.in <== cipherHi;
    signal requiredNonzero[8];
    requiredNonzero[0] <== chainId;
    requiredNonzero[1] <== consumer;
    requiredNonzero[2] <== checkpointId;
    requiredNonzero[3] <== salt;
    requiredNonzero[4] <== binding;
    requiredNonzero[5] <== alias;
    requiredNonzero[6] <== owner;
    requiredNonzero[7] <== expiresAt;
    component nonzero[8];
    for (var i = 0; i < 8; i++) {
        nonzero[i] = IsZero();
        nonzero[i].in <== requiredNonzero[i];
        nonzero[i].out === 0;
    }
    if (KIND == 1) {
        (action - 1) * (action - 4) === 0;
        signal outputSlotBoolean <== messageId * (messageId - 1);
        (action - 1) * outputSlotBoolean === 0;
    } else if (KIND == 2) {
        action === 3;
        messageId * (1 - messageId) === 0;
    } else {
        action === 2;
    }

    component lookup = ShieldedReceiveCounterLookup();
    lookup.authorizationAlias <== alias;
    lookup.authorizationCounter <== counter;
    lookup.stateRoot <== stateRoot;
    lookup.depth <== depth;
    lookup.oldKey <== oldKey;
    lookup.oldValue <== oldValue;
    lookup.isOld0 <== isOld0;
    lookup.absent <== absent;
    for (var i = 0; i < 64; i++) lookup.siblings[i] <== siblings[i];
    component bindingFirst = Poseidon(3);
    bindingFirst.inputs[0] <== 202610210102;
    bindingFirst.inputs[1] <== alias;
    bindingFirst.inputs[2] <== owner;
    component bindingSecond = Poseidon(3);
    bindingSecond.inputs[0] <== bindingFirst.out;
    bindingSecond.inputs[1] <== mode;
    bindingSecond.inputs[2] <== viewLo;
    component bindingThird = Poseidon(3);
    bindingThird.inputs[0] <== bindingSecond.out;
    bindingThird.inputs[1] <== viewHi;
    bindingThird.inputs[2] <== salt;
    if (KIND == 2) {
        component fundBinding = Poseidon(3);
        fundBinding.inputs[0] <== 202610220102;
        fundBinding.inputs[1] <== bindingThird.out;
        fundBinding.inputs[2] <== credentialPublicSignals[3];
        binding === fundBinding.out;
    } else {
        binding === bindingThird.out;
    }

    if (KIND == 3) {
        signal input budgetPool;
        signal input budgetRoot;
        signal input relation;
        signal input budgetPolicy;
        signal input budgetEnrollment;
        signal input budgetRate;
        signal input budgetRemaining;
        signal input budgetNonce;
        signal input budgetCiphertextHash;
        signal input budgetDepth;
        signal input budgetIndex;
        signal input budgetSiblings[32];
        operationSignals[11] <== budgetPool;
        operationSignals[12] <== budgetRoot;
        operationSignals[13] <== relation;
        component poolBits = Num2Bits(160);
        poolBits.in <== budgetPool;
        component rateBits = Num2Bits(128);
        rateBits.in <== budgetRate;
        component remainingBits = Num2Bits(128);
        remainingBits.in <== budgetRemaining;
        signal budgetNonzeroValues[7];
        budgetNonzeroValues[0] <== budgetPool;
        budgetNonzeroValues[1] <== budgetRoot;
        budgetNonzeroValues[2] <== relation;
        budgetNonzeroValues[3] <== budgetPolicy;
        budgetNonzeroValues[4] <== budgetEnrollment;
        budgetNonzeroValues[5] <== budgetRate;
        budgetNonzeroValues[6] <== budgetNonce;
        component budgetNonzero[7];
        for (var i = 0; i < 7; i++) {
            budgetNonzero[i] = IsZero();
            budgetNonzero[i].in <== budgetNonzeroValues[i];
            budgetNonzero[i].out === 0;
        }
        component scope = Poseidon(3);
        scope.inputs[0] <== 1031;
        scope.inputs[1] <== chainId;
        scope.inputs[2] <== budgetPool;
        component authorizationTag = Poseidon(3);
        authorizationTag.inputs[0] <== 1032;
        authorizationTag.inputs[1] <== scope.out;
        authorizationTag.inputs[2] <== 1033;
        component authorization = Poseidon(5);
        authorization.inputs[0] <== authorizationTag.out;
        authorization.inputs[1] <== owner;
        authorization.inputs[2] <== mode;
        authorization.inputs[3] <== viewLo;
        authorization.inputs[4] <== viewHi;
        component fundTag = Poseidon(3);
        fundTag.inputs[0] <== 1032;
        fundTag.inputs[1] <== scope.out;
        fundTag.inputs[2] <== 202610210301;
        component leaf = Poseidon(8);
        leaf.inputs[0] <== fundTag.out;
        leaf.inputs[1] <== budgetPolicy;
        leaf.inputs[2] <== budgetEnrollment;
        leaf.inputs[3] <== authorization.out;
        leaf.inputs[4] <== budgetRate;
        leaf.inputs[5] <== budgetRemaining;
        leaf.inputs[6] <== budgetNonce;
        leaf.inputs[7] <== budgetCiphertextHash;
        component leafZero = IsZero();
        leafZero.in <== leaf.out;
        leafZero.out === 0;
        component budgetLookup = ShieldedReceiveBudgetLookup();
        budgetLookup.leaf <== leaf.out;
        budgetLookup.root <== budgetRoot;
        budgetLookup.depth <== budgetDepth;
        budgetLookup.index <== budgetIndex;
        for (var i = 0; i < 32; i++) budgetLookup.siblings[i] <== budgetSiblings[i];
        component reference = Poseidon(3);
        reference.inputs[0] <== 202610210401;
        reference.inputs[1] <== budgetPool;
        reference.inputs[2] <== leaf.out;
        component attachmentRelation = Poseidon(3);
        attachmentRelation.inputs[0] <== reference.out;
        attachmentRelation.inputs[1] <== binding;
        attachmentRelation.inputs[2] <== salt;
        relation === attachmentRelation.out;
    }
}
