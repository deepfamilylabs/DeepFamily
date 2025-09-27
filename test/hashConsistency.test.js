const { expect } = require('chai');
const hre = require('hardhat');
const poseidon = require('circomlibjs').poseidon;

const FIELD_MASK_128 = (1n << 128n) - 1n;

/**
 * Convert bytes32 hash (as hex string) to the two 128-bit limbs used in the circuit
 * Matches HashToLimbs template logic (big-endian across each byte)
 */
function hashToCircuitLimbs(hashHex) {
  const hashBytes = hre.ethers.getBytes(hashHex);
  if (hashBytes.length !== 32) throw new Error('Expected 32 bytes');

  let limb0 = 0n;
  for (let i = 0; i < 16; i += 1) {
    limb0 = (limb0 << 8n) | BigInt(hashBytes[i]);
  }

  let limb1 = 0n;
  for (let i = 16; i < 32; i += 1) {
    limb1 = (limb1 << 8n) | BigInt(hashBytes[i]);
  }

  return { limb0, limb1 };
}

/**
 * Pack birth data and flags exactly as in the circuit/contract
 * Format: birthYear * 2^24 + birthMonth * 2^16 + birthDay * 2^8 + gender * 2 + isBirthBC
 */
function packVitalStats({ birthYear, birthMonth, birthDay, gender, isBirthBC }) {
  return (BigInt(birthYear) << 24n)
    | (BigInt(birthMonth) << 16n)
    | (BigInt(birthDay) << 8n)
    | (BigInt(gender) << 1n)
    | (isBirthBC ? 1n : 0n);
}

/**
 * Combine Poseidon output into canonical bytes32 and expose high/low limbs for comparison
 */
function normalisePoseidonOutput(raw, ethers) {
  const output = BigInt(raw);
  const limb0 = output >> 128n;
  const limb1 = output & FIELD_MASK_128;
  const poseidonHex = `0x${output.toString(16).padStart(64, '0')}`;
  const finalHash = ethers.keccak256(poseidonHex);
  return { poseidonHex, finalHash, limb0, limb1 };
}

/**
 * Reproduce circuit hashing pipeline (HashToLimbs + Poseidon commitment)
 */
function computePersonHashCircuitEquivalent(input) {
  const fullNameHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(input.fullName));
  const nameLimbs = hashToCircuitLimbs(fullNameHash);
  const packedData = packVitalStats(input);
  const poseidonResult = poseidon([nameLimbs.limb0, nameLimbs.limb1, packedData]);
  const normalised = normalisePoseidonOutput(poseidonResult, hre.ethers);

  return {
    fullNameHash,
    nameLimbs,
    packedData,
    poseidonHex: normalised.poseidonHex,
    personHash: normalised.finalHash,
    poseidonLimbs: { limb0: normalised.limb0, limb1: normalised.limb1 },
  };
}

describe('Hash Consistency Tests', function () {
  this.timeout(60_000);

  let deepFamily;

  beforeEach(async () => {
    await hre.deployments.fixture(['Integrated']);
    const { address } = await hre.deployments.get('DeepFamily');
    deepFamily = await hre.ethers.getContractAt('DeepFamily', address);
  });

  const testCases = [
    {
      name: 'Basic case',
      input: { fullName: 'John Doe', isBirthBC: false, birthYear: 1990, birthMonth: 5, birthDay: 15, gender: 1 },
    },
    {
      name: 'BC birth year',
      input: { fullName: 'Ancient Person', isBirthBC: true, birthYear: 500, birthMonth: 0, birthDay: 0, gender: 2 },
    },
    {
      name: 'Zero values',
      input: { fullName: 'Unknown Person', isBirthBC: false, birthYear: 0, birthMonth: 0, birthDay: 0, gender: 0 },
    },
    {
      name: 'Unicode name',
      input: { fullName: 'John Smith', isBirthBC: false, birthYear: 1985, birthMonth: 12, birthDay: 25, gender: 1 },
    },
    {
      name: 'Long name',
      input: { fullName: 'Very Long Name With Many Characters', isBirthBC: false, birthYear: 2000, birthMonth: 1, birthDay: 1, gender: 3 },
    },
  ];

  testCases.forEach(({ name, input }) => {
    it(`matches circuit hash for: ${name}`, async () => {
      const expected = computePersonHashCircuitEquivalent(input);

      const contractFullNameHash = await deepFamily.getFullNameHash(input.fullName);
      expect(contractFullNameHash).to.equal(expected.fullNameHash);

      const basicInfo = {
        fullNameHash: contractFullNameHash,
        isBirthBC: input.isBirthBC,
        birthYear: input.birthYear,
        birthMonth: input.birthMonth,
        birthDay: input.birthDay,
        gender: input.gender,
      };

      const contractHash = await deepFamily.getPersonHash(basicInfo);
      expect(contractHash).to.equal(expected.personHash);

      const poseidonLimbs = hashToCircuitLimbs(expected.poseidonHex);
      expect(poseidonLimbs.limb0).to.equal(expected.poseidonLimbs.limb0);
      expect(poseidonLimbs.limb1).to.equal(expected.poseidonLimbs.limb1);
    });
  });
});
