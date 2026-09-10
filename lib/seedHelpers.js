import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { generatePersonRelationProof } from "./personCommitmentProof.js";
import { generateDisclosureBindingProof } from "./disclosureBindingProof.js";
import { estimateArchiveCall } from "./archiveOperations.js";
import {
  IDENTITY_SUITE_CANDIDATE_1,
  PERSON_VERSION_SCHEMA,
  STORY_BIOGRAPHY_SCHEMA_ID,
  encodeStoryRecord,
  decodeStoryRecord,
  readStoryRecord,
  computeStoryRecordHash,
  computeStoryHead,
  canonicalizeFullName,
  computePersonVersionContentCommitment,
  computeVersionHash,
  deriveIdentityMaterial,
  encryptPersonVersionEnvelope,
  normalizeIdentityFields,
  normalizePassphrase,
  roundTripPersonVersionEnvelope,
  wipeBytes,
  wipePreparedPersonVersionContent,
} from "@deepfamily/protocol-core";

const DEFAULT_CIRCUIT_ID = 1;
const IDENTITY_SUITE_ID = IDENTITY_SUITE_CANDIDATE_1;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeNameForHash(value) {
  return canonicalizeFullName(String(value ?? ""));
}

function normalizePassphraseForHash(value) {
  return normalizePassphrase(String(value ?? ""));
}

function normalizePersonData(data = {}) {
  const identity = normalizeIdentityFields({
    fullName: String(data.fullName ?? ""),
    gender: data.gender ?? 0,
    birthYear: data.birthYear ?? 0,
    birthMonth: data.birthMonth ?? 0,
    birthDay: data.birthDay ?? 0,
    isBirthBC: data.isBirthBC ?? false,
  });
  return {
    ...data,
    ...identity,
    passphrase: normalizePassphraseForHash(data.passphrase),
  };
}

function normalizeVersionIndex(value, label) {
  const normalized = BigInt(value ?? 0);
  if (normalized < 0n) throw new Error(`${label} must be a non-negative integer`);
  return normalized;
}

function normalizeVersionContent(versionContent = {}) {
  if (versionContent === null || typeof versionContent !== "object") {
    throw new Error("versionContent must be an object");
  }
  const tag = versionContent.tag ?? "";
  const biography = versionContent.biography ?? "";
  if (typeof tag !== "string") throw new Error("versionContent.tag must be a string");
  if (typeof biography !== "string") {
    throw new Error("versionContent.biography must be a string");
  }
  return { tag, biography };
}

async function deriveSeedIdentity(personData) {
  const normalized = normalizePersonData(personData);
  const material = await deriveIdentityMaterial({
    identity: normalized,
    rawPassphrase: normalized.passphrase,
    identitySuiteId: IDENTITY_SUITE_ID,
  });
  return {
    normalized,
    material,
    proofPerson: {
      ...material.identity,
      derivedSecretField: material.derivedSecretField,
      identitySuiteId: IDENTITY_SUITE_ID,
    },
  };
}

function wipeIdentityMaterial(material) {
  wipeBytes(material?.identitySalt);
  wipeBytes(material?.derivedSecretBytes);
}

function metadataIdentity(material) {
  return {
    ...material.identity,
    personHash: material.personHash.toLowerCase(),
  };
}

async function computeIdentityCommitmentFromData(personData) {
  const derived = await deriveSeedIdentity(personData);
  try {
    return derived.material.identityCommitment;
  } finally {
    wipeIdentityMaterial(derived.material);
  }
}

