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
 *   HISTORICAL_DATA_FILES must be provided (comma-separated list of JSON files in data/persons/)
 *
 * Usage (env: HISTORICAL_DATA_FILES is required):
 *   HISTORICAL_DATA_FILES=en-family.json npm run seed         # runs against localhost
 *   HISTORICAL_DATA_FILES=en-family.json npm run seed:net --net <network>   # target another network
 *   HISTORICAL_DATA_FILES=en-family.json,zh-family.json npm run seed   # multiple files
 *
 * Optional for quick testing:
 *   HISTORICAL_SEED_LIMIT=5 npm run seed   # only process first N members per file
 */

import hre from "hardhat";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import seedHelpers from "../lib/seedHelpers.js";
import versionMetadata from "../lib/versionMetadata.js";
import { ensureIntegratedSystem } from "../hardhat/integratedDeployment.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const connection = await hre.network.connect();
const { ethers } = connection;
const {
  addPersonVersion,
  endorseVersion,
  mintPersonNFT,
  computePersonHash,
  getPersonProgress,
  normalizePersonData,
} = seedHelpers;
const { buildVersionMetadataPayload, generateMetadataCID } = versionMetadata;

function pickRevertData(value) {
  if (typeof value === "string" && value.startsWith("0x")) {
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    typeof value.data === "string" &&
    value.data.startsWith("0x")
  ) {
    return value.data;
  }
  return null;
}

function extractRevertData(error) {
  const candidates = [
    error?.data,
    error?.error?.data,
    error?.error?.data?.data,
    error?.error?.data?.originalError?.data,
    error?.data?.data,
    error?.data?.originalError?.data,
    error?.info?.error?.data,
    error?.info?.error?.data?.data,
    error?.error?.error?.data,
    error?.error?.error?.data?.data,
    error?.error?.error?.data?.originalError?.data,
    error?.receipt?.revertReason,
    error?.transaction?.revertReason,
  ];

  for (const candidate of candidates) {
    const picked = pickRevertData(candidate);
    if (picked) return picked;
  }
  return null;
}

const STANDARD_ERROR_IFACES = [
  new ethers.Interface([
    "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
    "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
    "error ERC20InvalidSender(address sender)",
    "error ERC20InvalidReceiver(address receiver)",
    "error ERC20InvalidApprover(address approver)",
    "error ERC20InvalidSpender(address spender)",
  ]),
  new ethers.Interface([
    "error ERC721IncorrectOwner(address operator, uint256 tokenId, address owner)",
    "error ERC721InsufficientApproval(address operator, uint256 tokenId)",
    "error ERC721InvalidApprover(address approver)",
    "error ERC721InvalidOperator(address operator)",
    "error ERC721InvalidOwner(address owner)",
    "error ERC721InvalidReceiver(address receiver)",
    "error ERC721InvalidSender(address sender)",
    "error ERC721NonexistentToken(uint256 tokenId)",
  ]),
  new ethers.Interface([
    "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
    "error OwnableUnauthorizedAccount(address account)",
  ]),
];

function formatParsedError(parsed) {
  if (!parsed) return null;
  if (!parsed.args || parsed.args.length === 0) return parsed.name;
  const prettyArgs = parsed.args
    .map((arg, idx) => {
      const val = Array.isArray(arg) ? arg.join(",") : arg.toString();
      return `${idx}:${val}`;
    })
    .join(", ");
  return `${parsed.name}(${prettyArgs})`;
}

