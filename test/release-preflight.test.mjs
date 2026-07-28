import { expect } from "chai";
import { ethers } from "ethers";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RELEASE_PREFLIGHT_COMMANDS, runReleasePreflight } from "../scripts/release-preflight.mjs";
import {
  MINIMUM_PRODUCTION_CONTRIBUTORS,
  ZK_ARTIFACT_MANIFEST_PATH,
  ZK_CEREMONY_TRANSCRIPT_PATH,
  ZK_RELEASE_ARTIFACTS,
  ZK_TOOLCHAIN_PATHS,
  buildZkContributionApprovalMessage,
  sha256File,
  sha256Text,
} from "../scripts/lib/zkArtifactTrust.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMIT = "12".repeat(20);
const CHANGED_COMMIT = "34".repeat(20);

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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-release-preflight-"));
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
    `${JSON.stringify({ name: "snarkjs", version: snarkjsVersion })}\n`,
  );
  const snarkjsBinary = await writeRelativeFile(
    root,
    "node_modules/snarkjs/build/cli.cjs",
    "fixture snarkjs executable\n",
  );
  const snarkjsLink = artifactPath(root, ZK_TOOLCHAIN_PATHS.snarkjsBinary);
  await fs.mkdir(path.dirname(snarkjsLink), { recursive: true });
  await fs.symlink(path.relative(path.dirname(snarkjsLink), snarkjsBinary), snarkjsLink);
  const circomBinary = await writeRelativeFile(
    root,
    ZK_TOOLCHAIN_PATHS.circomBinary,
    "fixture circom executable\n",
  );

  const ceremonyId = "deepfamily-production-2026-01";
  const phase1Sha256 = sha256File(ptauPath);
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
        `0x${String(index + 31)
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
    snarkjsVersion,
    toolchain: {
      circomBinarySha256: sha256File(circomBinary),
      snarkjsCliSha256: sha256File(snarkjsBinary),
    },
    trustedSetup: {
      status: "production",
      ceremonyId,
      minimumContributors: MINIMUM_PRODUCTION_CONTRIBUTORS,
      contributorCount: contributions.length,
      phase1: {
        source: "https://example.invalid/published-final.ptau",
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
  return { root, manifest, manifestPath, ptauPath, snarkjsBinary, metadataByCircuit };
};

const commandLabel = ({ executable, args }) => `${executable} ${args.join(" ")}`;

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
      invocation.executable === "git" &&
      invocation.args[0] === "rev-parse" &&
      invocation.args[1] === "HEAD"
    ) {
      const index = commitIndex++;
      onInvocation(invocation, { kind: "commit", index });
      return `${commits[Math.min(index, commits.length - 1)]}\n`;
    }
    if (
      invocation.executable === "git" &&
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

  it("blocks the current development manifest before running any npm command", async function () {
    const fake = createFakeRunner();

    const error = await captureError(() =>
      runReleasePreflight({
        root: PROJECT_ROOT,
        ptauPath: path.join(PROJECT_ROOT, "tmp", "unused.ptau"),
        runner: fake.runner,
      }),
    );
    expect(error?.message).to.equal(
      "Production release is blocked: checked-in ZK proving keys are marked development-only",
    );

    expect(fake.calls.map(commandLabel)).to.deep.equal([
      "git rev-parse HEAD",
      "git status --porcelain=v1 --untracked-files=all",
    ]);
    expect(fake.calls.some(({ executable }) => executable === "npm")).to.equal(false);
  });

  it("runs all checks in order, then verifies Powers of Tau and both final zkeys", async function () {
    const fixture = await productionFixture();
    const fake = createFakeRunner();
    const snarkjsBinary = await fs.realpath(fixture.snarkjsBinary);

    const result = await runReleasePreflight({
      root: fixture.root,
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
    expect(path.dirname(fake.calls[2 + RELEASE_PREFLIGHT_COMMANDS.length].args[2])).to.match(
      /deepfamily-zk-verify-/u,
    );
    expect(
      fake.calls.filter(
        ({ executable, args }) =>
          executable === snarkjsBinary && args[0] === "powersoftau" && args[1] === "verify",
      ),
    ).to.have.lengthOf(1);
    expect(
      fake.calls.filter(
        ({ executable, args }) =>
          executable === snarkjsBinary && args[0] === "zkey" && args[1] === "verify",
      ),
    ).to.have.lengthOf(2);
    expect(result).to.deep.equal({
      status: "passed",
      releaseCommit: COMMIT,
      zkCeremonyId: fixture.manifest.trustedSetup.ceremonyId,
      zkManifestSha256: sha256File(fixture.manifestPath),
      zkTranscriptSha256: fixture.manifest.trustedSetup.transcript.sha256,
      ptauSha256: fixture.manifest.trustedSetup.phase1.sha256,
      checks: RELEASE_PREFLIGHT_COMMANDS.map(
        ([executable, args]) => `${executable} ${args.join(" ")}`,
      ),
    });
  });

  it("rejects an initially dirty Git working tree before npm or ZK verification", async function () {
    const fixture = await productionFixture();
    const fake = createFakeRunner({ statuses: [" M contracts/DeepFamily.sol"] });

    const error = await captureError(() =>
      runReleasePreflight({
        root: fixture.root,
        ptauPath: fixture.ptauPath,
        runner: fake.runner,
      }),
    );
    expect(error?.message).to.equal(
      "Release preflight requires a clean Git working tree (before checks)",
    );

    expect(fake.calls.map(commandLabel)).to.deep.equal([
      "git rev-parse HEAD",
      "git status --porcelain=v1 --untracked-files=all",
    ]);
  });

  it("rejects a release commit that changes while checks are running", async function () {
    const fixture = await productionFixture();
    const fake = createFakeRunner({ commits: [COMMIT, CHANGED_COMMIT] });

    const error = await captureError(() =>
      runReleasePreflight({
        root: fixture.root,
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
          changed.trustedSetup.phase1.source =
            "https://example.invalid/changed-published-final.ptau";
          fsSync.writeFileSync(fixture.manifestPath, `${JSON.stringify(changed, null, 2)}\n`);
        }
      },
    });

    const error = await captureError(() =>
      runReleasePreflight({
        root: fixture.root,
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
      runReleasePreflight({
        root: fixture.root,
        ptauPath: fixture.ptauPath,
        runner: fake.runner,
        mpcMetadataReader: metadataReaderFor(fixture),
      }),
    );
    expect(error?.message).to.match(/person_commitment zkey SHA-256 mismatch/u);
  });

  it("fails when ZK_PTAU_PATH is missing", async function () {
    const fixture = await productionFixture();
    const fake = createFakeRunner();
    const previousPtauPath = process.env.ZK_PTAU_PATH;
    delete process.env.ZK_PTAU_PATH;

    try {
      const error = await captureError(() =>
        runReleasePreflight({
          root: fixture.root,
          runner: fake.runner,
          mpcMetadataReader: metadataReaderFor(fixture),
        }),
      );
      expect(error?.message).to.equal("ptauPath is required");
    } finally {
      if (previousPtauPath === undefined) delete process.env.ZK_PTAU_PATH;
      else process.env.ZK_PTAU_PATH = previousPtauPath;
    }
  });
});
