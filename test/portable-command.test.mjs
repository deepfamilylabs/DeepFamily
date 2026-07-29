import { expect } from "chai";
import fs from "node:fs/promises";
import path from "node:path";

import {
  assertReleaseRuntimeCompatibility,
  normalizePortableCommand,
  sanitizeReleaseEnvironment,
} from "../scripts/lib/portableCommand.mjs";
import { createCanonicalTemporaryDirectory } from "./helpers/temporaryDirectory.mjs";

describe("portable child-process commands", function () {
  let root;

  beforeEach(async function () {
    root = await createCanonicalTemporaryDirectory("deepfamily-portable-command-");
  });

  afterEach(async function () {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("keeps direct executables unchanged outside Windows", function () {
    expect(
      normalizePortableCommand({
        executable: "npm",
        args: ["run", "check"],
        platform: "darwin",
      }),
    ).to.deep.equal({ executable: "npm", args: ["run", "check"] });
  });

  it("removes release process-injection variables case-insensitively", function () {
    const source = {
      PATH: "/trusted/bin",
      RELEASE_VALUE: "preserved",
      npm_execpath: "/trusted/npm-cli.js",
      NODE_OPTIONS: "--require=/untrusted/node-hook.cjs",
      node_path: "/untrusted/node-modules",
      LD_PRELOAD: "/untrusted/native-hook.so",
      ld_library_path: "/untrusted/native-libraries",
      DYLD_INSERT_LIBRARIES: "/untrusted/native-hook.dylib",
      dyld_library_path: "/untrusted/native-libraries",
      NPM_CONFIG_SCRIPT_SHELL: "/untrusted/shell",
      npm_config_node_options: "--require=/untrusted/npm-hook.cjs",
      GIT_CONFIG_COUNT: "1",
      git_config_key_0: "core.fsmonitor",
      DOTENV_CONFIG_PATH: "/untrusted/.env",
    };

    const sanitized = sanitizeReleaseEnvironment(source);

    expect(sanitized).to.deep.equal({
      PATH: "/trusted/bin",
      RELEASE_VALUE: "preserved",
      npm_execpath: "/trusted/npm-cli.js",
    });
    expect(Object.isFrozen(sanitized)).to.equal(true);
    expect(source).to.have.property("NODE_OPTIONS");
  });

  it("rejects invalid release environment containers", function () {
    for (const value of [null, [], "PATH=/trusted/bin"]) {
      expect(() => sanitizeReleaseEnvironment(value)).to.throw(
        "release environment must be an object",
      );
    }
  });

  it("supports Windows ARM64 hosts through an x64 Node execution runtime", function () {
    expect(() =>
      assertReleaseRuntimeCompatibility({
        platform: "win32",
        arch: "x64",
        operation: "Fixture release",
      }),
    ).not.to.throw();
    expect(() =>
      assertReleaseRuntimeCompatibility({
        platform: "win32",
        arch: "arm64",
        operation: "Fixture release",
      }),
    ).to.throw("requires the x64 build of Node.js");
  });

  it("runs the real npm JavaScript CLI through Node on Windows", async function () {
    const npmCli = path.join(root, "npm-cli.js");
    await fs.writeFile(npmCli, "fixture\n");

    expect(
      normalizePortableCommand({
        executable: "npm",
        args: ["run", "check"],
        platform: "win32",
        env: { npm_execpath: npmCli },
      }),
    ).to.deep.equal({
      executable: process.execPath,
      args: [npmCli, "run", "check"],
    });
  });

  it("reads Windows npm_execpath case-insensitively and rejects ambiguous entries", async function () {
    const npmCli = path.join(root, "npm-cli.js");
    await fs.writeFile(npmCli, "fixture\n");

    expect(
      normalizePortableCommand({
        executable: "npm",
        args: ["run", "check"],
        platform: "win32",
        env: { NPM_EXECPATH: npmCli },
      }),
    ).to.deep.equal({
      executable: process.execPath,
      args: [npmCli, "run", "check"],
    });
    expect(() =>
      normalizePortableCommand({
        executable: "npm",
        args: ["run", "check"],
        platform: "win32",
        env: { npm_execpath: npmCli, NPM_EXECPATH: npmCli },
      }),
    ).to.throw("duplicate npm_execpath entries");
  });

  it("rejects missing or unexpected Windows npm launchers", async function () {
    expect(() =>
      normalizePortableCommand({
        executable: "npm",
        args: ["run", "check"],
        platform: "win32",
        env: {},
      }),
    ).to.throw("invoke this command through `npm run`");

    const unexpected = path.join(root, "unexpected.js");
    await fs.writeFile(unexpected, "fixture\n");
    expect(() =>
      normalizePortableCommand({
        executable: "npm",
        args: ["run", "check"],
        platform: "win32",
        env: { npm_execpath: unexpected },
      }),
    ).to.throw("must resolve to the npm CLI");
  });
});
