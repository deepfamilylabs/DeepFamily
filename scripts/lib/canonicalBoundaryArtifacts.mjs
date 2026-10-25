import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
export const BOUNDARY_DEVELOPMENT_MANIFEST = "circuits/shielded-development-manifest.json";
import { SHIELDED_DEPLOYMENT_CIRCUITS } from "./zkDeploymentCatalog.mjs";

const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Reuse the reviewed VALUE relations without trusting any retired receive route. */
export function inspectCanonicalBoundaryArtifacts({
  root = process.cwd(),
  requireR1cs = true,
} = {}) {
  const manifestFile = BOUNDARY_DEVELOPMENT_MANIFEST;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestFile), "utf8"));
  const checked = {};
  for (const [action, spec] of Object.entries(SHIELDED_DEPLOYMENT_CIRCUITS)) {
    const entry = manifest.circuits?.[action];
    if (entry?.source !== spec.source || entry.verifierContractName !== spec.verifierContractName) {
      throw new Error(
        `Boundary ${action} artifact statement does not match the canonical protocol`,
      );
    }
    const prefix = `frontend/public/zk/shielded/${spec.source}`;
    const files = {
      [`circuits/${spec.source}.circom`]: entry.sourceSha256,
      [`${prefix}.wasm`]: entry.wasmSha256,
      [`${prefix}_final.zkey`]: entry.zkeySha256,
      [`${prefix}.vkey.json`]: entry.verificationKeySha256,
      [entry.verifierPath]: entry.solidityVerifierSha256 ?? entry.verifierSha256,
      ...(requireR1cs ? { [`zk-artifacts/shielded/${spec.source}.r1cs`]: entry.r1csSha256 } : {}),
    };
    for (const [file, digest] of Object.entries(files)) {
      if (!/^[a-f\d]{64}$/u.test(digest ?? "") || sha256(path.join(root, file)) !== digest) {
        throw new Error(`Boundary ${action} artifact hash mismatch: ${file}`);
      }
    }
    const vkey = JSON.parse(fs.readFileSync(path.join(root, `${prefix}.vkey.json`), "utf8"));
    if (
      vkey.protocol !== "groth16" ||
      vkey.curve !== "bn128" ||
      vkey.nPublic !== spec.publicSignals
    ) {
      throw new Error(`Boundary ${action} verification key ABI mismatch`);
    }
    checked[action] = { ...spec, ...entry, files };
  }
  return { manifest: manifestFile, circuits: checked };
}
