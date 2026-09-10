import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import { setupStubVerifiers, mintPerson } from "./helpers/testHelper.mjs";
import { encodeStoryRecord, readStoryRecord } from "../packages/protocol-core/story.js";
import { STORY_CHUNK_SCHEMA_ID } from "../packages/protocol-core/constants.js";

describe("Unified Archive and Reader integration", function () {
  this.timeout(120_000);

  async function deployAndMint() {
    const {
      deepFamily,
      deepFamilyReader: reader,
      archive,
    } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [signer, other] = await hre.ethers.getSigners();
    await setupStubVerifiers(hre.ethers, deepFamily);
    await mintPerson(hre.ethers, deepFamily, signer, null, "Edge Person", {
      birthYear: 1970,
      gender: 1,
    });
    return { deepFamily, archive: archive.connect(signer), reader, signer, other, tokenId: 1n };
  }

  async function append(archive, tokenId, content, schemaId = STORY_CHUNK_SCHEMA_ID) {
    const payload = encodeStoryRecord({ content, chunkType: 3, attachmentCID: "ipfs://source" });
    const state = await archive.storyState(tokenId);
    await archive.appendStoryRecord(
      tokenId,
      state.totalRecords,
      state.recordsHead,
      schemaId,
      payload,
      hre.ethers.keccak256(payload),
    );
    return payload;
  }

  it("exposes only the unified write API and bounded ref-based Reader API", async () => {
    const { deepFamily, archive, reader, tokenId } = await deployAndMint();
    expect(await deepFamily.archive()).to.equal(await archive.getAddress());
    expect(await reader.ARCHIVE()).to.equal(await archive.getAddress());
    for (const removed of [
      "metadataArchive",
      "storyArchive",
      "setMetadataArchive",
      "setStoryArchive",
      "addStoryChunk",
      "sealStory",
    ]) {
      expect(deepFamily.interface.hasFunction(removed)).to.equal(false);
    }
    for (const removed of ["addStoryChunk", "getStoryMetadata", "getStoryChunk", "storyRef"]) {
      expect(archive.interface.hasFunction(removed)).to.equal(false);
    }
    for (const removed of ["getStoryMetadata", "getStoryChunk", "listStoryChunks"]) {
      expect(reader.interface.hasFunction(removed)).to.equal(false);
    }
    const content = "  exact text 内容 🚀\n";
    const payload = await append(archive, tokenId, content);
    const ref = await reader.getStoryRecordRef(tokenId, 0n);
    expect(ref).to.deep.equal(await archive.storyRecordRef(tokenId, 0n));
    const hydrated = await readStoryRecord({
      recordRef: ref,
      getCode: (address) => hre.ethers.provider.getCode(address),
    });
    expect(hre.ethers.hexlify(hydrated.payload)).to.equal(hre.ethers.hexlify(payload));
    expect(hydrated.decoded.content).to.equal(content);
    expect(hydrated.decoded.chunkType).to.equal(3);
    expect(hydrated.decoded.attachmentCID).to.equal("ipfs://source");
    expect(await reader.getStoryState(tokenId)).to.deep.equal(await archive.storyState(tokenId));
  });

  it("paginates records with a hard 100-ref maximum and rejects absent indices/tokens", async () => {
    const { archive, reader, tokenId } = await deployAndMint();
    for (const content of ["first", "second", "third"]) await append(archive, tokenId, content);
    const first = await reader.listStoryRecords(tokenId, 0n, 2n);
    expect(first.records.length).to.equal(2);
    expect(first.totalRecords).to.equal(3n);
    expect(first.hasMore).to.equal(true);
    expect(first.nextOffset).to.equal(2n);
    expect(first.records[0]).to.deep.equal(await archive.storyRecordRef(tokenId, 0n));
    const second = await reader.listStoryRecords(tokenId, first.nextOffset, 100n);
    expect(second.records.length).to.equal(1);
    expect(second.records[0]).to.deep.equal(await archive.storyRecordRef(tokenId, 2n));
    expect(second.hasMore).to.equal(false);
    expect(second.nextOffset).to.equal(3n);
    for (const [offset, limit] of [
      [0n, 0n],
      [4n, 2n],
    ]) {
      expect((await reader.listStoryRecords(tokenId, offset, limit)).records).to.have.length(0);
    }
    await expect(reader.listStoryRecords(tokenId, 0n, 101n)).to.be.revertedWithCustomError(
      reader,
      "PageSizeExceedsLimit",
    );
    await expect(reader.getStoryRecordRef(tokenId, 3n)).to.be.revertedWithCustomError(
      reader,
      "RecordIndexOutOfRange",
    );
    await expect(reader.getStoryState(999n)).to.revert(hre.ethers);
    await expect(reader.listStoryRecords(999n, 0n, 1n)).to.revert(hre.ethers);
  });

  it("changes append/seal authorization immediately on an actual NFT transfer", async () => {
    const { deepFamily, archive, reader, tokenId, signer, other } = await deployAndMint();
    await append(archive, tokenId, "before transfer");
    const first = await reader.getStoryRecordRef(tokenId, 0n);
    await deepFamily.transferFrom(signer.address, other.address, tokenId);
    const state = await archive.storyState(tokenId);
    const payload = encodeStoryRecord({
      content: "after transfer",
      chunkType: 0,
      attachmentCID: "",
    });
    const args = [
      tokenId,
      state.totalRecords,
      state.recordsHead,
      STORY_CHUNK_SCHEMA_ID,
      payload,
      hre.ethers.keccak256(payload),
    ];
    await expect(archive.appendStoryRecord(...args)).to.be.revertedWithCustomError(
      archive,
      "MustBeNFTHolder",
    );
    await expect(
      archive.sealStory(tokenId, state.totalRecords, state.recordsHead),
    ).to.be.revertedWithCustomError(archive, "MustBeNFTHolder");
    await archive.connect(other).appendStoryRecord(...args);
    expect(first.author).to.equal(signer.address);
    expect((await reader.getStoryRecordRef(tokenId, 1n)).author).to.equal(other.address);
    const finalState = await archive.storyState(tokenId);
    await archive
      .connect(other)
      .sealStory(tokenId, finalState.totalRecords, finalState.recordsHead);
    expect((await reader.getStoryState(tokenId)).isSealed).to.equal(true);
  });

  it("returns verified raw bytes for a schema the client does not recognize", async () => {
    const { archive, reader, tokenId } = await deployAndMint();
    const schemaId = hre.ethers.id("future-schema");
    await append(archive, tokenId, "future record", schemaId);
    const recordRef = await reader.getStoryRecordRef(tokenId, 0n);
    const record = await readStoryRecord({
      recordRef,
      getCode: (address) => hre.ethers.provider.getCode(address),
    });
    expect(record.schemaId).to.equal(schemaId);
    expect(record.decoded).to.equal(null);
    expect(record.payload.length).to.be.greaterThan(0);
  });
});
