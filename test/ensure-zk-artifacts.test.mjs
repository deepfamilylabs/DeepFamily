import { expect } from "chai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureZkArtifacts } from "../scripts/ensure-zk-artifacts.mjs";
import { SHIELDED_CIRCUITS } from "../scripts/lib/zkCircuitSelection.mjs";

const circuitCount = 14;

function writePinnedArtifacts(root, status) {
  const files = {
    "circuits/zk-artifacts-manifest.json": JSON.stringify({ trustedSetup: { status } }),
    "frontend/public/zk/person_commitment_final.zkey": "pinned proving key",
    "frontend/public/zk/person_commitment.vkey.json": "pinned verification key",
    "contracts/PersonCommitmentVerifier.sol": "pinned verifier",
  };
  const shieldedManifest =
    status === "production"
      ? "circuits/shielded-production-manifest.json"
      : "circuits/shielded-development-manifest.json";
  files[shieldedManifest] = JSON.stringify({ status });
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return files;
}

function expectPinnedArtifactsUnchanged(root, files) {
  for (const [name, contents] of Object.entries(files)) {
    expect(fs.readFileSync(path.join(root, name), "utf8"), name).to.equal(contents);
  }
}

describe("integrated local ZK artifact preparation", function () {
  let root;
  beforeEach(function () {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-integrated-zk-"));
  });
  afterEach(function () {
    fs.rmSync(root, { recursive: true, force: true });
  });

  for (const status of ["development", "production"]) {
    it(`compiles every circuit and reuses verified ${status} keys without changing their status`, async function () {
      const files = writePinnedArtifacts(root, status);
      const calls = [];
      const artifacts = { status, circuitCount };
      const result = await ensureZkArtifacts({
        root,
        build: async (options) => {
          expect(options).to.deep.equal({ root, circuit: "all" });
          calls.push("build");
        },
        check: async (options) => {
          expect(options).to.deep.equal({ root });
          calls.push("check");
          return artifacts;
        },
        fetchAssets: async () => calls.push("fetch"),
        log: () => {},
      });
      expect(calls).to.deep.equal(["build", "check"]);
      expect(result).to.deep.equal({ regenerated: false, artifacts });
      expect(result.artifacts).to.equal(artifacts);
      expectPinnedArtifactsUnchanged(root, files);
    });
  }

  it("downloads pinned files and verifies them before reporting readiness", async function () {
    const calls = [];
    const artifacts = { status: "development", circuitCount };
    let downloaded = false;
    const log = () => {};
    const result = await ensureZkArtifacts({
      root,
      build: async () => calls.push("build"),
      check: async () => {
        calls.push("check");
        if (!downloaded) throw new Error("missing public proof keys");
        return artifacts;
      },
      fetchAssets: async (options) => {
        expect(options).to.deep.equal({ root, log });
        calls.push("fetch");
        downloaded = true;
      },
      log,
    });
    expect(calls).to.deep.equal(["build", "check", "fetch", "check"]);
    expect(result).to.deep.equal({ regenerated: false, artifacts });
  });

  for (const [label, status, changedFile] of [
    [
      "changed circuit",
      "development",
      "zk-artifacts/shielded/budget_deposit.r1cs",
    ],
    [
      "changed receive loader",
      "development",
      "frontend/src/shared/zk/receiveProtocol.ts",
    ],
    ["invalid final artifact", "production", "zk-artifacts/circuits/person_commitment.r1cs"],
  ]) {
    it(`requires explicit setup when the ${label} fails verification`, async function () {
      const files = writePinnedArtifacts(root, status);
      const calls = [];
      const verificationError = new Error(`${label} does not match its manifest`);
      let failure;
      try {
        await ensureZkArtifacts({
          root,
          build: async () => {
            calls.push("build");
            const file = path.join(root, changedFile);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, "changed input");
          },
          check: async () => {
            calls.push("check");
            throw verificationError;
          },
          fetchAssets: async () => calls.push("fetch"),
          log: () => {},
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).to.be.instanceOf(Error);
      expect(failure.cause).to.equal(verificationError);
      expect(failure.message).to.contain(verificationError.message);
      expect(failure.message).to.contain("npm run zk:dev");
      expect(failure.message).to.contain("npm run zk:assets:fetch");
      expect(failure.message).to.contain("npm run zk:assets:publish");
      expect(calls).to.deep.equal(["build", "check", "fetch", "check"]);
      expectPinnedArtifactsUnchanged(root, files);
    });
  }

  it("preserves pinned keys and reports the download failure instead of generating replacements", async function () {
    const files = writePinnedArtifacts(root, "development");
    const calls = [];
    const downloadError = new Error("ZK asset download failed: HTTP 404");
    let failure;
    try {
      await ensureZkArtifacts({
        root,
        build: async () => calls.push("build"),
        check: async () => {
          calls.push("check");
          throw new Error("missing shielded key");
        },
        fetchAssets: async () => {
          calls.push("fetch");
          throw downloadError;
        },
        log: () => {},
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).to.be.instanceOf(Error);
    expect(failure.cause).to.equal(downloadError);
    expect(failure.message).to.contain(downloadError.message);
    expect(failure.message).to.contain("npm run zk:dev");
    expect(failure.message).to.contain("npm run zk:assets:publish");
    expect(calls).to.deep.equal(["build", "check", "fetch"]);
    expectPinnedArtifactsUnchanged(root, files);
  });

  it("stops before checking or downloading when a circuit does not compile", async function () {
    const files = writePinnedArtifacts(root, "development");
    const compileError = new Error("Circom compilation failed");
    const calls = [];
    let failure;
    try {
      await ensureZkArtifacts({
        root,
        build: async () => {
          calls.push("build");
          throw compileError;
        },
        check: async () => calls.push("check"),
        fetchAssets: async () => calls.push("fetch"),
        log: () => {},
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).to.equal(compileError);
    expect(calls).to.deep.equal(["build"]);
    expectPinnedArtifactsUnchanged(root, files);
  });
});
