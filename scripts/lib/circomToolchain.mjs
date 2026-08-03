export const CIRCOM_VERSION = "2.1.6";
const CIRCOM_2_1_6_SOURCE = Object.freeze({
  repository: "https://github.com/iden3/circom.git",
  commit: "57b18f68794189753964bfb6e18e64385fed9c2c",
});
export const CIRCOM_SOURCE_REPOSITORY = CIRCOM_2_1_6_SOURCE.repository;
export const CIRCOM_SOURCE_COMMIT = CIRCOM_2_1_6_SOURCE.commit;
export const CIRCOM_CANONICAL_BINARY_PATH = "bin/circom-release-linux-amd64";
export const CIRCOM_ARTIFACT_FLAGS = Object.freeze(["--r1cs", "--wasm", "--sym", "--O2"]);

const releaseAssetUrl = (version, asset) =>
  `https://github.com/iden3/circom/releases/download/v${version}/${asset}`;

const officialTarget = ({ version, platform, arch, id = `${platform}-${arch}`, asset, sha256 }) =>
  Object.freeze({
    id,
    platform,
    arch,
    strategy: "official-binary",
    asset,
    url: releaseAssetUrl(version, asset),
    sha256,
  });

const sourceTarget = ({ platform, arch, repository, commit, id = `${platform}-${arch}` }) =>
  Object.freeze({
    id,
    platform,
    arch,
    strategy: "pinned-source",
    repository,
    commit,
  });

const CIRCOM_2_1_6_TARGETS = Object.freeze({
  "linux-x64": officialTarget({
    version: "2.1.6",
    platform: "linux",
    arch: "x64",
    asset: "circom-linux-amd64",
    sha256: "f3958483caaaa0cdd3912df5049e2e635eab4d09b9a66807be9633d547859f12",
  }),
  "darwin-arm64": sourceTarget({
    ...CIRCOM_2_1_6_SOURCE,
    platform: "darwin",
    arch: "arm64",
  }),
  "win32-x64": officialTarget({
    version: "2.1.6",
    platform: "win32",
    arch: "x64",
    asset: "circom-windows-amd64.exe",
    sha256: "d7d96da34cdee7318ddba6b7795543c97f5bde871832827e067920ddfed5457e",
  }),
});

/** Version-indexed target policies bind compiler evidence to this repository's supported set. */
export const CIRCOM_TARGET_POLICIES = Object.freeze({
  "2.1.6": CIRCOM_2_1_6_TARGETS,
});

export const CIRCOM_TARGETS = CIRCOM_TARGET_POLICIES[CIRCOM_VERSION];
if (CIRCOM_TARGETS === undefined) {
  throw new Error(`No Circom target policy is registered for version ${CIRCOM_VERSION}`);
}

export const CIRCOM_RUNTIME_TARGET_ALLOWLIST = Object.freeze(Object.keys(CIRCOM_TARGETS));
const CIRCOM_RUNTIME_TARGET_SET = new Set(CIRCOM_RUNTIME_TARGET_ALLOWLIST);

export const CIRCOM_CANONICAL_POLICY = Object.freeze({
  id: `circom-${CIRCOM_VERSION}-official-linux-x64`,
  binaryPath: CIRCOM_CANONICAL_BINARY_PATH,
  target: CIRCOM_TARGETS["linux-x64"],
});

export const CIRCOM_LINUX_X64_SHA256 = CIRCOM_CANONICAL_POLICY.target.sha256;
export const CIRCOM_LINUX_X64_URL = CIRCOM_CANONICAL_POLICY.target.url;

const createLibcEvidence = ({ family, version, source }) =>
  Object.freeze({
    family,
    version,
    source,
  });

export const detectLinuxLibcEvidence = ({ report = process.report } = {}) => {
  const runtimeReport =
    typeof report?.getReport === "function" ? report.getReport() : (report ?? {});
  const reportedVersion = runtimeReport?.header?.glibcVersionRuntime;
  if (typeof reportedVersion === "string" && reportedVersion.trim() !== "") {
    return createLibcEvidence({
      family: "glibc",
      version: reportedVersion.trim(),
      source: "process.report.header.glibcVersionRuntime",
    });
  }
  return createLibcEvidence({
    family: "musl",
    version: null,
    source: "process.report.header.glibcVersionRuntime",
  });
};

