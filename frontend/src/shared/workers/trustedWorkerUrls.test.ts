import { afterEach, describe, expect, it, vi } from "vitest";
import { installTrustedWorkerUrlPolicy, isSameOriginScriptUrl } from "./trustedWorkerUrls";

const ORIGIN = "https://deepfamily.org";

describe("isSameOriginScriptUrl", () => {
  it("admits bundled workers and the blob: threads this origin creates", () => {
    expect(isSameOriginScriptUrl(`${ORIGIN}/assets/zk.worker-abc.js`, ORIGIN)).toBe(true);
    expect(isSameOriginScriptUrl("/assets/crypto.worker-abc.js", ORIGIN)).toBe(true);
    expect(
      isSameOriginScriptUrl(`blob:${ORIGIN}/6b1f0c5e-1c2d-4e3f-9a8b-7c6d5e4f3a2b`, ORIGIN),
    ).toBe(true);
  });

  it("refuses scripts from anywhere else", () => {
    for (const input of [
      "https://evil.example/worker.js",
      "blob:https://evil.example/6b1f0c5e-1c2d-4e3f-9a8b-7c6d5e4f3a2b",
      "data:text/javascript,postMessage(1)",
      "javascript:postMessage(1)",
      "http://deepfamily.org/assets/zk.worker-abc.js",
    ]) {
      expect(isSameOriginScriptUrl(input, ORIGIN), input).toBe(false);
    }
  });
});

describe("installTrustedWorkerUrlPolicy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers a default policy that passes same-origin script URLs and refuses the rest", () => {
    const createPolicy = vi.fn();
    vi.stubGlobal("trustedTypes", { createPolicy });
    vi.stubGlobal("location", { origin: ORIGIN });

    installTrustedWorkerUrlPolicy();

    expect(createPolicy).toHaveBeenCalledOnce();
    const [name, rules] = createPolicy.mock.calls[0];
    expect(name).toBe("default");
    expect(rules.createScriptURL(`${ORIGIN}/assets/zk.worker-abc.js`)).toBe(
      `${ORIGIN}/assets/zk.worker-abc.js`,
    );
    expect(rules.createScriptURL("https://evil.example/worker.js")).toBeNull();
  });

  it("does nothing where the browser has no Trusted Types", () => {
    vi.stubGlobal("trustedTypes", undefined);
    expect(() => installTrustedWorkerUrlPolicy()).not.toThrow();
  });
});
