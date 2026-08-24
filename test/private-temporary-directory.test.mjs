import { expect } from "chai";
import fs from "node:fs/promises";
import path from "node:path";

import {
  createPrivateTemporaryDirectory,
  hardenPrivateWindowsPath,
} from "../scripts/lib/privateTemporaryDirectory.mjs";
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

  it("uses direct .NET ACL APIs without PowerShell security-module autoloading", function () {
    for (const entryType of ["directory", "file"]) {
      let invocation;
      hardenPrivateWindowsPath({
        targetPath: path.resolve(baseDirectory, `private-${entryType}`),
        entryType,
        powershellRunner: (executable, args, options) => {
          invocation = { executable, args, options };
        },
      });

      expect(invocation.executable).to.equal("powershell.exe");
      expect(invocation.args.slice(0, 3)).to.deep.equal([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
      ]);
      const script = invocation.args[3];
      expect(script).to.include(
        entryType === "directory" ? "System.IO.DirectoryInfo" : "System.IO.FileInfo",
      );
      expect(script).to.include(
        entryType === "directory"
          ? "System.Security.AccessControl.DirectorySecurity"
          : "System.Security.AccessControl.FileSecurity",
      );
      expect(script).to.include("SetAccessRuleProtection($true, $false)");
      expect(script).to.include("AreAccessRulesProtected");
      expect(script).to.include("$rule.InheritanceFlags -ne $inheritance");
      expect(script).to.include("$rule.PropagationFlags -ne $propagation");
      expect(script).not.to.match(/(?:Get|Set)-Acl|Import-Module/iu);
      expect(invocation.options.stdio).to.deep.equal(["ignore", "pipe", "pipe"]);
      expect(invocation.options.env.DEEPFAMILY_PRIVATE_ACL_TARGET).to.equal(
        path.resolve(baseDirectory, `private-${entryType}`),
      );
      expect(invocation.options.windowsHide).to.equal(true);
    }
  });

  it("passes an adversarial Windows ACL path out-of-band instead of interpolating it", function () {
    const targetPath = path.resolve(baseDirectory, "private-' ; throw 'injected-$()' ");
    let invocation;

    hardenPrivateWindowsPath({
      targetPath,
      entryType: "directory",
      powershellRunner: (executable, args, options) => {
        invocation = { executable, args, options };
      },
    });

    expect(invocation.args[3]).not.to.include(targetPath);
    expect(invocation.options.env.DEEPFAMILY_PRIVATE_ACL_TARGET).to.equal(targetPath);
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