const injectedLinuxLibcEvidence = (libc) => {
  if (libc !== "glibc" && libc !== "musl") {
    throw new Error(`Unsupported Linux libc ${String(libc)}; expected glibc or musl`);
  }
  return createLibcEvidence({
    family: libc,
    version: null,
    source: "explicit-libc",
  });
};

const resolveLinuxLibcEvidence = ({ platform, libc, report }) => {
  if (platform !== "linux") {
    if (libc !== undefined) {
      throw new Error(`A libc override is only valid for Linux hosts, got ${platform}`);
    }
    return null;
  }
  if (libc !== undefined) return injectedLinuxLibcEvidence(libc);
  if (report !== undefined || process.platform === "linux") {
    return detectLinuxLibcEvidence({ report: report ?? process.report });
  }
  return createLibcEvidence({
    family: "glibc",
    version: null,
    source: "simulated-linux-default",
  });
};

const assertSupportedLinuxLibc = ({ platform, libcEvidence }) => {
  if (platform === "linux" && libcEvidence.family !== "glibc") {
    throw new Error(
      `Unsupported Linux libc ${libcEvidence.family}; the supported Linux runtime is x64 with glibc`,
    );
  }
};

const assertRuntimeTargetAllowed = ({ platform, arch, key }) => {
  if (!CIRCOM_RUNTIME_TARGET_SET.has(key)) {
    throw new Error(
      `Unsupported Circom host ${platform}/${arch}; supported runtime targets: ` +
        CIRCOM_RUNTIME_TARGET_ALLOWLIST.join(", "),
    );
  }
};

const isWindowsArm64Host = (env) =>
  env !== null &&
  typeof env === "object" &&
  !Array.isArray(env) &&
  Object.entries(env).some(
    ([name, value]) =>
      ["PROCESSOR_ARCHITECTURE", "PROCESSOR_ARCHITEW6432"].includes(name.toUpperCase()) &&
      String(value).toLowerCase() === "arm64",
  );

const assertSupportedWindowsHost = ({ platform, env }) => {
  if (platform === "win32" && isWindowsArm64Host(env)) {
    throw new Error(
      "Unsupported Windows ARM64 host, including x64 Node.js emulation; " +
        "the supported Windows runtime is x64 Node.js on an x64 host",
    );
  }
};

export const circomTargetKey = ({
  platform = process.platform,
  arch = process.arch,
  libc,
  report,
  env = process.env,
} = {}) => {
  assertSupportedWindowsHost({ platform, env });
  const libcEvidence = resolveLinuxLibcEvidence({ platform, libc, report });
  assertSupportedLinuxLibc({ platform, libcEvidence });
  const key = `${platform}-${arch}`;
  assertRuntimeTargetAllowed({ platform, arch, key });
  return key;
};

/** Resolve an immutable target policy for validating compiler evidence. */
export const resolveCircomTargetPolicy = ({ version, platform, arch, libc, report }) => {
  const targets = CIRCOM_TARGET_POLICIES[version];
  if (targets === undefined) {
    throw new Error(`Unsupported Circom version policy ${version}`);
  }
  const libcEvidence = resolveLinuxLibcEvidence({ platform, libc, report });
  assertSupportedLinuxLibc({ platform, libcEvidence });
  const key = `${platform}-${arch}`;
  const target = targets[key];
  if (target === undefined) {
    throw new Error(`Unsupported Circom host ${platform}/${arch} in policy ${version}`);
  }
  return platform === "linux"
    ? Object.freeze({
        ...target,
        libcEvidence,
      })
    : target;
};

export const resolveLocalCircomTarget = ({
  version = CIRCOM_VERSION,
  platform = process.platform,
  arch = process.arch,
  libc,
  report,
  env = process.env,
} = {}) => {
  const targets = CIRCOM_TARGET_POLICIES[version];
  if (targets === undefined) {
    throw new Error(`Unsupported Circom version policy ${version}`);
  }
  assertSupportedWindowsHost({ platform, env });
  const key = circomTargetKey({ platform, arch, libc, report, env });
  assertRuntimeTargetAllowed({ platform, arch, key });
  return resolveCircomTargetPolicy({ version, platform, arch, libc, report });
};

export const localCircomBinaryPath = ({ platform = process.platform } = {}) =>
  platform === "win32" ? "bin/circom.exe" : "bin/circom";

export const localCircomProvenancePath = ({ platform = process.platform } = {}) =>
  `${localCircomBinaryPath({ platform })}.provenance.json`;