function decodeEthersError(error, contract) {
  const revertData = extractRevertData(error);

  // Try to parse custom errors using the contract interface
  if (revertData && contract?.interface) {
    try {
      const parsed = contract.interface.parseError(revertData);
      if (parsed) {
        return formatParsedError(parsed);
      }
    } catch (_) {}
  }

  // Parse against common ERC standard errors
  if (revertData) {
    for (const iface of STANDARD_ERROR_IFACES) {
      try {
        const parsed = iface.parseError(revertData);
        if (parsed) {
          return formatParsedError(parsed);
        }
      } catch (_) {}
    }
  }

  // Decode revert(string)
  if (revertData && revertData.startsWith("0x08c379a0")) {
    try {
      const [revertReason] = ethers.AbiCoder.defaultAbiCoder().decode(
        ["string"],
        `0x${revertData.slice(10)}`,
      );
      if (revertReason && typeof revertReason === "string") {
        return revertReason;
      }
    } catch (_) {}
  }

  // Decode panic(uint256)
  if (revertData && revertData.startsWith("0x4e487b71")) {
    try {
      const [panicCode] = ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint256"],
        `0x${revertData.slice(10)}`,
      );
      return `Panic(${panicCode})`;
    } catch (_) {}
  }

  // Fallback to common fields
  const fallback =
    error?.errorName ||
    error?.reason ||
    error?.shortMessage ||
    error?.info?.error?.message ||
    error?.message ||
    null;
  const txHash =
    error?.transactionHash ||
    error?.receipt?.transactionHash ||
    error?.receipt?.hash ||
    error?.tx?.hash;
  if (fallback && txHash) return `${fallback} (tx: ${txHash})`;
  if (fallback) return fallback;
  if (revertData) return `Unknown error (data: ${revertData})`;
  return "Unknown error";
}

// ========== Constants Configuration ==========

const MAX_CHUNK_CONTENT_LENGTH = 2048;
const MAX_LONG_TEXT_LENGTH = 256;

// Data file paths
const DATA_DIR = path.join(__dirname, "..", "data", "persons");

// Environment variables configuration
// HISTORICAL_DATA_FILES (comma-separated) controls which files to seed; required (no default)
const DATA_FILES = process.env.HISTORICAL_DATA_FILES
  ? process.env.HISTORICAL_DATA_FILES.split(",")
      .map((f) => f.trim())
      .filter(Boolean)
  : [];
