/**
 * seed-historical.js
 * Generate demo data using real historical person data
 * Features:
 * - Historical persons without copyright issues (public domain)
 * - 19 chunk types corresponding to real biographical content
 * - Each chunk close to 2048 byte limit
 * - Real family relationships
 * - Data and logic separated (loaded from JSON files)
 * - Multi-language support with batch seeding capability
 *
 * Default Behavior:
 *   By default, seeds both English and Simplified Chinese data (en + zh)
 *   This provides good coverage for the main user base with reasonable cost
 *
 * Usage:
 *   # Default: Seed English and Simplified Chinese
 *   npm run seed:historical
 *
 *   # Specific single language only
 *   HISTORICAL_DATA_FILE=en-family.json npm run seed:historical
 *   HISTORICAL_DATA_FILE=zh-family.json npm run seed:historical
 *
 *   # All languages (en, zh)
 *   SEED_ALL_LANGUAGES=true npm run seed:historical
 *
 *   # Custom language selection
 *   LANGUAGES=en,zh npm run seed:historical
 *
 * Available language codes:
 *   en    - English (Kennedy Family) [Default]
 *   zh    - Simplified Chinese (曹操家族) [Default]
 */

const hre = require("hardhat");
const { ethers } = hre;
const path = require("path");
const fs = require("fs");
const {
  addPersonVersion,
  endorseVersion,
  mintPersonNFT,
  computePersonHash,
  checkPersonExists,
} = require("../lib/seedHelpers");

// ========== Constants Configuration ==========

const MAX_CHUNK_CONTENT_LENGTH = 2048;
const MAX_LONG_TEXT_LENGTH = 256;

// Data file paths
const DATA_DIR = path.join(__dirname, "..", "data", "persons");
const DEFAULT_DATA_FILE = "en-family.json";

// Environment variables configuration
const DATA_FILE = process.env.HISTORICAL_DATA_FILE || null; // null means use default multi-language mode
const SEED_ALL_LANGUAGES = process.env.SEED_ALL_LANGUAGES === "true";
// Default to Chinese and English if not specified
const SELECTED_LANGUAGES = process.env.LANGUAGES
  ? process.env.LANGUAGES.split(",").map(l => l.trim())
  : ["zh", "en"]; // Default priority: Simplified Chinese then English

// Multi-language family passphrase mapping
// Maps familyName to standardized passphrase for consistency with seedHelpers
const FAMILY_PASSPHRASES = {
  "Kennedy Family": "Kennedy Family-tree",
  "曹操家族": "曹操家谱",
};

// Multi-language data files configuration
const LANGUAGE_CONFIGS = [
  { lang: "zh", file: "zh-family.json", name: "Chinese (曹操家族)" },
  { lang: "en", file: "en-family.json", name: "English (Kennedy Family)" },
];

// ========== Utility Functions ==========

// UTF-8 byte length calculation
function utf8ByteLen(s) {
  return Buffer.byteLength(s, "utf8");
}

// UTF-8 safe truncation (avoid cutting multi-byte characters)
function truncateUtf8Bytes(str, maxBytes) {
  if (utf8ByteLen(str) <= maxBytes) return str;
  let res = "";
  for (const ch of str) {
    const nb = utf8ByteLen(ch);
    if (utf8ByteLen(res) + nb > maxBytes) break;
    res += ch;
  }
  return res;
}

// keccak256 string hash
function solidityStringHash(content) {
  return ethers.keccak256(ethers.toUtf8Bytes(content));
}

// ========== Data Loading and Validation ==========

/**
 * Automatically calculate generation for each member based on parent relationships
 * @param {Array} members - Array of family members
 * @returns {Array} Members with calculated generation
 */
