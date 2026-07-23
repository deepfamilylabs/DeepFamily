import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Acquires a local-checkout command lock and returns an unguessable ownership token.
 *
 * This protects two commands in the same checkout from sharing a deployer nonce. It is not a
 * distributed lock: production operators must still keep the deployer key exclusive to one
 * machine and one release process.
 */
export const acquireExclusiveCommandLock = async ({ lockPath, label }) => {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const token = randomUUID();
  let handle;
  try {
    handle = await fs.open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        `${label} lock already exists at ${lockPath}. Confirm no production command is ` +
          "running before treating it as stale.",
      );
    }
    throw error;
  }
  await handle.writeFile(
    `${JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }, null, 2)}\n`,
  );

  let released = false;
  return {
    token,
    release: async () => {
      if (released) return;
      released = true;
      await handle.close();
      const current = JSON.parse(await fs.readFile(lockPath, "utf8"));
      if (current.token !== token) {
        throw new Error(`${label} lock ownership changed unexpectedly`);
      }
      await fs.unlink(lockPath);
    },
  };
};

/** Releases every supplied lock in order, even when an earlier release reports corruption. */
export const releaseExclusiveCommandLocks = async (locks) => {
  const errors = [];
  for (const lock of locks) {
    if (!lock) continue;
    try {
      await lock.release();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "Multiple production command locks failed to release");
  }
};
