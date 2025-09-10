// person_hash_zk.circom
// Test version, only supports nameLen=5 (Alice, Bob, etc.)
pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "lib/keccak256.circom";

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

// Fixed-length PersonHasher (nameLen=5)
template PersonHasherFixed5() {
    signal input nameBytes[5];  // Only accepts 5-byte names
    signal input isBirthBC;
    signal input birthYear;
    signal input birthMonth;
    signal input birthDay;
    signal input gender;
    
    signal output hashBytes[32];
    
    // Constraint checks
    component birthMonthCheck = LessThan(8);
    birthMonthCheck.in[0] <== birthMonth;
    birthMonthCheck.in[1] <== 13;
    birthMonthCheck.out === 1;
    
    component birthDayCheck = LessThan(8);
    birthDayCheck.in[0] <== birthDay;
    birthDayCheck.in[1] <== 32;
    birthDayCheck.out === 1;
    
    component bcBit = Num2Bits(1);
    bcBit.in <== isBirthBC;
    
    component nameByteCheck[5];
    for (var i = 0; i < 5; i++) {
        nameByteCheck[i] = Num2Bits(8);
        nameByteCheck[i].in <== nameBytes[i];
    }
    
    // Construct byte conversions
    component nameLenToBytes = Uint16ToBytes();
    nameLenToBytes.v <== 5; // Fixed length 5
    
    component yearToBytes = Uint16ToBytes();
    yearToBytes.v <== birthYear;
    
    // Construct preimage: uint16(5) + nameBytes[5] + uint8(isBirthBC) + uint16(birthYear) + uint8(birthMonth) + uint8(birthDay) + uint8(gender)
    // Total length: 2 + 5 + 1 + 2 + 1 + 1 + 1 = 13 bytes
    
    component keccak = SimpleKeccak(13);
    keccak.in[0] <== nameLenToBytes.b0;  // nameLen high byte
    keccak.in[1] <== nameLenToBytes.b1;  // nameLen low byte
    keccak.in[2] <== nameBytes[0];       // name[0]
    keccak.in[3] <== nameBytes[1];       // name[1]
    keccak.in[4] <== nameBytes[2];       // name[2]
    keccak.in[5] <== nameBytes[3];       // name[3]
    keccak.in[6] <== nameBytes[4];       // name[4]
    keccak.in[7] <== isBirthBC;          // isBirthBC
    keccak.in[8] <== yearToBytes.b0;     // birthYear high byte
    keccak.in[9] <== yearToBytes.b1;     // birthYear low byte
    keccak.in[10] <== birthMonth;        // birthMonth
    keccak.in[11] <== birthDay;          // birthDay
    keccak.in[12] <== gender;            // gender
    
    for (var i = 0; i < 32; i++) {
        hashBytes[i] <== keccak.out[i];
    }
}

// Main test circuit
template PersonHashTest() {
    // Member to be added (fixed nameLen=5)
    signal input nameBytes[5];
    signal input isBirthBC;
    signal input birthYear;
    signal input birthMonth;
    signal input birthDay;
    signal input gender;
    
    // Father (fixed nameLen=3, Bob)
    signal input father_nameBytes[3];
    signal input father_isBirthBC;
    signal input father_birthYear;
    signal input father_birthMonth;
    signal input father_birthDay;
    signal input father_gender;
    
    // Mother (fixed nameLen=5, Carol)
    signal input mother_nameBytes[5];
    signal input mother_isBirthBC;
    signal input mother_birthYear;
    signal input mother_birthMonth;
    signal input mother_birthDay;
    signal input mother_gender;
    
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
    
    // Calculate hash of member to be added (nameLen=5)
    component personHasher = PersonHasherFixed5();
    for (var i = 0; i < 5; i++) {
        personHasher.nameBytes[i] <== nameBytes[i];
    }
    personHasher.isBirthBC <== isBirthBC;
    personHasher.birthYear <== birthYear;
    personHasher.birthMonth <== birthMonth;
    personHasher.birthDay <== birthDay;
    personHasher.gender <== gender;
    
    // Calculate father hash (nameLen=3, needs a Fixed3 version)
    component fatherKeccak = SimpleKeccak(11); // 2+3+6=11
    component fNameLenToBytes = Uint16ToBytes();
    fNameLenToBytes.v <== 3;
    component fYearToBytes = Uint16ToBytes();
    fYearToBytes.v <== father_birthYear;
    
    fatherKeccak.in[0] <== fNameLenToBytes.b0;
    fatherKeccak.in[1] <== fNameLenToBytes.b1;
    fatherKeccak.in[2] <== father_nameBytes[0];
    fatherKeccak.in[3] <== father_nameBytes[1];
    fatherKeccak.in[4] <== father_nameBytes[2];
    fatherKeccak.in[5] <== father_isBirthBC;
    fatherKeccak.in[6] <== fYearToBytes.b0;
    fatherKeccak.in[7] <== fYearToBytes.b1;
    fatherKeccak.in[8] <== father_birthMonth;
    fatherKeccak.in[9] <== father_birthDay;
    fatherKeccak.in[10] <== father_gender;
    
    // Calculate mother hash (nameLen=5)
    component motherHasher = PersonHasherFixed5();
    for (var i = 0; i < 5; i++) {
        motherHasher.nameBytes[i] <== mother_nameBytes[i];
    }
    motherHasher.isBirthBC <== mother_isBirthBC;
    motherHasher.birthYear <== mother_birthYear;
    motherHasher.birthMonth <== mother_birthMonth;
    motherHasher.birthDay <== mother_birthDay;
    motherHasher.gender <== mother_gender;
    
    // Convert to limbs
    component personLimbs = HashToLimbs();
    component fatherLimbs = HashToLimbs();
    component motherLimbs = HashToLimbs();
    
    for (var i = 0; i < 32; i++) {
        personLimbs.hashBytes[i] <== personHasher.hashBytes[i];
        fatherLimbs.hashBytes[i] <== fatherKeccak.out[i];
        motherLimbs.hashBytes[i] <== motherHasher.hashBytes[i];
    }
    
    person_limb0 <== personLimbs.limb0;
    person_limb1 <== personLimbs.limb1;
    father_limb0 <== fatherLimbs.limb0;
    father_limb1 <== fatherLimbs.limb1;
    mother_limb0 <== motherLimbs.limb0;
    mother_limb1 <== motherLimbs.limb1;
    submitter_out <== submitter;
}

component main = PersonHashTest();