// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createFromCredentials: vi.fn(),
  generateShieldedProof: vi.fn(),
  post: vi.fn(),
}));
vi.mock("../shared/zk/shieldedReceiveCode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/zk/shieldedReceiveCode")>()),
  createShieldedReceiveCodeFromCredentials: mocks.createFromCredentials,
}));
vi.mock("../shared/zk/shieldedZk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/zk/shieldedZk")>()),
  generateShieldedProof: mocks.generateShieldedProof,
}));

let onMessage: (event: { data: any }) => Promise<void>;
beforeAll(async () => {
  vi.stubGlobal("self", {
    addEventListener: (_type: string, listener: typeof onMessage) => {
      onMessage = listener;
    },
    postMessage: mocks.post,
  });
  await import("./zk.worker");
});
beforeEach(() => vi.resetAllMocks());
afterAll(() => vi.unstubAllGlobals());

describe("production ZK worker secret boundary", () => {
  it.each(["createShieldedReceiveCodeFromCredentials", "generateShieldedProof"])(
    "does not forward credential or witness exceptions from %s",
    async (method) => {
      const rawPassphrase = "a\u030a-credential-7K!";
      const encoded = encodeURIComponent(rawPassphrase.normalize("NFC"));
      const error = Object.assign(new Error(`private failure ${encoded}`), {
        name: rawPassphrase,
        code: encoded,
        cause: rawPassphrase,
      });
      mocks.createFromCredentials.mockRejectedValueOnce(error);
      mocks.generateShieldedProof.mockRejectedValueOnce(error);
      const request = {
        id: 7,
        method,
        params:
          method === "generateShieldedProof"
            ? {
                circuit: "receiveCode",
                witness: { derivedSecretField: "314159265358979323846" },
                expectedPublicSignals: [],
              }
            : {
                identity: {
                  fullName: "Alice",
                  gender: 0,
                  birthYear: 2000,
                  birthMonth: 1,
                  birthDay: 1,
                  isBirthBC: false,
                },
                rawPassphrase,
              },
      };

      await onMessage({ data: request });

      expect(request.params).toBeUndefined();
      expect(mocks.post).toHaveBeenCalledExactlyOnceWith({
        id: 7,
        ok: false,
        error: { message: "Local cryptographic operation failed" },
      });
    },
  );

  it("returns only a receive code and public hash after a credential job", async () => {
    const result = { code: "dfrecv1public", personHash: `0x${"12".repeat(32)}` };
    mocks.createFromCredentials.mockResolvedValueOnce(result);
    const request = {
      id: 8,
      method: "createShieldedReceiveCodeFromCredentials",
      params: { identity: {}, rawPassphrase: "successful-job-secret-8Q!" },
    };

    await onMessage({ data: request });

    expect(request.params).toBeUndefined();
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith({ id: 8, ok: true, result });
  });
});
