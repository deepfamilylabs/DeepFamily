import { expect } from "chai";
import { ethers } from "ethers";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MINIMUM_PRODUCTION_CONTRIBUTORS,
  ZK_ARTIFACT_MANIFEST_PATH,
  ZK_CEREMONY_TRANSCRIPT_PATH,
  ZK_RELEASE_ARTIFACTS,
  ZK_TOOLCHAIN_PATHS,
  buildZkContributionApprovalMessage,
  inspectZkReleaseArtifacts,
  sha256File,
  sha256Text,
} from "../scripts/lib/zkArtifactTrust.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-zk-artifact-trust-"));
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
    "node_modules/snarkjs/build/cli.cjs",
    "fixture snarkjs CLI\n",
  );
  const snarkjsLink = artifactPath(root, ZK_TOOLCHAIN_PATHS.snarkjsBinary);
  await fs.mkdir(path.dirname(snarkjsLink), { recursive: true });
  await fs.symlink(path.relative(path.dirname(snarkjsLink), snarkjsCli), snarkjsLink);

  const ceremonyId = "deepfamily-production-2026-01";
  const phase1Sha256 = sha256Text("published-powers-of-tau");
  const transcriptCircuits = Object.fromEntries(
    Object.entries(circuits).map(([name, hashes]) => [
      name,
      { sourceSha256: hashes.sourceSha256, r1csSha256: hashes.r1csSha256 },
    ]),
  );
  const wallets = Array.from(
    { length: MINIMUM_PRODUCTION_CONTRIBUTORS },
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
      signerAddress: wallet.address,
      personCommitmentContributionHash: `${String(index + 1).padStart(2, "0")}`.repeat(64),
      disclosureBindingContributionHash: `${String(index + 11).padStart(2, "0")}`.repeat(64),
      personCommitmentZkeySha256: sha256Text(`person-contribution-${index + 1}`),
      disclosureBindingZkeySha256: sha256Text(`disclosure-contribution-${index + 1}`),
    };
    contributions.push({
      ...contribution,
      signature: await wallet.signMessage(
        buildZkContributionApprovalMessage({
          ceremonyId,
          phase1Sha256,
          circuits: transcriptCircuits,
          contribution,
        }),
      ),
    });
  }
  const beacon = {
    name: "deepfamily-public-beacon",
    hash: sha256Text("public-randomness-beacon"),
    numIterationsExp: 10,
    source: "public-randomness-round-12345",
    personCommitmentContributionHash: "aa".repeat(64),
    disclosureBindingContributionHash: "bb".repeat(64),
  };
  const transcript = {
    schemaVersion: 1,
    ceremonyId,
    phase1Sha256,
    circuits: transcriptCircuits,
    contributions,
    beacon,
  };
  const transcriptPath = await writeTranscript(root, transcript);
  const manifest = {
    schemaVersion: 2,
    circomVersion: "2.1.6",
    snarkjsVersion: "0.7.5",
    toolchain: {
      circomBinarySha256: sha256File(circomBinary),
      snarkjsCliSha256: sha256File(snarkjsCli),
    },
    trustedSetup: {
      status: "production",
      ceremonyId,
      minimumContributors: MINIMUM_PRODUCTION_CONTRIBUTORS,
      contributorCount: contributions.length,
      phase1: {
        source: "https://example.invalid/powers-of-tau",
        sha256: phase1Sha256,
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
  return { root, manifest, transcript };
};

const inspectProductionFixture = (root) =>
  inspectZkReleaseArtifacts({
    root,
    requireProduction: true,
    requireBuiltR1cs: true,
  });

describe("ZK artifact trust", function () {
  it("accepts the checked-in development manifest and artifacts but blocks production use", function () {
    const result = inspectZkReleaseArtifacts({ root: PROJECT_ROOT });

    expect(result).to.include({
      status: "passed",
      schemaVersion: 2,
      trustedSetupStatus: "development",
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
        root: PROJECT_ROOT,
        requireProduction: true,
      }),
    ).to.throw("Production release is blocked");
  });

  describe("production manifest fixtures", function () {
    let fixture;

    beforeEach(async function () {
      fixture = await createProductionFixture();
    });

    afterEach(async function () {
      await fs.rm(fixture.root, { recursive: true, force: true });
    });

    it("accepts a production manifest with three independent contributors and a beacon", function () {
      const result = inspectProductionFixture(fixture.root);

      expect(result).to.include({
        status: "passed",
        schemaVersion: 2,
        trustedSetupStatus: "production",
        productionReady: true,
        ceremonyId: "deepfamily-production-2026-01",
        contributorCount: MINIMUM_PRODUCTION_CONTRIBUTORS,
        minimumContributors: MINIMUM_PRODUCTION_CONTRIBUTORS,
        beaconApplied: true,
        transcriptSha256: fixture.manifest.trustedSetup.transcript.sha256,
      });
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

    it("rejects a production ceremony with fewer than three contributors", async function () {
      fixture.manifest.trustedSetup.contributorCount = 2;
      fixture.transcript.contributions = fixture.transcript.contributions.slice(0, 2);
      const transcriptPath = await writeTranscript(fixture.root, fixture.transcript);
      fixture.manifest.trustedSetup.transcript.sha256 = sha256File(transcriptPath);
      await writeManifest(fixture.root, fixture.manifest);

      expect(() => inspectProductionFixture(fixture.root)).to.throw(
        "production trustedSetup requires at least 3 contributors",
      );
    });

    it("rejects repeated participant identities", async function () {
      fixture.transcript.contributions[1].participantId =
        fixture.transcript.contributions[0].participantId;
      const transcriptPath = await writeTranscript(fixture.root, fixture.transcript);
      fixture.manifest.trustedSetup.transcript.sha256 = sha256File(transcriptPath);
      await writeManifest(fixture.root, fixture.manifest);

      expect(() => inspectProductionFixture(fixture.root)).to.throw(
        "ZK ceremony transcript participant identities must be unique",
      );
    });

    it("rejects a production manifest without beacon evidence", async function () {
      delete fixture.manifest.trustedSetup.beacon;
      await writeManifest(fixture.root, fixture.manifest);

      expect(() => inspectProductionFixture(fixture.root)).to.throw(
        /trustedSetup must contain exactly:.*beacon/u,
      );
    });

    it("rejects a byte-tampered artifact even when the manifest is unchanged", async function () {
      await fs.appendFile(
        artifactPath(fixture.root, ZK_RELEASE_ARTIFACTS.person_commitment.zkey),
        "tampered",
      );

      expect(() => inspectProductionFixture(fixture.root)).to.throw(
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

      expect(() => inspectProductionFixture(fixture.root)).to.throw(
        /disclosure_binding WASM must be a regular non-symlink file/u,
      );
    });

    it("rejects unknown manifest fields at strict schema boundaries", async function () {
      fixture.manifest.unreviewedField = true;
      await writeManifest(fixture.root, fixture.manifest);

      expect(() => inspectProductionFixture(fixture.root)).to.throw(
        /ZK artifact manifest must contain exactly/u,
      );
    });

    it("rejects malformed hashes and unavailable artifact paths", async function () {
      fixture.manifest.circuits.person_commitment.sourceSha256 = "NOT-A-SHA256";
      await writeManifest(fixture.root, fixture.manifest);
      expect(() => inspectProductionFixture(fixture.root)).to.throw(
        "circuits.person_commitment.sourceSha256 must be a lowercase SHA-256 digest",
      );

      fixture.manifest.circuits.person_commitment.sourceSha256 = sha256File(
        artifactPath(fixture.root, ZK_RELEASE_ARTIFACTS.person_commitment.source),
      );
      await writeManifest(fixture.root, fixture.manifest);
      await fs.rm(artifactPath(fixture.root, ZK_RELEASE_ARTIFACTS.person_commitment.source));
      expect(() => inspectProductionFixture(fixture.root)).to.throw(
        /person_commitment source is unavailable/u,
      );
    });
  });
});
