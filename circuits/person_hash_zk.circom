// person_hash_zk.circom
// Production version using fullNameHash (32 bytes) - solves variable length problem completely
pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";


// Convert 32-byte hash to 2 128-bit limbs (secure)
template HashToLimbs() {
    signal input hashBytes[32];
    signal output limb0;
    signal output limb1;

    // Constrain each byte to 8-bit range to prevent commitment breaking attacks
    component byteCheck[32];
    for (var i = 0; i < 32; i++) {
        byteCheck[i] = Num2Bits(8);
        byteCheck[i].in <== hashBytes[i];
    }

    // Build limbs directly from validated byte bits (reuse byteCheck results)
    component limb0Bits = Bits2Num(128);
    component limb1Bits = Bits2Num(128);

    // High 128 bits (bytes 0-15) - match contract: simple big-endian
    for (var i = 0; i < 16; i++) {
        for (var j = 0; j < 8; j++) {
            limb0Bits.in[127 - (i * 8 + j)] <== byteCheck[i].out[7 - j];
        }
    }
    limb0 <== limb0Bits.out;

    // Low 128 bits (bytes 16-31) - match contract: simple big-endian
    for (var i = 0; i < 16; i++) {
        for (var j = 0; j < 8; j++) {
            limb1Bits.in[127 - (i * 8 + j)] <== byteCheck[16 + i].out[7 - j];
        }
    }
    limb1 <== limb1Bits.out;
}

