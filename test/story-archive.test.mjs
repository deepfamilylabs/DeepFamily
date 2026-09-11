import "../hardhat-test-setup.mjs";
import fs from "node:fs";
import { expect } from "chai";
import hre from "hardhat";
import { readArchiveBlob } from "../packages/protocol-core/archive.js";
import { computeStoryRecordHash, computeStoryHead } from "../packages/protocol-core/story.js";

const SCHEMA = hre.ethers.id("deepfamily/story-chunk@1.0");
const bytes = (text) => hre.ethers.toUtf8Bytes(text);
function args(payload, index = 0n, head = hre.ethers.ZeroHash, schema = SCHEMA) {
  return [1n, index, head, schema, payload, hre.ethers.keccak256(payload)];
}

describe("DeepFamilyArchive story records", function () {
  this.timeout(120_000);

  async function fixture(name = "DeepFamilyArchive") {
    const [owner, other] = await hre.ethers.getSigners();
    const Owner = await hre.ethers.getContractFactory("StoryNFTOwnerMock");
    const nft = await Owner.deploy();
    const Archive = await hre.ethers.getContractFactory(name);
    const archive = await Archive.deploy(await nft.getAddress());
    await nft.setArchive(await archive.getAddress());
    await nft.setOwner(1n, owner.address);
    return { owner, other, nft, archive };
  }

  it("matches the shared two-record Solidity/JavaScript commitment golden vector", async () => {
    const { archive } = await fixture("ArchiveManifestHarness");
    const vector = JSON.parse(
      fs.readFileSync(
        new URL("../protocol-vectors/archive-story-v1.json", import.meta.url),
        "utf8",
      ),
    );
    expect(await archive.STORY_RECORD_DOMAIN()).to.equal(vector.recordDomain);
    expect(await archive.STORY_HEAD_DOMAIN()).to.equal(vector.headDomain);
    let previousHead = vector.initialHead;
    for (const item of vector.records) {
      const c = item.commitment;
      const record = {
        blob: {
          payloadHash: c.payloadHash,
          payloadLength: c.payloadLength,
          pointer: hre.ethers.ZeroAddress,
          segmentCount: 1n,
        },
        schemaId: c.schemaId,
        author: c.author,
        timestamp: c.timestamp,
      };
      const hash = await archive.recordHash(c.chainId, c.archive, c.tokenId, c.index, record);
      expect(hash).to.equal(item.recordHash);
      expect(hash).to.equal(computeStoryRecordHash(c));
      previousHead = await archive.nextHead(previousHead, hash);
      expect(previousHead).to.equal(item.newHead);
      // Physical representation must never alter the semantic commitment.
      const physicalVariant = {
        ...record,
        blob: { ...record.blob, pointer: c.author, segmentCount: 99n },
      };
      expect(
        await archive.recordHash(c.chainId, c.archive, c.tokenId, c.index, physicalVariant),
      ).to.equal(hash);
    }
    expect(previousHead).to.equal(vector.finalHead);
  });

  it("commits every semantic field using typed domain-separated hashes and chains records", async () => {
    const { archive, owner } = await fixture();
    let previousHead = hre.ethers.ZeroHash;
    let totalLength = 0n;
    const { chainId } = await hre.ethers.provider.getNetwork();
    for (const index of [0n, 1n]) {
      const payload = bytes(`  Family record ${index} 内容 🚀\n`);
      const schemaId = index === 0n ? SCHEMA : hre.ethers.id("future-schema");
      const receipt = await (
        await archive.appendStoryRecord(...args(payload, index, previousHead, schemaId))
      ).wait();
      const record = await archive.storyRecordRef(1n, index);
      const timestamp = BigInt((await hre.ethers.provider.getBlock(receipt.blockNumber)).timestamp);
      const input = {
        chainId,
        archive: await archive.getAddress(),
        tokenId: 1n,
        index,
        schemaId,
        payloadHash: hre.ethers.keccak256(payload),
        payloadLength: BigInt(payload.length),
        author: owner.address,
        timestamp,
      };
      const hash = computeStoryRecordHash(input);
      // Independent Solidity abi.encode type list protects against a shared client mistake.
      const expected = hre.ethers.keccak256(
        hre.ethers.AbiCoder.defaultAbiCoder().encode(
          [
            "bytes32",
            "uint256",
            "address",
            "uint256",
            "uint64",
            "bytes32",
            "bytes32",
            "uint64",
            "address",
            "uint64",
          ],
          [
            hre.ethers.id("deepfamily.archive.story-record.v1"),
            chainId,
            input.archive,
            1n,
            index,
            schemaId,
            input.payloadHash,
            input.payloadLength,
            owner.address,
            timestamp,
          ],
        ),
      );
      expect(hash).to.equal(expected);
      previousHead = computeStoryHead({ previousHead, recordHash: hash });
      const event = receipt.logs
        .map((log) => {
          try {
            return archive.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((log) => log?.name === "StoryRecordAppended");
      expect(event.args.recordHash).to.equal(expected);
      expect(event.args.newHead).to.equal(previousHead);
      expect(event.args.blob).to.deep.equal(record.blob);
      expect(record.schemaId).to.equal(schemaId);
      expect(record.author).to.equal(owner.address);
      expect(record.timestamp).to.equal(timestamp);
      totalLength += BigInt(payload.length);
      const state = await archive.storyState(1n);
      expect(state.recordsHead).to.equal(previousHead);
      expect(state.totalRecords).to.equal(index + 1n);
      expect(state.totalPayloadLength).to.equal(totalLength);
      expect(state.lastUpdateTime).to.equal(timestamp);
      for (const [field, value] of Object.entries(input)) {
        const changed =
          typeof value === "bigint"
            ? value + 1n
            : field === "archive" || field === "author"
              ? "0x0000000000000000000000000000000000000042"
              : hre.ethers.id(`changed-${field}`);
        expect(computeStoryRecordHash({ ...input, [field]: changed })).not.to.equal(expected);
      }
    }
    expect((await archive.storyRecordRef(1n, 2n)).blob.pointer).to.equal(hre.ethers.ZeroAddress);
  });

  it("automatically stores a multi-segment payload and keeps unknown schemas opaque", async () => {
    const { archive } = await fixture();
    const payload = bytes("x".repeat(16_383) + "🚀" + "\\u4e2d");
    await archive.appendStoryRecord(
      ...args(payload, 0n, hre.ethers.ZeroHash, hre.ethers.id("unknown-schema")),
    );
    const record = await archive.storyRecordRef(1n, 0n);
    expect(record.blob.segmentCount).to.equal(2n);
    const result = await readArchiveBlob({
      pointer: record.blob.pointer,
      payloadHash: record.blob.payloadHash,
      payloadLength: record.blob.payloadLength,
      segmentCount: record.blob.segmentCount,
      getCode: (address) => hre.ethers.provider.getCode(address),
    });
    expect(hre.ethers.hexlify(result.payload)).to.equal(hre.ethers.hexlify(payload));
  });

  it("requires the current NFT owner and blocks all shadow-archive writes", async () => {
    const { archive, nft, owner, other } = await fixture();
    const payload = bytes("record");
    await expect(
      archive.connect(other).appendStoryRecord(...args(payload)),
    ).to.be.revertedWithCustomError(archive, "MustBeNFTHolder");
    await expect(
      archive.connect(other).sealStory(1n, 0n, hre.ethers.ZeroHash),
    ).to.be.revertedWithCustomError(archive, "MustBeNFTHolder");
    await nft.setOwner(1n, other.address);
    await expect(
      archive.connect(owner).appendStoryRecord(...args(payload)),
    ).to.be.revertedWithCustomError(archive, "MustBeNFTHolder");
    await archive.connect(other).appendStoryRecord(...args(payload));
    expect((await archive.storyRecordRef(1n, 0n)).author).to.equal(other.address);
    const state = await archive.storyState(1n);
    await nft.setArchive(hre.ethers.ZeroAddress);
    await expect(
      archive.connect(other).appendStoryRecord(...args(payload, 1n, state.recordsHead)),
    ).to.be.revertedWithCustomError(archive, "ArchiveNotActive");
    await expect(
      archive.connect(other).sealStory(1n, 1n, state.recordsHead),
    ).to.be.revertedWithCustomError(archive, "ArchiveNotActive");
  });

  it("rejects empty payloads, zero schemas, mandatory hash mismatches and stale index/head", async () => {
    const { archive } = await fixture();
    const payload = bytes("record");
    await expect(archive.appendStoryRecord(...args("0x"))).to.be.revertedWithCustomError(
      archive,
      "InvalidPayloadLength",
    );
    await expect(
      archive.appendStoryRecord(...args(payload, 0n, hre.ethers.ZeroHash, hre.ethers.ZeroHash)),
    ).to.be.revertedWithCustomError(archive, "InvalidSchemaId");
    for (const hash of [hre.ethers.ZeroHash, hre.ethers.id("wrong")]) {
      const wrong = args(payload);
      wrong[5] = hash;
      await expect(archive.appendStoryRecord(...wrong)).to.be.revertedWithCustomError(
        archive,
        "PayloadHashMismatch",
      );
    }
    await expect(archive.appendStoryRecord(...args(payload, 1n))).to.be.revertedWithCustomError(
      archive,
      "StoryIndexMismatch",
    );
    await expect(
      archive.appendStoryRecord(...args(payload, 0n, hre.ethers.id("stale"))),
    ).to.be.revertedWithCustomError(archive, "StoryHeadMismatch");
    await archive.appendStoryRecord(...args(payload));
    await expect(archive.appendStoryRecord(...args(payload))).to.be.revertedWithCustomError(
      archive,
      "StoryIndexMismatch",
    );
    await expect(archive.appendStoryRecord(...args(payload, 1n))).to.be.revertedWithCustomError(
      archive,
      "StoryHeadMismatch",
    );
  });

  it("seals only a nonempty current state and preserves its final commitment forever", async () => {
    const { archive } = await fixture();
    await expect(archive.sealStory(1n, 0n, hre.ethers.ZeroHash)).to.be.revertedWithCustomError(
      archive,
      "StoryNotFound",
    );
    const payload = bytes("record");
    await archive.appendStoryRecord(...args(payload));
    const state = await archive.storyState(1n);
    await expect(archive.sealStory(1n, 0n, state.recordsHead)).to.be.revertedWithCustomError(
      archive,
      "StoryIndexMismatch",
    );
    await expect(archive.sealStory(1n, 1n, hre.ethers.ZeroHash)).to.be.revertedWithCustomError(
      archive,
      "StoryHeadMismatch",
    );
    const tx = await archive.sealStory(1n, 1n, state.recordsHead);
    const receipt = await tx.wait();
    const timestamp = BigInt((await hre.ethers.provider.getBlock(receipt.blockNumber)).timestamp);
    await expect(tx)
      .to.emit(archive, "StorySealed")
      .withArgs(
        1n,
        1n,
        state.recordsHead,
        BigInt(payload.length),
        (await hre.ethers.getSigners())[0].address,
        timestamp,
      );
    const sealed = await archive.storyState(1n);
    expect(sealed.isSealed).to.equal(true);
    expect(sealed.recordsHead).to.equal(state.recordsHead);
    expect(sealed.totalPayloadLength).to.equal(state.totalPayloadLength);
    await expect(archive.sealStory(1n, 1n, state.recordsHead)).to.be.revertedWithCustomError(
      archive,
      "StoryAlreadySealed",
    );
    await expect(
      archive.appendStoryRecord(...args(payload, 1n, state.recordsHead)),
    ).to.be.revertedWithCustomError(archive, "StoryAlreadySealed");
  });

  it("atomically rolls back later segment/manifest deployment failures including story head", async () => {
    for (const failOn of [2, 3]) {
      const { archive } = await fixture("ArchiveManifestHarness");
      await archive.setFailOnDeployment(failOn);
      const address = await archive.getAddress();
      const nonce = await hre.ethers.provider.getTransactionCount(address);
      const child = hre.ethers.getCreateAddress({ from: address, nonce });
      await expect(
        archive.appendStoryRecord(...args(bytes("x".repeat(16_385)))),
      ).to.be.revertedWithCustomError(archive, "DeploymentFailed");
      const state = await archive.storyState(1n);
      expect(state.totalRecords).to.equal(0n);
      expect(state.recordsHead).to.equal(hre.ethers.ZeroHash);
      expect(state.totalPayloadLength).to.equal(0n);
      expect((await archive.storyRecordRef(1n, 0n)).blob.pointer).to.equal(hre.ethers.ZeroAddress);
      expect(await hre.ethers.provider.getCode(child)).to.equal("0x");
      expect(await hre.ethers.provider.getTransactionCount(address)).to.equal(nonce);
    }
  });
});
