import { readStoryRecord } from "@deepfamily/protocol-core";
import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import { setupStubVerifiers, mintPerson } from "./helpers/testHelper.mjs";

describe("Story Tasks Integration", function () {
  this.timeout(60_000);

  beforeEach(async () => {
    await hre.networkHelpers.loadFixture(deployIntegratedFixture);
  });

  it("runs full lifecycle of story tasks", async () => {
    const { deepFamily, deepFamilyReader } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [signer] = await hre.ethers.getSigners();
    await setupStubVerifiers(hre.ethers, deepFamily);

    const FULLNAME = "Alice Example";

    const { personHash } = await mintPerson(hre.ethers, deepFamily, signer, null, FULLNAME, {
      birthYear: 1980,
      gender: 1,
    });

    const tokenCounter = await deepFamily.tokenCounter();
    expect(tokenCounter).to.equal(1n);

    await hre.run("add-story-chunk", {
      tokenid: "1",
      chunkindex: "0",
      content: "First chunk content",
    });

    await hre.run("add-story-chunk", {
      tokenid: "1",
      chunkindex: "1",
      content: "Second chunk content",
    });

    const meta = await deepFamilyReader.getStoryState(1n);
    expect(meta.totalRecords).to.equal(2n);
    expect(meta.isSealed).to.equal(false);

    const chunk0 = await readStoryRecord({
      recordRef: await deepFamilyReader.getStoryRecordRef(1n, 0),
      getCode: (a, b) => hre.ethers.provider.getCode(a, b),
    });
    expect(chunk0.decoded.content).to.equal("First chunk content");
    expect(chunk0.decoded.chunkType).to.equal(1);
    expect(chunk0.decoded.attachmentCID).to.equal("");
    const chunk1 = await readStoryRecord({
      recordRef: await deepFamilyReader.getStoryRecordRef(1n, 1),
      getCode: (a, b) => hre.ethers.provider.getCode(a, b),
    });
    expect(chunk1.decoded.content).to.equal("Second chunk content");
    expect(chunk1.decoded.chunkType).to.equal(1);
    expect(chunk1.decoded.attachmentCID).to.equal("");

    await hre.run("list-story-chunks", { tokenid: "1", offset: "0", limit: "10" });

    await hre.run("seal-story", { tokenid: "1" });

    const sealedMeta = await deepFamilyReader.getStoryState(1n);
    expect(sealedMeta.isSealed).to.equal(true);

    let failed = false;
    try {
      await hre.run("add-story-chunk", {
        tokenid: "1",
        chunkindex: "2",
        content: "Should fail after seal",
      });
    } catch (e) {
      failed = true;
      expect(String(e.message || e)).to.match(/sealed/i);
    }
    if (!failed) {
      throw new Error("Expected add-story-chunk after sealing to fail");
    }
  });
});
