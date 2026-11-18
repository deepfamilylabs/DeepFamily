import {
  inspectSnarkjsToolchain,
  readCanonicalJsonFile,
  validateZkArtifactManifest,
  ZK_ARTIFACT_MANIFEST_PATH,
} from "./lib/zkArtifactTrust.mjs";

try {
  const { parsed } = readCanonicalJsonFile(ZK_ARTIFACT_MANIFEST_PATH, "ZK artifact manifest");
  const { toolchain } = validateZkArtifactManifest(parsed);
  const { snarkjs, snarkjsRuntime } = inspectSnarkjsToolchain(process.cwd(), toolchain);
  console.log(`[snarkjs] CLI SHA-256: ${snarkjs.sha256}`);
  console.log(
    `[snarkjs] Runtime SHA-256 (${snarkjsRuntime.instances.length} installed packages): ${snarkjsRuntime.sha256}`,
  );
} catch (error) {
  console.error(`[snarkjs] ${error.message}`);
  process.exitCode = 1;
}
