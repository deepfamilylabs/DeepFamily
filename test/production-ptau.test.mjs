import { expect } from "chai";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  PRODUCTION_PTAU_URL,
  ensureProductionPtau,
  productionPtauPath,
  resolveProductionPtauPath,
} from "../scripts/lib/productionPtau.mjs";
import { createCanonicalTemporaryDirectory } from "./helpers/temporaryDirectory.mjs";

const fixtureBytes = Buffer.from("hermetic public phase-1 fixture");
const expected = Object.freeze({
  bytes: fixtureBytes.length,
  sha256: createHash("sha256").update(fixtureBytes).digest("hex"),
  blake2b512: createHash("blake2b512").update(fixtureBytes).digest("hex"),
});

describe("pinned local production Powers of Tau", function () {
  let root;

  beforeEach(async function () {
    root = await createCanonicalTemporaryDirectory("deepfamily-production-ptau-");
  });

  afterEach(async function () {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("resolves Windows ZK_PTAU_PATH case-insensitively and rejects ambiguous entries", function () {
    expect(
      resolveProductionPtauPath({
        root,
        platform: "win32",
        env: { zk_ptau_path: "ceremony/reviewed.ptau" },
      }),
    ).to.equal(path.join(root, "ceremony", "reviewed.ptau"));
    expect(() =>
      resolveProductionPtauPath({
        root,
        platform: "win32",
        env: {
          ZK_PTAU_PATH: "ceremony/first.ptau",
          zk_ptau_path: "ceremony/second.ptau",
        },
      }),
    ).to.throw("duplicate ZK_PTAU_PATH entries");
  });

  it("verifies an existing file at the default local path without modifying it", async function () {
    const destination = productionPtauPath(root);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, fixtureBytes);
    const result = await ensureProductionPtau({
      root,
      env: {},
      expected,
    });
    expect(result).to.deep.equal({
      status: "verified-local",
      path: destination,
      source: PRODUCTION_PTAU_URL,
      ...expected,
    });
    expect(await fs.readdir(path.dirname(destination))).to.deep.equal([path.basename(destination)]);
  });

  it("verifies a file selected by ZK_PTAU_PATH", async function () {
    const selected = path.join(root, "reviewed", "phase1.ptau");
    await fs.mkdir(path.dirname(selected), { recursive: true });
    await fs.writeFile(selected, fixtureBytes);
    const result = await ensureProductionPtau({
      root,
      env: { ZK_PTAU_PATH: "reviewed/phase1.ptau" },
      expected,
    });
    expect(result.path).to.equal(selected);
    expect(result.status).to.equal("verified-local");
  });

  it("fails clearly when the local file is missing and never creates one", async function () {
    const destination = productionPtauPath(root);
    let error;
    try {
      await ensureProductionPtau({
        root,
        env: {},
        expected,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.include("Local production Powers of Tau is missing");
    expect(error?.message).to.include("ZK_PTAU_PATH");
    await expectMissing(destination);
    await expectMissing(path.dirname(destination));
  });

  it("rejects truncated and altered bytes without modifying the local file", async function () {
    const destination = productionPtauPath(root);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, fixtureBytes.subarray(1));
    let error = await captureError(() => ensureProductionPtau({ root, env: {}, expected }));
    expect(error?.message).to.include("bytes mismatch");

    const altered = Buffer.from(fixtureBytes);
    altered[0] ^= 0xff;
    await fs.writeFile(destination, altered);
    error = await captureError(() => ensureProductionPtau({ root, env: {}, expected }));
    expect(error?.message).to.include("sha256 mismatch");
    expect(await fs.readFile(destination)).to.deep.equal(altered);

    await fs.writeFile(destination, fixtureBytes);
    error = await captureError(() =>
      ensureProductionPtau({
        root,
        env: {},
        expected: { ...expected, blake2b512: "11".repeat(64) },
      }),
    );
    expect(error?.message).to.include("blake2b512 mismatch");
  });

  it("rejects a symlink file and a path traversing a symlink", async function () {
    const destination = productionPtauPath(root);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const target = path.join(root, "target.ptau");
    await fs.writeFile(target, fixtureBytes);
    await fs.symlink(target, destination);
    let error = await captureError(() => ensureProductionPtau({ root, env: {}, expected }));
    expect(error?.message).to.include("regular non-symlink file");

    const linkedDirectory = path.join(root, "linked");
    await fs.symlink(path.dirname(destination), linkedDirectory);
    await fs.rm(destination);
    await fs.writeFile(destination, fixtureBytes);
    error = await captureError(() =>
      ensureProductionPtau({
        root,
        env: { ZK_PTAU_PATH: "linked/powersOfTau28_hez_final_13.ptau" },
        expected,
      }),
    );
    expect(error?.message).to.include("must not traverse a symlink");
  });
});

const captureError = async (callback) => {
  try {
    await callback();
    return null;
  } catch (error) {
    return error;
  }
};

const expectMissing = async (filePath) => {
  try {
    await fs.access(filePath);
    throw new Error(`Expected file to be missing: ${filePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
};
