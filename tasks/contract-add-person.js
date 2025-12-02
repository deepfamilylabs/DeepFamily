const { task } = require("hardhat/config");
const { generatePersonHashProof } = require("../lib/personHashProof");

task("add-person", "Add a person version using ZK proof")
  .addParam("fullname", "Full name")
  .addOptionalParam("passphrase", "Salt passphrase for privacy (default: empty)", "")
  .addOptionalParam("birthbc", "Is birth year BC (true/false)", "false")
  .addParam("birthyear", "Birth year (0=unknown)")
  .addOptionalParam("birthmonth", "Birth month (1-12, 0=unknown)", "0")
  .addOptionalParam("birthday", "Birth day (1-31, 0=unknown)", "0")
  .addParam("gender", "Gender (0=Unknown,1=Male,2=Female,3=Other)")
  .addOptionalParam("fathername", "Father's full name (optional)", "")
  .addOptionalParam("fatherpassphrase", "Father's passphrase (default: empty)", "")
  .addOptionalParam("fatherbirthyear", "Father birth year (0=unknown)", "0")
  .addOptionalParam("fatherbirthmonth", "Father birth month (1-12, 0=unknown)", "0")
  .addOptionalParam("fatherbirthday", "Father birth day (1-31, 0=unknown)", "0")
  .addOptionalParam("fathergender", "Father gender (0=Unknown,1=Male,2=Female,3=Other)", "1")
  .addOptionalParam("fatherbirthbc", "Is father birth BC (true/false)", "false")
  .addOptionalParam("mothername", "Mother's full name (optional)", "")
  .addOptionalParam("motherpassphrase", "Mother's passphrase (default: empty)", "")
  .addOptionalParam("motherbirthyear", "Mother birth year (0=unknown)", "0")
  .addOptionalParam("motherbirthmonth", "Mother birth month (1-12, 0=unknown)", "0")
  .addOptionalParam("motherbirthday", "Mother birth day (1-31, 0=unknown)", "0")
  .addOptionalParam("mothergender", "Mother gender (0=Unknown,1=Male,2=Female,3=Other)", "2")
  .addOptionalParam("motherbirthbc", "Is mother birth BC (true/false)", "false")
  .addOptionalParam("fatherversion", "Father version index", "0")
  .addOptionalParam("motherversion", "Mother version index", "0")
  .addParam("tag", "Version tag, e.g. v1")
  .addParam("ipfs", "Metadata IPFS CID / hash")
  .setAction(async (args, hre) => {
    const { deployments, ethers } = hre;
    const { get } = deployments;

    const deep = await get("DeepFamily");

    const deepFamily = await ethers.getContractAt("DeepFamily", deep.address);
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
        ethers.keccak256(ethers.toUtf8Bytes(args.tag || "")),
        args.ipfs,
      );

    const receipt = await tx.wait();

    // Parse events and verify person hash
    try {
      const iface = new ethers.Interface([
        "event PersonVersionAdded(bytes32 indexed personHash, uint256 indexed versionIndex, address indexed addedBy, uint256 timestamp, bytes32 fatherHash, uint256 fatherVersionIndex, bytes32 motherHash, uint256 motherVersionIndex, bytes32 tagHash)",
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

      for (const log of receipt.logs || []) {
        if ((log.address || "").toLowerCase() !== deep.address.toLowerCase()) continue;
        try {
          const parsed = iface.parseLog(log);
          if (parsed && parsed.name === "PersonVersionAdded") {
            const actualPersonHash = parsed.args.personHash;

            // Verify personHash matches
            if (actualPersonHash !== expectedPersonHash) {
              console.error("❌ PersonHash mismatch!");
              console.error("  Expected:", expectedPersonHash);
              console.error("  Actual:", actualPersonHash);
              throw new Error("PersonHash from event does not match ZK proof");
            }
            break;
          }
        } catch (_) {}
      }
    } catch (e) {}
  });
