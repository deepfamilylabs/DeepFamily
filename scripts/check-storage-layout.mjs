#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { BASELINE_DIR, loadStorageLayout, diffLayouts } from "./lib/storageLayout.mjs";

const PROJECT_ROOT = process.cwd();
const UPDATE = process.argv.includes("--update") || process.env.STORAGE_BASELINE_UPDATE === "1";

// Upgradeable (proxy) contracts. Their storage layout must stay append-only across
// versions, so each build is diffed against a committed baseline snapshot.
const PROXY_CONTRACTS = [
  { name: "DeepFamily", artifact: "artifacts/contracts/DeepFamily.sol/DeepFamily.json" },
];

// Positive: the canonical upgrade target must be a safe extension of the base.
const POSITIVE_MOCK_CHECKS = [
  {
    label: "DeepFamily -> DeepFamilyV2Mock",
    from: "artifacts/contracts/DeepFamily.sol/DeepFamily.json",
    to: "artifacts/contracts/test/DeepFamilyV2Mock.sol/DeepFamilyV2Mock.json",
  },
];

// Negative: an intentionally incompatible upgrade target. The checker must report errors;
// passing this would mean the checker has stopped enforcing storage safety. Keeps the
// `storage:check` step honest about its own correctness.
const NEGATIVE_MOCK_CHECKS = [
  {
    label: "DeepFamily -/-> UnsafeUpgradeMock (must error)",
    from: "artifacts/contracts/DeepFamily.sol/DeepFamily.json",
    to: "artifacts/contracts/test/UnsafeUpgradeMock.sol/UnsafeUpgradeMock.json",
  },
];

let failed = false;

// 1) Baseline diff: current layout vs the committed V1 snapshot (the real upgrade guard).
fs.mkdirSync(path.join(PROJECT_ROOT, BASELINE_DIR), { recursive: true });
for (const contract of PROXY_CONTRACTS) {
  const current = loadStorageLayout(contract.artifact);
  const baselinePath = path.join(BASELINE_DIR, `${contract.name}.json`);
  const baselineAbs = path.join(PROJECT_ROOT, baselinePath);

  if (UPDATE || !fs.existsSync(baselineAbs)) {
    fs.writeFileSync(baselineAbs, JSON.stringify(current, null, 2) + "\n");
    console.log(
      `[storage:check] ${contract.name}: baseline ${UPDATE ? "updated" : "created"} (${baselinePath})`,
    );
    continue;
  }

  const baseline = JSON.parse(fs.readFileSync(baselineAbs, "utf8"));
  const errors = diffLayouts(baseline, current);
  if (errors.length > 0) {
    failed = true;
    console.error(
      `[storage:check] ${contract.name} breaks the committed storage baseline ` +
        `(${baselinePath}). If this change is an intentional, append-only upgrade, ` +
        `rerun with --update to refresh the baseline:`,
    );
    console.error(JSON.stringify(errors, null, 2));
  } else {
    console.log(`[storage:check] ${contract.name}: matches baseline OK`);
  }
}

// 2) Positive: a known-safe upgrade target must pass.
for (const check of POSITIVE_MOCK_CHECKS) {
  const errors = diffLayouts(loadStorageLayout(check.from), loadStorageLayout(check.to));
  if (errors.length > 0) {
    failed = true;
    console.error(`[storage:check] ${check.label} is not storage-safe:`);
    console.error(JSON.stringify(errors, null, 2));
  } else {
    console.log(`[storage:check] ${check.label}: OK`);
  }
}

// 3) Negative: a known-incompatible upgrade target must be flagged. If this passes silently
// the checker is broken and the whole `storage:check` step is worthless.
for (const check of NEGATIVE_MOCK_CHECKS) {
  const errors = diffLayouts(loadStorageLayout(check.from), loadStorageLayout(check.to));
  if (errors.length === 0) {
    failed = true;
    console.error(
      `[storage:check] ${check.label}: expected errors but got none — the checker has stopped ` +
        "enforcing storage safety.",
    );
  } else {
    console.log(
      `[storage:check] ${check.label}: OK (correctly flagged ${errors.length} issue${errors.length === 1 ? "" : "s"})`,
    );
  }
}

if (failed) process.exit(1);
