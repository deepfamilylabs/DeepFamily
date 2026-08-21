import { expect } from "chai";
import fs from "node:fs/promises";
import path from "node:path";

import {
  FRESH_V1_DEVELOPMENT_WARNING,
  PRE_V1_CEREMONY_ID,
  PRE_V1_DEPRECATION_RECORD_PATH,
  PRE_V1_MANIFEST_ARCHIVE_PATH,
  PRE_V1_TRANSCRIPT_ARCHIVE_PATH,
  initializeFreshV1DevelopmentManifest,
  updateDevelopmentManifest,
} from "../scripts/update-zk-development-manifest.mjs";
import {
  MINIMUM_PRODUCTION_CONTRIBUTORS,
  ZK_ARTIFACT_MANIFEST_PATH,
  ZK_CEREMONY_TRANSCRIPT_PATH,
  ZK_PRODUCTION_PHASE1,
  ZK_RELEASE_ARTIFACTS,
  ZK_TOOLCHAIN_PATHS,
  ZK_TRUST_MODEL_SINGLE_OPERATOR,
  sha256CanonicalTextFile,
  sha256File,
  sha256Text,
} from "../scripts/lib/zkArtifactTrust.mjs";
import { SNARKJS_CLI_PATH, inspectSnarkjsRuntime } from "../scripts/lib/snarkjsToolchain.mjs";
import { expectRegularFileWithPosixMode } from "./helpers/fileMode.mjs";
import { createCanonicalTemporaryDirectory } from "./helpers/temporaryDirectory.mjs";

const MANIFEST_MODE = 0o640;

const artifactPath = (root, relativePath) => path.join(root, ...relativePath.split("/"));

