// person_hash_keccak.circom
// Keccak constraint integration version:
// - Assembles byte stream according to contract getPersonHash serialization rules and computes keccak256(personPreimage)
// - Also computes nameHash = keccak256(fullNameBytes)
// - Also computes fatherHash/motherHash = keccak256(father/mother basic info)
// - Outputs publicSignals consistent with addPersonZK: 4 hashes × 2×128-bit limbs (big-endian) + submitter

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

// Combine 16 big-endian bytes into uint128 (big-endian)
template Bytes16ToUint128BE() {
    signal input bytes[16];
    signal output value; // < 2^128

    component rc[16];
    for (var i = 0; i < 16; i++) {
        rc[i] = RangeCheck8();
        rc[i].in <== bytes[i];
    }

    // Accumulate: value = (((b0*256 + b1)*256 + b2)*...)
    signal acc[17];
    acc[0] <== 0;
    for (var j = 0; j < 16; j++) {
        // acc[j+1] = acc[j]*256 + rc[j].out
        acc[j+1] <== acc[j] * 256 + rc[j].out;
    }
    value <== acc[16];
}

// Split 32-byte hash (big-endian) into 2×uint128 (high->low)
template Hash32ToTwoLimbsBE() {
    signal input hashBytes[32]; // 32 bytes, big-endian
    signal output limbs[2];     // limbs[0] highest 128bit, limbs[1] lowest 128bit

    component hi = Bytes16ToUint128BE();
    for (var i = 0; i < 16; i++) { hi.bytes[i] <== hashBytes[i]; }
    limbs[0] <== hi.value;

    component lo = Bytes16ToUint128BE();
    for (var j = 0; j < 16; j++) { lo.bytes[j] <== hashBytes[16 + j]; }
    limbs[1] <== lo.value;
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
    // Father basic info (private inputs)
    signal input father_nameLen;
    signal input father_nameBytes[256];
    signal input father_isBirthBC;
    signal input father_birthYear;
    signal input father_birthMonth;
    signal input father_birthDay;
    signal input father_gender;

    // Mother basic info (private inputs)
    signal input mother_nameLen;
    signal input mother_nameBytes[256];
    signal input mother_isBirthBC;
    signal input mother_birthYear;
    signal input mother_birthMonth;
    signal input mother_birthDay;
    signal input mother_gender;
    signal input submitter;             // only pass-through, on-chain validates low 160 bits

    // ===== Outputs (publicSignals) =====
    signal output person_limb0; // 0 (hi128)
    signal output person_limb1; // 1 (lo128)
    signal output name_limb0;   // 2 (hi128)
    signal output name_limb1;   // 3 (lo128)
    signal output father_limb0; // 4 (hi128)
    signal output father_limb1; // 5 (lo128)
    signal output mother_limb0; // 6 (hi128)
    signal output mother_limb1; // 7 (lo128)
    signal output submitter_out; // 8

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

    // Father constraints
    component rcFNameLen = RangeCheck16(); rcFNameLen.in <== father_nameLen;
    component ltFNameMax = LessThan(16); ltFNameMax.in[0] <== father_nameLen; ltFNameMax.in[1] <== 257; ltFNameMax.out == 1;
    component isFNameZero = IsZero(); isFNameZero.in <== father_nameLen; isFNameZero.out == 0;
    component rcFNameBytes[256];
    for (var fi = 0; fi < 256; fi++) { rcFNameBytes[fi] = RangeCheck8(); rcFNameBytes[fi].in <== father_nameBytes[fi]; }
    component fIsBit = Num2Bits(1); fIsBit.in <== father_isBirthBC;
    component rcFBY = RangeCheck16(); rcFBY.in <== father_birthYear;
    component rcFBM = RangeCheck8(); rcFBM.in <== father_birthMonth;
    component rcFBD = RangeCheck8(); rcFBD.in <== father_birthDay;
    component rcFG  = RangeCheck8(); rcFG.in  <== father_gender;
    component ltFBM = LessThan(8); ltFBM.in[0] <== father_birthMonth; ltFBM.in[1] <== 13; ltFBM.out == 1;
    component ltFBD = LessThan(8); ltFBD.in[0] <== father_birthDay; ltFBD.in[1] <== 32; ltFBD.out == 1;

    // Mother constraints
    component rcMNameLen = RangeCheck16(); rcMNameLen.in <== mother_nameLen;
    component ltMNameMax = LessThan(16); ltMNameMax.in[0] <== mother_nameLen; ltMNameMax.in[1] <== 257; ltMNameMax.out == 1;
    component isMNameZero = IsZero(); isMNameZero.in <== mother_nameLen; isMNameZero.out == 0;
    component rcMNameBytes[256];
    for (var mi = 0; mi < 256; mi++) { rcMNameBytes[mi] = RangeCheck8(); rcMNameBytes[mi].in <== mother_nameBytes[mi]; }
    component mIsBit = Num2Bits(1); mIsBit.in <== mother_isBirthBC;
    component rcMBY = RangeCheck16(); rcMBY.in <== mother_birthYear;
    component rcMBM = RangeCheck8(); rcMBM.in <== mother_birthMonth;
    component rcMBD = RangeCheck8(); rcMBD.in <== mother_birthDay;
    component rcMG  = RangeCheck8(); rcMG.in  <== mother_gender;
    component ltMBM = LessThan(8); ltMBM.in[0] <== mother_birthMonth; ltMBM.in[1] <== 13; ltMBM.out == 1;
    component ltMBD = LessThan(8); ltMBD.in[0] <== mother_birthDay; ltMBD.in[1] <== 32; ltMBD.out == 1;

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

    // ===== father preimage & keccak =====
    signal fPersonPreLen; fPersonPreLen <== father_nameLen + 8;
    component fNameLenBE = Uint16ToBE(); fNameLenBE.v <== father_nameLen;
    component fBYBE = Uint16ToBE(); fBYBE.v <== father_birthYear;
    component kFather = Keccak256Var(264); kFather.len <== fPersonPreLen;
    for (var ft = 0; ft < 264; ft++) {
        signal ftSig; ftSig <== ft;
        component feqT0 = IsEqual(); feqT0.in[0] <== ftSig; feqT0.in[1] <== 0;
        component feqT1 = IsEqual(); feqT1.in[0] <== ftSig; feqT1.in[1] <== 1;
        signal fnameByteSum; fnameByteSum <== 0;
        for (var fi2 = 0; fi2 < 256; fi2++) {
            signal fiSig; fiSig <== fi2;
            component feqPos = IsEqual(); feqPos.in[0] <== ftSig; feqPos.in[1] <== (2 + fi2);
            component flt = LessThan(16); flt.in[0] <== fiSig; flt.in[1] <== father_nameLen;
            fnameByteSum <== fnameByteSum + father_nameBytes[fi2] * feqPos.out * flt.out;
        }
        signal fLen2; fLen2 <== father_nameLen + 2; component feqIs = IsEqual(); feqIs.in[0] <== ftSig; feqIs.in[1] <== fLen2;
        signal fLen3; fLen3 <== father_nameLen + 3; component feqBY0 = IsEqual(); feqBY0.in[0] <== ftSig; feqBY0.in[1] <== fLen3;
        signal fLen4; fLen4 <== father_nameLen + 4; component feqBY1 = IsEqual(); feqBY1.in[0] <== ftSig; feqBY1.in[1] <== fLen4;
        signal fLen5; fLen5 <== father_nameLen + 5; component feqBM = IsEqual(); feqBM.in[0] <== ftSig; feqBM.in[1] <== fLen5;
        signal fLen6; fLen6 <== father_nameLen + 6; component feqBD = IsEqual(); feqBD.in[0] <== ftSig; feqBD.in[1] <== fLen6;
        signal fLen7; fLen7 <== father_nameLen + 7; component feqG  = IsEqual(); feqG.in[0]  <== ftSig; feqG.in[1]  <== fLen7;
        kFather.in[ft] <== feqT0.out * fNameLenBE.b0
                        + feqT1.out * fNameLenBE.b1
                        + fnameByteSum
                        + feqIs.out  * father_isBirthBC
                        + feqBY0.out * fBYBE.b0
                        + feqBY1.out * fBYBE.b1
                        + feqBM.out  * father_birthMonth
                        + feqBD.out  * father_birthDay
                        + feqG.out   * father_gender;
    }

    // ===== mother preimage & keccak =====
    signal mPersonPreLen; mPersonPreLen <== mother_nameLen + 8;
    component mNameLenBE = Uint16ToBE(); mNameLenBE.v <== mother_nameLen;
    component mBYBE = Uint16ToBE(); mBYBE.v <== mother_birthYear;
    component kMother = Keccak256Var(264); kMother.len <== mPersonPreLen;
    for (var mt = 0; mt < 264; mt++) {
        signal mtSig; mtSig <== mt;
        component meqT0 = IsEqual(); meqT0.in[0] <== mtSig; meqT0.in[1] <== 0;
        component meqT1 = IsEqual(); meqT1.in[0] <== mtSig; meqT1.in[1] <== 1;
        signal mnameByteSum; mnameByteSum <== 0;
        for (var mi2 = 0; mi2 < 256; mi2++) {
            signal miSig; miSig <== mi2;
            component meqPos = IsEqual(); meqPos.in[0] <== mtSig; meqPos.in[1] <== (2 + mi2);
            component mlt = LessThan(16); mlt.in[0] <== miSig; mlt.in[1] <== mother_nameLen;
            mnameByteSum <== mnameByteSum + mother_nameBytes[mi2] * meqPos.out * mlt.out;
        }
        signal mLen2; mLen2 <== mother_nameLen + 2; component meqIs = IsEqual(); meqIs.in[0] <== mtSig; meqIs.in[1] <== mLen2;
        signal mLen3; mLen3 <== mother_nameLen + 3; component meqBY0 = IsEqual(); meqBY0.in[0] <== mtSig; meqBY0.in[1] <== mLen3;
        signal mLen4; mLen4 <== mother_nameLen + 4; component meqBY1 = IsEqual(); meqBY1.in[0] <== mtSig; meqBY1.in[1] <== mLen4;
        signal mLen5; mLen5 <== mother_nameLen + 5; component meqBM = IsEqual(); meqBM.in[0] <== mtSig; meqBM.in[1] <== mLen5;
        signal mLen6; mLen6 <== mother_nameLen + 6; component meqBD = IsEqual(); meqBD.in[0] <== mtSig; meqBD.in[1] <== mLen6;
        signal mLen7; mLen7 <== mother_nameLen + 7; component meqG  = IsEqual(); meqG.in[0]  <== mtSig; meqG.in[1]  <== mLen7;
        kMother.in[mt] <== meqT0.out * mNameLenBE.b0
                        + meqT1.out * mNameLenBE.b1
                        + mnameByteSum
                        + meqIs.out  * mother_isBirthBC
                        + meqBY0.out * mBYBE.b0
                        + meqBY1.out * mBYBE.b1
                        + meqBM.out  * mother_birthMonth
                        + meqBD.out  * mother_birthDay
                        + meqG.out   * mother_gender;
    }

    // ===== limbs splitting and output =====
    component p = Hash32ToTwoLimbsBE();
    for (var a = 0; a < 32; a++) { p.hashBytes[a] <== kPerson.out[a]; }
    person_limb0 <== p.limbs[0];
    person_limb1 <== p.limbs[1];

    component n = Hash32ToTwoLimbsBE();
    for (var b = 0; b < 32; b++) { n.hashBytes[b] <== kName.out[b]; }
    name_limb0 <== n.limbs[0];
    name_limb1 <== n.limbs[1];

    component fh = Hash32ToTwoLimbsBE();
    for (var c = 0; c < 32; c++) { fh.hashBytes[c] <== kFather.out[c]; }
    father_limb0 <== fh.limbs[0];
    father_limb1 <== fh.limbs[1];

    component mh = Hash32ToTwoLimbsBE();
    for (var d = 0; d < 32; d++) { mh.hashBytes[d] <== kMother.out[d]; }
    mother_limb0 <== mh.limbs[0];
    mother_limb1 <== mh.limbs[1];

    submitter_out <== submitter;
}

component main = PersonHashWithKeccak();


