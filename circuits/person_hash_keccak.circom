// person_hash_keccak.circom
// Keccak constraint integration version:
// - Assembles byte stream according to contract getPersonHash serialization rules and computes keccak256(personPreimage)
// - Also computes nameHash = keccak256(fullNameBytes)
// - Outputs publicSignals consistent with addPersonZK: 8×64-bit limbs (person & name, big-endian) + submitter

pragma circom 2.1.5;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "lib/keccak/Keccak256.circom";

// 8-bit range check, pass-through value
template RangeCheck8() {
    signal input in;
    signal output out;
    component bits = Num2Bits(8);
    bits.in <== in; // constrain in < 2^8
    out <== in;
}

// 16-bit range check, pass-through value
template RangeCheck16() {
    signal input in;
    signal output out;
    component bits = Num2Bits(16);
    bits.in <== in; // constrain in < 2^16
    out <== in;
}

// Split uint16 into big-endian two bytes
template Uint16ToBE() {
    signal input v; // < 2^16
    signal output b0; // high byte
    signal output b1; // low byte

    component rc = RangeCheck16();
    rc.in <== v;

    // Decompose 16 bits
    component bits = Num2Bits(16);
    bits.in <== rc.out;

    // Combine high/low bytes
    // b1 = low 8 bits
    b1 <==
        bits.out[0]  + bits.out[1]*2 + bits.out[2]*4 + bits.out[3]*8 +
        bits.out[4]*16 + bits.out[5]*32 + bits.out[6]*64 + bits.out[7]*128;
    // b0 = high 8 bits
    b0 <==
        bits.out[8]  + bits.out[9]*2 + bits.out[10]*4 + bits.out[11]*8 +
        bits.out[12]*16 + bits.out[13]*32 + bits.out[14]*64 + bits.out[15]*128;
}

// Split 32-byte hash (big-endian) into 4×uint64 (high->low)
template Hash32ToFourLimbsBE() {
    signal input hashBytes[32]; // 32 bytes, big-endian
    signal output limbs[4];     // limbs[0] highest 64bit, limbs[3] lowest 64bit

    component be[4];
    for (var i = 0; i < 4; i++) {
        be[i] = Bytes8ToUint64BE();
        for (var j = 0; j < 8; j++) {
            be[i].bytes[j] <== hashBytes[8*i + j];
        }
        limbs[i] <== be[i].value;
    }
}

// Combine 8 big-endian bytes into uint64 (big-endian)
template Bytes8ToUint64BE() {
    signal input bytes[8];
    signal output value; // < 2^64

    component rc[8];
    for (var i = 0; i < 8; i++) {
        rc[i] = RangeCheck8();
        rc[i].in <== bytes[i];
    }

    value <==
        rc[0].out * 72057594037927936 + // 256^7
        rc[1].out * 281474976710656   + // 256^6
        rc[2].out * 1099511627776     + // 256^5
        rc[3].out * 4294967296        + // 256^4
        rc[4].out * 16777216          + // 256^3
        rc[5].out * 65536             + // 256^2
        rc[6].out * 256               + // 256^1
        rc[7].out;                      // 256^0
}

