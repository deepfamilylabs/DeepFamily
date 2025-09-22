// person_hash_zk.circom
// Production version using fullNameHash (32 bytes) - solves variable length problem completely
pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/mux1.circom";
include "circomlib/circuits/poseidon.circom";

// Convert uint16 to big-endian bytes
template Uint16ToBytes() {
    signal input v;
    signal output b0; // High byte
    signal output b1; // Low byte
    
    component bits = Num2Bits(16);
    bits.in <== v;
    
    b1 <== bits.out[0] + bits.out[1]*2 + bits.out[2]*4 + bits.out[3]*8 +
           bits.out[4]*16 + bits.out[5]*32 + bits.out[6]*64 + bits.out[7]*128;
    b0 <== bits.out[8] + bits.out[9]*2 + bits.out[10]*4 + bits.out[11]*8 +
           bits.out[12]*16 + bits.out[13]*32 + bits.out[14]*64 + bits.out[15]*128;
}

// Convert 32-byte hash to 2 128-bit limbs
template HashToLimbs() {
    signal input hashBytes[32];
    signal output limb0;
    signal output limb1;
    
    component byteCheck[32];
    for (var i = 0; i < 32; i++) {
        byteCheck[i] = Num2Bits(8);
        byteCheck[i].in <== hashBytes[i];
    }
    
    // High 128 bits
    signal acc0[17];
    acc0[0] <== 0;
    for (var i = 0; i < 16; i++) {
        acc0[i+1] <== acc0[i] * 256 + hashBytes[i];
    }
    limb0 <== acc0[16];
    
    // Low 128 bits
    signal acc1[17];
    acc1[0] <== 0;
    for (var j = 0; j < 16; j++) {
        acc1[j+1] <== acc1[j] * 256 + hashBytes[16 + j];
    }
    limb1 <== acc1[16];
}

// Fixed-length PersonHasher using fullNameHash (32 bytes)
template PersonHasher() {
    signal input fullNameHash[32];  // 32-byte hash of the full name
    signal input isBirthBC;
    signal input birthYear;
    signal input birthMonth;
    signal input birthDay;
    signal input gender;
    
    signal output limb0; // high 128 bits of Poseidon(out)
    signal output limb1; // low 128 bits of Poseidon(out)
    
    // Constraint checks
    component birthMonthCheck = LessEqThan(8); // 8 bits can handle values up to 255
    birthMonthCheck.in[0] <== birthMonth;
    birthMonthCheck.in[1] <== 12;
    birthMonthCheck.out === 1;
    
    component birthDayCheck = LessEqThan(8); // 8 bits can handle values up to 255
    birthDayCheck.in[0] <== birthDay;
    birthDayCheck.in[1] <== 31;
    birthDayCheck.out === 1;
    
    component bcBit = Num2Bits(1);
    bcBit.in <== isBirthBC;
    
    // Convert fullNameHash bytes to two 128-bit field limbs (also validates bytes)
    component nameLimbs = HashToLimbs();
    for (var i = 0; i < 32; i++) {
        nameLimbs.hashBytes[i] <== fullNameHash[i];
    }
    
    // Poseidon commitment over SNARK-friendly field elements
    component poseidon = Poseidon(7);
    poseidon.inputs[0] <== nameLimbs.limb0; // high 128 bits of fullNameHash
    poseidon.inputs[1] <== nameLimbs.limb1; // low 128 bits of fullNameHash
    poseidon.inputs[2] <== isBirthBC;
    poseidon.inputs[3] <== birthYear;
    poseidon.inputs[4] <== birthMonth;
    poseidon.inputs[5] <== birthDay;
    poseidon.inputs[6] <== gender;

    // Split Poseidon output into two 128-bit limbs for public signals
    component outBits = Num2Bits(256);
    outBits.in <== poseidon.out;

    component lowNum = Bits2Num(128);
    for (var k = 0; k < 128; k++) {
        lowNum.in[k] <== outBits.out[k]; // LSB first
    }

    component highNum = Bits2Num(128);
    for (var m = 0; m < 128; m++) {
        highNum.in[m] <== outBits.out[128 + m];
    }

    limb0 <== highNum.out;
    limb1 <== lowNum.out;
}

