import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PROTOCOL_RELEASE_MANIFEST_PATH = "protocol-release-manifest.json";

const SHA256_HEX = /^[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const assert = (condition, message) => {
  if (!condition) throw new Error(`Protocol release manifest: ${message}`);
};

const assertSha256 = (value, label) => {
  assert(typeof value === "string" && SHA256_HEX.test(value), `${label} must be SHA-256 hex`);
};

const assertAddress = (value, label) => {
  assert(typeof value === "string" && ADDRESS.test(value), `${label} must be an EVM address`);
};

const assertExactSignalNames = (route, names) => {
  assert(Array.isArray(route.publicSignals), `${route.purpose} publicSignals must be an array`);
  assert(route.publicSignals.length === names.length, `${route.purpose} signal count changed`);
  assert(
    route.publicSignals.every((signal, index) => signal?.name === names[index]),
    `${route.purpose} public signal order changed`,
  );
};

export const protocolManifestSha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export const inspectProtocolReleaseManifest = ({
  root = process.cwd(),
  requireProduction = false,
} = {}) => {
  const manifestPath = path.join(root, PROTOCOL_RELEASE_MANIFEST_PATH);
  const bytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(bytes.toString("utf8"));

  assert(manifest.schemaVersion === 1, "schemaVersion must be 1");
  assert(
    manifest.protocol === "deepfamily/onchain-biography-unified-passphrase-v1",
    "unexpected protocol identifier",
  );
  assert(manifest.envelope?.maximumBytes === 16_384, "envelope maximum must be 16,384");
  assert(manifest.envelope?.universalPrefix?.minimumBytes === 20, "prefix must be 20 bytes");
  assert(manifest.envelope?.universalPrefix?.magic === "0x44464d31", "magic must be DFM1");
  assert(
    manifest.envelope?.universalPrefix?.formatVersion?.offset === 4,
    "formatVersion offset must be 4",
  );
  assert(
    manifest.envelope?.universalPrefix?.selfIdentitySuiteId?.offset === 16,
    "self identity suite offset must be 16",
  );
  assert(
    manifest.envelope?.dataContract?.runtimeEncoding === "0x00 || envelope",
    "data-contract runtime encoding changed",
  );

  const format1 = manifest.formats?.["1"];
  assert(format1?.headerLength === 112, "format 1 headerLength must be 112");
  assert(format1?.fixedEnvelopeOverhead === 128, "format 1 overhead must be 128");
  assert(format1?.maximumContentCiphertextBytes === 16_256, "format 1 payload limit changed");
  assert(format1?.plaintext?.schema === "deepfamily/person-version@1.0", "schema changed");
  assert(format1?.aad?.contextAbiWords?.length === 15, "context AAD must contain 15 words");

  const identitySuite = manifest.identitySuites?.["1"];
  const fileSuite = manifest.fileKdfSuites?.["1"];
  for (const [label, suite] of [
    ["identity suite 1", identitySuite],
    ["file KDF suite 1", fileSuite],
  ]) {
    assert(suite?.kdf?.algorithm === "Argon2id", `${label} must use Argon2id`);
    assert(suite?.kdf?.version === 19, `${label} must use Argon2 version 0x13`);
    assert(suite?.kdf?.memoryKiB >= 65_536, `${label} is below the 64 MiB baseline`);
    assert(suite?.kdf?.iterations >= 3, `${label} is below the t=3 baseline`);
    assert(suite?.kdf?.parallelism >= 1, `${label} parallelism is invalid`);
    assert(suite?.kdf?.outputBytes === 32, `${label} output must be 32 bytes`);
  }

  const personRoute = manifest.proofRoutes?.find(
    (route) => route.purpose === "PersonRelation",
  );
  const disclosureRoute = manifest.proofRoutes?.find(
    (route) => route.purpose === "DisclosureBinding",
  );
  assert(personRoute?.purposeOrdinal === 0, "PersonRelation purpose ordinal must be 0");
  assert(disclosureRoute?.purposeOrdinal === 1, "DisclosureBinding purpose ordinal must be 1");
  for (const route of [personRoute, disclosureRoute]) {
    assert(Number.isInteger(route?.circuitId) && route.circuitId > 0, "circuitId must be nonzero");
    assert(route?.proofEncodingId === 1, `${route?.purpose} proofEncodingId must be 1`);
  }
  assertExactSignalNames(personRoute, [
    "identityCommitment",
    "fatherIdentityCommitment",
    "motherIdentityCommitment",
    "submitterAndSelfSuiteId",
    "versionCommitment",
  ]);
  assertExactSignalNames(disclosureRoute, [
    "identityCommitment",
    "disclosureBinding",
    "minter",
    "suiteCommitment",
  ]);

  const goldenVectors = manifest.goldenVectors;
  assert(
    goldenVectors?.path === "protocol-vectors/onchain-biography-v1.json",
    "unexpected golden vector path",
  );
  assertSha256(goldenVectors?.sha256, "golden vector hash");
  const goldenVectorPath = path.join(root, goldenVectors.path);
  assert(fs.existsSync(goldenVectorPath), "golden vector file is missing");
  assert(
    protocolManifestSha256(fs.readFileSync(goldenVectorPath)) === goldenVectors.sha256,
    "golden vector file hash does not match the manifest",
  );

  if (requireProduction) {
    assert(manifest.releaseStatus === "production", "releaseStatus is not production");
    for (const [label, suite] of [
      ["identity suite 1", identitySuite],
      ["file KDF suite 1", fileSuite],
    ]) {
      assert(suite.status === "frozen", `${label} is not frozen`);
    }
    for (const route of [personRoute, disclosureRoute]) {
      assert(route.artifacts?.status === "production", `${route.purpose} artifacts are not production`);
      for (const key of [
        "sourceSha256",
        "r1csSha256",
        "wasmSha256",
        "zkeySha256",
        "verificationKeySha256",
        "solidityVerifierSha256",
        "adapterArtifactSha256",
        "adapterRuntimeSha256",
      ]) {
        assertSha256(route.artifacts?.[key], `${route.purpose}.${key}`);
      }
    }

    assert(manifest.deployments?.status === "production", "deployment evidence is incomplete");
    assert(Number.isInteger(manifest.deployments?.chainId), "deployment chainId is missing");
    assertAddress(manifest.deployments?.deepFamilyProxy, "DeepFamily proxy");
    assertAddress(manifest.deployments?.deepFamilyImplementation, "DeepFamily implementation");
    const archive = manifest.deployments?.metadataArchiveV1;
    const reader = manifest.deployments?.deepFamilyReader;
    assertAddress(archive?.address, "MetadataArchiveV1 address");
    assertAddress(archive?.deepFamilyImmutable, "MetadataArchiveV1 DEEP_FAMILY immutable");
    assertSha256(archive?.artifactSha256, "MetadataArchiveV1 artifactSha256");
    assertSha256(archive?.runtimeSha256, "MetadataArchiveV1 runtimeSha256");
    assertAddress(reader?.address, "DeepFamilyReader address");
    assertAddress(reader?.deepFamilyImmutable, "DeepFamilyReader DEEP_FAMILY immutable");
    assertAddress(reader?.metadataArchiveImmutable, "DeepFamilyReader archive immutable");
    assertSha256(reader?.artifactSha256, "DeepFamilyReader artifactSha256");
    assertSha256(reader?.runtimeSha256, "DeepFamilyReader runtimeSha256");
    assert(manifest.goldenVectors?.status === "frozen", "golden vectors are not frozen");
    for (const key of ["kdfDeviceMatrix", "kdfAttackerCostStudy"]) {
      const evidence = manifest.releaseEvidence?.[key];
      assert(evidence?.status === "passed", `${key} evidence has not passed`);
      assertSha256(evidence?.sha256, `${key} evidence hash`);
    }
    assert(
      manifest.releaseEvidence?.trustedSetup?.status === "production",
      "fresh v1 trusted setup is not production",
    );
    assertSha256(
      manifest.releaseEvidence?.trustedSetup?.manifestSha256,
      "trusted setup manifest hash",
    );
    assertSha256(
      manifest.releaseEvidence?.trustedSetup?.transcriptSha256,
      "trusted setup transcript hash",
    );
  }

  return Object.freeze({
    manifest,
    manifestPath,
    manifestSha256: protocolManifestSha256(bytes),
  });
};
