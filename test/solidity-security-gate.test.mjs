import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  evaluateSlitherReport,
  assertSlitherCoverage,
  assertBaselineSources,
  prepareCurrentBuildInfo,
  SLITHER_VERSION,
} from "../scripts/check-solidity-security.mjs";

const baseline = (findings = []) => ({ version: 1, slitherVersion: SLITHER_VERSION, findings });
const finding = (overrides = {}) => ({
  id: "finding-a",
  check: "reentrancy-eth",
  impact: "High",
  description: "Example finding",
  ...overrides,
});
const report = (detectors) => ({ success: true, error: null, results: { detectors } });

describe("Solidity security gate", function () {
  it("expires an exact-ID review after its source changes and rejects unbound snapshot paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-slither-review-test-"));
    try {
      fs.mkdirSync(path.join(root, "contracts"));
      const source = "contract Pool {}\n";
      fs.writeFileSync(path.join(root, "contracts/Pool.sol"), source);
      const reviewed = {
        sourceSha256: { "contracts/Pool.sol": createHash("sha256").update(source).digest("hex") },
        findings: [{ id: "reviewed-finding", sources: ["contracts/Pool.sol"] }],
      };
      assertBaselineSources(reviewed, root);
      assert.throws(
        () => assertBaselineSources({ ...reviewed, findings: [] }, root),
        /do not match/,
      );
      fs.appendFileSync(path.join(root, "contracts/Pool.sol"), "// changed\n");
      assert.throws(() => assertBaselineSources(reviewed, root), /review is stale/);
      assert.throws(() => assertBaselineSources({ findings: [] }, root), /Missing/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it("rejects zero analysis, partial production coverage and a missing detector catalog", () => {
    const valid = {
      analysis: {
        contracts: 3,
        detectors: 102,
        hashSeed: "0",
        callOrder: "source-position-v1",
        sources: ["contracts/Pool.sol"],
      },
    };
    assertSlitherCoverage(valid, ["contracts/Pool.sol"]);
    assert.throws(
      () => assertSlitherCoverage({ success: true, results: {} }, ["contracts/Pool.sol"]),
      /cover/,
    );
    assert.throws(
      () => assertSlitherCoverage({ analysis: { ...valid.analysis, contracts: 0 } }, []),
      /cover/,
    );
    assert.throws(() => assertSlitherCoverage(valid, ["contracts/Other.sol"]), /cover/);
    assert.throws(
      () => assertSlitherCoverage({ analysis: { ...valid.analysis, detectors: 101 } }, []),
      /cover/,
    );
  });
  it("rejects analyzer failures even when a detector array is present", () => {
    assert.throws(
      () =>
        evaluateSlitherReport(
          { ...report([]), success: false, error: "AST parsing failed" },
          baseline(),
        ),
      /did not finish/,
    );
    assert.throws(() => evaluateSlitherReport({ success: true }, baseline()), /did not finish/);
    assert.equal(
      evaluateSlitherReport({ success: true, error: null, results: {} }, baseline()).findings
        .length,
      0,
    );
  });

  it("blocks unreviewed High and Medium findings and preserves lower-severity reports", () => {
    const result = evaluateSlitherReport(
      report([
        finding(),
        finding({ id: "finding-b", impact: "Medium" }),
        finding({ id: "finding-c", impact: "Low" }),
      ]),
      baseline(),
    );
    assert.equal(result.unexpected.length, 2);
    assert.equal(result.findings.length, 3);
    assert.deepEqual(result.counts, { High: 1, Medium: 1, Low: 1 });
  });

  it("requires an exact reviewed finding and rejects broad or obsolete exceptions", () => {
    const reviewed = {
      ...finding(),
      reason: "This specific call is protected by a shared reentrancy guard before state writes.",
    };
    assert.equal(
      evaluateSlitherReport(report([finding()]), baseline([reviewed])).unexpected.length,
      0,
    );
    assert.throws(() => evaluateSlitherReport(report([]), baseline([reviewed])), /obsolete/);
    assert.throws(
      () =>
        evaluateSlitherReport(report([finding()]), baseline([{ ...reviewed, reason: "ignore" }])),
      /rationale/,
    );
    assert.throws(
      () =>
        evaluateSlitherReport(
          report([finding()]),
          baseline([{ ...reviewed, check: "another-detector" }]),
        ),
      /metadata changed/,
    );
  });

  it("selects only referenced compiler inputs and rejects stale source contents", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-slither-gate-test-"));
    try {
      for (const directory of ["contracts", "artifacts/contracts/Pool.sol", "artifacts/build-info"])
        fs.mkdirSync(path.join(root, directory), { recursive: true });
      const write = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value));
      const source = "pragma solidity ^0.8.24; contract Pool {}\n";
      fs.writeFileSync(path.join(root, "contracts/Pool.sol"), source);
      write("artifacts/contracts/Pool.sol/Pool.json", {
        sourceName: "contracts/Pool.sol",
        contractName: "Pool",
        buildInfoId: "current",
      });
      write("artifacts/build-info/current.json", {
        id: "current",
        solcVersion: "0.8.28",
        userSourceNameMap: { "contracts/Pool.sol": "project/contracts/Pool.sol" },
        input: {
          language: "Solidity",
          sources: { "project/contracts/Pool.sol": { content: source } },
        },
      });
      write("artifacts/build-info/current.output.json", {
        id: "current",
        output: { contracts: { "project/contracts/Pool.sol": { Pool: {} } } },
      });
      write("artifacts/build-info/obsolete.json", { notValidBuildInfo: true });
      const selected = path.join(root, "selected");
      assert.deepEqual(prepareCurrentBuildInfo(root, selected), {
        compilations: 1,
        sources: ["contracts/Pool.sol"],
      });
      assert.deepEqual(fs.readdirSync(path.join(selected, "build-info")), [
        "current.json",
        "current.output.json",
      ]);
      fs.writeFileSync(path.join(root, "contracts/Unbuilt.sol"), "contract Unbuilt {}\n");
      assert.throws(
        () => prepareCurrentBuildInfo(root, path.join(root, "incomplete")),
        /No current artifact/,
      );
      fs.rmSync(path.join(root, "contracts/Unbuilt.sol"));
      fs.appendFileSync(path.join(root, "contracts/Pool.sol"), "// changed\n");
      assert.throws(
        () => prepareCurrentBuildInfo(root, path.join(root, "stale")),
        /Stale compiler input/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
