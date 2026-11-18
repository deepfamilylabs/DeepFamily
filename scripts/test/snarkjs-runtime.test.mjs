import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectSnarkjsRuntime } from "../lib/snarkjsToolchain.mjs";
import { sha256File, ZK_ARTIFACT_MANIFEST_PATH } from "../lib/zkArtifactTrust.mjs";

const command = fileURLToPath(new URL("../check-snarkjs-runtime.mjs", import.meta.url));
const manifestUrl = new URL(`../../${ZK_ARTIFACT_MANIFEST_PATH}`, import.meta.url);

async function fixture(context) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-runtime-")));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = JSON.parse(await fs.readFile(manifestUrl, "utf8"));
  const manifestPath = path.join(root, ZK_ARTIFACT_MANIFEST_PATH);
  const saveManifest = () => fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  async function addPackage(name, dependencies, main = "index.cjs") {
    const directory = path.join(root, "node_modules", name);
    const entry = path.join(directory, main);
    await fs.mkdir(path.dirname(entry), { recursive: true });
    const version = name === "snarkjs" ? manifest.snarkjsVersion : "1.0.0";
    await fs.writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name, version, main, dependencies }),
    );
    await fs.writeFile(
      entry,
      'throw new Error("The check must not execute inspected packages");\n',
    );
    return entry;
  }
  const cli = await addPackage("snarkjs", { middle: "1.0.0" }, "build/cli.cjs");
  await addPackage("middle", { leaf: "1.0.0" });
  const leaf = await addPackage("leaf", {});
  manifest.toolchain.snarkjsCliSha256 = sha256File(cli);
  manifest.toolchain.snarkjsRuntimeSha256 = inspectSnarkjsRuntime({ root }).sha256;
  await addPackage("unrelated", {});
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await saveManifest();
  return {
    leaf,
    manifest,
    manifestPath,
    saveManifest,
    check: () => spawnSync(process.execPath, [command], { cwd: root, encoding: "utf8" }),
  };
}

test("checks the installed graph without proving files and rejects transitive drift", async (context) => {
  const { leaf, manifest, manifestPath, check } = await fixture(context);
  const original = await fs.readFile(manifestPath, "utf8");
  const valid = check();
  assert.equal(valid.status, 0, valid.stderr);
  assert.ok(valid.stdout.includes(manifest.toolchain.snarkjsRuntimeSha256));
  await fs.appendFile(leaf, "\n");
  const changed = check();
  assert.equal(changed.status, 1, changed.stderr);
  assert.match(changed.stderr, /Installed snarkjs runtime SHA-256 mismatch/);
  assert.equal(await fs.readFile(manifestPath, "utf8"), original);
});

test("rejects a mismatched CLI pin and a missing runtime pin", async (context) => {
  const { manifest, saveManifest, check } = await fixture(context);
  const cliPin = manifest.toolchain.snarkjsCliSha256;
  manifest.toolchain.snarkjsCliSha256 = "0".repeat(64);
  await saveManifest();
  const wrongCli = check();
  assert.equal(wrongCli.status, 1, wrongCli.stderr);
  assert.match(wrongCli.stderr, /Installed snarkjs CLI SHA-256 mismatch/);
  manifest.toolchain.snarkjsCliSha256 = cliPin;
  delete manifest.toolchain.snarkjsRuntimeSha256;
  await saveManifest();
  const missingPin = check();
  assert.equal(missingPin.status, 1, missingPin.stderr);
  assert.match(missingPin.stderr, /snarkjsRuntimeSha256/);
});
