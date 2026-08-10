import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "chai";

import {
  readRecoveryTransactionsFile,
  readReleaseApprovalFile,
} from "../scripts/lib/mainnetCommandInput.mjs";
import { createCanonicalTemporaryDirectory } from "./helpers/temporaryDirectory.mjs";

const DIGEST = `0x${"ab".repeat(32)}`;
const HASH_A = `0x${"12".repeat(32)}`;
const HASH_B = `0x${"CD".repeat(32)}`;

const expectRejected = async (operation, messagePattern) => {
  let error;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }
  expect(error, "expected operation to reject").to.be.an("error");
  expect(error.message).to.match(messagePattern);
};

describe("Mainnet command JSON inputs", function () {
  let root;

  beforeEach(async function () {
    root = await createCanonicalTemporaryDirectory("deepfamily-mainnet-command-input-");
  });

  afterEach(async function () {
    await fs.rm(root, { recursive: true, force: true });
  });

  const writeJson = async (relativePath, value) => {
    const destination = path.join(root, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, JSON.stringify(value));
    return destination;
  };

  it("loads, normalizes and deeply freezes an exact approval document", async function () {
    const filePath = await writeJson("private/approval.json", {
      planDigest: DIGEST.toUpperCase().replace("0X", "0x"),
      signatures: ["first-owner-signature", "second-owner-signature"],
    });

    const approval = await readReleaseApprovalFile({ filePath, root });

    expect(approval).to.deep.equal({
      planDigest: DIGEST,
      signatures: ["first-owner-signature", "second-owner-signature"],
    });
    expect(Object.isFrozen(approval)).to.equal(true);
    expect(Object.isFrozen(approval.signatures)).to.equal(true);
    expect(() => approval.signatures.push("third-owner-signature")).to.throw(TypeError);
  });

  it("rejects malformed approval shapes before deeper signature validation", async function () {
    for (const [name, document, message] of [
      ["array", [], /JSON object/iu],
      ["missing-signatures", { planDigest: DIGEST }, /contain exactly/iu],
      [
        "extra-property",
        { planDigest: DIGEST, signatures: [], note: "not allowed" },
        /contain exactly/iu,
      ],
      ["short-digest", { planDigest: "0x12", signatures: [] }, /32-byte/iu],
      ["non-array", { planDigest: DIGEST, signatures: "0xsig" }, /array of strings/iu],
      ["non-string", { planDigest: DIGEST, signatures: [123] }, /array of strings/iu],
    ]) {
      const filePath = await writeJson(`${name}.json`, document);
      await expectRejected(() => readReleaseApprovalFile({ filePath, root }), message);
    }
  });

  it("loads a canonical frozen recovery mapping while leaving label policy to the safety parser", async function () {
    const filePath = await writeJson("recovery.json", {
      z_future_label_check: HASH_B,
      governanceTimelock: HASH_A,
    });

    const recovery = await readRecoveryTransactionsFile({ filePath, root });

    expect(Object.keys(recovery)).to.deep.equal(["governanceTimelock", "z_future_label_check"]);
    expect(recovery).to.deep.equal({
      governanceTimelock: HASH_A,
      z_future_label_check: HASH_B.toLowerCase(),
    });
    expect(Object.isFrozen(recovery)).to.equal(true);
  });

  it("rejects malformed recovery mappings but does not duplicate the label allowlist", async function () {
    for (const [name, document, message] of [
      ["recovery-array", [], /JSON object/iu],
      ["recovery-empty", {}, /at least one/iu],
      ["recovery-short-hash", { anyLabel: "0x12" }, /32-byte/iu],
      ["recovery-non-string", { anyLabel: 12 }, /32-byte/iu],
    ]) {
      const filePath = await writeJson(`${name}.json`, document);
      await expectRejected(() => readRecoveryTransactionsFile({ filePath, root }), message);
    }
  });

  it("requires valid JSON in a regular file no larger than 64 KiB", async function () {
    const malformedPath = path.join(root, "malformed.json");
    await fs.writeFile(malformedPath, "{");
    await expectRejected(
      () => readReleaseApprovalFile({ filePath: malformedPath, root }),
      /valid JSON/iu,
    );

    const directoryPath = path.join(root, "directory.json");
    await fs.mkdir(directoryPath);
    await expectRejected(
      () => readReleaseApprovalFile({ filePath: directoryPath, root }),
      /regular file/iu,
    );

    const oversizedPath = path.join(root, "oversized.json");
    await fs.writeFile(oversizedPath, " ".repeat(64 * 1024 + 1));
    await expectRejected(
      () => readReleaseApprovalFile({ filePath: oversizedPath, root }),
      /64 KiB/iu,
    );
  });

  it("rejects paths outside the repository and every symlink path component", async function () {
    const approvalPath = await writeJson("real/approval.json", {
      planDigest: DIGEST,
      signatures: [],
    });
    const outsideRoot = await createCanonicalTemporaryDirectory("deepfamily-mainnet-outside-");
    try {
      const outsidePath = path.join(outsideRoot, "approval.json");
      await fs.writeFile(outsidePath, await fs.readFile(approvalPath));
      await expectRejected(
        () => readReleaseApprovalFile({ filePath: outsidePath, root }),
        /inside the repository root/iu,
      );

      const linkedFile = path.join(root, "linked-file.json");
      await fs.symlink(approvalPath, linkedFile);
      await expectRejected(
        () => readReleaseApprovalFile({ filePath: linkedFile, root }),
        /symbolic link/iu,
      );

      const linkedDirectory = path.join(root, "linked-directory");
      await fs.symlink(path.dirname(approvalPath), linkedDirectory, "dir");
      await expectRejected(
        () =>
          readReleaseApprovalFile({
            filePath: path.join(linkedDirectory, "approval.json"),
            root,
          }),
        /symbolic link/iu,
      );
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("accepts repository-relative paths and rejects missing or whitespace-padded paths", async function () {
    await writeJson("approval.json", { planDigest: DIGEST, signatures: [] });
    expect(await readReleaseApprovalFile({ filePath: "approval.json", root })).to.include({
      planDigest: DIGEST,
    });

    for (const filePath of [undefined, "", " approval.json ", "../approval.json"]) {
      await expectRejected(() => readReleaseApprovalFile({ filePath, root }), /path|repository/iu);
    }
  });
});
