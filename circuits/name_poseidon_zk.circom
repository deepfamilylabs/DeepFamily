// name_poseidon_zk.circom
// Minimal circuit to bind keccak(fullName) and keccak(passphrase) to a salted Poseidon digest used in PersonBasicInfo
pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";

// Convert a 32-byte hash into two 128-bit limbs (big-endian hi|lo) while constraining each byte to 8 bits
template HashToLimbs() {
    signal input hashBytes[32];
    signal output limb0; // High 128 bits
    signal output limb1; // Low 128 bits

    component byteCheck[32];
    for (var i = 0; i < 32; i++) {
        byteCheck[i] = Num2Bits(8);
        byteCheck[i].in <== hashBytes[i];
    }

    component limb0Bits = Bits2Num(128);
    component limb1Bits = Bits2Num(128);

    for (var i = 0; i < 16; i++) {
        for (var j = 0; j < 8; j++) {
            limb0Bits.in[127 - (i * 8 + j)] <== byteCheck[i].out[7 - j];
        }
    }
    limb0 <== limb0Bits.out;

    for (var i = 0; i < 16; i++) {
        for (var j = 0; j < 8; j++) {
            limb1Bits.in[127 - (i * 8 + j)] <== byteCheck[16 + i].out[7 - j];
        }
    }
    limb1 <== limb1Bits.out;
}

// Main circuit: prove Poseidon(keccak(fullName), keccak(passphrase), domain) == fullNamePoseidon
// while exposing both the Poseidon digest and the keccak(fullName) hash as public signals.
template NamePoseidonBinding() {
    signal input fullNameHash[32]; // keccak256(fullName) bytes
    signal input saltHash[32];     // keccak256(passphrase) bytes (can be zero when passphrase omitted)
    signal input minter;           // Address of the intended NFT minter (lower 160 bits)

    signal output commitPrimaryHi;   // high 128 bits of primary Poseidon digest
    signal output commitPrimaryLo;   // low 128 bits of primary Poseidon digest
    signal output commitSecondaryHi; // high 128 bits of secondary Poseidon digest
    signal output commitSecondaryLo; // low 128 bits of secondary Poseidon digest
    signal output nameHashHi;        // high 128 bits of keccak(fullName)
    signal output nameHashLo;        // low 128 bits of keccak(fullName)
    signal output minterOut;         // The minter address, exposed as public signal for on-chain binding

    // Domain constants derived from keccak("DeepFamily::NameCommit::<domain>")
    var SALTED_NAME_DOMAIN_PRIMARY = 447621024357665903074632115256704697579070658341564497608043648103041050990;
    var SALTED_NAME_DOMAIN_SECONDARY = 19517420153832580388377732280333130415087647067004616588695803175044816476636;

    component nameLimbs = HashToLimbs();
    for (var i = 0; i < 32; i++) {
        nameLimbs.hashBytes[i] <== fullNameHash[i];
    }

    component saltLimbs = HashToLimbs();
    for (var i = 0; i < 32; i++) {
        saltLimbs.hashBytes[i] <== saltHash[i];
    }

    component poseidonPrimary = Poseidon(5);
    poseidonPrimary.inputs[0] <== nameLimbs.limb0;
    poseidonPrimary.inputs[1] <== nameLimbs.limb1;
    poseidonPrimary.inputs[2] <== saltLimbs.limb0;
    poseidonPrimary.inputs[3] <== saltLimbs.limb1;
    poseidonPrimary.inputs[4] <== SALTED_NAME_DOMAIN_PRIMARY;

    component poseidonSecondary = Poseidon(5);
    poseidonSecondary.inputs[0] <== nameLimbs.limb0;
    poseidonSecondary.inputs[1] <== nameLimbs.limb1;
    poseidonSecondary.inputs[2] <== saltLimbs.limb0;
    poseidonSecondary.inputs[3] <== saltLimbs.limb1;
    poseidonSecondary.inputs[4] <== SALTED_NAME_DOMAIN_SECONDARY;

    component primaryBits = Num2Bits(256);
    primaryBits.in <== poseidonPrimary.out;
    component primaryLow = Bits2Num(128);
    for (var i = 0; i < 128; i++) {
        primaryLow.in[i] <== primaryBits.out[i];
    }
    component primaryHigh = Bits2Num(128);
    for (var i = 0; i < 128; i++) {
        primaryHigh.in[i] <== primaryBits.out[128 + i];
    }

    component secondaryBits = Num2Bits(256);
    secondaryBits.in <== poseidonSecondary.out;
    component secondaryLow = Bits2Num(128);
    for (var j = 0; j < 128; j++) {
        secondaryLow.in[j] <== secondaryBits.out[j];
    }
    component secondaryHigh = Bits2Num(128);
    for (var j = 0; j < 128; j++) {
        secondaryHigh.in[j] <== secondaryBits.out[128 + j];
    }

    commitPrimaryHi <== primaryHigh.out;
    commitPrimaryLo <== primaryLow.out;
    commitSecondaryHi <== secondaryHigh.out;
    commitSecondaryLo <== secondaryLow.out;

    nameHashHi <== nameLimbs.limb0;
    nameHashLo <== nameLimbs.limb1;

    component minterBits = Num2Bits(160);
    minterBits.in <== minter;
    minterOut <== minter;
}

component main = NamePoseidonBinding();
