import { expect } from "chai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import hre from "hardhat";
import { ensureIntegratedSystem } from "../hardhat/integratedDeployment.mjs";
import personCommitmentProof from "../lib/personCommitmentProof.js";

const { computePersonHashFromInput } = personCommitmentProof;

describe("Hardhat Tasks Integration", function () {
  this.timeout(240_000);

  let connection;
  let deepFamily;
  let deepFamilyReader;
  let signer;
  let signerAddress;
  let originalConnect;

  const personArgs = {
    fullname: "Task Runner Example",
    passphrase: "",
    birthbc: "false",
    birthyear: "1990",
    birthmonth: "5",
    birthday: "15",
    gender: "255",
    fathername: "",
    mothername: "",
    fatherversion: "0",
    motherversion: "0",
    tag: "task-v1",
    ipfs: "ipfs://task-runner-person",
  };

  const personHash = computePersonHashFromInput({
    fullName: personArgs.fullname,
    derivedSecretField: 0n,
    isBirthBC: false,
    birthYear: 1990,
    birthMonth: 5,
    birthDay: 15,
    gender: 255,
  }).personHash;

  before(async function () {
    connection = await hre.network.connect();
    originalConnect = hre.network.connect.bind(hre.network);
    hre.network.connect = async () => connection;

    ({ deepFamily, deepFamilyReader } = await ensureIntegratedSystem(connection));
    [signer] = await connection.ethers.getSigners();
    signerAddress = await signer.getAddress();
  });

  after(async function () {
    hre.network.connect = originalConnect;
    await connection?.close?.();
  });

  it("runs networks tasks without error", async function () {
    const networks = await hre.tasks.getTask("networks:list").run({});
    expect(networks.some((network) => network.name === "localhost")).to.equal(true);

    const originalBrokenRpc = hre.config.networks.__broken_rpc_test;
    hre.config.networks.__broken_rpc_test = {
      type: "http",
      chainId: 31337,
    };

    try {
      const summary = await hre.tasks.getTask("networks:check").run({
        delay: "0",
        only: "__broken_rpc_test",
        exclude: "",
        includeMissing: false,
      });

      expect(summary.totalChecked).to.equal(1);
      expect(summary.success).to.equal(0);
      expect(summary.failed).to.equal(1);
      expect(summary.results.__broken_rpc_test).to.equal(false);
    } finally {
      if (originalBrokenRpc === undefined) {
        delete hre.config.networks.__broken_rpc_test;
      } else {
        hre.config.networks.__broken_rpc_test = originalBrokenRpc;
      }
    }
  });

  it("runs add-person, endorse, mint, and story tasks end-to-end", async function () {
    await hre.tasks.getTask("add-person").run(personArgs);

    const [, totalVersions] = await deepFamilyReader.listPersonVersions(personHash, 0, 10);
    expect(Number(totalVersions)).to.equal(1);

    await hre.tasks.getTask("endorse").run({
      person: personHash,
      vindex: "1",
      autoapprove: "true",
      approvebuffer: "1",
    });

    expect(Number(await deepFamily.endorsedVersionIndex(personHash, signerAddress))).to.equal(1);

    await hre.tasks.getTask("mint-nft").run({
      person: personHash,
      vindex: "1",
      tokenuri: "ipfs://task-runner-nft",
      fullname: "Task Runner Example",
      passphrase: "",
      birthyear: "1990",
      birthbc: "false",
      birthmonth: "5",
      birthday: "15",
      gender: "255",
      birthplace: "Shanghai",
      deathbc: "false",
      deathyear: "0",
      deathmonth: "0",
      deathday: "0",
      deathplace: "",
      story: "Task integration flow",
    });

    const tokenId = await deepFamily.versionToTokenId(personHash, 1);
    expect(tokenId).to.equal(1n);
    expect(await deepFamily.ownerOf(tokenId)).to.equal(signerAddress);

    await hre.tasks.getTask("add-story-chunk").run({
      tokenid: tokenId.toString(),
      chunkindex: "0",
      content: "Task-generated story chunk",
      type: "1",
      attachment: "",
      exphash: "0x" + "0".repeat(64),
    });

    const taskResult = await hre.tasks.getTask("list-story-chunks").run({
      tokenid: tokenId.toString(),
      offset: "0",
      limit: "10",
    });

    const [chunks, totalChunks, hasMore, nextOffset] = taskResult;

    expect(Number(totalChunks)).to.equal(1);
    expect(hasMore).to.equal(false);
    expect(Number(nextOffset)).to.equal(1);
    expect(chunks).to.have.lengthOf(1);
    expect(chunks[0].content).to.equal("Task-generated story chunk");

    await hre.tasks.getTask("seal-story").run({
      tokenid: tokenId.toString(),
    });

    const metadata = await deepFamilyReader.getStoryMetadata(tokenId);
    expect(metadata.isSealed).to.equal(true);
  });

  it("runs generate-disclosure-binding-proof in skip mode", async function () {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-disclosure-task-"));

    try {
      const result = await hre.tasks.getTask("generate-disclosure-binding-proof").run({
        fullname: "  Task   User  ",
        derivedsecretfield: "0",
        birthbc: "false",
        birthyear: "1990",
        birthmonth: "5",
        birthday: "15",
        gender: "1",
        schemaversion: "1",
        cryptosuiteversion: "1",
        hashalgoid: "1",
        output: outputDir,
        wasm: "",
        zkey: "",
        minter: "",
        skipProof: true,
      });

      const inputPath = path.join(outputDir, "disclosure_binding_input.json");
      expect(fs.existsSync(inputPath)).to.equal(true);
      expect(result.canonicalFullName).to.equal("Task User");
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
