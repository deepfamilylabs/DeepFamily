import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect } from "chai";

import {
  KDF_ATTACKER_STUDY_EVIDENCE_TYPE,
  KDF_BASELINE_CANDIDATE,
  KDF_DEVICE_MATRIX_EVIDENCE_TYPE,
  KDF_MINIMUM_STRESS_DURATION_SECONDS,
  buildKdfAttackerStudyV2Template,
  buildKdfDeviceMatrixV2Template,
  canonicalKdfEvidenceJson,
  validateKdfAttackerStudyV2Evidence,
  validateKdfDeviceMatrixV2Evidence,
} from "../scripts/lib/kdfReleaseEvidence.mjs";
import {
  buildKdfReleaseEvidenceTemplate,
  parseKdfReleaseEvidenceTemplateArguments,
} from "../scripts/kdf-release-evidence-template.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const TEMPLATE_SCRIPT = path.join(ROOT, "scripts/kdf-release-evidence-template.mjs");

const manifestFixture = () => ({
  protocol: "deepfamily/onchain-biography-unified-passphrase-v1",
  protocolGeneration: "df-onchain-biography-v1",
  identitySuites: { 1: { kdf: structuredClone(KDF_BASELINE_CANDIDATE) } },
  fileKdfSuites: { 1: { kdf: structuredClone(KDF_BASELINE_CANDIDATE) } },
  releaseEvidence: {
    kdfDeviceMatrix: {
      latencyBudgets: {
        identitySingleDerivationP95Milliseconds: null,
        fileSingleDerivationP95Milliseconds: null,
        completeAddVersionP95Milliseconds: null,
        serialUnlock: { versionCount: null, p95Milliseconds: null },
      },
      stressRequirements: {
        minimumDurationSeconds: KDF_MINIMUM_STRESS_DURATION_SECONDS,
        minimumIterations: null,
      },
    },
    kdfAttackerCostStudy: { selectedCandidateId: null },
  },
});

const productionBindingFixture = () => {
  const manifest = manifestFixture();
  const selectedCandidateId = "argon2id-m65536-t3-p1-baseline";
  const latencyBudgets = {
    identitySingleDerivationP95Milliseconds: 300,
    fileSingleDerivationP95Milliseconds: 300,
    completeAddVersionP95Milliseconds: 2_000,
    serialUnlock: { versionCount: 3, p95Milliseconds: 2_000 },
  };
  const stressRequirements = {
    minimumDurationSeconds: KDF_MINIMUM_STRESS_DURATION_SECONDS,
    minimumIterations: 100,
  };
  const deviceBinding = {
    status: "passed",
    schemaVersion: 2,
    evidenceType: KDF_DEVICE_MATRIX_EVIDENCE_TYPE,
    selectedCandidateId,
    latencyBudgets,
    stressRequirements,
    path: "release-evidence/kdf-device-matrix.json",
    sha256: "0".repeat(64),
  };
  const attackerBinding = {
    status: "passed",
    schemaVersion: 2,
    evidenceType: KDF_ATTACKER_STUDY_EVIDENCE_TYPE,
    selectedCandidateId,
    path: "release-evidence/kdf-attacker-study.json",
    sha256: "1".repeat(64),
  };
  manifest.releaseEvidence = {
    kdfDeviceMatrix: structuredClone(deviceBinding),
    kdfAttackerCostStudy: structuredClone(attackerBinding),
  };
  return { manifest, selectedCandidateId, deviceBinding, attackerBinding };
};

