import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Creates a temporary test directory and returns its canonical path.
 *
 * macOS exposes its temporary directory through /var, which resolves through the
 * /var -> /private/var symlink. Security-sensitive tests must pass the canonical
 * path so production traversal guards still reject actual symlink components.
 */
export const createCanonicalTemporaryDirectory = async (prefix) =>
  fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
