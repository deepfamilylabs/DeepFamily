import { expect } from "chai";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  RELEASE_PREFLIGHT_COMMANDS,
  defaultRunner,
  runReleasePreflight as runReleasePreflightRaw,
} from "../scripts/release-preflight.mjs";
import {
  CIRCOM_VERSION,
  localCircomBinaryPath,
  resolveLocalCircomTarget,
} from "../scripts/lib/circomToolchain.mjs";
import { CIRCOM_OVERRIDE_ENV } from "../scripts/lib/circomCompilerOverride.mjs";
import {
  MINIMUM_PRODUCTION_CONTRIBUTORS,
  ZK_ARTIFACT_MANIFEST_PATH,
  ZK_CEREMONY_TRANSCRIPT_PATH,
  ZK_RELEASE_ARTIFACTS,
  ZK_TOOLCHAIN_PATHS,
  ZK_TRUST_MODEL_SINGLE_OPERATOR,
  sha256File,
  sha256Text,
} from "../scripts/lib/zkArtifactTrust.mjs";
import { inspectPtauFile } from "../scripts/lib/productionPtau.mjs";
import { inspectSnarkjsRuntime } from "../scripts/lib/snarkjsToolchain.mjs";
import { createCanonicalTemporaryDirectory } from "./helpers/temporaryDirectory.mjs";

const COMMIT = "12".repeat(20);
const CHANGED_COMMIT = "34".repeat(20);
const SUPPORTED_RUNTIMES = Object.freeze([
  Object.freeze({ platform: "linux", arch: "x64", libc: "glibc" }),
  Object.freeze({ platform: "darwin", arch: "arm64" }),
  Object.freeze({ platform: "win32", arch: "x64" }),
]);
const inspectFixtureProtocolManifest = () => ({ manifestSha256: "cd".repeat(32) });
const FIXTURE_GIT_EXECUTABLE = path.resolve("test-tools", "git");
const runReleasePreflight = (options) =>
  runReleasePreflightRaw({
    protocolManifestInspector: inspectFixtureProtocolManifest,
    gitToolResolver: async () => FIXTURE_GIT_EXECUTABLE,
    ...options,
  });

const artifactPath = (root, relativePath) => path.join(root, ...relativePath.split("/"));

