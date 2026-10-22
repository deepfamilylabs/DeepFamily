#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RECEIVE_BUILD_MANIFEST,
  RECEIVE_CIRCUITS,
  RECEIVE_DEVELOPMENT_MANIFEST,
  RECEIVE_PRODUCTION_MANIFEST,
  receiveProverSourceHashes,
  receiveArtifactSha256,
  assertReceiveSourceSnapshot,
  readReceiveBuildSnapshot,
  inspectReceiveArtifacts,
} from "./lib/receiveArtifacts.mjs";

const root = path.resolve(import.meta.dirname, "..");
export function receiveGoBinary() {
  return process.env.RECEIVE_PROVER_GO_BIN || "go";
}
export function nativeReceiveBinary(outDir) {
  return path.join(outDir, process.platform === "win32" ? "receive-prover.exe" : "receive-prover");
}
export function receiveGoBuildEnvironment({ root: buildRoot = root, env = process.env } = {}) {
  const goModule = fs.readFileSync(path.join(buildRoot, "packages/receive-prover/go.mod"), "utf8");
  const version = /^go (\d+\.\d+\.\d+)\s*$/mu.exec(goModule)?.[1];
  if (!version) throw new Error("Receive go.mod must pin an exact Go patch version");
  const buildEnv = Object.fromEntries(
    Object.entries(env).filter(
      ([name]) =>
        !["GOTOOLCHAIN", "GOROOT", "GOOS", "GOARCH", "GOWORK"].includes(name.toUpperCase()),
    ),
  );
  return { ...buildEnv, GOTOOLCHAIN: `go${version}`, GOWORK: "off" };
}
export function receiveBuildIsCurrent({ root: buildRoot = root, outDir } = {}) {
  outDir ??= path.join(buildRoot, "zk-artifacts/receive");
  try {
    readReceiveBuildSnapshot({ root: buildRoot, outDir });
    return ["browser.mjs", "worker.mjs", "wasm_exec.js"].every((name) =>
      fs
        .readFileSync(path.join(outDir, name))
        .equals(fs.readFileSync(path.join(buildRoot, "packages/receive-prover", name))),
    );
  } catch {
    return false;
  }
}

