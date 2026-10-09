import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { syncZkAssets } from "../../circuits/sync-zk-assets.mjs";
import { renameZkVerifierSource } from "../rename-zk-verifier.mjs";
import { SHIELDED_SETUP_CIRCUITS } from "./shieldedProductionSetup.mjs";
import { checkedFile } from "./shieldedSourceBundle.mjs";

export const SHIELDED_DEVELOPMENT_MANIFEST_PATH = "circuits/shielded-development-manifest.json";
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Use the same public asset synchronization as the identity and disclosure setup. */
export async function syncShieldedDevelopmentAssets({
  root = process.cwd(),
  manifest,
  output = console,
} = {}) {
  root = path.resolve(root);
  if (fs.existsSync(path.join(root, "circuits/shielded-production-manifest.json"))) {
    throw new Error("Refusing to overwrite shielded production artifacts with development keys");
  }
  const directory = path.join(root, "zk-artifacts/shielded");
  manifest ??= JSON.parse(
    fs.readFileSync(path.join(directory, "development-manifest.json"), "utf8"),
  );
  if (
    manifest.schema !== "deepfamily/shielded-development-keys@1" ||
    manifest.developmentOnly !== true ||
    manifest.productionReady !== false ||
    Object.keys(manifest.circuits ?? {})
      .sort()
      .join(",") !== Object.keys(SHIELDED_SETUP_CIRCUITS).sort().join(",")
  ) {
    throw new Error("Shielded development manifest must cover all eight development circuits");
  }
  const files = [];
  const verifiers = [];
  for (const [action, spec] of Object.entries(SHIELDED_SETUP_CIRCUITS)) {
    const item = manifest.circuits[action];
    if (item.source !== spec.source) throw new Error(`${action} development source mismatch`);
    for (const [source, destination, field] of [
      [`${spec.source}_js/${spec.source}.wasm`, `${spec.source}.wasm`, "wasmSha256"],
      [`${spec.source}_dev_final.zkey`, `${spec.source}_final.zkey`, "zkeySha256"],
      [`${spec.source}.vkey.json`, `${spec.source}.vkey.json`, "verificationKeySha256"],
    ]) {
      const file = checkedFile(
        root,
        `zk-artifacts/shielded/${source}`,
        `${action} development artifact`,
      );
      if (sha256(file) !== item[field])
        throw new Error(`${action} ${field} mismatch before synchronization`);
      files.push({ source, destination });
    }
    if (!spec.verifierPath) continue;
    const verifier = checkedFile(
      root,
      `zk-artifacts/shielded/verifiers/${spec.source}.sol`,
      `${action} development verifier`,
    );
    if (sha256(verifier) !== item.verifierSha256)
      throw new Error(`${action} verifier digest mismatch`);
    verifiers.push({
      spec,
      item,
      source: renameZkVerifierSource(fs.readFileSync(verifier, "utf8"), spec.verifierContractName),
    });
  }
  const synchronized = await syncZkAssets({
    sourceDirectory: directory,
    destinationDirectory: path.join(root, "frontend/public/zk/shielded"),
    files,
    output,
  });
  if (synchronized.exitCode !== 0)
    throw new Error("Shielded frontend artifact synchronization failed");
  for (const { spec, item, source } of verifiers) {
    const file = path.join(root, spec.verifierPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
    item.verifierPath = spec.verifierPath;
    item.verifierContractName = spec.verifierContractName;
    item.solidityVerifierSha256 = sha256(file);
  }
  const raw = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(directory, "development-manifest.json"), raw);
  fs.writeFileSync(path.join(root, SHIELDED_DEVELOPMENT_MANIFEST_PATH), raw);
  return manifest;
}