// Person commitment with dual Poseidon outputs and explicit domain separation
template PersonCommitment() {
    signal input fullNameHash[32];  // 32-byte keccak256 hash of the full name
    signal input saltHash[32];      // 32-byte keccak256 hash of the passphrase-derived salt
    signal input isBirthBC;
    signal input birthYear;
    signal input birthMonth;
    signal input birthDay;
    signal input gender;

    signal output primaryLimb0;    // high 128 bits of primary Poseidon output
    signal output primaryLimb1;    // low 128 bits of primary Poseidon output
    signal output secondaryLimb0;  // high 128 bits of secondary Poseidon output
    signal output secondaryLimb1;  // low 128 bits of secondary Poseidon output

    // Domain separation constants hashed from unique protocol labels
    var SALTED_NAME_DOMAIN_PRIMARY = 447621024357665903074632115256704697579070658341564497608043648103041050990;
    var SALTED_NAME_DOMAIN_SECONDARY = 19517420153832580388377732280333130415087647067004616588695803175044816476636;
    var PERSON_DOMAIN_PRIMARY = 8952727929263341476560614559269420251731862389046777805180612664679563964106;
    var PERSON_DOMAIN_SECONDARY = 11756112566277107848988887419345263113767817252051989647464836117592952280515;

    // Range constraints for demographic inputs
    component birthYearCheck = Num2Bits(16);
    birthYearCheck.in <== birthYear;

    // Month: Must be 0-12 (using LessEqThan with 4 bits)
    component birthMonthCheck = LessEqThan(4);  // 4 bits sufficient for comparing with 12
    birthMonthCheck.in[0] <== birthMonth;
    birthMonthCheck.in[1] <== 12;
    birthMonthCheck.out === 1;

    // Day: 5 bits allows exactly 0-31
    component birthDayCheck = Num2Bits(5);
    birthDayCheck.in <== birthDay;

    // Validate binary and range constraints
    component bcBit = Num2Bits(1);
    bcBit.in <== isBirthBC;

    // Gender constrained to 3 bits (0-7)
    component genderCheck = Num2Bits(3);
    genderCheck.in <== gender;

    // Convert fullNameHash bytes to two 128-bit field limbs (also validates bytes)
    component nameLimbs = HashToLimbs();
    for (var i = 0; i < 32; i++) {
        nameLimbs.hashBytes[i] <== fullNameHash[i];
    }

    component saltLimbs = HashToLimbs();
    for (var i = 0; i < 32; i++) {
        saltLimbs.hashBytes[i] <== saltHash[i];
    }

    // Two domain-separated Poseidon evaluations for salted name commitment
    component saltedPrimary = Poseidon(5);
    saltedPrimary.inputs[0] <== nameLimbs.limb0;
    saltedPrimary.inputs[1] <== nameLimbs.limb1;
    saltedPrimary.inputs[2] <== saltLimbs.limb0;
    saltedPrimary.inputs[3] <== saltLimbs.limb1;
    saltedPrimary.inputs[4] <== SALTED_NAME_DOMAIN_PRIMARY;

    component saltedSecondary = Poseidon(5);
    saltedSecondary.inputs[0] <== nameLimbs.limb0;
    saltedSecondary.inputs[1] <== nameLimbs.limb1;
    saltedSecondary.inputs[2] <== saltLimbs.limb0;
    saltedSecondary.inputs[3] <== saltLimbs.limb1;
    saltedSecondary.inputs[4] <== SALTED_NAME_DOMAIN_SECONDARY;

    component saltedPrimaryBits = Num2Bits(256);
    saltedPrimaryBits.in <== saltedPrimary.out;
    component saltedPrimaryLow = Bits2Num(128);
    for (var i = 0; i < 128; i++) {
        saltedPrimaryLow.in[i] <== saltedPrimaryBits.out[i];
    }
    component saltedPrimaryHigh = Bits2Num(128);
    for (var i = 0; i < 128; i++) {
        saltedPrimaryHigh.in[i] <== saltedPrimaryBits.out[128 + i];
    }

    component saltedSecondaryBits = Num2Bits(256);
    saltedSecondaryBits.in <== saltedSecondary.out;
    component saltedSecondaryLow = Bits2Num(128);
    for (var j = 0; j < 128; j++) {
        saltedSecondaryLow.in[j] <== saltedSecondaryBits.out[j];
    }
    component saltedSecondaryHigh = Bits2Num(128);
    for (var j = 0; j < 128; j++) {
        saltedSecondaryHigh.in[j] <== saltedSecondaryBits.out[128 + j];
    }

    // Pack demographic bits: birthYear (16) | birthMonth (8) | birthDay (8) | gender (3) | isBirthBC (1)
    signal packedData <== birthYear * 16777216 + birthMonth * 65536 + birthDay * 256 + gender * 2 + isBirthBC;

    // Final Poseidon commitments with separate domains to achieve 512-bit output
    component poseidonPrimary = Poseidon(4);
    poseidonPrimary.inputs[0] <== saltedPrimaryHigh.out;
    poseidonPrimary.inputs[1] <== saltedPrimaryLow.out;
    poseidonPrimary.inputs[2] <== packedData;
    poseidonPrimary.inputs[3] <== PERSON_DOMAIN_PRIMARY;

    component poseidonSecondary = Poseidon(4);
    poseidonSecondary.inputs[0] <== saltedSecondaryHigh.out;
    poseidonSecondary.inputs[1] <== saltedSecondaryLow.out;
    poseidonSecondary.inputs[2] <== packedData;
    poseidonSecondary.inputs[3] <== PERSON_DOMAIN_SECONDARY;

    component primaryBits = Num2Bits(256);
    primaryBits.in <== poseidonPrimary.out;
    component primaryLow = Bits2Num(128);
    for (var k = 0; k < 128; k++) {
        primaryLow.in[k] <== primaryBits.out[k];
    }
    component primaryHigh = Bits2Num(128);
    for (var k = 0; k < 128; k++) {
        primaryHigh.in[k] <== primaryBits.out[128 + k];
    }

    component secondaryBits = Num2Bits(256);
    secondaryBits.in <== poseidonSecondary.out;
    component secondaryLow = Bits2Num(128);
    for (var m = 0; m < 128; m++) {
        secondaryLow.in[m] <== secondaryBits.out[m];
    }
    component secondaryHigh = Bits2Num(128);
    for (var m = 0; m < 128; m++) {
        secondaryHigh.in[m] <== secondaryBits.out[128 + m];
    }

    primaryLimb0 <== primaryHigh.out;
    primaryLimb1 <== primaryLow.out;
    secondaryLimb0 <== secondaryHigh.out;
    secondaryLimb1 <== secondaryLow.out;
}

