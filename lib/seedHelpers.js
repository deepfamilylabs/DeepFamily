const { buildBasicInfo } = require("./namePoseidon");
const { generatePersonHashProof } = require("./personHashProof");
const { generateNamePoseidonProof } = require("./namePoseidonProof");
const path = require("path");
const fs = require("fs");

function normalizeForHash(value) {
  if (value === undefined || value === null) return "";
  const str = String(value).trim();
  return typeof str.normalize === "function" ? str.normalize("NFC") : str;
}

function normalizePersonData(data = {}) {
  return {
    ...data,
    fullName: normalizeForHash(data.fullName || ""),
    passphrase: normalizeForHash(data.passphrase || ""),
  };
}

/**
 * Add person version (reuses core logic of add-person task)
 * @param {Object} params
 * @param {Object} params.deepFamily - DeepFamily contract instance
 * @param {Object} params.signer - Signer
 * @param {Object} params.personData - Person data { fullName, passphrase, isBirthBC, birthYear, birthMonth, birthDay, gender }
 * @param {Object} params.fatherData - Father data (optional)
 * @param {Object} params.motherData - Mother data (optional)
 * @param {number} params.fatherVersion - Father version index (default 0)
 * @param {number} params.motherVersion - Mother version index (default 0)
 * @param {string} params.tag - Version tag
 * @param {string} params.ipfs - IPFS CID
 * @returns {Promise<{personHash: string, tx: any, receipt: any}>}
 */
async function addPersonVersion({
  deepFamily,
  signer,
  personData,
  fatherData = null,
  motherData = null,
  fatherVersion = 0,
  motherVersion = 0,
  tag,
  ipfs,
}) {
  const { ethers } = require("ethers");
  const normalizedPersonData = normalizePersonData(personData);
  const normalizedFatherData = fatherData ? normalizePersonData(fatherData) : null;
  const normalizedMotherData = motherData ? normalizePersonData(motherData) : null;

  // Validate input
  if (!normalizedPersonData.fullName || normalizedPersonData.fullName.length === 0) {
    throw new Error("InvalidFullName");
  }

  // Generate ZK proof
  console.log("  ▶ [addPerson] Generating ZK proof...");
  const submitter = await signer.getAddress();
  const proofStartTime = Date.now();
  const { proof, publicSignals } = await generatePersonHashProof(
    normalizedPersonData,
    normalizedFatherData,
    normalizedMotherData,
    submitter
  );
  const proofEndTime = Date.now();
  const proofDuration = proofEndTime - proofStartTime;
  console.log(`  ✓ [addPerson] ZK proof generated in ${proofDuration}ms`);

  // Submit to contract
  console.log("  ▶ [addPerson] Submitting addPersonZK transaction...");
  const txStartTime = Date.now();
  const tx = await deepFamily
    .connect(signer)
    .addPersonZK(
      proof.a,
      proof.b,
      proof.c,
      publicSignals,
      Number(fatherVersion),
      Number(motherVersion),
      tag,
      ipfs
    );

  const receipt = await tx.wait();
  const txEndTime = Date.now();
  const txDuration = txEndTime - txStartTime;
  console.log(
    `  ✓ [addPerson] addPersonZK confirmed (tx: ${tx.hash || "unknown"}, block: ${
      receipt?.blockNumber ?? "n/a"
    }, tx wait: ${txDuration}ms)`
  );

  // Reconstruct personHash from proof
  const poseidonDigest =
    "0x" +
    ((BigInt(publicSignals[0]) << 128n) | BigInt(publicSignals[1]))
      .toString(16)
      .padStart(64, "0");
  const personHash = ethers.keccak256(ethers.solidityPacked(["bytes32"], [poseidonDigest]));

  // Calculate total duration
  const totalDuration = proofDuration + txDuration;

  return {
    personHash,
    tx,
    receipt,
    timing: {
      proofGeneration: proofDuration,
      transaction: txDuration,
      total: totalDuration
    }
  };
}

