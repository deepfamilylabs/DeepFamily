import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";

describe("StoryArchiveV1", function () {
  this.timeout(120_000);

  async function deployArchiveFixture() {
    const [owner, other] = await hre.ethers.getSigners();
    const Owner = await hre.ethers.getContractFactory("StoryNFTOwnerMock");
    const nft = await Owner.deploy();
    await nft.waitForDeployment();

    const Archive = await hre.ethers.getContractFactory("StoryArchiveV1");
    const archive = await Archive.deploy(await nft.getAddress());
    await archive.waitForDeployment();
    return { owner, other, nft, archive };
  }

  it("rejects a zero or codeless DeepFamily binding", async () => {
    const Archive = await hre.ethers.getContractFactory("StoryArchiveV1");
    const [, eoa] = await hre.ethers.getSigners();

    await expect(Archive.deploy(hre.ethers.ZeroAddress)).to.be.revertedWithCustomError(
      Archive,
      "InvalidDeepFamilyAddress",
    );
    await expect(Archive.deploy(await eoa.getAddress())).to.be.revertedWithCustomError(
      Archive,
      "InvalidDeepFamilyAddress",
    );
  });

  it("stores content as STOP-prefixed runtime and derives its immutable reference", async () => {
    const { owner, nft, archive } = await deployArchiveFixture();
    const tokenId = 42n;
    const chunkIndex = 0n;
    const content = "Family story 内容 🚀";
    const contentBytes = hre.ethers.toUtf8Bytes(content);
    const contentHex = hre.ethers.hexlify(contentBytes);
    const contentHash = hre.ethers.keccak256(contentBytes);
    await nft.setOwner(tokenId, await owner.getAddress());

    await expect(
      archive.addStoryChunk(tokenId, chunkIndex, 0, content, "", hre.ethers.ZeroHash),
    ).to.emit(archive, "StoryChunkAdded");

    const story = await archive.storyRef(tokenId, chunkIndex);
    expect(story.pointer).to.not.equal(hre.ethers.ZeroAddress);
    expect(story.contentHash).to.equal(contentHash);
    expect(story.contentLength).to.equal(BigInt(contentBytes.length));
    expect(await hre.ethers.provider.getCode(story.pointer)).to.equal(`0x00${contentHex.slice(2)}`);

    const chunk = await archive.getStoryChunk(tokenId, chunkIndex);
    expect(chunk.chunkIndex).to.equal(chunkIndex);
    expect(chunk.chunkHash).to.equal(contentHash);
    expect(chunk.content).to.equal(content);
    const metadata = await archive.getStoryMetadata(tokenId);
    expect(metadata.totalChunks).to.equal(1n);
    expect(metadata.totalLength).to.equal(BigInt(contentBytes.length));
    expect(metadata.fullStoryHash).to.equal(
      hre.ethers.keccak256(
        hre.ethers.solidityPacked(
          ["bytes32", "uint256", "bytes32"],
          [hre.ethers.ZeroHash, chunkIndex, contentHash],
        ),
      ),
    );

    const missing = await archive.storyRef(tokenId, chunkIndex + 1n);
    expect(missing.pointer).to.equal(hre.ethers.ZeroAddress);
    expect(missing.contentHash).to.equal(hre.ethers.ZeroHash);
    expect(missing.contentLength).to.equal(0n);
  });

  it("accepts exactly 1 and 16,384 content bytes", async () => {
    const { owner, nft, archive } = await deployArchiveFixture();
    await nft.setOwner(1n, await owner.getAddress());

    for (const [chunkIndex, content] of [
      [0n, "a"],
      [1n, "b".repeat(16_384)],
    ]) {
      await archive.addStoryChunk(1n, chunkIndex, 0, content, "", hre.ethers.ZeroHash);
      const story = await archive.storyRef(1n, chunkIndex);
      const bytes = hre.ethers.toUtf8Bytes(content);
      expect(story.contentLength).to.equal(BigInt(bytes.length));
      expect(story.contentHash).to.equal(hre.ethers.keccak256(bytes));
      expect(await hre.ethers.provider.getCode(story.pointer)).to.equal(
        `0x00${hre.ethers.hexlify(bytes).slice(2)}`,
      );
    }
  });

  it("keeps a 16,384-byte chunk below the eSpace single-tx limit with 20% headroom", async () => {
    const { owner, nft, archive } = await deployArchiveFixture();
    await nft.setOwner(1n, await owner.getAddress());
    const content = "a".repeat(16_384);
    const args = [1n, 0n, 0, content, "", hre.ethers.ZeroHash];
    const estimate = await archive.addStoryChunk.estimateGas(...args);
    const espaceSingleTransactionGasLimit = 15_000_000n;
    expect((estimate * 120n + 99n) / 100n).to.be.lessThan(espaceSingleTransactionGasLimit);

    const receipt = await (await archive.addStoryChunk(...args)).wait();
    expect(receipt.gasUsed).to.be.at.most(estimate);
    expect((await archive.storyRef(1n, 0n)).contentLength).to.equal(16_384n);
  });

  it("rejects empty and 16,385-byte content", async () => {
    const { owner, nft, archive } = await deployArchiveFixture();
    await nft.setOwner(1n, await owner.getAddress());

    await expect(
      archive.addStoryChunk(1n, 0n, 0, "", "", hre.ethers.ZeroHash),
    ).to.be.revertedWithCustomError(archive, "InvalidChunkContent");
    await expect(
      archive.addStoryChunk(1n, 0n, 0, "a".repeat(16_385), "", hre.ethers.ZeroHash),
    ).to.be.revertedWithCustomError(archive, "InvalidChunkContent");
  });

  it("rejects non-owners and duplicate token/chunk keys", async () => {
    const { owner, other, nft, archive } = await deployArchiveFixture();
    await nft.setOwner(9n, await owner.getAddress());
    await nft.setOwner(10n, await owner.getAddress());

    await expect(
      archive.connect(other).addStoryChunk(9n, 0n, 0, "a", "", hre.ethers.ZeroHash),
    ).to.be.revertedWithCustomError(archive, "MustBeNFTHolder");

    await archive.addStoryChunk(9n, 0n, 0, "a", "", hre.ethers.ZeroHash);
    await expect(
      archive.addStoryChunk(9n, 0n, 0, "b", "", hre.ethers.ZeroHash),
    ).to.be.revertedWithCustomError(archive, "StoryAlreadyStored");

    await expect(archive.addStoryChunk(10n, 0n, 0, "b", "", hre.ethers.ZeroHash)).to.emit(
      archive,
      "StoryChunkAdded",
    );
  });
});