const writeRelativeFile = async (root, relativePath, contents) => {
  const target = artifactPath(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
  return target;
};

const developmentSetup = () => ({
  status: "development",
  trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
  warning: "Single local contributor fixture; development and testing only.",
  minimumContributors: MINIMUM_PRODUCTION_CONTRIBUTORS,
  contributorCount: 1,
  beaconApplied: false,
  transcriptSha256: null,
});

const productionSetup = () => {
  return {
    status: "production",
    trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
    warning: "Single operator must destroy every circuit-specific Phase 2 secret.",
    ceremonyId: "deepfamily-production-2026-01",
    minimumContributors: MINIMUM_PRODUCTION_CONTRIBUTORS,
    contributorCount: MINIMUM_PRODUCTION_CONTRIBUTORS,
    phase1: {
      ...ZK_PRODUCTION_PHASE1,
      verified: true,
    },
    transcript: {
      path: ZK_CEREMONY_TRANSCRIPT_PATH,
      sha256: sha256Text("signed-production-transcript"),
    },
    beacon: {
      applied: true,
      name: "deepfamily-public-beacon",
      hash: sha256Text("public-randomness-beacon"),
      numIterationsExp: 10,
      source: "public-randomness-round-12345",
      personCommitmentContributionHash: "aa".repeat(64),
      disclosureBindingContributionHash: "bb".repeat(64),
    },
  };
};

const manifestMetadata = (manifest) => ({
  schemaVersion: manifest.schemaVersion,
  circomVersion: manifest.circomVersion,
  snarkjsVersion: manifest.snarkjsVersion,
  trustedSetup: structuredClone(manifest.trustedSetup),
});

const createDevelopmentFixture = async () => {
  const root = await createCanonicalTemporaryDirectory("deepfamily-zk-development-manifest-");
  const expectedHashes = {};
  const staleHashes = {};

  for (const [circuitName, spec] of Object.entries(ZK_RELEASE_ARTIFACTS)) {
    const files = {
      sourceSha256: spec.source,
      r1csSha256: spec.builtR1cs,
      wasmSha256: spec.wasm,
      zkeySha256: spec.zkey,
      verificationKeySha256: spec.verificationKey,
      solidityVerifierSha256: spec.solidityVerifier,
    };
    expectedHashes[circuitName] = {};
    staleHashes[circuitName] = {};
    for (const [manifestField, relativePath] of Object.entries(files)) {
      const target = await writeRelativeFile(
        root,
        relativePath,
        `${circuitName}:${manifestField}:fresh-development-artifact\n`,
      );
      expectedHashes[circuitName][manifestField] = sha256File(target);
      staleHashes[circuitName][manifestField] = sha256Text(
        `${circuitName}:${manifestField}:stale-manifest-value`,
      );
    }
  }

  const circomBinary = await writeRelativeFile(
    root,
    ZK_TOOLCHAIN_PATHS.circomBinary,
    "fresh fixture circom binary\n",
  );
  const snarkjsCli = await writeRelativeFile(
    root,
    ZK_TOOLCHAIN_PATHS.snarkjsCli,
    "fresh fixture snarkjs CLI\n",
  );
  await writeRelativeFile(
    root,
    "node_modules/snarkjs/package.json",
    `${JSON.stringify({
      name: "snarkjs",
      version: "0.7.5",
      main: "build/cli.cjs",
    })}\n`,
  );
  await writeRelativeFile(root, "node_modules/.bin/snarkjs", "non-Windows shim bytes\n");
  await writeRelativeFile(root, "node_modules/.bin/snarkjs.cmd", "Windows shim bytes\r\n");
  const expectedToolchain = {
    circomBinarySha256: sha256File(circomBinary),
    snarkjsCliSha256: sha256File(snarkjsCli),
    snarkjsRuntimeSha256: inspectSnarkjsRuntime({ root }).sha256,
  };

  const manifest = {
    schemaVersion: 3,
    circomVersion: "2.2.3",
    snarkjsVersion: "0.7.5",
    toolchain: {
      circomBinarySha256: sha256Text("stale-circom-toolchain"),
      snarkjsCliSha256: sha256Text("stale-snarkjs-toolchain"),
      snarkjsRuntimeSha256: sha256Text("stale-snarkjs-runtime"),
    },
    trustedSetup: developmentSetup(),
    circuits: staleHashes,
  };
  const manifestPath = await writeRelativeFile(
    root,
    ZK_ARTIFACT_MANIFEST_PATH,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await fs.chmod(manifestPath, MANIFEST_MODE);
  return { root, manifest, manifestPath, expectedHashes, expectedToolchain };
};

describe("development ZK manifest updater", function () {
  let fixture;

  beforeEach(async function () {
    fixture = await createDevelopmentFixture();
  });

  afterEach(async function () {
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  it("updates artifact hashes while preserving metadata and the POSIX file mode", async function () {
    const metadataBefore = manifestMetadata(fixture.manifest);

    const evidence = updateDevelopmentManifest({ root: fixture.root });
    const updated = JSON.parse(await fs.readFile(fixture.manifestPath, "utf8"));
    expect(updated.circuits).to.deep.equal(fixture.expectedHashes);
    expect(updated.toolchain).to.deep.equal(fixture.expectedToolchain);
    expect(ZK_TOOLCHAIN_PATHS.snarkjsCli).to.equal(SNARKJS_CLI_PATH);
    expect(manifestMetadata(updated)).to.deep.equal(metadataBefore);
    expectRegularFileWithPosixMode(await fs.lstat(fixture.manifestPath), MANIFEST_MODE);
    expect(evidence).to.include({
      status: "passed",
      trustedSetupStatus: "development",
      trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
      productionReady: false,
      contributorCount: 1,
      minimumContributors: MINIMUM_PRODUCTION_CONTRIBUTORS,
    });
    for (const circuitName of Object.keys(ZK_RELEASE_ARTIFACTS)) {
      expect(evidence.artifacts[circuitName].r1cs.sha256).to.equal(
        fixture.expectedHashes[circuitName].r1csSha256,
      );
    }
  });

  it("rejects a production manifest without changing its bytes or POSIX file mode", async function () {
    fixture.manifest.trustedSetup = productionSetup();
    const original = `${JSON.stringify(fixture.manifest, null, 2)}\n`;
    await fs.writeFile(fixture.manifestPath, original);
    await fs.chmod(fixture.manifestPath, MANIFEST_MODE);

    expect(() => updateDevelopmentManifest({ root: fixture.root })).to.throw(
      "Refusing to rewrite a production ceremony manifest with development artifact hashes",
    );
    expect(await fs.readFile(fixture.manifestPath, "utf8")).to.equal(original);
    expectRegularFileWithPosixMode(await fs.lstat(fixture.manifestPath), MANIFEST_MODE);
  });

  it("requires an explicit fresh-v1 transition and preserves the pre-v1 ceremony evidence", async function () {
    const transcript = {
      schemaVersion: 3,
      ceremonyId: PRE_V1_CEREMONY_ID,
      status: "archived-pre-v1-fixture",
    };
    const transcriptRaw = `${JSON.stringify(transcript, null, 2)}\n`;
    await writeRelativeFile(fixture.root, ZK_CEREMONY_TRANSCRIPT_PATH, transcriptRaw);
    fixture.manifest.trustedSetup = {
      ...productionSetup(),
      ceremonyId: PRE_V1_CEREMONY_ID,
      transcript: {
        path: ZK_CEREMONY_TRANSCRIPT_PATH,
        sha256: sha256Text(transcriptRaw),
      },
    };
    const productionManifestRaw = `${JSON.stringify(fixture.manifest, null, 2)}\n`;
    await fs.writeFile(fixture.manifestPath, productionManifestRaw);

    const result = initializeFreshV1DevelopmentManifest({ root: fixture.root });
    expect(result.status).to.equal("initialized-fresh-v1-development");
    const transitioned = JSON.parse(await fs.readFile(fixture.manifestPath, "utf8"));
    expect(transitioned.trustedSetup).to.deep.equal({
      status: "development",
      trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
      warning: FRESH_V1_DEVELOPMENT_WARNING,
      minimumContributors: 1,
      contributorCount: 1,
      beaconApplied: false,
      transcriptSha256: null,
    });
    expect(
      await fs.readFile(artifactPath(fixture.root, PRE_V1_MANIFEST_ARCHIVE_PATH), "utf8"),
    ).to.equal(productionManifestRaw);
    expect(
      await fs.readFile(artifactPath(fixture.root, PRE_V1_TRANSCRIPT_ARCHIVE_PATH), "utf8"),
    ).to.equal(transcriptRaw);
    const record = JSON.parse(
      await fs.readFile(artifactPath(fixture.root, PRE_V1_DEPRECATION_RECORD_PATH), "utf8"),
    );
    expect(record).to.deep.include({
      status: "deprecated-pre-v1",
      ceremonyId: PRE_V1_CEREMONY_ID,
    });
    expect(record.replacement).to.deep.equal({
      status: "development-only",
      command: "npm run zk:dev:fresh-v1",
      productionCeremonyRequired: true,
    });
    expect(initializeFreshV1DevelopmentManifest({ root: fixture.root }).status).to.equal(
      "already-development",
    );
  });

  it("leaves the manifest unchanged when a required artifact is missing", async function () {
    const original = await fs.readFile(fixture.manifestPath, "utf8");
    await fs.rm(
      artifactPath(fixture.root, ZK_RELEASE_ARTIFACTS.disclosure_binding.verificationKey),
    );

    expect(() => updateDevelopmentManifest({ root: fixture.root })).to.throw(
      /ENOENT|no such file/iu,
    );
    expect(await fs.readFile(fixture.manifestPath, "utf8")).to.equal(original);
    expectRegularFileWithPosixMode(await fs.lstat(fixture.manifestPath), MANIFEST_MODE);
  });

  it("normalizes CRLF source, verification key, and Solidity hashes to canonical LF", async function () {
    for (const spec of Object.values(ZK_RELEASE_ARTIFACTS)) {
      for (const relativePath of [spec.source, spec.verificationKey, spec.solidityVerifier]) {
        const filePath = artifactPath(fixture.root, relativePath);
        const lf = await fs.readFile(filePath, "utf8");
        await fs.writeFile(filePath, lf.replaceAll("\n", "\r\n"));
      }
    }

    updateDevelopmentManifest({ root: fixture.root });
    const updated = JSON.parse(await fs.readFile(fixture.manifestPath, "utf8"));

    for (const [circuitName, spec] of Object.entries(ZK_RELEASE_ARTIFACTS)) {
      expect(updated.circuits[circuitName]).to.include({
        sourceSha256: sha256CanonicalTextFile(artifactPath(fixture.root, spec.source)),
        verificationKeySha256: sha256CanonicalTextFile(
          artifactPath(fixture.root, spec.verificationKey),
        ),
        solidityVerifierSha256: sha256CanonicalTextFile(
          artifactPath(fixture.root, spec.solidityVerifier),
        ),
      });
      expect(updated.circuits[circuitName]).to.include({
        sourceSha256: fixture.expectedHashes[circuitName].sourceSha256,
        verificationKeySha256: fixture.expectedHashes[circuitName].verificationKeySha256,
        solidityVerifierSha256: fixture.expectedHashes[circuitName].solidityVerifierSha256,
      });
    }
  });
});
