import { expect } from "chai";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  compiledCircuitsMatchManifests,
  ensureZkArtifacts,
} from "../scripts/ensure-zk-artifacts.mjs";
import { SHIELDED_CIRCUITS } from "../scripts/lib/zkCircuitSelection.mjs";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const circuitCount = 2 + Object.keys(SHIELDED_CIRCUITS).length;

/** Writes every compiled Circom circuit and development manifests that pin their digests. */
function writeCompiledCircuits(root) {
  const compile = (directory, name) => {
    const output = path.join(root, directory);
    fs.mkdirSync(path.join(output, `${name}_js`), { recursive: true });
    fs.writeFileSync(path.join(output, `${name}.r1cs`), `${name} r1cs`);
    fs.writeFileSync(path.join(output, `${name}_js`, `${name}.wasm`), `${name} wasm`);
    return { r1csSha256: sha256(`${name} r1cs`), wasmSha256: sha256(`${name} wasm`) };
  };
  const core = Object.fromEntries(
    ["person_commitment", "disclosure_binding"].map((name) => [
      name,
      compile("zk-artifacts/circuits", name),
    ]),
  );
  const shielded = Object.fromEntries(
    Object.entries(SHIELDED_CIRCUITS).map(([action, name]) => [
      action,
      { source: name, ...compile("zk-artifacts/shielded", name) },
    ]),
  );
  fs.writeFileSync(
    path.join(root, "circuits/zk-artifacts-manifest.json"),
    JSON.stringify({ trustedSetup: { status: "development" }, circuits: core }),
  );
  fs.writeFileSync(
    path.join(root, "circuits/shielded-development-manifest.json"),
    JSON.stringify({ circuits: shielded }),
  );
}

describe("integrated local ZK artifact preparation", function () {
  let root;
  beforeEach(function () {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-integrated-zk-"));
    fs.mkdirSync(path.join(root, "circuits"));
  });
  afterEach(function () {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("compiles every Circom circuit and reuses verified current keys", async function () {
    const calls = [];
    const artifacts = { status: "development", circuitCount };
    const result = await ensureZkArtifacts({
      root,
      build: async (options) => {
        expect(options).to.deep.equal({ root, circuit: "all" });
        calls.push(["build", options.circuit]);
      },
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
        if (!downloaded) throw new Error("missing public presentation keys");
        return { status: "development", circuitCount };
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

  it("regenerates development keys when a receive presentation circuit changes", async function () {
    writeCompiledCircuits(root);
    fs.writeFileSync(
      path.join(root, "zk-artifacts/shielded/shielded_anonymous_receive_presentation.r1cs"),
      "changed constraints",
    );
    const calls = [];
    let ready = false;
    const result = await ensureZkArtifacts({
      root,
      build: async (options) => calls.push(`build:${options.circuit}`),
      check: async () => {
        calls.push("check");
        if (!ready) throw new Error("missing shielded key");
        return { status: "development", circuitCount };
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

  it("stops before downloading or setup when a changed receive source does not compile", async function () {
    writeCompiledCircuits(root);
    fs.mkdirSync(path.join(root, "circuits"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "circuits/shielded_anonymous_receive_presentation.circom"),
      "invalid Circom source",
    );
    const compileError = new Error("Circom compilation failed");
    let fetchCalled = false;
    let setupCalled = false;
    try {
      await ensureZkArtifacts({
        root,
        build: async () => {
          throw compileError;
        },
        fetchAssets: async () => {
          fetchCalled = true;
        },
        setup: async () => {
          setupCalled = true;
        },
        log: () => {},
      });
      expect.fail("Expected compilation to fail before key preparation");
    } catch (error) {
      expect(error).to.equal(compileError);
    }
    expect(fetchCalled).to.equal(false);
    expect(setupCalled).to.equal(false);
  });

  it("preserves proving keys when only the browser loader changed", async function () {
    writeCompiledCircuits(root);
    const loader = path.join(root, "frontend/src/shared/zk/shieldedReceivePresentation.ts");
    fs.mkdirSync(path.dirname(loader), { recursive: true });
    fs.writeFileSync(loader, "changed loader");
    expect(compiledCircuitsMatchManifests({ root })).to.equal(true);
    let setupCalled = false;
    try {
      await ensureZkArtifacts({
        root,
        build: async () => {},
        check: async () => {
          throw new Error("Receive linking loader changed");
        },
        fetchAssets: async () => {},
        setup: async () => {
          setupCalled = true;
        },
        log: () => {},
      });
      expect.fail("Expected loader mismatch to remain blocked without replacing keys");
    } catch (error) {
      expect(error.message).to.contain("unchanged circuits (Receive linking loader changed)");
    }
    expect(setupCalled).to.equal(false);
  });

  it("keeps the committed keys of unchanged circuits when their files cannot be installed", async function () {
    fs.writeFileSync(
      path.join(root, "circuits/zk-artifacts-manifest.json"),
      JSON.stringify({ trustedSetup: { status: "development" } }),
    );
    let setupCalled = false;
    try {
      await ensureZkArtifacts({
        root,
        build: async () => {},
        check: async () => {
          throw new Error("missing shielded key");
        },
        fetchAssets: async () => {
          throw new Error("ZK asset download failed: HTTP 404");
        },
        setup: async () => {
          setupCalled = true;
        },
        circuitsUnchanged: () => true,
        log: () => {},
      });
      expect.fail("Expected unchanged circuits to keep their committed keys");
    } catch (error) {
      expect(error.message).to.contain(
        "Refusing to replace the committed development keys of unchanged circuits " +
          "(ZK asset download failed: HTTP 404)",
      );
      expect(error.message).to.contain("npm run zk:assets:publish");
      expect(error.message).to.contain("npm run zk:development:setup");
    }
    expect(setupCalled).to.equal(false);
  });

  it("treats circuits as unchanged only when every compiled R1CS and WASM matches its manifest", function () {
    writeCompiledCircuits(root);
    expect(compiledCircuitsMatchManifests({ root })).to.equal(true);

    fs.writeFileSync(path.join(root, "zk-artifacts/shielded/shielded_unshield.r1cs"), "edited");
    expect(compiledCircuitsMatchManifests({ root })).to.equal(false);

    writeCompiledCircuits(root);
    fs.writeFileSync(
      path.join(root, "zk-artifacts/circuits/person_commitment_js/person_commitment.wasm"),
      "edited",
    );
    expect(compiledCircuitsMatchManifests({ root })).to.equal(false);

    writeCompiledCircuits(root);
    const shieldedManifest = path.join(root, "circuits/shielded-development-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(shieldedManifest, "utf8"));
    delete manifest.circuits.privateTransfer;
    fs.writeFileSync(shieldedManifest, JSON.stringify(manifest));
    expect(compiledCircuitsMatchManifests({ root })).to.equal(false);

    fs.rmSync(shieldedManifest);
    expect(compiledCircuitsMatchManifests({ root })).to.equal(false);
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
