import { expect } from "chai";
import { ethers } from "ethers";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
  sha256File,
  sha256Text,
} from "../scripts/lib/zkArtifactTrust.mjs";

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
} = {}) => {
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
  const transcript = {
    schemaVersion: trustModel === ZK_TRUST_MODEL_SINGLE_OPERATOR ? 2 : 1,
    ...(trustModel === ZK_TRUST_MODEL_SINGLE_OPERATOR ? { trustModel } : {}),
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
  return { root, manifest, transcript, expectedProductionPhase1 };
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
        schemaVersion: 2,
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

    it("accepts a single-operator production manifest with one contribution and a beacon", function () {
      const result = inspectProductionFixture(fixture);

      expect(result).to.include({
        status: "passed",
        schemaVersion: 2,
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
