import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { updateDevelopmentManifest } from "../scripts/update-zk-development-manifest.mjs";
import {
  MINIMUM_PRODUCTION_CONTRIBUTORS,
  ZK_ARTIFACT_MANIFEST_PATH,
  ZK_CEREMONY_TRANSCRIPT_PATH,
  ZK_PRODUCTION_PHASE1,
  ZK_RELEASE_ARTIFACTS,
  ZK_TOOLCHAIN_PATHS,
  ZK_TRUST_MODEL_SINGLE_OPERATOR,
  sha256File,
  sha256Text,
} from "../scripts/lib/zkArtifactTrust.mjs";

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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-zk-development-manifest-"));
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
    "node_modules/snarkjs/build/cli.cjs",
    "fresh fixture snarkjs CLI\n",
  );
  const snarkjsLink = artifactPath(root, ZK_TOOLCHAIN_PATHS.snarkjsBinary);
  await fs.mkdir(path.dirname(snarkjsLink), { recursive: true });
  await fs.symlink(path.relative(path.dirname(snarkjsLink), snarkjsCli), snarkjsLink);
  const expectedToolchain = {
    circomBinarySha256: sha256File(circomBinary),
    snarkjsCliSha256: sha256File(snarkjsCli),
  };

  const manifest = {
    schemaVersion: 2,
    circomVersion: "2.1.6",
    snarkjsVersion: "0.7.5",
    toolchain: {
      circomBinarySha256: sha256Text("stale-circom-toolchain"),
      snarkjsCliSha256: sha256Text("stale-snarkjs-toolchain"),
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

  it("updates every fixed artifact hash while preserving metadata and file mode", async function () {
    const metadataBefore = manifestMetadata(fixture.manifest);

    const evidence = updateDevelopmentManifest({ root: fixture.root });
    const updated = JSON.parse(await fs.readFile(fixture.manifestPath, "utf8"));
    const mode = (await fs.stat(fixture.manifestPath)).mode & 0o777;

    expect(updated.circuits).to.deep.equal(fixture.expectedHashes);
    expect(updated.toolchain).to.deep.equal(fixture.expectedToolchain);
    expect(manifestMetadata(updated)).to.deep.equal(metadataBefore);
    expect(mode).to.equal(MANIFEST_MODE);
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

  it("rejects a production manifest without changing its bytes or file mode", async function () {
    fixture.manifest.trustedSetup = productionSetup();
    const original = `${JSON.stringify(fixture.manifest, null, 2)}\n`;
    await fs.writeFile(fixture.manifestPath, original);
    await fs.chmod(fixture.manifestPath, MANIFEST_MODE);

    expect(() => updateDevelopmentManifest({ root: fixture.root })).to.throw(
      "Refusing to rewrite a production ceremony manifest with development artifact hashes",
    );
    expect(await fs.readFile(fixture.manifestPath, "utf8")).to.equal(original);
    expect((await fs.stat(fixture.manifestPath)).mode & 0o777).to.equal(MANIFEST_MODE);
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
    expect((await fs.stat(fixture.manifestPath)).mode & 0o777).to.equal(MANIFEST_MODE);
  });
});
