import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveTrustedSourceBuildTool } from "../scripts/fetch-circom.mjs";
import { CIRCOM_LINUX_X64_SHA256, CIRCOM_VERSION } from "../scripts/lib/circomToolchain.mjs";
import { sanitizeReleaseEnvironment } from "../scripts/lib/portableCommand.mjs";
import { readShieldedReleaseCriteria } from "../scripts/lib/shieldedProductionSetup.mjs";
import { sourceBundleSha256 } from "../scripts/lib/shieldedSourceBundle.mjs";
import { resolveTrustedGitExecutable } from "../scripts/lib/trustedGit.mjs";
import {
  runSingleOperatorProductionSetup,
  snapshotProductionSetupSources,
} from "../scripts/lib/zkProductionSetup.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const criteria = {
  fundMaxGas: 1,
  claim3MaxGas: 1,
  browserFundMaxMs: 1,
  browserClaim3MaxMs: 1,
  recoveryMaxMs: 1,
  recoveryMinEvents: 1,
};

describe("trusted Git in ZK setup source evidence", function () {
  let root;
  let gitExecutable;
  let originalPath;
  let marker;
  let shimDirectory;
  let manifestRaw;

  const write = (relative, contents) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
    return file;
  };
  const git = (args) =>
    execFileSync(gitExecutable, args, {
      cwd: root,
      env: sanitizeReleaseEnvironment(process.env),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  beforeEach(function () {
    originalPath = process.env.PATH;
    gitExecutable = resolveTrustedGitExecutable();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-setup-git-")));
    git(["init", "-q"]);
    write(".gitignore", "node_modules/\ncriteria.untracked.json\n");
    write("contracts/Reviewed.sol", "contract Reviewed {}\n");
    write("docs/notes.md", "reviewed source\n");
    for (const name of ["person_commitment", "disclosure_binding"]) {
      write("circuits/identity/" + name + ".circom", "pragma circom 2.2.3;\n");
    }
    manifestRaw = fs.readFileSync(path.join(ROOT, "circuits/zk-artifacts-manifest.json"), "utf8");
    write("circuits/zk-artifacts-manifest.json", manifestRaw);
    write("release-evidence/criteria.json", JSON.stringify(criteria));
    git(["add", "."]);
    git([
      "-c",
      "user.name=ZK test",
      "-c",
      "user.email=zk@example.invalid",
      "commit",
      "-qm",
      "fixture",
    ]);
    write("criteria.untracked.json", JSON.stringify(criteria));
    shimDirectory = path.join(root, "node_modules/.bin");
    marker = path.join(shimDirectory, "executed");
    const shim = write(
      "node_modules/.bin/git",
      "#!" +
        process.execPath +
        "\n" +
        'require("node:fs").writeFileSync(__dirname + "/executed", "untrusted git");\n',
    );
    fs.chmodSync(shim, 0o755);
  });

  afterEach(function () {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it("shares the protected resolver and detects non-circuit source changes with an npm Git shim", async function () {
    // An executable POSIX shim models npm's node_modules/.bin prefix. Windows still exercises
    // absolute Git and environment propagation in the platform-independent tests below.
    if (process.platform === "win32") this.skip();
    const original = sourceBundleSha256(root);
    process.env.PATH = shimDirectory;
    assert.equal(await resolveTrustedSourceBuildTool({ name: "git" }), gitExecutable);
    assert.equal(git(["status", "--porcelain=v1", "--untracked-files=all"]), "");
    const before = snapshotProductionSetupSources({ root, includeShielded: false });
    assert.equal(before.sourceBundleDigest, original);
    assert.notEqual(original, createHash("sha256").digest("hex"));
    write("contracts/Reviewed.sol", "contract ChangedAfterSnapshot {}\n");
    const after = snapshotProductionSetupSources({ root, includeShielded: false });
    assert.notEqual(after.sourceBundleDigest, before.sourceBundleDigest);
    assert.equal(after.compilationSourceDigest, before.compilationSourceDigest);
    assert.equal(fs.existsSync(marker), false);
  });

  it("rejects ignored untracked criteria and accepts committed criteria under the npm PATH prefix", function () {
    if (process.platform === "win32") this.skip();
    process.env.PATH = shimDirectory;
    assert.throws(
      () => readShieldedReleaseCriteria({ root, criteriaPath: "criteria.untracked.json" }),
      /must be committed before production setup/,
    );
    assert.deepEqual(
      readShieldedReleaseCriteria({ root, criteriaPath: "release-evidence/criteria.json" }),
      criteria,
    );
    assert.equal(fs.existsSync(marker), false);
  });

  it("passes the trusted Git and sanitized environment through the formal setup path before keygen", async function () {
    const stopped = new Error("stop after inspecting setup source options");
    const env = {
      ...process.env,
      CI: "false",
      PATH: shimDirectory,
      GIT_DIR: path.join(root, "must-not-be-used"),
      NODE_OPTIONS: "--require /must-not-be-loaded.cjs",
    };
    let inspected = false;
    await assert.rejects(
      runSingleOperatorProductionSetup({
        root,
        env,
        shieldedReleaseCriteriaPath: "release-evidence/criteria.json",
        artifactInspector: () => ({
          circomVersion: CIRCOM_VERSION,
          trustedSetupStatus: "development",
          manifestSha256: createHash("sha256").update(manifestRaw).digest("hex"),
          toolchain: { circom: { sha256: CIRCOM_LINUX_X64_SHA256 } },
        }),
        sourceSnapshotter: (selectedRoot, options) => {
          assert.equal(selectedRoot, root);
          assert.equal(options.gitExecutable, gitExecutable);
          assert.equal(options.env.PATH, shimDirectory);
          assert.equal(options.env.GIT_DIR, undefined);
          assert.equal(options.env.NODE_OPTIONS, undefined);
          const selected = snapshotProductionSetupSources({
            root: selectedRoot,
            includeShielded: false,
            ...options,
          });
          assert.equal(selected.sourceBundleDigest, sourceBundleSha256(root, { gitExecutable }));
          inspected = true;
          throw stopped;
        },
      }),
      (error) => error === stopped,
    );
    assert.equal(inspected, true);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(path.join(root, "tmp/zk-production/.setup.lock")), false);
  });

  it("rejects PATH-dependent executable names in explicit source and criteria options", function () {
    assert.throws(
      () => sourceBundleSha256(root, { gitExecutable: "git" }),
      /Git executable must be absolute/,
    );
    assert.throws(
      () =>
        readShieldedReleaseCriteria({
          root,
          criteriaPath: "release-evidence/criteria.json",
          gitExecutable: "git",
        }),
      /Git executable must be absolute/,
    );
  });
});