function calculateGenerations(members) {
  // Create a map for quick lookup
  const memberMap = new Map();
  members.forEach(m => memberMap.set(m.fullName, m));

  // Find root members (those without father AND mother)
  const roots = members.filter(m => !m.fatherName && !m.motherName);
  
  if (roots.length === 0) {
    throw new Error("No root member found (member without both father and mother)");
  }

  console.log(`Found ${roots.length} root member(s): ${roots.map(r => r.fullName).join(", ")}`);

  // BFS to calculate generations
  const generationMap = new Map();
  const queue = roots.map(r => ({ name: r.fullName, generation: 1 }));

  while (queue.length > 0) {
    const { name, generation } = queue.shift();
    
    if (generationMap.has(name)) {
      continue; // Already processed
    }

    generationMap.set(name, generation);

    // Find all children of this person
    const children = members.filter(m => 
      m.fatherName === name || m.motherName === name
    );

    for (const child of children) {
      if (!generationMap.has(child.fullName)) {
        queue.push({ name: child.fullName, generation: generation + 1 });
      }
    }
  }

  // Apply calculated generations to members
  members.forEach(m => {
    const calculatedGen = generationMap.get(m.fullName);
    if (calculatedGen !== undefined) {
      m.generation = calculatedGen;
    } else {
      console.warn(`⚠ Could not calculate generation for: ${m.fullName}`);
      // Keep original generation or set to 1 if not set
      if (m.generation === undefined) {
        m.generation = 1;
      }
    }
  });

  // Log generation statistics
  const genStats = {};
  members.forEach(m => {
    genStats[m.generation] = (genStats[m.generation] || 0) + 1;
  });
  
  console.log("✓ Generation calculation complete:");
  Object.keys(genStats).sort((a, b) => a - b).forEach(gen => {
    console.log(`  Generation ${gen}: ${genStats[gen]} members`);
  });

  return members;
}

/**
 * Load historical person data
 * @param {string} filename - JSON file name
 * @returns {Object} Family data object
 */
