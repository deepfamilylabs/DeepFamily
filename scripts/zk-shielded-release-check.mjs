#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, verifyMessage } from "ethers";

import { checkedFile, sourceBundleSha256 } from "./lib/shieldedSourceBundle.mjs";
import {
  inspectShieldedProductionArtifacts,
  verifyShieldedProductionCeremony,
} from "./lib/shieldedProductionSetup.mjs";

export { sourceBundleSha256 } from "./lib/shieldedSourceBundle.mjs";

const DEFAULT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const MANIFEST_PATH = "circuits/shielded-production-manifest.json";
const EVIDENCE_PATH = "release-evidence/shielded/release-evidence.json";
const SHA256 = /^[0-9a-f]{64}$/;
const hashBytes = (data) => createHash("sha256").update(data).digest("hex");
const hashFile = (file) => hashBytes(fs.readFileSync(file));
const fail = (message) => {
  throw new Error(message);
};
const requireValue = (condition, message) => {
  if (!condition) fail(message);
};
const requireHash = (value, label) =>
  requireValue(SHA256.test(value ?? ""), `${label} must be SHA-256`);

function readJson(root, relativePath, label, prefix = "") {
  const absolute = checkedFile(root, relativePath, label, prefix);
  try {
    return { value: JSON.parse(fs.readFileSync(absolute, "utf8")), absolute };
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function checkHashedFile(root, relativePath, digest, label, prefix = "") {
  requireHash(digest, `${label} digest`);
  const absolute = checkedFile(root, relativePath, label, prefix);
  requireValue(hashFile(absolute) === digest, `${label} SHA-256 mismatch: ${relativePath}`);
  return absolute;
}

function assertCleanCheckout(root) {
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });
  requireValue(
    status.trim() === "",
    "Release checkout is not clean; commit and review all sources and evidence first",
  );
}

function assertReleaseCriteria(criteria) {
  for (const field of [
    "fundMaxGas",
    "claim12MaxGas",
    "browserFundMaxMs",
    "browserClaim12MaxMs",
    "recoveryMaxMs",
    "recoveryMinEvents",
  ]) {
    requireValue(
      Number.isSafeInteger(criteria?.[field]) && criteria[field] > 0,
      `Production manifest must precommit a positive ${field} release threshold`,
    );
  }
}

function auditMessage(scope, manifestSha256, reportSha256) {
  return `DeepFamily shielded audit approval v1\nscope=${scope}\nmanifestSha256=${manifestSha256}\nreportSha256=${reportSha256}`;
}

function assertAudit(root, audit, scope, manifestSha256) {
  requireValue(audit?.decision === "approved", `${scope} independent audit is not approved`);
  requireValue(
    typeof audit.organization === "string" && audit.organization.trim().length >= 3,
    `${scope} auditor organization is missing`,
  );
  requireValue(
    typeof audit.reviewer === "string" && audit.reviewer.trim().length >= 3,
    `${scope} auditor reviewer is missing`,
  );
  checkHashedFile(
    root,
    audit.reportPath,
    audit.reportSha256,
    `${scope} independent audit report`,
    "release-evidence/shielded/",
  );
  let signer;
  try {
    signer = getAddress(audit.signer);
    requireValue(
      verifyMessage(auditMessage(scope, manifestSha256, audit.reportSha256), audit.signature) ===
        signer,
      `${scope} auditor signature does not bind the report and production manifest`,
    );
  } catch (error) {
    fail(`${scope} auditor approval signature is invalid: ${error.message}`);
  }
  return { organization: audit.organization.trim().toLowerCase(), signer };
}

function positiveMeasure(value, label) {
  requireValue(Number.isSafeInteger(value) && value > 0, `${label} must be a positive integer`);
  return value;
}

