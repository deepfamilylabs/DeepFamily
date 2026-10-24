import { expect } from "chai";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Wallet } from "ethers";

import { sourceBundleSha256 } from "../scripts/lib/shieldedSourceBundle.mjs";
import { SHIELDED_CIRCUITS } from "../scripts/lib/zkCircuitSelection.mjs";
import {
  assertRuntimeBenchmarkReport,
  checkShieldedRelease,
  checkShieldedReleaseEvidence,
} from "../scripts/zk-shielded-release-check.mjs";

const criteria = {
  fundMaxGas: 3_000_000,
  claim3MaxGas: 3_000_000,
  browserFundMaxMs: 30_000,
  browserClaim3MaxMs: 30_000,
  recoveryMaxMs: 30_000,
  recoveryMinEvents: 2,
};
const benchmarkReport = (manifestSha256) => ({
  schema: "deepfamily/shielded-runtime-benchmarks@1",
  status: "passed",
  manifestSha256,
  cryptography: {
    fullDepth: {
      verificationMode: "local-cryptographic",
      proofVerified: true,
      lineageDepth: 64,
      noteDepth: 32,
    },
  },
  localPoolGas: {
    fund: {
      measurement: "local-pool-transaction",
      receiptStatus: 1,
      gasUsed: 1_000_000,
      transactionGasLimit: 2_000_000,
      blockGasLimit: 30_000_000,
    },
    claim3: {
      measurement: "local-pool-transaction",
      receiptStatus: 1,
      gasUsed: 1_000_000,
      transactionGasLimit: 2_000_000,
      blockGasLimit: 30_000_000,
      claimedPeriods: 3,
    },
  },
  browserProof: {
    device: "test device",
    browser: "test browser",
    fundMs: 1_000,
    claim3Ms: 1_000,
  },
  recovery: {
    cacheCleared: true,
    fromPublicEvents: true,
    eventCount: 2,
    recoveredNotes: 1,
    durationMs: 1_000,
  },
});

describe("unified shielded runtime benchmarks", function () {
  const manifestSha256 = "a".repeat(64);
  const report = () => benchmarkReport(manifestSha256);

  it("separates verified local full-depth proofs and local gas from the integrated testnet report", function () {
    expect(() => assertRuntimeBenchmarkReport(report(), manifestSha256, criteria)).not.to.throw();
  });

  it("rejects a synthetic proof or unverified pool gas measurement", function () {
    const noProof = report();
    noProof.cryptography.fullDepth.proofVerified = false;
    expect(() => assertRuntimeBenchmarkReport(noProof, manifestSha256, criteria)).to.throw(
      "Full 64/32-depth",
    );
    const noReceipt = report();
    noReceipt.localPoolGas.claim3.measurement = "verifier-call";
    expect(() => assertRuntimeBenchmarkReport(noReceipt, manifestSha256, criteria)).to.throw(
      "successful local pool transaction",
    );
  });
});

