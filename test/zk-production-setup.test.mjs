import { expect } from "chai";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { runZkeyContributionFromStdin } from "../scripts/zk-contribute-from-stdin.mjs";
import { ZK_ARTIFACT_MANIFEST_PATH } from "../scripts/lib/zkArtifactTrust.mjs";
import {
  SINGLE_OPERATOR_BEACON_ITERATIONS_EXP,
  SINGLE_OPERATOR_BEACON_NAME,
  SINGLE_OPERATOR_PARTICIPANT_ID,
  assertSingleOperatorMetadata,
  buildProductionCircuitCompileCommand,
  buildStagedProofValidationCommands,
  installProductionArtifacts,
  runSingleOperatorProductionSetup,
  runSecretContribution,
} from "../scripts/lib/zkProductionSetup.mjs";
import {
  CIRCOM_CANONICAL_POLICY,
  CIRCOM_LINUX_X64_SHA256,
  CIRCOM_VERSION,
} from "../scripts/lib/circomToolchain.mjs";
import { createCanonicalTemporaryDirectory } from "./helpers/temporaryDirectory.mjs";

describe("single-operator production ZK setup safety", function () {
  let root;
  let stage;

  beforeEach(async function () {
    root = await createCanonicalTemporaryDirectory("deepfamily-production-setup-");
    stage = await createCanonicalTemporaryDirectory("deepfamily-production-stage-");
  });

  afterEach(async function () {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(stage, { recursive: true, force: true });
  });

  it("builds production circuits only with the canonical compiler and explicit O2", function () {
    const command = buildProductionCircuitCompileCommand({
      root,
      stageBuild: stage,
      circuitName: "person_commitment",
    });

    expect(command.executable).to.equal(path.join(root, CIRCOM_CANONICAL_POLICY.binaryPath));
    expect(command.args).to.include("--O2");
    expect(command.args).to.include(path.join(root, "circuits", "person_commitment.circom"));
    expect(command.cwd).to.equal(root);
  });

  it("rejects noncanonical hosts before touching the checkout", async function () {
    let captureRunnerCalled = false;
    const error = await captureError(() =>
      runSingleOperatorProductionSetup({
        root,
        env: {},
        platform: "darwin",
        arch: "arm64",
        captureRunner: () => {
          captureRunnerCalled = true;
          return "";
        },
      }),
    );

    expect(error?.message).to.equal("Production ZK setup requires the canonical linux-x64 host");
    expect(captureRunnerCalled).to.equal(false);
  });

  it("rejects a manifest-selected canonical compiler digest before installing the pTau", async function () {
    let ptauInstallerCalled = false;
    const error = await captureError(() =>
      runSingleOperatorProductionSetup({
        root,
        env: {},
        platform: "linux",
        arch: "x64",
        captureRunner: ({ args }) => (args[0] === "rev-parse" ? "a".repeat(40) : ""),
        artifactInspector: () => ({
          circomVersion: CIRCOM_VERSION,
          toolchain: { circom: { sha256: "0".repeat(64) } },
          trustedSetupStatus: "development",
        }),
        ptauInstaller: async () => {
          ptauInstallerCalled = true;
          throw new Error("pTau installation must not run");
        },
      }),
    );

    expect(error?.message).to.equal(
      `Production ZK setup canonical Circom SHA-256 mismatch; expected ` +
        `${CIRCOM_LINUX_X64_SHA256}, got ${"0".repeat(64)}`,
    );
    expect(ptauInstallerCalled).to.equal(false);
  });

  it("pipes Phase 2 entropy through stdin without exposing it in argv or env", async function () {
    const entropy = Buffer.alloc(64, 0x5a);
    let invocation;
    await runSecretContribution({
      runner: async (value) => {
        invocation = {
          ...value,
          stdin: Buffer.from(value.stdin),
        };
      },
      cwd: root,
      oldZkey: "/fixture/old.zkey",
      newZkey: "/fixture/new.zkey",
      randomBytesFn: (length) => {
        expect(length).to.equal(64);
        return entropy;
      },
    });
    const expectedSecret = Buffer.alloc(64, 0x5a).toString("hex");
    expect(invocation.executable).to.equal(process.execPath);
    expect(invocation.args).to.deep.equal([
      path.join(root, "scripts", "zk-contribute-from-stdin.mjs"),
      "/fixture/old.zkey",
      "/fixture/new.zkey",
      SINGLE_OPERATOR_PARTICIPANT_ID,
    ]);
    expect(invocation.args.join(" ")).not.to.include(expectedSecret);
    expect(JSON.stringify(invocation.env ?? {})).not.to.include(expectedSecret);
    expect(invocation.stdin.toString("utf8")).to.equal(`${expectedSecret}\n`);
    expect(entropy.every((value) => value === 0)).to.equal(false);
  });

  it("consumes piped entropy before invoking the real-library boundary", async function () {
    const expectedSecret = Buffer.alloc(64, 0xa5).toString("hex");
    const inputBytes = Buffer.from(`${expectedSecret}\n`, "ascii");
    const calls = [];
    await runZkeyContributionFromStdin({
      argv: ["/fixture/old.zkey", "/fixture/new.zkey", SINGLE_OPERATOR_PARTICIPANT_ID],
      inputBytes,
      contributor: async (...args) => {
        calls.push(args);
      },
    });
    expect(calls).to.deep.equal([
      ["/fixture/old.zkey", "/fixture/new.zkey", SINGLE_OPERATOR_PARTICIPANT_ID, expectedSecret],
    ]);
    expect(inputBytes.toString("ascii")).to.equal(`${expectedSecret}\n`);

    let error;
    try {
      await runZkeyContributionFromStdin({
        argv: ["/fixture/old.zkey", "/fixture/new.zkey", SINGLE_OPERATOR_PARTICIPANT_ID],
        inputBytes: Buffer.from(expectedSecret, "ascii"),
        contributor: async () => {
          throw new Error("invalid entropy must not reach contributor");
        },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.include("exactly 64 lowercase-hex bytes plus newline");
  });

  it("receives all entropy through a real child-process stdin pipe before loading snarkjs", async function () {
    const expectedSecret = Buffer.alloc(64, 0x3c).toString("hex");
    const helper = path.resolve("scripts/zk-contribute-from-stdin.mjs");
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          helper,
          path.join(root, "missing-old.zkey"),
          path.join(root, "missing-new.zkey"),
          SINGLE_OPERATOR_PARTICIPANT_ID,
        ],
        {
          cwd: path.resolve("."),
          env: process.env,
          shell: false,
          stdio: ["pipe", "ignore", "pipe"],
        },
      );
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (value) => {
        stderr += value;
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        resolve({ code, signal, stderr });
      });
      child.stdin.write(expectedSecret.slice(0, 37), "ascii");
      child.stdin.end(`${expectedSecret.slice(37)}\n`, "ascii");
    });
    expect(result.code).to.equal(1);
    expect(result.signal).to.equal(null);
    expect(result.stderr).not.to.include("entropy stdin");
    expect(result.stderr).to.include("ENOENT");
    expect(result.stderr).not.to.include(expectedSecret);
  });

  it("requires exactly one normal contribution followed by the declared beacon", function () {
    const operatorHash = "11".repeat(64);
    const beaconContributionHash = "22".repeat(64);
    const beaconHash = "33".repeat(32);
    const contributedMetadata = {
      contributionCount: 1,
      contributions: [
        {
          type: 0,
          name: SINGLE_OPERATOR_PARTICIPANT_ID,
          contributionHash: operatorHash,
        },
      ],
    };
    const finalMetadata = {
      contributionCount: 2,
      contributions: [
        {
          type: 0,
          name: SINGLE_OPERATOR_PARTICIPANT_ID,
          contributionHash: operatorHash,
        },
        {
          type: 1,
          name: SINGLE_OPERATOR_BEACON_NAME,
          beaconHash,
          numIterationsExp: SINGLE_OPERATOR_BEACON_ITERATIONS_EXP,
          contributionHash: beaconContributionHash,
        },
      ],
    };
    expect(
      assertSingleOperatorMetadata({
        circuitName: "fixture",
        contributedMetadata,
        finalMetadata,
        beaconHash,
      }),
    ).to.deep.equal({
      operatorContributionHash: operatorHash,
      beaconContributionHash,
    });

    finalMetadata.contributions[1].name = "unexpected-beacon";
    expect(() =>
      assertSingleOperatorMetadata({
        circuitName: "fixture",
        contributedMetadata,
        finalMetadata,
        beaconHash,
      }),
    ).to.throw("beacon metadata is invalid");
  });

  it("binds each staged real-proof check to its matching staged vkey", function () {
    const circuits = {
      person_commitment: {
        wasm: "/stage/person.wasm",
        finalZkey: "/stage/person.zkey",
        verificationKey: "/stage/person.vkey.json",
      },
      disclosure_binding: {
        wasm: "/stage/disclosure.wasm",
        finalZkey: "/stage/disclosure.zkey",
        verificationKey: "/stage/disclosure.vkey.json",
      },
    };
    const commands = buildStagedProofValidationCommands({ root, circuits });
    expect(commands).to.have.length(2);
    for (const [command, circuit] of [
      [commands[0], circuits.person_commitment],
      [commands[1], circuits.disclosure_binding],
    ]) {
      expect(command.executable).to.equal(process.execPath);
      expect(command.args[command.args.indexOf("--wasm") + 1]).to.equal(circuit.wasm);
      expect(command.args[command.args.indexOf("--zkey") + 1]).to.equal(circuit.finalZkey);
      expect(command.args[command.args.indexOf("--vkey") + 1]).to.equal(circuit.verificationKey);
    }
  });

  it("installs the manifest last and retains the complete validated artifact set", async function () {
    const existingPath = path.join(root, "artifacts", "existing.bin");
    await fs.mkdir(path.dirname(existingPath), { recursive: true });
    await fs.writeFile(existingPath, "old");
    const stagedArtifact = path.join(stage, "artifact.bin");
    const stagedManifest = path.join(stage, "manifest.json");
    await fs.writeFile(stagedArtifact, "new");
    await fs.writeFile(stagedManifest, "{}\n");
    const observations = [];

    await installProductionArtifacts({
      root,
      entries: [
        { source: stagedArtifact, destination: "artifacts/existing.bin" },
        { source: stagedManifest, destination: ZK_ARTIFACT_MANIFEST_PATH },
      ],
      validateBeforeCommit: async () => {
        observations.push(`before:${await fs.readFile(existingPath, "utf8")}`);
        try {
          await fs.access(path.join(root, ZK_ARTIFACT_MANIFEST_PATH));
          observations.push("before:manifest-present");
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
          observations.push("before:manifest-missing");
        }
      },
      validateAfterCommit: async () => {
        observations.push(`after:${await fs.readFile(existingPath, "utf8")}`);
        observations.push(
          `after:${await fs.readFile(path.join(root, ZK_ARTIFACT_MANIFEST_PATH), "utf8")}`,
        );
      },
    });

    expect(observations).to.deep.equal([
      "before:new",
      "before:manifest-missing",
      "after:new",
      "after:{}\n",
    ]);
    expect(await fs.readFile(existingPath, "utf8")).to.equal("new");
  });

  it("restores old files and removes newly created files when validation fails", async function () {
    const existingPath = path.join(root, "artifacts", "existing.bin");
    await fs.mkdir(path.dirname(existingPath), { recursive: true });
    await fs.writeFile(existingPath, "old");
    const stagedArtifact = path.join(stage, "artifact.bin");
    const stagedTranscript = path.join(stage, "transcript.json");
    const stagedManifest = path.join(stage, "manifest.json");
    await fs.writeFile(stagedArtifact, "new");
    await fs.writeFile(stagedTranscript, "{}\n");
    await fs.writeFile(stagedManifest, "{}\n");

    let error;
    try {
      await installProductionArtifacts({
        root,
        entries: [
          { source: stagedArtifact, destination: "artifacts/existing.bin" },
          { source: stagedTranscript, destination: "circuits/transcript.json" },
          { source: stagedManifest, destination: ZK_ARTIFACT_MANIFEST_PATH },
        ],
        validateBeforeCommit: async () => {},
        validateAfterCommit: async () => {
          throw new Error("injected final validation failure");
        },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.equal("injected final validation failure");
    expect(await fs.readFile(existingPath, "utf8")).to.equal("old");
    await expectMissing(path.join(root, "circuits", "transcript.json"));
    await expectMissing(path.join(root, ZK_ARTIFACT_MANIFEST_PATH));
  });

  it("does not publish the production manifest when pre-commit validation fails", async function () {
    const existingArtifact = path.join(root, "artifact.bin");
    const existingManifest = path.join(root, ZK_ARTIFACT_MANIFEST_PATH);
    await fs.mkdir(path.dirname(existingManifest), { recursive: true });
    await fs.writeFile(existingArtifact, "old-artifact");
    await fs.writeFile(existingManifest, "development-manifest\n");
    const stagedArtifact = path.join(stage, "artifact.bin");
    const stagedManifest = path.join(stage, "manifest.json");
    await fs.writeFile(stagedArtifact, "new-artifact");
    await fs.writeFile(stagedManifest, "production-manifest\n");
    let postCommitCalled = false;

    let error;
    try {
      await installProductionArtifacts({
        root,
        entries: [
          { source: stagedArtifact, destination: "artifact.bin" },
          { source: stagedManifest, destination: ZK_ARTIFACT_MANIFEST_PATH },
        ],
        validateBeforeCommit: async () => {
          expect(await fs.readFile(existingManifest, "utf8")).to.equal("development-manifest\n");
          throw new Error("injected pre-commit failure");
        },
        validateAfterCommit: async () => {
          postCommitCalled = true;
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error?.message).to.equal("injected pre-commit failure");
    expect(postCommitCalled).to.equal(false);
    expect(await fs.readFile(existingArtifact, "utf8")).to.equal("old-artifact");
    expect(await fs.readFile(existingManifest, "utf8")).to.equal("development-manifest\n");
  });

  it("refuses an installation plan whose manifest is not the final commit marker", async function () {
    const stagedManifest = path.join(stage, "manifest.json");
    const stagedArtifact = path.join(stage, "artifact.bin");
    await fs.writeFile(stagedManifest, "{}\n");
    await fs.writeFile(stagedArtifact, "new");
    let error;
    try {
      await installProductionArtifacts({
        root,
        entries: [
          { source: stagedManifest, destination: ZK_ARTIFACT_MANIFEST_PATH },
          { source: stagedArtifact, destination: "artifact.bin" },
        ],
        validateBeforeCommit: async () => {},
        validateAfterCommit: async () => {},
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.include("manifest must be installed last");
  });

  it("refuses duplicate destinations before replacing any file", async function () {
    const stagedArtifact = path.join(stage, "artifact.bin");
    const stagedManifest = path.join(stage, "manifest.json");
    await fs.writeFile(stagedArtifact, "new");
    await fs.writeFile(stagedManifest, "{}\n");
    let error;
    try {
      await installProductionArtifacts({
        root,
        entries: [
          { source: stagedArtifact, destination: ZK_ARTIFACT_MANIFEST_PATH },
          { source: stagedManifest, destination: ZK_ARTIFACT_MANIFEST_PATH },
        ],
        validateBeforeCommit: async () => {},
        validateAfterCommit: async () => {},
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.include("destinations must be unique");
    await expectMissing(path.join(root, ZK_ARTIFACT_MANIFEST_PATH));
  });
});

const expectMissing = async (filePath) => {
  try {
    await fs.access(filePath);
    throw new Error(`Expected file to be missing: ${filePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
};

const captureError = async (operation) => {
  try {
    await operation();
    return null;
  } catch (error) {
    return error;
  }
};
