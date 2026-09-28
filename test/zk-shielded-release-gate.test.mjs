import { expect } from "chai";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { sourceBundleSha256 } from "../scripts/lib/shieldedSourceBundle.mjs";
import { assertRuntimeBenchmarkReport } from "../scripts/zk-shielded-release-check.mjs";

describe("unified shielded runtime benchmarks", function () {
  const manifestSha256 = "a".repeat(64);
  const criteria = {
    allocationMaxGas: 3_000_000,
    claim12MaxGas: 3_000_000,
    browserAllocationMaxMs: 30_000,
    browserClaim12MaxMs: 30_000,
    recoveryMaxMs: 30_000,
    recoveryMinEvents: 2,
  };
  const report = () => ({
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
      allocation: {
        measurement: "local-pool-transaction",
        receiptStatus: 1,
        gasUsed: 1_000_000,
        transactionGasLimit: 2_000_000,
        blockGasLimit: 30_000_000,
      },
      claim12: {
        measurement: "local-pool-transaction",
        receiptStatus: 1,
        gasUsed: 1_000_000,
        transactionGasLimit: 2_000_000,
        blockGasLimit: 30_000_000,
        claimedPeriods: 12,
      },
    },
    browserProof: {
      device: "test device",
      browser: "test browser",
      allocationMs: 1_000,
      claim12Ms: 1_000,
    },
    recovery: {
      cacheCleared: true,
      fromPublicEvents: true,
      eventCount: 2,
      recoveredNotes: 1,
      durationMs: 1_000,
    },
  });

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
    noReceipt.localPoolGas.claim12.measurement = "verifier-call";
    expect(() => assertRuntimeBenchmarkReport(noReceipt, manifestSha256, criteria)).to.throw(
      "successful local pool transaction",
    );
  });
});

describe("shielded release source digest", function () {
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
