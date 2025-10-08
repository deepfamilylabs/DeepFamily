const path = require("path");
const snarkjs = require("snarkjs");
const { ethers } = require("ethers");
const fs = require("fs");

const ZERO32 = Object.freeze(new Array(32).fill(0));

function resolveExistingFile(description, explicitPath, candidates) {
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) {
      throw new Error(`${description} not found at: ${explicitPath}`);
    }
    return explicitPath;
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `${description} not found in any of these locations:\n${candidates.join("\n")}`
  );
}

const FRONTEND_WASM = path.join(__dirname, "../frontend/public/zk/person_hash_zk.wasm");
const FRONTEND_ZKEY = path.join(__dirname, "../frontend/public/zk/person_hash_zk_final.zkey");

const ARTIFACTS_WASM = path.join(__dirname, "../artifacts/circuits/person_hash_zk_js/person_hash_zk.wasm");
const ARTIFACTS_ZKEY = path.join(__dirname, "../artifacts/circuits/person_hash_zk_final.zkey");

const DEFAULT_WASM_CANDIDATES = [FRONTEND_WASM, ARTIFACTS_WASM];
const DEFAULT_ZKEY_CANDIDATES = [FRONTEND_ZKEY, ARTIFACTS_ZKEY];

function hashToBytes(hash) {
  const bytes = ethers.getBytes(hash);
  return Array.from(bytes);
}

function buildPersonHashInput(personData, fatherData = null, motherData = null, submitter) {
  // Person data - must trim fullName like computePoseidonDigest does!
  const normalizedFullName = personData.fullName.trim();
  const normalizedPassphrase = personData.passphrase || "";

  const fullNameKeccak = ethers.keccak256(ethers.toUtf8Bytes(normalizedFullName));
  const passphraseKeccak = normalizedPassphrase.length > 0
    ? ethers.keccak256(ethers.toUtf8Bytes(normalizedPassphrase))
    : "0x" + "00".repeat(32);

  const input = {
    fullNameHash: hashToBytes(fullNameKeccak),
    saltHash: hashToBytes(passphraseKeccak),
    isBirthBC: personData.isBirthBC ? 1 : 0,
    birthYear: personData.birthYear || 0,
    birthMonth: personData.birthMonth || 0,
    birthDay: personData.birthDay || 0,
    gender: personData.gender || 0,
  };

  // Father data
  if (fatherData && fatherData.fullName) {
    const normalizedFatherName = fatherData.fullName.trim();
    const normalizedFatherPassphrase = fatherData.passphrase || "";

    const fatherNameKeccak = ethers.keccak256(ethers.toUtf8Bytes(normalizedFatherName));
    const fatherSaltKeccak = normalizedFatherPassphrase.length > 0
      ? ethers.keccak256(ethers.toUtf8Bytes(normalizedFatherPassphrase))
      : "0x" + "00".repeat(32);

    input.father_fullNameHash = hashToBytes(fatherNameKeccak);
    input.father_saltHash = hashToBytes(fatherSaltKeccak);
    input.father_isBirthBC = fatherData.isBirthBC ? 1 : 0;
    input.father_birthYear = fatherData.birthYear || 0;
    input.father_birthMonth = fatherData.birthMonth || 0;
    input.father_birthDay = fatherData.birthDay || 0;
    input.father_gender = fatherData.gender || 1;
    input.hasFather = 1;
  } else {
    input.father_fullNameHash = ZERO32;
    input.father_saltHash = ZERO32;
    input.father_isBirthBC = 0;
    input.father_birthYear = 0;
    input.father_birthMonth = 0;
    input.father_birthDay = 0;
    input.father_gender = 0;
    input.hasFather = 0;
  }

  // Mother data
  if (motherData && motherData.fullName) {
    const normalizedMotherName = motherData.fullName.trim();
    const normalizedMotherPassphrase = motherData.passphrase || "";

    const motherNameKeccak = ethers.keccak256(ethers.toUtf8Bytes(normalizedMotherName));
    const motherSaltKeccak = normalizedMotherPassphrase.length > 0
      ? ethers.keccak256(ethers.toUtf8Bytes(normalizedMotherPassphrase))
      : "0x" + "00".repeat(32);

    input.mother_fullNameHash = hashToBytes(motherNameKeccak);
    input.mother_saltHash = hashToBytes(motherSaltKeccak);
    input.mother_isBirthBC = motherData.isBirthBC ? 1 : 0;
    input.mother_birthYear = motherData.birthYear || 0;
    input.mother_birthMonth = motherData.birthMonth || 0;
    input.mother_birthDay = motherData.birthDay || 0;
    input.mother_gender = motherData.gender || 2;
    input.hasMother = 1;
  } else {
    input.mother_fullNameHash = ZERO32;
    input.mother_saltHash = ZERO32;
    input.mother_isBirthBC = 0;
    input.mother_birthYear = 0;
    input.mother_birthMonth = 0;
    input.mother_birthDay = 0;
    input.mother_gender = 0;
    input.hasMother = 0;
  }

  // Submitter binding
  input.submitter = BigInt(submitter).toString();

  return input;
}

function normalizeProof(proof) {
  if (!proof || !proof.pi_a || !proof.pi_b || !proof.pi_c) {
    throw new Error("Invalid proof structure returned by snarkjs");
  }

  return {
    a: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
    b: [
      [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
      [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
    ],
    c: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
  };
}

function normalizePublicSignals(publicSignals) {
  if (!Array.isArray(publicSignals) || publicSignals.length !== 7) {
    throw new Error(
      `Person hash public signals length mismatch (expected 7, got ${publicSignals?.length})`
    );
  }

  return publicSignals.map((value) => BigInt(value));
}

async function generatePersonHashProof(personData, fatherData, motherData, submitter, options = {}) {
  const wasmPath = resolveExistingFile(
    "Person hash circuit wasm",
    options.wasm,
    DEFAULT_WASM_CANDIDATES
  );
  const zkeyPath = resolveExistingFile(
    "Person hash circuit zkey",
    options.zkey,
    DEFAULT_ZKEY_CANDIDATES
  );

  const input = buildPersonHashInput(personData, fatherData, motherData, submitter);

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);

  return {
    proof: normalizeProof(proof),
    publicSignals: normalizePublicSignals(publicSignals),
    input,
    artifacts: {
      wasm: wasmPath,
      zkey: zkeyPath,
    },
  };
}

module.exports = {
  generatePersonHashProof,
};
