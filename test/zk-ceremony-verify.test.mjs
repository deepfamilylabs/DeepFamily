import { expect } from "chai";
import fs from "node:fs/promises";
import path from "node:path";

import { verifyProductionCeremony } from "../scripts/zk-ceremony-verify.mjs";
import { CIRCOM_VERSION, resolveLocalCircomTarget } from "../scripts/lib/circomToolchain.mjs";
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
import { inspectSnarkjsRuntime, resolveSnarkjsCliPath } from "../scripts/lib/snarkjsToolchain.mjs";
import { createCanonicalTemporaryDirectory } from "./helpers/temporaryDirectory.mjs";

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
  const root = await createCanonicalTemporaryDirectory("deepfamily-zk-ceremony-verify-");
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
        `${circuitName}:${manifestField}:production-fixture\n`,
      );
      circuits[circuitName][manifestField] = sha256File(target);
    }
  }

  const ptauPath = await writeRelativeFile(
    root,
    "ceremony/published-final.ptau",
    "published powers of tau fixture\n",
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
  const compilerTarget = resolveLocalCircomTarget({
    platform: "linux",
    arch: "x64",
    libc: "glibc",
  });
  const compiler = {
    version: CIRCOM_VERSION,
    target: compilerTarget.id,
    platform: compilerTarget.platform,
    arch: compilerTarget.arch,
    strategy: compilerTarget.strategy,
    binarySha256: compilerTarget.sha256,
    libcEvidence: compilerTarget.libcEvidence,
    sourceBuild: null,
  };
  const transcript = {
    schemaVersion: 3,
    trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
    compiler,
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
  await writeManifest(root, manifest);

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
    transcript,
    compiler,
    ptauPath,
    snarkjsCli,
    metadataByCircuit,
    expectedProductionPhase1,
  };
};

const captureError = async (operation) => {
  try {
    await operation();
    return null;
  } catch (error) {
    return error;
  }
};

