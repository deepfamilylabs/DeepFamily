import path from "node:path";

export const CIRCOM_VERSION = "2.2.3";
const CIRCOM_2_2_3_SOURCE = Object.freeze({
  repository: "https://github.com/iden3/circom.git",
  commit: "ad44e915a12bb047b05745c2884aad9cc8326bc6",
});
export const CIRCOM_SOURCE_REPOSITORY = CIRCOM_2_2_3_SOURCE.repository;
export const CIRCOM_SOURCE_COMMIT = CIRCOM_2_2_3_SOURCE.commit;
export const CIRCOM_CANONICAL_BINARY_PATH = "bin/circom-release-linux-amd64";
export const CIRCOM_ARTIFACT_FLAGS = Object.freeze([
  "--r1cs",
  "--wasm",
  "--sym",
  "--O2",
  "--sanity_check",
  "2",
]);

/**
 * Library roots for every compile, in search order: npm packages, circomlib and the circuits
 * tree. Circom looks beside the including file first. Identity sources include the shared
 * `lib/identity.circom` through the last root, so their bytes stay unchanged wherever they live.
 */
export const circomIncludeDirectories = (root = "") => [
  path.join(root, "node_modules"),
  path.join(root, "node_modules", "circomlib", "circuits"),
  path.join(root, "circuits"),
];

export const circomIncludeArguments = (root = "") =>
  circomIncludeDirectories(root).flatMap((directory) => ["-l", directory]);

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

const CIRCOM_2_2_3_TARGETS = Object.freeze({
  "linux-x64": officialTarget({
    version: "2.2.3",
    platform: "linux",
    arch: "x64",
    asset: "circom-linux-amd64",
    sha256: "85342c7ff332d948df7c0c50ecf201e6129349aef550ce873f3c811b79fe53a3",
  }),
  "darwin-arm64": sourceTarget({
    ...CIRCOM_2_2_3_SOURCE,
    platform: "darwin",
    arch: "arm64",
  }),
  "win32-x64": officialTarget({
    version: "2.2.3",
    platform: "win32",
    arch: "x64",
    asset: "circom-windows-amd64.exe",
    sha256: "e43f132ee6f0aa79b705beceb59c2a7e6a54d7bdeab917ca34e9fc1951d185e1",
  }),
});

/** Version-indexed target policies bind compiler evidence to this repository's supported set. */
export const CIRCOM_TARGET_POLICIES = Object.freeze({
  "2.2.3": CIRCOM_2_2_3_TARGETS,
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
// The pinned official Linux binary imports symbols introduced in GLIBC_2.34.
export const CIRCOM_LINUX_MIN_GLIBC_VERSION = "2.34";

const assertSupportedGlibcVersion = (version) => {
  if (version === null) return;
  const parts = /^(\d+)\.(\d+)(?:\.\d+)*$/u.exec(version);
  const [minimumMajor, minimumMinor] = CIRCOM_LINUX_MIN_GLIBC_VERSION.split(".").map(BigInt);
  if (
    parts === null ||
    BigInt(parts[1]) < minimumMajor ||
    (BigInt(parts[1]) === minimumMajor && BigInt(parts[2]) < minimumMinor)
  ) {
    throw new Error(
      `Unsupported Linux glibc ${version}; the pinned Circom compiler requires glibc >= ${CIRCOM_LINUX_MIN_GLIBC_VERSION}`,
    );
  }
};

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
  if (libc !== undefined) {
    const evidence = injectedLinuxLibcEvidence(libc);
    // Keep explicit family evidence for policy simulations, while still rejecting a known
    // incompatible version from the supplied report or the actual Linux host.
    if (libc === "glibc" && (report !== undefined || process.platform === "linux")) {
      const detected = detectLinuxLibcEvidence({ report: report ?? process.report });
      if (detected.family === "glibc") assertSupportedGlibcVersion(detected.version);
    }
    return evidence;
  }
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
  if (platform === "linux") assertSupportedGlibcVersion(libcEvidence.version);
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
