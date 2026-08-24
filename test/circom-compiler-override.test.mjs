import { expect } from "chai";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  CIRCOM_OVERRIDE_ENV,
  buildCircomOverrideEnvironment,
  inspectCircomCompilerOverride,
  isPathStrictlyInside,
  isRealPathStrictlyInside,
  withoutCircomOverrideEnvironment,
} from "../scripts/lib/circomCompilerOverride.mjs";
import { CIRCOM_VERSION } from "../scripts/lib/circomToolchain.mjs";
import { runZkBuild } from "../scripts/zk-build.mjs";
import { createCanonicalTemporaryDirectory } from "./helpers/temporaryDirectory.mjs";

describe("release Circom compiler override", function () {
  let root;

  beforeEach(async function () {
    root = await createCanonicalTemporaryDirectory("deepfamily-circom-override-");
  });

  afterEach(async function () {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("accepts a hash-bound private source compiler for the exact native target", async function () {
    const compilerPath = path.join(root, "circom");
    const bytes = Buffer.from("fresh private compiler\n");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await fs.writeFile(compilerPath, bytes);
    const env = buildCircomOverrideEnvironment({
      env: { FIXTURE: "preserved" },
      compiler: {
        path: compilerPath,
        target: "darwin-arm64",
        sha256,
      },
    });

    const result = inspectCircomCompilerOverride({
      env,
      platform: "darwin",
      arch: "arm64",
      versionRunner: () => `circom compiler ${CIRCOM_VERSION}`,
    });

    expect(env.FIXTURE).to.equal("preserved");
    expect(result).to.deep.equal({
      path: compilerPath,
      target: "darwin-arm64",
      strategy: "pinned-source",
      sha256,
      version: CIRCOM_VERSION,
      libcEvidence: null,
    });
  });

  it("rejects incomplete, cross-target, or byte-tampered override evidence", async function () {
    const compilerPath = path.join(root, "circom");
    await fs.writeFile(compilerPath, "fresh private compiler\n");
    const base = {
      [CIRCOM_OVERRIDE_ENV.path]: compilerPath,
      [CIRCOM_OVERRIDE_ENV.sha256]: createHash("sha256")
        .update("fresh private compiler\n")
        .digest("hex"),
      [CIRCOM_OVERRIDE_ENV.target]: "darwin-arm64",
    };
    const inspect = (env) =>
      inspectCircomCompilerOverride({
        env,
        platform: "darwin",
        arch: "arm64",
        versionRunner: () => `circom compiler ${CIRCOM_VERSION}`,
      });

    expect(() => inspect({ [CIRCOM_OVERRIDE_ENV.path]: compilerPath })).to.throw(
      "override environment is incomplete",
    );
    expect(() => inspect({ ...base, [CIRCOM_OVERRIDE_ENV.target]: "linux-x64" })).to.throw(
      "does not match the native source target",
    );
    await fs.writeFile(compilerPath, "tampered private compiler\n");
    expect(() => inspect(base)).to.throw("override SHA-256 mismatch");
  });

  it("normalizes override variable casing regardless of how the parent spelled it", async function () {
    const compilerPath = path.join(root, "circom");
    const bytes = Buffer.from("fresh private compiler\n");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await fs.writeFile(compilerPath, bytes);
    const mixedCase = {
      deepfamily_zk_compiler_path: compilerPath,
      DeepFamily_Zk_Compiler_Sha256: sha256,
      DEEPFAMILY_ZK_COMPILER_TARGET: "darwin-arm64",
    };

    expect(withoutCircomOverrideEnvironment(mixedCase)).to.deep.equal({});

    const normalized = buildCircomOverrideEnvironment({
      env: mixedCase,
      compiler: { path: compilerPath, target: "darwin-arm64", sha256 },
    });
    expect(Object.keys(normalized).filter((name) => /compiler_/iu.test(name))).to.have.length(3);
    expect(normalized[CIRCOM_OVERRIDE_ENV.path]).to.equal(compilerPath);

    const result = inspectCircomCompilerOverride({
      env: normalized,
      platform: "darwin",
      arch: "arm64",
      versionRunner: () => `circom compiler ${CIRCOM_VERSION}`,
    });
    expect(result.target).to.equal("darwin-arm64");
  });

  it("rejects an override on Windows because no Windows host builds Circom from source", async function () {
    const compilerPath = path.join(root, "circom.exe");
    const bytes = Buffer.from("fresh Windows compiler\n");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await fs.writeFile(compilerPath, bytes);
    const inspect = (arch, target) =>
      inspectCircomCompilerOverride({
        env: {
          [CIRCOM_OVERRIDE_ENV.path]: compilerPath,
          [CIRCOM_OVERRIDE_ENV.sha256]: sha256,
          [CIRCOM_OVERRIDE_ENV.target]: target,
        },
        platform: "win32",
        arch,
        versionRunner: () => `circom compiler ${CIRCOM_VERSION}`,
      });

    expect(() => inspect("x64", "win32-x64")).to.throw("does not match the native source target");
    expect(() => inspect("arm64", "win32-arm64")).to.throw("Unsupported Circom host win32/arm64");
  });

  it("compares Windows temporary paths case-insensitively across drive and UNC namespaces", function () {
    expect(
      isPathStrictlyInside({
        parent: String.raw`C:\Users\Runner\AppData\Local\Temp`,
        candidate: String.raw`\\?\C:\USERS\RUNNER\APPDATA\LOCAL\TEMP\private\circom`,
        hostPlatform: "win32",
      }),
    ).to.equal(true);
    expect(
      isPathStrictlyInside({
        parent: String.raw`\\server\share\Temp`,
        candidate: String.raw`\\?\UNC\SERVER\SHARE\TEMP\private\circom`,
        hostPlatform: "win32",
      }),
    ).to.equal(true);
    for (const candidate of [
      String.raw`C:\Users\Runner\AppData\Local\Temp`,
      String.raw`C:\Users\Runner\AppData\Local\Temp-escape\circom`,
      String.raw`D:\Users\Runner\AppData\Local\Temp\circom`,
    ]) {
      expect(
        isPathStrictlyInside({
          parent: String.raw`C:\Users\Runner\AppData\Local\Temp`,
          candidate,
          hostPlatform: "win32",
        }),
      ).to.equal(false);
    }
  });

  it("canonicalizes Windows short-name aliases before applying host path semantics", function () {
    const shortTemporaryDirectory = String.raw`C:\Users\RUNNER~1\AppData\Local\Temp`;
    const compilerPath = String.raw`C:\Users\runneradmin\AppData\Local\Temp\private\circom`;
    const canonicalPaths = new Map([
      [shortTemporaryDirectory, String.raw`\\?\C:\Users\RunnerAdmin\AppData\Local\Temp`],
      [compilerPath, String.raw`c:\USERS\RUNNERADMIN\APPDATA\LOCAL\TEMP\private\circom`],
    ]);
    const inspectedPaths = [];

    expect(
      isRealPathStrictlyInside({
        parent: shortTemporaryDirectory,
        candidate: compilerPath,
        hostPlatform: "win32",
        realpathSync: (value) => {
          inspectedPaths.push(value);
          return canonicalPaths.get(value);
        },
      }),
    ).to.equal(true);
    expect(inspectedPaths).to.deep.equal([shortTemporaryDirectory, compilerPath]);
  });

  it("proves Windows short-name containment by directory identity when spellings stay distinct", function () {
    const shortTemporaryDirectory = String.raw`C:\Users\RUNNER~1\AppData\Local\Temp`;
    const longTemporaryDirectory = String.raw`C:\Users\runneradmin\AppData\Local\Temp`;
    const compilerPath = path.win32.join(longTemporaryDirectory, "private", "circom");
    const inspectedDirectories = [];
    const directoryState = (value) => ({
      dev: 11n,
      ino: value === shortTemporaryDirectory || value === longTemporaryDirectory ? 29n : 31n,
      isDirectory: () => true,
    });

    expect(
      isRealPathStrictlyInside({
        parent: shortTemporaryDirectory,
        candidate: compilerPath,
        hostPlatform: "win32",
        realpathSync: (value) => value,
        statSync: (value, options) => {
          expect(options).to.deep.equal({ bigint: true });
          inspectedDirectories.push(value);
          return directoryState(value);
        },
      }),
    ).to.equal(true);
    expect(inspectedDirectories).to.include(longTemporaryDirectory);

    expect(
      isRealPathStrictlyInside({
        parent: shortTemporaryDirectory,
        candidate: String.raw`D:\outside\circom`,
        hostPlatform: "win32",
        realpathSync: (value) => value,
        statSync: (value) => directoryState(value),
      }),
    ).to.equal(false);
    expect(
      isRealPathStrictlyInside({
        parent: shortTemporaryDirectory,
        candidate: compilerPath,
        hostPlatform: "win32",
        realpathSync: (value) => value,
        statSync: () => ({ dev: 11n, ino: 0n, isDirectory: () => true }),
      }),
    ).to.equal(false);
  });

  it("uses explicit POSIX semantics when path tests run on another host", function () {
    expect(
      isPathStrictlyInside({
        parent: "/tmp/deepfamily",
        candidate: "/tmp/deepfamily/private/circom",
        hostPlatform: "linux",
      }),
    ).to.equal(true);
    expect(
      isPathStrictlyInside({
        parent: "/tmp/deepfamily",
        candidate: "/tmp/deepfamily-escape/circom",
        hostPlatform: "linux",
      }),
    ).to.equal(false);
  });

  it("rejects a symlink, an outside-temp path, and a wrong compiler version", async function () {
    const compilerPath = path.join(root, "circom");
    const symlinkPath = path.join(root, "circom-link");
    const realDirectory = path.join(root, "real-compiler-directory");
    const directorySymlink = path.join(root, "compiler-directory-link");
    const bytes = Buffer.from("fresh private compiler\n");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await fs.writeFile(compilerPath, bytes);
    await fs.symlink(compilerPath, symlinkPath);
    await fs.mkdir(realDirectory);
    await fs.writeFile(path.join(realDirectory, "circom"), bytes);
    await fs.symlink(
      realDirectory,
      directorySymlink,
      process.platform === "win32" ? "junction" : "dir",
    );
    const environmentFor = (filePath, digest = sha256) =>
      buildCircomOverrideEnvironment({
        compiler: { path: filePath, target: "darwin-arm64", sha256: digest },
      });
    const inspect = (env, version = `circom compiler ${CIRCOM_VERSION}`) =>
      inspectCircomCompilerOverride({
        env,
        platform: "darwin",
        arch: "arm64",
        versionRunner: () => version,
      });

    expect(() => inspect(environmentFor(symlinkPath))).to.throw(/non-symlink/u);
    expect(() => inspect(environmentFor(path.join(directorySymlink, "circom")))).to.throw(
      /non-symlink/u,
    );
    const outsidePath = path.resolve("scripts/zk-build.mjs");
    const outsideSha256 = createHash("sha256")
      .update(await fs.readFile(outsidePath))
      .digest("hex");
    expect(() => inspect(environmentFor(outsidePath, outsideSha256))).to.throw(
      "must be inside the OS temporary directory",
    );
    expect(() => inspect(environmentFor(compilerPath), "circom compiler 2.1.5")).to.throw(
      "override version mismatch",
    );
  });

  it("makes zk-build use the private override without inspecting the cached compiler", async function () {
    const compilerPath = path.join(root, "circom");
    const bytes = Buffer.from("fresh private compiler\n");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await fs.writeFile(compilerPath, bytes);
    const env = buildCircomOverrideEnvironment({
      compiler: { path: compilerPath, target: "darwin-arm64", sha256 },
    });
    let cachedInspected = false;
    const events = [];

    const commands = await runZkBuild({
      root: path.resolve("."),
      circuit: "person",
      platform: "darwin",
      arch: "arm64",
      env,
      overrideInspector: (options) =>
        inspectCircomCompilerOverride({
          ...options,
          versionRunner: () => `circom compiler ${CIRCOM_VERSION}`,
        }),
      compilerInspector: async () => {
        cachedInspected = true;
        throw new Error("cached compiler must not execute");
      },
      directoryCreator: (directory) => events.push(["mkdir", directory]),
      runner: (command) => events.push(["run", command.executable]),
    });

    expect(cachedInspected).to.equal(false);
    expect(commands[0].executable).to.equal(compilerPath);
    expect(events[1]).to.deep.equal(["run", compilerPath]);

    await fs.rm(compilerPath);
    expect(() =>
      inspectCircomCompilerOverride({
        env,
        platform: "darwin",
        arch: "arm64",
        versionRunner: () => `circom compiler ${CIRCOM_VERSION}`,
      }),
    ).to.throw();
  });
});
