import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { renameZkVerifierFile } from "../rename-zk-verifier.mjs";
import {
  CIRCOM_ARTIFACT_FLAGS,
  CIRCOM_CANONICAL_POLICY,
  CIRCOM_LINUX_X64_SHA256,
  CIRCOM_VERSION,
  assertCanonicalCircomHost,
} from "./circomToolchain.mjs";
import {
  ZK_ARTIFACT_MANIFEST_PATH,
  ZK_CEREMONY_TRANSCRIPT_PATH,
  ZK_RELEASE_ARTIFACTS,
  ZK_TRUST_MODEL_SINGLE_OPERATOR,
  inspectZkReleaseArtifacts,
  sha256File,
  sha256Text,
  validateZkArtifactManifest,
  validateProductionTranscript,
} from "./zkArtifactTrust.mjs";
import { ensureProductionPtau } from "./productionPtau.mjs";
import { readZkeyMpcMetadata } from "./zkeyMpcMetadata.mjs";

export const SINGLE_OPERATOR_PARTICIPANT_ID = "deepfamily-single-operator";
export const SINGLE_OPERATOR_BEACON_NAME = "deepfamily-single-operator-finalization";
export const SINGLE_OPERATOR_BEACON_SOURCE =
  "node:crypto.randomBytes(32), generated after both Phase 2 contributions";
export const SINGLE_OPERATOR_TRUST_WARNING =
  "Production security trusts one operator to destroy both circuit-specific Phase 2 secrets.";
export const SINGLE_OPERATOR_BEACON_ITERATIONS_EXP = 10;

const SETUP_CIRCUITS = Object.freeze({
  person_commitment: Object.freeze({
    ...ZK_RELEASE_ARTIFACTS.person_commitment,
    contractName: "PersonCommitmentVerifier",
  }),
  disclosure_binding: Object.freeze({
    ...ZK_RELEASE_ARTIFACTS.disclosure_binding,
    contractName: "DisclosureBindingVerifier",
  }),
});

const defaultCaptureRunner = ({ executable, args, cwd }) =>
  execFileSync(executable, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

export const defaultProductionSetupRunner = ({
  executable,
  args,
  cwd,
  stdin = null,
  env = process.env,
}) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      shell: false,
      stdio: [stdin === null ? "ignore" : "pipe", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `${path.basename(executable)} exited with ` +
              (signal ? `signal ${signal}` : `code ${String(code)}`),
          ),
        );
      }
    });
    if (stdin !== null) {
      child.stdin.once("error", (error) => {
        if (error?.code !== "EPIPE") reject(error);
      });
      child.stdin.end(stdin);
    }
  });

const assertCleanGitState = ({ root, captureRunner = defaultCaptureRunner }) => {
  const commit = String(
    captureRunner({
      executable: "git",
      args: ["rev-parse", "HEAD"],
      cwd: root,
    }),
  ).trim();
  const status = String(
    captureRunner({
      executable: "git",
      args: ["status", "--porcelain=v1", "--untracked-files=all"],
      cwd: root,
    }),
  ).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error("Production ZK setup requires a valid Git commit");
  }
  if (status !== "") {
    throw new Error("Production ZK setup requires a clean Git working tree");
  }
  return commit;
};

const createCeremonyId = (now = new Date()) =>
  `deepfamily-single-operator-${now
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/u, "Z")}`;

const assertCeremonyId = (ceremonyId) => {
  if (typeof ceremonyId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u.test(ceremonyId)) {
    throw new Error("ceremonyId has an unsafe or ambiguous format");
  }
  return ceremonyId;
};

const requireRandomBytes = (randomBytesFn, length, label) => {
  const value = Buffer.from(randomBytesFn(length));
  if (value.length !== length) {
    value.fill(0);
    throw new Error(`${label} must contain exactly ${length} random bytes`);
  }
  return value;
};

