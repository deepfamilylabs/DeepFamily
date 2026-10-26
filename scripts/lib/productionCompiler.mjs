import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildPinnedCircomFromSource } from "../fetch-circom.mjs";
import { CIRCOM_VERSION, resolveLocalCircomTarget } from "./circomToolchain.mjs";
const sha256File = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
async function requireRegularNonSymlink(file, label) {
  const absolute = path.resolve(file),
    state = await fsp.lstat(absolute);
  if (!state.isFile() || state.isSymbolicLink() || (await fsp.realpath(absolute)) !== absolute)
    throw new Error(`${label} must be a regular non-symlink file`);
}

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
