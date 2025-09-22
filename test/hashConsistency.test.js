const { expect } = require('chai');
const hre = require('hardhat');

// Test to verify frontend computePersonHashLocal matches contract getPersonHash

describe('Hash Consistency Tests', function () {
  this.timeout(60_000);

  async function setup() {
    await hre.deployments.fixture(['Integrated']);
    const deepDeployment = await hre.deployments.get('DeepFamily');
    const deepFamily = await hre.ethers.getContractAt('DeepFamily', deepDeployment.address);
    return { deepFamily };
  }

  // Frontend hash calculation function – now mirrors Poseidon(3) + packedData
  async function computePersonHashLocal(input) {
    const { poseidon } = require('circomlibjs');

    const { fullName, isBirthBC, birthYear, birthMonth, birthDay, gender } = input;

    // Compute fullNameHash exactly like the contract
    const nameBytes = new TextEncoder().encode(fullName);
    const fullNameHash = hre.ethers.keccak256(nameBytes);

    // Split bytes32 to two 128-bit limbs (big-endian)
    const hashBytes = hre.ethers.getBytes(fullNameHash);
    let acc = 0n;
    for (let i = 0; i < 32; i++) acc = (acc << 8n) + BigInt(hashBytes[i]);
    const nameHi = acc >> 128n;
    const nameLo = acc & ((1n << 128n) - 1n);

    // Pack small fields: (year<<24) | (month<<16) | (day<<8) | (gender<<1) | isBirthBC
    const packedData = (BigInt(birthYear) << 24n)
      | (BigInt(birthMonth) << 16n)
      | (BigInt(birthDay) << 8n)
      | (BigInt(gender) << 1n)
      | (isBirthBC ? 1n : 0n);

    const h = poseidon([nameHi, nameLo, packedData]);
    const hex = '0x' + h.toString(16).padStart(64, '0');
    return hex;
  }

  const testCases = [
    {
      name: "Basic case",
      input: { fullName: "John Doe", isBirthBC: false, birthYear: 1990, birthMonth: 5, birthDay: 15, gender: 1 }
    },
    {
      name: "BC birth year",
      input: { fullName: "Ancient Person", isBirthBC: true, birthYear: 500, birthMonth: 0, birthDay: 0, gender: 2 }
    },
    {
      name: "Zero values",
      input: { fullName: "Unknown Person", isBirthBC: false, birthYear: 0, birthMonth: 0, birthDay: 0, gender: 0 }
    },
    {
      name: "Unicode name",
      input: { fullName: "John Smith", isBirthBC: false, birthYear: 1985, birthMonth: 12, birthDay: 25, gender: 1 }
    },
    {
      name: "Long name",
      input: { fullName: "Very Long Name With Many Characters", isBirthBC: false, birthYear: 2000, birthMonth: 1, birthDay: 1, gender: 3 }
    }
  ];

  testCases.forEach(({ name, input }) => {
    it(`verifies hash consistency for: ${name}`, async () => {
      const { deepFamily } = await setup();

      // Calculate hash using frontend-like function
      const frontendHash = await computePersonHashLocal(input);

      // Calculate fullNameHash for contract call
      const fullNameHash = await deepFamily.getFullNameHash(input.fullName);

      // Prepare basicInfo for contract call
      const basicInfo = {
        fullNameHash: fullNameHash,
        isBirthBC: input.isBirthBC,
        birthYear: input.birthYear,
        birthMonth: input.birthMonth,
        birthDay: input.birthDay,
        gender: input.gender
      };

      // Calculate hash using contract function
      const contractHash = await deepFamily.getPersonHash(basicInfo);

      console.log(`Frontend hash: ${frontendHash}`);
      console.log(`Contract hash:  ${contractHash}`);
      console.log(`FullNameHash:   ${fullNameHash}`);

      // They should be identical
      expect(frontendHash).to.equal(contractHash);
    });
  });
});
