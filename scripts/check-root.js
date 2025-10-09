const hre = require("hardhat");
const { computePersonHash, checkPersonExists } = require("../lib/seedHelpers");

/**
 * Check detailed information for a specific person
 */
async function checkPerson(deepFamily, personData, versionIndex = 1) {
  const personHash = await computePersonHash({ deepFamily, personData });

  console.log(`\nPerson: ${personData.fullName}`);
  console.log(`Hash: ${personHash}`);

  const existsResult = await checkPersonExists({
    deepFamily,
    personHash,
    versionIndex,
  });

  if (!existsResult.exists) {
    console.log(`❌ Person does not exist`);
    return { exists: false, personHash };
  }

  console.log(`✓ Person exists (total versions: ${existsResult.totalVersions})`);

  // Get version details
  try {
    const versionDetails = await deepFamily.getVersionDetails(personHash, versionIndex);
    console.log(`\nVersion ${versionIndex} details:`);
    console.log(`  Tag: ${versionDetails.tag}`);
    console.log(`  IPFS CID: ${versionDetails.ipfsCID}`);
    console.log(`  Added at: ${new Date(Number(versionDetails.timestamp) * 1000).toISOString()}`);
    console.log(`  Added by: ${versionDetails.addedBy}`);
    if (versionDetails.fatherHash !== ethers.ZeroHash) {
      console.log(`  Father hash: ${versionDetails.fatherHash} (v${versionDetails.fatherVersionIndex})`);
    }
    if (versionDetails.motherHash !== ethers.ZeroHash) {
      console.log(`  Mother hash: ${versionDetails.motherHash} (v${versionDetails.motherVersionIndex})`);
    }
  } catch (e) {
    console.warn(`  Failed to get version details: ${e.message}`);
  }

  // Check children
  try {
    const res = await deepFamily.listChildren(personHash, versionIndex, 0, 0);
    const total = Number(res[2]);
    console.log(`\nTotal children: ${total}`);

    if (total > 0) {
      const showCount = Math.min(5, total);
      const childrenRes = await deepFamily.listChildren(personHash, versionIndex, 0, showCount);
      console.log(`First ${showCount} children:`);
      for (let i = 0; i < childrenRes[0].length; i++) {
        console.log(`  ${i + 1}. ${childrenRes[0][i]} (v${childrenRes[1][i]})`);
      }
      if (total > showCount) {
        console.log(`  ... ${total - showCount} more children`);
      }
    }
  } catch (e) {
    console.warn(`  Failed to get children list: ${e.message}`);
  }

  // Check NFT
  try {
    const nftId = await deepFamily.personVersionNFT(personHash, versionIndex);
    if (nftId && Number(nftId) !== 0) {
      console.log(`\n✓ NFT minted`);
      console.log(`  TokenID: ${nftId.toString()}`);
      const owner = await deepFamily.ownerOf(nftId);
      console.log(`  Owner: ${owner}`);
      try {
        const tokenURI = await deepFamily.tokenURI(nftId);
        console.log(`  TokenURI: ${tokenURI}`);
      } catch (e) {
        // tokenURI may not exist
      }
    } else {
      console.log(`\n○ NFT not minted yet`);
    }
  } catch (e) {
    console.log(`\n○ NFT not minted yet`);
  }

  return { exists: true, personHash, totalVersions: existsResult.totalVersions };
}

