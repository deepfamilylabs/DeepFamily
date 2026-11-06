#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SLITHER_VERSION = "0.11.6";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BLOCKING_IMPACTS = new Set(["High", "Medium"]);
const IMPACTS = new Set(["High", "Medium", "Low", "Informational", "Optimization"]);

function json(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function* files(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* files(filename);
    else if (entry.isFile()) yield filename;
  }
}

/** Ignore historical build-info: only current production artifacts select compilations. */
export function prepareCurrentBuildInfo(root, destination) {
  const artifactDirectory = path.join(root, "artifacts/contracts");
  if (!fs.existsSync(artifactDirectory))
    throw new Error("Run npm run build before Solidity security checks");
  const productionSources = new Set(
    [...files(path.join(root, "contracts"))]
      .map((filename) => path.relative(root, filename).split(path.sep).join("/"))
      .filter((filename) => filename.endsWith(".sol") && !filename.startsWith("contracts/test/")),
  );
  const buildIds = new Set();
  const references = new Map();
  const coveredSources = new Set();
  for (const filename of files(artifactDirectory)) {
    if (!filename.endsWith(".json")) continue;
    const artifact = json(filename);
    if (!productionSources.has(artifact.sourceName)) continue;
    if (!artifact.contractName || !/^[a-zA-Z0-9_-]+$/.test(artifact.buildInfoId ?? "")) {
      throw new Error(`Missing or invalid build-info reference in ${filename}`);
    }
    buildIds.add(artifact.buildInfoId);
    const group = references.get(artifact.buildInfoId) ?? [];
    group.push(artifact);
    references.set(artifact.buildInfoId, group);
    coveredSources.add(artifact.sourceName);
  }
  for (const relative of productionSources) {
    if (!coveredSources.has(relative)) {
      throw new Error(`No current artifact for ${relative}; run npm run build`);
    }
  }
  if (!buildIds.size) throw new Error("No production contract build-info selected");
  fs.mkdirSync(path.join(destination, "build-info"), { recursive: true });
  for (const id of [...buildIds].sort()) {
    const source = path.join(root, "artifacts/build-info", `${id}.json`);
    const input = json(source);
    const outputFile = path.join(root, "artifacts/build-info", `${id}.output.json`);
    const output = json(outputFile);
    if (
      input.id !== id ||
      output.id !== id ||
      input.solcVersion !== "0.8.28" ||
      input.input?.language !== "Solidity" ||
      !Object.keys(input.userSourceNameMap ?? {}).length
    ) {
      throw new Error(`Invalid compiler input/output pair ${id}`);
    }
    for (const artifact of references.get(id)) {
      const inputSource = input.userSourceNameMap[artifact.sourceName];
      if (!inputSource || !output.output?.contracts?.[inputSource]?.[artifact.contractName]) {
        throw new Error(
          `Compiler output does not cover ${artifact.sourceName}:${artifact.contractName}`,
        );
      }
    }
    for (const [userSource, inputSource] of Object.entries(input.userSourceNameMap ?? {})) {
      if (!userSource.startsWith("contracts/")) continue;
      const content = input.input?.sources?.[inputSource]?.content;
      if (
        !fs.existsSync(path.join(root, userSource)) ||
        content !== fs.readFileSync(path.join(root, userSource), "utf8")
      ) {
        throw new Error(`Stale compiler input for ${userSource}; run npm run build`);
      }
    }
    fs.copyFileSync(source, path.join(destination, "build-info", `${id}.json`));
    fs.copyFileSync(outputFile, path.join(destination, "build-info", `${id}.output.json`));
  }
  return { compilations: buildIds.size, sources: [...coveredSources].sort() };
}

/** A successful parser exit must also prove that all selected sources were analyzed. */
export function assertSlitherCoverage(report, expectedSources) {
  if (
    !Number.isSafeInteger(report.analysis?.contracts) ||
    report.analysis.contracts < 1 ||
    report.analysis.detectors !== 102 ||
    report.analysis.hashSeed !== "0" ||
    report.analysis.callOrder !== "source-position-v1" ||
    !Array.isArray(report.analysis.sources) ||
    expectedSources.some((source) => !report.analysis.sources.includes(source))
  )
    throw new Error(
      "Slither analysis did not cover every current production source with all detectors",
    );
}

/** Exact-ID reviews expire when any source involved in the finding changes. */
export function assertBaselineSources(baseline, root) {
  if (
    !baseline.sourceSha256 ||
    typeof baseline.sourceSha256 !== "object" ||
    !Array.isArray(baseline.findings)
  )
    throw new Error("Missing reviewed Slither source snapshots");
  const reviewedSources = new Set();
  for (const finding of baseline.findings) {
    if (!Array.isArray(finding.sources) || finding.sources.length === 0)
      throw new Error(`Missing reviewed source paths for ${finding.id}`);
    for (const source of finding.sources) reviewedSources.add(source);
  }
  if (reviewedSources.size !== Object.keys(baseline.sourceSha256).length)
    throw new Error("Slither source snapshots do not match reviewed finding paths");
  for (const source of reviewedSources) {
    const digest = baseline.sourceSha256[source];
    if (
      typeof source !== "string" ||
      !/^(?:contracts|node_modules)\//u.test(source) ||
      source.split("/").some((part) => part === ".." || part === "." || part === "") ||
      source.includes("\\") ||
      !/^[0-9a-f]{64}$/u.test(digest ?? "")
    )
      throw new Error(`Invalid reviewed Slither source snapshot: ${source}`);
    const actual = createHash("sha256")
      .update(fs.readFileSync(path.join(root, source)))
      .digest("hex");
    if (actual !== digest)
      throw new Error(
        `Slither review is stale for ${source}; review the changed source before updating its baseline`,
      );
  }
}

