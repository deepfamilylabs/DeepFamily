const hre = require("hardhat");
const { ethers } = hre;
const {
  addPersonVersion,
  endorseVersion,
  mintPersonNFT,
  computePersonHash,
  checkPersonExists,
} = require("../lib/seedHelpers");

// Debug logging
const DEBUG_ENABLED = process.env.DEBUG_SEED === "1";
function dlog(...args) {
  if (DEBUG_ENABLED) console.log("[DEBUG]", ...args);
}

// Heartbeat
let HEARTBEAT;
if (DEBUG_ENABLED) {
  HEARTBEAT = setInterval(
    () => console.log(`[DEBUG][heartbeat] ${new Date().toISOString()}`),
    15000
  );
}

/**
 * Simple pseudo-random number generator (reproducible)
 */
class SeededRandom {
  constructor(seed = 123456789) {
    this.state = BigInt(seed);
  }

  next() {
    this.state = (this.state * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return Number(this.state >> 11n) / 2 ** 53;
  }

  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

/**
 * Helper function: Create person data
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
 * Helper function: Create supplement info
 */
function createSupplementInfo(fullName, birthPlace, options = {}) {
  const maxStoryLen = 256;
  let story = options.story || `Life story of ${fullName}`;

  // Truncate to max length
  if (Buffer.byteLength(story, "utf8") > maxStoryLen) {
    story = story.substring(0, maxStoryLen);
  }

  return {
    fullName,
    birthPlace: birthPlace || "",
    isDeathBC: options.isDeathBC || false,
    deathYear: options.deathYear || 0,
    deathMonth: options.deathMonth || 0,
    deathDay: options.deathDay || 0,
    deathPlace: options.deathPlace || "",
    story,
  };
}

/**
 * Ensure sufficient DEEP token balance and authorization
 */
async function ensureTokenReady({ deepFamily, token, signer }) {
  const signerAddr = await signer.getAddress();
  const deepFamilyAddr = deepFamily.target || deepFamily.address;

  try {
    // Check token binding
    const bound = await token.deepFamilyContract();
    const isUnbound = !bound || bound === ethers.ZeroAddress;
    const mismatch = String(bound).toLowerCase() !== String(deepFamilyAddr).toLowerCase();

    if (isUnbound || mismatch) {
      console.warn(
        `⚠️  DeepFamilyToken not initialized or bound to different DeepFamily contract`,
        `\n   Bound address: ${bound}`,
        `\n   Expected address: ${deepFamilyAddr}`
      );
      return false;
    }

    // Read fee
    const recentReward = await token.recentReward();
    dlog(`Current recentReward: ${ethers.formatUnits(recentReward, 18)} DEEP`);

    // Pre-authorize
    const allowance = await token.allowance(signerAddr, deepFamilyAddr);
    if (allowance < recentReward || allowance === 0n) {
      console.log(`Approving DeepFamily contract to use DEEP tokens...`);
      const approveTx = await token.connect(signer).approve(deepFamilyAddr, ethers.MaxUint256);
      await approveTx.wait();
      console.log(`✓ Approval complete (MaxUint256)`);
    }

    // Check balance
    const balance = await token.balanceOf(signerAddr);
    dlog(`Current DEEP balance: ${ethers.formatUnits(balance, 18)}`);

    return true;
  } catch (error) {
    console.warn(`⚠️  Token check failed: ${error.message}`);
    return false;
  }
}

/**
 * Main function: Large-scale family tree generation
 */
async function main() {
  console.log("=".repeat(70));
  console.log("DeepFamily Large-Scale Seed Generation Script V2");
  console.log("Uses modular helper functions + 2^n exponential expansion strategy");
  console.log("=".repeat(70));

  // 1. Get contract instances
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

  console.log(`\nContract info:`);
  console.log(`  DeepFamily: ${deepDeployment.address}`);
  console.log(`  DeepFamilyToken: ${tokenDeployment.address}`);
  console.log(`  Signer: ${signerAddr}\n`);

  // 2. Read configuration
  const TARGET_DEPTH_RAW = Number(process.env.TARGET_DEPTH || 5);
  const TARGET_DEPTH =
    TARGET_DEPTH_RAW > 10 && process.env.ALLOW_DEPTH_OVER_10 !== "1" ? 10 : TARGET_DEPTH_RAW;
  const TARGET_NFT_RATIO = Number(process.env.TARGET_NFT_RATIO || 0.5); // Default 50%
  const BASE_YEAR = Number(process.env.BASE_YEAR || 1950);
  const DEFAULT_PLACE = process.env.DEFAULT_PLACE || "US-CA-Los Angeles";
  const SKIP_NFT = process.env.SKIP_NFT === "1";
  const RNG_SEED = BigInt(process.env.RNG_SEED || "123456789");

  console.log(`Configuration:`);
  console.log(`  Target depth: ${TARGET_DEPTH}`);
  console.log(`  NFT mint ratio: ${TARGET_NFT_RATIO * 100}%`);
  console.log(`  Base year: ${BASE_YEAR}`);
  console.log(`  Default place: ${DEFAULT_PLACE}`);
  console.log(`  Skip NFT: ${SKIP_NFT}`);
  console.log(`  Random seed: ${RNG_SEED}\n`);

  const rng = new SeededRandom(RNG_SEED);

  // 3. Prepare token authorization
  console.log("Step 1: Prepare token authorization");
  console.log("-".repeat(70));
  const tokenReady = await ensureTokenReady({ deepFamily, token, signer });
  if (!tokenReady && !SKIP_NFT) {
    console.warn("⚠️  Token not ready, will skip NFT minting phase");
  }

  // 4. Create or get root node
  console.log("\nStep 2: Create/get root node");
  console.log("-".repeat(70));

  let rootHash = process.env.ROOT_HASH;
  let rootVer = Number(process.env.ROOT_VERSION || 1);
  let rootPersonData;

  if (rootHash) {
    console.log(`Using root node specified in environment: ${rootHash}`);
    // Try to get from chain
    try {
      await deepFamily.getVersionDetails(rootHash, rootVer);
      console.log(`✓ Root node exists`);
      // Construct placeholder rootPersonData (cannot recover full info from chain)
      rootPersonData = createPersonData("ExistingRoot", BASE_YEAR, 1);
    } catch (e) {
      throw new Error(`Specified root node ${rootHash} v${rootVer} does not exist`);
    }
  } else {
    // Create new root node
    rootPersonData = createPersonData("LargeRoot", BASE_YEAR, 1);
    rootHash = await computePersonHash({ deepFamily, personData: rootPersonData });
    console.log(`Root node hash: ${rootHash}`);

    const rootExists = await checkPersonExists({ deepFamily, personHash: rootHash });
    if (!rootExists.exists) {
      console.log("Root node doesn't exist, creating...");
      const result = await addPersonVersion({
        deepFamily,
        signer,
        personData: rootPersonData,
        tag: "v1",
        ipfs: "QmLargeRoot",
      });
      console.log(`✓ Root node created, tx hash: ${result.tx.hash}`);
    } else {
      console.log(`✓ Root node exists, versions: ${rootExists.totalVersions}`);
    }
    rootVer = 1;
  }

  // 5. Build family tree (2^n expansion)
  console.log("\nStep 3: Build family tree (2^n expansion)");
  console.log("-".repeat(70));

  const generations = new Map();
  generations.set(1, [
    {
      hash: rootHash,
      personData: rootPersonData,
      version: rootVer,
      name: rootPersonData.fullName,
      generation: 1,
    },
  ]);

  // Main chain: one main person per generation
  const mainChain = [generations.get(1)[0]];

  for (let gen = 2; gen <= TARGET_DEPTH; gen++) {
    console.log(`\nGenerating generation ${gen}...`);
    const prevGen = generations.get(gen - 1);
    if (!prevGen || prevGen.length === 0) {
      console.warn(`Generation ${gen - 1} is empty, cannot continue`);
      break;
    }

    const currentGen = [];

    // Main chain node (one per generation)
    const chainParent = mainChain[mainChain.length - 1];
    const chainChildName = `MainChain_G${gen}`;
    const chainChildData = createPersonData(
      chainChildName,
      BASE_YEAR + gen * 20,
      rng.nextInt(1, 2)
    );
    const chainChildHash = await computePersonHash({ deepFamily, personData: chainChildData });

    const chainExists = await checkPersonExists({ deepFamily, personHash: chainChildHash });
    if (!chainExists.exists) {
      try {
        const result = await addPersonVersion({
          deepFamily,
          signer,
          personData: chainChildData,
          fatherData: chainParent.personData,
          fatherVersion: chainParent.version,
          tag: "v1",
          ipfs: `QmMain_G${gen}`,
        });
        console.log(`  ✓ Main chain: ${chainChildName}`);
        currentGen.push({
          hash: chainChildHash,
          personData: chainChildData,
          version: 1,
          name: chainChildName,
          generation: gen,
          parent: chainParent.hash,
        });
      } catch (error) {
        console.warn(`  ✗ Main chain failed: ${error.message?.slice(0, 100)}`);
        // If main chain fails, try to skip this generation
        break;
      }
    } else {
      console.log(`  ○ Main chain already exists: ${chainChildName}`);
      currentGen.push({
        hash: chainChildHash,
        personData: chainChildData,
        version: 1,
        name: chainChildName,
        generation: gen,
        parent: chainParent.hash,
      });
    }

    // 2^(gen-1) expansion: need 2^(gen-1) - 1 siblings
    const totalThisGen = 2 ** (gen - 1);
    const siblingsCount = totalThisGen - 1;
    let actualSiblingsAdded = 0;

    console.log(`  Target people: ${totalThisGen} (1 main chain + ${siblingsCount} siblings)`);

    for (let i = 0; i < siblingsCount; i++) {
      // Randomly select parent
      const parent = prevGen[Math.floor(rng.next() * prevGen.length)];
      const siblingName = `Person_G${gen}_N${i + 1}`;
      const siblingData = createPersonData(
        siblingName,
        BASE_YEAR + gen * 20 + rng.nextInt(0, 5),
        rng.nextInt(1, 2)
      );
      const siblingHash = await computePersonHash({ deepFamily, personData: siblingData });

      const siblingExists = await checkPersonExists({ deepFamily, personHash: siblingHash });
      if (!siblingExists.exists) {
        try {
          await addPersonVersion({
            deepFamily,
            signer,
            personData: siblingData,
            fatherData: parent.personData,
            fatherVersion: parent.version,
            tag: "v1",
            ipfs: `QmSibling_G${gen}_N${i + 1}`,
          });
          currentGen.push({
            hash: siblingHash,
            personData: siblingData,
            version: 1,
            name: siblingName,
            generation: gen,
            parent: parent.hash,
          });
          actualSiblingsAdded++;
        } catch (error) {
          dlog(`Sibling add failed: ${siblingName}`, error.message?.slice(0, 80));
        }
      } else {
        currentGen.push({
          hash: siblingHash,
          personData: siblingData,
          version: 1,
          name: siblingName,
          generation: gen,
          parent: parent.hash,
        });
        actualSiblingsAdded++;
      }
    }

    generations.set(gen, currentGen);
    mainChain.push(currentGen[0]); // Main chain node is always first

    console.log(
      `  Generation ${gen} complete: planned ${totalThisGen} people, actual ${currentGen.length} people (main chain 1 + siblings ${actualSiblingsAdded})`
    );
  }

  // Statistics
  let totalPeople = 0;
  for (const [, people] of generations) {
    totalPeople += people.length;
  }
  const theoreticalMax = 2 ** TARGET_DEPTH - 1;
  console.log(
    `\nFamily tree complete: ${TARGET_DEPTH} generations, ${totalPeople} people (theoretical max ${theoreticalMax})`
  );

  // 6. Random endorsement and NFT minting
  if (!SKIP_NFT && tokenReady) {
    console.log("\nStep 4: Endorse and mint NFTs");
    console.log("-".repeat(70));

    // Collect all non-root nodes
    const allPeople = [];
    for (const [gen, people] of generations) {
      if (gen > 1) {
        allPeople.push(...people);
      }
    }

    const targetNFTCount = Math.floor(allPeople.length * TARGET_NFT_RATIO);
    console.log(`Selected ${targetNFTCount} people from ${allPeople.length} to mint NFTs\n`);

    // Fisher-Yates shuffle
    const shuffled = allPeople.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const selected = shuffled.slice(0, targetNFTCount);
    let mintedCount = 0;

    for (let idx = 0; idx < selected.length; idx++) {
      const person = selected[idx];
      try {
        // Endorse
        dlog(`Endorsing: ${person.name}`);
        const endorseResult = await endorseVersion({
          deepFamily,
          token,
          signer,
          personHash: person.hash,
          versionIndex: person.version,
          autoApprove: true,
        });
        dlog(`Endorse success, fee: ${ethers.formatUnits(endorseResult.fee, 18)} DEEP`);

        // Mint NFT
        dlog(`Minting NFT: ${person.name}`);
        const supplementInfo = createSupplementInfo(
          person.personData.fullName,
          DEFAULT_PLACE,
          {
            deathYear: person.personData.birthYear + 70 + rng.nextInt(0, 20),
            deathMonth: 12,
            deathDay: 31,
            deathPlace: DEFAULT_PLACE,
            story: `Life record of ${person.name}`,
          }
        );

        const mintResult = await mintPersonNFT({
          deepFamily,
          signer,
          personHash: person.hash,
          versionIndex: person.version,
          tokenURI: `ipfs://large-seed-nft/${person.name}`,
          basicInfo: person.personData,
          supplementInfo,
        });

        mintedCount++;
        if (mintedCount % 5 === 0 || mintedCount === targetNFTCount) {
          console.log(
            `  Progress: ${mintedCount}/${targetNFTCount} (${Math.round((mintedCount / targetNFTCount) * 100)}%)`
          );
        }
        dlog(`NFT minted successfully, TokenID: ${mintResult.tokenId?.toString() || "unknown"}`);
      } catch (error) {
        console.warn(`  Mint failed [${idx + 1}/${selected.length}]: ${error.message?.slice(0, 120)}`);
      }
    }

    console.log(
      `\nNFT minting complete: ${mintedCount}/${targetNFTCount} (${Math.round((mintedCount / allPeople.length) * 100)}%)`
    );
  } else {
    console.log("\nStep 4: Skip NFT minting phase");
  }

  // 7. Summary
  console.log("\n" + "=".repeat(70));
  console.log("✨ Large-scale seed generation complete!");
  console.log("=".repeat(70));
  console.log(`Statistics:`);
  console.log(`  Family depth: ${TARGET_DEPTH} generations`);
  console.log(`  Total people: ${totalPeople}`);
  console.log(`  Theoretical max people (2^${TARGET_DEPTH}-1): ${theoreticalMax}`);
  console.log(`  Coverage: ${Math.round((totalPeople / theoreticalMax) * 100)}%`);

  try {
    const totalSupply = await deepFamily.tokenCounter();
    console.log(`  Total NFT supply: ${totalSupply.toString()}`);
  } catch (e) {
    dlog("Unable to query NFT total supply:", e.message);
  }

  console.log("\n");

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
    console.error(error.stack);
    if (DEBUG_ENABLED && HEARTBEAT) clearInterval(HEARTBEAT);
    process.exit(1);
  });

