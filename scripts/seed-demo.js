const hre = require("hardhat");
const { ethers } = hre;
const {
  DEMO_ROOT_PERSON,
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

// Story chunk constants and helpers
const MAX_CHUNK_CONTENT_LENGTH = 1000;
const MAX_STORY_CHUNKS = 100;

function utf8ByteLen(str) {
  return Buffer.byteLength(str, "utf8");
}

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

function solidityStringHash(s) {
  return ethers.keccak256(ethers.toUtf8Bytes(s));
}

function generateChunkContent(personName, chunkIndex, isMaxLength = false) {
  const baseContent =
    `Story chunk #${chunkIndex} for ${personName}. ` +
    `Contains biographical details and life events. ` +
    `Chunk index: ${chunkIndex}, generation timestamp: ${Date.now()}. `;

  if (!isMaxLength) {
    return baseContent + `Additional life details and memories.`;
  }

  // Generate near max length content
  let content = baseContent;
  const filler = `Extended biographical narrative with detailed life events, achievements, and personal memories. `;

  while (utf8ByteLen(content) < MAX_CHUNK_CONTENT_LENGTH - 50) {
    content += filler;
  }

  return truncateUtf8Bytes(content, MAX_CHUNK_CONTENT_LENGTH);
}

async function addStoryChunks(
  deepFamily,
  tokenId,
  personName,
  numChunks = 5,
  useMaxLength = false,
) {
  console.log(`Adding ${numChunks} story chunks for TokenID ${tokenId} (${personName})...`);

  // Check if contract supports story chunks
  try {
    await deepFamily.MAX_CHUNK_CONTENT_LENGTH();
  } catch (error) {
    console.warn(`  Contract does not support story chunks, skip TokenID ${tokenId}`);
    return 0;
  }

  // Check if NFT exists
  try {
    const owner = await deepFamily.ownerOf(tokenId);
    dlog(`  TokenID ${tokenId} owner: ${owner.slice(0, 8)}...`);
  } catch (error) {
    console.warn(`  TokenID ${tokenId} does not exist, skip`);
    return 0;
  }

  // Check existing story chunks to avoid duplicates
  try {
    const metadata = await deepFamily.getStoryMetadata(tokenId);
    if (metadata.totalChunks > 0) {
      console.log(`  TokenID ${tokenId} already has ${metadata.totalChunks} chunks, skip`);
      return 0;
    }
  } catch (e) {
    // If metadata retrieval fails, assume no chunks yet
    dlog(`  Could not check existing chunks, proceeding...`);
  }

  let addedCount = 0;
  for (let i = 0; i < numChunks; i++) {
    try {
      const content = generateChunkContent(personName, i, useMaxLength);
      const expectedHash = solidityStringHash(content);
      const tx = await deepFamily.addStoryChunk(tokenId, i, content, expectedHash);
      await tx.wait();
      addedCount++;
      console.log(`  Chunk #${i} added, length: ${utf8ByteLen(content)} bytes`);
    } catch (error) {
      console.warn(`  Chunk #${i} failed:`, error.message?.slice(0, 180));
    }
  }

  return addedCount;
}

// Heartbeat
let HEARTBEAT;
if (DEBUG_ENABLED) {
  HEARTBEAT = setInterval(
    () => console.log(`[DEBUG][heartbeat] ${new Date().toISOString()}`),
    15000,
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

  // Generate story content, padded to max length for stress testing
  let story = options.story;
  if (!story) {
    const base = `Life story of ${fullName}. Born in ${birthPlace}. `;
    story = base;
    // Pad with filler text to approach max length
    const filler = "Detailed biographical information and life events. ";
    while (utf8ByteLen(story) < maxStoryLen - 20) {
      story += filler;
    }
  }

  // Safe UTF-8 truncation to max length
  story = truncateUtf8Bytes(story, maxStoryLen);

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
        `\n   Expected address: ${deepFamilyAddr}`,
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
  const STORY_CHUNKS_PER_NFT = Number(process.env.STORY_CHUNKS_PER_NFT || 10); // Default 10 chunks per NFT
  const USE_MAX_LENGTH_CHUNKS = process.env.USE_MAX_LENGTH_CHUNKS === "1"; // Use max length chunks

  console.log(`Configuration:`);
  console.log(`  Target depth: ${TARGET_DEPTH}`);
  console.log(`  NFT mint ratio: ${TARGET_NFT_RATIO * 100}%`);
  console.log(`  Base year: ${BASE_YEAR}`);
  console.log(`  Default place: ${DEFAULT_PLACE}`);
  console.log(`  Skip NFT: ${SKIP_NFT}`);
  console.log(`  Story chunks per NFT: ${STORY_CHUNKS_PER_NFT}`);
  console.log(`  Use max length chunks: ${USE_MAX_LENGTH_CHUNKS}`);
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

  // Use standard demo root person from seedHelpers
  const rootPersonData = DEMO_ROOT_PERSON;
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
  const rootVer = 1;

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
      rng.nextInt(1, 2),
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
      const siblingName = `G${gen}_N${i + 1}`;
      const siblingData = createPersonData(
        siblingName,
        BASE_YEAR + gen * 20 + rng.nextInt(0, 5),
        rng.nextInt(1, 2),
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
      `  Generation ${gen} complete: planned ${totalThisGen} people, actual ${currentGen.length} people (main chain 1 + siblings ${actualSiblingsAdded})`,
    );
  }

  // Statistics
  let totalPeople = 0;
  for (const [, people] of generations) {
    totalPeople += people.length;
  }
  const theoreticalMax = 2 ** TARGET_DEPTH - 1;
  console.log(
    `\nFamily tree complete: ${TARGET_DEPTH} generations, ${totalPeople} people (theoretical max ${theoreticalMax})`,
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
    const mintedNFTs = []; // Track minted NFTs for story chunks

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
        const supplementInfo = createSupplementInfo(person.personData.fullName, DEFAULT_PLACE, {
          deathYear: person.personData.birthYear + 70 + rng.nextInt(0, 20),
          deathMonth: 12,
          deathDay: 31,
          deathPlace: DEFAULT_PLACE,
          // story will be auto-generated with padding in createSupplementInfo
        });

        const mintResult = await mintPersonNFT({
          deepFamily,
          signer,
          personHash: person.hash,
          versionIndex: person.version,
          tokenURI: `ipfs://large-seed-nft/${person.name}`,
          basicInfo: person.personData,
          supplementInfo,
        });

        const tokenId = mintResult.tokenId?.toString();
        if (tokenId) {
          mintedNFTs.push({ tokenId, name: person.name });
        }

        mintedCount++;
        if (mintedCount % 5 === 0 || mintedCount === targetNFTCount) {
          console.log(
            `  Progress: ${mintedCount}/${targetNFTCount} (${Math.round((mintedCount / targetNFTCount) * 100)}%)`,
          );
        }
        dlog(`NFT minted successfully, TokenID: ${tokenId || "unknown"}`);
      } catch (error) {
        console.warn(
          `  Mint failed [${idx + 1}/${selected.length}]: ${error.message?.slice(0, 120)}`,
        );
      }
    }

    console.log(
      `\nNFT minting complete: ${mintedCount}/${targetNFTCount} (${Math.round((mintedCount / allPeople.length) * 100)}%)`,
    );

    // Add story chunks for minted NFTs
    if (mintedNFTs.length > 0 && STORY_CHUNKS_PER_NFT > 0) {
      console.log("\nStep 5: Add story chunks to NFTs");
      console.log("-".repeat(70));

      // Create layered testing strategy (similar to seed-demo)
      const storyChunkTargets = [];

      if (mintedNFTs.length >= 1) {
        storyChunkTargets.push({
          ...mintedNFTs[0],
          chunks: 10,
          useMaxLength: false,
          sealed: false,
        }); // normal chunks
      }
      if (mintedNFTs.length >= 2) {
        storyChunkTargets.push({
          ...mintedNFTs[1],
          chunks: 25,
          useMaxLength: true,
          sealed: false,
        }); // large chunks
      }
      if (mintedNFTs.length >= 3) {
        storyChunkTargets.push({
          ...mintedNFTs[2],
          chunks: MAX_STORY_CHUNKS,
          useMaxLength: true,
          sealed: true,
        }); // max chunks + seal
      }
      if (mintedNFTs.length >= 5) {
        storyChunkTargets.push({
          ...mintedNFTs[3],
          chunks: 50,
          useMaxLength: false,
          sealed: false,
        }); // medium
        storyChunkTargets.push({
          ...mintedNFTs[4],
          chunks: 75,
          useMaxLength: true,
          sealed: false,
        }); // many chunks
      }

      // For remaining NFTs, use environment variable settings
      for (let i = storyChunkTargets.length; i < mintedNFTs.length; i++) {
        storyChunkTargets.push({
          ...mintedNFTs[i],
          chunks: STORY_CHUNKS_PER_NFT,
          useMaxLength: USE_MAX_LENGTH_CHUNKS,
          sealed: false,
        });
      }

      console.log(`Processing ${storyChunkTargets.length} NFTs with story chunks\n`);

      let processedCount = 0;
      let totalChunksAdded = 0;

      for (const target of storyChunkTargets) {
        try {
          console.log(`\nProcessing TokenID ${target.tokenId} (${target.name})...`);

          const chunksAdded = await addStoryChunks(
            deepFamily,
            target.tokenId,
            target.name,
            target.chunks,
            target.useMaxLength,
          );
          totalChunksAdded += chunksAdded;

          // Seal if required
          if (target.sealed && chunksAdded > 0) {
            try {
              console.log(`  Sealing story for TokenID ${target.tokenId}...`);
              const sealTx = await deepFamily.sealStory(target.tokenId);
              await sealTx.wait();
              console.log(`  TokenID ${target.tokenId} story sealed`);
            } catch (error) {
              console.warn(
                `  TokenID ${target.tokenId} seal failed:`,
                error.message?.slice(0, 100),
              );
            }
          }

          processedCount++;
        } catch (error) {
          console.warn(
            `Processing TokenID ${target.tokenId} failed:`,
            error.message?.slice(0, 100),
          );
        }
      }

      console.log(`\nStory chunk addition complete:`);
      console.log(`  NFTs processed: ${processedCount}/${storyChunkTargets.length}`);
      console.log(`  Total chunks added: ${totalChunksAdded}`);
      console.log(
        `  Average chunks per NFT: ${processedCount > 0 ? Math.round(totalChunksAdded / processedCount) : 0}`,
      );
    }
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