/**
 * Endorse version (reuses core logic of endorse task)
 * @param {Object} params
 * @param {Object} params.deepFamily - DeepFamily contract instance
 * @param {Object} params.token - DeepFamilyToken contract instance
 * @param {Object} params.signer - Signer
 * @param {string} params.personHash - Person hash
 * @param {number} params.versionIndex - Version index
 * @param {boolean} params.autoApprove - Whether to auto-approve token authorization (default true)
 * @returns {Promise<{tx: any, receipt: any, fee: bigint}>}
 */
async function endorseVersion({
  deepFamily,
  token,
  signer,
  personHash,
  versionIndex,
  autoApprove = true,
}) {
  const { ethers } = require("ethers");

  // Validate version index
  if (!Number.isInteger(versionIndex) || versionIndex <= 0) {
    throw new Error("versionIndex must be a positive integer starting from 1");
  }

  // Check if version exists
  const [, totalVersions] = await deepFamily.listPersonVersions(personHash, 0, 0);
  if (versionIndex > totalVersions) {
    throw new Error(
      `Version index ${versionIndex} out of range (total=${totalVersions})`
    );
  }

  // Read current fee
  let fee = await token.recentReward();
  fee = BigInt(fee);

  // Handle authorization
  if (fee > 0n) {
    const deepFamilyAddr = deepFamily.target || deepFamily.address;
    const signerAddr = await signer.getAddress();
    const allowance = await token.allowance(signerAddr, deepFamilyAddr);

    if (allowance < fee) {
      if (autoApprove) {
        const approveTx = await token.connect(signer).approve(deepFamilyAddr, ethers.MaxUint256);
        await approveTx.wait();
      } else {
        throw new Error(
          `Insufficient allowance (${allowance}) < fee (${fee}). Enable autoApprove or manually approve.`
        );
      }
    }
  }

  // Call endorseVersion
  const tx = await deepFamily.connect(signer).endorseVersion(personHash, versionIndex);
  const receipt = await tx.wait();

  return { tx, receipt, fee };
}

/**
 * Mint NFT (reuses core logic of mint-nft task)
 * @param {Object} params
 * @param {Object} params.deepFamily - DeepFamily contract instance
 * @param {Object} params.signer - Signer
 * @param {string} params.personHash - Person hash
 * @param {number} params.versionIndex - Version index
 * @param {string} params.tokenURI - NFT metadata URI
 * @param {Object} params.basicInfo - Basic info { fullName, passphrase, isBirthBC, birthYear, birthMonth, birthDay, gender }
 * @param {Object} params.supplementInfo - Supplement info { birthPlace, isDeathBC, deathYear, deathMonth, deathDay, deathPlace, story }
 * @returns {Promise<{tx: any, receipt: any, tokenId: bigint}>}
 */