export const runSecretContribution = async ({ runner, cwd, oldZkey, newZkey, randomBytesFn }) => {
  const entropy = requireRandomBytes(randomBytesFn, 64, "Phase 2 entropy");
  let stdin;
  try {
    stdin = Buffer.from(`${entropy.toString("hex")}\n`, "utf8");
    entropy.fill(0);
    await runner({
      // snarkjs's interactive readline prompt can miss stdin that was already closed by a parent
      // process. This short-lived helper consumes the complete pipe first and calls the library
      // API directly, keeping the secret out of argv, environment variables, and the filesystem.
      executable: process.execPath,
      args: [
        path.join(cwd, "scripts", "zk-contribute-from-stdin.mjs"),
        oldZkey,
        newZkey,
        SINGLE_OPERATOR_PARTICIPANT_ID,
      ],
      cwd,
      stdin,
    });
  } finally {
    entropy.fill(0);
    stdin?.fill(0);
  }
};

export const assertSingleOperatorMetadata = ({
  circuitName,
  contributedMetadata,
  finalMetadata,
  beaconHash,
}) => {
  if (
    contributedMetadata.contributionCount !== 1 ||
    contributedMetadata.contributions[0]?.type !== 0 ||
    contributedMetadata.contributions[0]?.name !== SINGLE_OPERATOR_PARTICIPANT_ID
  ) {
    throw new Error(
      `${circuitName} contributed zkey must contain exactly one operator contribution`,
    );
  }
  if (finalMetadata.contributionCount !== 2) {
    throw new Error(`${circuitName} final zkey must contain one contribution and one beacon`);
  }
  const [operator, beacon] = finalMetadata.contributions;
  if (
    operator.type !== 0 ||
    operator.name !== SINGLE_OPERATOR_PARTICIPANT_ID ||
    operator.contributionHash !== contributedMetadata.contributions[0].contributionHash
  ) {
    throw new Error(`${circuitName} final zkey operator contribution does not match its precursor`);
  }
  if (
    beacon.type !== 1 ||
    beacon.name !== SINGLE_OPERATOR_BEACON_NAME ||
    beacon.beaconHash !== beaconHash ||
    beacon.numIterationsExp !== SINGLE_OPERATOR_BEACON_ITERATIONS_EXP
  ) {
    throw new Error(`${circuitName} final zkey beacon metadata is invalid`);
  }
  return Object.freeze({
    operatorContributionHash: operator.contributionHash,
    beaconContributionHash: beacon.contributionHash,
  });
};

const writeCanonicalJson = async (filePath, value) => {
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
};

