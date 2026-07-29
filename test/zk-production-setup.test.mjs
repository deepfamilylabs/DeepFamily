import { expect } from "chai";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { runZkeyContributionFromStdin } from "../scripts/zk-contribute-from-stdin.mjs";
import { ZK_ARTIFACT_MANIFEST_PATH, sha256Text } from "../scripts/lib/zkArtifactTrust.mjs";
import {
  SINGLE_OPERATOR_BEACON_ITERATIONS_EXP,
  SINGLE_OPERATOR_BEACON_NAME,
  SINGLE_OPERATOR_PARTICIPANT_ID,
  assertCompiledCircuitMatchesManifest,
  assertPtauSnapshotMatchesEvidence,
  assertSingleOperatorMetadata,
  buildProductionCompilerEvidence,
  buildProductionCircuitCompileCommand,
  buildProductionSnarkjsCommand,
  buildStagedProofValidationCommands,
  buildTranscriptAndManifest,
  installProductionArtifacts,
  runSingleOperatorProductionSetup,
  runSecretContribution,
} from "../scripts/lib/zkProductionSetup.mjs";
import {
  CIRCOM_LINUX_X64_SHA256,
  CIRCOM_SOURCE_COMMIT,
  CIRCOM_SOURCE_REPOSITORY,
  CIRCOM_VERSION,
} from "../scripts/lib/circomToolchain.mjs";
import { inspectSnarkjsRuntime, snapshotSnarkjsRuntime } from "../scripts/lib/snarkjsToolchain.mjs";
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

  it("requires x64 Node when the host is Windows ARM64", async function () {
    const error = await captureError(() =>
      runSingleOperatorProductionSetup({
        root,
        env: {},
        platform: "win32",
        arch: "arm64",
      }),
    );

    expect(error?.message).to.include("requires the x64 build of Node.js");
    expect(error?.message).to.include("node -p process.arch");
  });

  it("uses the inspected native compiler path on Darwin arm64 and Windows", function () {
    for (const compilerPath of [
      path.join(root, "bin", "circom"),
      path.join(root, "bin", "circom.exe"),
    ]) {
      const command = buildProductionCircuitCompileCommand({
        root,
        stageBuild: stage,
        circuitName: "person_commitment",
        compilerPath,
      });

      expect(command.executable).to.equal(compilerPath);
      expect(command.args).to.include("--O2");
      expect(command.args).to.include(path.join(root, "circuits", "person_commitment.circom"));
      expect(command.cwd).to.equal(root);
    }
  });

  it("checks the release Git state with the sanitized frozen environment", async function () {
    const captureCalls = [];
    const error = await captureError(() =>
      runSingleOperatorProductionSetup({
        root,
        env: {
          PATH: "/trusted/bin",
          RELEASE_VALUE: "preserved",
          NODE_OPTIONS: "--require=/untrusted/node-hook.cjs",
          git_config_count: "1",
          NPM_CONFIG_SCRIPT_SHELL: "/untrusted/shell",
          DEEPFAMILY_ZK_COMPILER_PATH: "/untrusted/circom",
        },
        captureRunner: (invocation) => {
          captureCalls.push(invocation);
          return invocation.args[0] === "rev-parse" ? "a".repeat(40) : "";
        },
        artifactInspector: () => {
          throw new Error("stop after Git state inspection");
        },
      }),
    );

    expect(error?.message).to.equal("stop after Git state inspection");
    expect(captureCalls).to.have.length(2);
    for (const invocation of captureCalls) {
      expect(invocation.env).to.deep.equal({
        PATH: "/trusted/bin",
        RELEASE_VALUE: "preserved",
      });
      expect(Object.isFrozen(invocation.env)).to.equal(true);
    }
  });

  it("runs snarkjs through Node instead of a platform-specific .bin wrapper", function () {
    const command = buildProductionSnarkjsCommand({
      root,
      args: ["groth16", "setup", "fixture.r1cs"],
    });

    expect(command).to.deep.equal({
      executable: process.execPath,
      args: [
        path.join(root, "node_modules", "snarkjs", "build", "cli.cjs"),
        "groth16",
        "setup",
        "fixture.r1cs",
      ],
      cwd: root,
    });
    expect(command.args[0]).not.to.match(/\.cmd$/u);
  });

  it("records the inspected native compiler in a schema-v3 transcript without changing the canonical manifest toolchain", async function () {
    const releaseDirectory = path.join(stage, "release");
    await fs.mkdir(releaseDirectory, { recursive: true });
    await fs.mkdir(path.join(root, "circuits"), { recursive: true });

    const circuits = {};
    const reviewedCircuits = {};
    for (const circuitName of ["person_commitment", "disclosure_binding"]) {
      const circuitDirectory = path.join(stage, circuitName);
      await fs.mkdir(circuitDirectory, { recursive: true });
      await fs.writeFile(
        path.join(root, "circuits", `${circuitName}.circom`),
        `${circuitName} source\n`,
      );
      const circuit = {
        r1cs: path.join(circuitDirectory, `${circuitName}.r1cs`),
        wasm: path.join(circuitDirectory, `${circuitName}.wasm`),
        finalZkey: path.join(circuitDirectory, `${circuitName}.zkey`),
        verificationKey: path.join(circuitDirectory, `${circuitName}.vkey.json`),
        solidityVerifier: path.join(circuitDirectory, `${circuitName}.sol`),
        metadata: {
          operatorContributionHash: "11".repeat(64),
          beaconContributionHash: "22".repeat(64),
        },
      };
      for (const [label, filePath] of Object.entries(circuit).filter(
        ([label]) => label !== "metadata",
      )) {
        await fs.writeFile(filePath, `${circuitName} ${label}\n`);
      }
      circuits[circuitName] = circuit;
      reviewedCircuits[circuitName] = {
        sourceSha256: sha256Text(`${circuitName} source\n`),
        r1csSha256: sha256Text(`${circuitName} r1cs\n`),
        wasmSha256: sha256Text(`${circuitName} wasm\n`),
      };
    }

    const canonicalToolchain = {
      circomBinarySha256: CIRCOM_LINUX_X64_SHA256,
      snarkjsCliSha256: "33".repeat(32),
      snarkjsRuntimeSha256: "34".repeat(32),
    };
    const compiler = buildProductionCompilerEvidence({
      compiler: {
        version: CIRCOM_VERSION,
        target: "darwin-arm64",
        strategy: "pinned-source",
        sha256: "44".repeat(32),
        libcEvidence: null,
        sourceBuild: {
          repository: CIRCOM_SOURCE_REPOSITORY,
          commit: CIRCOM_SOURCE_COMMIT,
          cargoVersion: "cargo 1.88.0 fixture",
          rustcVersion: "rustc 1.88.0 fixture",
        },
      },
      platform: "darwin",
      arch: "arm64",
    });
    const records = await buildTranscriptAndManifest({
      root,
      stageRoot: stage,
      initialManifest: {
        schemaVersion: 3,
        circomVersion: CIRCOM_VERSION,
        snarkjsVersion: "0.7.5",
        toolchain: canonicalToolchain,
        circuits: reviewedCircuits,
      },
      compiler,
      ceremonyId: "deepfamily-production-fixture",
      ptau: {
        source: "https://example.invalid/fixture.ptau",
        bytes: 123,
        sha256: "55".repeat(32),
        blake2b512: "66".repeat(64),
      },
      circuits,
      beaconHash: "77".repeat(32),
    });

    expect(records.transcript).to.include({
      schemaVersion: 3,
      compiler,
    });
    expect(records.manifest.toolchain).to.deep.equal(canonicalToolchain);
  });

  it("records Linux musl as a pinned-source compiler target", function () {
    const libcEvidence = {
      family: "musl",
      version: null,
      source: "process.report.header.glibcVersionRuntime",
    };
    expect(
      buildProductionCompilerEvidence({
        compiler: {
          version: CIRCOM_VERSION,
          target: "linux-x64-musl",
          strategy: "pinned-source",
          sha256: "44".repeat(32),
          libcEvidence,
          sourceBuild: {
            repository: CIRCOM_SOURCE_REPOSITORY,
            commit: CIRCOM_SOURCE_COMMIT,
            cargoVersion: "cargo 1.88.0 fixture",
            rustcVersion: "rustc 1.88.0 fixture",
          },
        },
        platform: "linux",
        arch: "x64",
      }),
    ).to.deep.equal({
      version: CIRCOM_VERSION,
      target: "linux-x64-musl",
      platform: "linux",
      arch: "x64",
      strategy: "pinned-source",
      binarySha256: "44".repeat(32),
      libcEvidence,
      sourceBuild: {
        repository: CIRCOM_SOURCE_REPOSITORY,
        commit: CIRCOM_SOURCE_COMMIT,
        cargoVersion: "cargo 1.88.0 fixture",
        rustcVersion: "rustc 1.88.0 fixture",
      },
    });
  });

  it("rejects a manifest-selected canonical compiler digest before installing the pTau", async function () {
    let ptauInstallerCalled = false;
    const error = await captureError(() =>
      runSingleOperatorProductionSetup({
        root,
        env: {},
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

  it("binds production setup to the exact manifest snapshot validated by the inspector", async function () {
    const manifestPath = path.join(root, ZK_ARTIFACT_MANIFEST_PATH);
    const reviewedRaw = `${JSON.stringify({ reviewed: true }, null, 2)}\n`;
    const replacedRaw = `${JSON.stringify({ reviewed: false }, null, 2)}\n`;
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, replacedRaw);
    let compilerInspected = false;

    const error = await captureError(() =>
      runSingleOperatorProductionSetup({
        root,
        env: {},
        captureRunner: ({ args }) => (args[0] === "rev-parse" ? "a".repeat(40) : ""),
        artifactInspector: () => ({
          circomVersion: CIRCOM_VERSION,
          toolchain: { circom: { sha256: CIRCOM_LINUX_X64_SHA256 } },
          trustedSetupStatus: "development",
          manifestSha256: sha256Text(reviewedRaw),
        }),
        compilerInspector: async () => {
          compilerInspected = true;
          throw new Error("compiler inspection must not run");
        },
      }),
    );

    expect(error?.message).to.include("initial manifest changed after validation");
    expect(compilerInspected).to.equal(false);
  });

  it("detects staged circuit or pTau replacement on every integrity recheck", async function () {
    const circuitName = "person_commitment";
    const r1cs = path.join(stage, "person_commitment.r1cs");
    const wasm = path.join(stage, "person_commitment.wasm");
    const ptauPath = path.join(stage, "fixture.ptau");
    await fs.writeFile(r1cs, "reviewed-r1cs\n");
    await fs.writeFile(wasm, "reviewed-wasm\n");
    await fs.writeFile(ptauPath, "reviewed-ptau\n");
    const initialManifest = {
      circuits: {
        [circuitName]: {
          r1csSha256: sha256Text("reviewed-r1cs\n"),
          wasmSha256: sha256Text("reviewed-wasm\n"),
        },
      },
    };
    const compiledCircuit = { circuitName, r1cs, wasm };
    const ptau = {
      bytes: Buffer.byteLength("reviewed-ptau\n"),
      sha256: sha256Text("reviewed-ptau\n"),
      blake2b512: createHash("blake2b512").update("reviewed-ptau\n").digest("hex"),
    };

    expect(assertCompiledCircuitMatchesManifest({ compiledCircuit, initialManifest })).to.include({
      r1csSha256: initialManifest.circuits[circuitName].r1csSha256,
      wasmSha256: initialManifest.circuits[circuitName].wasmSha256,
    });
    await assertPtauSnapshotMatchesEvidence({ ptauPath, expected: ptau });

    await fs.writeFile(r1cs, "replaced-r1cs\n");
    expect(() =>
      assertCompiledCircuitMatchesManifest({ compiledCircuit, initialManifest }),
    ).to.throw("staged R1CS SHA-256 mismatch");

    await fs.writeFile(r1cs, "reviewed-r1cs\n");
    await fs.writeFile(ptauPath, "replaced-ptau\n");
    const ptauError = await captureError(() =>
      assertPtauSnapshotMatchesEvidence({ ptauPath, expected: ptau }),
    );
    expect(ptauError?.message).to.include("staged Powers of Tau");
  });

  it("checks every staged R1CS/WASM hash before the first Groth16 or Phase 2 command", async function () {
    const compilerPath = path.join(root, "bin", "circom");
    const compilerContents = "fixture native compiler\n";
    const setupDirectory = path.join(root, "setup");
    const ptauPath = path.join(setupDirectory, "fixture.ptau");
    const ptauContents = "fixture ptau\n";
    const compiledBytes = {
      person_commitment: {
        r1cs: "person-r1cs\n",
        wasm: "person-wasm\n",
      },
      disclosure_binding: {
        r1cs: "disclosure-r1cs\n",
        wasm: "tampered-disclosure-wasm\n",
      },
    };
    const manifest = {
      schemaVersion: 3,
      toolchain: {
        snarkjsRuntimeSha256: "78".repeat(32),
      },
      circuits: {
        person_commitment: {
          r1csSha256: sha256Text(compiledBytes.person_commitment.r1cs),
          wasmSha256: sha256Text(compiledBytes.person_commitment.wasm),
        },
        disclosure_binding: {
          r1csSha256: sha256Text(compiledBytes.disclosure_binding.r1cs),
          wasmSha256: sha256Text("expected-disclosure-wasm\n"),
        },
      },
    };
    const manifestPath = path.join(root, ZK_ARTIFACT_MANIFEST_PATH);
    const manifestRaw = `${JSON.stringify(manifest, null, 2)}\n`;
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, manifestRaw);
    await fs.mkdir(path.dirname(compilerPath), { recursive: true });
    await fs.writeFile(compilerPath, compilerContents);

    const runnerEvents = [];
    let cachedCompilerInspected = false;
    const error = await captureError(() =>
      runSingleOperatorProductionSetup({
        root,
        env: {},
        platform: "darwin",
        arch: "arm64",
        captureRunner: ({ args }) => (args[0] === "rev-parse" ? "a".repeat(40) : ""),
        artifactInspector: () => ({
          circomVersion: CIRCOM_VERSION,
          toolchain: { circom: { sha256: CIRCOM_LINUX_X64_SHA256 } },
          trustedSetupStatus: "development",
          manifestSha256: sha256Text(manifestRaw),
        }),
        compilerInspector: async () => {
          cachedCompilerInspected = true;
          throw new Error("cached source-built compiler must not execute");
        },
        compilerSourceBuilder: async ({ target }) => {
          expect(target).to.include({
            id: "darwin-arm64",
            strategy: "pinned-source",
          });
          return {
            bytes: Buffer.from(compilerContents),
            cargoVersion: "cargo 1.88.0 fixture",
            rustcVersion: "rustc 1.88.0 fixture",
          };
        },
        runtimeSnapshotter: ({ destinationRoot, expectedSha256 }) => {
          expect(expectedSha256).to.equal(manifest.toolchain.snarkjsRuntimeSha256);
          return { root: destinationRoot, sha256: expectedSha256 };
        },
        ptauInstaller: async () => {
          await fs.mkdir(setupDirectory, { recursive: true });
          await fs.writeFile(ptauPath, ptauContents);
          return {
            path: ptauPath,
            source: "https://example.invalid/fixture.ptau",
            bytes: Buffer.byteLength(ptauContents),
            sha256: sha256Text(ptauContents),
            blake2b512: createHash("blake2b512").update(ptauContents).digest("hex"),
          };
        },
        runner: async (command) => {
          if (!command.args[0]?.endsWith(".circom")) {
            runnerEvents.push(["key", command]);
            return;
          }
          const circuitName = path.basename(command.args[0], ".circom");
          const stageBuild = command.args[command.args.indexOf("-o") + 1];
          const circuit = compiledBytes[circuitName];
          runnerEvents.push(["compile", circuitName]);
          await fs.mkdir(path.join(stageBuild, `${circuitName}_js`), { recursive: true });
          await fs.writeFile(path.join(stageBuild, `${circuitName}.r1cs`), circuit.r1cs);
          await fs.writeFile(
            path.join(stageBuild, `${circuitName}_js`, `${circuitName}.wasm`),
            circuit.wasm,
          );
        },
      }),
    );

    expect(error?.message).to.include("disclosure_binding staged WASM SHA-256 mismatch");
    expect(cachedCompilerInspected).to.equal(false);
    expect(runnerEvents.map(([kind, name]) => [kind, name])).to.deep.equal([
      ["compile", "person_commitment"],
      ["compile", "disclosure_binding"],
    ]);
  });

  it("pipes Phase 2 entropy through stdin without exposing it in argv or env", async function () {
    const entropy = Buffer.alloc(64, 0x5a);
    const runtimeSha256 = "45".repeat(32);
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
      snarkjsRuntimeSha256: runtimeSha256,
      env: {
        FIXTURE_SAFE: "preserved",
        NODE_OPTIONS: "--require=/untrusted/injection.cjs",
        node_path: "/untrusted/modules",
      },
    });
    const expectedSecret = Buffer.alloc(64, 0x5a).toString("hex");
    expect(invocation.executable).to.equal(process.execPath);
    expect(invocation.args).to.deep.equal([
      path.join(root, "scripts", "zk-contribute-from-stdin.mjs"),
      "/fixture/old.zkey",
      "/fixture/new.zkey",
      SINGLE_OPERATOR_PARTICIPANT_ID,
      root,
      runtimeSha256,
    ]);
    expect(invocation.args.join(" ")).not.to.include(expectedSecret);
    expect(JSON.stringify(invocation.env ?? {})).not.to.include(expectedSecret);
    expect(invocation.env).to.deep.equal({ FIXTURE_SAFE: "preserved" });
    expect(invocation.stdin.toString("utf8")).to.equal(`${expectedSecret}\n`);
    expect(entropy.every((value) => value === 0)).to.equal(true);
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

  it("verifies the snarkjs runtime closure before reading Phase 2 entropy", async function () {
    let inspected;
    const error = await captureError(() =>
      runZkeyContributionFromStdin({
        argv: [
          "/fixture/old.zkey",
          "/fixture/new.zkey",
          SINGLE_OPERATOR_PARTICIPANT_ID,
          path.resolve("."),
          "56".repeat(32),
        ],
        inputBytes: Buffer.from("this must never be parsed"),
        runtimeInspector: (request) => {
          inspected = request;
          throw new Error("fixture runtime mismatch");
        },
      }),
    );

    expect(error?.message).to.equal("fixture runtime mismatch");
    expect(inspected.expectedSha256).to.equal("56".repeat(32));
    expect(inspected.root).to.equal(path.resolve("."));
  });

  it("receives all entropy through a real child-process stdin pipe before loading snarkjs", async function () {
    const expectedSecret = Buffer.alloc(64, 0x3c).toString("hex");
    const helper = path.resolve("scripts/zk-contribute-from-stdin.mjs");
    const runtimeSha256 = inspectSnarkjsRuntime({ root: path.resolve(".") }).sha256;
    const runtimeRoot = path.join(root, "reviewed-snarkjs-runtime");
    snapshotSnarkjsRuntime({
      root: path.resolve("."),
      destinationRoot: runtimeRoot,
      expectedSha256: runtimeSha256,
    });
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          helper,
          path.join(root, "missing-old.zkey"),
          path.join(root, "missing-new.zkey"),
          SINGLE_OPERATOR_PARTICIPANT_ID,
          runtimeRoot,
          runtimeSha256,
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