// Main circuit (with Keccak):
// Inputs:
//  - nameLen (1..256), nameBytes[256] (only first nameLen effective)
//  - isBirthBC (0/1), birthYear (uint16), birthMonth (0..12), birthDay (0..31), gender (uint8)
//  - fatherHashBytes[32], motherHashBytes[32]
//  - submitter (uint160 low bits used)
// Outputs: see contract publicSignals mapping
template PersonHashWithKeccak() {
    // ===== Inputs =====
    signal input nameLen;               // 1..256 (contract requires >0 && <=256)
    signal input nameBytes[256];        // bytes, 0..255
    signal input isBirthBC;             // 0/1
    signal input birthYear;             // < 2^16
    signal input birthMonth;            // 0..12 (contract enforced)
    signal input birthDay;              // 0..31 (contract enforced)
    signal input gender;                // 0..255 (product semantics 0..3)
    // Removed parent hashes from public signals; not used in circuit
    signal input submitter;             // only pass-through, on-chain validates low 160 bits

    // ===== Outputs (publicSignals) =====
    signal output person_limb0; // 0
    signal output person_limb1; // 1
    signal output person_limb2; // 2
    signal output person_limb3; // 3
    signal output name_limb0;   // 4
    signal output name_limb1;   // 5
    signal output name_limb2;   // 6
    signal output name_limb3;   // 7
    signal output submitter_out; // 8+1 index in public signals

    // ===== Range checks =====
    // nameLen < 2^16 (bit width) + enforce 1..256 to exactly match contract getPersonHash
    component rcNameLen = RangeCheck16();
    rcNameLen.in <== nameLen;

    // Enforce nameLen <= 256
    component ltNameMax = LessThan(16);
    ltNameMax.in[0] <== nameLen;
    ltNameMax.in[1] <== 257; // nameLen < 257  => nameLen <= 256
    ltNameMax.out == 1;

    // Enforce nameLen != 0  (i.e., >=1)
    component isNameZero = IsZero();
    isNameZero.in <== nameLen;
    isNameZero.out == 0;

    // Each nameBytes[i] is in 0..255
    component rcNameBytes[256];
    for (var i = 0; i < 256; i++) {
        rcNameBytes[i] = RangeCheck8();
        rcNameBytes[i].in <== nameBytes[i];
    }

    // isBirthBC binarization
    component isBit = Num2Bits(1);
    isBit.in <== isBirthBC;

    // birthYear 16 bits
    component rcBY = RangeCheck16();
    rcBY.in <== birthYear;

    // Other fields 8 bits (+ contract domain constraints)
    component rcBM = RangeCheck8(); rcBM.in <== birthMonth;
    component rcBD = RangeCheck8(); rcBD.in <== birthDay;
    component rcG  = RangeCheck8(); rcG.in  <== gender;

    // Enforce birthMonth <= 12
    component ltBM = LessThan(8);
    ltBM.in[0] <== birthMonth;
    ltBM.in[1] <== 13; // birthMonth < 13 => <= 12
    ltBM.out == 1;

    // Enforce birthDay <= 31
    component ltBD = LessThan(8);
    ltBD.in[0] <== birthDay;
    ltBD.in[1] <== 32; // birthDay < 32 => <= 31
    ltBD.out == 1;

    // ===== personPreimage assembly (variable length, max 264 bytes), directly construct Keccak input by position =====
    // personPreLen = nameLen + 8
    signal personPreLen;
    personPreLen <== nameLen + 8;

    // nameLen's BE two bytes
    component nameLenBE = Uint16ToBE();
    nameLenBE.v <== nameLen;

    // birthYear BE two bytes
    component byBE = Uint16ToBE();
    byBE.v <== birthYear;

    // Input construction for keccak(personPre[0..personPreLen-1]):
    component kPerson = Keccak256Var(264);
    kPerson.len <== personPreLen;

    // Construct input bytes for each position t:
    for (var t = 0; t < 264; t++) {
        // t as signal for comparison
        signal tSig;
        tSig <== t;

        // Option 1: t==0 -> b0, t==1 -> b1
        component eqT0 = IsEqual(); eqT0.in[0] <== tSig; eqT0.in[1] <== 0;
        component eqT1 = IsEqual(); eqT1.in[0] <== tSig; eqT1.in[1] <== 1;

        // Option 2: name interval [2 .. 2+nameLen-1]
        // We construct sum_i ( [t==2+i] * [i < nameLen] * nameBytes[i] )
        signal nameByteSum;
        nameByteSum <== 0;
        for (var i = 0; i < 256; i++) {
            signal iSig; iSig <== i;
            // eq(t, 2+i)
            component eqPos = IsEqual(); eqPos.in[0] <== tSig; eqPos.in[1] <== (2 + i);
            // i < nameLen
            component lt = LessThan(16);
            lt.in[0] <== iSig;   // i
            lt.in[1] <== nameLen;
            // accumulate
            nameByteSum <== nameByteSum + nameBytes[i] * eqPos.out * lt.out;
        }

        // Option 3: trailing fields by dynamic offset
        // t == 2+nameLen -> isBirthBC
        signal nameLenPlus2; nameLenPlus2 <== nameLen + 2;
        component eqIs = IsEqual(); eqIs.in[0] <== tSig; eqIs.in[1] <== nameLenPlus2;

        // t == 3+nameLen -> birthYear BE high byte
        signal nameLenPlus3; nameLenPlus3 <== nameLen + 3;
        component eqBY0 = IsEqual(); eqBY0.in[0] <== tSig; eqBY0.in[1] <== nameLenPlus3;

        // t == 4+nameLen -> birthYear BE low byte
        signal nameLenPlus4; nameLenPlus4 <== nameLen + 4;
        component eqBY1 = IsEqual(); eqBY1.in[0] <== tSig; eqBY1.in[1] <== nameLenPlus4;

        // t == 5+nameLen -> birthMonth
        signal nameLenPlus5; nameLenPlus5 <== nameLen + 5;
        component eqBM = IsEqual(); eqBM.in[0] <== tSig; eqBM.in[1] <== nameLenPlus5;

        // t == 6+nameLen -> birthDay
        signal nameLenPlus6; nameLenPlus6 <== nameLen + 6;
        component eqBD = IsEqual(); eqBD.in[0] <== tSig; eqBD.in[1] <== nameLenPlus6;

        // t == 7+nameLen -> gender
        signal nameLenPlus7; nameLenPlus7 <== nameLen + 7;
        component eqG = IsEqual(); eqG.in[0] <== tSig; eqG.in[1] <== nameLenPlus7;

        // Aggregation:
        // value = sel(t==0)*b0 + sel(t==1)*b1 + nameByteSum + sel(t==2+len)*isBirthBC + sel(t==3+len)*by0 + ... + sel(t==7+len)*gender
        kPerson.in[t] <== eqT0.out * nameLenBE.b0
                        + eqT1.out * nameLenBE.b1
                        + nameByteSum
                        + eqIs.out  * isBirthBC
                        + eqBY0.out * byBE.b0
                        + eqBY1.out * byBE.b1
                        + eqBM.out  * birthMonth
                        + eqBD.out  * birthDay
                        + eqG.out   * gender;
    }

    // name-only keccak: directly reuse first nameLen bytes of nameBytes
    component kName = Keccak256Var(256);
    kName.len <== nameLen;
    for (var u = 0; u < 256; u++) { kName.in[u] <== nameBytes[u]; }

    // ===== limbs splitting and output =====
    component p = Hash32ToFourLimbsBE();
    for (var a = 0; a < 32; a++) { p.hashBytes[a] <== kPerson.out[a]; }
    person_limb0 <== p.limbs[0];
    person_limb1 <== p.limbs[1];
    person_limb2 <== p.limbs[2];
    person_limb3 <== p.limbs[3];

    component n = Hash32ToFourLimbsBE();
    for (var b = 0; b < 32; b++) { n.hashBytes[b] <== kName.out[b]; }
    name_limb0 <== n.limbs[0];
    name_limb1 <== n.limbs[1];
    name_limb2 <== n.limbs[2];
    name_limb3 <== n.limbs[3];

    submitter_out <== submitter;
}

component main = PersonHashWithKeccak();