const writeRelativeFile = async (root, relativePath, contents) => {
  const target = artifactPath(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
  return target;
};

const writeManifest = async (root, manifest) =>
  writeRelativeFile(root, ZK_ARTIFACT_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

const writeTranscript = async (root, transcript) =>
  writeRelativeFile(root, ZK_CEREMONY_TRANSCRIPT_PATH, `${JSON.stringify(transcript, null, 2)}\n`);

const createProductionFixture = async () => {
  const root = await createCanonicalTemporaryDirectory("deepfamily-release-preflight-");
  const circuits = {};

  for (const [circuitName, spec] of Object.entries(ZK_RELEASE_ARTIFACTS)) {
    const files = {
      sourceSha256: spec.source,
      r1csSha256: spec.builtR1cs,
      wasmSha256: spec.wasm,
      zkeySha256: spec.zkey,
      verificationKeySha256: spec.verificationKey,
      solidityVerifierSha256: spec.solidityVerifier,
    };
    circuits[circuitName] = {};
    for (const [manifestField, relativePath] of Object.entries(files)) {
      const target = await writeRelativeFile(
        root,
        relativePath,
        `${circuitName}:${manifestField}:release-preflight-fixture\n`,
      );
      circuits[circuitName][manifestField] = sha256File(target);
    }
  }

  const ptauPath = await writeRelativeFile(
    root,
    "ceremony/published-final.ptau",
    "published powers of tau release-preflight fixture\n",
  );
  const snarkjsVersion = "0.7.5";
  await writeRelativeFile(
    root,
    "node_modules/snarkjs/package.json",
    `${JSON.stringify({
      name: "snarkjs",
      version: snarkjsVersion,
      main: "build/cli.cjs",
    })}\n`,
  );
  const snarkjsCli = await writeRelativeFile(
    root,
    ZK_TOOLCHAIN_PATHS.snarkjsCli,
    "fixture snarkjs executable\n",
  );
  const circomBinary = await writeRelativeFile(
    root,
    ZK_TOOLCHAIN_PATHS.circomBinary,
    "fixture circom executable\n",
  );

  const ceremonyId = "deepfamily-production-2026-01";
  const phase1 = await inspectPtauFile(ptauPath);
  const phase1Sha256 = phase1.sha256;
  const expectedProductionPhase1 = {
    source: "https://example.invalid/published-final.ptau",
    bytes: phase1.bytes,
    sha256: phase1.sha256,
    blake2b512: phase1.blake2b512,
  };
  const transcriptCircuits = Object.fromEntries(
    Object.entries(circuits).map(([name, hashes]) => [
      name,
      { sourceSha256: hashes.sourceSha256, r1csSha256: hashes.r1csSha256 },
    ]),
  );
  const contributions = Array.from({ length: MINIMUM_PRODUCTION_CONTRIBUTORS }, (_, index) => ({
    sequence: index + 1,
    participantId: `participant-${index + 1}`,
    personCommitmentContributionHash: `${String(index + 1).padStart(2, "0")}`.repeat(64),
    disclosureBindingContributionHash: `${String(index + 11).padStart(2, "0")}`.repeat(64),
  }));
  const beacon = {
    name: "deepfamily-public-beacon",
    hash: sha256Text("public-randomness-beacon"),
    numIterationsExp: 10,
    source: "public-randomness-round-12345",
    personCommitmentContributionHash: "aa".repeat(64),
    disclosureBindingContributionHash: "bb".repeat(64),
  };
  const transcript = {
    schemaVersion: 2,
    trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
    ceremonyId,
    phase1Sha256,
    circuits: transcriptCircuits,
    contributions,
    beacon,
  };
  const transcriptPath = await writeTranscript(root, transcript);
  const manifest = {
    schemaVersion: 3,
    circomVersion: "2.2.3",
    snarkjsVersion,
    toolchain: {
      circomBinarySha256: sha256File(circomBinary),
      snarkjsCliSha256: sha256File(snarkjsCli),
      snarkjsRuntimeSha256: inspectSnarkjsRuntime({ root }).sha256,
    },
    trustedSetup: {
      status: "production",
      trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
      warning: "Single operator must destroy every circuit-specific Phase 2 secret.",
      ceremonyId,
      minimumContributors: MINIMUM_PRODUCTION_CONTRIBUTORS,
      contributorCount: contributions.length,
      phase1: {
        ...expectedProductionPhase1,
        verified: true,
      },
      transcript: {
        path: ZK_CEREMONY_TRANSCRIPT_PATH,
        sha256: sha256File(transcriptPath),
      },
      beacon: { applied: true, ...beacon },
    },
    circuits,
  };
  const manifestPath = await writeManifest(root, manifest);

  const metadataByCircuit = Object.fromEntries(
    Object.keys(ZK_RELEASE_ARTIFACTS).map((circuitName) => {
      const hashField =
        circuitName === "person_commitment"
          ? "personCommitmentContributionHash"
          : "disclosureBindingContributionHash";
      return [
        circuitName,
        {
          contributionCount: contributions.length + 1,
          contributions: [
            ...contributions.map((contribution) => ({
              type: 0,
              name: contribution.participantId,
              contributionHash: contribution[hashField],
            })),
            {
              type: 1,
              name: beacon.name,
              contributionHash: beacon[hashField],
              beaconHash: beacon.hash,
              numIterationsExp: beacon.numIterationsExp,
            },
          ],
        },
      ];
    }),
  );
  return {
    root,
    manifest,
    manifestPath,
    ptauPath,
    snarkjsCli,
    metadataByCircuit,
    expectedProductionPhase1,
  };
};

const commandLabel = ({ executable, args }) => `${path.basename(executable)} ${args.join(" ")}`;
const nativeToolchainPath = (portablePath) => path.join(...portablePath.split("/"));

const metadataReaderFor = (fixture) => async (zkeyPath) =>
  fixture.metadataByCircuit[path.basename(zkeyPath, ".zkey")];

const captureError = async (operation) => {
  try {
    await operation();
    return null;
  } catch (error) {
    return error;
  }
};

const inspectFixtureCompiler = async ({ root, platform, arch, libc, report }) => {
  const target = resolveLocalCircomTarget({ platform, arch, libc, report });
  return Object.freeze({
    path: path.join(root, localCircomBinaryPath({ platform })),
    target: target.id,
    strategy: target.strategy,
    sha256: target.strategy === "official-binary" ? target.sha256 : "ab".repeat(32),
    version: CIRCOM_VERSION,
    libcEvidence: target.libcEvidence ?? null,
  });
};

const buildFixtureSourceCompiler = async ({ target }) => ({
  bytes: Buffer.from(`fresh source compiler for ${target.id}\n`),
  cargoVersion: "cargo 1.88.0 fixture",
  rustcVersion: "rustc 1.88.0 fixture",
});

const runWithFixtureCompiler = (options) =>
  runReleasePreflight({
    compilerInspector: inspectFixtureCompiler,
    compilerSourceBuilder: buildFixtureSourceCompiler,
    protocolManifestInspector: inspectFixtureProtocolManifest,
    ...options,
  });

const createFakeRunner = ({
  commits = [COMMIT, COMMIT],
  statuses = ["", ""],
  onInvocation = () => {},
} = {}) => {
  const calls = [];
  let commitIndex = 0;
  let statusIndex = 0;
  const runner = (invocation) => {
    calls.push(invocation);
    if (
      path.basename(invocation.executable) === "git" &&
      invocation.args[0] === "rev-parse" &&
      invocation.args[1] === "HEAD"
    ) {
      const index = commitIndex++;
      onInvocation(invocation, { kind: "commit", index });
      return `${commits[Math.min(index, commits.length - 1)]}\n`;
    }
    if (
      path.basename(invocation.executable) === "git" &&
      invocation.args[0] === "status" &&
      invocation.args[1] === "--porcelain=v1"
    ) {
      const index = statusIndex++;
      onInvocation(invocation, { kind: "status", index });
      return `${statuses[Math.min(index, statuses.length - 1)]}\n`;
    }
    onInvocation(invocation, { kind: "command", index: calls.length - 1 });
    return undefined;
  };
  return { calls, runner };
};

describe("production release preflight", function () {
  const fixtures = [];

  afterEach(async function () {
    while (fixtures.length > 0) {
      await fs.rm(fixtures.pop().root, { recursive: true, force: true });
    }
  });

  const productionFixture = async () => {
    const fixture = await createProductionFixture();
    fixtures.push(fixture);
    return fixture;
  };

  it("does not auto-load the Git-ignored repository .env file", function () {
    const source = fsSync.readFileSync("scripts/release-preflight.mjs", "utf8");
    expect(source).not.to.include('import "dotenv/config"');
  });

  it("accepts Linux x64/glibc, Darwin arm64, and Windows x64 execution runtimes", async function () {
    for (const runtime of SUPPORTED_RUNTIMES) {
      const fixture = await productionFixture();
      const fake = createFakeRunner();

      const result = await runWithFixtureCompiler({
        root: fixture.root,
        ...runtime,
        commands: [],
        expectedProductionPhase1: fixture.expectedProductionPhase1,
        ptauPath: fixture.ptauPath,
        runner: fake.runner,
        mpcMetadataReader: metadataReaderFor(fixture),
      });

      expect(result.status, `${runtime.platform}/${runtime.arch}`).to.equal("passed");
    }
  });

  it("rejects native and x64-emulated Node on Windows ARM64 hosts", async function () {
    for (const runtime of [
      {
        arch: "arm64",
        env: { PROCESSOR_ARCHITECTURE: "ARM64" },
      },
      {
        arch: "x64",
        env: {
          PROCESSOR_ARCHITECTURE: "AMD64",
          PROCESSOR_ARCHITEW6432: "ARM64",
        },
      },
    ]) {
      const fake = createFakeRunner();
      const error = await captureError(() =>
        runReleasePreflight({
          root: "/fixture/deepfamily",
          platform: "win32",
          ...runtime,
          runner: fake.runner,
        }),
      );

      expect(error?.message).to.include("does not support Windows ARM64 hosts");
      expect(fake.calls).to.deep.equal([]);
    }
  });

  it("fresh-builds source targets and passes only the private compiler to nested ZK builds", async function () {
    const fixture = await productionFixture();
    let cachedCompilerInspected = false;
    let compilerPathDuringCheck;
    let sourceEnvironment;
    const fake = createFakeRunner({
      onInvocation: (invocation, state) => {
        if (state.kind === "command" && invocation.executable === "npm") {
          if (invocation.args[1] === "zk:artifacts:check") {
            compilerPathDuringCheck = invocation.env?.[CIRCOM_OVERRIDE_ENV.path];
            expect(fsSync.existsSync(compilerPathDuringCheck)).to.equal(true);
            expect(invocation.env[CIRCOM_OVERRIDE_ENV.target]).to.equal("darwin-arm64");
            expect(invocation.env[CIRCOM_OVERRIDE_ENV.sha256]).to.match(/^[0-9a-f]{64}$/u);
          } else {
            expect(invocation.env?.[CIRCOM_OVERRIDE_ENV.path]).to.equal(undefined);
          }
        }
      },
    });

    await runReleasePreflight({
      root: fixture.root,
      platform: "darwin",
      arch: "arm64",
      commands: [
        ["npm", ["run", "contracts:check"]],
        ["npm", ["run", "zk:artifacts:check"]],
      ],
      compilerInspector: async () => {
        cachedCompilerInspected = true;
        throw new Error("cached source compiler must not execute");
      },
      compilerSourceBuilder: async (options) => {
        sourceEnvironment = options.env;
        return buildFixtureSourceCompiler(options);
      },
      env: {
        FIXTURE: "preserved",
        NODE_OPTIONS: "--require=/untrusted/node-hook.cjs",
        npm_config_script_shell: "/untrusted/shell",
        [CIRCOM_OVERRIDE_ENV.path]: "/untrusted/cached/circom",
        [CIRCOM_OVERRIDE_ENV.sha256]: "0".repeat(64),
        [CIRCOM_OVERRIDE_ENV.target]: "untrusted-target",
      },
      expectedProductionPhase1: fixture.expectedProductionPhase1,
      ptauPath: fixture.ptauPath,
      runner: fake.runner,
      mpcMetadataReader: metadataReaderFor(fixture),
    });

    expect(cachedCompilerInspected).to.equal(false);
    expect(sourceEnvironment).to.deep.equal({ FIXTURE: "preserved" });
    expect(Object.isFrozen(sourceEnvironment)).to.equal(true);
    expect(compilerPathDuringCheck).to.be.a("string");
    expect(fsSync.existsSync(compilerPathDuringCheck)).to.equal(false);
  });

  it("runs Windows npm commands through the real npm CLI with Node", async function () {
    const root = await createCanonicalTemporaryDirectory("deepfamily-release-runner-");
    fixtures.push({ root });
    const npmCli = await writeRelativeFile(
      root,
      "toolchain/npm-cli.js",
      "process.stdout.write(JSON.stringify(process.argv.slice(2)));",
    );

    const output = defaultRunner({
      executable: "npm",
      args: ["run", "frontend:check"],
      cwd: root,
      capture: true,
      platform: "win32",
      env: { npm_execpath: npmCli },
    });

    expect(JSON.parse(output)).to.deep.equal(["run", "frontend:check"]);
  });

  it("passes a sanitized environment to Git, npm, and ceremony subprocesses", async function () {
    const fixture = await productionFixture();
    const fake = createFakeRunner();
    const untrustedEnvironment = {
      PATH: "/trusted/bin",
      RELEASE_VALUE: "preserved",
      NODE_OPTIONS: "--require=/untrusted/node-hook.cjs",
      node_path: "/untrusted/node-modules",
      LD_PRELOAD: "/untrusted/native-hook.so",
      ld_library_path: "/untrusted/native-libraries",
      DYLD_INSERT_LIBRARIES: "/untrusted/native-hook.dylib",
      dyld_library_path: "/untrusted/native-libraries",
      NPM_CONFIG_SCRIPT_SHELL: "/untrusted/shell",
      npm_config_node_options: "--require=/untrusted/npm-hook.cjs",
      GIT_CONFIG_COUNT: "1",
      git_config_key_0: "core.fsmonitor",
      DOTENV_CONFIG_PATH: "/untrusted/.env",
    };

    await runWithFixtureCompiler({
      root: fixture.root,
      platform: "linux",
      arch: "x64",
      commands: [["npm", ["run", "contracts:check"]]],
      env: untrustedEnvironment,
      expectedProductionPhase1: fixture.expectedProductionPhase1,
      ptauPath: fixture.ptauPath,
      runner: fake.runner,
      mpcMetadataReader: metadataReaderFor(fixture),
    });

    expect(fake.calls).not.to.be.empty;
    for (const invocation of fake.calls) {
      expect(invocation.env, commandLabel(invocation)).to.deep.equal({
        PATH: "/trusted/bin",
        RELEASE_VALUE: "preserved",
      });
      expect(Object.isFrozen(invocation.env), commandLabel(invocation)).to.equal(true);
    }
  });

  it("rejects an unsupported host before compiler inspection or any runner", async function () {
    const fake = createFakeRunner();
    let inspected = false;

    const error = await captureError(() =>
      runReleasePreflight({
        root: "/fixture/deepfamily",
        platform: "freebsd",
        arch: "riscv64",
        compilerInspector: async () => {
          inspected = true;
          throw new Error("compiler inspection must not run");
        },
        runner: fake.runner,
      }),
    );

    expect(error?.message).to.include("Unsupported Circom host freebsd/riscv64");
    expect(inspected).to.equal(false);
    expect(fake.calls).to.deep.equal([]);
  });

  it("fails on compiler provenance, hash, or version errors after the release gates", async function () {
    for (const [runtime, message] of [
      [
        { platform: "darwin", arch: "arm64" },
        "Circom source-build provenance sourceCommit mismatch",
      ],
      [{ platform: "linux", arch: "x64" }, "Existing circom does not match the pinned SHA-256"],
      [
        { platform: "win32", arch: "x64" },
        'Installed Circom compiler version mismatch; expected "circom compiler 2.2.3"',
      ],
    ]) {
      const fixture = await productionFixture();
      const fake = createFakeRunner();
      const target = resolveLocalCircomTarget(runtime);
      const error = await captureError(() =>
        runReleasePreflight({
          root: fixture.root,
          ...runtime,
          expectedProductionPhase1: fixture.expectedProductionPhase1,
          compilerInspector:
            target.strategy === "official-binary"
              ? async () => {
                  throw new Error(message);
                }
              : inspectFixtureCompiler,
          compilerSourceBuilder:
            target.strategy === "pinned-source"
              ? async () => {
                  throw new Error(message);
                }
              : buildFixtureSourceCompiler,
          runner: fake.runner,
        }),
      );

      expect(error?.message).to.equal(message);
      expect(fake.calls.map(commandLabel), `${runtime.platform}/${runtime.arch}`).to.deep.equal([
        "git rev-parse HEAD",
        "git status --porcelain=v1 --untracked-files=all",
      ]);
    }
  });

  it("rejects inconsistent local compiler evidence after the release gates", async function () {
    const cases = [
      {
        label: "path",
        mutate: (evidence) => ({ ...evidence, path: `${evidence.path}.unexpected` }),
        message: "unexpected target evidence",
      },
      {
        label: "target",
        mutate: (evidence) => ({ ...evidence, target: "unsupported-target" }),
        message: "unexpected target evidence",
      },
      {
        label: "strategy",
        mutate: (evidence) => ({ ...evidence, strategy: "pinned-source" }),
        message: "unexpected target evidence",
      },
      {
        label: "version",
        mutate: (evidence) => ({ ...evidence, version: "2.1.5" }),
        message: "unexpected version",
      },
      {
        label: "libc",
        mutate: (evidence) => ({
          ...evidence,
          libcEvidence: { ...evidence.libcEvidence, family: "musl" },
        }),
        message: "unexpected libc evidence",
      },
      {
        label: "digest format",
        mutate: (evidence) => ({ ...evidence, sha256: "AB".repeat(32) }),
        message: "invalid SHA-256 digest",
      },
      {
        label: "official digest",
        mutate: (evidence) => ({ ...evidence, sha256: "ab".repeat(32) }),
        message: "does not match the pinned target SHA-256",
      },
    ];

    for (const testCase of cases) {
      const fixture = await productionFixture();
      const fake = createFakeRunner();
      const error = await captureError(() =>
        runReleasePreflight({
          root: fixture.root,
          platform: "linux",
          arch: "x64",
          libc: "glibc",
          expectedProductionPhase1: fixture.expectedProductionPhase1,
          compilerInspector: async (runtime) =>
            testCase.mutate(await inspectFixtureCompiler(runtime)),
          runner: fake.runner,
        }),
      );

      expect(error?.message, testCase.label).to.include(testCase.message);
      expect(fake.calls.map(commandLabel), testCase.label).to.deep.equal([
        "git rev-parse HEAD",
        "git status --porcelain=v1 --untracked-files=all",
      ]);
    }
  });

  it("blocks an explicit development manifest before running any npm command", async function () {
    const fixture = await productionFixture();
    fixture.manifest.trustedSetup = {
      status: "development",
      trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
      warning: "Single local contributor with public fixed entropy; development and testing only.",
      minimumContributors: 1,
      contributorCount: 1,
      beaconApplied: false,
      transcriptSha256: null,
    };
    await writeManifest(fixture.root, fixture.manifest);
    const fake = createFakeRunner();
    let sourceBuildCalled = false;

    const error = await captureError(() =>
      runReleasePreflight({
        root: fixture.root,
        platform: "darwin",
        arch: "arm64",
        compilerSourceBuilder: async () => {
          sourceBuildCalled = true;
          throw new Error("compiler source build must not run");
        },
        expectedProductionPhase1: fixture.expectedProductionPhase1,
        ptauPath: fixture.ptauPath,
        runner: fake.runner,
      }),
    );
    expect(error?.message).to.equal(
      "Production release is blocked: checked-in ZK proving keys are marked development-only",
    );
    expect(sourceBuildCalled).to.equal(false);

    expect(fake.calls.map(commandLabel)).to.deep.equal([
      "git rev-parse HEAD",
      "git status --porcelain=v1 --untracked-files=all",
    ]);
    expect(fake.calls.some(({ executable }) => executable === "npm")).to.equal(false);
  });

  it("requires schemaVersion 3 before starting a compiler source build", async function () {
    const fixture = await productionFixture();
    fixture.manifest.schemaVersion = 2;
    delete fixture.manifest.toolchain.snarkjsRuntimeSha256;
    await writeManifest(fixture.root, fixture.manifest);
    const fake = createFakeRunner();
    let sourceBuildCalled = false;

    const error = await captureError(() =>
      runReleasePreflight({
        root: fixture.root,
        platform: "darwin",
        arch: "arm64",
        compilerSourceBuilder: async () => {
          sourceBuildCalled = true;
          throw new Error("compiler source build must not run");
        },
        expectedProductionPhase1: fixture.expectedProductionPhase1,
        runner: fake.runner,
      }),
    );

    expect(error?.message).to.equal(
      "Release preflight requires ZK manifest schemaVersion 3 with a reviewed snarkjs runtime graph",
    );
    expect(sourceBuildCalled).to.equal(false);
    expect(fake.calls.map(commandLabel)).to.deep.equal([
      "git rev-parse HEAD",
      "git status --porcelain=v1 --untracked-files=all",
    ]);
  });

  it("runs all checks in order, then verifies Powers of Tau and both final zkeys", async function () {
    const fixture = await productionFixture();
    const fake = createFakeRunner();

    const result = await runWithFixtureCompiler({
      root: fixture.root,
      platform: "linux",
      arch: "x64",
      expectedProductionPhase1: fixture.expectedProductionPhase1,
      ptauPath: fixture.ptauPath,
      runner: fake.runner,
      mpcMetadataReader: metadataReaderFor(fixture),
    });

    const labels = fake.calls.map(commandLabel);
    expect(labels.slice(0, 2)).to.deep.equal([
      "git rev-parse HEAD",
      "git status --porcelain=v1 --untracked-files=all",
    ]);
    expect(labels.slice(2, 2 + RELEASE_PREFLIGHT_COMMANDS.length)).to.deep.equal(
      RELEASE_PREFLIGHT_COMMANDS.map(([executable, args]) => commandLabel({ executable, args })),
    );
    expect(labels.slice(-2)).to.deep.equal([
      "git rev-parse HEAD",
      "git status --porcelain=v1 --untracked-files=all",
    ]);
    expect(path.dirname(fake.calls[2 + RELEASE_PREFLIGHT_COMMANDS.length].args[3])).to.match(
      /deepfamily-zk-verify-/u,
    );
    expect(
      fake.calls.filter(
        ({ executable, args }) =>
          executable === process.execPath &&
          args[0]?.endsWith(nativeToolchainPath(ZK_TOOLCHAIN_PATHS.snarkjsCli)) &&
          args[1] === "powersoftau" &&
          args[2] === "verify",
      ),
    ).to.have.lengthOf(1);
    expect(
      fake.calls.filter(
        ({ executable, args }) =>
          executable === process.execPath &&
          args[0]?.endsWith(nativeToolchainPath(ZK_TOOLCHAIN_PATHS.snarkjsCli)) &&
          args[1] === "zkey" &&
          args[2] === "verify",
      ),
    ).to.have.lengthOf(2);
    expect(result).to.deep.equal({
      status: "passed",
      releaseCommit: COMMIT,
      zkCeremonyId: fixture.manifest.trustedSetup.ceremonyId,
      zkTrustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
      zkContributorCount: MINIMUM_PRODUCTION_CONTRIBUTORS,
      zkMinimumContributors: MINIMUM_PRODUCTION_CONTRIBUTORS,
      zkManifestSha256: sha256File(fixture.manifestPath),
      zkTranscriptSha256: fixture.manifest.trustedSetup.transcript.sha256,
      protocolManifestSha256: "cd".repeat(32),
      ptauSha256: fixture.manifest.trustedSetup.phase1.sha256,
      checks: RELEASE_PREFLIGHT_COMMANDS.map(
        ([executable, args]) => `${executable} ${args.join(" ")}`,
      ),
    });
  });

  it("rejects an initially dirty Git working tree before npm or ZK verification", async function () {
    const fixture = await productionFixture();
    const fake = createFakeRunner({ statuses: [" M contracts/DeepFamily.sol"] });
    let compilerInspected = false;

    const error = await captureError(() =>
      runWithFixtureCompiler({
        root: fixture.root,
        platform: "linux",
        arch: "x64",
        expectedProductionPhase1: fixture.expectedProductionPhase1,
        ptauPath: fixture.ptauPath,
        compilerInspector: async () => {
          compilerInspected = true;
          throw new Error("compiler inspection must not run");
        },
        runner: fake.runner,
      }),
    );
    expect(error?.message).to.equal(
      "Release preflight requires a clean Git working tree (before checks)",
    );
    expect(compilerInspected).to.equal(false);

    expect(fake.calls.map(commandLabel)).to.deep.equal([
      "git rev-parse HEAD",
      "git status --porcelain=v1 --untracked-files=all",
    ]);
  });

  it("rejects a release commit that changes while checks are running", async function () {
    const fixture = await productionFixture();
    const fake = createFakeRunner({ commits: [COMMIT, CHANGED_COMMIT] });

    const error = await captureError(() =>
      runWithFixtureCompiler({
        root: fixture.root,
        platform: "linux",
        arch: "x64",
        expectedProductionPhase1: fixture.expectedProductionPhase1,
        ptauPath: fixture.ptauPath,
        runner: fake.runner,
        mpcMetadataReader: metadataReaderFor(fixture),
      }),
    );
    expect(error?.message).to.equal("Release commit changed while preflight was running");

    expect(fake.calls.filter(({ executable }) => executable === "npm")).to.have.lengthOf(
      RELEASE_PREFLIGHT_COMMANDS.length,
    );
  });

  it("rejects a manifest that changes after ceremony verification", async function () {
    const fixture = await productionFixture();
    const fake = createFakeRunner({
      onInvocation: (_invocation, state) => {
        if (state.kind === "status" && state.index === 1) {
          const changed = JSON.parse(fsSync.readFileSync(fixture.manifestPath, "utf8"));
          changed.trustedSetup.warning =
            "Changed trust warning after ceremony verification must invalidate preflight.";
          fsSync.writeFileSync(fixture.manifestPath, `${JSON.stringify(changed, null, 2)}\n`);
        }
      },
    });

    const error = await captureError(() =>
      runWithFixtureCompiler({
        root: fixture.root,
        platform: "linux",
        arch: "x64",
        expectedProductionPhase1: fixture.expectedProductionPhase1,
        ptauPath: fixture.ptauPath,
        runner: fake.runner,
        mpcMetadataReader: metadataReaderFor(fixture),
      }),
    );
    expect(error?.message).to.equal(
      "ZK artifact manifest changed while release preflight was running",
    );
  });

  it("rejects an artifact that changes after ceremony verification", async function () {
    const fixture = await productionFixture();
    const zkeyPath = artifactPath(fixture.root, ZK_RELEASE_ARTIFACTS.person_commitment.zkey);
    const fake = createFakeRunner({
      onInvocation: (_invocation, state) => {
        if (state.kind === "status" && state.index === 1) {
          fsSync.appendFileSync(zkeyPath, "tampered");
        }
      },
    });

    const error = await captureError(() =>
      runWithFixtureCompiler({
        root: fixture.root,
        platform: "linux",
        arch: "x64",
        expectedProductionPhase1: fixture.expectedProductionPhase1,
        ptauPath: fixture.ptauPath,
        runner: fake.runner,
        mpcMetadataReader: metadataReaderFor(fixture),
      }),
    );
    expect(error?.message).to.match(/person_commitment zkey SHA-256 mismatch/u);
  });

  it("falls back to the pinned cache and fails closed when it is unavailable", async function () {
    const fixture = await productionFixture();
    const fake = createFakeRunner();
    const previousPtauPath = process.env.ZK_PTAU_PATH;
    delete process.env.ZK_PTAU_PATH;

    try {
      const error = await captureError(() =>
        runWithFixtureCompiler({
          root: fixture.root,
          platform: "linux",
          arch: "x64",
          expectedProductionPhase1: fixture.expectedProductionPhase1,
          runner: fake.runner,
          mpcMetadataReader: metadataReaderFor(fixture),
        }),
      );
      expect(error?.message).to.match(
        /Published Powers of Tau is unavailable:.*tmp[\\/]zk-production/u,
      );
    } finally {
      if (previousPtauPath === undefined) delete process.env.ZK_PTAU_PATH;
      else process.env.ZK_PTAU_PATH = previousPtauPath;
    }
  });
});
