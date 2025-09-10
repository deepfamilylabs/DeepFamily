// test_circuit.js
// Simple circuit test script
const { keccak256, toUtf8Bytes } = require("ethers");

function solidityPackedKeccak(types, values) {
  const { solidityPacked } = require("ethers");
  return keccak256(solidityPacked(types, values));
}

function split128BE(hashHex) {
  const h = hashHex.toLowerCase();
  if (!h.startsWith("0x") || h.length !== 66) {
    throw new Error(`Invalid bytes32 hex: ${hashHex}`);
  }
  const hiHex = "0x" + h.slice(2, 34);
  const loHex = "0x" + h.slice(34);
  return [BigInt(hiHex), BigInt(loHex)];
}

function getPersonHashJS(basic) {
  const nameBytes = toUtf8Bytes(basic.fullName);
  const nameLen = nameBytes.length;
  
  const hashHex = solidityPackedKeccak(
    ["uint16", "bytes", "uint8", "uint16", "uint8", "uint8", "uint8"],
    [
      nameLen,
      nameBytes,
      basic.isBirthBC ? 1 : 0,
      basic.birthYear,
      basic.birthMonth,
      basic.birthDay,
      basic.gender,
    ]
  );
  return hashHex;
}

// Test data (matches circuit inputs)
const person = {
  fullName: "Alice",  // nameBytes: [65, 108, 105, 99, 101]
  isBirthBC: false,
  birthYear: 1990,
  birthMonth: 12,
  birthDay: 31,
  gender: 1,
};

const father = {
  fullName: "Bob",   // nameBytes: [66, 111, 98]
  isBirthBC: false,
  birthYear: 1960,
  birthMonth: 6,
  birthDay: 15,
  gender: 1,
};

const mother = {
  fullName: "Carol", // nameBytes: [67, 97, 114, 111, 108]
  isBirthBC: false,
  birthYear: 1962,
  birthMonth: 7,
  birthDay: 20,
  gender: 2,
};

// Compute expected hash values
const personHash = getPersonHashJS(person);
const fatherHash = getPersonHashJS(father);
const motherHash = getPersonHashJS(mother);

console.log("Expected hashes:");
console.log("Person hash:", personHash);
console.log("Father hash:", fatherHash);
console.log("Mother hash:", motherHash);

// Split into limbs
const personLimbs = split128BE(personHash);
const fatherLimbs = split128BE(fatherHash);
const motherLimbs = split128BE(motherHash);

console.log("\nExpected limbs (decimal):");
console.log("Person limbs:", personLimbs.map(x => x.toString()));
console.log("Father limbs:", fatherLimbs.map(x => x.toString()));
console.log("Mother limbs:", motherLimbs.map(x => x.toString()));

console.log("\nExpected public signals:");
console.log([
  ...personLimbs.map(x => x.toString()),
  ...fatherLimbs.map(x => x.toString()),
  ...motherLimbs.map(x => x.toString()),
  "0" // submitter
]);