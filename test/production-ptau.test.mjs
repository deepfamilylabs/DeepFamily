import { expect } from "chai";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  PRODUCTION_PTAU_FILE_NAME,
  ensureProductionPtau,
  productionPtauPath,
} from "../scripts/lib/productionPtau.mjs";
import { createCanonicalTemporaryDirectory } from "./helpers/temporaryDirectory.mjs";

const fixtureBytes = Buffer.from("hermetic public phase-1 fixture");
const expected = Object.freeze({
  bytes: fixtureBytes.length,
  sha256: createHash("sha256").update(fixtureBytes).digest("hex"),
  blake2b512: createHash("blake2b512").update(fixtureBytes).digest("hex"),
});
const source = "https://fixtures.invalid/public-phase-1.ptau";

const responseFor = (bytes, status = 200) =>
  new Response(bytes, {
    status,
    headers: { "content-length": String(bytes.length) },
  });

describe("pinned production Powers of Tau cache", function () {
  let root;

  beforeEach(async function () {
    root = await createCanonicalTemporaryDirectory("deepfamily-production-ptau-");
  });

  afterEach(async function () {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("downloads atomically and validates size, SHA-256 and BLAKE2b-512", async function () {
    let requested;
    let options;
    const result = await ensureProductionPtau({
      root,
      source,
      expected,
      fetchImpl: async (url, init) => {
        requested = url;
        options = init;
        return responseFor(fixtureBytes);
      },
    });
    const destination = productionPtauPath(root);
    expect(requested).to.equal(source);
    expect(options).to.deep.equal({ redirect: "error" });
    expect(result).to.include({
      status: "downloaded",
      path: destination,
      source,
      ...expected,
    });
    expect(await fs.readFile(destination)).to.deep.equal(fixtureBytes);
    expect((await fs.stat(destination)).mode & 0o777).to.equal(0o600);
    const cacheFiles = await fs.readdir(path.dirname(destination));
    expect(cacheFiles).to.deep.equal([PRODUCTION_PTAU_FILE_NAME]);
  });

  it("reuses only an exact cached file without making a request", async function () {
    await ensureProductionPtau({
      root,
      source,
      expected,
      fetchImpl: async () => responseFor(fixtureBytes),
    });
    const result = await ensureProductionPtau({
      root,
      source,
      expected,
      fetchImpl: async () => {
        throw new Error("network must not be used for an exact cache hit");
      },
    });
    expect(result.status).to.equal("already-cached");
  });

  it("rejects HTTP failures and removes partial files", async function () {
    let error;
    try {
      await ensureProductionPtau({
        root,
        source,
        expected,
        fetchImpl: async () => responseFor(Buffer.from("missing"), 404),
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.include("HTTP 404");
    const directory = path.dirname(productionPtauPath(root));
    expect(await fs.readdir(directory)).to.deep.equal([]);
  });

  it("rejects truncated or altered bytes without creating a usable cache", async function () {
    const altered = Buffer.from(fixtureBytes);
    altered[0] ^= 0xff;
    let error;
    try {
      await ensureProductionPtau({
        root,
        source,
        expected,
        fetchImpl: async () => responseFor(altered),
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.include("sha256 mismatch");
    await expectMissing(productionPtauPath(root));
    const directory = path.dirname(productionPtauPath(root));
    expect((await fs.readdir(directory)).some((name) => name.endsWith(".partial"))).to.equal(false);
  });

  it("refuses unexpected existing bytes instead of silently overwriting them", async function () {
    const destination = productionPtauPath(root);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, "unexpected");
    let error;
    try {
      await ensureProductionPtau({
        root,
        source,
        expected,
        fetchImpl: async () => responseFor(fixtureBytes),
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.include("remove it only after review");
    expect(await fs.readFile(destination, "utf8")).to.equal("unexpected");
  });

  it("refuses a symlink cache and a concurrent lock", async function () {
    const destination = productionPtauPath(root);
    const directory = path.dirname(destination);
    await fs.mkdir(directory, { recursive: true });
    const target = path.join(root, "target.ptau");
    await fs.writeFile(target, fixtureBytes);
    await fs.symlink(target, destination);
    let symlinkError;
    try {
      await ensureProductionPtau({
        root,
        source,
        expected,
        fetchImpl: async () => responseFor(fixtureBytes),
      });
    } catch (caught) {
      symlinkError = caught;
    }
    expect(symlinkError?.message).to.include("not a regular file");
    await fs.rm(destination);
    await fs.writeFile(path.join(directory, ".download.lock"), "busy");

    let lockError;
    try {
      await ensureProductionPtau({
        root,
        source,
        expected,
        fetchImpl: async () => responseFor(fixtureBytes),
      });
    } catch (caught) {
      lockError = caught;
    }
    expect(lockError?.message).to.include("in progress");
  });
});

const expectMissing = async (filePath) => {
  try {
    await fs.access(filePath);
    throw new Error(`Expected file to be missing: ${filePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
};
