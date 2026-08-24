#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { normalizePortableCommand } from "./lib/portableCommand.mjs";

const ELLIPTIC_ADVISORY = Object.freeze({
  source: 1112030,
  name: "elliptic",
  dependency: "elliptic",
  title: "Elliptic Uses a Cryptographic Primitive with a Risky Implementation",
  url: "https://github.com/advisories/GHSA-848j-6mx2-7j84",
  severity: "low",
  cwe: Object.freeze(["CWE-1240"]),
  cvss: Object.freeze({
    score: 5.6,
    vectorString: "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:L",
  }),
  range: "<=6.6.1",
});

const vulnerability = ({
  version,
  severity,
  isDirect,
  via,
  effects,
  range,
  nodes,
  fixAvailable = false,
}) =>
  Object.freeze({
    version,
    audit: Object.freeze({
      severity,
      isDirect,
      via: Object.freeze(via),
      effects: Object.freeze(effects),
      range,
      nodes: Object.freeze(nodes),
      fixAvailable: Object.freeze(fixAvailable),
    }),
  });

const EXPECTED_VULNERABILITIES = Object.freeze({
  "@ethersproject/abi": vulnerability({
    version: "5.8.0",
    severity: "low",
    isDirect: false,
    via: ["@ethersproject/hash"],
    effects: ["@nomicfoundation/hardhat-verify"],
    range: "5.0.10 - 5.8.0",
    nodes: ["node_modules/@ethersproject/abi"],
  }),
  "@ethersproject/abstract-provider": vulnerability({
    version: "5.8.0",
    severity: "low",
    isDirect: false,
    via: ["@ethersproject/transactions"],
    effects: ["@ethersproject/abstract-signer"],
    range: "*",
    nodes: ["node_modules/@ethersproject/abstract-provider"],
  }),
  "@ethersproject/abstract-signer": vulnerability({
    version: "5.8.0",
    severity: "low",
    isDirect: false,
    via: ["@ethersproject/abstract-provider"],
    effects: ["@ethersproject/hash"],
    range: "*",
    nodes: ["node_modules/@ethersproject/abstract-signer"],
  }),
  "@ethersproject/hash": vulnerability({
    version: "5.8.0",
    severity: "low",
    isDirect: false,
    via: ["@ethersproject/abstract-signer"],
    effects: ["@ethersproject/abi"],
    range: "5.0.6 - 5.8.0",
    nodes: ["node_modules/@ethersproject/hash"],
  }),
  "@ethersproject/signing-key": vulnerability({
    version: "5.8.0",
    severity: "low",
    isDirect: false,
    via: ["elliptic"],
    effects: ["@ethersproject/transactions"],
    range: "<=5.8.0",
    nodes: ["node_modules/@ethersproject/signing-key"],
  }),
  "@ethersproject/transactions": vulnerability({
    version: "5.8.0",
    severity: "low",
    isDirect: false,
    via: ["@ethersproject/signing-key"],
    effects: ["@ethersproject/abstract-provider"],
    range: "<=5.8.0",
    nodes: ["node_modules/@ethersproject/transactions"],
  }),
  "@nomicfoundation/hardhat-verify": vulnerability({
    version: "3.0.22",
    severity: "low",
    isDirect: true,
    via: ["@ethersproject/abi"],
    effects: [],
    range: "*",
    nodes: ["node_modules/@nomicfoundation/hardhat-verify"],
  }),
  "@openzeppelin/upgrades-core": vulnerability({
    version: "1.46.0",
    severity: "low",
    isDirect: true,
    via: ["ethereumjs-util"],
    effects: [],
    range: "*",
    nodes: ["node_modules/@openzeppelin/upgrades-core"],
  }),
  elliptic: vulnerability({
    version: "6.6.1",
    severity: "low",
    isDirect: false,
    via: [ELLIPTIC_ADVISORY],
    effects: ["@ethersproject/signing-key", "secp256k1"],
    range: "*",
    nodes: ["node_modules/elliptic"],
  }),
  "ethereum-cryptography": vulnerability({
    version: "0.1.3",
    severity: "low",
    isDirect: false,
    via: ["secp256k1"],
    effects: ["ethereumjs-util"],
    range: "0.1.0 - 0.1.3",
    nodes: ["node_modules/ethereumjs-util/node_modules/ethereum-cryptography"],
  }),
  "ethereumjs-util": vulnerability({
    version: "7.1.5",
    severity: "low",
    isDirect: false,
    via: ["ethereum-cryptography"],
    effects: ["@openzeppelin/upgrades-core"],
    range: "4.5.1 || 5.2.1 || 6.2.1 || >=7.0.3",
    nodes: ["node_modules/ethereumjs-util"],
  }),
  secp256k1: vulnerability({
    version: "4.0.4",
    severity: "low",
    isDirect: false,
    via: ["elliptic"],
    effects: ["ethereum-cryptography"],
    range: ">=2.0.0",
    nodes: ["node_modules/secp256k1"],
  }),
});

