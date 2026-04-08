import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { poseidon4 } from "poseidon-lite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SNARK_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const DOMAIN_SUITE = 1000n;
const DOMAIN_NAME_SECRET = 1001n;
const DOMAIN_IDENTITY = 1002n;
const DOMAIN_DISCLOSURE = 1003n;
const DOMAIN_NAME_PREHASH = "deepfamily:name-prehash:v2";

const DEFAULT_SCHEMA_VERSION = 1;
const DEFAULT_CRYPTO_SUITE_VERSION = 1;
const DEFAULT_HASH_ALGO_ID = 1;
const DEFAULT_PROOF_SYSTEM_ID = 0;

function normalizeNameForHash(value) {
  if (value === undefined || value === null) return "";
  const str = String(value);
  const normalized = typeof str.normalize === "function" ? str.normalize("NFKC") : str;
  return normalized.replace(/\s+/gu, " ").trim();
}

function normalizePassphraseForHash(value) {
  if (value === undefined || value === null) return "";
  const str = String(value);
  return typeof str.normalize === "function" ? str.normalize("NFKD") : str;
}

function normalizePersonData(data = {}) {
  return {
    ...data,
    fullName: normalizeNameForHash(data.fullName || ""),
    passphrase: normalizePassphraseForHash(data.passphrase || ""),
  };
}

function computeSuiteCommitment(schemaVersion, cryptoSuiteVersion, hashAlgoId) {
  return poseidon4([
    DOMAIN_SUITE,
    BigInt(schemaVersion),
    BigInt(cryptoSuiteVersion),
    BigInt(hashAlgoId),
  ]);
}

function computeNameField(fullName) {
  const domainBytes = new TextEncoder().encode(DOMAIN_NAME_PREHASH);
  const nameBytes = new TextEncoder().encode(fullName);
  const combined = new Uint8Array(domainBytes.length + nameBytes.length);
  combined.set(domainBytes);
  combined.set(nameBytes, domainBytes.length);
  const prehash = ethers.keccak256(combined);
  return BigInt(prehash) % SNARK_FIELD;
}

function packBirthGenderField({ birthYear, birthMonth, birthDay, gender, isBirthBC }) {
  return (
    (BigInt(birthYear || 0) << 24n) |
    (BigInt(birthMonth || 0) << 16n) |
    (BigInt(birthDay || 0) << 8n) |
    (BigInt(gender || 0) << 1n) |
    (isBirthBC ? 1n : 0n)
  );
}

function computeIdentityCommitmentFromData(personData, opts = {}) {
  const {
    schemaVersion = DEFAULT_SCHEMA_VERSION,
    cryptoSuiteVersion = DEFAULT_CRYPTO_SUITE_VERSION,
    hashAlgoId = DEFAULT_HASH_ALGO_ID,
  } = opts;

  const suite = computeSuiteCommitment(schemaVersion, cryptoSuiteVersion, hashAlgoId);
  const nameField = computeNameField(personData.fullName);
  const derivedSecretField = 0n;
  const nameSecretCommitment = poseidon4([DOMAIN_NAME_SECRET, nameField, derivedSecretField, suite]);
  const packed = packBirthGenderField(personData);
  const identityCommitment = poseidon4([DOMAIN_IDENTITY, nameSecretCommitment, packed, suite]);

  return identityCommitment;
}

function computeDisclosureBindingValue(fullName, personData, opts = {}) {
  const {
    schemaVersion = DEFAULT_SCHEMA_VERSION,
    cryptoSuiteVersion = DEFAULT_CRYPTO_SUITE_VERSION,
    hashAlgoId = DEFAULT_HASH_ALGO_ID,
  } = opts;
  const suite = computeSuiteCommitment(schemaVersion, cryptoSuiteVersion, hashAlgoId);
  const nameField = computeNameField(fullName);
  const packed = packBirthGenderField(personData);
  return poseidon4([DOMAIN_DISCLOSURE, nameField, packed, suite]);
}

function wrapIdentityCommitmentAsPersonHash(identityCommitment) {
  const hex = ethers.zeroPadValue(ethers.toBeHex(identityCommitment), 32);
  return ethers.keccak256(ethers.solidityPacked(["bytes32"], [hex]));
}

function makeProofEnvelope(proofSystemId) {
  return {
    proofSystemId,
    a: [0, 0],
    b: [[0, 0], [0, 0]],
    c: [0, 0],
  };
}

