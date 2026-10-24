import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchZkAsset } from "./zkAssets";

const BYTES = new TextEncoder().encode("claim-zkey");
const UNSERVED_DIGEST = "a".repeat(64);

function stubFetch(body: Uint8Array<ArrayBuffer>, status = 200) {
  const fetchMock = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ZK proving asset loading", () => {
  it("reads same-origin /zk files when no asset host is configured", async () => {
    const fetchMock = stubFetch(BYTES);
    await expect(
      fetchZkAsset("/zk/shielded/shielded_claim_64_final.zkey", { baseUrl: "", digests: {} }),
    ).resolves.toEqual(BYTES);
    expect(fetchMock).toHaveBeenCalledWith("/zk/shielded/shielded_claim_64_final.zkey", {
      cache: "no-cache",
    });
  });

  it("loads the Brotli object and checks the decoded bytes against the original digest", async () => {
    const digest = await sha256Hex(BYTES);
    const fetchMock = stubFetch(BYTES);
    await expect(
      fetchZkAsset("/zk/shielded/shielded_claim_64_final.zkey", {
        baseUrl: "https://zk.example",
        digests: { "/zk/shielded/shielded_claim_64_final.zkey": digest },
      }),
    ).resolves.toEqual(BYTES);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://zk.example/${digest}/shielded_claim_64_final.zkey.br`,
    );
  });

  it("rejects asset host bytes that differ from the pinned digest", async () => {
    stubFetch(new TextEncoder().encode("tampered"));
    await expect(
      fetchZkAsset("/zk/shielded/shielded_claim_64_final.zkey", {
        baseUrl: "https://zk.example",
        digests: { "/zk/shielded/shielded_claim_64_final.zkey": await sha256Hex(BYTES) },
      }),
    ).rejects.toThrow("ZK asset digest mismatch: /zk/shielded/shielded_claim_64_final.zkey");
  });

  it("rejects compressed bytes served without HTTP decoding", async () => {
    const { brotliCompressSync } = await import("node:zlib");
    stubFetch(new Uint8Array(brotliCompressSync(BYTES)));
    await expect(
      fetchZkAsset("/zk/person_commitment.wasm", {
        baseUrl: "https://zk.example",
        digests: { "/zk/person_commitment.wasm": await sha256Hex(BYTES) },
      }),
    ).rejects.toThrow("ZK asset digest mismatch: /zk/person_commitment.wasm");
  });

  it("propagates a failed HTTP Brotli decode before returning proving bytes", async () => {
    const failure = new TypeError("Brotli decoding failed");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: () => Promise.reject(failure) })),
    );
    await expect(
      fetchZkAsset("/zk/person_commitment.wasm", {
        baseUrl: "https://zk.example",
        digests: { "/zk/person_commitment.wasm": await sha256Hex(BYTES) },
      }),
    ).rejects.toBe(failure);
  });

  it("refuses unpinned files and reports HTTP failures", async () => {
    const fetchMock = stubFetch(BYTES);
    await expect(
      fetchZkAsset("/zk/unknown.wasm", { baseUrl: "https://zk.example", digests: {} }),
    ).rejects.toThrow("No pinned digest for ZK asset /zk/unknown.wasm");
    expect(fetchMock).not.toHaveBeenCalled();

    stubFetch(new Uint8Array(), 404);
    await expect(
      fetchZkAsset("/zk/person_commitment.wasm", {
        baseUrl: "https://zk.example",
        digests: { "/zk/person_commitment.wasm": UNSERVED_DIGEST },
      }),
    ).rejects.toThrow(
      `Failed to load https://zk.example/${UNSERVED_DIGEST}/person_commitment.wasm.br: 404`,
    );
  });
});

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
