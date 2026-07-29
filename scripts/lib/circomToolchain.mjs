export const CIRCOM_VERSION = "2.1.6";
export const CIRCOM_SOURCE_REPOSITORY = "https://github.com/iden3/circom.git";
export const CIRCOM_SOURCE_COMMIT = "57b18f68794189753964bfb6e18e64385fed9c2c";
export const CIRCOM_CANONICAL_BINARY_PATH = "bin/circom-release-linux-amd64";
export const CIRCOM_ARTIFACT_FLAGS = Object.freeze(["--r1cs", "--wasm", "--sym", "--O2"]);

const releaseAssetUrl = (asset) =>
  `https://github.com/iden3/circom/releases/download/v${CIRCOM_VERSION}/${asset}`;

const officialTarget = ({ platform, arch, asset, sha256 }) =>
  Object.freeze({
    id: `${platform}-${arch}`,
    platform,
    arch,
    strategy: "official-binary",
    asset,
    url: releaseAssetUrl(asset),
    sha256,
  });

const sourceTarget = ({ platform, arch }) =>
  Object.freeze({
    id: `${platform}-${arch}`,
    platform,
    arch,
    strategy: "pinned-source",
    repository: CIRCOM_SOURCE_REPOSITORY,
    commit: CIRCOM_SOURCE_COMMIT,
  });

export const CIRCOM_TARGETS = Object.freeze({
  "linux-x64": officialTarget({
    platform: "linux",
    arch: "x64",
    asset: "circom-linux-amd64",
    sha256: "f3958483caaaa0cdd3912df5049e2e635eab4d09b9a66807be9633d547859f12",
  }),
  "darwin-x64": officialTarget({
    platform: "darwin",
    arch: "x64",
    asset: "circom-macos-amd64",
    sha256: "e4f651620b9e675f343464403b37ba21896a0d88b967f1fe9d7989f0e6e797bc",
  }),
  "win32-x64": officialTarget({
    platform: "win32",
    arch: "x64",
    asset: "circom-windows-amd64.exe",
    sha256: "d7d96da34cdee7318ddba6b7795543c97f5bde871832827e067920ddfed5457e",
  }),
  "linux-arm64": sourceTarget({ platform: "linux", arch: "arm64" }),
  "darwin-arm64": sourceTarget({ platform: "darwin", arch: "arm64" }),
  "win32-arm64": sourceTarget({ platform: "win32", arch: "arm64" }),
});

export const CIRCOM_CANONICAL_POLICY = Object.freeze({
  id: `circom-${CIRCOM_VERSION}-official-linux-x64`,
  binaryPath: CIRCOM_CANONICAL_BINARY_PATH,
  target: CIRCOM_TARGETS["linux-x64"],
});

export const CIRCOM_LINUX_X64_SHA256 = CIRCOM_CANONICAL_POLICY.target.sha256;
export const CIRCOM_LINUX_X64_URL = CIRCOM_CANONICAL_POLICY.target.url;

export const circomTargetKey = ({ platform = process.platform, arch = process.arch } = {}) =>
  `${platform}-${arch}`;

export const resolveLocalCircomTarget = ({
  platform = process.platform,
  arch = process.arch,
} = {}) => {
  const key = circomTargetKey({ platform, arch });
  const target = CIRCOM_TARGETS[key];
  if (target === undefined) {
    throw new Error(
      `Unsupported Circom host ${platform}/${arch}; supported targets: ${Object.keys(
        CIRCOM_TARGETS,
      ).join(", ")}`,
    );
  }
  return target;
};

export const assertCanonicalCircomHost = ({
  platform = process.platform,
  arch = process.arch,
  operation = "This operation",
} = {}) => {
  if (
    platform !== CIRCOM_CANONICAL_POLICY.target.platform ||
    arch !== CIRCOM_CANONICAL_POLICY.target.arch
  ) {
    throw new Error(
      `${operation} requires the canonical ${CIRCOM_CANONICAL_POLICY.target.id} host`,
    );
  }
  return CIRCOM_CANONICAL_POLICY.target;
};

export const localCircomBinaryPath = ({ platform = process.platform } = {}) =>
  platform === "win32" ? "bin/circom.exe" : "bin/circom";

export const localCircomProvenancePath = ({ platform = process.platform } = {}) =>
  `${localCircomBinaryPath({ platform })}.provenance.json`;