/**
 * Add person version using ZK API
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
  proofSystemId = DEFAULT_PROOF_SYSTEM_ID,
  schemaVersion = DEFAULT_SCHEMA_VERSION,
  cryptoSuiteVersion = DEFAULT_CRYPTO_SUITE_VERSION,
  hashAlgoId = DEFAULT_HASH_ALGO_ID,
}) {
  const normalizedPersonData = normalizePersonData(personData);

  if (!normalizedPersonData.fullName || normalizedPersonData.fullName.length === 0) {
    throw new Error("InvalidFullName");
  }

  const versionOpts = { schemaVersion, cryptoSuiteVersion, hashAlgoId };
  const identityCommitment = computeIdentityCommitmentFromData(normalizedPersonData, versionOpts);
  const personHash = wrapIdentityCommitmentAsPersonHash(identityCommitment);

  let fatherIdentityCommitment = 0n;
  let fatherPersonHash = ethers.ZeroHash;
  if (fatherData) {
    const normalizedFather = normalizePersonData(fatherData);
    fatherIdentityCommitment = computeIdentityCommitmentFromData(normalizedFather, versionOpts);
    fatherPersonHash = wrapIdentityCommitmentAsPersonHash(fatherIdentityCommitment);
  }

  let motherIdentityCommitment = 0n;
  let motherPersonHash = ethers.ZeroHash;
  if (motherData) {
    const normalizedMother = normalizePersonData(motherData);
    motherIdentityCommitment = computeIdentityCommitmentFromData(normalizedMother, versionOpts);
    motherPersonHash = wrapIdentityCommitmentAsPersonHash(motherIdentityCommitment);
  }

  const submitter = await signer.getAddress();
  const proof = makeProofEnvelope(proofSystemId);
  const publicSignals = {
    identityCommitment,
    fatherIdentityCommitment,
    motherIdentityCommitment,
    submitter: BigInt(submitter),
    schemaVersion,
    cryptoSuiteVersion,
    hashAlgoId,
  };
  console.log("  ▶ [addPerson] Submitting addPersonVersion transaction...");
  const txStartTime = Date.now();
  const tx = await deepFamily
    .connect(signer)
    .addPersonVersion(
      proof,
      publicSignals,
      fatherData ? fatherVersion : 0,
      motherData ? motherVersion : 0,
      tag,
      ipfs,
    );

  const receipt = await tx.wait();
  const txDuration = Date.now() - txStartTime;
  console.log(
    `  ✓ [addPerson] addPersonVersion confirmed (tx: ${tx.hash || "unknown"}, block: ${
      receipt?.blockNumber ?? "n/a"
    }, tx wait: ${txDuration}ms)`
  );

  return {
    personHash,
    identityCommitment,
    tx,
    receipt,
    timing: { transaction: txDuration, total: txDuration },
  };
}

/**
 * Endorse version
 */
async function endorseVersion({
  deepFamily,
  token,
  signer,
  personHash,
  versionIndex,
  autoApprove = true,
}) {
  if (!Number.isInteger(versionIndex) || versionIndex <= 0) {
    throw new Error("versionIndex must be a positive integer starting from 1");
  }

  const [, totalVersions] = await deepFamily.listPersonVersions(personHash, 0, 0);
  if (versionIndex > totalVersions) {
    throw new Error(`Version index ${versionIndex} out of range (total=${totalVersions})`);
  }

  let fee = await token.recentReward();
  fee = BigInt(fee);

  if (fee > 0n) {
    const deepFamilyAddr = deepFamily.target || deepFamily.address;
    const signerAddr = await signer.getAddress();
    const allowance = await token.allowance(signerAddr, deepFamilyAddr);

    if (allowance < fee) {
      if (autoApprove) {
        const approveTx = await token
          .connect(signer)
          .approve(deepFamilyAddr, ethers.MaxUint256);
        await approveTx.wait();
      } else {
        throw new Error(
          `Insufficient allowance (${allowance}) < fee (${fee}). Enable autoApprove or manually approve.`
        );
      }
    }
  }

  const tx = await deepFamily.connect(signer).endorseVersion(personHash, versionIndex);
  const receipt = await tx.wait();

  return { tx, receipt, fee };
}

/**
 * Mint NFT using ZK API
 */