/**
 * These are narrow, temporary exceptions rather than a severity threshold. Any different
 * advisory, package version, node path, dependency edge, severity, range, or proposed fix fails.
 */
export const NPM_AUDIT_POLICY = Object.freeze({
  schemaVersion: 1,
  reviewedAt: "2026-08-04",
  reviewBy: "2026-11-04",
  advisories: Object.freeze({
    1112030: Object.freeze({
      ghsa: "GHSA-848j-6mx2-7j84",
      package: "elliptic",
      rationale:
        "Upstream has no patched release. The two locked paths are tooling-only ABI/storage " +
        "analysis paths; direct imports of the affected crypto packages are prohibited.",
    }),
  }),
  vulnerabilities: EXPECTED_VULNERABILITIES,
});

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const sortStrings = (values) => [...values].sort((left, right) => left.localeCompare(right));

const normalizeAdvisory = (advisory) => ({
  source: advisory?.source,
  name: advisory?.name,
  dependency: advisory?.dependency,
  title: advisory?.title,
  url: advisory?.url,
  severity: advisory?.severity,
  cwe: Array.isArray(advisory?.cwe) ? sortStrings(advisory.cwe) : advisory?.cwe,
  cvss: isPlainObject(advisory?.cvss)
    ? {
        score: advisory.cvss.score,
        vectorString: advisory.cvss.vectorString,
      }
    : advisory?.cvss,
  range: advisory?.range,
});

const normalizeVia = (via) => {
  if (!Array.isArray(via)) return via;
  return via
    .map((item) => (typeof item === "string" ? item : normalizeAdvisory(item)))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
};

const normalizeFixAvailable = (fixAvailable) => {
  if (fixAvailable === false) return false;
  if (!isPlainObject(fixAvailable)) return fixAvailable;
  return {
    name: fixAvailable.name,
    version: fixAvailable.version,
    isSemVerMajor: fixAvailable.isSemVerMajor,
  };
};

const normalizeVulnerability = (entry) => ({
  severity: entry?.severity,
  isDirect: entry?.isDirect,
  via: normalizeVia(entry?.via),
  effects: Array.isArray(entry?.effects) ? sortStrings(entry.effects) : entry?.effects,
  range: entry?.range,
  nodes: Array.isArray(entry?.nodes) ? sortStrings(entry.nodes) : entry?.nodes,
  fixAvailable: normalizeFixAvailable(entry?.fixAvailable),
});

const parsePolicyDate = (value, field) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new Error(`npm audit exception ${field} must use YYYY-MM-DD`);
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`npm audit exception ${field} is not a valid date`);
  }
  return parsed;
};

const assertPolicyCurrent = ({ policy, now }) => {
  if (policy.schemaVersion !== 1) {
    throw new Error("npm audit exception policy requires schemaVersion 1");
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("npm audit exception evaluation time is invalid");
  }
  const reviewedAt = parsePolicyDate(policy.reviewedAt, "reviewedAt");
  const reviewBy = parsePolicyDate(policy.reviewBy, "reviewBy");
  if (reviewedAt.getTime() > reviewBy.getTime()) {
    throw new Error("npm audit exception reviewedAt must not follow reviewBy");
  }
  const deadline = new Date(reviewBy.getTime());
  deadline.setUTCDate(deadline.getUTCDate() + 1);
  if (now.getTime() >= deadline.getTime()) {
    throw new Error(
      `npm audit exception policy expired after ${policy.reviewBy}; review or remove every exception`,
    );
  }
};

