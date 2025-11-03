const hre = require("hardhat");
const path = require("path");
const fs = require("fs");
const { DEMO_ROOT_PERSON, computePersonHash, checkPersonExists } = require("../lib/seedHelpers");

// Historical persons preset data
const HISTORICAL_PERSONS = {
  "Patrick Joseph Kennedy": {
    fullName: "Patrick Joseph Kennedy",
    passphrase: "Kennedy Family-tree",
    birthYear: 1858,
    birthMonth: 1,
    birthDay: 14,
    gender: 1,
  },
  "Joseph Patrick Kennedy Sr": {
    fullName: "Joseph Patrick Kennedy Sr",
    passphrase: "Kennedy Family-tree",
    birthYear: 1888,
    birthMonth: 9,
    birthDay: 6,
    gender: 1,
  },
  "John Fitzgerald Kennedy": {
    fullName: "John Fitzgerald Kennedy",
    passphrase: "Kennedy Family-tree",
    birthYear: 1917,
    birthMonth: 5,
    birthDay: 29,
    gender: 1,
  },
  "Robert Francis Kennedy": {
    fullName: "Robert Francis Kennedy",
    passphrase: "Kennedy Family-tree",
    birthYear: 1925,
    birthMonth: 11,
    birthDay: 20,
    gender: 1,
  },
};

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
      console.log(
        `  Father hash: ${versionDetails.fatherHash} (v${versionDetails.fatherVersionIndex})`,
      );
    }
    if (versionDetails.motherHash !== ethers.ZeroHash) {
      console.log(
        `  Mother hash: ${versionDetails.motherHash} (v${versionDetails.motherVersionIndex})`,
      );
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

  // Display all known root hashes
  console.log("\n" + "=".repeat(70));
  console.log("Known Root Hashes");
  console.log("=".repeat(70));

  console.log("\n📋 Demo Data Root:");
  const demoRootHash = await computePersonHash({ deepFamily, personData: DEMO_ROOT_PERSON });
  console.log(`  Name: ${DEMO_ROOT_PERSON.fullName}`);
  console.log(`  Hash: ${demoRootHash}`);

  console.log("\n📋 Historical Data Roots (Kennedy Family):");
  for (const [name, personData] of Object.entries(HISTORICAL_PERSONS)) {
    const hash = await computePersonHash({ deepFamily, personData });
    console.log(`  ${name}:`);
    console.log(`    Hash: ${hash}`);
  }

  // Check DemoRoot
  console.log("\n" + "=".repeat(70));
  console.log("Check Default Test Person (DemoRoot)");
  console.log("=".repeat(70));

  // Use standard demo root person from seedHelpers
  await checkPerson(deepFamily, DEMO_ROOT_PERSON, 1);

  // If environment variables provided, check custom person
  const customName = process.env.PERSON_NAME;
  const customHash = process.env.PERSON_HASH;
  const checkHistorical = process.env.CHECK_HISTORICAL === "true";

  // Quick check for historical persons
  if (checkHistorical) {
    console.log("\n" + "=".repeat(70));
    console.log("Check All Historical Persons (Kennedy Family)");
    console.log("=".repeat(70));

    for (const [name, personData] of Object.entries(HISTORICAL_PERSONS)) {
      console.log(`\n--- ${name} ---`);
      await checkPerson(deepFamily, personData, 1);
    }
  } else if (customHash) {
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
        console.log(
          `  Added at: ${new Date(Number(versionDetails.timestamp) * 1000).toISOString()}`,
        );
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
  console.log("  Check all historical persons:");
  console.log("    CHECK_HISTORICAL=true npm run check:root");
  console.log("\n  By name:");
  console.log("    PERSON_NAME='John Doe' PERSON_BIRTH_YEAR=1990 PERSON_GENDER=1 npm run check:root");
  console.log("\n  By hash:");
  console.log("    PERSON_HASH=0x123... npm run check:root");
  console.log("\n  By historical person name:");
  console.log("    PERSON_NAME='John Fitzgerald Kennedy' PERSON_PASSPHRASE='Kennedy Family-tree' \\");
  console.log("    PERSON_BIRTH_YEAR=1917 PERSON_BIRTH_MONTH=5 PERSON_BIRTH_DAY=29 PERSON_GENDER=1 \\");
  console.log("    npm run check:root");
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