/** Reuse the application's verified keys for native checks, without running setup. */
export function syncCurrentReceiveArtifacts({
  root: buildRoot = root,
  outDir = path.join(buildRoot, "zk-artifacts/receive"),
  inspector = inspectReceiveArtifacts,
  copyFile = fs.copyFileSync,
} = {}) {
  const inspected = inspector({ root: buildRoot });
  const summaryFile = path.join(
    buildRoot,
    inspected.status === "production" ? RECEIVE_PRODUCTION_MANIFEST : RECEIVE_DEVELOPMENT_MANIFEST,
  );
  if (receiveArtifactSha256(summaryFile) !== inspected.manifestSha256)
    throw new Error("Receive manifest changed after artifact inspection");
  const summary = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
  const copies = [];
  for (const [kind, spec] of Object.entries(RECEIVE_CIRCUITS)) {
    const directory = path.join(buildRoot, "frontend/public/zk/receive", kind);
    for (const name of [
      "receipt.r1cs",
      "receipt.pk",
      "receipt.vk",
      "ReceiptVerifier.sol",
      "manifest.json",
    ]) {
      copies.push({
        source:
          name === "ReceiptVerifier.sol"
            ? path.join(buildRoot, "contracts", `${spec.contractName}.sol`)
            : path.join(directory, name),
        destination: path.join(outDir, kind, name),
        expected:
          name === "manifest.json"
            ? summary.kinds[kind].manifestSha256
            : summary.kinds[kind].artifacts[name],
      });
    }
  }
  if (inspected.status !== "production") {
    // Check the entire destination set before copying even the first development key.
    for (const kind of Object.keys(RECEIVE_CIRCUITS)) {
      const manifestFile = path.join(outDir, kind, "manifest.json");
      if (!fs.existsSync(manifestFile)) continue;
      const existing = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      if (existing.productionCeremony === true || existing.setup === "single-operator-mpc")
        throw new Error(
          `Refusing to overwrite production receive artifacts with development keys: ${kind}`,
        );
    }
  }
  let copied = 0;
  // Inspect every source before writing the native kit. All paths come from the fixed catalog.
  for (const { source, expected } of copies) {
    if (receiveArtifactSha256(source) !== expected)
      throw new Error(`Receive artifact changed after inspection: ${source}`);
  }
  for (const { source, destination, expected } of copies) {
    if (fs.existsSync(destination) && receiveArtifactSha256(destination) === expected) continue;
    const directory = path.dirname(destination);
    fs.mkdirSync(directory, { recursive: true });
    const temporary = fs.mkdtempSync(path.join(directory, ".sync-"));
    try {
      const staged = path.join(temporary, path.basename(destination));
      copyFile(source, staged, fs.constants.COPYFILE_FICLONE);
      if (receiveArtifactSha256(staged) !== expected)
        throw new Error(`Receive artifact changed while copying: ${source}`);
      fs.renameSync(staged, destination);
      copied++;
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
  return { outDir, copied };
}
export function buildReceiveProver({
  outDir = path.join(root, "zk-artifacts/receive"),
  ifNeeded = false,
} = {}) {
  outDir = path.resolve(outDir);
  if (ifNeeded && receiveBuildIsCurrent({ outDir })) {
    console.log("Receive native/WASM build matches current sources and artifacts");
    return { outDir, binary: nativeReceiveBinary(outDir) };
  }
  fs.mkdirSync(outDir, { recursive: true });
  const cwd = path.join(root, "packages/receive-prover");
  const go = receiveGoBinary();
  const env = receiveGoBuildEnvironment();
  const sourceFiles = receiveProverSourceHashes({ root });
  const goroot = execFileSync(go, ["env", "GOROOT"], { cwd, env, encoding: "utf8" }).trim();
  if (
    !fs
      .readFileSync(path.join(cwd, "wasm_exec.js"))
      .equals(fs.readFileSync(path.join(goroot, "lib/wasm/wasm_exec.js")))
  ) {
    throw new Error(
      "Vendored receive WASM runtime differs from the exact Go version pinned in go.mod",
    );
  }
  execFileSync(go, ["build", "-trimpath", "-o", nativeReceiveBinary(outDir), "."], {
    cwd,
    stdio: "inherit",
    env,
  });
  execFileSync(go, ["build", "-trimpath", "-o", path.join(outDir, "receive-prover.wasm"), "."], {
    cwd,
    stdio: "inherit",
    env: { ...env, GOOS: "js", GOARCH: "wasm" },
  });
  fs.copyFileSync(path.join(goroot, "lib/wasm/wasm_exec.js"), path.join(outDir, "wasm_exec.js"));
  for (const name of ["browser.mjs", "worker.mjs"])
    fs.copyFileSync(path.join(cwd, name), path.join(outDir, name));
  assertReceiveSourceSnapshot(
    receiveProverSourceHashes({ root }),
    sourceFiles,
    "Receive sources changed during build",
  );
  const files = [path.basename(nativeReceiveBinary(outDir)), "receive-prover.wasm", "wasm_exec.js"];
  fs.writeFileSync(
    path.join(outDir, RECEIVE_BUILD_MANIFEST),
    `${JSON.stringify(
      {
        schema: "deepfamily/receive-prover-build@1",
        sourceFiles,
        artifacts: Object.fromEntries(
          files.map((name) => [name, receiveArtifactSha256(path.join(outDir, name))]),
        ),
      },
      null,
      2,
    )}\n`,
  );
  return { outDir, binary: nativeReceiveBinary(outDir) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf("--out-dir");
  const built = buildReceiveProver({
    outDir: index < 0 ? undefined : process.argv[index + 1],
    ifNeeded: process.argv.includes("--if-needed"),
  });
  if (process.argv.includes("--sync-current")) {
    try {
      const { copied } = syncCurrentReceiveArtifacts({ outDir: built.outDir });
      console.log(`Receive native kit matches current application keys (${copied} files copied)`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      console.log("Receive native key sync deferred until the public proving files are available");
    }
  }
}