if (DATA_FILES.length === 0) {
  throw new Error("HISTORICAL_DATA_FILES is required (comma-separated list, e.g., en-family.json)");
}
// HISTORICAL_SEED_LIMIT limits how many members to process per file (for quick testing); <=0 or unset means no limit
const RAW_SEED_MEMBER_LIMIT = process.env.HISTORICAL_SEED_LIMIT;
const SEED_MEMBER_LIMIT =
  RAW_SEED_MEMBER_LIMIT !== undefined && RAW_SEED_MEMBER_LIMIT !== ""
    ? Number(RAW_SEED_MEMBER_LIMIT)
    : null;

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
  members.forEach((m) => memberMap.set(m.fullName, m));

  // Find root members (those without father AND mother)
  const roots = members.filter((m) => !m.fatherName && !m.motherName);

  if (roots.length === 0) {
    throw new Error("No root member found (member without both father and mother)");
  }

  console.log(`Found ${roots.length} root member(s): ${roots.map((r) => r.fullName).join(", ")}`);

  // BFS to calculate generations
  const generationMap = new Map();
  const queue = roots.map((r) => ({ name: r.fullName, generation: 1 }));

  while (queue.length > 0) {
    const { name, generation } = queue.shift();

    if (generationMap.has(name)) {
      continue; // Already processed
    }

    generationMap.set(name, generation);

    // Find all children of this person
    const children = members.filter((m) => m.fatherName === name || m.motherName === name);

    for (const child of children) {
      if (!generationMap.has(child.fullName)) {
        queue.push({ name: child.fullName, generation: generation + 1 });
      }
    }
  }

  // Apply calculated generations to members
  members.forEach((m) => {
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
  members.forEach((m) => {
    genStats[m.generation] = (genStats[m.generation] || 0) + 1;
  });

  console.log("✓ Generation calculation complete:");
  Object.keys(genStats)
    .sort((a, b) => a - b)
    .forEach((gen) => {
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
    birthYear: personInfo.birthYear ?? 0,
    birthMonth: personInfo.birthMonth ?? 0,
    birthDay: personInfo.birthDay ?? 0,
    isBirthBC: personInfo.isBirthBC || false,
    gender: personInfo.gender ?? 0,
  };
}

function createPersonDataWithPassphrase(personInfo, _familyData) {
  const base = createPersonData(personInfo);
  // Use only provided passphrases; default to empty when none are supplied
  return normalizePersonData({
    ...base,
    passphrase: personInfo.passphrase || "",
  });
}

function createSupplementInfo(personInfo) {
  // story field is a brief life summary, different from storyData.summary
  // If person has a dedicated 'story' field, use it; otherwise use empty string
  // The detailed content is stored in story chunks (storyData)
  const storyBrief = personInfo.story || "";

  return {
    deathYear: personInfo.deathYear ?? 0,
    deathMonth: personInfo.deathMonth ?? 0,
    deathDay: personInfo.deathDay ?? 0,
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
  let members = Array.isArray(familyData.members) ? [...familyData.members] : [];
  if (
    Number.isFinite(SEED_MEMBER_LIMIT) &&
    SEED_MEMBER_LIMIT > 0 &&
    SEED_MEMBER_LIMIT < members.length
  ) {
    console.log(
      `Limiting members to first ${SEED_MEMBER_LIMIT} (of ${members.length}) for testing`,
    );
    members = members.slice(0, SEED_MEMBER_LIMIT);
  } else if (Number.isFinite(SEED_MEMBER_LIMIT) && SEED_MEMBER_LIMIT > 0) {
    console.log(
      `Seed limit ${SEED_MEMBER_LIMIT} >= available members (${members.length}), no slicing applied`,
    );
  } else {
    console.log("No seed limit applied (processing all members in file)");
  }
  const totalMembers = members.length;

  // Pre-compute root hashes (members without parents)
  const rootHashes = [];
  const rootMembers = Array.isArray(familyData.members)
    ? familyData.members.filter((m) => !m.fatherName && !m.motherName)
    : [];
  for (const rootInfo of rootMembers) {
    try {
      const rootPersonData = createPersonDataWithPassphrase(rootInfo, familyData);
      const rootHash = await computePersonHash({ deepFamily, personData: rootPersonData });
      rootHashes.push({ name: rootInfo.fullName, hash: rootHash });
    } catch (error) {
      console.warn(
        `⚠ Failed to compute root hash for ${rootInfo.fullName}: ${error?.message || "unknown error"}`,
      );
    }
  }

  // Step 1: Token approval
  console.log("Step 1: Preparing token approval...");
  const deepFamilyAddr = deepFamily.target || deepFamily.address;
  const allowance = await token.allowance(signer.address, deepFamilyAddr);
  if (allowance === 0n) {
    console.log("  ▶ No allowance found, sending approve transaction...");
    const approveTx = await token.approve(deepFamilyAddr, ethers.MaxUint256);
    console.log(`  ⧗ Approve tx sent: ${approveTx.hash}`);
    await approveTx.wait();
    console.log("✓ Token approved\n");
  } else {
    console.log(`✓ Token already approved (allowance: ${allowance.toString()})\n`);
  }

  // Step 2: Add historical persons
  console.log(`Step 2: Adding ${familyData.familyName} members...`);
  const expectedPersons = members.length;
  const expectedMintable = members.filter((m) => m.mintNFT !== false).length;
  console.log(`Targets — persons: ${expectedPersons}, mintable: ${expectedMintable}`);
  let expectedChunks = 0; // total JSON chunks for mintable persons

  const addedPersons = [];
  let existingPersons = 0;
  let newlyAddedPersons = 0;

  for (let idx = 0; idx < members.length; idx++) {
    const personInfo = members[idx];
    console.log(
      `\nProcessing [${idx + 1}/${totalMembers}]: ${personInfo.fullName} (Gen ${personInfo.generation})`,
    );

    // Create person data
    const personDataWithPassphrase = createPersonDataWithPassphrase(personInfo, familyData);

    // Compute personHash
    console.log("  ▶ Computing personHash locally...");
    const personHash = await computePersonHash({
      deepFamily,
      personData: personDataWithPassphrase,
    });
    console.log(`  ✓ personHash computed: ${personHash}`);

    // Check on-chain progress for resume support
    console.log(`  ▶ Checking on-chain existence for hash ${personHash}...`);
    const progress = await getPersonProgress({ deepFamily, personHash });

    if (progress.exists) {
      console.log(
        `  ○ Already exists on-chain (versions: ${progress.totalVersions}, tokenId: ${progress.tokenId || 0}) — skip addPersonZK`,
      );
      console.log(
        `  ➜ Existence result: exists=true, version=${progress.versionIndex || 1}, tokenId=${progress.tokenId || 0}`,
      );
      const savedPerson = {
        ...personInfo,
        hash: personHash,
        version: progress.versionIndex || 1,
        personData: personDataWithPassphrase,
        tokenId: progress.tokenId || 0,
        storyMetadata: progress.storyMetadata,
        owner: progress.owner,
        isExisting: true,
        metadataCID: personInfo.metadataCID || null,
      };
      addedPersons.push(savedPerson);
      existingPersons++;
      continue;
    }
    console.log("  ○ Not found on-chain, will add new version");
    console.log("  ➜ Existence result: exists=false, version will be 1, tokenId=0");

    // Find parent data
    let fatherData = null;
    let fatherVersion = 0;
    let fatherHash = ethers.ZeroHash;
    let fatherRecord = null;

    if (personInfo.fatherName) {
      fatherRecord = addedPersons.find((p) => p.fullName === personInfo.fatherName);
      if (fatherRecord) {
        fatherData = fatherRecord.personData;
        fatherVersion = fatherRecord.version;
        fatherHash = fatherRecord.hash || ethers.ZeroHash;
        console.log(`  Father: ${personInfo.fatherName} (v${fatherVersion})`);
      } else {
        console.log(`  Warning: Father "${personInfo.fatherName}" not found`);
      }
    }

    let motherData = null;
    let motherVersion = 0;
    let motherHash = ethers.ZeroHash;
    let motherRecord = null;

    if (personInfo.motherName) {
      motherRecord = addedPersons.find((p) => p.fullName === personInfo.motherName);
      if (motherRecord) {
        motherData = motherRecord.personData;
        motherVersion = motherRecord.version;
        motherHash = motherRecord.hash || ethers.ZeroHash;
        console.log(`  Mother: ${personInfo.motherName} (v${motherVersion})`);
      }
    }

    // Build deterministic metadata JSON and CID (reuse UI logic)
    const metadataPayload = buildVersionMetadataPayload({
      tag: personInfo.tag || "",
      personInfo: personDataWithPassphrase,
      fatherInfo: fatherData,
      motherInfo: motherData,
      fatherVersionIndex: fatherVersion,
      motherVersionIndex: motherVersion,
      personHash,
      fatherHash,
      motherHash,
    });
    const metadataJson = JSON.stringify(metadataPayload);
    console.log(`  🧾 Metadata JSON size: ${Buffer.byteLength(metadataJson, "utf8")} bytes`);
    console.log("  📝 Metadata JSON:", metadataJson);
    const metadataCID =
      personInfo.metadataCID && personInfo.metadataCID.length > 0
        ? personInfo.metadataCID
        : await generateMetadataCID(metadataJson);
    console.log(
      `  ✓ Metadata prepared — CID: ${metadataCID}${personInfo.metadataCID ? " (from JSON)" : ""}`,
    );

    // Add person (using ZK proof)
    console.log("  ▶ Generating ZK proof...");
    console.log("  ▶ Starting addPersonZK (proof + transaction)...");
    const addStart = Date.now();
    const addResult = await addPersonVersion({
      deepFamily,
      signer,
      personData: personDataWithPassphrase,
      fatherData,
      motherData,
      fatherVersion,
      motherVersion,
      tag: personInfo.tag || "",
      ipfs: metadataCID,
    });
    const addElapsed = Date.now() - addStart;
    const proofMs = addResult?.timing?.proofGeneration ?? null;
    const txMs = addResult?.timing?.transaction ?? null;
    const txHash = addResult?.tx?.hash || addResult?.receipt?.hash;
    const txBlock = addResult?.receipt?.blockNumber;
    if (proofMs !== null) {
      console.log(`  ✓ ZK proof generated in ${proofMs}ms`);
    }
    console.log("  ▶ addPersonZK transaction submitted, waiting for confirmation...");
    console.log(
      `  ✓ addPersonZK confirmed (tx: ${txHash || "unknown"}) — proof ${
        proofMs !== null ? `${proofMs}ms` : "n/a"
      }, tx wait ${txMs !== null ? `${txMs}ms` : `${addElapsed}ms total`}${
        txBlock ? `, block ${txBlock}` : ""
      }`,
    );
    let rewardAmount = null;
    try {
      const rewardIface = new ethers.Interface([
        "event TokenRewardDistributed(address indexed miner, bytes32 indexed personHash, uint256 indexed versionIndex, uint256 reward)",
      ]);
      const deepAddr = (deepFamily.target || deepFamily.address).toLowerCase();
      for (const log of addResult?.receipt?.logs || []) {
        if ((log.address || "").toLowerCase() !== deepAddr) continue;
        try {
          const parsed = rewardIface.parseLog(log);
          if (parsed && parsed.name === "TokenRewardDistributed") {
            rewardAmount = parsed.args.reward;
            break;
          }
        } catch (_) {}
      }
    } catch (_) {}
    if (rewardAmount !== null) {
      const formattedReward = ethers.formatUnits(rewardAmount, 18);
      console.log(
        `  ✓ Token reward received: ${formattedReward} DEEP (${rewardAmount.toString()} wei)`,
      );
    } else {
      console.log(
        "  ○ No TokenRewardDistributed event found (reward may be zero or parents missing)",
      );
    }

    const savedPerson = {
      ...personInfo,
      hash: personHash,
      version: 1, // Newly added version index is 1
      personData: personDataWithPassphrase,
      tokenId: 0,
      storyMetadata: null,
      owner: signer.address,
      isExisting: false,
      metadataCID,
    };
    addedPersons.push(savedPerson);
    newlyAddedPersons++;

    console.log(`✓ Added ${personInfo.fullName}`);
    console.log(`  Hash: ${personHash}`);
    console.log(`  Version: 1`);
  }

  console.log(`\n✓ Family tree complete: ${addedPersons.length} persons added\n`);
  console.log(
    `Step 2 summary — new versions added: ${newlyAddedPersons}, skipped existing: ${existingPersons}`,
  );

  // Step 3: Mint NFTs and add Story Chunks
  console.log("Step 3: Minting NFTs and adding story chunks...");
  console.log(
    `Targets — persons to process: ${addedPersons.length}, mintable: ${addedPersons.filter((p) => p.mintNFT !== false).length}`,
  );

  let nftCount = 0;
  let skippedCount = 0;
  let totalChunks = 0;
  let mintedOnChain = 0; // includes existing + newly minted
  let onChainChunks = 0; // total chunks observed/assumed on chain (per current signer reads)

  for (let idx = 0; idx < addedPersons.length; idx++) {
    const person = addedPersons[idx];
    // Check if NFT should be minted (defaults to true for backward compatibility)
    const shouldMintNFT = person.mintNFT !== false;

    if (!shouldMintNFT) {
      console.log(`\n⊘ Skipping NFT for: ${person.fullName} (mintNFT=false)`);
      skippedCount++;
      continue;
    }

    const versionOrigin = person.isExisting ? "existing version (prior run)" : "newly added";
    console.log(
      `\nProcessing NFT for: ${person.fullName} [${idx + 1}/${addedPersons.length}] — ${versionOrigin}`,
    );

    let tokenId = Number(person.tokenId || 0);
    let storyMetadata = person.storyMetadata || null;
    console.log(
      `  ℹ Version info — hash: ${person.hash.slice(0, 10)}..., version: ${person.version}, tokenId: ${tokenId}`,
    );

    if (tokenId > 0) {
      console.log(`  ○ NFT already minted, tokenId: ${tokenId}`);
    } else {
      try {
        // Endorse (skip if already endorsed)
        console.log("  ▶ Endorsing version...");
        let alreadyEndorsed = false;
        let endorsementFee = null;
        try {
          const endorseStart = Date.now();
          const { tx, receipt, fee } = await endorseVersion({
            deepFamily,
            token,
            signer,
            personHash: person.hash,
            versionIndex: person.version,
            autoApprove: true,
          });
          endorsementFee = fee;
          const endorseElapsed = Date.now() - endorseStart;
          const endorseTxHash = tx?.hash || receipt?.hash;
          const feeStr =
            endorsementFee !== null ? `, fee: ${ethers.formatUnits(endorsementFee, 18)} DEEP` : "";
          console.log(
            `  ✓ Endorsed (tx: ${endorseTxHash || "unknown"}, ${endorseElapsed}ms${feeStr})`,
          );
        } catch (endorseErr) {
          const reason = decodeEthersError(endorseErr, deepFamily);
          if (reason === "AlreadyEndorsed") {
            alreadyEndorsed = true;
            console.log("  ○ Already endorsed by this signer, skip endorsement step");
          } else {
            const txHash =
              endorseErr?.transactionHash ||
              endorseErr?.receipt?.transactionHash ||
              endorseErr?.tx?.hash;
            const revertData = extractRevertData(endorseErr);
            console.error(`  ❌ Endorsement failed for ${person.fullName} (hash: ${person.hash})`);
            console.error(`     Reason: ${reason}`);
            if (txHash) console.error(`     Tx: ${txHash}`);
            if (revertData) console.error(`     Revert data: ${revertData}`);
            // Skip minting/story processing for this person, continue with next
            continue;
          }
        }

        // Mint NFT
        console.log("  ▶ Minting NFT (generate proof + submit tx)...");
        const mintStart = Date.now();
        const supplementInfo = createSupplementInfo(person);

        const mintResult = await mintPersonNFT({
          deepFamily,
          signer,
          personHash: person.hash,
          versionIndex: person.version,
          tokenURI: person.tokenURI || "",
          basicInfo: person.personData,
          supplementInfo,
        });

        tokenId = Number(mintResult.tokenId);
        const mintElapsed = Date.now() - mintStart;
        const mintTxHash = mintResult?.tx?.hash || mintResult?.receipt?.hash;
        console.log(
          `  ✓ NFT minted, tokenId: ${tokenId}, tx: ${mintTxHash || "unknown"} (${mintElapsed}ms)`,
        );
        nftCount++;
      } catch (error) {
        const reason = decodeEthersError(error, deepFamily);
        const txHash = error?.transactionHash || error?.receipt?.transactionHash || error?.tx?.hash;
        const revertData = extractRevertData(error);
        console.error(`  ❌ Mint failed for ${person.fullName} (hash: ${person.hash})`);
        console.error(`     Reason: ${reason}`);
        if (txHash) {
          console.error(`     Tx: ${txHash}`);
        }
        if (revertData) {
          console.error(`     Revert data: ${revertData}`);
        }
        // Skip story chunk processing for this person, continue with next
        continue;
      }

      try {
        storyMetadata = await deepFamily.getStoryMetadata(tokenId);
      } catch (e) {
        storyMetadata = null;
      }

      person.tokenId = tokenId;
      person.owner = signer.address;
    }

    mintedOnChain += tokenId > 0 ? 1 : 0;

    if (tokenId === 0) {
      console.log("  ⊘ No tokenId available, skip story chunks");
      continue;
    }

    // Add Story Chunks - all chunks from JSON data
    // Collect available story data chunks from JSON
    // Each chunk is now: { type: number, content: string, arrayIndex: number }
    const availableChunks = [];
    const storyData = person.storyData || {};

    // Map chunk type to storyData field
    const chunkFieldMap = {
      0: "summary",
      1: "earlyLife",
      2: "education",
      3: "lifeEvents",
      4: "career",
      5: "works",
      6: "achievements",
      7: "philosophy",
      8: "quotes",
      9: "family",
      10: "lifestyle",
      11: "relations",
      12: "activities",
      13: "anecdotes",
      14: "controversies",
      15: "legacy",
      16: "gallery",
      17: "references",
      18: "notes",
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
          if (content && typeof content === "string" && content.trim().length > 0) {
            availableChunks.push({
              type: chunkType,
              content: content,
              arrayIndex: arrayIndex,
            });
          }
        });
      } else if (typeof fieldData === "string" && fieldData.trim().length > 0) {
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
      continue;
    }

    const targetChunkCount = availableChunks.length;
    console.log(`  ▶ Story data prepared from JSON: ${targetChunkCount} chunk(s)`);
    expectedChunks += targetChunkCount;

    if (!storyMetadata) {
      try {
        storyMetadata = await deepFamily.getStoryMetadata(tokenId);
      } catch (e) {
        storyMetadata = { totalChunks: 0, isSealed: false };
      }
    }

    const existingChunks = Number(storyMetadata?.totalChunks || 0);

    // Ensure signer owns the NFT before writing chunks (reading metadata is permissionless)
    let owner = person.owner;
    if (!owner) {
      try {
        owner = await deepFamily.ownerOf(tokenId);
      } catch (e) {
        owner = null;
      }
    }

    if (owner && owner.toLowerCase() !== signer.address.toLowerCase()) {
      console.log(
        `  ⊘ Current signer not holder (${owner}), skip story chunks (JSON: ${targetChunkCount}, on-chain: ${existingChunks})`,
      );
      onChainChunks += existingChunks;
      continue;
    }

    if (storyMetadata?.isSealed) {
      console.log(
        `  ⊘ Story sealed on-chain, chunks (JSON vs on-chain): ${targetChunkCount} vs ${existingChunks}`,
      );
      onChainChunks += existingChunks;
      continue;
    }

    if (existingChunks > availableChunks.length) {
      console.log(
        `  ⚠ On-chain chunks (${existingChunks}) exceed JSON chunks (${availableChunks.length}), skip writing`,
      );
      onChainChunks += existingChunks;
      continue;
    }

    const pendingChunks = availableChunks.slice(existingChunks);
    if (pendingChunks.length === 0) {
      console.log(
        `  ○ Story already complete on-chain (JSON vs on-chain): ${targetChunkCount} vs ${existingChunks}`,
      );
      onChainChunks += existingChunks;
      continue;
    }

    console.log(
      `  Adding ${pendingChunks.length} story chunk(s) (resume from index ${existingChunks})...`,
    );

    for (let i = 0; i < pendingChunks.length; i++) {
      const chunk = pendingChunks[i];
      const content = truncateUtf8Bytes(chunk.content, MAX_CHUNK_CONTENT_LENGTH);
      const expectedHash = solidityStringHash(content);
      const attachmentCID = "";
      const chunkIndex = existingChunks + i;

      console.log(
        `    ▶ Adding chunk ${chunkIndex}/${targetChunkCount - 1} (type ${chunk.type}, arrayIndex ${chunk.arrayIndex})...`,
      );
      const chunkStart = Date.now();
      const chunkTx = await deepFamily.addStoryChunk(
        tokenId,
        chunkIndex, // Continue after on-chain chunks
        chunk.type,
        content,
        attachmentCID,
        expectedHash,
      );
      console.log(`    ⧗ Chunk tx sent: ${chunkTx.hash}`);
      const chunkReceipt = await chunkTx.wait();
      const chunkElapsed = Date.now() - chunkStart;
      let emittedHash = expectedHash;
      try {
        const chunkEventIface = new ethers.Interface([
          "event StoryChunkAdded(uint256 indexed tokenId, uint256 indexed chunkIndex, bytes32 chunkHash, address indexed editor, uint256 contentLength, uint8 chunkType, string attachmentCID)",
        ]);
        const deepAddr = (deepFamily.target || deepFamily.address).toLowerCase();
        for (const log of chunkReceipt?.logs || []) {
          if ((log.address || "").toLowerCase() !== deepAddr) continue;
          try {
            const parsed = chunkEventIface.parseLog(log);
            if (
              parsed &&
              parsed.name === "StoryChunkAdded" &&
              parsed.args.chunkIndex == chunkIndex
            ) {
              emittedHash = parsed.args.chunkHash;
              break;
            }
          } catch (_) {}
        }
      } catch (_) {}
      console.log(`    ✓ Chunk ${chunkIndex} added (${chunkElapsed}ms) — hash: ${emittedHash}`);
      totalChunks++;
    }

    onChainChunks += existingChunks + pendingChunks.length;
    console.log(
      `  ✓ Added ${pendingChunks.length} story chunk(s) (JSON target: ${targetChunkCount}, on-chain now: ${existingChunks + pendingChunks.length})`,
    );
  }

  console.log("\n" + "=".repeat(60));
  console.log("Seed Complete!");
  console.log("=".repeat(60));
  const existingMinted = Math.max(mintedOnChain - nftCount, 0);
  const existingChunksOnChain = Math.max(onChainChunks - totalChunks, 0);
  const remainingChunks = expectedChunks - onChainChunks;
  console.log(`Family: ${familyData.familyName}`);
  console.log(`Persons processed (JSON vs on-chain): ${expectedPersons} vs ${addedPersons.length}`);
  console.log(
    `NFT status — minted this run: ${nftCount}; skipped by config: ${skippedCount}; on-chain total (seen): ${mintedOnChain} (existing: ${existingMinted})`,
  );
  console.log(
    `Story chunks — target (JSON mintable): ${expectedChunks}; on-chain seen: ${onChainChunks} (existing: ${existingChunksOnChain}); added this run: ${totalChunks}`,
  );
  if (remainingChunks > 0) {
    console.log(`Remaining JSON chunks not on-chain (estimate): ${remainingChunks}`);
  } else if (expectedChunks > 0) {
    console.log(`All JSON chunks are already on-chain.`);
  }
  console.log(
    `Mintable persons — expected: ${expectedMintable}; on-chain NFTs (seen): ${mintedOnChain}`,
  );
  console.log("=".repeat(60));

  if (rootHashes.length > 0) {
    console.log("\nRoot hash summary:");
    rootHashes.forEach((entry) => {
      console.log(`  ${entry.name}: ${entry.hash}`);
    });
  } else {
    console.log("\nRoot hash summary: no parentless members detected, nothing to report");
  }

  return {
    familyName: familyData.familyName,
    personsAdded: addedPersons.length,
    nftsMinted: nftCount,
    nftsSkipped: skippedCount,
    storyChunks: totalChunks,
    rootHashes,
  };
}

/**
 * Main execution function
 * Supports batch seeding of multiple languages or single language mode
 */
async function main() {
  console.log("=".repeat(70));
  console.log("DeepFamily Historical Data Seeding");
  console.log("=".repeat(70));

  const [signer] = await ethers.getSigners();
  const { deepFamily, token } = await ensureIntegratedSystem(connection, {
    writeDeployments: true,
  });
  const deepFamilyWithSigner = deepFamily.connect(signer);
  const tokenWithSigner = token.connect(signer);

  const deepFamilyAddr = await deepFamily.getAddress();
  const tokenAddr = await token.getAddress();
  console.log(`\nUsing signer: ${signer.address}`);
  console.log(`DeepFamily contract: ${deepFamilyAddr}`);
  console.log(`DeepFamilyToken contract: ${tokenAddr}`);
  console.log("=".repeat(70));

  // Single mode: explicit file list (comma-separated)
  console.log("\n📄 File List Mode");
  console.log("=".repeat(70));
  console.log(`Data files: ${DATA_FILES.join(", ")}\n`);

  const results = [];
  for (const file of DATA_FILES) {
    try {
      console.log(`\n${"━".repeat(70)}`);
      console.log(`📂 Starting: ${file}`);
      console.log("━".repeat(70));

      const result = await seedSingleLanguage(file, deepFamilyWithSigner, tokenWithSigner, signer);
      results.push({ file, success: true, ...result });
      console.log(`✓ ${file} completed successfully`);
    } catch (error) {
      console.error(`\n❌ Failed to seed ${file}:`);
      console.error(error.message);
      results.push({ file, success: false, error: error.message });
    }
  }

  // Print summary
  console.log("\n" + "=".repeat(70));
  console.log("📊 FILE LIST SUMMARY");
  console.log("=".repeat(70));

  let totalPersons = 0;
  let totalNFTs = 0;
  let totalChunks = 0;
  let successCount = 0;

  for (const result of results) {
    const status = result.success ? "✓" : "✗";
    console.log(`\n[${status}] ${result.file}`);

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
  console.log(`Total Results: ${successCount}/${results.length} files succeeded`);
  console.log(`Total Persons: ${totalPersons}`);
  console.log(`Total NFTs: ${totalNFTs}`);
  console.log(`Total Story Chunks: ${totalChunks}`);
  console.log("=".repeat(70));

  console.log("\nContract addresses:");
  console.log(`  DeepFamily: ${deepFamilyAddr}`);
  console.log(`  DeepFamilyToken: ${tokenAddr}`);

  console.log("\nRoot hashes (per file):");
  if (results.length === 0) {
    console.log("  No files processed");
  } else {
    for (const result of results) {
      if (!result.success) {
        console.log(`  ${result.file}: failed, no root hash`);
        continue;
      }
      if (result.rootHashes && result.rootHashes.length > 0) {
        console.log(`  ${result.file}:`);
        result.rootHashes.forEach((entry) => {
          console.log(`    ${entry.name}: ${entry.hash}`);
        });
      } else {
        console.log(`  ${result.file}: no parentless members detected`);
      }
    }
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
