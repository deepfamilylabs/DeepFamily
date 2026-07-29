import { expect } from "chai";
import fs from "node:fs/promises";
import path from "node:path";

import { createPrivateTemporaryDirectory } from "../scripts/lib/privateTemporaryDirectory.mjs";
import { createCanonicalTemporaryDirectory } from "./helpers/temporaryDirectory.mjs";

describe("private temporary directories", function () {
  let baseDirectory;

  beforeEach(async function () {
    baseDirectory = await createCanonicalTemporaryDirectory("deepfamily-private-temp-base-");
  });

  afterEach(async function () {
    await fs.rm(baseDirectory, { recursive: true, force: true });
  });

  it("creates an owned POSIX directory with mode 0700", async function () {
    if (process.platform === "win32") this.skip();
    const directory = await createPrivateTemporaryDirectory({
      prefix: "fixture-",
      baseDirectory,
      platform: "linux",
    });
    const state = await fs.lstat(directory);

    expect(path.dirname(directory)).to.equal(baseDirectory);
    expect(state.isDirectory()).to.equal(true);
    expect(state.isSymbolicLink()).to.equal(false);
    expect(state.mode & 0o777).to.equal(0o700);
    if (typeof process.getuid === "function") {
      expect(state.uid).to.equal(process.getuid());
    }
  });

  it("applies and verifies the real Windows ACL on Windows", async function () {
    if (process.platform !== "win32") this.skip();
    const directory = await createPrivateTemporaryDirectory({
      prefix: "fixture-",
      baseDirectory,
    });

    await fs.writeFile(path.join(directory, "private.txt"), "private\n");
    expect((await fs.readFile(path.join(directory, "private.txt"), "utf8")).trim()).to.equal(
      "private",
    );
  });

  it("requires Windows ACL hardening before returning the directory", async function () {
    let hardenedDirectory;
    const directory = await createPrivateTemporaryDirectory({
      prefix: "fixture-",
      baseDirectory,
      platform: "win32",
      windowsAclRunner: async ({ directory: target }) => {
        expect(await fs.readdir(target)).to.deep.equal([]);
        hardenedDirectory = target;
      },
    });

    expect(directory).to.equal(hardenedDirectory);
  });

  it("removes the directory when Windows ACL hardening fails", async function () {
    let attemptedDirectory;
    let error;
    try {
      await createPrivateTemporaryDirectory({
        prefix: "fixture-",
        baseDirectory,
        platform: "win32",
        windowsAclRunner: ({ directory }) => {
          attemptedDirectory = directory;
          throw new Error("fixture ACL failure");
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error?.message).to.equal("fixture ACL failure");
    let missingError;
    try {
      await fs.lstat(attemptedDirectory);
    } catch (caught) {
      missingError = caught;
    }
    expect(missingError?.code).to.equal("ENOENT");
  });
});
