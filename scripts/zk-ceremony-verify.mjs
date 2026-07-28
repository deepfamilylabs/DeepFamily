#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ZK_RELEASE_ARTIFACTS,
  inspectZkReleaseArtifacts,
  sha256File,
} from "./lib/zkArtifactTrust.mjs";
import { readZkeyMpcMetadata } from "./lib/zkeyMpcMetadata.mjs";

const usage = () => {
  console.log(`Usage:
  npm run zk:ceremony:verify -- --ptau /absolute/path/to/published-final.ptau

The command is read-only. It requires a production ceremony manifest, verifies every checked-in
artifact hash, verifies the Powers of Tau transcript, and cryptographically binds each final zkey
to the frozen R1CS and the supplied Powers of Tau file.`);
};

const parseArguments = (argv) => {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  if (argv.length !== 2 || argv[0] !== "--ptau" || argv[1].trim() === "") {
    throw new Error("Exactly --ptau <path> is required");
  }
  return { help: false, ptauPath: argv[1] };
};

const defaultRunner = ({ executable, args, cwd }) =>
  execFileSync(executable, args, {
    cwd,
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

const createCeremonySnapshot = ({ resolvedRoot, resolvedPtau, evidence }) => {
  const snapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-zk-verify-"));
  try {
    fs.chmodSync(snapshotRoot, 0o700);
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
    return Object.freeze({ root: snapshotRoot, ptauPath, circuits: Object.freeze(circuits) });
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

const requireExecutable = (filePath, expectedRoot, label) => {
  let resolved;
  try {
    resolved = fs.realpathSync(filePath);
  } catch (error) {
    throw new Error(`${label} is unavailable: ${filePath}`, { cause: error });
  }
  const stats = fs.statSync(resolved);
  if (!stats.isFile()) throw new Error(`${label} must resolve to a regular file: ${filePath}`);
  const allowedRoot = `${fs.realpathSync(expectedRoot)}${path.sep}`;
  if (!resolved.startsWith(allowedRoot)) {
    throw new Error(`${label} resolves outside the installed dependency directory`);
  }
  return resolved;
};

export const verifyProductionCeremony = async ({
  root = process.cwd(),
  ptauPath,
  runner = defaultRunner,
  mpcMetadataReader = readZkeyMpcMetadata,
} = {}) => {
  if (typeof ptauPath !== "string" || ptauPath.trim() === "") {
    throw new Error("ptauPath is required");
  }
  if (typeof runner !== "function") throw new Error("runner must be a function");
  if (typeof mpcMetadataReader !== "function") {
    throw new Error("mpcMetadataReader must be a function");
  }

  const resolvedRoot = fs.realpathSync(root);
  const resolvedPtau = path.resolve(ptauPath);
  requireRegularFile(resolvedPtau, "Published Powers of Tau");

  const evidence = inspectZkReleaseArtifacts({
    root: resolvedRoot,
    requireProduction: true,
    requireBuiltR1cs: true,
  });
  const actualPtauSha256 = sha256File(resolvedPtau);
  if (actualPtauSha256 !== evidence.phase1Sha256) {
    throw new Error(
      `Published Powers of Tau SHA-256 mismatch; expected ${evidence.phase1Sha256}, ` +
        `got ${actualPtauSha256}`,
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
  const snarkjsBinary = path.join(
    resolvedRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "snarkjs.cmd" : "snarkjs",
  );
  const resolvedSnarkjsBinary = requireExecutable(
    snarkjsBinary,
    path.join(resolvedRoot, "node_modules"),
    "snarkjs CLI",
  );

  const snapshot = createCeremonySnapshot({ resolvedRoot, resolvedPtau, evidence });
  try {
    runner({
      executable: resolvedSnarkjsBinary,
      args: ["powersoftau", "verify", snapshot.ptauPath],
      cwd: resolvedRoot,
    });
    for (const circuitName of Object.keys(ZK_RELEASE_ARTIFACTS)) {
      const files = snapshot.circuits[circuitName];
      runner({
        executable: resolvedSnarkjsBinary,
        args: ["zkey", "verify", files.r1csPath, snapshot.ptauPath, files.zkeyPath],
        cwd: resolvedRoot,
      });
      const metadata = await mpcMetadataReader(files.zkeyPath);
      assertMpcMetadataMatchesTranscript({ circuitName, metadata, evidence });
      console.log(`${circuitName}: R1CS / Powers of Tau / signed MPC transcript / beacon verified`);
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
    contributorCount: evidence.contributorCount,
    ptau: {
      source: evidence.phase1Source,
      path: resolvedPtau,
      sha256: actualPtauSha256,
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
      `${result.contributorCount} contributors, manifest ${result.manifestSha256}`,
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
