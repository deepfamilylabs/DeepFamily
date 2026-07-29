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
  "linux-x64-musl": sourceTarget({
    ...CIRCOM_2_1_6_SOURCE,
    id: "linux-x64-musl",
    platform: "linux",
    arch: "x64",
  }),
  "darwin-x64": officialTarget({
    version: "2.1.6",
    platform: "darwin",
    arch: "x64",
    asset: "circom-macos-amd64",
    sha256: "e4f651620b9e675f343464403b37ba21896a0d88b967f1fe9d7989f0e6e797bc",
  }),
  "win32-x64": officialTarget({
    version: "2.1.6",
    platform: "win32",
    arch: "x64",
    asset: "circom-windows-amd64.exe",
    sha256: "d7d96da34cdee7318ddba6b7795543c97f5bde871832827e067920ddfed5457e",
  }),
  "linux-arm64": sourceTarget({
    ...CIRCOM_2_1_6_SOURCE,
    platform: "linux",
    arch: "arm64",
  }),
  "darwin-arm64": sourceTarget({
    ...CIRCOM_2_1_6_SOURCE,
    platform: "darwin",
    arch: "arm64",
  }),
});

/**
 * Historical policies remain addressable by transcript compiler version so upgrading the active
 * Circom pin does not invalidate an already published production ceremony.
 */
export const CIRCOM_TARGET_POLICIES = Object.freeze({
  "2.1.6": CIRCOM_2_1_6_TARGETS,
});

export const CIRCOM_TARGETS = CIRCOM_TARGET_POLICIES[CIRCOM_VERSION];
if (CIRCOM_TARGETS === undefined) {
  throw new Error(`No Circom target policy is registered for version ${CIRCOM_VERSION}`);
}

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

export const circomTargetKey = ({
  platform = process.platform,
  arch = process.arch,
  libc,
  report,
} = {}) => {
  const libcEvidence = resolveLinuxLibcEvidence({ platform, libc, report });
  if (platform === "linux" && arch === "x64" && libcEvidence.family === "musl") {
    return "linux-x64-musl";
  }
  return `${platform}-${arch}`;
};

export const resolveLocalCircomTarget = ({
  version = CIRCOM_VERSION,
  platform = process.platform,
  arch = process.arch,
  libc,
  report,
} = {}) => {
  const targets = CIRCOM_TARGET_POLICIES[version];
  if (targets === undefined) {
    throw new Error(`Unsupported Circom version policy ${version}`);
  }
  const libcEvidence = resolveLinuxLibcEvidence({ platform, libc, report });
  const key =
    platform === "linux" && arch === "x64" && libcEvidence.family === "musl"
      ? "linux-x64-musl"
      : `${platform}-${arch}`;
  const target = targets[key];
  if (target === undefined) {
    throw new Error(
      `Unsupported Circom host ${platform}/${arch}; supported targets: ${Object.keys(targets).join(
        ", ",
      )}`,
    );
  }
  return platform === "linux"
    ? Object.freeze({
        ...target,
        libcEvidence,
      })
    : target;
};

export const localCircomBinaryPath = ({ platform = process.platform } = {}) =>
  platform === "win32" ? "bin/circom.exe" : "bin/circom";

export const localCircomProvenancePath = ({ platform = process.platform } = {}) =>
  `${localCircomBinaryPath({ platform })}.provenance.json`;