function loadHistoricalData(filename) {
  const filePath = path.join(DATA_DIR, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Data file not found: ${filePath}`);
  }

  try {
    const rawData = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(rawData);

    // Calculate generations dynamically based on parent relationships
    data.members = calculateGenerations(data.members);

    // Validate data structure
    validateFamilyData(data);

    console.log(`✓ Loaded data: ${data.familyName}`);
    console.log(`  Description: ${data.description}`);
    console.log(`  Members: ${data.members.length}\n`);

    return data;
  } catch (error) {
    throw new Error(`Failed to load data file: ${error.message}`);
  }
}

/**
 * Validate family data structure
 * @param {Object} data - Family data
 */
function validateFamilyData(data) {
  if (!data.familyName) {
    throw new Error("Missing required field: familyName");
  }

  if (!Array.isArray(data.members) || data.members.length === 0) {
    throw new Error("Invalid or empty members array");
  }

  // Validate each member
  data.members.forEach((member, index) => {
    // Note: generation is now auto-calculated, not required in JSON
    const required = ["fullName", "birthYear", "gender"];
    for (const field of required) {
      if (member[field] === undefined || member[field] === null) {
        throw new Error(
          `Member ${index} (${member.fullName || "unknown"}) missing required field: ${field}`,
        );
      }
    }

    // Validate storyData exists
    if (!member.storyData || typeof member.storyData !== "object") {
      throw new Error(`Member ${index} (${member.fullName}) missing storyData object`);
    }
  });

  console.log("✓ Data validation passed");
}

// ========== Story Data Processing ==========
// Story data is now stored directly in JSON as arrays of strings
// Each array element represents one chunk of content

// ========== Person Data Creation Helper Functions ==========

function createPersonData(personInfo) {
  return {
    fullName: personInfo.fullName,
    birthYear: personInfo.birthYear,
    birthMonth: personInfo.birthMonth || 1,
    birthDay: personInfo.birthDay || 1,
    gender: personInfo.gender,
  };
}

function createSupplementInfo(personInfo) {
  // story field is a brief life summary, different from storyData.summary
  // If person has a dedicated 'story' field, use it; otherwise use empty string
  // The detailed content is stored in story chunks (storyData)
  const storyBrief = personInfo.story || "";

  return {
    deathYear: personInfo.deathYear || 0,
    deathMonth: personInfo.deathMonth || 0,
    deathDay: personInfo.deathDay || 0,
    birthPlace: personInfo.birthPlace || "",
    deathPlace: personInfo.deathPlace || "",
    story: truncateUtf8Bytes(storyBrief, MAX_LONG_TEXT_LENGTH),
  };
}

// ========== Main Execution Function ==========

/**
 * Seed a single language family data
 */
async function seedSingleLanguage(dataFile, deepFamily, token, signer) {
  console.log("\n" + "=".repeat(60));
  console.log(`Seeding data file: ${dataFile}`);
  console.log("=".repeat(60));

  // Load historical person data
  const familyData = loadHistoricalData(dataFile);

  // Step 1: Token approval
  console.log("Step 1: Preparing token approval...");
  const deepFamilyAddr = deepFamily.target || deepFamily.address;
  const allowance = await token.allowance(signer.address, deepFamilyAddr);
  if (allowance === 0n) {
    const approveTx = await token.approve(deepFamilyAddr, ethers.MaxUint256);
    await approveTx.wait();
    console.log("✓ Token approved\n");
  } else {
    console.log("✓ Token already approved\n");
  }

  // Step 2: Add historical persons
  console.log(`Step 2: Adding ${familyData.familyName} members...`);

  const addedPersons = [];

  for (const personInfo of familyData.members) {
    console.log(`\nProcessing: ${personInfo.fullName} (Gen ${personInfo.generation})`);

    // Create person data
    const personData = createPersonData(personInfo);

    // Add passphrase to personData
    // Priority: 1) individual passphrase, 2) family mapping, 3) default pattern
    const familyPassphrase = FAMILY_PASSPHRASES[familyData.familyName];
    const personDataWithPassphrase = {
      ...personData,
      passphrase: personInfo.passphrase || familyPassphrase || `${familyData.familyName}-tree`,
    };

    // Compute personHash
    const personHash = await computePersonHash({
      deepFamily,
      personData: personDataWithPassphrase,
    });

    // Check if already exists
    const exists = await checkPersonExists({ deepFamily, personHash });

    if (exists.exists) {
      console.log(`  ○ Already exists: ${personInfo.fullName} (versions: ${exists.totalVersions})`);
      const savedPerson = {
        ...personInfo,
        hash: personHash,
        version: 1, // Use first version
        personData: personDataWithPassphrase,
      };
      addedPersons.push(savedPerson);
      continue;
    }

    // Find parent data
    let fatherData = null;
    let fatherVersion = 0;

    if (personInfo.fatherName) {
      const father = addedPersons.find((p) => p.fullName === personInfo.fatherName);
      if (father) {
        fatherData = father.personData;
        fatherVersion = father.version;
        console.log(`  Father: ${personInfo.fatherName} (v${fatherVersion})`);
      } else {
        console.log(`  Warning: Father "${personInfo.fatherName}" not found`);
      }
    }

    let motherData = null;
    let motherVersion = 0;

    if (personInfo.motherName) {
      const mother = addedPersons.find((p) => p.fullName === personInfo.motherName);
      if (mother) {
        motherData = mother.personData;
        motherVersion = mother.version;
        console.log(`  Mother: ${personInfo.motherName} (v${motherVersion})`);
      }
    }

    // Add person (using ZK proof)
    await addPersonVersion({
      deepFamily,
      signer,
      personData: personDataWithPassphrase,
      fatherData,
      motherData,
      fatherVersion,
      motherVersion,
      tag: personInfo.tag || `gen${personInfo.generation}`,
      ipfs:
        personInfo.metadataCID ||
        `ipfs://${familyData.familyName.toLowerCase().replace(/ /g, "-")}/${personInfo.fullName.replace(/ /g, "-")}`,
    });

    const savedPerson = {
      ...personInfo,
      hash: personHash,
      version: 1, // Newly added version index is 1
      personData: personDataWithPassphrase,
    };
    addedPersons.push(savedPerson);

    console.log(`✓ Added ${personInfo.fullName}`);
    console.log(`  Hash: ${personHash.slice(0, 10)}...`);
    console.log(`  Version: 1`);
  }

  console.log(`\n✓ Family tree complete: ${addedPersons.length} persons added\n`);

  // Step 3: Mint NFTs and add Story Chunks
  console.log("Step 3: Minting NFTs and adding story chunks...");

  let nftCount = 0;
  let skippedCount = 0;
  let totalChunks = 0;

  for (const person of addedPersons) {
    // Check if NFT should be minted (defaults to true for backward compatibility)
    const shouldMintNFT = person.mintNFT !== false;

    if (!shouldMintNFT) {
      console.log(`\n⊘ Skipping NFT for: ${person.fullName} (mintNFT=false)`);
      skippedCount++;
      continue;
    }

    console.log(`\nProcessing NFT for: ${person.fullName}`);

    // Endorse
    console.log("  Endorsing...");
    await endorseVersion({
      deepFamily,
      token,
      signer,
      personHash: person.hash,
      versionIndex: person.version,
      autoApprove: true,
    });

    // Mint NFT
    console.log("  Minting NFT...");
    const supplementInfo = createSupplementInfo(person);

    const mintResult = await mintPersonNFT({
      deepFamily,
      signer,
      personHash: person.hash,
      versionIndex: person.version,
      tokenURI: `ipfs://${familyData.familyName.toLowerCase().replace(/ /g, "-")}-nft/${person.fullName.replace(/ /g, "-")}`,
      basicInfo: person.personData,
      supplementInfo,
    });

    const tokenId = mintResult.tokenId;
    console.log(`  ✓ NFT minted, tokenId: ${tokenId}`);
    nftCount++;

    // Add Story Chunks - all chunks from JSON data
    // Collect available story data chunks from JSON
    // Each chunk is now: { type: number, content: string, arrayIndex: number }
    const availableChunks = [];
    const storyData = person.storyData || {};

    // Map chunk type to storyData field
    const chunkFieldMap = {
      0: 'summary',
      1: 'earlyLife',
      2: 'education',
      3: 'lifeEvents',
      4: 'career',
      5: 'works',
      6: 'achievements',
      7: 'philosophy',
      8: 'quotes',
      9: 'family',
      10: 'lifestyle',
      11: 'relations',
      12: 'activities',
      13: 'anecdotes',
      14: 'controversies',
      15: 'legacy',
      16: 'gallery',
      17: 'references',
      18: 'notes',
    };

    // Check which chunks have real data in JSON
    // Now supports both string and array of strings
    for (let chunkType = 0; chunkType < 19; chunkType++) {
      const fieldName = chunkFieldMap[chunkType];
      if (!fieldName || !storyData[fieldName]) continue;

      const fieldData = storyData[fieldName];

      // Support both string and array formats
      if (Array.isArray(fieldData)) {
        // Array format: each element is a separate chunk
        fieldData.forEach((content, arrayIndex) => {
          if (content && typeof content === 'string' && content.trim().length > 0) {
            availableChunks.push({
              type: chunkType,
              content: content,
              arrayIndex: arrayIndex,
            });
          }
        });
      } else if (typeof fieldData === 'string' && fieldData.trim().length > 0) {
        // Legacy string format: single chunk
        availableChunks.push({
          type: chunkType,
          content: fieldData,
          arrayIndex: 0,
        });
      }
    }

    if (availableChunks.length === 0) {
      console.log(`  ⊘ No story data available in JSON, skipping chunks`);
    } else {
      console.log(`  Adding ${availableChunks.length} story chunks from JSON data...`);

      for (let i = 0; i < availableChunks.length; i++) {
        const chunk = availableChunks[i];
        const content = truncateUtf8Bytes(chunk.content, MAX_CHUNK_CONTENT_LENGTH);
        const expectedHash = solidityStringHash(content);
        const attachmentCID = `ipfs://${familyData.familyName.toLowerCase().replace(/ /g, "-")}-chunk/${person.fullName.replace(/ /g, "-")}/type${chunk.type}-${chunk.arrayIndex}`;

        const chunkTx = await deepFamily.addStoryChunk(
          tokenId,
          i, // Use sequential index as chunk index
          chunk.type, // Chunk type
          content,
          attachmentCID,
          expectedHash,
        );
        await chunkTx.wait();
        totalChunks++;
      }

      console.log(`  ✓ Added ${availableChunks.length} story chunks (from real JSON data)`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Seed Complete!");
  console.log("=".repeat(60));
  console.log(`Family: ${familyData.familyName}`);
  console.log(`Total persons added: ${addedPersons.length}`);
  console.log(`NFTs minted: ${nftCount}`);
  console.log(`NFTs skipped: ${skippedCount}`);
  console.log(`Total story chunks: ${totalChunks}`);
  if (nftCount > 0 && totalChunks > 0) {
    console.log(`Average chunks per NFT: ${(totalChunks / nftCount).toFixed(1)}`);
  }
  console.log("=".repeat(60));

  return {
    familyName: familyData.familyName,
    personsAdded: addedPersons.length,
    nftsMinted: nftCount,
    nftsSkipped: skippedCount,
    storyChunks: totalChunks,
  };
}

/**
 * Main execution function
 * Supports batch seeding of multiple languages or single language mode
 */
async function main() {
  const { ethers, deployments } = hre;

  console.log("=".repeat(70));
  console.log("DeepFamily Historical Data Seeding");
  console.log("=".repeat(70));

  // Get contract instances
  const deepFamilyAddr = (await deployments.get("DeepFamily")).address;
  const tokenAddr = (await deployments.get("DeepFamilyToken")).address;

  const deepFamily = await ethers.getContractAt("DeepFamily", deepFamilyAddr);
  const token = await ethers.getContractAt("DeepFamilyToken", tokenAddr);

  const [signer] = await ethers.getSigners();
  console.log(`\nUsing signer: ${signer.address}`);
  console.log("=".repeat(70));

  // Determine seeding mode
  // Priority: explicit DATA_FILE > SEED_ALL_LANGUAGES > default (en,zh)
  if (DATA_FILE) {
    // Single language mode: explicit file specified
    console.log("\n📄 Single Language Mode");
    console.log("=".repeat(70));
    console.log(`Data file: ${DATA_FILE}\n`);

    await seedSingleLanguage(DATA_FILE, deepFamily, token, signer);
  } else {
    // Batch mode: seed selected languages (default: en,zh or all if SEED_ALL_LANGUAGES=true)
    console.log("\n🌐 Batch Seeding Mode: Multiple Languages");
    console.log("=".repeat(70));

    const languagesToSeed = SEED_ALL_LANGUAGES
      ? LANGUAGE_CONFIGS  // All languages
      : LANGUAGE_CONFIGS.filter(cfg => SELECTED_LANGUAGES.includes(cfg.lang)); // Default: en,zh

    if (languagesToSeed.length === 0) {
      console.error("❌ No valid languages selected!");
      console.error(`Available languages: ${LANGUAGE_CONFIGS.map(c => c.lang).join(", ")}`);
      process.exit(1);
    }

    console.log(`Languages to seed: ${languagesToSeed.map(c => c.name).join(", ")}`);
    console.log(`Total: ${languagesToSeed.length} families\n`);

    const results = [];

    for (const config of languagesToSeed) {
      try {
        console.log(`\n${"━".repeat(70)}`);
        console.log(`🌍 Starting: ${config.name} (${config.lang})`);
        console.log("━".repeat(70));

        const result = await seedSingleLanguage(config.file, deepFamily, token, signer);
        results.push({
          lang: config.lang,
          name: config.name,
          success: true,
          ...result,
        });

        console.log(`✓ ${config.name} completed successfully`);
      } catch (error) {
        console.error(`\n❌ Failed to seed ${config.name}:`);
        console.error(error.message);
        results.push({
          lang: config.lang,
          name: config.name,
          success: false,
          error: error.message,
        });
      }
    }

    // Print summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 BATCH SEEDING SUMMARY");
    console.log("=".repeat(70));

    let totalPersons = 0;
    let totalNFTs = 0;
    let totalChunks = 0;
    let successCount = 0;

    for (const result of results) {
      const status = result.success ? "✓" : "✗";
      console.log(`\n[${status}] ${result.name} (${result.lang})`);

      if (result.success) {
        console.log(`    Family: ${result.familyName}`);
        console.log(`    Persons: ${result.personsAdded}`);
        console.log(`    NFTs: ${result.nftsMinted}`);
        console.log(`    Chunks: ${result.storyChunks}`);
        totalPersons += result.personsAdded;
        totalNFTs += result.nftsMinted;
        totalChunks += result.storyChunks;
        successCount++;
      } else {
        console.log(`    Error: ${result.error}`);
      }
    }

    console.log("\n" + "─".repeat(70));
    console.log(`Total Results: ${successCount}/${results.length} families succeeded`);
    console.log(`Total Persons: ${totalPersons}`);
    console.log(`Total NFTs: ${totalNFTs}`);
    console.log(`Total Story Chunks: ${totalChunks}`);
    console.log("=".repeat(70));
  }

  console.log("\n✨ Seeding process complete!\n");
}

// Execute
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n" + "=".repeat(60));
    console.error("ERROR:");
    console.error("=".repeat(60));
    console.error(error);
    console.error("=".repeat(60));
    process.exit(1);
  });
