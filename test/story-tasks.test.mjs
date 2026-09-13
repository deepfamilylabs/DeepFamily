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

    await hre.run("add-story-record", {
      tokenid: "1",
      recordindex: "0",
      title: "  迁居洛阳 😀 e\u0301  ",
      content: "First record content",
    });

    await hre.run("add-story-record", {
      tokenid: "1",
      recordindex: "1",
      content: "Second record content",
    });

    const meta = await deepFamilyReader.getStoryState(1n);
    expect(meta.totalRecords).to.equal(2n);
    expect(meta.isSealed).to.equal(false);

    const record0 = await readStoryRecord({
      recordRef: await deepFamilyReader.getStoryRecordRef(1n, 0),
      getCode: (a, b) => hre.ethers.provider.getCode(a, b),
    });
    expect(record0.decoded.title).to.equal("  迁居洛阳 😀 e\u0301  ");
    expect(record0.decoded.content).to.equal("First record content");
    expect(record0.decoded.recordType).to.equal(1);
    expect(record0.decoded.attachmentCID).to.equal("");
    const record1 = await readStoryRecord({
      recordRef: await deepFamilyReader.getStoryRecordRef(1n, 1),
      getCode: (a, b) => hre.ethers.provider.getCode(a, b),
    });
    expect(record1.decoded.title).to.equal("");
    expect(record1.decoded.content).to.equal("Second record content");
    expect(record1.decoded.recordType).to.equal(1);
    expect(record1.decoded.attachmentCID).to.equal("");

    await hre.run("list-story-records", { tokenid: "1", offset: "0", limit: "10" });

    await hre.run("seal-story", { tokenid: "1" });

    const sealedMeta = await deepFamilyReader.getStoryState(1n);
    expect(sealedMeta.isSealed).to.equal(true);

    let failed = false;
    try {
      await hre.run("add-story-record", {
        tokenid: "1",
        recordindex: "2",
        content: "Should fail after seal",
      });
    } catch (e) {
      failed = true;
      expect(String(e.message || e)).to.match(/sealed/i);
    }
    if (!failed) {
      throw new Error("Expected add-story-record after sealing to fail");
    }
  });
});