function wrapIdentityCommitmentAsPersonHash(identityCommitment) {
  const hex = ethers.zeroPadValue(ethers.toBeHex(identityCommitment), 32);
  return ethers.keccak256(ethers.solidityPacked(["bytes32"], [hex]));
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
  versionContent = {},
  circuitId = DEFAULT_CIRCUIT_ID,
  proofArtifacts = {},
}) {
  let personIdentity;
  let fatherIdentity;
  let motherIdentity;
  let prepared;
  const startedAt = Date.now();

  try {
    personIdentity = await deriveSeedIdentity(personData);
    if (fatherData) fatherIdentity = await deriveSeedIdentity(fatherData);
    if (motherData) motherIdentity = await deriveSeedIdentity(motherData);

    const fatherVersionIndex = fatherIdentity
      ? normalizeVersionIndex(fatherVersion, "fatherVersion")
      : 0n;
    const motherVersionIndex = motherIdentity
      ? normalizeVersionIndex(motherVersion, "motherVersion")
      : 0n;
    const content = normalizeVersionContent(versionContent);
    const personHash = personIdentity.material.personHash.toLowerCase();
    const fatherHash = fatherIdentity?.material.personHash.toLowerCase() ?? ethers.ZeroHash;
    const motherHash = motherIdentity?.material.personHash.toLowerCase() ?? ethers.ZeroHash;
    const metadata = {
      schema: PERSON_VERSION_SCHEMA,
      person: metadataIdentity(personIdentity.material),
      parents: {
        father: fatherIdentity
          ? { ...metadataIdentity(fatherIdentity.material), versionIndex: fatherVersionIndex }
          : null,
        mother: motherIdentity
          ? { ...metadataIdentity(motherIdentity.material), versionIndex: motherVersionIndex }
          : null,
      },
      tag: content.tag,
      biography: content.biography,
    };

    prepared = computePersonVersionContentCommitment({
      metadata,
      derivedSecretField: personIdentity.material.derivedSecretField,
    });
    const versionHash = computeVersionHash({
      personHash,
      fatherHash,
      fatherVersionIndex,
      motherHash,
      motherVersionIndex,
      versionCommitment: prepared.versionCommitment,
    });
    if (await deepFamily.versionExists(personHash, versionHash)) {
      throw new Error("DuplicateVersionCommitment");
    }

    const submitter = await signer.getAddress();
    const proofStartTime = Date.now();
    const generatedProof = await generatePersonRelationProof(
      personIdentity.proofPerson,
      fatherIdentity?.proofPerson ?? null,
      motherIdentity?.proofPerson ?? null,
      submitter,
      {
        circuitId,
        selfSuiteId: IDENTITY_SUITE_ID,
        fatherSuiteId: fatherIdentity ? IDENTITY_SUITE_ID : undefined,
        motherSuiteId: motherIdentity ? IDENTITY_SUITE_ID : undefined,
        contentDigest: prepared.contentDigest,
        wasm: proofArtifacts.wasm,
        zkey: proofArtifacts.zkey,
      },
    );
    const proofDuration = Date.now() - proofStartTime;
    if (generatedProof.person.personHash.toLowerCase() !== personHash) {
      throw new Error("Relation proof personHash does not match the derived suite-1 identity");
    }
    if ((generatedProof.father?.personHash.toLowerCase() ?? ethers.ZeroHash) !== fatherHash) {
      throw new Error("Relation proof fatherHash does not match canonical metadata");
    }
    if ((generatedProof.mother?.personHash.toLowerCase() ?? ethers.ZeroHash) !== motherHash) {
      throw new Error("Relation proof motherHash does not match canonical metadata");
    }
    if (generatedProof.versionCommitment !== prepared.versionCommitment) {
      throw new Error("Relation proof versionCommitment does not match canonical metadata");
    }

    const provider = signer.provider ?? deepFamily.runner?.provider;
    if (!provider) throw new Error("A provider is required to bind the metadata envelope context");
    const network = await provider.getNetwork();
    const context = {
      chainId: network.chainId,
      deepFamilyProxy: await deepFamily.getAddress(),
      personHash,
      fatherHash,
      fatherVersionIndex,
      motherHash,
      motherVersionIndex,
      versionCommitment: prepared.versionCommitment,
    };
    const encryptionStartTime = Date.now();
    const encrypted = await encryptPersonVersionEnvelope({
      metadata,
      rawPassphrase: personIdentity.normalized.passphrase,
      identitySuiteId: IDENTITY_SUITE_ID,
      context,
    });
    const validated = await roundTripPersonVersionEnvelope({
      envelope: encrypted.envelope,
      rawPassphrase: personIdentity.normalized.passphrase,
      context,
      expectedMetadata: metadata,
      submitterAndSelfSuiteId: generatedProof.submitterAndSelfSuiteId,
      expectedSubmitter: submitter,
    });
    const encryptionDuration = Date.now() - encryptionStartTime;
    if (validated.payloadHash !== encrypted.payloadHash) {
      throw new Error("Metadata envelope round trip changed payloadHash");
    }

    console.log("  ▶ [addPerson] Submitting addPersonVersion transaction...");
    const txStartTime = Date.now();
    const tx = await deepFamily
      .connect(signer)
      .addPersonVersion(
        generatedProof.proofEnvelope,
        generatedProof.publicSignalsStruct,
        fatherVersionIndex,
        motherVersionIndex,
        encrypted.envelope,
      );
    const receipt = await tx.wait();
    const txDuration = Date.now() - txStartTime;
    console.log(
      `  [ok] [addPerson] addPersonVersion confirmed (tx: ${tx.hash || "unknown"}, block: ${
        receipt?.blockNumber ?? "n/a"
      }, tx wait: ${txDuration}ms)`,
    );

    return {
      personHash,
      identityCommitment: personIdentity.material.identityCommitment,
      identitySuiteId: IDENTITY_SUITE_ID,
      contentDigest: prepared.contentDigest,
      versionCommitment: prepared.versionCommitment,
      versionHash,
      metadata,
      metadataEnvelope: encrypted.envelope,
      payloadHash: encrypted.payloadHash,
      proofArtifacts: generatedProof.artifacts,
      tx,
      receipt,
      timing: {
        proofGeneration: proofDuration,
        encryptionAndRoundTrip: encryptionDuration,
        transaction: txDuration,
        total: Date.now() - startedAt,
      },
    };
  } finally {
    wipePreparedPersonVersionContent(prepared);
    wipeIdentityMaterial(personIdentity?.material);
    wipeIdentityMaterial(fatherIdentity?.material);
    wipeIdentityMaterial(motherIdentity?.material);
  }
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

  const totalVersions = await deepFamily.personVersionsCount(personHash);
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
        const approveTx = await token.connect(signer).approve(deepFamilyAddr, ethers.MaxUint256);
        await approveTx.wait();
      } else {
        throw new Error(
          `Insufficient allowance (${allowance}) < fee (${fee}). Enable autoApprove or manually approve.`,
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
  circuitId = DEFAULT_CIRCUIT_ID,
  proofArtifacts = {},
}) {
  const normalizedBasic = normalizePersonData(basicInfo);
  const supplement = supplementInfo ?? {};
  const normalizedSupplement = {
    ...supplement,
    fullName: normalizeNameForHash(supplement.fullName || normalizedBasic.fullName),
  };

  if (!Number.isInteger(versionIndex) || versionIndex <= 0) {
    throw new Error("versionIndex must be a positive integer starting from 1");
  }

  const totalVersions = await deepFamily.personVersionsCount(personHash);
  if (versionIndex > totalVersions) {
    throw new Error(`Version index ${versionIndex} out of range (total=${totalVersions})`);
  }

  const signerAddr = await signer.getAddress();
  const endorsed = Number(await deepFamily.endorsedVersionIndex(personHash, signerAddr));
  if (endorsed !== versionIndex) {
    throw new Error(
      `You must endorse this version first (current endorsed index=${endorsed || 0})`,
    );
  }

  let identity;
  try {
    identity = await deriveSeedIdentity(normalizedBasic);
    if (identity.material.personHash.toLowerCase() !== personHash.toLowerCase()) {
      throw new Error(
        `Provided personHash does not match the deterministic suite-1 identity (${identity.material.personHash})`,
      );
    }

    const generatedProof = await generateDisclosureBindingProof(identity.proofPerson, signerAddr, {
      circuitId,
      selfSuiteId: IDENTITY_SUITE_ID,
      wasm: proofArtifacts.wasm,
      zkey: proofArtifacts.zkey,
    });
    const basicInfoStruct = {
      identityCommitment: ethers.zeroPadValue(
        ethers.toBeHex(identity.material.identityCommitment),
        32,
      ),
      isBirthBC: normalizedBasic.isBirthBC,
      birthYear: normalizedBasic.birthYear,
      birthMonth: normalizedBasic.birthMonth,
      birthDay: normalizedBasic.birthDay,
      gender: normalizedBasic.gender,
    };
    const supplementInfoStruct = {
      fullName: normalizedSupplement.fullName,
      birthPlace: normalizedSupplement.birthPlace || "",
      isDeathBC: normalizedSupplement.isDeathBC || false,
      deathYear: normalizedSupplement.deathYear ?? 0,
      deathMonth: normalizedSupplement.deathMonth ?? 0,
      deathDay: normalizedSupplement.deathDay ?? 0,
      deathPlace: normalizedSupplement.deathPlace || "",
    };
    const story = normalizedSupplement.story ?? "";
    if (typeof story !== "string") throw new Error("Mint biography must be a string");
    const storyPayload =
      story === ""
        ? "0x"
        : ethers.hexlify(
            encodeStoryRecord({
              content: story,
              chunkType: 0,
              attachmentCID: "",
            }),
          );
    if (story !== "" && decodeStoryRecord(storyPayload).content !== story) {
      throw new Error("Compressed mint biography failed exact-text round trip");
    }
    const storyPayloadHash = ethers.keccak256(storyPayload);
    const method = deepFamily.connect(signer).mintPersonVersionNFT;
    const args = Object.freeze([
      generatedProof.proofEnvelope,
      generatedProof.publicSignalsStruct,
      versionIndex,
      tokenURI,
      {
        basicInfo: basicInfoStruct,
        supplementInfo: supplementInfoStruct,
      },
      storyPayload,
      storyPayloadHash,
    ]);
    const gas = await estimateArchiveCall({ method, args, provider: signer.provider });
    const tx = await method(...args, { gasLimit: gas.gasLimit });
    const receipt = await tx.wait();
    if (receipt?.status !== 1 || receipt.hash.toLowerCase() !== tx.hash.toLowerCase()) {
      throw new Error("Mint receipt does not match the submitted transaction");
    }

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
    } catch (_) {}

    if (tokenId == null) throw new Error("Mint receipt is missing PersonNFTMinted");
    const archive = new ethers.Contract(
      await deepFamily.archive(),
      [
        "function storyRecordRef(uint256 tokenId,uint64 index) view returns (tuple(tuple(bytes32 payloadHash,address pointer,uint64 payloadLength,uint32 segmentCount) blob,bytes32 schemaId,address author,uint64 timestamp) record)",
        "function storyState(uint256 tokenId) view returns (tuple(bytes32 recordsHead,uint64 totalRecords,uint64 totalPayloadLength,uint64 lastUpdateTime,bool isSealed) state)",
        "event StoryRecordAppended(uint256 indexed tokenId,uint64 indexed index,tuple(bytes32 payloadHash,address pointer,uint64 payloadLength,uint32 segmentCount) blob,bytes32 schemaId,address indexed author,uint64 timestamp,bytes32 recordHash,bytes32 newHead)",
      ],
      signer,
    );
    const blockTag = receipt.blockNumber;
    const state = await archive.storyState(tokenId, { blockTag });
    if (story !== "") {
      const ref = await archive.storyRecordRef(tokenId, 0, { blockTag });
      if (
        ref.schemaId !== STORY_BIOGRAPHY_SCHEMA_ID ||
        ref.blob.payloadHash !== storyPayloadHash ||
        ref.author.toLowerCase() !== signerAddr.toLowerCase() ||
        ref.blob.payloadLength !== BigInt(ethers.getBytes(storyPayload).length)
      ) {
        throw new Error("Mint biography reference differs from the frozen submission");
      }
      const restored = await readStoryRecord({
        recordRef: ref,
        blockTag,
        getCode: (address, block) => signer.provider.getCode(address, block),
      });
      if (restored.decoded?.content !== story || restored.decoded?.chunkType !== 0) {
        throw new Error("Mint biography readback differs from the original text");
      }
      const recordHash = computeStoryRecordHash({
        chainId: gas.chainId,
        archive: await archive.getAddress(),
        tokenId,
        index: 0,
        schemaId: ref.schemaId,
        payloadHash: ref.blob.payloadHash,
        payloadLength: ref.blob.payloadLength,
        author: ref.author,
        timestamp: ref.timestamp,
      });
      const head = computeStoryHead({ previousHead: ethers.ZeroHash, recordHash });
      const events = receipt.logs
        .filter((log) => log.address.toLowerCase() === archive.target.toLowerCase())
        .map((log) => {
          try {
            return archive.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .filter(
          (event) =>
            event?.name === "StoryRecordAppended" &&
            event.args.tokenId === tokenId &&
            event.args.index === 0n,
        );
      if (
        events.length !== 1 ||
        events[0].args.recordHash !== recordHash ||
        events[0].args.newHead !== head ||
        state.totalRecords !== 1n ||
        state.recordsHead !== head ||
        state.totalPayloadLength !== ref.blob.payloadLength
      ) {
        throw new Error("Mint biography receipt and story state reconciliation failed");
      }
    } else if (
      state.totalRecords !== 0n ||
      state.recordsHead !== ethers.ZeroHash ||
      state.totalPayloadLength !== 0n
    ) {
      throw new Error("Empty mint biography unexpectedly created an Archive record");
    }
    return { tx, receipt, tokenId, storyPayload, ...gas, proofArtifacts: generatedProof.artifacts };
  } finally {
    wipeIdentityMaterial(identity?.material);
  }
}

/**
 * Compute person hash locally (no contract call needed)
 */
async function computePersonHash({ personData }) {
  const identity = await deriveSeedIdentity(personData);
  try {
    return identity.material.personHash;
  } finally {
    wipeIdentityMaterial(identity.material);
  }
}

/**
 * Check if person version exists
 */
async function checkPersonExists({ deepFamily, personHash, versionIndex = null }) {
  try {
    const totalVersions = Number(await deepFamily.personVersionsCount(personHash));
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
    en: { file: "en-kennedy-family.json", passphrase: "" },
    zh: { file: "zh-cao-family.json", passphrase: "" },
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
        console.warn(
          `Warning: Unable to identify root member in ${config.file}, skipping ${lang} root`,
        );
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
async function getPersonProgress({ deepFamily, deepFamilyReader, personHash }) {
  const result = {
    exists: false,
    totalVersions: 0,
    versionIndex: null,
    tokenId: 0,
    endorsementCount: 0,
    owner: null,
    storyState: null,
  };

  try {
    const totalVersions = await deepFamily.personVersionsCount(personHash);
    result.totalVersions = Number(totalVersions);
    if (result.totalVersions === 0) return result;

    result.exists = true;
    result.versionIndex = 1;

    const arrayIndex = result.versionIndex - 1;
    const endorsementCount = await deepFamily.versionEndorsementCount(personHash, arrayIndex);
    const tokenId = await deepFamily.versionToTokenId(personHash, result.versionIndex);
    result.endorsementCount = Number(endorsementCount);
    result.tokenId = Number(tokenId);

    if (result.tokenId > 0) {
      try {
        result.owner = await deepFamily.ownerOf(result.tokenId);
        if (deepFamilyReader) {
          result.storyState = await deepFamilyReader.getStoryState(result.tokenId);
        }
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
