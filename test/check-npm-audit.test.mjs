import { expect } from "chai";

import {
  NPM_AUDIT_POLICY,
  evaluateNpmAuditReport,
  runNpmAuditPolicy,
} from "../scripts/check-npm-audit.mjs";

const clone = (value) => structuredClone(value);

const vulnerabilityMetadataFor = (vulnerabilities) => {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const vulnerability of Object.values(vulnerabilities)) {
    counts[vulnerability.severity] += 1;
    counts.total += 1;
  }
  return counts;
};

const reportFromPolicy = () => {
  const vulnerabilities = Object.fromEntries(
    Object.entries(NPM_AUDIT_POLICY.vulnerabilities).map(([name, expected]) => [
      name,
      { name, ...clone(expected.audit) },
    ]),
  );
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: vulnerabilityMetadataFor(vulnerabilities),
      dependencies: { prod: 1, dev: 1, optional: 0, peer: 0, peerOptional: 0, total: 2 },
    },
  };
};

const cleanReport = () => ({
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
    dependencies: { prod: 1, dev: 1, optional: 0, peer: 0, peerOptional: 0, total: 2 },
  },
});

const installedPackageReader = ({ nodePath }) => {
  for (const [name, expected] of Object.entries(NPM_AUDIT_POLICY.vulnerabilities)) {
    if (expected.audit.nodes.includes(nodePath)) return { name, version: expected.version };
  }
  throw new Error(`unexpected fixture node ${nodePath}`);
};

const unreachableInspection = () => ({
  reactVersion: "18.3.1",
  reactDomVersion: "18.3.1",
  viteBuild: true,
  cryptoImports: [],
  routerRscReferences: [],
});

const evaluate = (report, options = {}) =>
  evaluateNpmAuditReport({
    report,
    now: new Date("2026-08-04T12:00:00.000Z"),
    installedPackageReader,
    inspectReachability: unreachableInspection,
    ...options,
  });

const expectFailure = (operation, pattern) => {
  expect(operation).to.throw(pattern);
};

describe("exact npm audit exception policy", function () {
  it("accepts only the reviewed residual graph and reports both advisory sources", function () {
    const result = evaluate(reportFromPolicy());

    expect(result).to.deep.equal({
      clean: false,
      vulnerabilityCount: 14,
      advisorySources: [1112030, 1124282],
      reviewBy: "2026-11-04",
    });
  });

  it("accepts a clean audit without relying on an expired exception", function () {
    const result = evaluate(cleanReport(), { now: new Date("2030-01-01T00:00:00.000Z") });

    expect(result).to.deep.equal({
      clean: true,
      vulnerabilityCount: 0,
      advisorySources: [],
    });
  });

  it("fails closed when the reviewed exception expires", function () {
    expectFailure(
      () => evaluate(reportFromPolicy(), { now: new Date("2026-11-05T00:00:00.000Z") }),
      /exception policy expired after 2026-11-04/u,
    );
  });

  it("rejects a new advisory even when it affects an already reviewed package", function () {
    const report = reportFromPolicy();
    report.vulnerabilities.elliptic.via[0].source = 9999999;
    report.vulnerabilities.elliptic.via[0].url =
      "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz";

    expectFailure(() => evaluate(report), /vulnerability graph changed for elliptic/u);
  });

  it("rejects dependency-path and installed-version drift", function () {
    const moved = reportFromPolicy();
    moved.vulnerabilities.elliptic.nodes = ["node_modules/tool/node_modules/elliptic"];
    expectFailure(() => evaluate(moved), /vulnerability graph changed for elliptic/u);

    const wrongVersionReader = ({ nodePath }) => {
      const installed = installedPackageReader({ nodePath });
      return installed.name === "elliptic" ? { ...installed, version: "6.6.2" } : installed;
    };
    expectFailure(
      () => evaluate(reportFromPolicy(), { installedPackageReader: wrongVersionReader }),
      /node_modules\/elliptic must be elliptic@6\.6\.1, found elliptic@6\.6\.2/u,
    );
  });

  it("rejects malformed vulnerability counts instead of trusting npm metadata", function () {
    const report = reportFromPolicy();
    report.metadata.vulnerabilities.high = 1;

    expectFailure(() => evaluate(report), /metadata does not match its vulnerability graph/u);
  });

  it("invalidates the elliptic exception if affected crypto becomes directly imported", function () {
    expectFailure(
      () =>
        evaluate(reportFromPolicy(), {
          inspectReachability: () => ({
            ...unreachableInspection(),
            cryptoImports: ["scripts/sign.mjs: elliptic"],
          }),
        }),
      /elliptic exception is no longer tooling-only/u,
    );
  });

  it("invalidates the React Router exception when the app can enter RSC mode", function () {
    expectFailure(
      () =>
        evaluate(reportFromPolicy(), {
          inspectReachability: () => ({
            ...unreachableInspection(),
            reactVersion: "19.2.7",
            reactDomVersion: "19.2.7",
          }),
        }),
      /requires matching React 18\/React DOM 18 and a Vite SPA build/u,
    );
    expectFailure(
      () =>
        evaluate(reportFromPolicy(), {
          inspectReachability: () => ({
            ...unreachableInspection(),
            routerRscReferences: ["frontend/src/server.tsx: unstable_matchRSCServerRequest"],
          }),
        }),
      /unreachable only without RSC references/u,
    );
  });

  it("runs the JSON audit gate and emits a concise reviewed-exception result", function () {
    const stdout = [];
    const result = runNpmAuditPolicy({
      root: "/fixture",
      stdout: (line) => stdout.push(line),
      auditRunner: () => ({ status: 1, signal: null, stdout: JSON.stringify(reportFromPolicy()) }),
      now: new Date("2026-08-04T12:00:00.000Z"),
      installedPackageReader,
      inspectReachability: unreachableInspection,
    });

    expect(result.vulnerabilityCount).to.equal(14);
    expect(stdout).to.deep.equal([
      "npm audit policy passed: 14 vulnerable package(s) are limited to 2 reviewed advisory " +
        "exception(s); review by 2026-11-04.",
    ]);
  });
});
