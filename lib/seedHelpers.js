const { buildBasicInfo, computePoseidonDigest } = require("./namePoseidon");
const { generatePersonHashProof } = require("./personHashProof");
const { generateNamePoseidonProof } = require("./namePoseidonProof");
const { DEMO_ROOT_PERSON } = require("./constants");

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

  // Validate input
  if (!personData.fullName || personData.fullName.trim().length === 0) {
    throw new Error("InvalidFullName");
  }

  // Generate ZK proof
  const submitter = await signer.getAddress();
  const { proof, publicSignals } = await generatePersonHashProof(
    personData,
    fatherData,
    motherData,
    submitter
  );

  // Submit to contract
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

  // Reconstruct personHash from proof
  const poseidonDigest =
    "0x" +
    ((BigInt(publicSignals[0]) << 128n) | BigInt(publicSignals[1]))
      .toString(16)
      .padStart(64, "0");
  const personHash = ethers.keccak256(ethers.solidityPacked(["bytes32"], [poseidonDigest]));

  return { personHash, tx, receipt };
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
    fullName: basicInfo.fullName,
    passphrase: basicInfo.passphrase || "",
    isBirthBC: basicInfo.isBirthBC || false,
    birthYear: basicInfo.birthYear || 0,
    birthMonth: basicInfo.birthMonth || 0,
    birthDay: basicInfo.birthDay || 0,
    gender: basicInfo.gender || 0,
  });

  // Generate Name Poseidon proof
  const { proof, publicSignals } = await generateNamePoseidonProof(
    basicInfo.fullName,
    basicInfo.passphrase || "",
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
    fullName: basicInfo.fullName,
    birthPlace: supplementInfo.birthPlace || "",
    isDeathBC: supplementInfo.isDeathBC || false,
    deathYear: supplementInfo.deathYear || 0,
    deathMonth: supplementInfo.deathMonth || 0,
    deathDay: supplementInfo.deathDay || 0,
    deathPlace: supplementInfo.deathPlace || "",
    story: supplementInfo.story || "",
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
  const basicInfo = buildBasicInfo({
    fullName: personData.fullName,
    passphrase: personData.passphrase || "",
    isBirthBC: personData.isBirthBC || false,
    birthYear: personData.birthYear || 0,
    birthMonth: personData.birthMonth || 0,
    birthDay: personData.birthDay || 0,
    gender: personData.gender || 0,
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
    const [, totalVersions] = await deepFamily.listPersonVersions(personHash, 0, 0);
    const exists = Number(totalVersions) > 0;

    if (versionIndex !== null) {
      return {
        exists: exists && Number(versionIndex) <= Number(totalVersions),
        totalVersions: Number(totalVersions),
      };
    }

    return { exists, totalVersions: Number(totalVersions) };
  } catch (e) {
    return { exists: false, totalVersions: 0 };
  }
}

module.exports = {
  DEMO_ROOT_PERSON,
  addPersonVersion,
  endorseVersion,
  mintPersonNFT,
  computePersonHash,
  checkPersonExists,
};
