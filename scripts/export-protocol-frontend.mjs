import fs from "node:fs";
import path from "node:path";
import {
  PROTOCOL_CIRCUITS,
  protocolArtifactPaths,
  inspectProtocolArtifacts,
} from "./protocol-zk-development.mjs";
import { inspectCanonicalBoundaryArtifacts } from "./lib/canonicalBoundaryArtifacts.mjs";

/** Export trusted build pins, never verification keys supplied by a received code. */
export function exportProtocolFrontendArtifacts({
  root = path.resolve(import.meta.dirname, ".."),
  chainId,
  registryAddress,
  assetBaseUrl = "/zk/protocol",
  destination = "frontend/public/zk/protocol",
  writeConfig = true,
} = {}) {
  if (![31337n, 1337n].includes(BigInt(chainId)))
    throw new Error("Development artifacts are restricted to local chains");
  if (!/^0x[\da-f]{40}$/iu.test(registryAddress ?? "") || BigInt(registryAddress) === 0n)
    throw new Error("Invalid receiving registry address");
  if (!assetBaseUrl.startsWith("/") || assetBaseUrl.startsWith("//") || assetBaseUrl.includes(".."))
    throw new Error("Expected a same-origin artifact path");
  const sourceManifest = inspectProtocolArtifacts({ root });
  const boundaries = inspectCanonicalBoundaryArtifacts({ root, requireR1cs: false });
  const output = path.resolve(root, destination);
  if (!output.startsWith(path.resolve(root, "frontend/public") + path.sep))
    throw new Error("Proof artifacts must be exported beneath frontend/public");
  fs.mkdirSync(output, { recursive: true });
  const manifest = { version: 1, chainId: String(chainId), registryAddress, circuits: {} };
  const copy = (file, sha256) => {
    const filename = path.basename(file);
    const destinationFile = path.join(output, filename);
    if (path.resolve(file) !== destinationFile) fs.copyFileSync(file, destinationFile);
    return { url: `${assetBaseUrl.replace(/\/$/u, "")}/${filename}`, sha256 };
  };
  for (const [name, spec] of Object.entries(PROTOCOL_CIRCUITS)) {
    const files = protocolArtifactPaths(name, { root });
    const entry = sourceManifest.circuits[name];
    const hashes = { ...entry.compiled, ...entry.setup.artifacts };
    manifest.circuits[name] = { circuit: spec.source };
    for (const kind of ["wasm", "zkey", "vkey"]) {
      const relative = path.relative(root, files[kind]).split(path.sep).join("/");
      manifest.circuits[name][kind] = copy(files[kind], hashes[relative]);
    }
  }
  for (const [name, entry] of Object.entries(boundaries.circuits)) {
    const prefix = path.join(root, "frontend/public/zk/shielded", entry.source);
    manifest.circuits[name] = {
      circuit: entry.source,
      wasm: copy(`${prefix}.wasm`, entry.wasmSha256),
      zkey: copy(`${prefix}_final.zkey`, entry.zkeySha256),
      vkey: copy(`${prefix}.vkey.json`, entry.verificationKeySha256),
    };
  }
  // Import these pins into the app at build time. Fetching an unpinned manifest
  // alongside the received code must never choose the accepted verification key.
  const configFile = path.join(root, "frontend/src/proof-artifacts.local.json");
  if (writeConfig) fs.writeFileSync(configFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, configFile: writeConfig ? configFile : null };
}
