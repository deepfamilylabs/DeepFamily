const hre = require("hardhat");
const { ethers } = hre;
const {
  addPersonVersion,
  endorseVersion,
  mintPersonNFT,
  computePersonHash,
  checkPersonExists,
} = require("../lib/seedHelpers");

// Debug logging switch
const DEBUG_ENABLED = process.env.DEBUG_SEED === "1";
function dlog(...args) {
  if (DEBUG_ENABLED) console.log("[DEBUG]", ...args);
}

// Regular heartbeat
let HEARTBEAT;
if (DEBUG_ENABLED) {
  HEARTBEAT = setInterval(
    () => console.log(`[DEBUG][heartbeat] ${new Date().toISOString()}`),
    15000
  );
}

/**
 * Helper function: Create basic person info object
 */
function createPersonData(fullName, birthYear, gender, options = {}) {
  return {
    fullName,
    passphrase: options.passphrase || "",
    isBirthBC: options.isBirthBC || false,
    birthYear: birthYear || 0,
    birthMonth: options.birthMonth || 1,
    birthDay: options.birthDay || 1,
    gender: gender || 0,
  };
}

/**
 * Helper function: Create supplement info object
 */
function createSupplementInfo(fullName, birthPlace, options = {}) {
  return {
    fullName,
    birthPlace: birthPlace || "",
    isDeathBC: options.isDeathBC || false,
    deathYear: options.deathYear || 0,
    deathMonth: options.deathMonth || 0,
    deathDay: options.deathDay || 0,
    deathPlace: options.deathPlace || "",
    story: options.story || "",
  };
}

/**
 * Main function: Demo complete workflow
 */