describe("shielded release evidence and ceremony composition", function () {
  let root;
  let evidence;
  let manifestSha256;
  let inspectorCalls;

  const write = (relativePath, contents) => {
    const file = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
    return createHash("sha256").update(contents).digest("hex");
  };
  const writeEvidence = () =>
    write("release-evidence/shielded/release-evidence.json", `${JSON.stringify(evidence)}\n`);
  const commit = () => {
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Release Fixture",
        "-c",
        "user.email=release@example.test",
        "commit",
        "-qm",
        "fixture",
      ],
      { cwd: root },
    );
  };
  const artifactInspector = (options) => {
    inspectorCalls.push(options);
    return {
      manifest: { releaseCriteria: criteria },
      manifestSha256: createHash("sha256")
        .update(fs.readFileSync(path.join(root, "circuits/shielded-production-manifest.json")))
        .digest("hex"),
      artifacts: Object.fromEntries(Object.keys(SHIELDED_CIRCUITS).map((action) => [action, {}])),
    };
  };

  beforeEach(async function () {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "shielded-release-evidence-")));
    inspectorCalls = [];
    execFileSync("git", ["init", "-q", root]);
    manifestSha256 = write("circuits/shielded-production-manifest.json", "{}\n");
    const audits = {};
    for (const [index, scope] of ["contracts", "circuits"].entries()) {
      const wallet = new Wallet(`0x${String(index + 1).repeat(64)}`);
      const reportPath = `release-evidence/shielded/${scope}-audit.txt`;
      const reportSha256 = write(reportPath, `${scope} reviewed\n`);
      audits[scope] = {
        decision: "approved",
        organization: `${scope} auditors`,
        reviewer: `${scope} reviewer`,
        reportPath,
        reportSha256,
        signer: wallet.address,
        signature: await wallet.signMessage(
          `DeepFamily shielded audit approval v1\nscope=${scope}\nmanifestSha256=${manifestSha256}\nreportSha256=${reportSha256}`,
        ),
      };
    }
    const reportPath = "release-evidence/shielded/runtime-benchmarks.json";
    const reportSha256 = write(reportPath, `${JSON.stringify(benchmarkReport(manifestSha256))}\n`);
    evidence = {
      schema: "deepfamily/shielded-release-evidence@1",
      status: "approved",
      manifestSha256,
      audits,
      benchmarks: { reportPath, reportSha256 },
    };
    writeEvidence();
    commit();
  });

  afterEach(function () {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("checks signed audits and benchmarks without running the mathematical ceremony verifier", async function () {
    const env = { ...process.env, ZK_PTAU_PATH: "/reviewed/phase1.ptau" };
    const ptauPath = "/explicit/phase1.ptau";
    const result = await checkShieldedReleaseEvidence({ root, env, ptauPath, artifactInspector });
    expect(result).to.deep.equal({
      manifestSha256,
      circuitCount: Object.keys(SHIELDED_CIRCUITS).length,
    });
    expect(inspectorCalls).to.deep.equal([{ root, env, ptauPath }]);
  });

  it("retains real artifact inspection by default", async function () {
    await assert.rejects(
      checkShieldedReleaseEvidence({ root }),
      /Shielded production manifest is invalid/u,
    );
  });

  it("rejects missing or unapproved evidence and a dirty checkout", async function () {
    fs.rmSync(path.join(root, "release-evidence/shielded/release-evidence.json"));
    await assert.rejects(
      checkShieldedReleaseEvidence({ root, artifactInspector }),
      /Shielded release evidence is missing/u,
    );
    evidence.status = "pending";
    writeEvidence();
    await assert.rejects(
      checkShieldedReleaseEvidence({ root, artifactInspector }),
      /has not been approved/u,
    );
    evidence.status = "approved";
    writeEvidence();
    write("unreviewed-source.txt", "not committed\n");
    await assert.rejects(
      checkShieldedReleaseEvidence({ root, artifactInspector }),
      /checkout is not clean/u,
    );
  });

  it("does not let Git environment variables redirect the clean-checkout guard", async function () {
    const cleanRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shielded-release-clean-decoy-"));
    try {
      execFileSync("git", ["init", "-q", cleanRoot]);
      write("unreviewed-source.txt", "not committed\n");
      await assert.rejects(
        checkShieldedReleaseEvidence({
          root,
          env: {
            ...process.env,
            GIT_DIR: path.join(cleanRoot, ".git"),
            GIT_WORK_TREE: cleanRoot,
          },
          artifactInspector,
        }),
        /checkout is not clean/u,
      );
    } finally {
      fs.rmSync(cleanRoot, { recursive: true, force: true });
    }
  });

  it("always verifies the ceremony in the complete API and rechecks the pinned manifest afterward", async function () {
    const calls = [];
    const env = { ...process.env, ZK_PTAU_PATH: "/reviewed/phase1.ptau" };
    const ptauPath = "/explicit/phase1.ptau";
    const result = await checkShieldedRelease({
      root,
      env,
      ptauPath,
      artifactInspector,
      ceremonyVerifier: async (options) => {
        calls.push(options);
        expect(inspectorCalls).to.have.length(1);
        return { manifestSha256, circuitCount: Object.keys(SHIELDED_CIRCUITS).length };
      },
    });
    expect(calls).to.deep.equal([{ root, env, ptauPath }]);
    expect(inspectorCalls).to.deep.equal([
      { root, env, ptauPath },
      { root, env, ptauPath },
    ]);
    expect(result.manifestSha256).to.equal(manifestSha256);
  });

  it("propagates mathematical verification failures without returning evidence as success", async function () {
    await assert.rejects(
      checkShieldedRelease({
        root,
        artifactInspector,
        ceremonyVerifier: async () => {
          throw new Error("ceremony failed");
        },
      }),
      /ceremony failed/u,
    );
    expect(inspectorCalls).to.have.length(1);
  });

  it("rejects a manifest changed during mathematical verification", async function () {
    await assert.rejects(
      checkShieldedRelease({
        root,
        artifactInspector,
        ceremonyVerifier: async () => {
          write("circuits/shielded-production-manifest.json", '{"changed":true}\n');
          return { manifestSha256, circuitCount: Object.keys(SHIELDED_CIRCUITS).length };
        },
      }),
      /manifest changed during release verification/u,
    );
    expect(inspectorCalls).to.have.length(2);
  });

  it("does not expose a CLI option to skip ceremony verification", function () {
    const result = spawnSync(
      process.execPath,
      ["scripts/zk-shielded-release-check.mjs", "--skip-ceremony"],
      { encoding: "utf8" },
    );
    expect(result.status).to.equal(1);
    expect(result.stderr).to.match(/Usage: node scripts\/zk-shielded-release-check\.mjs/u);
  });

  it("verifies the complete mainnet catalog once before opening the RPC", function () {
    const source = fs.readFileSync("scripts/evm-mainnet-release.mjs", "utf8");
    const main = source.slice(source.indexOf("export const main = async"));
    const evidenceCheck = main.indexOf("await checkShieldedReleaseEvidence(");
    const ceremonyCheck = main.indexOf("await verifyAllProductionCeremonies(");
    const rpcConnection = main.indexOf("await hre.network.create(");
    expect(evidenceCheck).to.be.greaterThan(-1);
    expect(ceremonyCheck).to.be.greaterThan(evidenceCheck);
    expect(rpcConnection).to.be.greaterThan(ceremonyCheck);
    expect(main.match(/await verifyAllProductionCeremonies\(/gu)).to.have.length(1);
    expect(main.slice(ceremonyCheck, rpcConnection)).to.include(
      "zkCeremonyVerification.shielded.manifestSha256 !== shieldedReleaseEvidence.manifestSha256",
    );
  });
});

describe("shielded release source digest", function () {
  it("hashes the requested checkout even when the parent environment redirects Git", function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shielded-source-environment-"));
    const previousGitDir = process.env.GIT_DIR;
    try {
      execFileSync("git", ["init", "-q", root]);
      fs.mkdirSync(path.join(root, "scripts"));
      fs.writeFileSync(path.join(root, "scripts/reviewed.mjs"), "reviewed source\n");
      execFileSync("git", ["add", "-A"], { cwd: root });
      const expected = sourceBundleSha256(root);
      process.env.GIT_DIR = path.join(root, "missing-git-dir");
      expect(sourceBundleSha256(root)).to.equal(expected);
      expect(
        sourceBundleSha256(root, {
          env: { ...process.env, GIT_INDEX_FILE: path.join(root, "missing-index") },
        }),
      ).to.equal(expected);
    } finally {
      if (previousGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previousGitDir;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("hashes removed optional sources while rejecting a missing active circuit source", function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shielded-source-removal-"));
    try {
      execFileSync("git", ["init", "-q", root]);
      fs.mkdirSync(path.join(root, "circuits"));
      const active = path.join(root, "circuits/shielded_private_transfer.circom");
      const obsolete = path.join(root, "circuits/obsolete.circom");
      fs.writeFileSync(active, "active source");
      fs.writeFileSync(obsolete, "obsolete source");
      execFileSync("git", ["add", "-A"], { cwd: root });
      const baseline = sourceBundleSha256(root);
      fs.rmSync(obsolete);
      expect(sourceBundleSha256(root)).not.to.equal(baseline);
      fs.rmSync(active);
      expect(() => sourceBundleSha256(root)).to.throw("tracked source is missing");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("binds release sources without depending on generated proof files", function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shielded-release-digest-"));
    const tracked = [
      "hardhat/deploy.mjs",
      "lib/deployment.mjs",
      "tasks/lib/timelockUpgrade.mjs",
      "frontend/vite.config.ts",
      "frontend/package.json",
      "frontend/scripts/sync-abi.mjs",
      "docs/notes.md",
      "frontend/public/zk/shielded/unexpected-file.js",
    ];
    const generated = [
      "frontend/public/zk/person_commitment.wasm",
      "frontend/public/zk/disclosure_binding_final.zkey",
      "frontend/public/zk/shielded/shielded_shield.wasm",
      "contracts/PersonCommitmentVerifier.sol",
      "contracts/DisclosureBindingVerifier.sol",
      "contracts/ShieldedShieldVerifier.sol",
    ];
    try {
      execFileSync("git", ["init", "-q", root]);
      for (const file of [...tracked, ...generated, "unrelated.txt"]) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), "original");
      }
      execFileSync("git", ["add", "-A"], { cwd: root });
      const baseline = sourceBundleSha256(root);
      for (const file of tracked) {
        fs.writeFileSync(path.join(root, file), "modified");
        expect(sourceBundleSha256(root), `${file} must affect the release digest`).not.to.equal(
          baseline,
        );
        fs.writeFileSync(path.join(root, file), "original");
      }
      fs.writeFileSync(path.join(root, "unrelated.txt"), "modified");
      expect(sourceBundleSha256(root)).to.equal(baseline);
      for (const file of generated) {
        fs.writeFileSync(path.join(root, file), "modified");
        expect(sourceBundleSha256(root), `${file} must be checked by its artifact digest`).to.equal(
          baseline,
        );
        fs.writeFileSync(path.join(root, file), "original");
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
