import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ZK_ARTIFACT_MANIFEST_PATH } from "../../scripts/lib/zkArtifactTrust.mjs";
import { installProductionArtifacts } from "../../scripts/lib/zkProductionSetup.mjs";
import {
  runSetupCommand,
  runWithSetupSignalHandlers,
} from "../../scripts/lib/zkSetupCancellation.mjs";

const fixturePath = fileURLToPath(import.meta.url);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForFile = async (file) => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try {
      await fs.access(file);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await delay(10);
    }
  }
  throw new Error(`Fixture did not create ${file}`);
};

const runFixture = async (role, root, phase) => {
  const event = (value) => fsSync.appendFileSync(path.join(root, "events"), `${value}\n`);
  if (role === "grandchild") {
    process.on("SIGTERM", () => {});
    fsSync.writeFileSync(path.join(root, "grandchild-ready"), String(process.pid));
    setTimeout(() => fsSync.writeFileSync(path.join(root, "late-write"), "orphan wrote"), 750);
    setInterval(() => {}, 100);
    return;
  }
  if (role === "validation-child") {
    process.on("SIGTERM", () => {
      fsSync.writeFileSync(path.join(root, "child-terminating"), "stopping");
      setTimeout(() => {
        fsSync.writeFileSync(path.join(root, "artifact.bin"), "last child write");
        event("child-stopped");
        process.exit(0);
      }, 150);
    });
    spawn(process.execPath, [fixturePath, "grandchild", root], { stdio: "ignore" });
    await waitForFile(path.join(root, "grandchild-ready"));
    fsSync.writeFileSync(path.join(root, "validation-ready"), String(process.pid));
    setInterval(() => {}, 100);
    return;
  }
  if (role !== "setup") throw new Error(`Unknown fixture role: ${role}`);

  const stage = path.join(root, "stage");
  const backup = path.join(root, "backup");
  await fs.mkdir(stage);
  await fs.mkdir(backup);
  await fs.mkdir(path.dirname(path.join(root, ZK_ARTIFACT_MANIFEST_PATH)), { recursive: true });
  await fs.writeFile(path.join(root, "artifact.bin"), "old artifact");
  await fs.writeFile(path.join(root, ZK_ARTIFACT_MANIFEST_PATH), "old manifest");
  await fs.writeFile(path.join(stage, "artifact.bin"), "new artifact");
  await fs.writeFile(path.join(stage, "new.bin"), "new file");
  await fs.writeFile(path.join(stage, "manifest.json"), "new manifest");

  const validate = async (signal) => {
    const command = runSetupCommand({
      executable: process.execPath,
      args: [fixturePath, "validation-child", root],
      signal,
    }).finally(() => event("command-stopped"));
    await waitForFile(path.join(root, "validation-ready"));
    process.send({ type: "validating", phase });
    await command;
  };
  await runWithSetupSignalHandlers(async (signal) => {
    try {
      await installProductionArtifacts({
        root,
        signal,
        backupRoot: backup,
        entries: [
          { source: path.join(stage, "artifact.bin"), destination: "artifact.bin" },
          { source: path.join(stage, "new.bin"), destination: "new.bin" },
          { source: path.join(stage, "manifest.json"), destination: ZK_ARTIFACT_MANIFEST_PATH },
        ],
        validateBeforeCommit: () => (phase === "before" ? validate(signal) : undefined),
        validateAfterCommit: () => (phase === "after" ? validate(signal) : undefined),
      });
    } finally {
      event("rollback-finished");
      await fs.rm(stage, { recursive: true, force: true });
    }
  });
};

if (process.argv[1] && path.resolve(process.argv[1]) === fixturePath) {
  runFixture(...process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = error.exitCode ?? 1;
  });
}
