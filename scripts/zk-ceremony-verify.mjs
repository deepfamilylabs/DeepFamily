#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ZK_RELEASE_ARTIFACTS,
  ZK_PRODUCTION_PHASE1,
  inspectZkReleaseArtifacts,
  sha256File,
} from "./lib/zkArtifactTrust.mjs";
import { inspectPtauFile, resolveProductionPtauPath } from "./lib/productionPtau.mjs";
import { sanitizeReleaseEnvironment } from "./lib/portableCommand.mjs";
import { createPrivateTemporaryDirectory } from "./lib/privateTemporaryDirectory.mjs";
import {
  assertSnarkjsRuntimeHash,
  buildSnarkjsCommand,
  resolveSnarkjsCliPath,
  snapshotSnarkjsRuntime,
} from "./lib/snarkjsToolchain.mjs";
import { readZkeyMpcMetadata } from "./lib/zkeyMpcMetadata.mjs";

const usage = () => {
  console.log(`Usage:
  npm run zk:ceremony:verify
  npm run zk:ceremony:verify -- --ptau /absolute/path/to/published-final.ptau

The command is read-only. It requires a production ceremony manifest, verifies every checked-in
artifact hash, verifies the Powers of Tau transcript, and cryptographically binds each final zkey
to the frozen R1CS and the supplied Powers of Tau file. With no --ptau option it uses the pinned
cache populated by npm run zk:ptau:fetch or npm run zk:production:setup.`);
};

const parseArguments = (argv) => {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  if (argv.length === 0) return { help: false, ptauPath: undefined };
  if (argv.length !== 2 || argv[0] !== "--ptau" || argv[1].trim() === "") {
    throw new Error("Usage: npm run zk:ceremony:verify -- [--ptau <path>]");
  }
  return { help: false, ptauPath: argv[1] };
};

const defaultRunner = ({ executable, args, cwd, env }) =>
  execFileSync(executable, args, {
    cwd,
    env,
    stdio: "inherit",
  });

const contributionHashField = (circuitName) => {
  if (circuitName === "person_commitment") return "personCommitmentContributionHash";
  if (circuitName === "disclosure_binding") return "disclosureBindingContributionHash";
  throw new Error(`Unsupported ceremony circuit: ${circuitName}`);
};

const assertMpcMetadataMatchesTranscript = ({ circuitName, metadata, evidence }) => {
  const expectedContributions = evidence.contributions;
  if (metadata.contributionCount !== expectedContributions.length + 1) {
    throw new Error(
      `${circuitName} zkey must contain exactly ${expectedContributions.length} participant ` +
        "contributions followed by one beacon",
    );
  }
  const hashField = contributionHashField(circuitName);
  expectedContributions.forEach((expected, index) => {
    const actual = metadata.contributions[index];
    if (actual.type !== 0) {
      throw new Error(`${circuitName} contribution ${index + 1} must be a normal contribution`);
    }
    if (actual.name !== expected.participantId) {
      throw new Error(
        `${circuitName} contribution ${index + 1} name does not match transcript participantId`,
      );
    }
    if (actual.contributionHash !== expected[hashField]) {
      throw new Error(
        `${circuitName} contribution ${index + 1} BLAKE2b-512 hash does not match transcript`,
      );
    }
  });

  const actualBeacon = metadata.contributions.at(-1);
  const expectedBeacon = evidence.beacon;
  if (actualBeacon.type !== 1) {
    throw new Error(`${circuitName} final zkey contribution must be the public beacon`);
  }
  if (actualBeacon.name !== expectedBeacon.name) {
    throw new Error(`${circuitName} beacon name does not match the production manifest`);
  }
  if (actualBeacon.beaconHash !== expectedBeacon.hash) {
    throw new Error(`${circuitName} embedded beacon hash does not match the production manifest`);
  }
  if (actualBeacon.numIterationsExp !== expectedBeacon.numIterationsExp) {
    throw new Error(
      `${circuitName} embedded beacon iteration exponent does not match the production manifest`,
    );
  }
  if (actualBeacon.contributionHash !== expectedBeacon[hashField]) {
    throw new Error(`${circuitName} beacon contribution hash does not match the manifest`);
  }
};

