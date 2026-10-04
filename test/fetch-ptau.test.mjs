import { expect } from "chai";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fetchPinnedPtau } from "../scripts/fetch-ptau.mjs";
import { productionPtauPath } from "../scripts/lib/productionPtau.mjs";
import { createCanonicalTemporaryDirectory } from "./helpers/temporaryDirectory.mjs";

const bytes = Buffer.from("reviewed phase 1 fixture");
const expected = {
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  blake2b512: createHash("blake2b512").update(bytes).digest("hex"),
};

describe("explicit pinned Phase 1 download", function () {
  let root;
  beforeEach(async () => {
    root = await createCanonicalTemporaryDirectory("deepfamily-ptau-fetch-");
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("installs verified bytes once and reuses them without network access", async function () {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(bytes);
    };
    await fetchPinnedPtau({ root, expected, fetchImpl });
    await fetchPinnedPtau({ root, expected, fetchImpl });
    expect(calls).to.equal(1);
    expect(await fs.readFile(productionPtauPath(root))).to.deep.equal(bytes);
    expect(await fs.readdir(path.dirname(productionPtauPath(root)))).to.deep.equal([
      path.basename(productionPtauPath(root)),
    ]);
  });

  it("rejects corrupted or oversized downloads without publishing a file", async function () {
    for (const content of [Buffer.alloc(bytes.length), Buffer.alloc(bytes.length + 1)]) {
      await assert.rejects(() =>
        fetchPinnedPtau({ root, expected, fetchImpl: async () => new Response(content) }),
      );
      await assert.rejects(() => fs.stat(productionPtauPath(root)), { code: "ENOENT" });
      expect(await fs.readdir(path.dirname(productionPtauPath(root)))).to.deep.equal([]);
    }
  });

  it("refuses to replace an existing altered file", async function () {
    const destination = productionPtauPath(root);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, "unreviewed");
    await assert.rejects(
      () =>
        fetchPinnedPtau({
          root,
          expected,
          fetchImpl: () => {
            throw new Error("must not fetch");
          },
        }),
      /bytes mismatch/,
    );
    expect(await fs.readFile(destination, "utf8")).to.equal("unreviewed");
  });
});