async function mintPersonNFT({
  deepFamily,
  signer,
  personHash,
  versionIndex,
  tokenURI,
  basicInfo,
  supplementInfo,
}) {
  const normalizedBasic = normalizePersonData(basicInfo);
  const normalizedSupplement = {
    ...supplementInfo,
    fullName: normalizeForHash(supplementInfo.fullName || normalizedBasic.fullName),
  };

  // Validate version index
  if (!Number.isInteger(versionIndex) || versionIndex <= 0) {
    throw new Error("versionIndex must be a positive integer starting from 1");
  }

  // Check if version exists
  const [, totalVersions] = await deepFamily.listPersonVersions(personHash, 0, 0);
  if (versionIndex > totalVersions) {
    throw new Error(`Version index ${versionIndex} out of range (total=${totalVersions})`);
  }

  // Check if endorsed
  const signerAddr = await signer.getAddress();
  const endorsed = Number(await deepFamily.endorsedVersionIndex(personHash, signerAddr));
  if (endorsed !== versionIndex) {
    throw new Error(
      `You must endorse this version first (current endorsed index=${endorsed || 0})`
    );
  }

  // Build basicInfo structure
  const basicInfoStruct = buildBasicInfo({
    fullName: normalizedBasic.fullName,
    passphrase: normalizedBasic.passphrase || "",
    isBirthBC: normalizedBasic.isBirthBC || false,
    birthYear: normalizedBasic.birthYear ?? 0,
    birthMonth: normalizedBasic.birthMonth ?? 0,
    birthDay: normalizedBasic.birthDay ?? 0,
    gender: normalizedBasic.gender ?? 0,
  });

  // Generate Name Poseidon proof
  const { proof, publicSignals } = await generateNamePoseidonProof(
    normalizedBasic.fullName,
    normalizedBasic.passphrase || "",
    { minter: signerAddr }
  );

  // Verify personHash matches
  const computedHash = await deepFamily.getPersonHash(basicInfoStruct);
  if (computedHash.toLowerCase() !== personHash.toLowerCase()) {
    throw new Error(
      `Provided personHash does not match computed hash (${computedHash}). Check fullname/birth data.`
    );
  }

  // Build supplementInfo
  const supplementInfoStruct = {
    fullName: normalizedSupplement.fullName,
    birthPlace: normalizedSupplement.birthPlace || "",
    isDeathBC: normalizedSupplement.isDeathBC || false,
    deathYear: normalizedSupplement.deathYear ?? 0,
    deathMonth: normalizedSupplement.deathMonth ?? 0,
    deathDay: normalizedSupplement.deathDay ?? 0,
    deathPlace: normalizedSupplement.deathPlace || "",
    story: normalizedSupplement.story || "",
  };

  const coreInfo = {
    basicInfo: basicInfoStruct,
    supplementInfo: supplementInfoStruct,
  };

  // Call mintPersonNFT
  const tx = await deepFamily
    .connect(signer)
    .mintPersonNFT(
      proof.a,
      proof.b,
      proof.c,
      publicSignals,
      personHash,
      versionIndex,
      tokenURI,
      coreInfo
    );

  const receipt = await tx.wait();

  // Try to parse PersonNFTMinted event to get tokenId
  let tokenId = null;
  try {
    const { ethers } = require("ethers");
    const iface = new ethers.Interface([
      "event PersonNFTMinted(bytes32 indexed personHash, uint256 indexed tokenId, address indexed owner, uint256 versionIndex, string tokenURI, uint256 timestamp)",
    ]);
    const deepAddr = (deepFamily.target || deepFamily.address).toLowerCase();
    for (const log of receipt.logs || []) {
      if ((log.address || "").toLowerCase() !== deepAddr) continue;
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "PersonNFTMinted") {
          tokenId = parsed.args.tokenId;
          break;
        }
      } catch (_) {}
    }
  } catch (e) {}

  return { tx, receipt, tokenId };
}

/**
 * Compute person hash (no on-chain transaction, pure local computation)
 * @param {Object} params
 * @param {Object} params.deepFamily - DeepFamily contract instance (for calling getPersonHash)
 * @param {Object} params.personData - Person data
 * @returns {Promise<string>} personHash
 */
async function computePersonHash({ deepFamily, personData }) {
  const normalizedPersonData = normalizePersonData(personData);
  const basicInfo = buildBasicInfo({
    fullName: normalizedPersonData.fullName,
    passphrase: normalizedPersonData.passphrase || "",
    isBirthBC: normalizedPersonData.isBirthBC || false,
    birthYear: normalizedPersonData.birthYear ?? 0,
    birthMonth: normalizedPersonData.birthMonth ?? 0,
    birthDay: normalizedPersonData.birthDay ?? 0,
    gender: normalizedPersonData.gender ?? 0,
  });

  return await deepFamily.getPersonHash(basicInfo);
}

/**
 * Check if person version exists
 * @param {Object} params
 * @param {Object} params.deepFamily - DeepFamily contract instance
 * @param {string} params.personHash - Person hash
 * @param {number} params.versionIndex - Version index (optional, if not provided only checks if person exists)
 * @returns {Promise<{exists: boolean, totalVersions: number}>}
 */
async function checkPersonExists({ deepFamily, personHash, versionIndex = null }) {
  try {
    const result = await deepFamily.listPersonVersions(personHash, 0, 0);
    const totalVersions = Number(result[1] || result.totalVersions || 0);
    const exists = totalVersions > 0;

    if (versionIndex !== null) {
      return {
        exists: exists && Number(versionIndex) <= totalVersions,
        totalVersions: totalVersions,
      };
    }

    return { exists, totalVersions: totalVersions };
  } catch (e) {
    // Log error details for debugging
    console.warn(`[checkPersonExists] Failed to check person ${personHash}: ${e.message}`);
    return { exists: false, totalVersions: 0 };
  }
}

