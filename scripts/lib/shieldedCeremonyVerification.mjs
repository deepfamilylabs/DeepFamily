import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { assertLocalCircomInstallation } from "../fetch-circom.mjs";
import { renameZkVerifierSource } from "../rename-zk-verifier.mjs";
import { inspectCircomCompilerOverride } from "./circomCompilerOverride.mjs";
import {
  CIRCOM_ARTIFACT_FLAGS,
  CIRCOM_VERSION,
  resolveLocalCircomTarget,
} from "./circomToolchain.mjs";
import {
  assertReleaseRuntimeCompatibility,
  sanitizeReleaseEnvironment,
} from "./portableCommand.mjs";
import { createPrivateTemporaryDirectory } from "./privateTemporaryDirectory.mjs";
import {
  PRODUCTION_PTAU_EVIDENCE,
  inspectPtauFile,
  resolveProductionPtauPath,
} from "./productionPtau.mjs";
import { sourceBundleSha256 } from "./shieldedSourceBundle.mjs";
import {
  assertSnarkjsRuntimeHash,
  buildSnarkjsCommand,
  snapshotSnarkjsRuntime,
} from "./snarkjsToolchain.mjs";
import { sha256File } from "./zkArtifactTrust.mjs";
import { readZkeyMpcMetadata } from "./zkeyMpcMetadata.mjs";

const defaultRunner = ({ executable, args, cwd, env }) =>
  execFileSync(executable, args, { cwd, env, stdio: "inherit" });

const requireRegularFile = (filePath, label) => {
  const absolute = path.resolve(filePath);
  const state = fs.lstatSync(absolute);
  if (!state.isFile() || state.isSymbolicLink() || fs.realpathSync(absolute) !== absolute) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  return absolute;
};

const assertHash = (file, expected, label) => {
  requireRegularFile(file, label);
  if (!/^[0-9a-f]{64}$/u.test(expected ?? "") || sha256File(file) !== expected) {
    throw new Error(`${label} SHA-256 mismatch`);
  }
};

const assertPtauEvidence = (actual, expected) => {
  for (const field of ["bytes", "sha256", "blake2b512"]) {
    if (actual[field] !== expected[field]) {
      throw new Error(`Shielded Powers of Tau ${field} differs from the pinned production file`);
    }
  }
};

const assertMpcMetadata = (action, actual, ceremony) => {
  if (actual.contributionCount !== ceremony.contributions.length + 1) {
    throw new Error(`${action} zkey contribution count differs from its transcript`);
  }
  for (const [index, expected] of ceremony.contributions.entries()) {
    const contribution = actual.contributions[index];
    if (
      contribution?.type !== 0 ||
      contribution.name !== expected.participantId ||
      contribution.contributionHash !== expected.contributionHash
    ) {
      throw new Error(`${action} zkey contribution differs from its transcript`);
    }
  }
  const beacon = actual.contributions.at(-1);
  if (
    beacon?.type !== 1 ||
    beacon.name !== ceremony.beacon.name ||
    beacon.beaconHash !== ceremony.beacon.hash ||
    beacon.contributionHash !== ceremony.beacon.contributionHash ||
    beacon.numIterationsExp !== ceremony.beacon.numIterationsExp
  ) {
    throw new Error(`${action} zkey beacon differs from its transcript`);
  }
};

