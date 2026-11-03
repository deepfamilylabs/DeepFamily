import { expect } from "chai";
import { spawn } from "node:child_process";
import { EventEmitter, getEventListeners } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ZK_ARTIFACT_MANIFEST_PATH } from "../scripts/lib/zkArtifactTrust.mjs";
import {
  runSetupCommand,
  runWithSetupSignalHandlers,
} from "../scripts/lib/zkSetupCancellation.mjs";
import { createCanonicalTemporaryDirectory } from "./helpers/temporaryDirectory.mjs";

const fixturePath = fileURLToPath(
  new URL("./helpers/zk-setup-cancellation-fixture.mjs", import.meta.url),
);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const captureError = async (operation) => {
  try {
    await operation();
    return null;
  } catch (error) {
    return error;
  }
};
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
  throw new Error(`Timed out waiting for ${file}`);
};
const expectMissing = async (file) => {
  const error = await captureError(() => fs.access(file));
  expect(error?.code).to.equal("ENOENT", `${file} should have been removed`);
};

describe("ZK setup cancellation", function () {
  this.timeout(10_000);
  let root;

  beforeEach(async function () {
    root = await createCanonicalTemporaryDirectory("deepfamily-cancellation-");
  });
  afterEach(async function () {
    // Also stop the validation process group if an assertion failed before cancellation.
    if (process.platform !== "win32") {
      try {
        const pid = Number(await fs.readFile(path.join(root, "validation-ready"), "utf8"));
        if (pid > 0) process.kill(-pid, "SIGKILL");
      } catch (error) {
        if (!["ENOENT", "ESRCH"].includes(error.code)) throw error;
      }
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  for (const { phase, signalName, secondSignal, exitCode } of [
    { phase: "before", signalName: "SIGTERM", secondSignal: "SIGINT", exitCode: 143 },
    { phase: "after", signalName: "SIGINT", exitCode: 130 },
  ]) {
    it(`rolls back ${phase} manifest commit after ${signalName} and stops descendants`, async function () {
      if (process.platform === "win32") this.skip();
      const child = spawn(process.execPath, [fixturePath, "setup", root, phase], {
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      let stderr = "";
      child.stderr.on("data", (bytes) => (stderr += bytes));
      const completion = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
      try {
        await new Promise((resolve, reject) => {
          child.once("message", resolve);
          child.once("error", reject);
          child.once("exit", (code, signal) =>
            reject(new Error(`Fixture exited early: ${code}/${signal}: ${stderr}`)),
          );
        });
        expect(await fs.readFile(path.join(root, "artifact.bin"), "utf8")).to.equal("new artifact");
        expect(await fs.readFile(path.join(root, ZK_ARTIFACT_MANIFEST_PATH), "utf8")).to.equal(
          phase === "before" ? "old manifest" : "new manifest",
        );
        expect(child.kill(signalName)).to.equal(true);
        if (secondSignal) {
          await waitForFile(path.join(root, "child-terminating"));
          expect(child.kill(secondSignal)).to.equal(true);
        }
        expect(await completion, stderr).to.deep.equal({ code: exitCode, signal: null });
        expect(await fs.readFile(path.join(root, "artifact.bin"), "utf8")).to.equal("old artifact");
        expect(await fs.readFile(path.join(root, ZK_ARTIFACT_MANIFEST_PATH), "utf8")).to.equal(
          "old manifest",
        );
        expect(
          (await fs.readFile(path.join(root, "events"), "utf8")).trim().split("\n"),
        ).to.deep.equal(["child-stopped", "command-stopped", "rollback-finished"]);
        await expectMissing(path.join(root, "new.bin"));
        await expectMissing(path.join(root, "backup"));
        await expectMissing(path.join(root, "stage"));
        await delay(800);
        await expectMissing(path.join(root, "late-write"));
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await completion;
        }
      }
    });
  }

  it("restores signal listeners after success, failure and repeated cancellation", async function () {
    const source = new EventEmitter();
    const existingListener = () => {};
    source.on("SIGINT", existingListener);
    const assertListeners = () => {
      expect(source.listeners("SIGINT")).to.deep.equal([existingListener]);
      expect(source.listeners("SIGTERM")).to.deep.equal([]);
    };
    expect(await runWithSetupSignalHandlers(async () => 42, { signalSource: source })).to.equal(42);
    assertListeners();
    const failure = new Error("fixture failure");
    expect(
      await captureError(() =>
        runWithSetupSignalHandlers(
          async () => {
            throw failure;
          },
          { signalSource: source },
        ),
      ),
    ).to.equal(failure);
    assertListeners();
    const received = [];
    const error = await captureError(() =>
      runWithSetupSignalHandlers(
        async (signal) => {
          source.emit("SIGINT");
          source.emit("SIGTERM");
          await delay(1);
          expect(source.listenerCount("SIGTERM")).to.equal(1);
          signal.throwIfAborted();
        },
        { signalSource: source, onSignal: (name) => received.push(name) },
      ),
    );
    expect(error).to.include({ name: "AbortError", exitCode: 130 });
    expect(received).to.deep.equal(["SIGINT"]);
    assertListeners();
  });

  it("captures stdin output and removes abort listeners when spawning fails", async function () {
    const controller = new AbortController();
    const output = await runSetupCommand({
      executable: process.execPath,
      args: ["-e", "process.stdin.on('data', bytes => process.stdout.write(bytes));"],
      stdin: Buffer.from("fixture output"),
      capture: true,
      signal: controller.signal,
    });
    expect(output).to.equal("fixture output");
    expect(getEventListeners(controller.signal, "abort")).to.have.length(0);
    const error = await captureError(() =>
      runSetupCommand({
        executable: path.join(root, "missing-command"),
        args: [],
        signal: controller.signal,
      }),
    );
    expect(error?.code).to.equal("ENOENT");
    expect(getEventListeners(controller.signal, "abort")).to.have.length(0);
    const cancellation = new Error("cancelled before spawn");
    controller.abort(cancellation);
    expect(
      await captureError(() =>
        runSetupCommand({
          executable: process.execPath,
          args: ["-e", "throw new Error('must not execute');"],
          signal: controller.signal,
        }),
      ),
    ).to.equal(cancellation);
  });
});
