import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { readArchiveBlob, readMetadataEnvelopeFromRef } from "../packages/protocol-core/archive.js";

export function blobInput(blob) {
  return {
    pointer: blob.pointer,
    payloadHash: blob.payloadHash,
    payloadLength: blob.payloadLength,
    segmentCount: blob.segmentCount,
    getCode: (address) => hre.ethers.provider.getCode(address),
  };
}

describe("DeepFamilyArchive metadata and physical blobs", function () {
  this.timeout(120_000);

  async function fixture(name = "DeepFamilyArchive") {
    const Caller = await hre.ethers.getContractFactory("ArchiveCallerHarness");
    const caller = await Caller.deploy();
    const Archive = await hre.ethers.getContractFactory(name);
    const archive = await Archive.deploy(await caller.getAddress());
    await caller.setArchive(await archive.getAddress());
    return { caller, archive };
  }

  it("rejects zero and codeless bindings and advertises the frozen protocol identity", async () => {
    const Archive = await hre.ethers.getContractFactory("DeepFamilyArchive");
    const [, eoa] = await hre.ethers.getSigners();
    for (const address of [hre.ethers.ZeroAddress, await eoa.getAddress()]) {
      await expect(Archive.deploy(address)).to.be.revertedWithCustomError(
        Archive,
        "InvalidDeepFamilyAddress",
      );
    }
    const { archive } = await fixture();
    expect(await archive.archiveKind()).to.equal(hre.ethers.id("deepfamily.archive.v1"));
    expect(await archive.apiVersion()).to.equal(1n);
    expect(await archive.supportsInterface("0x01ffc9a7")).to.equal(true);
    expect(await archive.supportsInterface("0xffffffff")).to.equal(false);
    expect(archive.interface.hasFunction("MAX_TOTAL_PAYLOAD_LENGTH")).to.equal(false);
  });

  it("round-trips all nonempty boundary sizes including 16,385 and 32,768 bytes", async () => {
    const { caller, archive } = await fixture();
    for (const length of [1, 16_383, 16_384, 16_385, 32_768]) {
      const personHash = hre.ethers.id(`boundary-${length}`);
      const payload = `0x${"ab".repeat(length)}`;
      const receipt = await (
        await caller.store(await archive.getAddress(), personHash, 1, payload)
      ).wait();
      const ref = await archive.metadataRef(personHash, 1);
      const event = receipt.logs
        .map((log) => {
          try {
            return archive.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((log) => log?.name === "MetadataStored");
      expect(event.args.blob).to.deep.equal(ref);
      expect(ref.payloadLength).to.equal(BigInt(length));
      expect(ref.segmentCount).to.equal(BigInt(Math.ceil(length / 16_384)));
      expect(ref.payloadHash).to.equal(hre.ethers.keccak256(payload));
      expect(hre.ethers.hexlify((await readArchiveBlob(blobInput(ref))).payload)).to.equal(payload);
      if (length <= 16_384)
        expect(await hre.ethers.provider.getCode(ref.pointer)).to.equal(`0x00${payload.slice(2)}`);
    }
  });

  it("rejects empty payloads, non-DeepFamily callers, duplicate keys and shadow archives", async () => {
    const { caller, archive } = await fixture();
    const address = await archive.getAddress();
    const key = hre.ethers.id("duplicate");
    await expect(caller.store(address, key, 1, "0x")).to.be.revertedWithCustomError(
      archive,
      "InvalidPayloadLength",
    );
    await expect(archive.storeMetadata(key, 1, "0x01")).to.be.revertedWithCustomError(
      archive,
      "UnauthorizedCaller",
    );
    await caller.store(address, key, 1, "0x01");
    await expect(caller.store(address, key, 1, "0x02")).to.be.revertedWithCustomError(
      archive,
      "MetadataAlreadyStored",
    );
    await caller.setArchive(hre.ethers.ZeroAddress);
    await expect(caller.store(address, key, 2, "0x02")).to.be.revertedWithCustomError(
      archive,
      "ArchiveNotActive",
    );
    expect((await archive.metadataRef(key, 2)).pointer).to.equal(hre.ethers.ZeroAddress);
  });

  it("transparently reads a future DFM format across physical segments", async () => {
    const { caller, archive } = await fixture();
    const payload = new Uint8Array(16_385).fill(0xab);
    payload.set([0x44, 0x46, 0x4d, 0x31, 2], 0);
    payload.set([0, 0, 0, 1], 16);
    const key = hre.ethers.id("future-format");
    await caller.store(await archive.getAddress(), key, 1, payload);
    const result = await readMetadataEnvelopeFromRef(blobInput(await archive.metadataRef(key, 1)));
    expect(result.prefix.formatVersion).to.equal(2);
    expect(hre.ethers.hexlify(result.envelope)).to.equal(hre.ethers.hexlify(payload));
  });

  it("rolls back refs, child CREATEs and deployment counters when a later segment or manifest fails", async () => {
    for (const failOn of [2, 3]) {
      const { caller, archive } = await fixture("ArchiveManifestHarness");
      const address = await archive.getAddress();
      const key = hre.ethers.id(`fail-${failOn}`);
      const nonce = await hre.ethers.provider.getTransactionCount(address);
      const firstChild = hre.ethers.getCreateAddress({ from: address, nonce });
      await archive.setFailOnDeployment(failOn);
      await expect(
        caller.store(address, key, 1, `0x${"ab".repeat(16_385)}`),
      ).to.be.revertedWithCustomError(archive, "DeploymentFailed");
      expect((await archive.metadataRef(key, 1)).pointer).to.equal(hre.ethers.ZeroAddress);
      expect(await archive.deploymentCount()).to.equal(0n);
      expect(await hre.ethers.provider.getCode(firstChild)).to.equal("0x");
      expect(await hre.ethers.provider.getTransactionCount(address)).to.equal(nonce);
    }
  });

  it("rolls back a transaction that exhausts gas after creating its first segment", async () => {
    const { caller, archive } = await fixture();
    const address = await archive.getAddress();
    const key = hre.ethers.id("low-gas");
    const nonce = await hre.ethers.provider.getTransactionCount(address);
    const firstChild = hre.ethers.getCreateAddress({ from: address, nonce });
    // A single segment costs approximately 3.6M; two segments cannot fit in 5M.
    await expect(
      caller.store(address, key, 1, `0x${"ab".repeat(32_768)}`, { gasLimit: 5_000_000 }),
    ).to.revert(hre.ethers);
    expect((await archive.metadataRef(key, 1)).pointer).to.equal(hre.ethers.ZeroAddress);
    expect(await hre.ethers.provider.getCode(firstChild)).to.equal("0x");
    expect(await hre.ethers.provider.getTransactionCount(address)).to.equal(nonce);
  });

  for (const count of [1_024, 1_025]) {
    it(`packs ${count} manifest entries into exact 1,024-address pages`, async () => {
      const { archive } = await fixture("ArchiveManifestHarness");
      const segments = Array.from({ length: count }, (_, i) =>
        hre.ethers.getAddress(hre.ethers.toBeHex(i + 1, 20)),
      );
      const payloadHash = hre.ethers.id(`manifest-${count}`);
      const payloadLength = BigInt(count) * 16_384n;
      await archive.storeManifest(segments, payloadHash, payloadLength);
      let pointer = await archive.manifest();
      const pageCount = Math.ceil(count / 1_024);
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        const runtime = hre.ethers.getBytes(await hre.ethers.provider.getCode(pointer));
        const view = new DataView(runtime.buffer, runtime.byteOffset, runtime.byteLength);
        const entries = Math.min(count - pageIndex * 1_024, 1_024);
        expect(runtime.length).to.equal(86 + 20 * entries);
        expect(hre.ethers.hexlify(runtime.subarray(0, 6))).to.equal("0x004446425001");
        expect(view.getUint32(6)).to.equal(pageIndex);
        expect(view.getUint32(10)).to.equal(pageCount);
        expect(view.getUint32(14)).to.equal(pageIndex * 1_024);
        expect(view.getUint32(18)).to.equal(entries);
        expect(view.getBigUint64(42)).to.equal(payloadLength);
        expect(view.getUint32(50)).to.equal(count);
        expect(hre.ethers.hexlify(runtime.subarray(54, 86))).to.equal(payloadHash);
        for (let index = 0; index < entries; index++) {
          expect(
            hre.ethers.getAddress(
              hre.ethers.hexlify(runtime.subarray(86 + index * 20, 106 + index * 20)),
            ),
          ).to.equal(segments[pageIndex * 1_024 + index]);
        }
        pointer = hre.ethers.getAddress(hre.ethers.hexlify(runtime.subarray(22, 42)));
        expect(pointer === hre.ethers.ZeroAddress).to.equal(pageIndex === pageCount - 1);
      }
    });
  }
});