export function assertRuntimeBenchmarkReport(report, manifestSha256, criteria) {
  requireValue(
    report?.schema === "deepfamily/shielded-runtime-benchmarks@1",
    "Shielded runtime benchmark report schema is invalid",
  );
  requireValue(report.status === "passed", "Shielded runtime benchmark report did not pass");
  requireValue(
    report.manifestSha256 === manifestSha256,
    "Shielded runtime benchmark report uses different production artifacts",
  );
  requireValue(
    report.cryptography?.fullDepth?.verificationMode === "local-cryptographic" &&
      report.cryptography.fullDepth.proofVerified === true &&
      report.cryptography.fullDepth.lineageDepth === 64 &&
      report.cryptography.fullDepth.noteDepth === 32,
    "Full 64/32-depth cryptographic proof benchmark is missing",
  );
  for (const [name, limit, expectedPeriods] of [
    ["fund", "fundMaxGas", null],
    ["claim12", "claim12MaxGas", 12],
  ]) {
    const tx = report.localPoolGas?.[name];
    requireValue(
      tx?.measurement === "local-pool-transaction" && tx.receiptStatus === 1,
      `${name} must be measured from a successful local pool transaction`,
    );
    const used = positiveMeasure(tx.gasUsed, `${name} gas used`);
    const txLimit = positiveMeasure(tx.transactionGasLimit, `${name} transaction gas limit`);
    const blockLimit = positiveMeasure(tx.blockGasLimit, `${name} block gas limit`);
    requireValue(
      used <= txLimit && txLimit <= blockLimit,
      `${name} gas exceeds the transaction or block limit`,
    );
    requireValue(used <= criteria[limit], `${name} exceeds the precommitted release gas threshold`);
    if (expectedPeriods !== null)
      requireValue(tx.claimedPeriods === expectedPeriods, `${name} did not exercise 12 periods`);
  }
  const browser = report.browserProof;
  requireValue(
    typeof browser?.device === "string" && browser.device.trim().length >= 3,
    "Browser proof target device is missing",
  );
  requireValue(
    typeof browser?.browser === "string" && browser.browser.trim().length >= 3,
    "Browser proof browser version is missing",
  );
  requireValue(
    positiveMeasure(browser.fundMs, "Browser fund proof time") <= criteria.browserFundMaxMs,
    "Browser fund proof exceeds precommitted time threshold",
  );
  requireValue(
    positiveMeasure(browser.claim12Ms, "Browser 12-period proof time") <=
      criteria.browserClaim12MaxMs,
    "Browser 12-period proof exceeds precommitted time threshold",
  );
  const recovery = report.recovery;
  requireValue(
    recovery?.cacheCleared === true && recovery.fromPublicEvents === true,
    "Recovery must use public events after clearing the local cache",
  );
  requireValue(
    positiveMeasure(recovery.eventCount, "Recovery event count") >= criteria.recoveryMinEvents,
    "Recovery sample is smaller than precommitted event count",
  );
  requireValue(
    positiveMeasure(recovery.recoveredNotes, "Recovered note count") > 0,
    "Recovery did not find a user's note",
  );
  requireValue(
    positiveMeasure(recovery.durationMs, "Recovery time") <= criteria.recoveryMaxMs,
    "Recovery exceeds precommitted time threshold",
  );
}

function assertReleaseEvidence(root, evidence, manifest, manifestSha256) {
  requireValue(
    evidence?.schema === "deepfamily/shielded-release-evidence@1",
    "Shielded release evidence schema is invalid",
  );
  requireValue(evidence.status === "approved", "Shielded release evidence has not been approved");
  requireValue(
    evidence.manifestSha256 === manifestSha256,
    "Release evidence points to different shielded artifacts",
  );
  const contracts = assertAudit(root, evidence.audits?.contracts, "contracts", manifestSha256);
  const circuits = assertAudit(root, evidence.audits?.circuits, "circuits", manifestSha256);
  requireValue(
    contracts.signer !== circuits.signer,
    "Contract and circuit audits must have distinct external approvers",
  );
  requireValue(
    contracts.organization !== circuits.organization,
    "Contract and circuit audits must come from distinct organizations",
  );
  const benchmarkPath = checkHashedFile(
    root,
    evidence.benchmarks?.reportPath,
    evidence.benchmarks?.reportSha256,
    "Shielded runtime benchmark report",
    "release-evidence/shielded/",
  );
  let report;
  try {
    report = JSON.parse(fs.readFileSync(benchmarkPath, "utf8"));
  } catch (error) {
    fail(`Shielded runtime benchmark report is not valid JSON: ${error.message}`);
  }
  assertRuntimeBenchmarkReport(report, manifestSha256, manifest.releaseCriteria);
}

export async function checkShieldedRelease({ root = DEFAULT_ROOT } = {}) {
  root = path.resolve(root);
  const productionManifest = path.join(root, MANIFEST_PATH);
  if (!fs.existsSync(productionManifest)) {
    const developmentManifest = path.join(root, "circuits/shielded-development-manifest.json");
    fail(
      `Missing ${MANIFEST_PATH}. ` +
        (fs.existsSync(developmentManifest)
          ? "The existing development-only shielded keys are explicitly forbidden for release. "
          : "") +
        "Run npm run zk:production:setup to prepare production artifacts for all nine circuits.",
    );
  }
  const { manifest, manifestSha256, artifacts } = inspectShieldedProductionArtifacts({ root });
  assertReleaseCriteria(manifest.releaseCriteria);
  const { value: evidence } = readJson(
    root,
    EVIDENCE_PATH,
    "Shielded release evidence",
    "release-evidence/shielded/",
  );
  assertReleaseEvidence(root, evidence, manifest, manifestSha256);
  assertCleanCheckout(root);
  await verifyShieldedProductionCeremony({ root });
  return { manifestSha256, circuitCount: Object.keys(artifacts).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === "--print-source-digest") {
    console.log(sourceBundleSha256());
  } else if (process.argv.length !== 2) {
    console.error("Usage: node scripts/zk-shielded-release-check.mjs [--print-source-digest]");
    process.exitCode = 1;
  } else {
    checkShieldedRelease()
      .then(({ manifestSha256, circuitCount }) => {
        console.log(
          `Shielded automated release checks passed: ${circuitCount} circuits, manifest SHA-256 ${manifestSha256}. The integrated acceptance report verifies testnet receipts before Mainnet planning.`,
        );
      })
      .catch((error) => {
        console.error(`[zk-shielded-release-check] ${error.message}`);
        process.exitCode = 1;
      });
  }
}
