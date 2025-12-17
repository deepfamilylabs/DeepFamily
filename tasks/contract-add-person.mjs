import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import personHashProof from "../lib/personHashProof.js";
import { ensureIntegratedSystem } from "../hardhat/integratedDeployment.mjs";

const { generatePersonHashProof } = personHashProof;

const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const { deepFamily } = await ensureIntegratedSystem(connection);
  const [signer] = await ethers.getSigners();
  const sender = await signer.getAddress();

  // Parse numeric fields
  const birthYearNum = Number(args.birthyear);
  const birthMonthNum = Number(args.birthmonth);
  const birthDayNum = Number(args.birthday);
  const genderNum = Number(args.gender);

  if (birthYearNum < 0 || birthYearNum > 65535) {
    throw new Error(`Birth year out of range: ${birthYearNum}`);
  }
  if (birthMonthNum < 0 || birthMonthNum > 12) {
    throw new Error(`Birth month out of range: ${birthMonthNum}`);
  }
  if (birthDayNum < 0 || birthDayNum > 31) {
    throw new Error(`Birth day out of range: ${birthDayNum}`);
  }
  if (genderNum < 0 || genderNum > 3) {
    throw new Error(`Gender out of range: ${genderNum}`);
  }

  if (!args.fullname || args.fullname.trim().length === 0) {
    throw new Error("InvalidFullName");
  }

  // Prepare person data
  const personData = {
    fullName: args.fullname,
    passphrase: args.passphrase || "",
    isBirthBC: String(args.birthbc).toLowerCase() === "true",
    birthYear: birthYearNum,
    birthMonth: birthMonthNum,
    birthDay: birthDayNum,
    gender: genderNum,
  };

  // Prepare father data
  const fatherData = args.fathername
    ? {
        fullName: args.fathername,
        passphrase: args.fatherpassphrase || "",
        isBirthBC: String(args.fatherbirthbc).toLowerCase() === "true",
        birthYear: Number(args.fatherbirthyear),
        birthMonth: Number(args.fatherbirthmonth),
        birthDay: Number(args.fatherbirthday),
        gender: Number(args.fathergender),
      }
    : null;

  // Prepare mother data
  const motherData = args.mothername
    ? {
        fullName: args.mothername,
        passphrase: args.motherpassphrase || "",
        isBirthBC: String(args.motherbirthbc).toLowerCase() === "true",
        birthYear: Number(args.motherbirthyear),
        birthMonth: Number(args.motherbirthmonth),
        birthDay: Number(args.motherbirthday),
        gender: Number(args.mothergender),
      }
    : null;

  // Generate ZK proof
  const { proof, publicSignals } = await generatePersonHashProof(
    personData,
    fatherData,
    motherData,
    sender,
  );

  // Submit to contract
  const tx = await deepFamily
    .connect(signer)
    .addPersonZK(
      proof.a,
      proof.b,
      proof.c,
      publicSignals,
      Number(args.fatherversion),
      Number(args.motherversion),
      args.tag,
      args.ipfs,
    );

  const receipt = await tx.wait();

  // Parse events and verify person hash
  try {
    const iface = new ethers.Interface([
      "event PersonVersionAdded(bytes32 indexed personHash, uint256 indexed versionIndex, address indexed addedBy, uint256 timestamp, bytes32 fatherHash, uint256 fatherVersionIndex, bytes32 motherHash, uint256 motherVersionIndex, string tag)",
    ]);

    // Reconstruct expected personHash from proof
    const poseidonDigest =
      "0x" +
      ((BigInt(publicSignals[0]) << 128n) | BigInt(publicSignals[1]))
        .toString(16)
        .padStart(64, "0");
    const expectedPersonHash = ethers.keccak256(
      ethers.solidityPacked(["bytes32"], [poseidonDigest]),
    );

    const deepAddr = (deepFamily.target || deepFamily.address).toLowerCase();
    for (const log of receipt.logs || []) {
      if ((log.address || "").toLowerCase() !== deepAddr) continue;
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "PersonVersionAdded") {
          const actualPersonHash = parsed.args.personHash;

          // Verify personHash matches
          if (actualPersonHash !== expectedPersonHash) {
            throw new Error("PersonHash from event does not match ZK proof");
          }
          break;
        }
      } catch (_) {}
    }
  } catch (e) {}
};

export default task("add-person", "Add a person version using ZK proof")
  .addOption({
    name: "fullname",
    description: "Full name",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "passphrase",
    description: "Salt passphrase for privacy (default: empty)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "birthbc",
    description: "Is birth year BC (true/false)",
    type: ArgumentType.STRING,
    defaultValue: "false",
  })
  .addOption({
    name: "birthyear",
    description: "Birth year (0=unknown)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "birthmonth",
    description: "Birth month (1-12, 0=unknown)",
    type: ArgumentType.STRING,
    defaultValue: "0",
  })
  .addOption({
    name: "birthday",
    description: "Birth day (1-31, 0=unknown)",
    type: ArgumentType.STRING,
    defaultValue: "0",
  })
  .addOption({
    name: "gender",
    description: "Gender (0=Unknown,1=Male,2=Female,3=Other)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "fathername",
    description: "Father's full name (optional)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "fatherpassphrase",
    description: "Father's passphrase (default: empty)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "fatherbirthyear",
    description: "Father birth year (0=unknown)",
    type: ArgumentType.STRING,
    defaultValue: "0",
  })
  .addOption({
    name: "fatherbirthmonth",
    description: "Father birth month (1-12, 0=unknown)",
    type: ArgumentType.STRING,
    defaultValue: "0",
  })
  .addOption({
    name: "fatherbirthday",
    description: "Father birth day (1-31, 0=unknown)",
    type: ArgumentType.STRING,
    defaultValue: "0",
  })
  .addOption({
    name: "fathergender",
    description: "Father gender (0=Unknown,1=Male,2=Female,3=Other)",
    type: ArgumentType.STRING,
    defaultValue: "1",
  })
  .addOption({
    name: "fatherbirthbc",
    description: "Is father birth BC (true/false)",
    type: ArgumentType.STRING,
    defaultValue: "false",
  })
  .addOption({
    name: "mothername",
    description: "Mother's full name (optional)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "motherpassphrase",
    description: "Mother's passphrase (default: empty)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "motherbirthyear",
    description: "Mother birth year (0=unknown)",
    type: ArgumentType.STRING,
    defaultValue: "0",
  })
  .addOption({
    name: "motherbirthmonth",
    description: "Mother birth month (1-12, 0=unknown)",
    type: ArgumentType.STRING,
    defaultValue: "0",
  })
  .addOption({
    name: "motherbirthday",
    description: "Mother birth day (1-31, 0=unknown)",
    type: ArgumentType.STRING,
    defaultValue: "0",
  })
  .addOption({
    name: "mothergender",
    description: "Mother gender (0=Unknown,1=Male,2=Female,3=Other)",
    type: ArgumentType.STRING,
    defaultValue: "2",
  })
  .addOption({
    name: "motherbirthbc",
    description: "Is mother birth BC (true/false)",
    type: ArgumentType.STRING,
    defaultValue: "false",
  })
  .addOption({
    name: "fatherversion",
    description: "Father version index",
    type: ArgumentType.STRING,
    defaultValue: "0",
  })
  .addOption({
    name: "motherversion",
    description: "Mother version index",
    type: ArgumentType.STRING,
    defaultValue: "0",
  })
  .addOption({
    name: "tag",
    description: "Version tag, e.g. v1",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "ipfs",
    description: "Metadata IPFS CID / hash",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .setAction(() => Promise.resolve({ default: action }))
  .build();
