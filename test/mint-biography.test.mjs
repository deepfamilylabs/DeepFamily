import "../hardhat-test-setup.mjs";
import { randomBytes } from "node:crypto";
import { expect } from "chai";
import hre from "hardhat";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import { mintPerson, setupStubVerifiers } from "./helpers/testHelper.mjs";
import {
  encodeStoryRecord,
  readStoryRecord,
  STORY_CHUNK_SCHEMA_ID,
  STORY_BIOGRAPHY_SCHEMA_ID,
} from "@deepfamily/protocol-core";

describe("Atomic compressed mint biography", function () {
  this.timeout(120_000);
  async function fixture() {
    const { deepFamily, archive } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [owner, other] = await hre.ethers.getSigners();
    await setupStubVerifiers(hre.ethers, deepFamily);
    return { deepFamily, archive, owner, other };
  }
  it("archives a biography beyond 256 bytes across segments with exact text, author and count", async () => {
    const { deepFamily, archive, owner } = await fixture();
    const story = `  中文\r\n${randomBytes(25_000).toString("base64")}\n😀 e\u0301  `;
    await mintPerson(hre.ethers, deepFamily, owner, null, "Archive Biography", { story });
    const ref = await archive.storyRecordRef(1n, 0n);
    expect(ref.schemaId).to.equal(STORY_BIOGRAPHY_SCHEMA_ID);
    expect(ref.author).to.equal(owner.address);
    expect(ref.blob.segmentCount).to.be.greaterThan(1n);
    const restored = await readStoryRecord({
      recordRef: ref,
      getCode: (address, block) => hre.ethers.provider.getCode(address, block),
    });
    expect(restored.decoded.content).to.equal(story);
    expect(restored.decoded.chunkType).to.equal(0);
    const state = await archive.storyState(1n);
    expect(state.totalRecords).to.equal(1n);
    expect(state.totalPayloadLength).to.equal(ref.blob.payloadLength);
    await expect(
      archive.appendStoryRecord(
        1n,
        1n,
        state.recordsHead,
        STORY_BIOGRAPHY_SCHEMA_ID,
        encodeStoryRecord({ content: "replacement", chunkType: 0, attachmentCID: "" }),
        hre.ethers.ZeroHash,
      ),
    ).to.be.revertedWithCustomError(archive, "InvalidSchemaId");
    await archive.sealStory(1n, 1n, state.recordsHead);
    expect((await archive.storyState(1n)).isSealed).to.equal(true);
  });
  it("creates no empty biography; the first ordinary record has index zero and type one", async () => {
    const { deepFamily, archive, owner } = await fixture();
    await mintPerson(hre.ethers, deepFamily, owner, null, "Empty Biography");
    expect((await archive.storyState(1n)).totalRecords).to.equal(0n);
    const payload = encodeStoryRecord({
      content: "First ordinary story",
      chunkType: 1,
      attachmentCID: "",
    });
    await archive.appendStoryRecord(
      1n,
      0n,
      hre.ethers.ZeroHash,
      STORY_CHUNK_SCHEMA_ID,
      payload,
      hre.ethers.keccak256(payload),
    );
    expect((await archive.storyRecordRef(1n, 0n)).schemaId).to.equal(STORY_CHUNK_SCHEMA_ID);
  });
  it("rolls the NFT assignment and Archive initialization back when the payload hash is wrong", async () => {
    const { deepFamily, archive, owner } = await fixture();
    await expect(
      mintPerson(hre.ethers, deepFamily, owner, null, "Rollback Biography", {
        story: "Exact original",
        expectedStoryPayloadHash: hre.ethers.ZeroHash,
      }),
    ).to.be.revertedWithCustomError(archive, "PayloadHashMismatch");
    expect(await deepFamily.tokenCounter()).to.equal(0n);
    expect((await archive.storyState(1n)).totalRecords).to.equal(0n);
    await mintPerson(hre.ethers, deepFamily, owner, null, "Retry Biography", {
      story: "Works after rollback",
    });
    expect(await deepFamily.tokenCounter()).to.equal(1n);
  });
  it("only DeepFamily may initialize, and initialization is consumed even for empty content", async () => {
    const [owner] = await hre.ethers.getSigners();
    const nft = await (await hre.ethers.getContractFactory("StoryNFTOwnerMock")).deploy();
    const archive = await (
      await hre.ethers.getContractFactory("DeepFamilyArchiveV1")
    ).deploy(await nft.getAddress());
    await nft.setArchive(await archive.getAddress());
    const hash = hre.ethers.keccak256("0x");
    await expect(
      archive.initializeStory(1n, owner.address, "0x", hash),
    ).to.be.revertedWithCustomError(archive, "UnauthorizedCaller");
    await nft.initializeStory(1n, owner.address, "0x", hash);
    await expect(nft.initializeStory(1n, owner.address, "0x", hash)).to.be.revertedWithCustomError(
      archive,
      "StoryAlreadyInitialized",
    );
  });
});