const defaultInstalledPackageReader = ({ root, nodePath }) => {
  if (
    typeof nodePath !== "string" ||
    path.isAbsolute(nodePath) ||
    nodePath.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error(`npm audit returned an unsafe node path: ${String(nodePath)}`);
  }
  const projectRoot = path.resolve(root);
  const manifestPath = path.resolve(projectRoot, ...nodePath.split("/"), "package.json");
  if (!manifestPath.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`npm audit node path escapes the project root: ${nodePath}`);
  }
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
};

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const CRYPTO_MODULES = new Set([
  "elliptic",
  "secp256k1",
  "ethereumjs-util",
  "ethereum-cryptography",
  "@ethersproject/abstract-provider",
  "@ethersproject/abstract-signer",
  "@ethersproject/hash",
  "@ethersproject/signing-key",
  "@ethersproject/transactions",
]);
const MODULE_REFERENCE_PATTERN =
  /\b(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)["']([^"']+)["']/gu;

const collectSourceFiles = (root, relativePath) => {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  if (!fs.existsSync(absolutePath)) return [];
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`npm audit reachability source is a symbolic link: ${relativePath}`);
  }
  if (stat.isFile()) return SOURCE_EXTENSIONS.has(path.extname(absolutePath)) ? [relativePath] : [];
  if (!stat.isDirectory()) return [];

  return fs
    .readdirSync(absolutePath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => collectSourceFiles(root, `${relativePath}/${entry.name}`));
};

const sourceModuleReferences = (source) =>
  [...source.matchAll(MODULE_REFERENCE_PATTERN)].map((match) => match[1]);

export const inspectAuditExceptionReachability = ({ root = process.cwd() } = {}) => {
  const projectRoot = path.resolve(root);
  const sourceFiles = [
    ...collectSourceFiles(projectRoot, "frontend/src"),
    ...collectSourceFiles(projectRoot, "frontend/vite.config.ts"),
    ...collectSourceFiles(projectRoot, "scripts"),
    ...collectSourceFiles(projectRoot, "tasks"),
    ...collectSourceFiles(projectRoot, "hardhat"),
    ...collectSourceFiles(projectRoot, "packages"),
    ...collectSourceFiles(projectRoot, "hardhat.config.mjs"),
  ];
  const cryptoImports = [];

  for (const relativePath of sourceFiles) {
    const source = fs.readFileSync(path.join(projectRoot, ...relativePath.split("/")), "utf8");
    for (const moduleName of sourceModuleReferences(source)) {
      if (CRYPTO_MODULES.has(moduleName)) cryptoImports.push(`${relativePath}: ${moduleName}`);
    }
  }

  return {
    cryptoImports: sortStrings(new Set(cryptoImports)),
  };
};

const assertExceptionReachability = ({ vulnerabilities, inspectReachability }) => {
  const inspection = inspectReachability();
  if (vulnerabilities.elliptic && inspection.cryptoImports.length > 0) {
    throw new Error(
      `elliptic exception is no longer tooling-only; prohibited import(s): ${inspection.cryptoImports.join(
        ", ",
      )}`,
    );
  }
};

const assertAuditMetadata = (report, vulnerabilities) => {
  const expectedCounts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const entry of Object.values(vulnerabilities)) {
    if (!(entry.severity in expectedCounts) || entry.severity === "total") {
      throw new Error(`npm audit returned an unknown severity: ${String(entry.severity)}`);
    }
    expectedCounts[entry.severity] += 1;
    expectedCounts.total += 1;
  }
  if (!isDeepStrictEqual(report.metadata?.vulnerabilities, expectedCounts)) {
    throw new Error("npm audit vulnerability metadata does not match its vulnerability graph");
  }
};

