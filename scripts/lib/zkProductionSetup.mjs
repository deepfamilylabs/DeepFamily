import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { assertLocalCircomInstallation, buildPinnedCircomFromSource } from "../fetch-circom.mjs";
import { renameZkVerifierFile } from "../rename-zk-verifier.mjs";
import {
  CIRCOM_ARTIFACT_FLAGS,
  CIRCOM_LINUX_X64_SHA256,
  CIRCOM_VERSION,
  localCircomBinaryPath,
  resolveLocalCircomTarget,
} from "./circomToolchain.mjs";
import {
  buildCircomOverrideEnvironment,
  withoutCircomOverrideEnvironment,
} from "./circomCompilerOverride.mjs";
import {
  ZK_ARTIFACT_MANIFEST_PATH,
  ZK_CEREMONY_TRANSCRIPT_PATH,
  ZK_RELEASE_ARTIFACTS,
  ZK_TRUST_MODEL_SINGLE_OPERATOR,
  inspectZkReleaseArtifacts,
  readCanonicalJsonFile,
  sha256CanonicalTextFile,
  sha256File,
  sha256Text,
  validateZkArtifactManifest,
  validateProductionTranscript,
} from "./zkArtifactTrust.mjs";
import {
  assertReleaseRuntimeCompatibility,
  normalizePortableCommand,
  sanitizeReleaseEnvironment,
} from "./portableCommand.mjs";
import { createPrivateTemporaryDirectory } from "./privateTemporaryDirectory.mjs";
import { ensureProductionPtau, inspectPtauFile } from "./productionPtau.mjs";
import { buildSnarkjsCommand, snapshotSnarkjsRuntime } from "./snarkjsToolchain.mjs";
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