// Main test circuit
template PersonHashTest() {
    // Person to be added
    signal input fullNameHash[32];
    signal input isBirthBC;
    signal input birthYear;
    signal input birthMonth;
    signal input birthDay;
    signal input gender;
    
    // Father
    signal input father_fullNameHash[32];
    signal input father_isBirthBC;
    signal input father_birthYear;
    signal input father_birthMonth;
    signal input father_birthDay;
    signal input father_gender;
    
    // Mother
    signal input mother_fullNameHash[32];
    signal input mother_isBirthBC;
    signal input mother_birthYear;
    signal input mother_birthMonth;
    signal input mother_birthDay;
    signal input mother_gender;
    
    // Parent existence flags
    signal input hasFather;
    signal input hasMother;
    
    // Submitter
    signal input submitter;
    
    // Outputs
    signal output person_limb0;
    signal output person_limb1;
    signal output father_limb0;
    signal output father_limb1;
    signal output mother_limb0;
    signal output mother_limb1;
    signal output submitter_out;
    
    // Calculate commitment of person to be added
    component personHasher = PersonHasher();
    for (var i = 0; i < 32; i++) {
        personHasher.fullNameHash[i] <== fullNameHash[i];
    }
    personHasher.isBirthBC <== isBirthBC;
    personHasher.birthYear <== birthYear;
    personHasher.birthMonth <== birthMonth;
    personHasher.birthDay <== birthDay;
    personHasher.gender <== gender;
    
    // Calculate father commitment using PersonHasher
    component fatherHasher = PersonHasher();
    for (var j = 0; j < 32; j++) {
        fatherHasher.fullNameHash[j] <== father_fullNameHash[j];
    }
    fatherHasher.isBirthBC <== father_isBirthBC;
    fatherHasher.birthYear <== father_birthYear;
    fatherHasher.birthMonth <== father_birthMonth;
    fatherHasher.birthDay <== father_birthDay;
    fatherHasher.gender <== father_gender;
    
    // Calculate mother commitment using PersonHasher
    component motherHasher = PersonHasher();
    for (var t = 0; t < 32; t++) {
        motherHasher.fullNameHash[t] <== mother_fullNameHash[t];
    }
    motherHasher.isBirthBC <== mother_isBirthBC;
    motherHasher.birthYear <== mother_birthYear;
    motherHasher.birthMonth <== mother_birthMonth;
    motherHasher.birthDay <== mother_birthDay;
    motherHasher.gender <== mother_gender;
    
    // Validate parent existence flags are 0 or 1
    component fatherBitCheck = Num2Bits(1);
    component motherBitCheck = Num2Bits(1);
    fatherBitCheck.in <== hasFather;
    motherBitCheck.in <== hasMother;
    
    // Use Mux1 to conditionally output parent commitments (limbs)
    component fatherSelect0 = Mux1();
    component fatherSelect1 = Mux1();
    component motherSelect0 = Mux1();
    component motherSelect1 = Mux1();
    
    fatherSelect0.c[0] <== 0;  // Output 0 if father doesn't exist
    fatherSelect0.c[1] <== fatherHasher.limb0;  // Output computed if father exists
    fatherSelect0.s <== hasFather;
    
    fatherSelect1.c[0] <== 0;
    fatherSelect1.c[1] <== fatherHasher.limb1;
    fatherSelect1.s <== hasFather;
    
    motherSelect0.c[0] <== 0;  // Output 0 if mother doesn't exist
    motherSelect0.c[1] <== motherHasher.limb0;  // Output computed if mother exists
    motherSelect0.s <== hasMother;
    
    motherSelect1.c[0] <== 0;
    motherSelect1.c[1] <== motherHasher.limb1;
    motherSelect1.s <== hasMother;
    
    // Final outputs
    person_limb0 <== personHasher.limb0;
    person_limb1 <== personHasher.limb1;
    father_limb0 <== fatherSelect0.out;
    father_limb1 <== fatherSelect1.out;
    mother_limb0 <== motherSelect0.out;
    mother_limb1 <== motherSelect1.out;
    submitter_out <== submitter;
}

component main = PersonHashTest();