async function mintPersonVersionNFT({
  deepFamily,
  signer,
  personHash,
  versionIndex,
  tokenURI,
  basicInfo,
  supplementInfo,
  proofSystemId = DEFAULT_PROOF_SYSTEM_ID,
  schemaVersion = DEFAULT_SCHEMA_VERSION,
  cryptoSuiteVersion = DEFAULT_CRYPTO_SUITE_VERSION,
  hashAlgoId = DEFAULT_HASH_ALGO_ID,
}) {
  const normalizedBasic = normalizePersonData(basicInfo);
  const normalizedSupplement = {
    ...supplementInfo,
    fullName: normalizeNameForHash(supplementInfo.fullName || normalizedBasic.fullName),
  };

  if (!Number.isInteger(versionIndex) || versionIndex <= 0) {
    throw new Error("versionIndex must be a positive integer starting from 1");
  }

  const [, totalVersions] = await deepFamily.listPersonVersions(personHash, 0, 0);
  if (versionIndex > totalVersions) {
    throw new Error(`Version index ${versionIndex} out of range (total=${totalVersions})`);
  }

  const signerAddr = await signer.getAddress();
  const endorsed = Number(
    await deepFamily.endorsedVersionIndex(personHash, signerAddr)
  );
  if (endorsed !== versionIndex) {
    throw new Error(
      `You must endorse this version first (current endorsed index=${endorsed || 0})`
    );
  }

  const versionOpts = { schemaVersion, cryptoSuiteVersion, hashAlgoId };
  const identityCommitment = computeIdentityCommitmentFromData(normalizedBasic, versionOpts);

  const disclosureBindingValue = computeDisclosureBindingValue(
    normalizedBasic.fullName,
    normalizedBasic,
    versionOpts
  );

  const proof = makeProofEnvelope(proofSystemId);
  const publicSignals = {
    identityCommitment,
    disclosureBinding: disclosureBindingValue,
    minter: BigInt(signerAddr),
    schemaVersion,
    cryptoSuiteVersion,
    hashAlgoId,
  };

  const basicInfoStruct = {
    identityCommitment: ethers.zeroPadValue(ethers.toBeHex(identityCommitment), 32),
    isBirthBC: normalizedBasic.isBirthBC || false,
    birthYear: normalizedBasic.birthYear ?? 0,
    birthMonth: normalizedBasic.birthMonth ?? 0,
    birthDay: normalizedBasic.birthDay ?? 0,
    gender: normalizedBasic.gender ?? 0,
  };

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

  const coreInfo = { basicInfo: basicInfoStruct, supplementInfo: supplementInfoStruct };

  const tx = await deepFamily
    .connect(signer)
    .mintPersonVersionNFT(
      proof,
      publicSignals,
      versionIndex,
      tokenURI,
      coreInfo
    );

  const receipt = await tx.wait();

  let tokenId = null;
  try {
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
 * Compute person hash locally (no contract call needed)
 */
function computePersonHash({ personData, schemaVersion, cryptoSuiteVersion, hashAlgoId }) {
  const normalizedPersonData = normalizePersonData(personData);
  const identityCommitment = computeIdentityCommitmentFromData(normalizedPersonData, {
    schemaVersion: schemaVersion ?? DEFAULT_SCHEMA_VERSION,
    cryptoSuiteVersion: cryptoSuiteVersion ?? DEFAULT_CRYPTO_SUITE_VERSION,
    hashAlgoId: hashAlgoId ?? DEFAULT_HASH_ALGO_ID,
  });
  return wrapIdentityCommitmentAsPersonHash(identityCommitment);
}

/**
 * Check if person version exists
 */
async function checkPersonExists({ deepFamily, personHash, versionIndex = null }) {
  try {
    const result = await deepFamily.listPersonVersions(personHash, 0, 0);
    const totalVersions = Number(result[1] || result.totalVersions || 0);
    const exists = totalVersions > 0;

    if (versionIndex !== null) {
      return {
        exists: exists && Number(versionIndex) <= totalVersions,
        totalVersions,
      };
    }

    return { exists, totalVersions };
  } catch (e) {
    console.warn(`[checkPersonExists] Failed to check person ${personHash}: ${e.message}`);
    return { exists: false, totalVersions: 0 };
  }
}

/**
 * Load multi-language root nodes from data/persons/ directory
 */
function loadMultiLanguageRoots() {
  const dataDir = path.join(__dirname, "..", "data", "persons");
  const roots = {};

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

function getAllRoots() {
  return loadMultiLanguageRoots();
}

/**
 * Query on-chain progress for a person hash.
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
    result.versionIndex = 1;

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
      } catch (e) {}
    }
  } catch (e) {}

  return result;
}

export {
  addPersonVersion,
  endorseVersion,
  mintPersonVersionNFT,
  computePersonHash,
  checkPersonExists,
  loadMultiLanguageRoots,
  getAllRoots,
  getPersonProgress,
  normalizeNameForHash,
  normalizePassphraseForHash,
  normalizePersonData,
  computeIdentityCommitmentFromData,
  wrapIdentityCommitmentAsPersonHash,
};

export default {
  addPersonVersion,
  endorseVersion,
  mintPersonVersionNFT,
  computePersonHash,
  checkPersonExists,
  loadMultiLanguageRoots,
  getAllRoots,
  getPersonProgress,
  normalizeNameForHash,
  normalizePassphraseForHash,
  normalizePersonData,
  computeIdentityCommitmentFromData,
  wrapIdentityCommitmentAsPersonHash,
};