const defaultCaptureRunner = ({ executable, args, cwd, env = process.env }) =>
  execFileSync(executable, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

export const defaultProductionSetupRunner = ({
  executable,
  args,
  cwd,
  stdin = null,
  env = process.env,
}) => {
  const command = normalizePortableCommand({
    executable,
    args,
    platform: process.platform,
    env,
  });
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
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
};

const assertCleanGitState = ({ root, env, captureRunner = defaultCaptureRunner }) => {
  const commit = String(
    captureRunner({
      executable: "git",
      args: ["rev-parse", "HEAD"],
      cwd: root,
      env,
    }),
  ).trim();
  const status = String(
    captureRunner({
      executable: "git",
      args: ["status", "--porcelain=v1", "--untracked-files=all"],
      cwd: root,
      env,
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

const validateCompilerLibcEvidence = ({ platform, libcEvidence }) => {
  if (platform !== "linux") {
    if (libcEvidence !== null) {
      throw new Error("Production ZK setup non-Linux compiler must not declare libc evidence");
    }
    return null;
  }
  if (
    libcEvidence === null ||
    typeof libcEvidence !== "object" ||
    !["glibc", "musl"].includes(libcEvidence.family) ||
    ![
      "process.report.header.glibcVersionRuntime",
      "explicit-libc",
      "simulated-linux-default",
    ].includes(libcEvidence.source) ||
    !(
      libcEvidence.version === null ||
      (typeof libcEvidence.version === "string" && libcEvidence.version.length > 0)
    )
  ) {
    throw new Error("Production ZK setup Linux compiler libc evidence is invalid");
  }
  return Object.freeze({
    family: libcEvidence.family,
    version: libcEvidence.version,
    source: libcEvidence.source,
  });
};

export const buildProductionCompilerEvidence = ({ compiler, platform, arch }) => {
  const libcEvidence = validateCompilerLibcEvidence({
    platform,
    libcEvidence: compiler?.libcEvidence ?? null,
  });
  const target = resolveLocalCircomTarget({
    platform,
    arch,
    ...(libcEvidence === null ? {} : { libc: libcEvidence.family }),
  });
  if (compiler?.version !== CIRCOM_VERSION) {
    throw new Error(
      `Production ZK setup local compiler version mismatch; expected ${CIRCOM_VERSION}, ` +
        `got ${compiler?.version ?? "missing"}`,
    );
  }
  if (compiler.target !== target.id) {
    throw new Error(
      `Production ZK setup local compiler target mismatch; expected ${target.id}, ` +
        `got ${compiler.target ?? "missing"}`,
    );
  }
  if (compiler.strategy !== target.strategy) {
    throw new Error(
      `Production ZK setup local compiler strategy mismatch; expected ${target.strategy}, ` +
        `got ${compiler.strategy ?? "missing"}`,
    );
  }
  if (typeof compiler.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(compiler.sha256)) {
    throw new Error("Production ZK setup local compiler SHA-256 is invalid");
  }
  if (target.strategy === "official-binary" && compiler.sha256 !== target.sha256) {
    throw new Error(
      `Production ZK setup local compiler SHA-256 mismatch; expected ${target.sha256}, ` +
        `got ${compiler.sha256}`,
    );
  }
  let sourceBuild = null;
  if (target.strategy === "pinned-source") {
    const record = compiler.sourceBuild;
    if (
      record === null ||
      typeof record !== "object" ||
      record.repository !== target.repository ||
      record.commit !== target.commit ||
      typeof record.cargoVersion !== "string" ||
      record.cargoVersion.trim() === "" ||
      typeof record.rustcVersion !== "string" ||
      record.rustcVersion.trim() === ""
    ) {
      throw new Error("Production ZK setup source-build compiler evidence is invalid");
    }
    sourceBuild = Object.freeze({
      repository: record.repository,
      commit: record.commit,
      cargoVersion: record.cargoVersion.trim(),
      rustcVersion: record.rustcVersion.trim(),
    });
  } else if ((compiler.sourceBuild ?? null) !== null) {
    throw new Error("Production ZK setup official compiler must not declare source-build evidence");
  }
  return Object.freeze({
    version: compiler.version,
    target: compiler.target,
    platform,
    arch,
    strategy: compiler.strategy,
    binarySha256: compiler.sha256,
    libcEvidence,
    sourceBuild,
  });
};

const requireRandomBytes = (randomBytesFn, length, label) => {
  const generated = randomBytesFn(length);
  if (!(generated instanceof Uint8Array)) {
    throw new Error(`${label} generator must return mutable bytes`);
  }
  const value = Buffer.from(generated.buffer, generated.byteOffset, generated.byteLength);
  if (value.length !== length) {
    value.fill(0);
    throw new Error(`${label} must contain exactly ${length} random bytes`);
  }
  return value;
};

const encodeLowerHexLine = (bytes) => {
  const alphabet = Buffer.from("0123456789abcdef", "ascii");
  const output = Buffer.alloc(bytes.length * 2 + 1);
  for (const [index, value] of bytes.entries()) {
    output[index * 2] = alphabet[value >>> 4];
    output[index * 2 + 1] = alphabet[value & 0x0f];
  }
  output[output.length - 1] = 0x0a;
  return output;
};

export const runSecretContribution = async ({
  runner,
  cwd,
  oldZkey,
  newZkey,
  randomBytesFn,
  runtimeRoot = cwd,
  snarkjsRuntimeSha256,
  env = process.env,
}) => {
  if (!/^[0-9a-f]{64}$/u.test(snarkjsRuntimeSha256 ?? "")) {
    throw new Error("Phase 2 contribution requires the reviewed snarkjs runtime SHA-256");
  }
  const entropy = requireRandomBytes(randomBytesFn, 64, "Phase 2 entropy");
  let stdin;
  try {
    stdin = encodeLowerHexLine(entropy);
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
        runtimeRoot,
        snarkjsRuntimeSha256,
      ],
      cwd,
      stdin,
      env: sanitizeReleaseEnvironment(env),
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

export const preparePrivateProductionCompiler = async ({
  target,
  inspectedCompiler,
  stageRoot,
  sourceBuilder = buildPinnedCircomFromSource,
  sourceEnvironment = process.env,
}) => {
  const destination = path.join(stageRoot, target.platform === "win32" ? "circom.exe" : "circom");
  let sha256;
  let sourceBuild = null;
  if (target.strategy === "official-binary") {
    await requireRegularNonSymlink(inspectedCompiler?.path, "Inspected Circom compiler");
    await fsp.copyFile(inspectedCompiler.path, destination, fs.constants.COPYFILE_EXCL);
    sha256 = sha256File(destination);
    if (sha256 !== inspectedCompiler.sha256 || sha256 !== target.sha256) {
      throw new Error(
        `Production ZK setup private compiler SHA-256 mismatch; expected ${target.sha256}, ` +
          `got ${sha256}`,
      );
    }
  } else if (target.strategy === "pinned-source") {
    const built = await sourceBuilder({ target, env: sourceEnvironment });
    if (!Buffer.isBuffer(built?.bytes)) {
      throw new Error("Production ZK setup source builder must return compiler bytes");
    }
    const cargoVersion = String(built.cargoVersion ?? "").trim();
    const rustcVersion = String(built.rustcVersion ?? "").trim();
    if (cargoVersion === "" || rustcVersion === "") {
      throw new Error(
        "Production ZK setup source builder must report Cargo and Rust compiler versions",
      );
    }
    await fsp.writeFile(destination, built.bytes, { flag: "wx", mode: 0o700 });
    sha256 = sha256File(destination);
    sourceBuild = Object.freeze({
      repository: target.repository,
      commit: target.commit,
      cargoVersion,
      rustcVersion,
    });
  } else {
    throw new Error(`Unsupported production Circom strategy: ${target.strategy}`);
  }
  await fsp.chmod(destination, 0o700);
  return Object.freeze({
    path: destination,
    target: target.id,
    strategy: target.strategy,
    sha256,
    version: CIRCOM_VERSION,
    libcEvidence: target.libcEvidence ?? null,
    sourceBuild,
  });
};

const copyPtauIntoPrivateStage = async ({ ptau, stageRoot }) => {
  await requireRegularNonSymlink(ptau.path, "Installed Powers of Tau");
  const destination = path.join(stageRoot, path.basename(ptau.path));
  await fsp.copyFile(ptau.path, destination, fs.constants.COPYFILE_EXCL);
  await fsp.chmod(destination, 0o600);
  const snapshot = Object.freeze({ ...ptau, path: destination });
  await assertPtauSnapshotMatchesEvidence({ ptauPath: destination, expected: ptau });
  return snapshot;
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
  privateDirectoryFactory = createPrivateTemporaryDirectory,
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
      ? await privateDirectoryFactory({ prefix: "deepfamily-zk-backup-" })
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

export const buildProductionCircuitCompileCommand = ({
  root,
  stageBuild,
  circuitName,
  compilerPath,
}) => {
  const circuit = SETUP_CIRCUITS[circuitName];
  if (circuit === undefined) {
    throw new Error(`Unsupported production ZK circuit: ${circuitName}`);
  }
  if (typeof compilerPath !== "string" || !path.isAbsolute(compilerPath)) {
    throw new Error("Production ZK compiler path must be absolute");
  }
  const resolvedRoot = path.resolve(root);
  return Object.freeze({
    executable: compilerPath,
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

const compileCircuit = async ({ root, stageBuild, circuitName, compilerPath, runner, env }) => {
  await runner({
    ...buildProductionCircuitCompileCommand({
      root,
      stageBuild,
      circuitName,
      compilerPath,
    }),
    env,
  });
};

const stagedCircuitPaths = ({ stageBuild, circuitName }) =>
  Object.freeze({
    circuitName,
    r1cs: path.join(stageBuild, `${circuitName}.r1cs`),
    wasm: path.join(stageBuild, `${circuitName}_js`, `${circuitName}.wasm`),
  });

export const assertCompiledCircuitMatchesManifest = ({ compiledCircuit, initialManifest }) => {
  const { circuitName, r1cs, wasm } = compiledCircuit;
  const expected = initialManifest?.circuits?.[circuitName];
  const hashes = {};
  for (const [artifactName, filePath, hashField] of [
    ["R1CS", r1cs, "r1csSha256"],
    ["WASM", wasm, "wasmSha256"],
  ]) {
    const expectedHash = expected?.[hashField];
    if (typeof expectedHash !== "string") {
      throw new Error(`Production ZK setup manifest is missing ${circuitName}.${hashField}`);
    }
    const actualHash = sha256File(filePath);
    if (actualHash !== expectedHash) {
      throw new Error(
        `Production ZK setup ${circuitName} staged ${artifactName} SHA-256 mismatch; ` +
          `expected ${expectedHash}, got ${actualHash}`,
      );
    }
    hashes[hashField] = expectedHash;
  }
  return Object.freeze({ ...compiledCircuit, ...hashes });
};

export const assertStagedCircuitCompilationMatchesManifest = ({ stageBuild, initialManifest }) => {
  const compiled = {};
  for (const circuitName of Object.keys(SETUP_CIRCUITS)) {
    compiled[circuitName] = assertCompiledCircuitMatchesManifest({
      compiledCircuit: stagedCircuitPaths({ stageBuild, circuitName }),
      initialManifest,
    });
  }
  return Object.freeze(compiled);
};

export const assertPtauSnapshotMatchesEvidence = async ({ ptauPath, expected }) => {
  const actual = await inspectPtauFile(ptauPath);
  for (const field of ["bytes", "sha256", "blake2b512"]) {
    if (actual[field] !== expected?.[field]) {
      throw new Error(
        `Production ZK setup staged Powers of Tau ${field} mismatch; ` +
          `expected ${expected?.[field] ?? "missing"}, got ${actual[field]}`,
      );
    }
  }
  return actual;
};

export const buildProductionSnarkjsCommand = ({ root, runtimeRoot = root, args }) => {
  return buildSnarkjsCommand({ root: runtimeRoot, args, cwd: root });
};

const generateCircuitKeys = async ({
  root,
  stageRoot,
  compiledCircuit,
  initialManifest,
  ptau,
  runner,
  randomBytesFn,
  metadataReader,
  contributionEnvironment,
  runtimeRoot,
}) => {
  const { circuitName, r1cs, wasm } = compiledCircuit;
  const keyDirectory = path.join(stageRoot, "keys");
  const releaseDirectory = path.join(stageRoot, "release");
  const initialZkey = path.join(keyDirectory, `${circuitName}_0000.zkey`);
  const contributedZkey = path.join(keyDirectory, `${circuitName}_contributed.zkey`);
  const finalZkey = path.join(releaseDirectory, `${circuitName}_final.zkey`);
  const verificationKey = path.join(releaseDirectory, `${circuitName}.vkey.json`);
  const solidityVerifier = path.join(releaseDirectory, `${circuitName}.sol`);

  // Revalidate immediately before every Phase 2 setup. This closes the long window in which the
  // second circuit (or the shared pTau) could otherwise change after the initial batch check.
  assertCompiledCircuitMatchesManifest({ compiledCircuit, initialManifest });
  await assertPtauSnapshotMatchesEvidence({ ptauPath: ptau.path, expected: ptau });
  await runner({
    ...buildProductionSnarkjsCommand({
      root,
      runtimeRoot,
      args: ["groth16", "setup", r1cs, ptau.path, initialZkey],
    }),
    env: contributionEnvironment,
  });
  await runSecretContribution({
    runner,
    cwd: root,
    oldZkey: initialZkey,
    newZkey: contributedZkey,
    randomBytesFn,
    runtimeRoot,
    snarkjsRuntimeSha256: initialManifest.toolchain.snarkjsRuntimeSha256,
    env: contributionEnvironment,
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
  });
};

const finalizeCircuitKeys = async ({
  root,
  runtimeRoot,
  circuit,
  beaconHash,
  runner,
  metadataReader,
  commandEnvironment,
}) => {
  await runner({
    ...buildProductionSnarkjsCommand({
      root,
      runtimeRoot,
      args: [
        "zkey",
        "beacon",
        circuit.contributedZkey,
        circuit.finalZkey,
        beaconHash,
        String(SINGLE_OPERATOR_BEACON_ITERATIONS_EXP),
        `--name=${SINGLE_OPERATOR_BEACON_NAME}`,
      ],
    }),
    env: commandEnvironment,
  });
  await runner({
    ...buildProductionSnarkjsCommand({
      root,
      runtimeRoot,
      args: ["zkey", "export", "verificationkey", circuit.finalZkey, circuit.verificationKey],
    }),
    env: commandEnvironment,
  });
  await runner({
    ...buildProductionSnarkjsCommand({
      root,
      runtimeRoot,
      args: ["zkey", "export", "solidityverifier", circuit.finalZkey, circuit.solidityVerifier],
    }),
    env: commandEnvironment,
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

export const buildTranscriptAndManifest = async ({
  root,
  stageRoot,
  initialManifest,
  compiler,
  ceremonyId,
  ptau,
  circuits,
  beaconHash,
}) => {
  const circuitEvidence = Object.fromEntries(
    Object.entries(circuits).map(([circuitName, circuit]) => {
      const reviewed = initialManifest?.circuits?.[circuitName];
      const sourcePath = path.join(root, SETUP_CIRCUITS[circuitName].source);
      const sourceSha256 = sha256CanonicalTextFile(sourcePath, `${circuitName} source`);
      if (sourceSha256 !== reviewed?.sourceSha256) {
        throw new Error(
          `Production ZK setup ${circuitName} source SHA-256 mismatch; expected ` +
            `${reviewed?.sourceSha256 ?? "missing"}, got ${sourceSha256}`,
        );
      }
      const compiled = assertCompiledCircuitMatchesManifest({
        compiledCircuit: { circuitName, r1cs: circuit.r1cs, wasm: circuit.wasm },
        initialManifest,
      });
      return [
        circuitName,
        {
          sourceSha256: reviewed.sourceSha256,
          r1csSha256: compiled.r1csSha256,
          wasmSha256: compiled.wasmSha256,
          zkeySha256: sha256File(circuit.finalZkey),
          verificationKeySha256: sha256CanonicalTextFile(
            circuit.verificationKey,
            `${circuitName} verification key`,
          ),
          solidityVerifierSha256: sha256CanonicalTextFile(
            circuit.solidityVerifier,
            `${circuitName} Solidity verifier`,
          ),
        },
      ];
    }),
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
    schemaVersion: 3,
    trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
    compiler,
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
  runtimeRoot = root,
  commandEnvironment,
}) => {
  validateZkArtifactManifest(manifest, { requireProduction: true });
  validateProductionTranscript({ transcript, manifest });
  await runner({
    ...buildProductionSnarkjsCommand({
      root,
      runtimeRoot,
      args: ["powersoftau", "verify", ptauPath],
    }),
    env: commandEnvironment,
  });
  for (const circuit of Object.values(circuits)) {
    await runner({
      ...buildProductionSnarkjsCommand({
        root,
        runtimeRoot,
        args: ["zkey", "verify", circuit.r1cs, ptauPath, circuit.finalZkey],
      }),
      env: commandEnvironment,
    });
  }
  for (const command of buildStagedProofValidationCommands({ root, circuits })) {
    await runner({ ...command, cwd: root, env: commandEnvironment });
  }
};

const defaultPreCommitValidator = async ({ root, runner, commandEnvironment }) => {
  await runner({
    executable: "npm",
    args: ["run", "zk:check"],
    cwd: root,
    env: commandEnvironment,
  });
  await runner({
    executable: "npm",
    args: ["run", "build"],
    cwd: root,
    env: commandEnvironment,
  });
};

const defaultPostCommitValidator = async ({
  root,
  ptauPath,
  runner,
  compilerEnvironment = process.env,
}) => {
  await runner({
    executable: "npm",
    args: ["run", "zk:artifacts:check"],
    cwd: root,
    env: compilerEnvironment,
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
  libc,
  report,
  runner = defaultProductionSetupRunner,
  captureRunner = defaultCaptureRunner,
  randomBytesFn = randomBytes,
  metadataReader = readZkeyMpcMetadata,
  ptauInstaller = ensureProductionPtau,
  artifactInspector = inspectZkReleaseArtifacts,
  compilerInspector = assertLocalCircomInstallation,
  compilerSourceBuilder = buildPinnedCircomFromSource,
  runtimeSnapshotter = snapshotSnarkjsRuntime,
  privateDirectoryFactory = createPrivateTemporaryDirectory,
  preCommitValidator = defaultPreCommitValidator,
  postCommitValidator = defaultPostCommitValidator,
} = {}) => {
  if (String(env.CI ?? "").toLowerCase() === "true") {
    throw new Error("Production ZK setup must be run interactively outside CI");
  }
  if (
    typeof runner !== "function" ||
    typeof captureRunner !== "function" ||
    typeof artifactInspector !== "function" ||
    typeof compilerInspector !== "function" ||
    typeof compilerSourceBuilder !== "function" ||
    typeof runtimeSnapshotter !== "function" ||
    typeof privateDirectoryFactory !== "function"
  ) {
    throw new Error("Production ZK setup collaborators must be functions");
  }
  assertReleaseRuntimeCompatibility({
    platform,
    arch,
    operation: "Production ZK setup",
  });
  const localTarget = resolveLocalCircomTarget({ platform, arch, libc, report });
  const resolvedRoot = fs.realpathSync(root);
  if (resolvedRoot !== path.resolve(root)) {
    throw new Error("Production ZK setup root must not traverse a symlink");
  }
  const baseEnvironment = withoutCircomOverrideEnvironment(sanitizeReleaseEnvironment(env));
  const releaseCommit = assertCleanGitState({
    root: resolvedRoot,
    env: baseEnvironment,
    captureRunner,
  });
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
  if (initialEvidence.trustedSetupStatus !== "development") {
    throw new Error("Refusing to overwrite an existing production ZK trusted setup");
  }
  const { parsed: initialManifest, raw: initialManifestRaw } = readCanonicalJsonFile(
    path.join(resolvedRoot, ZK_ARTIFACT_MANIFEST_PATH),
    "Initial ZK artifact manifest",
  );
  const initialManifestSha256 = sha256Text(initialManifestRaw);
  if (initialManifestSha256 !== initialEvidence.manifestSha256) {
    throw new Error(
      `Production ZK setup initial manifest changed after validation; expected ` +
        `${initialEvidence.manifestSha256 ?? "missing"}, got ${initialManifestSha256}`,
    );
  }
  if (initialManifest.schemaVersion !== 3) {
    throw new Error(
      "Production ZK setup requires manifest schemaVersion 3; refresh the development artifacts first",
    );
  }
  let inspectedCompiler = null;
  if (localTarget.strategy === "official-binary") {
    inspectedCompiler = await compilerInspector({
      root: resolvedRoot,
      platform,
      arch,
      libc,
      report,
    });
    if (typeof inspectedCompiler?.path !== "string" || !path.isAbsolute(inspectedCompiler.path)) {
      throw new Error("Production ZK setup compiler inspector must return an absolute path");
    }
    const expectedCompilerPath = path.join(resolvedRoot, localCircomBinaryPath({ platform }));
    if (path.resolve(inspectedCompiler.path) !== expectedCompilerPath) {
      throw new Error(
        `Production ZK setup compiler path mismatch; expected ${expectedCompilerPath}, ` +
          `got ${inspectedCompiler.path}`,
      );
    }
    if (
      inspectedCompiler.target !== localTarget.id ||
      inspectedCompiler.strategy !== localTarget.strategy ||
      inspectedCompiler.version !== CIRCOM_VERSION
    ) {
      throw new Error("Production ZK setup compiler inspector returned unexpected target evidence");
    }
  }
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
  let compilerEvidence;
  try {
    stageRoot = await privateDirectoryFactory({
      prefix: "deepfamily-zk-production-",
      platform,
    });
    const stageBuild = path.join(stageRoot, "build");
    await fsp.mkdir(path.join(stageRoot, "keys"), { recursive: true, mode: 0o700 });
    await fsp.mkdir(path.join(stageRoot, "release"), { recursive: true, mode: 0o700 });
    await fsp.mkdir(stageBuild, { recursive: true, mode: 0o700 });
    const privateCompiler = await preparePrivateProductionCompiler({
      target: localTarget,
      inspectedCompiler,
      stageRoot,
      sourceBuilder: compilerSourceBuilder,
      sourceEnvironment: baseEnvironment,
    });
    const snarkjsRuntime = runtimeSnapshotter({
      root: resolvedRoot,
      destinationRoot: path.join(stageRoot, "snarkjs-runtime"),
      expectedSha256: initialManifest.toolchain.snarkjsRuntimeSha256,
      platform,
    });
    compilerEvidence = buildProductionCompilerEvidence({
      compiler: privateCompiler,
      platform,
      arch,
    });
    const compilerEnvironment =
      localTarget.strategy === "pinned-source"
        ? buildCircomOverrideEnvironment({ env: baseEnvironment, compiler: privateCompiler })
        : baseEnvironment;
    const stagedPtau = await copyPtauIntoPrivateStage({ ptau, stageRoot });

    for (const circuitName of Object.keys(SETUP_CIRCUITS)) {
      await compileCircuit({
        root: resolvedRoot,
        stageBuild,
        circuitName,
        compilerPath: privateCompiler.path,
        runner,
        env: baseEnvironment,
      });
    }
    const compiled = assertStagedCircuitCompilationMatchesManifest({
      stageBuild,
      initialManifest,
    });

    const generated = {};
    for (const circuitName of Object.keys(SETUP_CIRCUITS)) {
      generated[circuitName] = await generateCircuitKeys({
        root: resolvedRoot,
        stageRoot,
        compiledCircuit: compiled[circuitName],
        initialManifest,
        ptau: stagedPtau,
        runner,
        randomBytesFn,
        metadataReader,
        contributionEnvironment: baseEnvironment,
        runtimeRoot: snarkjsRuntime.root,
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
        runtimeRoot: snarkjsRuntime.root,
        circuit,
        beaconHash,
        runner,
        metadataReader,
        commandEnvironment: baseEnvironment,
      });
    }

    assertStagedCircuitCompilationMatchesManifest({ stageBuild, initialManifest });
    await assertPtauSnapshotMatchesEvidence({
      ptauPath: stagedPtau.path,
      expected: stagedPtau,
    });
    const records = await buildTranscriptAndManifest({
      root: resolvedRoot,
      stageRoot,
      initialManifest,
      compiler: compilerEvidence,
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
      ptauPath: stagedPtau.path,
      circuits: finalized,
      manifest: records.manifest,
      transcript: records.transcript,
      runner,
      runtimeRoot: snarkjsRuntime.root,
      commandEnvironment: baseEnvironment,
    });
    assertStagedCircuitCompilationMatchesManifest({ stageBuild, initialManifest });
    await assertPtauSnapshotMatchesEvidence({
      ptauPath: stagedPtau.path,
      expected: stagedPtau,
    });
    let validation;
    try {
      await installProductionArtifacts({
        root: resolvedRoot,
        entries,
        validateBeforeCommit: async () => {
          await preCommitValidator({
            root: resolvedRoot,
            ptauPath: stagedPtau.path,
            runner,
            commandEnvironment: baseEnvironment,
          });
        },
        validateAfterCommit: async () => {
          validation = await postCommitValidator({
            root: resolvedRoot,
            ptauPath: stagedPtau.path,
            runner,
            compilerEnvironment,
          });
        },
      });
    } catch (error) {
      try {
        await runner({
          executable: "npm",
          args: ["run", "clean"],
          cwd: resolvedRoot,
          env: baseEnvironment,
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
