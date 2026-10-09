import { expect } from "chai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureZkArtifacts } from "../scripts/ensure-zk-artifacts.mjs";

describe("integrated local ZK artifact preparation", function () {
  let root;
  beforeEach(function () {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-integrated-zk-"));
    fs.mkdirSync(path.join(root, "circuits"));
  });
  afterEach(function () {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("compiles all 8 circuits and reuses verified current keys", async function () {
    const calls = [];
    const artifacts = { status: "development", circuitCount: 10 };
    const result = await ensureZkArtifacts({
      root,
      build: async (options) => calls.push(["build", options.circuit]),
      check: async () => {
        calls.push(["check"]);
        return artifacts;
      },
      fetchAssets: async () => calls.push(["fetch"]),
      setup: async () => calls.push(["setup"]),
      log: () => {},
    });
    expect(calls).to.deep.equal([["build", "all"], ["check"]]);
    expect(result).to.deep.equal({ regenerated: false, artifacts });
  });

  it("downloads the pinned proving files before regenerating any key", async function () {
    const calls = [];
    let downloaded = false;
    const result = await ensureZkArtifacts({
      root,
      build: async () => calls.push("build"),
      check: async () => {
        calls.push("check");
        if (!downloaded) throw new Error("missing public zkey");
        return { status: "development", circuitCount: 10 };
      },
      fetchAssets: async () => {
        calls.push("fetch");
        downloaded = true;
      },
      setup: async () => calls.push("setup"),
      log: () => {},
    });
    expect(calls).to.deep.equal(["build", "check", "fetch", "check"]);
    expect(result.regenerated).to.equal(false);
  });

  it("regenerates the complete development set after a failed current-artifact check", async function () {
    fs.writeFileSync(
      path.join(root, "circuits/zk-artifacts-manifest.json"),
      JSON.stringify({ trustedSetup: { status: "development" } }),
    );
    const calls = [];
    let ready = false;
    const result = await ensureZkArtifacts({
      root,
      build: async (options) => calls.push(`build:${options.circuit}`),
      check: async () => {
        calls.push("check");
        if (!ready) throw new Error("missing shielded key");
        return { status: "development", circuitCount: 10 };
      },
      fetchAssets: async () => calls.push("fetch"),
      setup: async () => {
        calls.push("setup-all");
        ready = true;
      },
      log: () => {},
    });
    expect(calls).to.deep.equal(["build:all", "check", "fetch", "check", "setup-all", "check"]);
    expect(result.regenerated).to.equal(true);
  });

  it("refuses to overwrite formal keys when an artifact check fails", async function () {
    fs.writeFileSync(path.join(root, "circuits/shielded-production-manifest.json"), "{}");
    let setupCalled = false;
    try {
      await ensureZkArtifacts({
        root,
        build: async () => {},
        check: async () => {
          throw new Error("formal artifact changed");
        },
        fetchAssets: async () => {},
        setup: async () => {
          setupCalled = true;
        },
        log: () => {},
      });
      expect.fail("Expected formal artifact replacement to be rejected");
    } catch (error) {
      expect(error.message).to.contain("Refusing to replace current production ZK artifacts");
    }
    expect(setupCalled).to.equal(false);
  });
});
