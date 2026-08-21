import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import seedHelpers from "../lib/seedHelpers.js";
import { ensureIntegratedSystem } from "../hardhat/integratedDeployment.mjs";

const { mintPersonVersionNFT } = seedHelpers;

const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const signer = (await ethers.getSigners())[0];
  const signerAddr = await signer.getAddress();
  const { deepFamily } = await ensureIntegratedSystem(connection, { artifacts: hre.artifacts });

  const versionIndex = Number(args.vindex);
  if (!Number.isInteger(versionIndex) || versionIndex <= 0) {
    throw new Error("vindex must be a positive integer starting from 1");
  }

  // Validate numeric ranges
  const birthYear = Number(args.birthyear);
  const birthMonth = Number(args.birthmonth);
  const birthDay = Number(args.birthday);
  const gender = Number(args.gender);
  const deathYear = Number(args.deathyear);
  const deathMonth = Number(args.deathmonth);
  const deathDay = Number(args.deathday);

  if (birthYear < 0 || birthYear > 65535) throw new Error("birthYear out of uint16 range");
  if (birthMonth < 0 || birthMonth > 12) throw new Error("birthMonth must be 0-12");
  if (birthDay < 0 || birthDay > 31) throw new Error("birthDay must be 0-31");
  if (!Number.isInteger(gender) || gender < 0 || gender > 255) {
    throw new Error("gender must be an integer in [0, 255]");
  }
  if (deathYear < 0 || deathYear > 65535) throw new Error("deathYear out of uint16 range");
  if (deathMonth < 0 || deathMonth > 12) throw new Error("deathMonth must be 0-12");
  if (deathDay < 0 || deathDay > 31) throw new Error("deathDay must be 0-31");

  // Check version existence
  const totalVersions = await deepFamily.personVersionsCount(args.person);
  if (versionIndex > totalVersions) {
    throw new Error(`Version index ${versionIndex} out of range (total=${totalVersions}).`);
  }

  // Check endorsement requirement
  const endorsed = Number(await deepFamily.endorsedVersionIndex(args.person, signerAddr));
  if (endorsed !== versionIndex) {
    throw new Error(
      `You must endorse this version first (current endorsed index=${endorsed || 0}). Run: npx hardhat endorse --person ${args.person} --vindex ${versionIndex} --network <net>`,
    );
  }

  const basicInfo = {
    fullName: args.fullname,
    passphrase: args.passphrase || "",
    isBirthBC: String(args.birthbc).toLowerCase() === "true",
    birthYear,
    birthMonth,
    birthDay,
    gender,
  };

  const supplementInfo = {
    fullName: args.fullname,
    birthPlace: args.birthplace,
    isDeathBC: String(args.deathbc).toLowerCase() === "true",
    deathYear,
    deathMonth,
    deathDay,
    deathPlace: args.deathplace,
    story: args.story,
  };

  const result = await mintPersonVersionNFT({
    deepFamily,
    signer,
    personHash: args.person,
    versionIndex,
    tokenURI: args.tokenuri,
    basicInfo,
    supplementInfo,
  });

  console.log(`NFT minted for person ${args.person}`);
  console.log(`Transaction: ${result.tx.hash}`);
  console.log(`Block: ${result.receipt?.blockNumber ?? "n/a"}`);
};

export default task("mint-nft", "Mint NFT for a person version (requires prior endorsement)")
  .addOption({
    name: "person",
    description: "Person hash (bytes32)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "vindex",
    description: "Version index (starting from 1)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "tokenuri",
    description: "NFT metadata URI (e.g. ipfs://CID)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "fullname",
    description: "Full name (must match original person hash)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "passphrase",
    description: "Passphrase used in original ZK proof",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "birthyear",
    description: "Birth year (0=unknown)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "birthbc",
    description: "Is birth BC (true/false)",
    type: ArgumentType.STRING,
    defaultValue: "false",
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
    description: "Gender (0=Unknown, 1=Male, 2=Female, 3=Other, 4-255=Custom)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "birthplace",
    description: "Birth place (string, can be empty)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "deathbc",
    description: "Is death BC (true/false)",
    type: ArgumentType.STRING,
    defaultValue: "false",
  })
  .addOption({
    name: "deathyear",
    description: "Death year (0=unknown)",
    type: ArgumentType.STRING,
    defaultValue: "0",
  })
  .addOption({
    name: "deathmonth",
    description: "Death month (1-12, 0=unknown)",
    type: ArgumentType.STRING,
    defaultValue: "0",
  })
  .addOption({
    name: "deathday",
    description: "Death day (1-31, 0=unknown)",
    type: ArgumentType.STRING,
    defaultValue: "0",
  })
  .addOption({
    name: "deathplace",
    description: "Death place",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "story",
    description: "Short life story (<=256 chars)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .setAction(() => Promise.resolve({ default: action }))
  .build();