/** Tool failures and unreviewed High/Medium findings fail closed. */
export function evaluateSlitherReport(report, baseline) {
  if (
    report.success !== true ||
    report.error ||
    !report.results ||
    typeof report.results !== "object" ||
    (report.results.detectors !== undefined && !Array.isArray(report.results.detectors))
  ) {
    throw new Error(
      `Slither did not finish successfully: ${report.error || "missing detector results"}`,
    );
  }
  if (
    baseline.version !== 1 ||
    baseline.slitherVersion !== SLITHER_VERSION ||
    !Array.isArray(baseline.findings)
  ) {
    throw new Error("Invalid or outdated Slither baseline");
  }
  // Slither omits the detector key for a successful scan with no findings.
  const findings = [
    ...new Map(
      (report.results.detectors ?? []).map((finding) => {
        if (
          typeof finding.id !== "string" ||
          !finding.id ||
          typeof finding.check !== "string" ||
          !finding.check ||
          !IMPACTS.has(finding.impact)
        ) {
          throw new Error("Malformed Slither finding");
        }
        return [finding.id, finding];
      }),
    ).values(),
  ];
  const reviewed = new Map();
  for (const entry of baseline.findings) {
    if (
      !entry.id ||
      !entry.check ||
      !BLOCKING_IMPACTS.has(entry.impact) ||
      typeof entry.reason !== "string" ||
      entry.reason.trim().length < 30 ||
      reviewed.has(entry.id)
    ) {
      throw new Error(
        "Each baseline entry needs one exact finding ID, detector, severity and review rationale",
      );
    }
    reviewed.set(entry.id, entry);
  }
  const unexpected = [];
  const counts = {};
  for (const finding of findings) {
    counts[finding.impact] = (counts[finding.impact] ?? 0) + 1;
    const entry = reviewed.get(finding.id);
    if (entry) {
      if (entry.check !== finding.check || entry.impact !== finding.impact)
        throw new Error(`Baseline metadata changed: ${finding.id}`);
      reviewed.delete(finding.id);
    } else if (BLOCKING_IMPACTS.has(finding.impact)) unexpected.push(finding);
  }
  if (reviewed.size)
    throw new Error(`Remove obsolete Slither baseline entries: ${[...reviewed.keys()].join(", ")}`);
  return { findings, counts, unexpected };
}

export function main() {
  const executable = process.env.SOLIDITY_SECURITY_PYTHON || "python3";
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-slither-"));
  const reportDirectory = path.join(ROOT, "artifacts/security");
  const reportPath = path.join(reportDirectory, "slither.json");
  try {
    const selected = prepareCurrentBuildInfo(ROOT, directory);
    fs.mkdirSync(reportDirectory, { recursive: true });
    fs.rmSync(reportPath, { force: true });
    console.log(
      `[solidity-security] ${selected.sources.length} sources; ${selected.compilations} current compilations`,
    );
    const result = spawnSync(
      executable,
      [path.join(ROOT, "scripts/lib/runSlither.py"), ROOT, directory, reportPath],
      {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 300_000,
        maxBuffer: 32 * 1024 * 1024,
        // Some detector paths iterate Python sets before computing their finding IDs.
        env: { ...process.env, PYTHONHASHSEED: "0" },
      },
    );
    if (result.error || result.status !== 0 || !fs.existsSync(reportPath)) {
      throw new Error(
        `Slither execution failed: ${result.error?.message || result.stderr || result.stdout}`,
      );
    }
    const report = json(reportPath);
    assertSlitherCoverage(report, selected.sources);
    console.log(
      `[solidity-security] analyzed ${report.analysis.contracts} contracts with ${report.analysis.detectors} detectors`,
    );
    const baseline = json(path.join(ROOT, "security/slither-baseline.json"));
    assertBaselineSources(baseline, ROOT);
    const evaluated = evaluateSlitherReport(report, baseline);
    console.log(
      `[solidity-security] findings: ${JSON.stringify(evaluated.counts)}; reviewed High/Medium: ${baseline.findings.length}`,
    );
    console.log(`[solidity-security] full report: ${path.relative(ROOT, reportPath)}`);
    for (const finding of evaluated.unexpected)
      console.error(`[${finding.impact}] ${finding.check}: ${finding.description}`);
    if (evaluated.unexpected.length)
      throw new Error(`${evaluated.unexpected.length} unreviewed High/Medium findings`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[solidity-security] ${error.message}`);
    process.exitCode = 1;
  }
}