async function main() {
  console.log("=".repeat(60));
  console.log("DeepFamily Seed Generation Script V2");
  console.log("Uses modular helper functions to reuse tasks logic");
  console.log("=".repeat(60));

  // 1. Get deployed contracts
  const { deployments } = hre;
  const { get } = deployments;

  let deepDeployment, tokenDeployment;
  try {
    deepDeployment = await get("DeepFamily");
    tokenDeployment = await get("DeepFamilyToken");
  } catch {
    console.log("Contracts not deployed, running deployment...");
    await deployments.fixture(["Integrated"]);
    deepDeployment = await get("DeepFamily");
    tokenDeployment = await get("DeepFamilyToken");
  }

  const [signer] = await ethers.getSigners();
  const signerAddr = await signer.getAddress();
  const deepFamily = await ethers.getContractAt("DeepFamily", deepDeployment.address, signer);
  const token = await ethers.getContractAt("DeepFamilyToken", tokenDeployment.address, signer);

  console.log(`\nContract addresses:`);
  console.log(`  DeepFamily: ${deepDeployment.address}`);
  console.log(`  DeepFamilyToken: ${tokenDeployment.address}`);
  console.log(`  Signer: ${signerAddr}\n`);

  // 2. Read config from environment variables (or use defaults)
  const TARGET_DEPTH = Number(process.env.TARGET_DEPTH || 3);
  const TARGET_NFT_COUNT = Number(process.env.TARGET_NFT_COUNT || 5);
  const BASE_YEAR = Number(process.env.BASE_YEAR || 1950);
  const DEFAULT_PLACE = process.env.DEFAULT_PLACE || "US-CA-Los Angeles";

  console.log(`Configuration:`);
  console.log(`  Target depth: ${TARGET_DEPTH}`);
  console.log(`  Target NFT count: ${TARGET_NFT_COUNT}`);
  console.log(`  Base year: ${BASE_YEAR}`);
  console.log(`  Default place: ${DEFAULT_PLACE}\n`);

  // 3. Create or get root node
  console.log("Step 1: Create/get root node");
  console.log("-".repeat(60));

  // Note: DemoRoot uses fixed 1970 year, consistent with seed-demo.js and check-root.js
  const rootPersonData = createPersonData("DemoRoot", 1970, 1);
  const rootHash = await computePersonHash({ deepFamily, personData: rootPersonData });
  console.log(`Root node hash: ${rootHash}`);

  const rootExists = await checkPersonExists({ deepFamily, personHash: rootHash });
  if (!rootExists.exists) {
    console.log("Root node doesn't exist, creating...");
    const result = await addPersonVersion({
      deepFamily,
      signer,
      personData: rootPersonData,
      tag: "v1",
      ipfs: "QmDemoRoot",
    });
    console.log(`✓ Root node created, tx hash: ${result.tx.hash}`);
  } else {
    console.log(`✓ Root node exists, versions: ${rootExists.totalVersions}`);
  }

  // 4. Build family tree (multiple generations)
  console.log("\nStep 2: Build family tree");
  console.log("-".repeat(60));

  const familyTree = new Map(); // generation => [nodes]
  familyTree.set(1, [{ hash: rootHash, personData: rootPersonData, version: 1, name: "DemoRoot" }]);

  for (let gen = 2; gen <= TARGET_DEPTH; gen++) {
    console.log(`\nGenerating generation ${gen}...`);
    const prevGen = familyTree.get(gen - 1);
    const currentGen = [];

    // Create 1-2 children for each person in previous generation
    for (const parent of prevGen) {
      const numChildren = Math.floor(Math.random() * 2) + 1; // 1-2 children
      
      for (let i = 0; i < numChildren; i++) {
        const childName = `Person_G${gen}_${currentGen.length + 1}`;
        const childGender = Math.random() > 0.5 ? 1 : 2;
        const childYear = BASE_YEAR + gen * 25 + Math.floor(Math.random() * 5);

        const childData = createPersonData(childName, childYear, childGender);
        const childHash = await computePersonHash({ deepFamily, personData: childData });

        // Check if already exists
        const childExists = await checkPersonExists({ deepFamily, personHash: childHash });

        if (!childExists.exists) {
          try {
            // Add child (father is parent, mother optional)
            const result = await addPersonVersion({
              deepFamily,
              signer,
              personData: childData,
              fatherData: parent.personData,
              fatherVersion: parent.version,
              tag: "v1",
              ipfs: `QmChild_${childName}`,
            });

            console.log(`  ✓ Added: ${childName} (father: ${parent.name})`);
            currentGen.push({
              hash: childHash,
              personData: childData,
              version: 1,
              name: childName,
              parent: parent.hash,
            });
          } catch (error) {
            console.warn(`  ✗ Add failed: ${childName} - ${error.message?.slice(0, 100)}`);
          }
        } else {
          console.log(`  ○ Already exists: ${childName}`);
          currentGen.push({
            hash: childHash,
            personData: childData,
            version: 1,
            name: childName,
            parent: parent.hash,
          });
        }
      }
    }

    familyTree.set(gen, currentGen);
    console.log(`Generation ${gen} complete: ${currentGen.length} people`);
  }

  // Count total people
  let totalPeople = 0;
  for (const [gen, people] of familyTree) {
    totalPeople += people.length;
  }
  console.log(`\nFamily tree complete: ${TARGET_DEPTH} generations, ${totalPeople} people`);

  // 5. Randomly select people to endorse and mint NFT
  console.log("\nStep 3: Endorse and mint NFTs");
  console.log("-".repeat(60));

  // Collect all non-root people (exclude first generation)
  const allPeople = [];
  for (const [gen, people] of familyTree) {
    if (gen > 1) {
      allPeople.push(...people);
    }
  }

  // Randomly shuffle and select first N
  const shuffled = allPeople.sort(() => Math.random() - 0.5);
  const selectedForNFT = shuffled.slice(0, Math.min(TARGET_NFT_COUNT, allPeople.length));

  console.log(`Selected ${selectedForNFT.length} people from ${allPeople.length} to mint NFTs\n`);

  let mintedCount = 0;
  for (const person of selectedForNFT) {
    try {
      console.log(`Processing: ${person.name}`);

      // 3.1 Endorse
      console.log(`  - Endorsing version...`);
      const endorseResult = await endorseVersion({
        deepFamily,
        token,
        signer,
        personHash: person.hash,
        versionIndex: person.version,
        autoApprove: true,
      });
      console.log(`    ✓ Endorse success (fee: ${ethers.formatUnits(endorseResult.fee, 18)} DEEP)`);

      // 3.2 Mint NFT
      console.log(`  - Minting NFT...`);
      const supplementInfo = createSupplementInfo(
        person.personData.fullName,
        DEFAULT_PLACE,
        {
          deathYear: person.personData.birthYear + 70,
          deathMonth: 12,
          deathDay: 31,
          deathPlace: DEFAULT_PLACE,
          story: `Life story of ${person.name}`,
        }
      );

      const mintResult = await mintPersonNFT({
        deepFamily,
        signer,
        personHash: person.hash,
        versionIndex: person.version,
        tokenURI: `ipfs://seed-nft-${person.name}`,
        basicInfo: person.personData,
        supplementInfo,
      });

      console.log(`    ✓ NFT minted successfully (TokenID: ${mintResult.tokenId?.toString() || "unknown"})\n`);
      mintedCount++;
    } catch (error) {
      console.warn(`  ✗ Processing failed: ${error.message?.slice(0, 150)}\n`);
    }
  }

  // 6. Summary
  console.log("\n" + "=".repeat(60));
  console.log("Seed generation complete!");
  console.log("=".repeat(60));
  console.log(`Statistics:`);
  console.log(`  Total people: ${totalPeople}`);
  console.log(`  Successfully minted NFTs: ${mintedCount}/${selectedForNFT.length}`);
  console.log(`  Family depth: ${TARGET_DEPTH} generations`);

  // Query current NFT count
  try {
    const totalSupply = await deepFamily.tokenCounter();
    console.log(`  Total NFT supply: ${totalSupply.toString()}`);
  } catch (e) {
    dlog("Unable to query NFT total supply:", e.message);
  }

  console.log("\n✨ Complete!\n");

  // Clean up heartbeat
  if (DEBUG_ENABLED && HEARTBEAT) {
    clearInterval(HEARTBEAT);
  }
}

// Execute main function
main()
  .then(() => {
    if (DEBUG_ENABLED && HEARTBEAT) clearInterval(HEARTBEAT);
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    if (DEBUG_ENABLED && HEARTBEAT) clearInterval(HEARTBEAT);
    process.exit(1);
  });