describe("KDF schema-v2 incomplete evidence templates", function () {
  it("emits a device matrix skeleton that cannot claim benchmark success", function () {
    const manifest = manifestFixture();
    manifest.identitySuites["1"].kdf.memoryKiB = 131_072;
    const template = buildKdfDeviceMatrixV2Template(manifest);

    expect(template).to.include({
      schemaVersion: 2,
      evidenceType: KDF_DEVICE_MATRIX_EVIDENCE_TYPE,
      status: "incomplete",
      selectedCandidateId: null,
    });
    expect(template.stressRequirements.minimumDurationSeconds).to.equal(1_800);
    expect(template.environments.map(({ kind }) => kind)).to.deep.equal([
      "minimum-mobile",
      "desktop-browser",
      "worker",
    ]);
    expect(template.environments.every(({ environmentId }) => environmentId === null)).to.equal(
      true,
    );
    expect(template.candidates[0].kdf).to.deep.equal(KDF_BASELINE_CANDIDATE);
    expect(template.candidates[0].environmentResults).to.deep.equal([]);
    expect(template.candidates[1].kdf.memoryKiB).to.equal(null);
    expect(template.selection).to.deep.include({
      selectedCandidateId: null,
      allRequiredEnvironmentsReliable: null,
      allRequiredEnvironmentsWithinBudget: null,
    });
  });

  it("emits an attacker-study skeleton without measurements or derived security claims", function () {
    const template = buildKdfAttackerStudyV2Template(manifestFixture());

    expect(template).to.include({
      schemaVersion: 2,
      evidenceType: KDF_ATTACKER_STUDY_EVIDENCE_TYPE,
      status: "incomplete",
      selectedCandidateId: null,
      selectedKdf: null,
    });
    expect(template.profiles.map(({ purpose }) => purpose)).to.deep.equal(["identity", "file"]);
    expect(template.profiles.every(({ implementations }) => implementations.length === 0)).to.equal(
      true,
    );
    expect(template.conclusion).to.deep.equal({
      legitimateAndAttackerCostsSeparated: null,
      doesNotClaimSecurityBits: null,
      doesNotEstimatePasswordCrackingYears: null,
    });
  });

  it("cannot turn a device-matrix template into completed evidence by changing only status", function () {
    const { manifest, deviceBinding } = productionBindingFixture();
    const report = buildKdfDeviceMatrixV2Template(manifest);
    report.status = "passed";

    expect(() =>
      validateKdfDeviceMatrixV2Evidence({
        report,
        manifest,
        manifestBinding: deviceBinding,
        identitySuite: manifest.identitySuites["1"],
        fileSuite: manifest.fileKdfSuites["1"],
      }),
    ).to.throw(/selectedCandidateId is missing/u);
  });

  it("cannot turn an attacker-study template into completed evidence by changing only status", function () {
    const { manifest, selectedCandidateId, attackerBinding } = productionBindingFixture();
    const report = buildKdfAttackerStudyV2Template(manifest);
    report.status = "passed";

    expect(() =>
      validateKdfAttackerStudyV2Evidence({
        report,
        manifest,
        manifestBinding: attackerBinding,
        identitySuite: manifest.identitySuites["1"],
        fileSuite: manifest.fileKdfSuites["1"],
        selectedCandidate: {
          selectedCandidateId,
          selectedKdf: structuredClone(KDF_BASELINE_CANDIDATE),
        },
      }),
    ).to.throw(/attacker selectedKdf is missing/u);
  });

  it("serializes deterministically as canonical two-space JSON with one trailing newline", function () {
    const template = buildKdfDeviceMatrixV2Template(manifestFixture());
    const first = canonicalKdfEvidenceJson(template);
    const second = canonicalKdfEvidenceJson(structuredClone(template));

    expect(first).to.equal(second);
    expect(first.endsWith("\n")).to.equal(true);
    expect(first.endsWith("\n\n")).to.equal(false);
    expect(`${JSON.stringify(JSON.parse(first), null, 2)}\n`).to.equal(first);
  });

  it("parses only an explicit supported evidence kind", function () {
    expect(parseKdfReleaseEvidenceTemplateArguments(["--kind", "device-matrix"])).to.deep.equal({
      kind: "device-matrix",
    });
    expect(parseKdfReleaseEvidenceTemplateArguments(["--kind", "attacker-study"])).to.deep.equal({
      kind: "attacker-study",
    });
    for (const argv of [
      [],
      ["device-matrix"],
      ["--kind", "unknown"],
      ["--kind", "device-matrix", "extra"],
    ]) {
      expect(() => parseKdfReleaseEvidenceTemplateArguments(argv)).to.throw(/Usage:/u);
    }
  });

  it("uses the manifest in read-only, non-production inspection mode", function () {
    const manifest = manifestFixture();
    const calls = [];
    const template = buildKdfReleaseEvidenceTemplate({
      kind: "device-matrix",
      root: "/read-only-fixture",
      manifestInspector: (options) => {
        calls.push(options);
        return { manifest };
      },
    });

    expect(calls).to.deep.equal([{ root: "/read-only-fixture", requireProduction: false }]);
    expect(template.status).to.equal("incomplete");
  });

  for (const kind of ["device-matrix", "attacker-study"]) {
    it(`CLI emits a parseable incomplete ${kind} template to stdout`, function () {
      const stdout = execFileSync(process.execPath, [TEMPLATE_SCRIPT, "--kind", kind], {
        cwd: ROOT,
        encoding: "utf8",
      });
      const report = JSON.parse(stdout);

      expect(report.status).to.equal("incomplete");
      expect(report.schemaVersion).to.equal(2);
      expect(`${JSON.stringify(report, null, 2)}\n`).to.equal(stdout);
    });
  }

  it("CLI fails closed on an unsupported kind", function () {
    const result = spawnSync(process.execPath, [TEMPLATE_SCRIPT, "--kind", "unknown"], {
      cwd: ROOT,
      encoding: "utf8",
    });

    expect(result.status).to.not.equal(0);
    expect(result.stdout).to.equal("");
    expect(result.stderr).to.match(/Usage:/u);
  });

  it("publishes both read-only template commands and their freezing runbook", function () {
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(packageJson.scripts["release:kdf:device-matrix:template"]).to.equal(
      "node scripts/kdf-release-evidence-template.mjs --kind device-matrix",
    );
    expect(packageJson.scripts["release:kdf:attacker-study:template"]).to.equal(
      "node scripts/kdf-release-evidence-template.mjs --kind attacker-study",
    );
    const documentation = fs.readFileSync(path.join(ROOT, "docs/kdf-release-evidence.md"), "utf8");
    for (const phrase of [
      "status: incomplete",
      "1800",
      "4 identity KDF",
      "2 file KDF",
      "security bits",
      "password-cracking years",
    ]) {
      expect(documentation).to.include(phrase);
    }
  });
});
