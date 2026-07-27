import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "chai";
import { ethers } from "ethers";

import {
  hashMainnetSafeInputs,
  publicSafeCreatorError,
} from "../scripts/lib/mainnetSafeEvidence.mjs";

const SAFE_INPUT_FILES = Object.freeze([
  "hardhat.config.mjs",
  "package.json",
  "package-lock.json",
  "scripts/espace-mainnet-safe-command.mjs",
  "scripts/espace-mainnet-safe.mjs",
  "scripts/ethereum-mainnet-safe-command.mjs",
  "scripts/ethereum-mainnet-safe.mjs",
  "scripts/evm-mainnet-safe.mjs",
  "scripts/lib/chainProfiles.mjs",
  "scripts/lib/mainnetCommandWrapper.mjs",
  "scripts/lib/mainnetSafeEvidence.mjs",
  "scripts/lib/mainnetSafeIntent.mjs",
  "scripts/lib/mainnetSafeSafety.mjs",
  "scripts/lib/mainnetReleaseState.mjs",
  "scripts/lib/releaseEvidence.mjs",
  "scripts/lib/exclusiveCommandLock.mjs",
  "scripts/lib/governanceSafety.mjs",
  "scripts/lib/safeGovernance.mjs",
]);

const writeInputFixture = async (root) => {
  for (const relativePath of SAFE_INPUT_FILES) {
    const absolutePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `fixture:${relativePath}\n`);
  }
};

describe("multi-chain Mainnet Safe creator evidence", function () {
  let temporaryDirectory;

  beforeEach(async function () {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-safe-evidence-"));
    await writeInputFixture(temporaryDirectory);
  });

  afterEach(async function () {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("hashes the complete critical input set deterministically in a fixed order", async function () {
    const first = await hashMainnetSafeInputs(ethers, temporaryDirectory);
    const second = await hashMainnetSafeInputs(ethers, temporaryDirectory);

    expect(Object.keys(first.files)).to.deep.equal(SAFE_INPUT_FILES);
    expect(first).to.deep.equal(second);
    expect(Object.isFrozen(first)).to.equal(true);
    expect(Object.isFrozen(first.files)).to.equal(true);
    for (const digest of Object.values(first.files)) {
      expect(ethers.isHexString(digest, 32)).to.equal(true);
    }

    const orderedEntries = SAFE_INPUT_FILES.map(
      (relativePath) => `${relativePath}:${first.files[relativePath]}`,
    );
    expect(first.digest).to.equal(
      ethers.keccak256(ethers.toUtf8Bytes(orderedEntries.join("\n"))).toLowerCase(),
    );
  });

  it("changes the aggregate and only the changed file digest when a critical input changes", async function () {
    const before = await hashMainnetSafeInputs(ethers, temporaryDirectory);
    const changedPath = "scripts/lib/safeGovernance.mjs";
    await fs.writeFile(path.join(temporaryDirectory, changedPath), "fixture:changed\n");
    const after = await hashMainnetSafeInputs(ethers, temporaryDirectory);

    expect(after.digest).not.to.equal(before.digest);
    expect(after.files[changedPath]).not.to.equal(before.files[changedPath]);
    for (const relativePath of SAFE_INPUT_FILES.filter((entry) => entry !== changedPath)) {
      expect(after.files[relativePath], relativePath).to.equal(before.files[relativePath]);
    }
  });

  it("redacts configured secrets and long calldata before truncating public errors", function () {
    const privateKey = `0x${"ab".repeat(32)}`;
    const rpcUrl = "https://operator:rpc-secret@example.invalid";
    const longCalldata = `0x${"cd".repeat(80)}`;
    const message =
      `deployment failed private=${privateKey} rpc=${rpcUrl} data=${longCalldata} ` +
      "diagnostic=".repeat(600);

    const redacted = publicSafeCreatorError(
      { shortMessage: message, message: "must not override shortMessage" },
      {
        PRIVATE_KEY: privateKey,
        CONFLUX_RPC_URL: rpcUrl,
      },
    );

    expect(redacted).to.include("[REDACTED_PRIVATE_KEY]");
    expect(redacted).to.include("[REDACTED_RPC_URL]");
    expect(redacted).to.include("[redacted-calldata]");
    expect(redacted).not.to.include(privateKey);
    expect(redacted).not.to.include(rpcUrl);
    expect(redacted).not.to.include(longCalldata);
    expect(redacted).not.to.include("must not override shortMessage");
    expect(redacted.length).to.be.at.most(4_000);
  });
});
