import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "chai";

import {
  acquireExclusiveCommandLock,
  releaseExclusiveCommandLocks,
} from "../scripts/lib/exclusiveCommandLock.mjs";
import { expectRegularFileWithPosixMode } from "./helpers/fileMode.mjs";

describe("production command lock", function () {
  let temporaryDirectory;

  beforeEach(async function () {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-command-lock-"));
  });

  afterEach(async function () {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("creates an exclusive lock with private POSIX permissions and removes it once", async function () {
    const lockPath = path.join(temporaryDirectory, ".mainnet-command.lock");
    const lock = await acquireExclusiveCommandLock({
      lockPath,
      label: "test production command",
    });
    const persisted = JSON.parse(await fs.readFile(lockPath, "utf8"));
    expect(persisted.token).to.equal(lock.token);
    expect(persisted.pid).to.equal(process.pid);
    expectRegularFileWithPosixMode(await fs.lstat(lockPath), 0o600);

    await lock.release();
    await lock.release();
    let missing = false;
    try {
      await fs.access(lockPath);
    } catch (error) {
      missing = error.code === "ENOENT";
    }
    expect(missing).to.equal(true);
  });

  it("rejects a concurrent command in the same checkout", async function () {
    const lockPath = path.join(temporaryDirectory, ".mainnet-command.lock");
    const first = await acquireExclusiveCommandLock({
      lockPath,
      label: "test production command",
    });
    let error;
    try {
      await acquireExclusiveCommandLock({
        lockPath,
        label: "second production command",
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).to.be.an("error");
    expect(error.message).to.include("lock already exists");
    await first.release();
  });

  it("does not delete a lock whose ownership token changed", async function () {
    const lockPath = path.join(temporaryDirectory, ".mainnet-command.lock");
    const lock = await acquireExclusiveCommandLock({
      lockPath,
      label: "test production command",
    });
    await fs.writeFile(lockPath, JSON.stringify({ token: "different-owner" }), {
      mode: 0o600,
    });

    let error;
    try {
      await lock.release();
    } catch (caught) {
      error = caught;
    }
    expect(error).to.be.an("error");
    expect(error.message).to.include("ownership changed");
    expect(JSON.parse(await fs.readFile(lockPath, "utf8")).token).to.equal("different-owner");
  });

  it("releases the shared lock even when the inner lock reports corruption", async function () {
    const releases = [];
    const innerError = new Error("inner lock ownership changed");
    const inner = {
      release: async () => {
        releases.push("inner");
        throw innerError;
      },
    };
    const shared = {
      release: async () => {
        releases.push("shared");
      },
    };

    let error;
    try {
      await releaseExclusiveCommandLocks([inner, shared]);
    } catch (caught) {
      error = caught;
    }
    expect(error).to.equal(innerError);
    expect(releases).to.deep.equal(["inner", "shared"]);
  });
});
