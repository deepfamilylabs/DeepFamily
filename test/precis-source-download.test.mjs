import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { fetchPinnedSource } from "../scripts/generate-precis-data.mjs";

const bytes = Buffer.from("reviewed Unicode source\n");
const source = Object.freeze({
  name: "UnicodeData.txt",
  url: "https://unicode.test/17.0.0/UnicodeData.txt",
  sha256: createHash("sha256").update(bytes).digest("hex"),
});

describe("pinned PRECIS source downloads", function () {
  this.timeout(10_000);
  let originalFetch;

  beforeEach(function () {
    originalFetch = globalThis.fetch;
  });

  afterEach(function () {
    globalThis.fetch = originalFetch;
  });

  it("recovers from a connection reset and a server error with the pinned bytes", async function () {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("connection reset");
      if (calls === 2) return new Response("unavailable", { status: 503 });
      return new Response(bytes);
    };

    assert.equal(await fetchPinnedSource(source), bytes.toString("utf8"));
    assert.equal(calls, 3);
  });

  it("retries a response whose body is interrupted after successful headers", async function () {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls > 1) return new Response(bytes);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => {
          throw new TypeError("response body reset");
        },
      };
    };

    assert.equal(await fetchPinnedSource(source), bytes.toString("utf8"));
    assert.equal(calls, 2);
  });

  it("rejects changed bytes immediately instead of retrying past a digest mismatch", async function () {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response("changed source");
    };

    await assert.rejects(fetchPinnedSource(source), /UnicodeData\.txt SHA-256 mismatch/);
    assert.equal(calls, 1);
  });

  it("reports the source and network cause after three failed attempts", async function () {
    let calls = 0;
    const reset = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
    globalThis.fetch = async () => {
      calls += 1;
      throw new TypeError("fetch failed", { cause: reset });
    };

    await assert.rejects(fetchPinnedSource(source), (error) => {
      assert.match(error.message, /UnicodeData\.txt download failed/);
      assert.ok(error.message.includes(source.url));
      assert.match(error.message, /failed after 3 attempts/);
      assert.match(error.message, /ECONNRESET: socket reset/);
      return true;
    });
    assert.equal(calls, 3);
  });

  it("reports missing sources without retrying client errors", async function () {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response("missing", { status: 404 });
    };

    await assert.rejects(fetchPinnedSource(source), /UnicodeData\.txt download failed.*HTTP 404/);
    assert.equal(calls, 1);
  });
});
