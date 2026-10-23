import { expect } from "chai";

import {
  RELEASE_CHECK_BOUNDARY_ENV,
  RELEASE_CHECK_BOUNDARY_FIELDS,
  assertReleaseCheckBoundary,
  bindReleaseCheckBoundary,
  withoutReleaseCheckBoundaryEnvironment,
} from "../scripts/lib/releaseCheckBoundary.mjs";

const result = Object.freeze({
  status: "checks-passed",
  releaseCommit: "a".repeat(40),
  zkManifestSha256: "b".repeat(64),
  zkTranscriptSha256: "c".repeat(64),
  protocolManifestSha256: "d".repeat(64),
  receiveManifestSha256: "e".repeat(64),
});
const actual = Object.freeze(
  Object.fromEntries(RELEASE_CHECK_BOUNDARY_FIELDS.map((field) => [field, result[field]])),
);
const boundary = Object.freeze({ schemaVersion: 1, ...result });

describe("release check boundary", function () {
  it("binds only successful check inputs and keeps unrelated environment values", function () {
    const environment = bindReleaseCheckBoundary({
      environment: {
        PRESERVED: "value",
        [RELEASE_CHECK_BOUNDARY_ENV]: "untrusted evidence",
        [RELEASE_CHECK_BOUNDARY_ENV.toLowerCase()]: "duplicate evidence",
      },
      result: { ...result, checks: ["contracts:check"], unrelated: "not transported" },
    });
    expect(environment).to.deep.equal({
      PRESERVED: "value",
      [RELEASE_CHECK_BOUNDARY_ENV]: JSON.stringify(boundary),
    });
    expect(Object.isFrozen(environment)).to.equal(true);
    expect(assertReleaseCheckBoundary({ environment, actual })).to.deep.equal(boundary);
  });

  it("removes old evidence case-insensitively without modifying the caller's environment", function () {
    const environment = {
      PATH: "/trusted/bin",
      [RELEASE_CHECK_BOUNDARY_ENV]: "stale",
      [RELEASE_CHECK_BOUNDARY_ENV.toLowerCase()]: "also stale",
    };
    expect(withoutReleaseCheckBoundaryEnvironment(environment)).to.deep.equal({
      PATH: "/trusted/bin",
    });
    expect(environment[RELEASE_CHECK_BOUNDARY_ENV]).to.equal("stale");
  });

  for (const field of RELEASE_CHECK_BOUNDARY_FIELDS) {
    it(`rejects a ${field} change between checked inputs and the final process`, function () {
      const environment = bindReleaseCheckBoundary({ environment: {}, result });
      expect(() =>
        assertReleaseCheckBoundary({
          environment,
          actual: { ...actual, [field]: "f".repeat(field === "releaseCommit" ? 40 : 64) },
        }),
      ).to.throw(`${field} changed after release checks`);
    });
  }

  it("does not treat missing or forged success statuses as a passed check result", function () {
    for (const invalid of [
      undefined,
      null,
      [],
      { ...result, status: undefined },
      { ...result, status: "passed" },
      { ...result, status: "failed" },
      { ...result, status: true },
      { ...result, status: "production" },
      Object.create(result),
    ]) {
      expect(() => bindReleaseCheckBoundary({ environment: {}, result: invalid })).to.throw(
        "checks-passed evidence",
      );
    }
  });

  it("rejects incomplete check results and malformed digest values", function () {
    for (const field of RELEASE_CHECK_BOUNDARY_FIELDS) {
      const incomplete = { ...result };
      delete incomplete[field];
      expect(() => bindReleaseCheckBoundary({ environment: {}, result: incomplete })).to.throw(
        field,
      );
      for (const value of ["", "0x12", "A".repeat(field === "releaseCommit" ? 40 : 64), 123]) {
        expect(() =>
          bindReleaseCheckBoundary({ environment: {}, result: { ...result, [field]: value } }),
        ).to.throw(field);
      }
    }
  });

  it("rejects missing, empty or ambiguous child evidence", function () {
    for (const environment of [
      {},
      { [RELEASE_CHECK_BOUNDARY_ENV]: "" },
      { [RELEASE_CHECK_BOUNDARY_ENV]: undefined },
      {
        [RELEASE_CHECK_BOUNDARY_ENV]: JSON.stringify(boundary),
        [RELEASE_CHECK_BOUNDARY_ENV.toLowerCase()]: JSON.stringify(boundary),
      },
    ]) {
      expect(() => assertReleaseCheckBoundary({ environment, actual })).to.throw(
        "missing or ambiguous",
      );
    }
  });

  it("rejects invalid JSON, schema, statuses, duplicate keys and unexpected fields", function () {
    for (const raw of [
      "not JSON",
      "null",
      "[]",
      JSON.stringify({ ...boundary, schemaVersion: 2 }),
      JSON.stringify({ ...boundary, status: "passed" }),
      JSON.stringify({ ...boundary, status: "failed" }),
      JSON.stringify({ ...boundary, skipCeremony: true }),
      JSON.stringify({ ...boundary, zkManifestSha256: "invalid" }),
      `{"status":"failed",${JSON.stringify(boundary).slice(1)}`,
    ]) {
      expect(() =>
        assertReleaseCheckBoundary({ environment: { [RELEASE_CHECK_BOUNDARY_ENV]: raw }, actual }),
      ).to.throw(/Release check boundary/u);
    }
    const incomplete = { ...boundary };
    delete incomplete.zkTranscriptSha256;
    expect(() =>
      assertReleaseCheckBoundary({
        environment: { [RELEASE_CHECK_BOUNDARY_ENV]: JSON.stringify(incomplete) },
        actual,
      }),
    ).to.throw(/Release check boundary/u);
  });

  it("requires independently inspected current inputs instead of trusting only the boundary", function () {
    const environment = bindReleaseCheckBoundary({ environment: {}, result });
    expect(() => assertReleaseCheckBoundary({ environment })).to.throw("Current release inputs");
    const missing = { ...actual };
    delete missing.releaseCommit;
    expect(() => assertReleaseCheckBoundary({ environment, actual: missing })).to.throw(
      "releaseCommit",
    );
  });
});
