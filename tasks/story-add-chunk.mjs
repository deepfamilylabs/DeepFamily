import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import { ethers } from "ethers";
import { ensureIntegratedSystem } from "../hardhat/integratedDeployment.mjs";

// addStoryChunk(tokenId, chunkIndex, chunkType, content, attachmentCID, expectedHash)
// Only NFT holder; chunkIndex must equal current totalChunks; optional integrity hash check.

const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const signer = (await ethers.getSigners())[0];
  const { deepFamily } = await ensureIntegratedSystem(connection);
  const deepFamilyWithSigner = deepFamily.connect(signer);

  const tokenId = BigInt(args.tokenid);
  const chunkIndex = Number(args.chunkindex);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) throw new Error("chunkindex must be >=0");

  const content = args.content;
  if (content.length === 0) throw new Error("content cannot be empty");
  if (Buffer.byteLength(content, "utf8") > 2048) {
    throw new Error("content exceeds 2048 byte limit");
  }

  const chunkType = Number(args.type || "0");
  if (!Number.isInteger(chunkType) || chunkType < 0 || chunkType > 18) {
    throw new Error("type must be an integer between 0 and 18 (19 chunk types available)");
  }

  const attachmentCID = args.attachment || "";
  if (attachmentCID.length > 0 && attachmentCID.length > 256) {
    throw new Error("attachment CID exceeds 256 characters");
  }

  // Read metadata to validate continuity & sealed state
  let metadata;
  try {
    metadata = await deepFamilyWithSigner.getStoryMetadata(tokenId);
  } catch (e) {
    throw new Error(`Failed to read metadata (token may not exist). ${e.message || e}`);
  }

  const currentTotal = Number(metadata.totalChunks);
  const isSealed = metadata.isSealed;
  if (isSealed) throw new Error("Story already sealed");
  if (chunkIndex !== currentTotal) {
    throw new Error(`Chunk index must equal current totalChunks (${currentTotal})`);
  }

  const expectedHash = args.exphash;
  // Compute local hash (contract uses keccak256(abi.encodePacked(content)))
  const localHash = ethers.keccak256(ethers.toUtf8Bytes(content));
  if (
    expectedHash &&
    expectedHash !== "0x" + "0".repeat(64) &&
    expectedHash.toLowerCase() !== localHash.toLowerCase()
  ) {
    throw new Error(`Provided exphash (${expectedHash}) does not match local hash (${localHash})`);
  }

  const tx = await deepFamilyWithSigner.addStoryChunk(
    tokenId,
    chunkIndex,
    chunkType,
    content,
    attachmentCID,
    expectedHash,
  );
  const receipt = await tx.wait();

  // Parse StoryChunkAdded event
  try {
    const iface = new ethers.Interface([
      "event StoryChunkAdded(uint256 indexed tokenId, uint256 indexed chunkIndex, bytes32 chunkHash, address indexed editor, uint256 contentLength, uint8 chunkType, string attachmentCID)",
    ]);
    const deepAddr = (await deepFamily.getAddress()).toLowerCase();
    for (const log of receipt.logs || []) {
      if ((log.address || "").toLowerCase() !== deepAddr) continue;
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "StoryChunkAdded") {
          break;
        }
      } catch (_) {
        /* ignore */
      }
    }
  } catch (e) {}
};

export default task("add-story-chunk", "Add a story chunk to an NFT (story sharding)")
  .addOption({
    name: "tokenid",
    description: "NFT tokenId (uint256)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "chunkindex",
    description: "Chunk index to add (must equal current totalChunks, starts at 0)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "content",
    description: "Chunk content (<=2048 UTF-8 bytes)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "type",
    description: "Chunk classification (uint8, default 0)",
    type: ArgumentType.STRING,
    defaultValue: "0",
  })
  .addOption({
    name: "attachment",
    description: "Attachment CID (optional)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "exphash",
    description: "Expected keccak256 hash of raw UTF-8 bytes of content (bytes32, optional)",
    type: ArgumentType.STRING,
    defaultValue: "0x" + "0".repeat(64),
  })
  .setAction(() => Promise.resolve({ default: action }))
  .build();
