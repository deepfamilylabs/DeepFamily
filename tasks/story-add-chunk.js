const { task } = require("hardhat/config");

// addStoryChunk(tokenId, chunkIndex, chunkType, content, attachmentCID, expectedHash)
// Only NFT holder; chunkIndex must equal current totalChunks; optional integrity hash check.

task("add-story-chunk", "Add a story chunk to an NFT (story sharding)")
  .addParam("tokenid", "NFT tokenId (uint256)")
  .addParam("chunkindex", "Chunk index to add (must equal current totalChunks, starts at 0)")
  .addParam("content", "Chunk content (<=2048 UTF-8 bytes)")
  .addOptionalParam("type", "Chunk classification (uint8, default 0)", "0")
  .addOptionalParam("attachment", "Attachment CID (optional)", "")
  .addOptionalParam(
    "exphash",
    "Expected keccak256 hash of raw UTF-8 bytes of content (bytes32, optional)",
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  )
  .setAction(async (args, hre) => {
    const { deployments, ethers } = hre;
    const { get } = deployments;
    const signer = (await ethers.getSigners())[0];

    // Ensure contracts deployed
    let deepDeployment;
    try {
      deepDeployment = await get("DeepFamily");
    } catch {
      await deployments.fixture(["Integrated"]);
      deepDeployment = await get("DeepFamily");
    }

    const deepFamily = await ethers.getContractAt("DeepFamily", deepDeployment.address, signer);

    const tokenId = BigInt(args.tokenid);
    const chunkIndex = Number(args.chunkindex);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) throw new Error("chunkindex must be >=0");

    const content = args.content;
    if (content.length === 0) throw new Error("content cannot be empty");
    if (Buffer.byteLength(content, "utf8") > 2048) {
      throw new Error("content exceeds 2048 byte limit");
    }

    const chunkType = Number(args.type || "0");
    if (!Number.isInteger(chunkType) || chunkType < 0 || chunkType > 255) {
      throw new Error("type must be an integer between 0 and 255");
    }

    const attachmentCID = args.attachment || "";
    if (attachmentCID.length > 0 && attachmentCID.length > 256) {
      throw new Error("attachment CID exceeds 256 characters");
    }

    // Read metadata to validate continuity & sealed state
    let metadata;
    try {
      metadata = await deepFamily.getStoryMetadata(tokenId);
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
      throw new Error(
        `Provided exphash (${expectedHash}) does not match local hash (${localHash})`,
      );
    }

    const tx = await deepFamily.addStoryChunk(
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
      const deepAddr = deepDeployment.address.toLowerCase();
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
  });