/**
 * Load multi-language root nodes from data/persons/ directory
 * Extracts generation 1 members (no parents) from each family dataset
 * @returns {Object} Map of language code to root person data
 */
function loadMultiLanguageRoots() {
  const dataDir = path.join(__dirname, "..", "data", "persons");
  const roots = {};

  // Language file mapping - use empty passphrase by default for consistency
  const langFiles = {
    en: { file: "en-family.json", passphrase: "" },
    zh: { file: "zh-family.json", passphrase: "" },
  };

  for (const [lang, config] of Object.entries(langFiles)) {
    const filePath = path.join(dataDir, config.file);

    try {
      if (!fs.existsSync(filePath)) {
        console.warn(`Warning: ${config.file} not found, skipping ${lang} root`);
        continue;
      }

      const familyData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const members = Array.isArray(familyData.members) ? familyData.members : [];

      if (members.length === 0) {
        console.warn(`Warning: ${config.file} has no members, skipping ${lang} root`);
        continue;
      }

      // Prefer generation 1 members without parents, but gracefully fall back when generation is absent
      const parentlessMembers = members.filter((m) => !m.fatherName && !m.motherName);
      let rootMember =
        parentlessMembers.find((m) => Number(m.generation) === 1) ||
        parentlessMembers[0] ||
        members.find((m) => Number(m.generation) === 1) ||
        members[0];

      if (!rootMember) {
        console.warn(`Warning: Unable to identify root member in ${config.file}, skipping ${lang} root`);
        continue;
      }

      if (rootMember) {
        roots[lang] = {
          language: lang,
          familyName: familyData.familyName || "",
          fullName: rootMember.fullName,
          passphrase: config.passphrase,
          isBirthBC: rootMember.isBirthBC || false,
          birthYear: rootMember.birthYear ?? 0,
          birthMonth: rootMember.birthMonth ?? 0,
          birthDay: rootMember.birthDay ?? 0,
          gender: rootMember.gender ?? 0,
        };
      }
    } catch (error) {
      console.warn(`Warning: Failed to load ${lang} root from ${config.file}: ${error.message}`);
    }
  }

  return roots;
}

/**
 * Get all root person data including demo and multi-language roots
 * @returns {Object} Map of root identifiers to person data
 */
function getAllRoots() {
  return loadMultiLanguageRoots();
}

/**
 * Query on-chain progress for a person hash.
 * Returns existing version/token/story state so callers can resume idempotently.
 */
async function getPersonProgress({ deepFamily, personHash }) {
  const result = {
    exists: false,
    totalVersions: 0,
    versionIndex: null,
    tokenId: 0,
    endorsementCount: 0,
    owner: null,
    storyMetadata: null,
  };

  try {
    const [, totalVersions] = await deepFamily.listPersonVersions(personHash, 0, 0);
    result.totalVersions = Number(totalVersions);
    if (result.totalVersions === 0) return result;

    result.exists = true;
    result.versionIndex = 1; // current seeding only writes version 1

    const [, endorsementCount, tokenId] = await deepFamily.getVersionDetails(
      personHash,
      result.versionIndex
    );
    result.endorsementCount = Number(endorsementCount);
    result.tokenId = Number(tokenId);

    if (result.tokenId > 0) {
      try {
        result.owner = await deepFamily.ownerOf(result.tokenId);
        result.storyMetadata = await deepFamily.getStoryMetadata(result.tokenId);
      } catch (e) {
        // Ignore ownership/story fetch errors; keep partial state for resume decisions.
      }
    }
  } catch (e) {
    // Swallow errors to keep seeding flow resilient on partial data.
  }

  return result;
}

module.exports = {
  addPersonVersion,
  endorseVersion,
  mintPersonNFT,
  computePersonHash,
  checkPersonExists,
  loadMultiLanguageRoots,
  getAllRoots,
  getPersonProgress,
  normalizeForHash,
  normalizePersonData,
};