export const evaluateNpmAuditReport = ({
  report,
  root = process.cwd(),
  now = new Date(),
  policy = NPM_AUDIT_POLICY,
  installedPackageReader = defaultInstalledPackageReader,
  inspectReachability = () => inspectAuditExceptionReachability({ root }),
} = {}) => {
  if (!isPlainObject(report) || report.auditReportVersion !== 2) {
    throw new Error("npm audit did not return a supported auditReportVersion 2 report");
  }
  if (!isPlainObject(report.vulnerabilities)) {
    throw new Error("npm audit report is missing its vulnerability graph");
  }
  const vulnerabilities = report.vulnerabilities;
  assertAuditMetadata(report, vulnerabilities);
  const actualNames = sortStrings(Object.keys(vulnerabilities));
  if (actualNames.length === 0) {
    return Object.freeze({
      clean: true,
      vulnerabilityCount: 0,
      advisorySources: Object.freeze([]),
    });
  }

  assertPolicyCurrent({ policy, now });
  const expectedNames = sortStrings(Object.keys(policy.vulnerabilities));
  if (!isDeepStrictEqual(actualNames, expectedNames)) {
    const unexpected = actualNames.filter((name) => !expectedNames.includes(name));
    const missing = expectedNames.filter((name) => !actualNames.includes(name));
    throw new Error(
      `npm audit vulnerability set changed (unexpected: ${unexpected.join(", ") || "none"}; ` +
        `missing: ${missing.join(", ") || "none"})`,
    );
  }

  const advisorySources = new Set();
  for (const name of actualNames) {
    if (vulnerabilities[name]?.name !== name) {
      throw new Error(`npm audit vulnerability entry name changed for ${name}`);
    }
    const actual = normalizeVulnerability(vulnerabilities[name]);
    const expected = normalizeVulnerability(policy.vulnerabilities[name].audit);
    if (!isDeepStrictEqual(actual, expected)) {
      throw new Error(`npm audit vulnerability graph changed for ${name}`);
    }
    for (const via of actual.via) {
      if (typeof via !== "string") {
        const metadata = policy.advisories[via.source];
        if (
          !metadata ||
          via.name !== metadata.package ||
          via.url !== `https://github.com/advisories/${metadata.ghsa}`
        ) {
          throw new Error(`npm audit advisory ${String(via.source)} metadata changed`);
        }
        advisorySources.add(via.source);
      }
    }
    for (const nodePath of actual.nodes) {
      const installed = installedPackageReader({ root, nodePath });
      if (installed?.name !== name || installed?.version !== policy.vulnerabilities[name].version) {
        throw new Error(
          `npm audit node ${nodePath} must be ${name}@${policy.vulnerabilities[name].version}, ` +
            `found ${String(installed?.name)}@${String(installed?.version)}`,
        );
      }
    }
  }

  const expectedSources = Object.keys(policy.advisories)
    .map(Number)
    .sort((a, b) => a - b);
  const actualSources = [...advisorySources].sort((a, b) => a - b);
  if (!isDeepStrictEqual(actualSources, expectedSources)) {
    throw new Error("npm audit advisory source set changed");
  }
  for (const source of actualSources) {
    const metadata = policy.advisories[source];
    if (!metadata || !metadata.ghsa || !metadata.package || !metadata.rationale) {
      throw new Error(`npm audit advisory ${source} lacks reviewed exception metadata`);
    }
  }
  assertExceptionReachability({ vulnerabilities, inspectReachability });

  return Object.freeze({
    clean: false,
    vulnerabilityCount: actualNames.length,
    advisorySources: Object.freeze(actualSources),
    reviewBy: policy.reviewBy,
  });
};

const buildAuditEnvironment = (env) =>
  Object.fromEntries(
    Object.entries(env).filter(
      ([name]) => !/^npm_config_(?:audit_level|omit|include)$/iu.test(name),
    ),
  );

export const defaultAuditRunner = ({
  root,
  platform = process.platform,
  env = process.env,
} = {}) => {
  const args = [
    "audit",
    "--json",
    "--include=prod",
    "--include=dev",
    "--include=optional",
    "--include=peer",
  ];
  const auditEnvironment = buildAuditEnvironment(env);
  const command = normalizePortableCommand({
    executable: "npm",
    args,
    platform,
    env: auditEnvironment,
  });
  return spawnSync(command.executable, command.args, {
    cwd: root,
    env: auditEnvironment,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
};

export const runNpmAuditPolicy = ({
  root = process.cwd(),
  stdout = (line) => console.log(line),
  auditRunner = defaultAuditRunner,
  ...evaluationOptions
} = {}) => {
  const result = auditRunner({ root });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`npm audit was terminated by ${result.signal}`);
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `npm audit failed with exit code ${String(result.status)}: ${String(result.stderr).trim()}`,
    );
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error("npm audit did not return valid JSON");
  }
  const evaluation = evaluateNpmAuditReport({ report, root, ...evaluationOptions });
  if (evaluation.clean) {
    stdout("npm audit policy passed: no vulnerabilities found.");
  } else {
    const exceptionLabel = evaluation.advisorySources.length === 1 ? "exception" : "exceptions";
    stdout(
      `npm audit policy passed: ${evaluation.vulnerabilityCount} vulnerable package(s) are ` +
        `limited to ${evaluation.advisorySources.length} reviewed advisory ${exceptionLabel}; ` +
        `review by ${evaluation.reviewBy}.`,
    );
  }
  return evaluation;
};

export const main = () => {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/check-npm-audit.mjs");
  runNpmAuditPolicy();
};

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    console.error(`[npm-audit-policy] ${error.message}`);
    process.exitCode = 1;
  }
}