async function main() {
  const { deployments, ethers } = hre;
  const { get } = deployments;
  
  console.log("=".repeat(70));
  console.log("DeepFamily Person Check Tool");
  console.log("=".repeat(70));

  let dep;
  try {
    dep = await get("DeepFamily");
  } catch {
    await deployments.fixture(["Integrated"]);
    dep = await get("DeepFamily");
  }

  // Get related deployment info
  const depToken = await get("DeepFamilyToken");
  const depVerifier = await get("PersonHashVerifier");
  const depNameVerifier = await get("NamePoseidonVerifier");

  console.log("\nContract addresses:");
  console.log(`  DeepFamily: ${dep.address}`);
  console.log(`  DeepFamilyToken: ${depToken.address}`);
  console.log(`  PersonHashVerifier: ${depVerifier.address}`);
  console.log(`  NamePoseidonVerifier: ${depNameVerifier.address}`);

  const deepFamily = await ethers.getContractAt("DeepFamily", dep.address);

  // Display statistics
  try {
    const tokenCounter = await deepFamily.tokenCounter();
    console.log(`\nOn-chain statistics:`);
    console.log(`  Total NFT supply: ${tokenCounter.toString()}`);
  } catch (e) {
    console.warn(`  Unable to get statistics: ${e.message}`);
  }

  // Check DemoRoot
  console.log("\n" + "=".repeat(70));
  console.log("Check Default Test Person");
  console.log("=".repeat(70));

  const demoPersonData = {
    fullName: "DemoRoot",
    passphrase: "",
    isBirthBC: false,
    birthYear: 1970,
    birthMonth: 1,
    birthDay: 1,
    gender: 1,
  };

  await checkPerson(deepFamily, demoPersonData, 1);

  // Check LargeRoot (for seed-large-v2.js)
  console.log("\n" + "=".repeat(70));
  console.log("Check Large Scale Test Root Node");
  console.log("=".repeat(70));

  const largeRootData = {
    fullName: "LargeRoot",
    passphrase: "",
    isBirthBC: false,
    birthYear: Number(process.env.BASE_YEAR || 1950),
    birthMonth: 1,
    birthDay: 1,
    gender: 1,
  };

  await checkPerson(deepFamily, largeRootData, 1);

  // If environment variables provided, check custom person
  const customName = process.env.PERSON_NAME;
  const customHash = process.env.PERSON_HASH;

  if (customHash) {
    // Query directly by hash
    console.log("\n" + "=".repeat(70));
    console.log("Check Custom Person (by hash)");
    console.log("=".repeat(70));
    console.log(`\nHash: ${customHash}`);

    const version = Number(process.env.PERSON_VERSION || 1);
    const existsResult = await checkPersonExists({
      deepFamily,
      personHash: customHash,
      versionIndex: version,
    });

    if (existsResult.exists) {
      console.log(`✓ Person exists (total versions: ${existsResult.totalVersions})`);
      // Get detailed info (reuse logic above)
      try {
        const versionDetails = await deepFamily.getVersionDetails(customHash, version);
        console.log(`\nVersion ${version} details:`);
        console.log(`  Tag: ${versionDetails.tag}`);
        console.log(`  IPFS CID: ${versionDetails.ipfsCID}`);
        console.log(`  Added at: ${new Date(Number(versionDetails.timestamp) * 1000).toISOString()}`);
      } catch (e) {
        console.warn(`  Failed to get details: ${e.message}`);
      }
    } else {
      console.log(`❌ Person does not exist`);
    }
  } else if (customName) {
    // Query by name and birth info
    console.log("\n" + "=".repeat(70));
    console.log("Check Custom Person (by name)");
    console.log("=".repeat(70));

    const customPersonData = {
      fullName: customName,
      passphrase: process.env.PERSON_PASSPHRASE || "",
      isBirthBC: process.env.PERSON_BIRTH_BC === "true",
      birthYear: Number(process.env.PERSON_BIRTH_YEAR || 0),
      birthMonth: Number(process.env.PERSON_BIRTH_MONTH || 0),
      birthDay: Number(process.env.PERSON_BIRTH_DAY || 0),
      gender: Number(process.env.PERSON_GENDER || 0),
    };

    const version = Number(process.env.PERSON_VERSION || 1);
    await checkPerson(deepFamily, customPersonData, version);
  }

  console.log("\n" + "=".repeat(70));
  console.log("✨ Check Complete");
  console.log("=".repeat(70));
  console.log("\nUsage:");
  console.log("  By name: PERSON_NAME='John Doe' PERSON_BIRTH_YEAR=1990 PERSON_GENDER=1 npm run check:root");
  console.log("  By hash: PERSON_HASH=0x123... npm run check:root");
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
