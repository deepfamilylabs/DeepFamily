import { expect } from "chai";
import { ethers } from "ethers";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { CIRCOM_VERSION, resolveCircomTargetPolicy } from "../scripts/lib/circomToolchain.mjs";
import {
  MINIMUM_MULTI_PARTY_CONTRIBUTORS,
  MINIMUM_PRODUCTION_CONTRIBUTORS,
  ZK_ARTIFACT_MANIFEST_PATH,
  ZK_CEREMONY_TRANSCRIPT_PATH,
  ZK_PRODUCTION_PHASE1,
  ZK_RELEASE_ARTIFACTS,
  ZK_TOOLCHAIN_PATHS,
  ZK_TRUST_MODEL_MULTI_PARTY,
  ZK_TRUST_MODEL_SINGLE_OPERATOR,
  buildZkContributionApprovalMessage,
  inspectZkReleaseArtifacts,
  readCanonicalJsonFile,
  sha256File,
  sha256Text,
} from "../scripts/lib/zkArtifactTrust.mjs";
import { SNARKJS_CLI_PATH, inspectSnarkjsRuntime } from "../scripts/lib/snarkjsToolchain.mjs";
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

const createProductionFixture = async ({
  trustModel = ZK_TRUST_MODEL_SINGLE_OPERATOR,
  contributorCount = trustModel === ZK_TRUST_MODEL_SINGLE_OPERATOR
    ? MINIMUM_PRODUCTION_CONTRIBUTORS
    : MINIMUM_MULTI_PARTY_CONTRIBUTORS,
  singleOperatorSchemaVersion = 3,
  compilerRuntime = { platform: "linux", arch: "x64" },
} = {}) => {
  const root = await createCanonicalTemporaryDirectory("deepfamily-zk-artifact-trust-");
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
    const hashes = {};
    for (const [manifestField, relativePath] of Object.entries(files)) {
      const target = await writeRelativeFile(
        root,
        relativePath,
        `${circuitName}:${manifestField}:production-fixture\n`,
      );
      hashes[manifestField] = sha256File(target);
    }
    circuits[circuitName] = hashes;
  }

  const circomBinary = await writeRelativeFile(
    root,
    ZK_TOOLCHAIN_PATHS.circomBinary,
    "fixture circom binary\n",
  );
  const snarkjsCli = await writeRelativeFile(
    root,
    ZK_TOOLCHAIN_PATHS.snarkjsCli,
    "fixture snarkjs CLI\n",
  );
  await writeRelativeFile(
    root,
    "node_modules/snarkjs/package.json",
    `${JSON.stringify({
      name: "snarkjs",
      version: "0.7.5",
      main: "build/cli.cjs",
      dependencies: { "fixture-snark-dependency": "1.0.0" },
    })}\n`,
  );
  await writeRelativeFile(
    root,
    "node_modules/fixture-snark-dependency/package.json",
    `${JSON.stringify({
      name: "fixture-snark-dependency",
      version: "1.0.0",
      main: "index.js",
    })}\n`,
  );
  await writeRelativeFile(
    root,
    "node_modules/fixture-snark-dependency/index.js",
    "module.exports = 'fixture runtime dependency';\n",
  );

  const ceremonyId = "deepfamily-production-2026-01";
  const phase1Contents = "published-powers-of-tau";
  const phase1Sha256 = sha256Text(phase1Contents);
  const phase1Blake2b512 = createHash("blake2b512").update(phase1Contents).digest("hex");
  const expectedProductionPhase1 = {
    source: "https://example.invalid/powers-of-tau",
    bytes: Buffer.byteLength(phase1Contents),
    sha256: phase1Sha256,
    blake2b512: phase1Blake2b512,
  };
  const transcriptCircuits = Object.fromEntries(
    Object.entries(circuits).map(([name, hashes]) => [
      name,
      { sourceSha256: hashes.sourceSha256, r1csSha256: hashes.r1csSha256 },
    ]),
  );
  const wallets = Array.from(
    { length: contributorCount },
    (_, index) =>
      new ethers.Wallet(
        `0x${String(index + 1)
          .padStart(2, "0")
          .repeat(32)}`,
      ),
  );
  const contributions = [];
  for (const [index, wallet] of wallets.entries()) {
    const contribution = {
      sequence: index + 1,
      participantId: `participant-${index + 1}`,
      personCommitmentContributionHash: `${String(index + 1).padStart(2, "0")}`.repeat(64),
      disclosureBindingContributionHash: `${String(index + 11).padStart(2, "0")}`.repeat(64),
    };
    if (trustModel === ZK_TRUST_MODEL_MULTI_PARTY) {
      const signedContribution = {
        ...contribution,
        personCommitmentZkeySha256: sha256Text(`person-contribution-${index + 1}`),
        disclosureBindingZkeySha256: sha256Text(`disclosure-contribution-${index + 1}`),
        signerAddress: wallet.address,
      };
      contributions.push({
        ...signedContribution,
        signature: await wallet.signMessage(
          buildZkContributionApprovalMessage({
            ceremonyId,
            phase1Sha256,
            circuits: transcriptCircuits,
            contribution: signedContribution,
          }),
        ),
      });
    } else {
      contributions.push(contribution);
    }
  }
  const beacon = {
    name: "deepfamily-public-beacon",
    hash: sha256Text("public-randomness-beacon"),
    numIterationsExp: 10,
    source: "public-randomness-round-12345",
    personCommitmentContributionHash: "aa".repeat(64),
    disclosureBindingContributionHash: "bb".repeat(64),
  };
  const compilerTarget = resolveCircomTargetPolicy({
    version: CIRCOM_VERSION,
    ...compilerRuntime,
  });
  const compiler = {
    version: CIRCOM_VERSION,
    target: compilerTarget.id,
    platform: compilerTarget.platform,
    arch: compilerTarget.arch,
    strategy: compilerTarget.strategy,
    binarySha256:
      compilerTarget.strategy === "official-binary"
        ? compilerTarget.sha256
        : sha256Text(`source-built-${compilerTarget.id}`),
    libcEvidence: compilerTarget.libcEvidence ?? null,
    sourceBuild:
      compilerTarget.strategy === "pinned-source"
        ? {
            repository: compilerTarget.repository,
            commit: compilerTarget.commit,
            cargoVersion: "cargo 1.88.0 fixture",
            rustcVersion: "rustc 1.88.0 fixture",
          }
        : null,
  };
  const transcript = {
    schemaVersion: trustModel === ZK_TRUST_MODEL_SINGLE_OPERATOR ? singleOperatorSchemaVersion : 1,
    ...(trustModel === ZK_TRUST_MODEL_SINGLE_OPERATOR ? { trustModel } : {}),
    ...(trustModel === ZK_TRUST_MODEL_SINGLE_OPERATOR && singleOperatorSchemaVersion === 3
      ? { compiler }
      : {}),
    ceremonyId,
    phase1Sha256,
    circuits: transcriptCircuits,
    contributions,
    beacon,
  };
  const transcriptPath = await writeTranscript(root, transcript);
  const manifest = {
    schemaVersion: 3,
    circomVersion: "2.1.6",
    snarkjsVersion: "0.7.5",
    toolchain: {
      circomBinarySha256: sha256File(circomBinary),
      snarkjsCliSha256: sha256File(snarkjsCli),
      snarkjsRuntimeSha256: inspectSnarkjsRuntime({ root }).sha256,
    },
    trustedSetup: {
      status: "production",
      trustModel,
      warning:
        trustModel === ZK_TRUST_MODEL_SINGLE_OPERATOR
          ? "Single operator must destroy every circuit-specific Phase 2 secret."
          : "Multiple contributors must independently destroy their Phase 2 secrets.",
      ceremonyId,
      minimumContributors:
        trustModel === ZK_TRUST_MODEL_SINGLE_OPERATOR
          ? MINIMUM_PRODUCTION_CONTRIBUTORS
          : MINIMUM_MULTI_PARTY_CONTRIBUTORS,
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
  return { root, manifest, transcript, compiler, expectedProductionPhase1 };
};

const inspectProductionFixture = (fixture) =>
  inspectZkReleaseArtifacts({
    root: fixture.root,
    requireProduction: true,
    requireBuiltR1cs: true,
    expectedProductionPhase1: fixture.expectedProductionPhase1,
  });

describe("ZK artifact trust", function () {
  it("accepts an explicit development manifest and artifacts but blocks production use", async function () {
    const fixture = await createProductionFixture();
    try {
      fixture.manifest.trustedSetup = {
        status: "development",
        trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
        warning:
          "Single local contributor with public fixed entropy; development and testing only.",
        minimumContributors: MINIMUM_PRODUCTION_CONTRIBUTORS,
        contributorCount: 1,
        beaconApplied: false,
        transcriptSha256: null,
      };
      await writeManifest(fixture.root, fixture.manifest);
      const result = inspectZkReleaseArtifacts({ root: fixture.root });

      expect(result).to.include({
        status: "passed",
        schemaVersion: 3,
        trustedSetupStatus: "development",
        trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
        productionReady: false,
        ceremonyId: null,
        contributorCount: 1,
        minimumContributors: MINIMUM_PRODUCTION_CONTRIBUTORS,
        beaconApplied: false,
        transcriptSha256: null,
      });
      expect(result.artifacts).to.have.keys(Object.keys(ZK_RELEASE_ARTIFACTS));
      expect(() =>
        inspectZkReleaseArtifacts({
          root: fixture.root,
          requireProduction: true,
        }),
      ).to.throw("Production release is blocked");
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  describe("production manifest fixtures", function () {
    let fixture;

    beforeEach(async function () {
      fixture = await createProductionFixture();
    });

    afterEach(async function () {
      await fs.rm(fixture.root, { recursive: true, force: true });
    });

    const replaceFixture = async (options) => {
      await fs.rm(fixture.root, { recursive: true, force: true });
      fixture = await createProductionFixture(options);
    };

    it("accepts a schema-v3 single-operator transcript with compiler evidence", function () {
      const result = inspectProductionFixture(fixture);

      expect(result).to.include({
        status: "passed",
        schemaVersion: 3,
        trustedSetupStatus: "production",
        trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
        productionReady: true,
        ceremonyId: "deepfamily-production-2026-01",
        contributorCount: MINIMUM_PRODUCTION_CONTRIBUTORS,
        minimumContributors: MINIMUM_PRODUCTION_CONTRIBUTORS,
        beaconApplied: true,
        transcriptSha256: fixture.manifest.trustedSetup.transcript.sha256,
      });
      expect(fixture.transcript.contributions[0]).to.have.keys([
        "sequence",
        "participantId",
        "personCommitmentContributionHash",
        "disclosureBindingContributionHash",
      ]);
      expect(fixture.transcript.schemaVersion).to.equal(3);
      expect(fixture.transcript.compiler).to.deep.equal(fixture.compiler);
      expect(result.compiler).to.deep.equal(fixture.compiler);
      expect(result.transcript.record.compiler).to.deep.equal(fixture.compiler);
      expect(result.toolchain.snarkjs).to.deep.include({
        path: SNARKJS_CLI_PATH,
        sha256: fixture.manifest.toolchain.snarkjsCliSha256,
      });
      expect(result.toolchain.snarkjsRuntime.sha256).to.equal(
        fixture.manifest.toolchain.snarkjsRuntimeSha256,
      );
      for (const artifact of Object.values(result.artifacts)) {
        expect(artifact).to.have.keys([
          "source",
          "r1cs",
          "wasm",
          "zkey",
          "verificationKey",
          "solidityVerifier",
        ]);
        for (const evidence of Object.values(artifact)) {
          expect(evidence.sha256).to.match(/^[0-9a-f]{64}$/u);
          expect(evidence.bytes).to.be.greaterThan(0);
        }
      }
    });

    it("accepts canonical CRLF checkout text with LF-normalized evidence hashes", async function () {
      const transcriptLf = `${JSON.stringify(fixture.transcript, null, 2)}\n`;
      const manifestLf = `${JSON.stringify(fixture.manifest, null, 2)}\n`;
      const expectedTranscriptSha256 = sha256Text(transcriptLf);
      const expectedManifestSha256 = sha256Text(manifestLf);
      const manifestPath = artifactPath(fixture.root, ZK_ARTIFACT_MANIFEST_PATH);
      const transcriptPath = artifactPath(fixture.root, ZK_CEREMONY_TRANSCRIPT_PATH);

      expect(fixture.manifest.trustedSetup.transcript.sha256).to.equal(expectedTranscriptSha256);
      for (const spec of Object.values(ZK_RELEASE_ARTIFACTS)) {
        for (const relativePath of [spec.source, spec.verificationKey, spec.solidityVerifier]) {
          const filePath = artifactPath(fixture.root, relativePath);
          const lf = await fs.readFile(filePath, "utf8");
          await fs.writeFile(filePath, lf.replaceAll("\n", "\r\n"));
        }
      }
      await fs.writeFile(transcriptPath, transcriptLf.replaceAll("\n", "\r\n"));
      await fs.writeFile(manifestPath, manifestLf.replaceAll("\n", "\r\n"));

      const result = inspectProductionFixture(fixture);
      expect(readCanonicalJsonFile(manifestPath).raw).to.equal(manifestLf);
      expect(readCanonicalJsonFile(transcriptPath).raw).to.equal(transcriptLf);
      expect(result.manifestSha256).to.equal(expectedManifestSha256);
      expect(result.transcriptSha256).to.equal(expectedTranscriptSha256);
      expect(result.transcript.sha256).to.equal(expectedTranscriptSha256);
      expect(result.transcript.bytes).to.equal(Buffer.byteLength(transcriptLf));
    });

    it("rejects non-canonical indentation and duplicate JSON keys", async function () {
      const manifestPath = artifactPath(fixture.root, ZK_ARTIFACT_MANIFEST_PATH);
      const invalidDocuments = [
        `${JSON.stringify(fixture.manifest)}\n`,
        '{\n  "schemaVersion": 2,\n  "schemaVersion": 2\n}\n',
      ];

      for (const contents of invalidDocuments) {
        await fs.writeFile(manifestPath, contents);
        expect(() => readCanonicalJsonFile(manifestPath, "fixture JSON")).to.throw(
          "fixture JSON must use canonical two-space JSON with one trailing newline and no duplicate keys",
        );
      }
    });

    it("rejects mixed line endings and isolated carriage returns", async function () {
      const manifestPath = artifactPath(fixture.root, ZK_ARTIFACT_MANIFEST_PATH);
      const manifestLf = `${JSON.stringify(fixture.manifest, null, 2)}\n`;
      const invalidDocuments = [manifestLf.replace("\n", "\r\n"), manifestLf.replace("\n", "\r")];

      for (const contents of invalidDocuments) {
        await fs.writeFile(manifestPath, contents);
        expect(() => readCanonicalJsonFile(manifestPath, "fixture JSON")).to.throw(
          "fixture JSON must use uniform LF or CRLF line endings",
        );
      }
    });

    it("continues to accept a legacy schema-v2 single-operator transcript", async function () {
      await replaceFixture({ singleOperatorSchemaVersion: 2 });

      const result = inspectProductionFixture(fixture);

      expect(fixture.transcript).not.to.have.property("compiler");
      expect(result.compiler).to.equal(null);
      expect(result.transcript.record.compiler).to.equal(null);
    });

    it("can inspect a legacy schema-v2 manifest without claiming runtime-graph evidence", async function () {
      fixture.manifest.schemaVersion = 2;
      delete fixture.manifest.toolchain.snarkjsRuntimeSha256;
      await writeManifest(fixture.root, fixture.manifest);

      const result = inspectProductionFixture(fixture);

      expect(result.schemaVersion).to.equal(2);
      expect(result.toolchain.snarkjsRuntime).to.equal(null);
    });

    it("validates schema-v3 compiler evidence for every supported Circom 2.1.6 target", async function () {
      for (const compilerRuntime of [
        { platform: "linux", arch: "x64", libc: "glibc" },
        { platform: "darwin", arch: "arm64" },
        { platform: "win32", arch: "x64" },
      ]) {
        await replaceFixture({ compilerRuntime });
        const result = inspectProductionFixture(fixture);

        expect(result.compiler).to.deep.equal(fixture.compiler);
      }
    });

    it("rejects source-build compiler evidence that is not bound to the pinned commit", async function () {
      await replaceFixture({ compilerRuntime: { platform: "darwin", arch: "arm64" } });
      fixture.transcript.compiler.sourceBuild.commit = "0".repeat(40);
      const transcriptPath = await writeTranscript(fixture.root, fixture.transcript);
      fixture.manifest.trustedSetup.transcript.sha256 = sha256File(transcriptPath);
      await writeManifest(fixture.root, fixture.manifest);

      expect(() => inspectProductionFixture(fixture)).to.throw(
        "compiler.sourceBuild does not match the pinned source",
      );
    });

    it("rejects invalid schema-v3 compiler identity, digest, and version evidence", async function () {
      const originalCompiler = structuredClone(fixture.compiler);
      const rewriteTranscript = async () => {
        const transcriptPath = await writeTranscript(fixture.root, fixture.transcript);
        fixture.manifest.trustedSetup.transcript.sha256 = sha256File(transcriptPath);
        await writeManifest(fixture.root, fixture.manifest);
      };

      fixture.transcript.compiler.binarySha256 = "00".repeat(32);
      await rewriteTranscript();
      expect(() => inspectProductionFixture(fixture)).to.throw(
        "official compiler binarySha256 does not match the pinned target",
      );

      fixture.transcript.compiler.binarySha256 = originalCompiler.binarySha256;
      fixture.transcript.compiler.libcEvidence = {
        ...fixture.transcript.compiler.libcEvidence,
        family: "uclibc",
      };
      await rewriteTranscript();
      expect(() => inspectProductionFixture(fixture)).to.throw(
        "compiler.libcEvidence.family must be glibc or musl",
      );

      fixture.transcript.compiler.libcEvidence = originalCompiler.libcEvidence;
      fixture.transcript.compiler.version = "2.1.5";
      await rewriteTranscript();
      expect(() => inspectProductionFixture(fixture)).to.throw(
        "compiler version does not match the manifest",
      );

      fixture.transcript.compiler.version = originalCompiler.version;
      fixture.transcript.compiler.platform = "freebsd";
      fixture.transcript.compiler.libcEvidence = null;
      await rewriteTranscript();
      expect(() => inspectProductionFixture(fixture)).to.throw("Unsupported Circom host");
    });

    it("rejects a symbolic link in place of the real snarkjs package CLI", async function () {
      const cliPath = artifactPath(fixture.root, ZK_TOOLCHAIN_PATHS.snarkjsCli);
      const contents = await fs.readFile(cliPath);
      const target = await writeRelativeFile(
        fixture.root,
        "node_modules/snarkjs/build/fixture-cli-target.cjs",
        contents,
      );
      await fs.rm(cliPath);
      await fs.symlink(path.relative(path.dirname(cliPath), target), cliPath);

      expect(() => inspectProductionFixture(fixture)).to.throw(
        /Installed snarkjs CLI must be a regular non-symlink file/u,
      );
    });

    it("rejects tampering anywhere in the snarkjs production dependency closure", async function () {
      await writeRelativeFile(
        fixture.root,
        "node_modules/fixture-snark-dependency/index.js",
        "module.exports = 'tampered runtime dependency';\n",
      );

      expect(() => inspectProductionFixture(fixture)).to.throw(
        "Installed snarkjs runtime SHA-256 mismatch",
      );
    });

    it("rejects fixture Phase 1 metadata unless the caller supplies the exact expected production identity", function () {
      expect(fixture.manifest.trustedSetup.phase1.source).not.to.equal(ZK_PRODUCTION_PHASE1.source);
      expect(() =>
        inspectZkReleaseArtifacts({
          root: fixture.root,
          requireProduction: true,
          requireBuiltR1cs: true,
        }),
      ).to.throw("trustedSetup.phase1.source does not match the pinned production Powers of Tau");
    });

    it("rejects a single-operator manifest whose declared contributor count is not exactly one", async function () {
      fixture.manifest.trustedSetup.contributorCount = 2;
      await writeManifest(fixture.root, fixture.manifest);

      expect(() => inspectProductionFixture(fixture)).to.throw(
        "production trustedSetup single-operator trustModel requires exactly one declared contributor",
      );
    });

    it("accepts a multi-party schema-v1 transcript with two distinct EIP-191 signers", async function () {
      await replaceFixture({ trustModel: ZK_TRUST_MODEL_MULTI_PARTY });

      const result = inspectProductionFixture(fixture);

      expect(result).to.include({
        trustModel: ZK_TRUST_MODEL_MULTI_PARTY,
        contributorCount: MINIMUM_MULTI_PARTY_CONTRIBUTORS,
        minimumContributors: MINIMUM_MULTI_PARTY_CONTRIBUTORS,
      });
      expect(fixture.transcript.schemaVersion).to.equal(1);
      expect(fixture.transcript).not.to.have.property("trustModel");
      expect(fixture.transcript.contributions).to.have.lengthOf(MINIMUM_MULTI_PARTY_CONTRIBUTORS);
      for (const [index, contribution] of fixture.transcript.contributions.entries()) {
        expect(contribution.signerAddress).to.match(/^0x[0-9a-fA-F]{40}$/u);
        expect(contribution.signature).to.match(/^0x[0-9a-f]{130}$/u);
        expect(contribution.personCommitmentZkeySha256).to.match(/^[0-9a-f]{64}$/u);
        expect(contribution.disclosureBindingZkeySha256).to.match(/^[0-9a-f]{64}$/u);
        expect(result.contributions[index].approvalMessageHash).to.match(/^0x[0-9a-f]{64}$/u);
      }
    });

    it("rejects multi-party contributor counts below two or below the declared minimum", async function () {
      await replaceFixture({ trustModel: ZK_TRUST_MODEL_MULTI_PARTY });
      fixture.manifest.trustedSetup.minimumContributors = 1;
      fixture.manifest.trustedSetup.contributorCount = 1;
      await writeManifest(fixture.root, fixture.manifest);

      expect(() => inspectProductionFixture(fixture)).to.throw(
        "production trustedSetup multi-party trustModel requires at least 2 contributors",
      );
    });

    it("rejects repeated participant identities", async function () {
      await replaceFixture({ trustModel: ZK_TRUST_MODEL_MULTI_PARTY });
      fixture.transcript.contributions[1].participantId =
        fixture.transcript.contributions[0].participantId;
      const transcriptPath = await writeTranscript(fixture.root, fixture.transcript);
      fixture.manifest.trustedSetup.transcript.sha256 = sha256File(transcriptPath);
      await writeManifest(fixture.root, fixture.manifest);

      expect(() => inspectProductionFixture(fixture)).to.throw(
        "ZK ceremony transcript participant identities must be unique",
      );
    });

    it("rejects a multi-party schema-v1 transcript with an invalid EIP-191 signature", async function () {
      await replaceFixture({ trustModel: ZK_TRUST_MODEL_MULTI_PARTY });
      fixture.transcript.contributions[1].signature = fixture.transcript.contributions[0].signature;
      const transcriptPath = await writeTranscript(fixture.root, fixture.transcript);
      fixture.manifest.trustedSetup.transcript.sha256 = sha256File(transcriptPath);
      await writeManifest(fixture.root, fixture.manifest);

      expect(() => inspectProductionFixture(fixture)).to.throw(
        "ZK ceremony transcript contributions[1].signature is not from signerAddress",
      );
    });

    it("rejects a production manifest without beacon evidence", async function () {
      delete fixture.manifest.trustedSetup.beacon;
      await writeManifest(fixture.root, fixture.manifest);

      expect(() => inspectProductionFixture(fixture)).to.throw(
        /trustedSetup must contain exactly:.*beacon/u,
      );
    });

    it("rejects a byte-tampered artifact even when the manifest is unchanged", async function () {
      await fs.appendFile(
        artifactPath(fixture.root, ZK_RELEASE_ARTIFACTS.person_commitment.zkey),
        "tampered",
      );

      expect(() => inspectProductionFixture(fixture)).to.throw(
        /person_commitment zkey SHA-256 mismatch/u,
      );
    });

    it("rejects an artifact supplied through a symbolic link", async function () {
      const wasmPath = artifactPath(fixture.root, ZK_RELEASE_ARTIFACTS.disclosure_binding.wasm);
      const contents = await fs.readFile(wasmPath);
      const symlinkTarget = await writeRelativeFile(
        fixture.root,
        "symlink-target/disclosure_binding.wasm",
        contents,
      );
      await fs.rm(wasmPath);
      await fs.symlink(path.relative(path.dirname(wasmPath), symlinkTarget), wasmPath);

      expect(() => inspectProductionFixture(fixture)).to.throw(
        /disclosure_binding WASM must be a regular non-symlink file/u,
      );
    });

    it("rejects unknown manifest fields at strict schema boundaries", async function () {
      fixture.manifest.unreviewedField = true;
      await writeManifest(fixture.root, fixture.manifest);

      expect(() => inspectProductionFixture(fixture)).to.throw(
        /ZK artifact manifest must contain exactly/u,
      );
    });

    it("rejects malformed hashes and unavailable artifact paths", async function () {
      fixture.manifest.circuits.person_commitment.sourceSha256 = "NOT-A-SHA256";
      await writeManifest(fixture.root, fixture.manifest);
      expect(() => inspectProductionFixture(fixture)).to.throw(
        "circuits.person_commitment.sourceSha256 must be a lowercase SHA-256 digest",
      );

      fixture.manifest.circuits.person_commitment.sourceSha256 = sha256File(
        artifactPath(fixture.root, ZK_RELEASE_ARTIFACTS.person_commitment.source),
      );
      await writeManifest(fixture.root, fixture.manifest);
      await fs.rm(artifactPath(fixture.root, ZK_RELEASE_ARTIFACTS.person_commitment.source));
      expect(() => inspectProductionFixture(fixture)).to.throw(
        /person_commitment source is unavailable/u,
      );
    });
  });
});