/** Verify already inspected production artifacts using a private, immutable toolchain snapshot. */
export async function verifyShieldedCeremonyArtifacts({
  root = process.cwd(),
  inspected,
  ptauPath,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  libc,
  report,
  runner = defaultRunner,
  mpcMetadataReader = readZkeyMpcMetadata,
  compilerInspector = assertLocalCircomInstallation,
  overrideInspector = inspectCircomCompilerOverride,
  privateDirectoryFactory = createPrivateTemporaryDirectory,
  runtimeSnapshotter = snapshotSnarkjsRuntime,
  runtimeHashInspector = assertSnarkjsRuntimeHash,
  sourceBundleInspector = sourceBundleSha256,
  expectedProductionPhase1 = PRODUCTION_PTAU_EVIDENCE,
} = {}) {
  for (const collaborator of [
    runner,
    mpcMetadataReader,
    compilerInspector,
    overrideInspector,
    privateDirectoryFactory,
    runtimeSnapshotter,
    runtimeHashInspector,
    sourceBundleInspector,
  ]) {
    if (typeof collaborator !== "function") {
      throw new Error("Shielded ceremony verification collaborators must be functions");
    }
  }
  const resolvedRoot = fs.realpathSync(root);
  if (resolvedRoot !== path.resolve(root)) {
    throw new Error("Shielded ceremony root must not traverse a symbolic link");
  }
  assertReleaseRuntimeCompatibility({
    platform,
    arch,
    env,
    operation: "Shielded ceremony verification",
  });
  const commandEnvironment = sanitizeReleaseEnvironment(env);
  const manifest = structuredClone(inspected?.manifest);
  const entries = Object.entries(inspected?.artifacts ?? {}).map(([action, artifact]) => [
    action,
    {
      ...artifact,
      item: structuredClone(artifact.item),
      ceremony: structuredClone(artifact.ceremony),
    },
  ]);
  if (!manifest || entries.length === 0)
    throw new Error("Inspected shielded production artifacts are required");
  if (manifest.phase1?.sha256 !== expectedProductionPhase1.sha256) {
    throw new Error("Shielded manifest Powers of Tau differs from the pinned production file");
  }
  const assertSourceBundle = () => {
    if (sourceBundleInspector(resolvedRoot) !== manifest.sourceBundleSha256) {
      throw new Error("Shielded source bundle changed during ceremony verification");
    }
  };
  assertSourceBundle();
  const selectedPtau =
    typeof ptauPath === "string" && ptauPath.trim() !== ""
      ? path.resolve(resolvedRoot, ptauPath)
      : resolveProductionPtauPath({ root: resolvedRoot, env: commandEnvironment, platform });
  requireRegularFile(selectedPtau, "Published Powers of Tau");
  const ptauEvidence = await inspectPtauFile(selectedPtau);
  assertPtauEvidence(ptauEvidence, expectedProductionPhase1);

  // Version checks also receive the sanitized environment, before any private compiler is run.
  const versionRunner = (executable) =>
    String(
      execFileSync(executable, ["--version"], {
        cwd: resolvedRoot,
        env: commandEnvironment,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ).trim();
  const compilerOptions = {
    root: resolvedRoot,
    env: commandEnvironment,
    platform,
    arch,
    libc,
    report,
    versionRunner,
  };
  const compiler =
    (await overrideInspector(compilerOptions)) ?? (await compilerInspector(compilerOptions));
  const target = resolveLocalCircomTarget({ platform, arch, libc, report });
  if (
    compiler?.version !== CIRCOM_VERSION ||
    compiler.target !== target.id ||
    compiler.strategy !== target.strategy ||
    (target.strategy === "official-binary" && compiler.sha256 !== target.sha256)
  ) {
    throw new Error("Shielded ceremony compiler differs from the verified native target");
  }
  assertHash(compiler.path, compiler.sha256, "Verified native Circom compiler");

  const privateRoot = await privateDirectoryFactory({
    prefix: "deepfamily-shielded-ceremony-",
    platform,
  });
  try {
    const originals = [];
    const snapshots = [];
    const copy = (source, destination, digest, label, executable = false) => {
      assertHash(source, digest, label);
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, executable ? 0o500 : 0o400);
      assertHash(destination, digest, `${label} snapshot`);
      originals.push({ file: source, digest, label });
      snapshots.push({ file: destination, digest, label: `${label} snapshot` });
      return destination;
    };
    const privateCompiler = copy(
      compiler.path,
      path.join(privateRoot, platform === "win32" ? "circom.exe" : "circom"),
      compiler.sha256,
      "Circom compiler",
      true,
    );
    const privatePtau = copy(
      selectedPtau,
      path.join(privateRoot, "phase1.ptau"),
      ptauEvidence.sha256,
      "Powers of Tau",
    );
    assertPtauEvidence(await inspectPtauFile(privatePtau), expectedProductionPhase1);
    const runtime = await runtimeSnapshotter({
      root: resolvedRoot,
      destinationRoot: path.join(privateRoot, "snarkjs-runtime"),
      expectedSha256: manifest.toolchain?.snarkjsRuntimeSha256,
      platform,
    });
    const build = path.join(privateRoot, "build");
    fs.mkdirSync(build, { mode: 0o700 });
    const circuits = [];
    for (const [action, artifact] of entries) {
      const { item, ceremony } = artifact;
      if (
        !/^[A-Za-z][A-Za-z0-9]*$/u.test(action) ||
        !/^shielded_[a-z_]+$/u.test(item?.source ?? "")
      ) {
        throw new Error("Shielded ceremony circuit identity is invalid");
      }
      const source = requireRegularFile(artifact.sourcePath, `${action} source`);
      assertHash(source, item.sourceSha256, `${action} source`);
      originals.push({ file: source, digest: item.sourceSha256, label: `${action} source` });
      const files = {};
      for (const [field, digestField, suffix] of [
        ["r1cs", "r1csSha256", ".r1cs"],
        ["wasm", "wasmSha256", ".wasm"],
        ["zkey", "zkeySha256", ".zkey"],
        ["vkey", "verificationKeySha256", ".vkey.json"],
        ["verifier", "verifierSha256", ".sol"],
      ]) {
        files[field] = copy(
          artifact[field],
          path.join(privateRoot, `${action}${suffix}`),
          item[digestField],
          `${action} ${field}`,
        );
      }
      circuits.push({ action, source, files, item, ceremony });
    }
    const runSnarkjs = (args) =>
      runner({
        ...buildSnarkjsCommand({ root: runtime.root, cwd: resolvedRoot, args }),
        env: commandEnvironment,
      });
    await runSnarkjs(["powersoftau", "verify", privatePtau]);
    for (const { action, source, files, item, ceremony } of circuits) {
      await runner({
        executable: privateCompiler,
        args: [
          source,
          ...CIRCOM_ARTIFACT_FLAGS,
          "-l",
          path.join(resolvedRoot, "node_modules"),
          "-l",
          path.join(resolvedRoot, "node_modules/circomlib/circuits"),
          "-o",
          build,
        ],
        cwd: resolvedRoot,
        env: commandEnvironment,
      });
      assertHash(
        path.join(build, `${item.source}.r1cs`),
        item.r1csSha256,
        `${action} rebuilt R1CS`,
      );
      assertHash(
        path.join(build, `${item.source}_js`, `${item.source}.wasm`),
        item.wasmSha256,
        `${action} rebuilt WASM`,
      );
      await runSnarkjs(["zkey", "verify", files.r1cs, privatePtau, files.zkey]);
      assertMpcMetadata(action, await mpcMetadataReader(files.zkey), ceremony);
      const exportedVkey = path.join(build, `${action}.vkey.json`);
      const exportedVerifier = path.join(build, `${action}.sol`);
      await runSnarkjs(["zkey", "export", "verificationkey", files.zkey, exportedVkey]);
      await runSnarkjs(["zkey", "export", "solidityverifier", files.zkey, exportedVerifier]);
      if (
        JSON.stringify(JSON.parse(fs.readFileSync(exportedVkey, "utf8"))) !==
        JSON.stringify(JSON.parse(fs.readFileSync(files.vkey, "utf8")))
      ) {
        throw new Error(`${action} vkey was not exported from the production zkey`);
      }
      if (
        renameZkVerifierSource(
          fs.readFileSync(exportedVerifier, "utf8"),
          item.verifierContractName,
        ) !== fs.readFileSync(files.verifier, "utf8")
      ) {
        throw new Error(`${action} Solidity verifier was not exported from the production zkey`);
      }
      snapshots.push(
        {
          file: path.join(build, `${item.source}.r1cs`),
          digest: item.r1csSha256,
          label: `${action} rebuilt R1CS`,
        },
        {
          file: path.join(build, `${item.source}_js`, `${item.source}.wasm`),
          digest: item.wasmSha256,
          label: `${action} rebuilt WASM`,
        },
      );
    }
    for (const { file, digest, label } of [...snapshots, ...originals])
      assertHash(file, digest, label);
    assertPtauEvidence(await inspectPtauFile(privatePtau), expectedProductionPhase1);
    await runtimeHashInspector({
      root: runtime.root,
      expectedSha256: manifest.toolchain.snarkjsRuntimeSha256,
    });
    await runtimeHashInspector({
      root: resolvedRoot,
      expectedSha256: manifest.toolchain.snarkjsRuntimeSha256,
    });
    assertSourceBundle();
    return Object.freeze({
      status: "passed",
      manifestSha256: inspected.manifestSha256,
      circuitCount: circuits.length,
      ptau: Object.freeze({ ...ptauEvidence }),
    });
  } finally {
    fs.rmSync(privateRoot, { recursive: true, force: true });
  }
}
