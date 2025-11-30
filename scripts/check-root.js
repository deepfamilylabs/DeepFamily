const hre = require("hardhat");
const path = require("path");
const fs = require("fs");
const { computePersonHash, checkPersonExists, getAllRoots } = require("../lib/seedHelpers");

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

  // Load all multi-language roots
  const allRoots = getAllRoots();

  // Display all known root hashes
  console.log("\n" + "=".repeat(70));
  console.log("Multi-Language Root Hashes");
  console.log("=".repeat(70));

  const rootHashes = {};
  for (const [langKey, personData] of Object.entries(allRoots)) {
    const hash = await computePersonHash({ deepFamily, personData });
    rootHashes[langKey] = { hash, personData };

    const langLabel =
      {
        en: "🇺🇸 English Root (Kennedy Family)",
        zh: "🇨🇳 Chinese Root (曹操家族)",
      }[langKey] || `🌐 ${langKey.toUpperCase()} Root`;

    console.log(`\n${langLabel}:`);
    console.log(`  Name: ${personData.fullName}`);
    if (personData.familyName) {
      console.log(`  Family: ${personData.familyName}`);
    }
    console.log(`  Passphrase: "${personData.passphrase}"`);
    console.log(
      `  Birth: ${personData.birthYear}-${String(personData.birthMonth).padStart(2, "0")}-${String(personData.birthDay).padStart(2, "0")}`,
    );
    console.log(`  Hash: ${hash}`);
  }

  // Check specific root or all roots
  const customName = process.env.PERSON_NAME;
  const customHash = process.env.PERSON_HASH;
  const checkAllRoots = process.env.CHECK_ALL_ROOTS === "true";
  const checkLang = process.env.CHECK_LANG; // e.g., "en", "zh"

  // Default behavior: Quick check all language root hashes
  if (!customName && !customHash && !checkAllRoots && !checkLang) {
    console.log("\n" + "=".repeat(70));
    console.log("Quick Check: All Multi-Language Root Hash Status (Default)");
    console.log("=".repeat(70));

    const summary = [];
    for (const [langKey, { hash, personData }] of Object.entries(rootHashes)) {
      const langLabel =
        {
          en: "🇺🇸 EN",
          zh: "🇨🇳 ZH",
        }[langKey] || langKey.toUpperCase();

      const existsResult = await checkPersonExists({
        deepFamily,
        personHash: hash,
        versionIndex: 1,
      });

      const status = existsResult.exists ? "✓" : "✗";
      const versions = existsResult.exists ? `(${existsResult.totalVersions}v)` : "";

      summary.push({
        lang: langLabel,
        name: personData.fullName,
        hash: hash,
        exists: existsResult.exists,
        versions: existsResult.totalVersions,
        status: status,
      });

      console.log(
        `${status} [${langLabel.padEnd(4)}] ${personData.fullName.padEnd(25)} ${versions}`,
      );
    }

    // Summary statistics
    const totalRoots = summary.length;
    const existingRoots = summary.filter((s) => s.exists).length;
    const totalVersions = summary.reduce((sum, s) => sum + s.versions, 0);

    console.log("\n" + "─".repeat(70));
    console.log(`Summary: ${existingRoots}/${totalRoots} roots exist on-chain`);
    console.log(`Total versions across all roots: ${totalVersions}`);
    console.log("─".repeat(70));

    // Show detailed hashes table
    console.log("\nDetailed Hash Reference:");
    for (const item of summary) {
      console.log(`\n[${item.lang}] ${item.name}`);
      console.log(`    Hash: ${item.hash}`);
      console.log(
        `    Status: ${item.exists ? `Exists (${item.versions} versions)` : "Not found"}`,
      );
    }

    // Check NFT minting status for existing roots
    console.log("\n" + "─".repeat(70));
    console.log("NFT Minting Status:");
    console.log("─".repeat(70));
    for (const item of summary) {
      if (item.exists) {
        try {
          const nftId = await deepFamily.personVersionNFT(item.hash, 1);
          const isMinted = nftId && Number(nftId) !== 0;
          const mintStatus = isMinted ? `✓ Minted (TokenID: ${nftId.toString()})` : "○ Not minted";
          console.log(`[${item.lang}] ${item.name.padEnd(25)} ${mintStatus}`);
        } catch (e) {
          console.log(`[${item.lang}] ${item.name.padEnd(25)} ○ Not minted`);
        }
      }
    }
  } else if (checkAllRoots) {
    // Detailed check all language roots
    console.log("\n" + "=".repeat(70));
    console.log("Detailed Check: All Multi-Language Root Nodes");
    console.log("=".repeat(70));

    for (const [langKey, { personData }] of Object.entries(rootHashes)) {
      const langLabel =
        {
          en: "🇺🇸 English Root",
          zh: "🇨🇳 Chinese Root",
        }[langKey] || `🌐 ${langKey.toUpperCase()} Root`;

      console.log(`\n${"─".repeat(70)}`);
      console.log(`${langLabel}: ${personData.fullName}`);
      console.log("─".repeat(70));
      await checkPerson(deepFamily, personData, 1);
    }
  } else if (checkLang) {
    // Check specific language root
    console.log("\n" + "=".repeat(70));
    console.log(`Check ${checkLang.toUpperCase()} Language Root`);
    console.log("=".repeat(70));

    if (rootHashes[checkLang]) {
      await checkPerson(deepFamily, rootHashes[checkLang].personData, 1);
    } else {
      console.log(
        `❌ Language '${checkLang}' not found. Available: ${Object.keys(rootHashes).join(", ")}`,
      );
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
  console.log("  Default - Quick check all root hashes:");
  console.log("    npm run check:root");
  console.log("\n  Detailed check all language roots:");
  console.log("    CHECK_ALL_ROOTS=true npm run check:root");
  console.log("\n  Check specific language root:");
  console.log("    CHECK_LANG=en npm run check:root      # English (Kennedy)");
  console.log("    CHECK_LANG=zh npm run check:root      # Simplified Chinese (曹操)");
  console.log("\n  By custom name:");
  console.log(
    "    PERSON_NAME='John Doe' PERSON_BIRTH_YEAR=1990 PERSON_GENDER=1 npm run check:root",
  );
  console.log("\n  By hash:");
  console.log("    PERSON_HASH=0x123... npm run check:root");
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