const createCeremonySnapshot = async ({
  resolvedRoot,
  resolvedPtau,
  evidence,
  privateDirectoryFactory,
  runtimeSnapshotter,
}) => {
  const snapshotRoot = await privateDirectoryFactory({ prefix: "deepfamily-zk-verify-" });
  try {
    const ptauPath = path.join(snapshotRoot, "phase1.ptau");
    fs.copyFileSync(resolvedPtau, ptauPath, fs.constants.COPYFILE_EXCL);
    if (sha256File(ptauPath) !== evidence.phase1Sha256) {
      throw new Error("Published Powers of Tau changed while creating the verification snapshot");
    }

    const circuits = {};
    for (const [circuitName, spec] of Object.entries(ZK_RELEASE_ARTIFACTS)) {
      const r1csPath = path.join(snapshotRoot, `${circuitName}.r1cs`);
      const zkeyPath = path.join(snapshotRoot, `${circuitName}.zkey`);
      fs.copyFileSync(
        path.join(resolvedRoot, spec.builtR1cs),
        r1csPath,
        fs.constants.COPYFILE_EXCL,
      );
      fs.copyFileSync(path.join(resolvedRoot, spec.zkey), zkeyPath, fs.constants.COPYFILE_EXCL);
      if (sha256File(r1csPath) !== evidence.artifacts[circuitName].r1cs.sha256) {
        throw new Error(`${circuitName} R1CS changed while creating the verification snapshot`);
      }
      if (sha256File(zkeyPath) !== evidence.artifacts[circuitName].zkey.sha256) {
        throw new Error(`${circuitName} zkey changed while creating the verification snapshot`);
      }
      circuits[circuitName] = Object.freeze({ r1csPath, zkeyPath });
    }
    const runtime =
      evidence.schemaVersion >= 3
        ? runtimeSnapshotter({
            root: resolvedRoot,
            destinationRoot: path.join(snapshotRoot, "snarkjs-runtime"),
            expectedSha256: evidence.toolchain.snarkjsRuntime.sha256,
          })
        : Object.freeze({ root: resolvedRoot, sha256: null });
    return Object.freeze({
      root: snapshotRoot,
      ptauPath,
      circuits: Object.freeze(circuits),
      runtime,
    });
  } catch (error) {
    fs.rmSync(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
};

const assertSnapshotUnchanged = ({ snapshot, evidence }) => {
  if (sha256File(snapshot.ptauPath) !== evidence.phase1Sha256) {
    throw new Error("Verification snapshot Powers of Tau changed while checks were running");
  }
  for (const [circuitName, files] of Object.entries(snapshot.circuits)) {
    if (sha256File(files.r1csPath) !== evidence.artifacts[circuitName].r1cs.sha256) {
      throw new Error(`${circuitName} snapshot R1CS changed while checks were running`);
    }
    if (sha256File(files.zkeyPath) !== evidence.artifacts[circuitName].zkey.sha256) {
      throw new Error(`${circuitName} snapshot zkey changed while checks were running`);
    }
  }
  if (snapshot.runtime.sha256 !== null) {
    assertSnarkjsRuntimeHash({
      root: snapshot.runtime.root,
      expectedSha256: snapshot.runtime.sha256,
    });
  }
};

const requireRegularFile = (filePath, label) => {
  let stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch (error) {
    throw new Error(`${label} is unavailable: ${filePath}`, { cause: error });
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file: ${filePath}`);
  }
  if (fs.realpathSync(filePath) !== path.resolve(filePath)) {
    throw new Error(`${label} path must not traverse a symbolic link: ${filePath}`);
  }
  return stats;
};

export const verifyProductionCeremony = async ({
  root = process.cwd(),
  ptauPath,
  env = process.env,
  runner = defaultRunner,
  mpcMetadataReader = readZkeyMpcMetadata,
  privateDirectoryFactory = createPrivateTemporaryDirectory,
  runtimeSnapshotter = snapshotSnarkjsRuntime,
  expectedProductionPhase1 = ZK_PRODUCTION_PHASE1,
} = {}) => {
  if (typeof runner !== "function") throw new Error("runner must be a function");
  if (typeof mpcMetadataReader !== "function") {
    throw new Error("mpcMetadataReader must be a function");
  }
  if (typeof privateDirectoryFactory !== "function" || typeof runtimeSnapshotter !== "function") {
    throw new Error("ceremony snapshot collaborators must be functions");
  }

  const resolvedRoot = fs.realpathSync(root);
  const commandEnvironment = sanitizeReleaseEnvironment(env);
  const selectedPtauPath =
    typeof ptauPath === "string" && ptauPath.trim() !== ""
      ? ptauPath
      : resolveProductionPtauPath({ root: resolvedRoot, env: commandEnvironment });
  const resolvedPtau = path.resolve(selectedPtauPath);
  requireRegularFile(resolvedPtau, "Published Powers of Tau");

  const evidence = inspectZkReleaseArtifacts({
    root: resolvedRoot,
    requireProduction: true,
    requireBuiltR1cs: true,
    expectedProductionPhase1,
  });
  const actualPtau = await inspectPtauFile(resolvedPtau);
  if (actualPtau.sha256 !== evidence.phase1Sha256) {
    throw new Error(
      `Published Powers of Tau SHA-256 mismatch; expected ${evidence.phase1Sha256}, ` +
        `got ${actualPtau.sha256}`,
    );
  }
  if (actualPtau.blake2b512 !== evidence.phase1Blake2b512) {
    throw new Error(
      `Published Powers of Tau BLAKE2b-512 mismatch; expected ${evidence.phase1Blake2b512}, ` +
        `got ${actualPtau.blake2b512}`,
    );
  }
  if (actualPtau.bytes !== evidence.phase1Bytes) {
    throw new Error(
      `Published Powers of Tau size mismatch; expected ${evidence.phase1Bytes}, ` +
        `got ${actualPtau.bytes}`,
    );
  }

  const snarkjsPackagePath = path.join(resolvedRoot, "node_modules", "snarkjs", "package.json");
  requireRegularFile(snarkjsPackagePath, "Installed snarkjs package");
  const installedSnarkjsVersion = JSON.parse(fs.readFileSync(snarkjsPackagePath, "utf8")).version;
  if (installedSnarkjsVersion !== evidence.snarkjsVersion) {
    throw new Error(
      `Installed snarkjs ${installedSnarkjsVersion} does not match ceremony manifest ` +
        evidence.snarkjsVersion,
    );
  }
  const snarkjsCli = resolveSnarkjsCliPath({ root: resolvedRoot });
  requireRegularFile(snarkjsCli, "snarkjs CLI");

  const snapshot = await createCeremonySnapshot({
    resolvedRoot,
    resolvedPtau,
    evidence,
    privateDirectoryFactory,
    runtimeSnapshotter,
  });
  try {
    runner({
      ...buildSnarkjsCommand({
        root: snapshot.runtime.root,
        cwd: resolvedRoot,
        args: ["powersoftau", "verify", snapshot.ptauPath],
      }),
      env: commandEnvironment,
    });
    for (const circuitName of Object.keys(ZK_RELEASE_ARTIFACTS)) {
      const files = snapshot.circuits[circuitName];
      runner({
        ...buildSnarkjsCommand({
          root: snapshot.runtime.root,
          cwd: resolvedRoot,
          args: ["zkey", "verify", files.r1csPath, snapshot.ptauPath, files.zkeyPath],
        }),
        env: commandEnvironment,
      });
      const metadata = await mpcMetadataReader(files.zkeyPath);
      assertMpcMetadataMatchesTranscript({ circuitName, metadata, evidence });
      console.log(`${circuitName}: R1CS / Powers of Tau / MPC transcript / beacon verified`);
    }
    assertSnapshotUnchanged({ snapshot, evidence });
  } finally {
    fs.rmSync(snapshot.root, { recursive: true, force: true });
  }

  return Object.freeze({
    status: "passed",
    ceremonyId: evidence.ceremonyId,
    manifestSha256: evidence.manifestSha256,
    transcriptSha256: evidence.transcriptSha256,
    trustModel: evidence.trustModel,
    contributorCount: evidence.contributorCount,
    minimumContributors: evidence.minimumContributors,
    compiler: evidence.compiler,
    ptau: {
      source: evidence.phase1Source,
      path: resolvedPtau,
      bytes: actualPtau.bytes,
      sha256: actualPtau.sha256,
      blake2b512: actualPtau.blake2b512,
    },
    circuits: Object.keys(ZK_RELEASE_ARTIFACTS),
  });
};

export const main = async (argv = process.argv.slice(2)) => {
  const parsed = parseArguments(argv);
  if (parsed.help) {
    usage();
    return;
  }
  const result = await verifyProductionCeremony({ ptauPath: parsed.ptauPath });
  console.log(
    `Production ZK ceremony verified: ${result.ceremonyId}, ` +
      `${result.trustModel}, ${result.contributorCount} contributor(s), ` +
      `manifest ${result.manifestSha256}`,
  );
};

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((error) => {
    console.error(`[zk-ceremony] ${error.message}`);
    process.exitCode = 1;
  });
}
