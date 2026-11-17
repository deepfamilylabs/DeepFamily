import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHardhatRuntimeEnvironment } from "hardhat/hre";
import { verificationPaths } from "../lib/verificationPaths.mjs";

test("verification evidence survives Hardhat artifact cleanup and clean", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-evidence-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module"}');

  const artifacts = path.join(root, "artifacts");
  const legacy = path.join(artifacts, "browser-acceptance");
  const evidence = Object.values(verificationPaths(root));
  const files = {
    "report.json": '{"status":"passed"}',
    "screenshot.png": "screenshot fixture",
    "trace.zip": "trace fixture",
  };
  for (const directory of [legacy, ...evidence]) {
    await fs.mkdir(directory, { recursive: true });
    for (const [filename, contents] of Object.entries(files)) {
      await fs.writeFile(path.join(directory, filename), contents);
    }
  }

  const hre = await createHardhatRuntimeEnvironment(
    { solidity: "0.8.28", paths: { artifacts, cache: path.join(root, "cache") } },
    { config: path.join(root, "hardhat.config.mjs") },
    root,
  );
  // A full build runs this even when the compiler has no work to do.
  await hre.solidity.cleanupArtifacts([]);
  assert.equal(await fs.stat(legacy).catch(() => null), null);
  await hre.tasks.getTask("clean").run();
  assert.equal(await fs.stat(artifacts).catch(() => null), null);

  for (const directory of evidence) {
    for (const [filename, contents] of Object.entries(files)) {
      assert.equal(await fs.readFile(path.join(directory, filename), "utf8"), contents);
    }
  }
});
