import { expect } from "chai";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { installPinnedCircom } from "../scripts/fetch-circom.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

describe("pinned Circom installer", function () {
  let root;
  const pinnedBytes = Buffer.from("hermetic pinned circom fixture");
  const expectedSha256 = sha256(pinnedBytes);
  const url = "https://fixtures.invalid/circom-linux-amd64";

  beforeEach(async function () {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-circom-fetch-"));
  });

  afterEach(async function () {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("installs only bytes matching the pinned release digest", async function () {
    let requestedUrl;
    const result = await installPinnedCircom({
      projectRoot: root,
      expectedSha256,
      url,
      download: async (requested) => {
        requestedUrl = requested;
        return pinnedBytes;
      },
    });
    const installed = path.join(root, "bin", "circom");
    expect(requestedUrl).to.equal(url);
    expect(result).to.deep.equal({ status: "installed", path: installed });
    expect(sha256(await fs.readFile(installed))).to.equal(expectedSha256);
    expect((await fs.stat(installed)).mode & 0o777).to.equal(0o755);
  });

  it("reuses an exact existing binary without downloading", async function () {
    const installed = path.join(root, "bin", "circom");
    await fs.mkdir(path.dirname(installed), { recursive: true });
    await fs.writeFile(installed, pinnedBytes);
    const result = await installPinnedCircom({
      projectRoot: root,
      expectedSha256,
      url,
      download: async () => {
        throw new Error("download must not run");
      },
    });
    expect(result.status).to.equal("already-installed");
  });

  it("rejects a bad download without installing it", async function () {
    let error;
    try {
      await installPinnedCircom({
        projectRoot: root,
        expectedSha256,
        url,
        download: async () => Buffer.from("tampered"),
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.include("Downloaded Circom SHA-256 mismatch");
    await expectFileMissing(path.join(root, "bin", "circom"));
  });

  it("refuses to overwrite an unexpected existing compiler", async function () {
    const installed = path.join(root, "bin", "circom");
    await fs.mkdir(path.dirname(installed), { recursive: true });
    await fs.writeFile(installed, "unexpected");
    let error;
    try {
      await installPinnedCircom({
        projectRoot: root,
        expectedSha256,
        url,
        download: async () => pinnedBytes,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.include("does not match the pinned SHA-256");
    expect(await fs.readFile(installed, "utf8")).to.equal("unexpected");
  });

  it("refuses to replace a symlink even when its target has the expected bytes", async function () {
    const binDirectory = path.join(root, "bin");
    const installed = path.join(binDirectory, "circom");
    const target = path.join(root, "symlink-target");
    await fs.mkdir(binDirectory, { recursive: true });
    await fs.writeFile(target, pinnedBytes);
    await fs.symlink(target, installed);

    let error;
    try {
      await installPinnedCircom({
        projectRoot: root,
        expectedSha256,
        url,
        download: async () => {
          throw new Error("download must not run");
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error?.message).to.include("regular non-symlink file");
    expect((await fs.lstat(installed)).isSymbolicLink()).to.equal(true);
    expect(await fs.readFile(target)).to.deep.equal(pinnedBytes);
  });
});

const expectFileMissing = async (filePath) => {
  try {
    await fs.access(filePath);
    throw new Error(`Expected file to be missing: ${filePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
};
