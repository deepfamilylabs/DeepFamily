#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReceiveProver, nativeReceiveBinary } from "./receive-build.mjs";
import {
  RECEIVE_CIRCUITS,
  inspectReceiveArtifacts,
  receiveArtifactSha256 as sha256,
  readReceiveBuildSnapshot,
  receiveLoaderSourceHashes,
  assertReceiveSourceSnapshot,
} from "./lib/receiveArtifacts.mjs";
import { RECEIVE_CIRCUIT_VERSION } from "../packages/receive-prover/browser.mjs";

const root = path.resolve(import.meta.dirname, "..");
const issuers = Object.fromEntries(
  Object.entries(RECEIVE_CIRCUITS).map(([kind, spec]) => [kind, spec.issuer]),
);
const verifierNames = Object.fromEntries(
  Object.entries(RECEIVE_CIRCUITS).map(([kind, spec]) => [kind, spec.contractName]),
);
/** Fixed keys and 64/32-depth circuits; setup is explicitly local development only. */
export function setupReceiveDevelopment({
  kind = "all",
  outDir = path.join(root, "zk-artifacts/receive"),
  issuerDir = path.join(root, "frontend/public/zk/shielded"),
  compileOnly = false,
  skipBuild = false,
  syncPublic = true,
} = {}) {
  if (kind !== "all" && !Object.hasOwn(issuers, kind))
    throw new Error("Unknown receive presentation circuit");
  outDir = path.resolve(outDir);
  if (syncPublic && fs.existsSync(path.join(root, "circuits/receive-production-manifest.json"))) {
    throw new Error(
      "Refusing to replace production receive presentation artifacts with development keys",
    );
  }
  const binary = skipBuild ? nativeReceiveBinary(outDir) : buildReceiveProver({ outDir }).binary;
  const buildSnapshot = readReceiveBuildSnapshot({ root, outDir });
  for (const [name, issuer] of Object.entries(issuers)) {
    if (kind !== "all" && name !== kind) continue;
    const destination = path.join(outDir, name);
    const manifestPath = path.join(destination, "manifest.json");
    if (fs.existsSync(manifestPath)) {
      const existing = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (
        existing.productionCeremony !== false ||
        existing.setup !== "insecure-local-development"
      ) {
        throw new Error(`Refusing to overwrite production receive artifacts: ${name}`);
      }
    }
    execFileSync(
      binary,
      [
        "setup",
        "--kind",
        name,
        "--issuer-vk",
        path.join(issuerDir, `${issuer}.vkey.json`),
        "--out-dir",
        destination,
        ...(compileOnly ? ["--compile-only"] : []),
      ],
      { cwd: root, stdio: "inherit" },
    );
    readReceiveBuildSnapshot({ root, outDir });
    const generated = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    generated.sourceFiles = buildSnapshot.sourceFiles;
    fs.writeFileSync(manifestPath, `${JSON.stringify(generated, null, 2)}\n`);
  }
  if (syncPublic && !compileOnly) syncReceiveDevelopmentAssets(outDir);
  return outDir;
}

export function syncReceiveDevelopmentAssets(outDir) {
  if (fs.existsSync(path.join(root, "circuits/receive-production-manifest.json"))) {
    throw new Error(
      "Refusing to replace production receive presentation artifacts with development keys",
    );
  }
  const buildSnapshot = readReceiveBuildSnapshot({ root, outDir });
  // Check the complete set before replacing any public files. Fixed issuer keys must
  // still be the keys this circuit was compiled against.
  for (const [kind, spec] of Object.entries(RECEIVE_CIRCUITS)) {
    const directory = path.join(outDir, kind);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
    assertReceiveSourceSnapshot(
      manifest.sourceFiles,
      buildSnapshot.sourceFiles,
      `${kind} receive circuit`,
    );
    if (
      manifest.kind !== kind ||
      manifest.circuitVersion !== RECEIVE_CIRCUIT_VERSION ||
      manifest.publicSignals !== spec.publicSignals ||
      manifest.productionCeremony !== false ||
      manifest.setup !== "insecure-local-development" ||
      manifest.issuerVkSha256 !==
        sha256(path.join(root, "frontend/public/zk/shielded", `${spec.issuer}.vkey.json`))
    ) {
      throw new Error(`Cannot publish stale or non-development receive artifacts: ${kind}`);
    }
    for (const file of ["receipt.r1cs", "receipt.pk", "receipt.vk", "ReceiptVerifier.sol"]) {
      if (sha256(path.join(directory, file)) !== manifest.artifacts?.[file]) {
        throw new Error(`Receive artifact digest mismatch: ${kind}/${file}`);
      }
    }
  }
  const publicDir = path.join(root, "frontend/public/zk/receive");
  fs.mkdirSync(publicDir, { recursive: true });
  const runtime = {
    wasmSha256: sha256(path.join(outDir, "receive-prover.wasm")),
    wasmExecSha256: sha256(path.join(outDir, "wasm_exec.js")),
  };
  for (const file of ["receive-prover.wasm", "wasm_exec.js"])
    fs.copyFileSync(path.join(outDir, file), path.join(publicDir, file));
  const summary = {
    schema: "deepfamily/receive-development-keys@1",
    developmentOnly: true,
    productionReady: false,
    circuitVersion: RECEIVE_CIRCUIT_VERSION,
    sourceFiles: buildSnapshot.sourceFiles,
    loaderSources: receiveLoaderSourceHashes({ root }),
    runtime,
    kinds: {},
  };
  for (const [kind, contractName] of Object.entries(verifierNames)) {
    const directory = path.join(outDir, kind);
    const manifestPath = path.join(directory, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (
      manifest.kind !== kind ||
      manifest.productionCeremony !== false ||
      manifest.setup !== "insecure-local-development"
    ) {
      throw new Error(`Cannot publish non-development receive artifacts as development: ${kind}`);
    }
    for (const [file, digest] of Object.entries(manifest.artifacts)) {
      if (sha256(path.join(directory, file)) !== digest)
        throw new Error(`Receive artifact digest mismatch: ${kind}/${file}`);
    }
    manifest.runtimeArtifacts = {
      "receive-prover.wasm": runtime.wasmSha256,
      "wasm_exec.js": runtime.wasmExecSha256,
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const destination = path.join(publicDir, kind);
    fs.mkdirSync(destination, { recursive: true });
    for (const file of ["receipt.r1cs", "receipt.pk", "receipt.vk", "manifest.json"])
      fs.copyFileSync(path.join(directory, file), path.join(destination, file));
    fs.copyFileSync(
      path.join(directory, "ReceiptVerifier.sol"),
      path.join(root, "contracts", `${contractName}.sol`),
    );
    summary.kinds[kind] = {
      issuerVkSha256: manifest.issuerVkSha256,
      publicSignals: manifest.publicSignals,
      constraints: manifest.constraints,
      manifestSha256: sha256(manifestPath),
      contractName,
      artifacts: manifest.artifacts,
    };
  }
  fs.writeFileSync(
    path.join(root, "circuits/receive-development-manifest.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  inspectReceiveArtifacts({ root });
  return summary;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = (name) => {
    const index = process.argv.indexOf(name);
    return index < 0 ? undefined : process.argv[index + 1];
  };
  setupReceiveDevelopment({
    kind: flag("--kind"),
    outDir: flag("--out-dir"),
    issuerDir: flag("--issuer-dir"),
    compileOnly: process.argv.includes("--compile-only"),
    skipBuild: process.argv.includes("--skip-build"),
    syncPublic: !process.argv.includes("--no-sync"),
  });
}
