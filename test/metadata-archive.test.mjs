import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";

describe("MetadataArchiveV1", function () {
  this.timeout(120_000);

  async function deployArchiveFixture() {
    const Caller = await hre.ethers.getContractFactory("MetadataArchiveCallerHarness");
    const caller = await Caller.deploy();
    await caller.waitForDeployment();

    const Archive = await hre.ethers.getContractFactory("MetadataArchiveV1");
    const archive = await Archive.deploy(await caller.getAddress());
    await archive.waitForDeployment();
    return { caller, archive };
  }

  it("rejects a zero or codeless DeepFamily binding", async () => {
    const Archive = await hre.ethers.getContractFactory("MetadataArchiveV1");
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

  it("stores an opaque payload as STOP-prefixed runtime and derives its ref", async () => {
    const { caller, archive } = await deployArchiveFixture();
    const personHash = hre.ethers.id("archive-person");
    const envelope = "0xdeadbeef";

    await expect(caller.store(await archive.getAddress(), personHash, 1, envelope)).to.emit(
      archive,
      "MetadataStored",
    );

    const metadata = await archive.metadataRef(personHash, 1);
    expect(metadata.payloadHash).to.equal(hre.ethers.keccak256(envelope));
    expect(metadata.payloadLength).to.equal(4n);
    expect(await hre.ethers.provider.getCode(metadata.pointer)).to.equal(
      `0x00${envelope.slice(2)}`,
    );
  });

  it("accepts exactly 1 and 16,384 bytes", async () => {
    for (const [versionIndex, envelope] of [
      [1, "0x01"],
      [2, `0x${"ab".repeat(16_384)}`],
    ]) {
      const { caller, archive } = await deployArchiveFixture();
      const personHash = hre.ethers.id(`boundary-${versionIndex}`);
      await caller.store(await archive.getAddress(), personHash, versionIndex, envelope);
      const metadata = await archive.metadataRef(personHash, versionIndex);
      expect(metadata.payloadLength).to.equal(BigInt((envelope.length - 2) / 2));
    }
  });

  it("rejects empty and 16,385-byte payloads", async () => {
    const { caller, archive } = await deployArchiveFixture();
    const archiveAddress = await archive.getAddress();

    await expect(
      caller.store(archiveAddress, hre.ethers.id("empty"), 1, "0x"),
    ).to.be.revertedWithCustomError(archive, "InvalidPayloadLength");
    await expect(
      caller.store(archiveAddress, hre.ethers.id("oversize"), 1, `0x${"ab".repeat(16_385)}`),
    ).to.be.revertedWithCustomError(archive, "InvalidPayloadLength");
  });

  it("rejects non-bound callers and duplicate keys", async () => {
    const { caller, archive } = await deployArchiveFixture();
    const archiveAddress = await archive.getAddress();
    const personHash = hre.ethers.id("duplicate");

    await expect(archive.store(personHash, 1, "0x01")).to.be.revertedWithCustomError(
      archive,
      "UnauthorizedCaller",
    );

    await caller.store(archiveAddress, personHash, 1, "0x01");
    await expect(caller.store(archiveAddress, personHash, 1, "0x02")).to.be.revertedWithCustomError(
      archive,
      "MetadataAlreadyStored",
    );
  });
});