describe("production ZK ceremony verifier", function () {
  let fixture;

  beforeEach(async function () {
    fixture = await createProductionFixture();
  });

  afterEach(async function () {
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  it("runs one Powers of Tau verification and both exact R1CS/zkey binding checks", async function () {
    const calls = [];
    const root = await fs.realpath(fixture.root);
    const ptauPath = path.resolve(fixture.ptauPath);

    const result = await verifyProductionCeremony({
      root: fixture.root,
      expectedProductionPhase1: fixture.expectedProductionPhase1,
      ptauPath: fixture.ptauPath,
      runner: (invocation) => calls.push(invocation),
      mpcMetadataReader: async (zkeyPath) => {
        const circuitName = path.basename(zkeyPath, ".zkey");
        return fixture.metadataByCircuit[circuitName];
      },
    });

    expect(calls).to.have.length(3);
    const snapshotSnarkjsCli = calls[0].args[0];
    expect(
      calls.every(
        (call) =>
          call.executable === process.execPath &&
          call.args[0] === snapshotSnarkjsCli &&
          call.cwd === root,
      ),
    ).to.equal(true);
    expect(snapshotSnarkjsCli).not.to.equal(resolveSnarkjsCliPath({ root }));
    expect(snapshotSnarkjsCli.endsWith(ZK_TOOLCHAIN_PATHS.snarkjsCli)).to.equal(true);
    expect(calls[0].args.slice(1, 3)).to.deep.equal(["powersoftau", "verify"]);
    expect(path.basename(calls[0].args[3])).to.equal("phase1.ptau");
    for (const [index, circuitName] of Object.keys(ZK_RELEASE_ARTIFACTS).entries()) {
      expect(calls[index + 1].args.slice(1, 3)).to.deep.equal(["zkey", "verify"]);
      expect(path.basename(calls[index + 1].args[3])).to.equal(`${circuitName}.r1cs`);
      expect(path.basename(calls[index + 1].args[4])).to.equal("phase1.ptau");
      expect(path.basename(calls[index + 1].args[5])).to.equal(`${circuitName}.zkey`);
    }
    expect(result).to.deep.include({
      status: "passed",
      ceremonyId: fixture.manifest.trustedSetup.ceremonyId,
      transcriptSha256: fixture.manifest.trustedSetup.transcript.sha256,
      trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
      contributorCount: MINIMUM_PRODUCTION_CONTRIBUTORS,
      minimumContributors: MINIMUM_PRODUCTION_CONTRIBUTORS,
      compiler: fixture.compiler,
      circuits: Object.keys(ZK_RELEASE_ARTIFACTS),
    });
    expect(result.ptau).to.deep.equal({
      source: fixture.manifest.trustedSetup.phase1.source,
      path: ptauPath,
      bytes: fixture.manifest.trustedSetup.phase1.bytes,
      sha256: fixture.manifest.trustedSetup.phase1.sha256,
      blake2b512: fixture.manifest.trustedSetup.phase1.blake2b512,
    });
  });

  it("passes a sanitized environment to every snarkjs verification subprocess", async function () {
    const calls = [];
    await verifyProductionCeremony({
      root: fixture.root,
      expectedProductionPhase1: fixture.expectedProductionPhase1,
      ptauPath: fixture.ptauPath,
      env: {
        PATH: "/trusted/bin",
        RELEASE_VALUE: "preserved",
        NODE_OPTIONS: "--require=/untrusted/node-hook.cjs",
        node_path: "/untrusted/node-modules",
        LD_PRELOAD: "/untrusted/native-hook.so",
        dYlD_insert_libraries: "/untrusted/native-hook.dylib",
        NPM_CONFIG_SCRIPT_SHELL: "/untrusted/shell",
        npm_config_node_options: "--require=/untrusted/npm-hook.cjs",
        GIT_CONFIG_COUNT: "1",
        dotenv_config_path: "/untrusted/.env",
      },
      runner: (invocation) => calls.push(invocation),
      mpcMetadataReader: async (zkeyPath) =>
        fixture.metadataByCircuit[path.basename(zkeyPath, ".zkey")],
    });

    expect(calls).to.have.length(3);
    for (const invocation of calls) {
      expect(invocation.env).to.deep.equal({
        PATH: "/trusted/bin",
        RELEASE_VALUE: "preserved",
      });
      expect(Object.isFrozen(invocation.env)).to.equal(true);
    }
  });

  it("continues to verify a legacy schema-v2 single-operator transcript", async function () {
    fixture.transcript.schemaVersion = 2;
    delete fixture.transcript.compiler;
    const transcriptPath = await writeTranscript(fixture.root, fixture.transcript);
    fixture.manifest.trustedSetup.transcript.sha256 = sha256File(transcriptPath);
    await writeManifest(fixture.root, fixture.manifest);

    const result = await verifyProductionCeremony({
      root: fixture.root,
      expectedProductionPhase1: fixture.expectedProductionPhase1,
      ptauPath: fixture.ptauPath,
      runner: () => {},
      mpcMetadataReader: async (zkeyPath) =>
        fixture.metadataByCircuit[path.basename(zkeyPath, ".zkey")],
    });

    expect(result.compiler).to.equal(null);
  });

  it("rejects a Powers of Tau file whose bytes do not match the manifest", async function () {
    const calls = [];
    await fs.appendFile(fixture.ptauPath, "tampered");

    const error = await captureError(() =>
      verifyProductionCeremony({
        root: fixture.root,
        expectedProductionPhase1: fixture.expectedProductionPhase1,
        ptauPath: fixture.ptauPath,
        runner: (invocation) => calls.push(invocation),
      }),
    );
    expect(error?.message).to.match(/Published Powers of Tau SHA-256 mismatch/u);
    expect(calls).to.deep.equal([]);
  });

  it("rejects an installed snarkjs version that differs from the ceremony manifest", async function () {
    const calls = [];
    await writeRelativeFile(
      fixture.root,
      "node_modules/snarkjs/package.json",
      `${JSON.stringify({
        name: "snarkjs",
        version: "0.7.4",
        main: "build/cli.cjs",
      })}\n`,
    );
    fixture.manifest.toolchain.snarkjsRuntimeSha256 = inspectSnarkjsRuntime({
      root: fixture.root,
    }).sha256;
    await writeManifest(fixture.root, fixture.manifest);

    const error = await captureError(() =>
      verifyProductionCeremony({
        root: fixture.root,
        expectedProductionPhase1: fixture.expectedProductionPhase1,
        ptauPath: fixture.ptauPath,
        runner: (invocation) => calls.push(invocation),
      }),
    );
    expect(error?.message).to.equal(
      "Installed snarkjs 0.7.4 does not match ceremony manifest 0.7.5",
    );
    expect(calls).to.deep.equal([]);
  });

  it("propagates a runner failure and stops before later zkey checks", async function () {
    const calls = [];
    const runnerError = new Error("simulated snarkjs verification failure");
    let caught;

    try {
      await verifyProductionCeremony({
        root: fixture.root,
        expectedProductionPhase1: fixture.expectedProductionPhase1,
        ptauPath: fixture.ptauPath,
        runner: (invocation) => {
          calls.push(invocation);
          if (calls.length === 2) throw runnerError;
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).to.equal(runnerError);
    expect(calls).to.have.length(2);
    expect(calls[0].args.slice(1, 3)).to.deep.equal(["powersoftau", "verify"]);
    expect(calls[1].args.slice(1, 3)).to.deep.equal(["zkey", "verify"]);
  });

  it("rejects a Powers of Tau path that is a symbolic link", async function () {
    const calls = [];
    const originalContents = await fs.readFile(fixture.ptauPath);
    const target = await writeRelativeFile(
      fixture.root,
      "ceremony/published-final-target.ptau",
      originalContents,
    );
    await fs.rm(fixture.ptauPath);
    await fs.symlink(path.relative(path.dirname(fixture.ptauPath), target), fixture.ptauPath);

    const error = await captureError(() =>
      verifyProductionCeremony({
        root: fixture.root,
        expectedProductionPhase1: fixture.expectedProductionPhase1,
        ptauPath: fixture.ptauPath,
        runner: (invocation) => calls.push(invocation),
      }),
    );
    expect(error?.message).to.match(/Published Powers of Tau must be a regular non-symlink file/u);
    expect(calls).to.deep.equal([]);
  });

  it("rejects a final zkey whose embedded contribution chain omits participants", async function () {
    const error = await captureError(() =>
      verifyProductionCeremony({
        root: fixture.root,
        expectedProductionPhase1: fixture.expectedProductionPhase1,
        ptauPath: fixture.ptauPath,
        runner: () => {},
        mpcMetadataReader: async () => ({
          contributionCount: 1,
          contributions: [
            {
              type: 1,
              name: fixture.manifest.trustedSetup.beacon.name,
              contributionHash:
                fixture.manifest.trustedSetup.beacon.personCommitmentContributionHash,
              beaconHash: fixture.manifest.trustedSetup.beacon.hash,
              numIterationsExp: fixture.manifest.trustedSetup.beacon.numIterationsExp,
            },
          ],
        }),
      }),
    );
    expect(error?.message).to.include("must contain exactly 1 participant contributions");
  });

  it("rejects a mismatched embedded beacon even after mathematical runner checks pass", async function () {
    const error = await captureError(() =>
      verifyProductionCeremony({
        root: fixture.root,
        expectedProductionPhase1: fixture.expectedProductionPhase1,
        ptauPath: fixture.ptauPath,
        runner: () => {},
        mpcMetadataReader: async (zkeyPath) => {
          const circuitName = path.basename(zkeyPath, ".zkey");
          const metadata = structuredClone(fixture.metadataByCircuit[circuitName]);
          metadata.contributions.at(-1).beaconHash = "ff".repeat(32);
          return metadata;
        },
      }),
    );
    expect(error?.message).to.include("embedded beacon hash does not match");
  });
});