const requireRegularNonSymlink = async (filePath, label) => {
  const state = await fsp.lstat(filePath);
  if (!state.isFile() || state.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file: ${filePath}`);
  }
  if ((await fsp.realpath(filePath)) !== path.resolve(filePath)) {
    throw new Error(`${label} path must not traverse a symlink: ${filePath}`);
  }
  return state;
};

const safeDestinationPath = async (root, relativePath) => {
  const destination = path.resolve(root, relativePath);
  const relative = path.relative(root, destination);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Production setup destination escapes the repository: ${relativePath}`);
  }
  const parent = path.dirname(destination);
  await fsp.mkdir(parent, { recursive: true });
  if ((await fsp.realpath(parent)) !== path.resolve(parent)) {
    throw new Error(`Production setup destination traverses a symlink: ${relativePath}`);
  }
  try {
    const state = await fsp.lstat(destination);
    if (!state.isFile() || state.isSymbolicLink()) {
      throw new Error(`Production setup destination must be a regular file: ${relativePath}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return destination;
};

const copyIntoPlace = async ({ source, destination, mode }) => {
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${randomBytes(8).toString("hex")}.installing`,
  );
  try {
    await fsp.copyFile(source, temporary, fs.constants.COPYFILE_EXCL);
    await fsp.chmod(temporary, mode);
    await fsp.rename(temporary, destination);
  } finally {
    await fsp.rm(temporary, { force: true });
  }
};

/**
 * Installs a complete staged artifact set and restores every declared destination if validation
 * fails. The manifest must be the final entry because it is the release commit marker.
 */
export const installProductionArtifacts = async ({
  root,
  entries,
  validateBeforeCommit,
  validateAfterCommit,
  backupRoot,
}) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("Production artifact entries are required");
  }
  if (entries.at(-1)?.destination !== ZK_ARTIFACT_MANIFEST_PATH) {
    throw new Error("The production manifest must be installed last");
  }
  if (typeof validateBeforeCommit !== "function" || typeof validateAfterCommit !== "function") {
    throw new Error("Production artifact pre-commit and post-commit validation are required");
  }
  const destinationNames = entries.map((entry) => entry.destination);
  if (new Set(destinationNames).size !== destinationNames.length) {
    throw new Error("Production artifact destinations must be unique");
  }
  const resolvedRoot = await fsp.realpath(root);
  if (resolvedRoot !== path.resolve(root)) {
    throw new Error("Production artifact root must not traverse a symlink");
  }
  const resolvedBackupRoot =
    backupRoot === undefined
      ? await fsp.mkdtemp(path.join(os.tmpdir(), "deepfamily-zk-backup-"))
      : await backupRoot;
  await fsp.chmod(resolvedBackupRoot, 0o700);
  const snapshots = [];
  let retainBackup = false;
  try {
    for (const [index, entry] of entries.entries()) {
      await requireRegularNonSymlink(entry.source, `Staged artifact ${entry.destination}`);
      const destination = await safeDestinationPath(resolvedRoot, entry.destination);
      let existing = null;
      try {
        const state = await requireRegularNonSymlink(
          destination,
          `Existing artifact ${entry.destination}`,
        );
        const backup = path.join(resolvedBackupRoot, String(index));
        await fsp.copyFile(destination, backup, fs.constants.COPYFILE_EXCL);
        await fsp.chmod(backup, state.mode & 0o777);
        existing = Object.freeze({ backup, mode: state.mode & 0o777 });
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      snapshots.push(Object.freeze({ destination, existing }));
    }

    for (const [index, entry] of entries.slice(0, -1).entries()) {
      await copyIntoPlace({
        source: entry.source,
        destination: snapshots[index].destination,
        mode: entry.mode ?? snapshots[index].existing?.mode ?? 0o644,
      });
    }
    await validateBeforeCommit();

    const manifestIndex = entries.length - 1;
    const manifestEntry = entries[manifestIndex];
    await copyIntoPlace({
      source: manifestEntry.source,
      destination: snapshots[manifestIndex].destination,
      mode: manifestEntry.mode ?? snapshots[manifestIndex].existing?.mode ?? 0o644,
    });
    await validateAfterCommit();
  } catch (error) {
    const rollbackErrors = [];
    for (const snapshot of [...snapshots].reverse()) {
      try {
        if (snapshot.existing) {
          await copyIntoPlace({
            source: snapshot.existing.backup,
            destination: snapshot.destination,
            mode: snapshot.existing.mode,
          });
        } else {
          await fsp.rm(snapshot.destination, { force: true });
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      retainBackup = true;
      throw new AggregateError(
        [error, ...rollbackErrors],
        `Production ZK setup failed and rollback was incomplete; backups retained at ` +
          resolvedBackupRoot,
      );
    }
    throw error;
  } finally {
    if (!retainBackup) {
      await fsp.rm(resolvedBackupRoot, { recursive: true, force: true });
    }
  }
};

export const buildProductionCircuitCompileCommand = ({ root, stageBuild, circuitName }) => {
  const circuit = SETUP_CIRCUITS[circuitName];
  if (circuit === undefined) {
    throw new Error(`Unsupported production ZK circuit: ${circuitName}`);
  }
  const resolvedRoot = path.resolve(root);
  return Object.freeze({
    executable: path.join(resolvedRoot, CIRCOM_CANONICAL_POLICY.binaryPath),
    args: Object.freeze([
      path.join(resolvedRoot, circuit.source),
      ...CIRCOM_ARTIFACT_FLAGS,
      "-l",
      path.join(resolvedRoot, "node_modules"),
      "-l",
      path.join(resolvedRoot, "node_modules", "circomlib", "circuits"),
      "-o",
      stageBuild,
    ]),
    cwd: resolvedRoot,
  });
};

const compileCircuit = async ({ root, stageBuild, circuitName, runner }) => {
  await runner(buildProductionCircuitCompileCommand({ root, stageBuild, circuitName }));
};

const generateCircuitKeys = async ({
  root,
  stageRoot,
  stageBuild,
  circuitName,
  ptauPath,
  runner,
  randomBytesFn,
  metadataReader,
}) => {
  const snarkjsBinary = path.join(
    root,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "snarkjs.cmd" : "snarkjs",
  );
  const keyDirectory = path.join(stageRoot, "keys");
  const releaseDirectory = path.join(stageRoot, "release");
  const r1cs = path.join(stageBuild, `${circuitName}.r1cs`);
  const wasm = path.join(stageBuild, `${circuitName}_js`, `${circuitName}.wasm`);
  const initialZkey = path.join(keyDirectory, `${circuitName}_0000.zkey`);
  const contributedZkey = path.join(keyDirectory, `${circuitName}_contributed.zkey`);
  const finalZkey = path.join(releaseDirectory, `${circuitName}_final.zkey`);
  const verificationKey = path.join(releaseDirectory, `${circuitName}.vkey.json`);
  const solidityVerifier = path.join(releaseDirectory, `${circuitName}.sol`);

  await runner({
    executable: snarkjsBinary,
    args: ["groth16", "setup", r1cs, ptauPath, initialZkey],
    cwd: root,
  });
  await runSecretContribution({
    runner,
    cwd: root,
    oldZkey: initialZkey,
    newZkey: contributedZkey,
    randomBytesFn,
  });
  const contributedMetadata = await metadataReader(contributedZkey);

  return Object.freeze({
    circuitName,
    r1cs,
    wasm,
    initialZkey,
    contributedZkey,
    contributedMetadata,
    finalZkey,
    verificationKey,
    solidityVerifier,
    snarkjsBinary,
  });
};

const finalizeCircuitKeys = async ({ root, circuit, beaconHash, runner, metadataReader }) => {
  await runner({
    executable: circuit.snarkjsBinary,
    args: [
      "zkey",
      "beacon",
      circuit.contributedZkey,
      circuit.finalZkey,
      beaconHash,
      String(SINGLE_OPERATOR_BEACON_ITERATIONS_EXP),
      `--name=${SINGLE_OPERATOR_BEACON_NAME}`,
    ],
    cwd: root,
  });
  await runner({
    executable: circuit.snarkjsBinary,
    args: ["zkey", "export", "verificationkey", circuit.finalZkey, circuit.verificationKey],
    cwd: root,
  });
  await runner({
    executable: circuit.snarkjsBinary,
    args: ["zkey", "export", "solidityverifier", circuit.finalZkey, circuit.solidityVerifier],
    cwd: root,
  });
  renameZkVerifierFile({
    targetPath: circuit.solidityVerifier,
    contractName: SETUP_CIRCUITS[circuit.circuitName].contractName,
    root: "/",
  });
  const finalMetadata = await metadataReader(circuit.finalZkey);
  const metadata = assertSingleOperatorMetadata({
    circuitName: circuit.circuitName,
    contributedMetadata: circuit.contributedMetadata,
    finalMetadata,
    beaconHash,
  });
  return Object.freeze({ ...circuit, finalMetadata, metadata });
};

const buildTranscriptAndManifest = async ({
  root,
  stageRoot,
  initialManifest,
  ceremonyId,
  ptau,
  circuits,
  beaconHash,
}) => {
  const circuitEvidence = Object.fromEntries(
    Object.entries(circuits).map(([circuitName, circuit]) => [
      circuitName,
      {
        sourceSha256: sha256File(path.join(root, SETUP_CIRCUITS[circuitName].source)),
        r1csSha256: sha256File(circuit.r1cs),
        wasmSha256: sha256File(circuit.wasm),
        zkeySha256: sha256File(circuit.finalZkey),
        verificationKeySha256: sha256File(circuit.verificationKey),
        solidityVerifierSha256: sha256File(circuit.solidityVerifier),
      },
    ]),
  );
  const transcriptCircuits = Object.fromEntries(
    Object.entries(circuitEvidence).map(([circuitName, circuit]) => [
      circuitName,
      {
        sourceSha256: circuit.sourceSha256,
        r1csSha256: circuit.r1csSha256,
      },
    ]),
  );
  const beacon = {
    name: SINGLE_OPERATOR_BEACON_NAME,
    hash: beaconHash,
    numIterationsExp: SINGLE_OPERATOR_BEACON_ITERATIONS_EXP,
    source: SINGLE_OPERATOR_BEACON_SOURCE,
    personCommitmentContributionHash: circuits.person_commitment.metadata.beaconContributionHash,
    disclosureBindingContributionHash: circuits.disclosure_binding.metadata.beaconContributionHash,
  };
  const transcript = {
    schemaVersion: 2,
    trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
    ceremonyId,
    phase1Sha256: ptau.sha256,
    circuits: transcriptCircuits,
    contributions: [
      {
        sequence: 1,
        participantId: SINGLE_OPERATOR_PARTICIPANT_ID,
        personCommitmentContributionHash:
          circuits.person_commitment.metadata.operatorContributionHash,
        disclosureBindingContributionHash:
          circuits.disclosure_binding.metadata.operatorContributionHash,
      },
    ],
    beacon,
  };
  const transcriptPath = path.join(stageRoot, "release", "zk-ceremony-transcript.json");
  await writeCanonicalJson(transcriptPath, transcript);
  const transcriptRaw = await fsp.readFile(transcriptPath, "utf8");
  const manifest = {
    schemaVersion: initialManifest.schemaVersion,
    circomVersion: initialManifest.circomVersion,
    snarkjsVersion: initialManifest.snarkjsVersion,
    toolchain: initialManifest.toolchain,
    trustedSetup: {
      status: "production",
      trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
      warning: SINGLE_OPERATOR_TRUST_WARNING,
      ceremonyId,
      minimumContributors: 1,
      contributorCount: 1,
      phase1: {
        source: ptau.source,
        bytes: ptau.bytes,
        sha256: ptau.sha256,
        blake2b512: ptau.blake2b512,
        verified: true,
      },
      transcript: {
        path: ZK_CEREMONY_TRANSCRIPT_PATH,
        sha256: sha256Text(transcriptRaw),
      },
      beacon: {
        applied: true,
        ...beacon,
      },
    },
    circuits: circuitEvidence,
  };
  const manifestPath = path.join(stageRoot, "release", "zk-artifacts-manifest.json");
  await writeCanonicalJson(manifestPath, manifest);
  return Object.freeze({ transcriptPath, manifestPath, transcript, manifest });
};

const buildInstallEntries = ({ circuits, records }) => {
  const entries = [];
  for (const [circuitName, circuit] of Object.entries(circuits)) {
    const spec = SETUP_CIRCUITS[circuitName];
    entries.push(
      { source: circuit.r1cs, destination: spec.builtR1cs },
      {
        source: circuit.finalZkey,
        destination: `zk-artifacts/circuits/${circuitName}_final.zkey`,
      },
      {
        source: circuit.verificationKey,
        destination: `zk-artifacts/circuits/${circuitName}.vkey.json`,
      },
      { source: circuit.wasm, destination: spec.wasm },
      { source: circuit.finalZkey, destination: spec.zkey },
      { source: circuit.verificationKey, destination: spec.verificationKey },
      { source: circuit.solidityVerifier, destination: spec.solidityVerifier },
    );
  }
  entries.push(
    { source: records.transcriptPath, destination: ZK_CEREMONY_TRANSCRIPT_PATH },
    { source: records.manifestPath, destination: ZK_ARTIFACT_MANIFEST_PATH },
  );
  return entries;
};

export const buildStagedProofValidationCommands = ({ root, circuits }) =>
  Object.freeze([
    Object.freeze({
      executable: process.execPath,
      args: Object.freeze([
        path.join(root, "tasks", "zk-person-hash-check.mjs"),
        "--prove",
        "--wasm",
        circuits.person_commitment.wasm,
        "--zkey",
        circuits.person_commitment.finalZkey,
        "--vkey",
        circuits.person_commitment.verificationKey,
        "--input",
        path.join(root, "circuits", "test", "proof", "person_commitment_input.json"),
        "--submitter",
        "0x1234567890123456789012345678901234567890",
      ]),
    }),
    Object.freeze({
      executable: process.execPath,
      args: Object.freeze([
        path.join(root, "tasks", "zk-disclosure-binding-check.mjs"),
        "--prove",
        "--wasm",
        circuits.disclosure_binding.wasm,
        "--zkey",
        circuits.disclosure_binding.finalZkey,
        "--vkey",
        circuits.disclosure_binding.verificationKey,
        "--input",
        path.join(root, "circuits", "test", "proof", "disclosure_binding_input.json"),
      ]),
    }),
  ]);

const validateStagedProductionArtifacts = async ({
  root,
  ptauPath,
  circuits,
  manifest,
  transcript,
  runner,
}) => {
  validateZkArtifactManifest(manifest, { requireProduction: true });
  validateProductionTranscript({ transcript, manifest });
  const snarkjsBinary = circuits.person_commitment.snarkjsBinary;
  await runner({
    executable: snarkjsBinary,
    args: ["powersoftau", "verify", ptauPath],
    cwd: root,
  });
  for (const circuit of Object.values(circuits)) {
    await runner({
      executable: snarkjsBinary,
      args: ["zkey", "verify", circuit.r1cs, ptauPath, circuit.finalZkey],
      cwd: root,
    });
  }
  for (const command of buildStagedProofValidationCommands({ root, circuits })) {
    await runner({ ...command, cwd: root });
  }
};

const defaultPreCommitValidator = async ({ root, runner }) => {
  await runner({
    executable: "npm",
    args: ["run", "zk:check"],
    cwd: root,
  });
  await runner({
    executable: "npm",
    args: ["run", "build"],
    cwd: root,
  });
};

const defaultPostCommitValidator = async ({ root, ptauPath, runner }) => {
  await runner({
    executable: "npm",
    args: ["run", "zk:artifacts:check"],
    cwd: root,
  });
  const artifacts = inspectZkReleaseArtifacts({
    root,
    requireProduction: true,
    requireBuiltR1cs: true,
  });
  return Object.freeze({ artifacts, ptauPath });
};

export const runSingleOperatorProductionSetup = async ({
  root = process.cwd(),
  ceremonyId = createCeremonyId(),
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  runner = defaultProductionSetupRunner,
  captureRunner = defaultCaptureRunner,
  randomBytesFn = randomBytes,
  metadataReader = readZkeyMpcMetadata,
  ptauInstaller = ensureProductionPtau,
  artifactInspector = inspectZkReleaseArtifacts,
  preCommitValidator = defaultPreCommitValidator,
  postCommitValidator = defaultPostCommitValidator,
} = {}) => {
  if (String(env.CI ?? "").toLowerCase() === "true") {
    throw new Error("Production ZK setup must be run interactively outside CI");
  }
  assertCanonicalCircomHost({ platform, arch, operation: "Production ZK setup" });
  if (
    typeof runner !== "function" ||
    typeof captureRunner !== "function" ||
    typeof artifactInspector !== "function"
  ) {
    throw new Error("Production ZK setup collaborators must be functions");
  }
  const resolvedRoot = fs.realpathSync(root);
  if (resolvedRoot !== path.resolve(root)) {
    throw new Error("Production ZK setup root must not traverse a symlink");
  }
  const releaseCommit = assertCleanGitState({ root: resolvedRoot, captureRunner });
  const initialEvidence = artifactInspector({
    root: resolvedRoot,
    requireProduction: false,
    requireBuiltR1cs: false,
  });
  if (initialEvidence.circomVersion !== CIRCOM_VERSION) {
    throw new Error(
      `Production ZK setup requires Circom ${CIRCOM_VERSION}; ` +
        `manifest declares ${initialEvidence.circomVersion}`,
    );
  }
  if (initialEvidence.toolchain?.circom?.sha256 !== CIRCOM_LINUX_X64_SHA256) {
    throw new Error(
      `Production ZK setup canonical Circom SHA-256 mismatch; expected ` +
        `${CIRCOM_LINUX_X64_SHA256}, got ${initialEvidence.toolchain?.circom?.sha256 ?? "missing"}`,
    );
  }
  try {
    fs.accessSync(path.join(resolvedRoot, CIRCOM_CANONICAL_POLICY.binaryPath), fs.constants.X_OK);
  } catch (error) {
    throw new Error("Production ZK setup canonical Circom compiler is not executable", {
      cause: error,
    });
  }
  if (initialEvidence.trustedSetupStatus !== "development") {
    throw new Error("Refusing to overwrite an existing production ZK trusted setup");
  }
  const initialManifest = JSON.parse(
    await fsp.readFile(path.join(resolvedRoot, ZK_ARTIFACT_MANIFEST_PATH), "utf8"),
  );
  const resolvedCeremonyId = assertCeremonyId(ceremonyId);
  const ptau = await ptauInstaller({ root: resolvedRoot });
  const setupDirectory = path.dirname(ptau.path);
  const lockPath = path.join(setupDirectory, ".setup.lock");
  let lock;
  try {
    lock = await fsp.open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        "A production ZK setup lock already exists; verify whether an earlier run was interrupted",
      );
    }
    throw error;
  }

  let stageRoot;
  try {
    stageRoot = await fsp.mkdtemp(path.join(setupDirectory, ".setup-stage-"));
    await fsp.chmod(stageRoot, 0o700);
    const stageBuild = path.join(stageRoot, "build");
    await fsp.mkdir(path.join(stageRoot, "keys"), { recursive: true, mode: 0o700 });
    await fsp.mkdir(path.join(stageRoot, "release"), { recursive: true, mode: 0o700 });
    await fsp.mkdir(stageBuild, { recursive: true, mode: 0o700 });

    const generated = {};
    for (const circuitName of Object.keys(SETUP_CIRCUITS)) {
      await compileCircuit({
        root: resolvedRoot,
        stageBuild,
        circuitName,
        runner,
      });
      generated[circuitName] = await generateCircuitKeys({
        root: resolvedRoot,
        stageRoot,
        stageBuild,
        circuitName,
        ptauPath: ptau.path,
        runner,
        randomBytesFn,
        metadataReader,
      });
    }

    // The finalization beacon is generated only after both independent Phase 2 contributions.
    const beaconBytes = requireRandomBytes(randomBytesFn, 32, "Finalization beacon");
    const beaconHash = beaconBytes.toString("hex");
    beaconBytes.fill(0);
    const finalized = {};
    for (const [circuitName, circuit] of Object.entries(generated)) {
      finalized[circuitName] = await finalizeCircuitKeys({
        root: resolvedRoot,
        circuit,
        beaconHash,
        runner,
        metadataReader,
      });
    }

    const records = await buildTranscriptAndManifest({
      root: resolvedRoot,
      stageRoot,
      initialManifest,
      ceremonyId: resolvedCeremonyId,
      ptau,
      circuits: finalized,
      beaconHash,
    });
    const entries = buildInstallEntries({
      circuits: finalized,
      records,
    });
    await validateStagedProductionArtifacts({
      root: resolvedRoot,
      ptauPath: ptau.path,
      circuits: finalized,
      manifest: records.manifest,
      transcript: records.transcript,
      runner,
    });
    let validation;
    try {
      await installProductionArtifacts({
        root: resolvedRoot,
        entries,
        validateBeforeCommit: async () => {
          await preCommitValidator({
            root: resolvedRoot,
            ptauPath: ptau.path,
            runner,
          });
        },
        validateAfterCommit: async () => {
          validation = await postCommitValidator({
            root: resolvedRoot,
            ptauPath: ptau.path,
            runner,
          });
        },
      });
    } catch (error) {
      try {
        await runner({
          executable: "npm",
          args: ["run", "clean"],
          cwd: resolvedRoot,
        });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Production ZK setup failed; artifacts were rolled back but build-cache cleanup failed",
        );
      }
      throw error;
    }
    return Object.freeze({
      status: "passed",
      releaseCommit,
      ceremonyId: resolvedCeremonyId,
      trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
      contributorCount: 1,
      ptau,
      manifestSha256:
        validation?.artifacts?.manifestSha256 ??
        sha256File(path.join(resolvedRoot, ZK_ARTIFACT_MANIFEST_PATH)),
      transcriptSha256:
        validation?.artifacts?.transcriptSha256 ?? records.manifest.trustedSetup.transcript.sha256,
    });
  } finally {
    try {
      if (stageRoot) {
        await fsp.rm(stageRoot, { recursive: true, force: true });
      }
    } finally {
      try {
        await lock.close();
      } finally {
        await fsp.rm(lockPath, { force: true });
      }
    }
  }
};
