import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import personCommitmentProof from "../lib/personCommitmentProof.js";
import { ensureIntegratedSystem } from "../hardhat/integratedDeployment.mjs";

const { generatePersonCommitmentProof } = personCommitmentProof;

const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const { deepFamily } = await ensureIntegratedSystem(connection);
  const [signer] = await ethers.getSigners();
  const submitterAddress = await signer.getAddress();

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
        derivedSecretField: 0n,
        isBirthBC: String(args.motherbirthbc).toLowerCase() === "true",
        birthYear: Number(args.motherbirthyear),
        birthMonth: Number(args.motherbirthmonth),
        birthDay: Number(args.motherbirthday),
        gender: Number(args.mothergender),
      }
    : null;

  personData.derivedSecretField = 0n;
  if (fatherData) fatherData.derivedSecretField = 0n;
  if (motherData) motherData.derivedSecretField = 0n;

  const result = await generatePersonCommitmentProof(
    personData,
    fatherData,
    motherData,
    submitterAddress,
  );

  const tx = await deepFamily
    .connect(signer)
    .addPersonVersion(
      result.proofEnvelope,
      result.publicSignalsStruct,
      fatherData ? Number(args.fatherversion) : 0,
      motherData ? Number(args.motherversion) : 0,
      args.tag,
      args.ipfs,
    );
  const receipt = await tx.wait();

  console.log(`Person version added: ${result.person.personHash}`);
  console.log(`Transaction: ${tx.hash}`);
  console.log(`Block: ${receipt?.blockNumber ?? "n/a"}`);
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