// Main test circuit
template PersonHashTest() {
    // Person to be added
    signal input fullNameHash[32];
    signal input saltHash[32];
    signal input isBirthBC;
    signal input birthYear;
    signal input birthMonth;
    signal input birthDay;
    signal input gender;
    
    // Father
    signal input father_fullNameHash[32];
    signal input father_saltHash[32];
    signal input father_isBirthBC;
    signal input father_birthYear;
    signal input father_birthMonth;
    signal input father_birthDay;
    signal input father_gender;
    
    // Mother
    signal input mother_fullNameHash[32];
    signal input mother_saltHash[32];
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
    signal output person_primary_limb0;
    signal output person_primary_limb1;
    signal output person_secondary_limb0;
    signal output person_secondary_limb1;
    signal output father_primary_limb0;
    signal output father_primary_limb1;
    signal output father_secondary_limb0;
    signal output father_secondary_limb1;
    signal output mother_primary_limb0;
    signal output mother_primary_limb1;
    signal output mother_secondary_limb0;
    signal output mother_secondary_limb1;
    signal output submitter_out;
    
    // Calculate commitment of person to be added
    component personHasher = PersonCommitment();
    for (var i = 0; i < 32; i++) {
        personHasher.fullNameHash[i] <== fullNameHash[i];
        personHasher.saltHash[i] <== saltHash[i];
    }
    personHasher.isBirthBC <== isBirthBC;
    personHasher.birthYear <== birthYear;
    personHasher.birthMonth <== birthMonth;
    personHasher.birthDay <== birthDay;
    personHasher.gender <== gender;
    
    // Calculate father commitment using PersonHasher
    component fatherHasher = PersonCommitment();
    for (var j = 0; j < 32; j++) {
        fatherHasher.fullNameHash[j] <== father_fullNameHash[j];
        fatherHasher.saltHash[j] <== father_saltHash[j];
    }
    fatherHasher.isBirthBC <== father_isBirthBC;
    fatherHasher.birthYear <== father_birthYear;
    fatherHasher.birthMonth <== father_birthMonth;
    fatherHasher.birthDay <== father_birthDay;
    fatherHasher.gender <== father_gender;
    
    // Calculate mother commitment using PersonHasher
    component motherHasher = PersonCommitment();
    for (var t = 0; t < 32; t++) {
        motherHasher.fullNameHash[t] <== mother_fullNameHash[t];
        motherHasher.saltHash[t] <== mother_saltHash[t];
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
    
    // Use arithmetic constraints for conditional parent output (more efficient than Mux1)
    // If hasFather = 1, output fatherHasher limbs; if hasFather = 0, output 0
    signal father_primary_limb0_selected <== hasFather * fatherHasher.primaryLimb0;
    signal father_primary_limb1_selected <== hasFather * fatherHasher.primaryLimb1;
    signal father_secondary_limb0_selected <== hasFather * fatherHasher.secondaryLimb0;
    signal father_secondary_limb1_selected <== hasFather * fatherHasher.secondaryLimb1;

    // If hasMother = 1, output motherHasher limbs; if hasMother = 0, output 0
    signal mother_primary_limb0_selected <== hasMother * motherHasher.primaryLimb0;
    signal mother_primary_limb1_selected <== hasMother * motherHasher.primaryLimb1;
    signal mother_secondary_limb0_selected <== hasMother * motherHasher.secondaryLimb0;
    signal mother_secondary_limb1_selected <== hasMother * motherHasher.secondaryLimb1;

    // Final outputs
    person_primary_limb0 <== personHasher.primaryLimb0;
    person_primary_limb1 <== personHasher.primaryLimb1;
    person_secondary_limb0 <== personHasher.secondaryLimb0;
    person_secondary_limb1 <== personHasher.secondaryLimb1;
    father_primary_limb0 <== father_primary_limb0_selected;
    father_primary_limb1 <== father_primary_limb1_selected;
    father_secondary_limb0 <== father_secondary_limb0_selected;
    father_secondary_limb1 <== father_secondary_limb1_selected;
    mother_primary_limb0 <== mother_primary_limb0_selected;
    mother_primary_limb1 <== mother_primary_limb1_selected;
    mother_secondary_limb0 <== mother_secondary_limb0_selected;
    mother_secondary_limb1 <== mother_secondary_limb1_selected;
    submitter_out <== submitter;
}

component main = PersonHashTest();
