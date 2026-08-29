import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import { setupStubVerifiers, mintPerson } from "./helpers/testHelper.mjs";

describe("Story Sharding - Error & Edge Cases", function () {
  this.timeout(90_000);

  async function deployAndMint() {
    const { deepFamily, deepFamilyReader, storyArchive } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [signer, other] = await hre.ethers.getSigners();
    await setupStubVerifiers(hre.ethers, deepFamily);

    await mintPerson(hre.ethers, deepFamily, signer, null, "Edge Person", {
      birthYear: 1970,
      gender: 1,
    });

    return {
      deepFamily: deepFamily.connect(signer),
      archive: storyArchive.connect(signer),
      reader: deepFamilyReader,
      signer,
      other,
      tokenId: 1n,
    };
  }

  async function sealStory(archive, _signer, tokenId) {
    return archive.sealStory(tokenId);
  }

  it("reverts when non-owner adds chunk", async () => {
    const { archive, other, tokenId } = await deployAndMint();
    await expect(
      archive.connect(other).addStoryChunk(tokenId, 0, 0, "content", "", hre.ethers.ZeroHash),
    ).to.be.revertedWithCustomError(archive, "MustBeNFTHolder");
  });

  it("reverts on index mismatch (skipping index)", async () => {
    const { archive, tokenId } = await deployAndMint();
    await archive.addStoryChunk(tokenId, 0, 0, "c0", "", hre.ethers.ZeroHash);
    await expect(
      archive.addStoryChunk(tokenId, 2, 0, "c2", "", hre.ethers.ZeroHash),
    ).to.be.revertedWithCustomError(archive, "ChunkIndexOutOfRange");
  });

  it("reverts on oversize content", async () => {
    const { archive, tokenId } = await deployAndMint();
    const longStr = "a".repeat(16_385);
    await expect(
      archive.addStoryChunk(tokenId, 0, 0, longStr, "", hre.ethers.ZeroHash),
    ).to.be.revertedWithCustomError(archive, "InvalidChunkContent");
  });

  it("reverts on hash mismatch", async () => {
    const { archive, tokenId } = await deployAndMint();
    const wrongHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("DIFFERENT"));
    await expect(
      archive.addStoryChunk(tokenId, 0, 0, "Real Content", "", wrongHash),
    ).to.be.revertedWithCustomError(archive, "ChunkHashMismatch");
  });

  it("cannot append after sealing", async () => {
    const { archive, tokenId } = await deployAndMint();
    await archive.addStoryChunk(tokenId, 0, 0, "c0", "", hre.ethers.ZeroHash);
    const [signer] = await hre.ethers.getSigners();
    await sealStory(archive, signer, tokenId);
    await expect(
      archive.addStoryChunk(tokenId, 1, 0, "c1", "", hre.ethers.ZeroHash),
    ).to.be.revertedWithCustomError(archive, "StoryAlreadySealed");
  });

  it("reverts sealing with zero chunks", async () => {
    const { archive, signer, tokenId } = await deployAndMint();
    await expect(sealStory(archive, signer, tokenId)).to.be.revertedWithCustomError(
      archive,
      "StoryNotFound",
    );
  });

  it("updates fullStoryHash correctly as chunks append", async () => {
    const { archive, reader, tokenId } = await deployAndMint();
    const c0 = "Chunk Zero";
    const c1 = "Chunk One";
    await archive.addStoryChunk(tokenId, 0, 0, c0, "", hre.ethers.ZeroHash);
    await archive.addStoryChunk(tokenId, 1, 0, c1, "", hre.ethers.ZeroHash);
    const h0 = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(c0));
    const h1 = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(c1));
    let expected = hre.ethers.ZeroHash;
    expected = hre.ethers.keccak256(
      hre.ethers.solidityPacked(["bytes32", "uint256", "bytes32"], [expected, 0n, h0]),
    );
    expected = hre.ethers.keccak256(
      hre.ethers.solidityPacked(["bytes32", "uint256", "bytes32"], [expected, 1n, h1]),
    );
    let meta = await reader.getStoryMetadata(tokenId);
    expect(meta.fullStoryHash).to.equal(expected);

    const c2 = "Chunk Two";
    await archive.addStoryChunk(tokenId, 2, 0, c2, "", hre.ethers.ZeroHash);
    const h2 = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(c2));
    expected = hre.ethers.keccak256(
      hre.ethers.solidityPacked(["bytes32", "uint256", "bytes32"], [expected, 2n, h2]),
    );
    meta = await reader.getStoryMetadata(tokenId);
    expect(meta.fullStoryHash).to.equal(expected);
  });

  it("records chunkType and attachment CID when provided", async () => {
    const { archive, reader, tokenId } = await deployAndMint();
    const attachment = "ipfs://exampleAttachmentCID";
    await archive.addStoryChunk(
      tokenId,
      0,
      3,
      "Source citation entry",
      attachment,
      hre.ethers.ZeroHash,
    );
    const chunk = await reader.getStoryChunk(tokenId, 0);
    expect(chunk.chunkType).to.equal(3);
    expect(chunk.attachmentCID).to.equal(attachment);
  });

  it("archives content in a blob while Reader reconstructs the canonical chunk", async () => {
    const { deepFamily, archive, reader, signer, tokenId } = await deployAndMint();
    const content = "Archived family story \u5185\u5bb9 \ud83d\ude80";
    const contentBytes = hre.ethers.toUtf8Bytes(content);
    const contentHash = hre.ethers.keccak256(contentBytes);
    const attachment = "ipfs://archived-source";
    expect(deepFamily.interface.hasFunction("storyMetadata(uint256)")).to.equal(false);
    expect(deepFamily.interface.hasFunction("storyChunks(uint256,uint256)")).to.equal(false);
    expect(deepFamily.interface.hasFunction("storyChunkHeaders(uint256,uint256)")).to.equal(false);
    expect(
      deepFamily.interface.hasFunction(
        "addStoryChunk(uint256,uint256,uint8,string,string,bytes32)",
      ),
    ).to.equal(false);
    expect(deepFamily.interface.hasFunction("sealStory(uint256)")).to.equal(false);
    expect(
      archive.interface.hasFunction("addStoryChunk(uint256,uint256,uint8,string,string,bytes32)"),
    ).to.equal(true);
    expect(archive.interface.hasFunction("sealStory(uint256)")).to.equal(true);
    expect(archive.interface.hasFunction("getStoryMetadata(uint256)")).to.equal(true);
    expect(archive.interface.hasFunction("getStoryChunk(uint256,uint256)")).to.equal(true);

    await expect(archive.addStoryChunk(tokenId, 0, 3, content, attachment, contentHash)).to.emit(
      archive,
      "StoryChunkAdded",
    );

    const archived = await archive.storyRef(tokenId, 0);
    expect(archived.pointer).to.not.equal(hre.ethers.ZeroAddress);
    expect(archived.contentHash).to.equal(contentHash);
    expect(archived.contentLength).to.equal(BigInt(contentBytes.length));
    expect(await hre.ethers.provider.getCode(archived.pointer)).to.equal(
      `0x00${hre.ethers.hexlify(contentBytes).slice(2)}`,
    );

    const archivedChunk = await archive.getStoryChunk(tokenId, 0);
    expect(archivedChunk.chunkHash).to.equal(contentHash);
    expect(archivedChunk.timestamp).to.be.greaterThan(0n);
    expect(archivedChunk.editor).to.equal(await signer.getAddress());
    expect(archivedChunk.chunkType).to.equal(3n);
    expect(archivedChunk.attachmentCID).to.equal(attachment);

    const chunk = await reader.getStoryChunk(tokenId, 0);
    expect(chunk.chunkIndex).to.equal(0n);
    expect(chunk.chunkHash).to.equal(contentHash);
    expect(chunk.content).to.equal(content);
    expect(chunk.timestamp).to.be.greaterThan(0n);
    expect(chunk.editor).to.equal(await signer.getAddress());
    expect(chunk.chunkType).to.equal(3n);
    expect(chunk.attachmentCID).to.equal(attachment);

    const expectedStoryHash = hre.ethers.keccak256(
      hre.ethers.solidityPacked(
        ["bytes32", "uint256", "bytes32"],
        [hre.ethers.ZeroHash, 0n, contentHash],
      ),
    );
    const metadata = await reader.getStoryMetadata(tokenId);
    expect(metadata.totalChunks).to.equal(1n);
    expect(metadata.fullStoryHash).to.equal(expectedStoryHash);
    expect(metadata.totalLength).to.equal(BigInt(contentBytes.length));
    expect(metadata.isSealed).to.equal(false);

    await archive.sealStory(tokenId);
    const sealed = await reader.getStoryMetadata(tokenId);
    expect(sealed.isSealed).to.equal(true);
    expect(sealed.totalChunks).to.equal(1n);
    expect(sealed.fullStoryHash).to.equal(expectedStoryHash);
    expect(sealed.totalLength).to.equal(BigInt(contentBytes.length));
  });
});
