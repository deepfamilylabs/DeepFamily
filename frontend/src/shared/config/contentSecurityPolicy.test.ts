import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  cspOriginOf,
  parseCspOrigins,
  renderPagesHeaders,
} from "./contentSecurityPolicy";

const envOf =
  (vars: Record<string, string> = {}) =>
  (key: string): string | undefined =>
    vars[key];

const directive = (policy: string, name: string): string | undefined =>
  policy.split("; ").find((entry) => entry.startsWith(`${name} `));

const production = (vars?: Record<string, string>, connectOrigins?: string[]) =>
  buildContentSecurityPolicy({ env: envOf(vars), connectOrigins, dev: false });

describe("buildContentSecurityPolicy", () => {
  it("keeps production free of inline scripts, eval and inline styles", () => {
    const policy = production();
    expect(directive(policy, "script-src")).toBe(
      "script-src 'self' 'wasm-unsafe-eval' 'report-sample'",
    );
    expect(directive(policy, "script-src-attr")).toBe("script-src-attr 'none'");
    expect(directive(policy, "style-src")).toBe("style-src 'self' https://fonts.googleapis.com");
    expect(directive(policy, "style-src-attr")).toBe("style-src-attr 'none'");
  });

  it("allows inline style attributes on the dev server only", () => {
    const dev = buildContentSecurityPolicy({ env: envOf(), dev: true });
    expect(directive(dev, "style-src-attr")).toBe("style-src-attr 'unsafe-inline'");
  });

  it("leaves out the local chain unless the build names a reader for it", () => {
    const connect = directive(production(), "connect-src");
    expect(connect).toContain("https://evm.confluxrpc.com");
    expect(connect).not.toContain("127.0.0.1");

    const reader = "0x" + "1".repeat(40);
    expect(directive(production({ VITE_READER_ADDRESS_31337: reader }), "connect-src")).toContain(
      "http://127.0.0.1:8545",
    );
  });

  it("allows the origin of VITE_RPC_URL, not the key in its path", () => {
    const connect = directive(
      production({ VITE_RPC_URL: "https://rpc.example.org/v3/secret-key" }),
      "connect-src",
    );
    expect(connect).toContain("https://rpc.example.org");
    expect(connect).not.toContain("secret-key");
  });

  it("fails the build on a VITE_RPC_URL whose host would break the policy", () => {
    expect(() => production({ VITE_RPC_URL: "https://rpc.example.org;" })).toThrow(/VITE_RPC_URL/);
  });

  it("drops the built-in networks when DEEP_CSP_INCLUDE_NETWORK_PRESETS reads as false", () => {
    for (const value of ["0", "false", "no", "FALSE"]) {
      const connect = directive(
        production({ DEEP_CSP_INCLUDE_NETWORK_PRESETS: value }),
        "connect-src",
      );
      expect(connect, value).toBe("connect-src 'self'");
    }
  });

  it("adds asset hosts and extra origins, and no source the app does not load", () => {
    const policy = production(
      {
        DEEP_CSP_CONNECT_SRC: "https://rpc.ankr.com https://*.infura.io",
        DEEP_CSP_IMG_SRC: "https://images.example.org",
      },
      ["https://proofs.example.org"],
    );
    const connect = directive(policy, "connect-src");
    for (const origin of [
      "https://proofs.example.org",
      "https://rpc.ankr.com",
      "https://*.infura.io",
    ]) {
      expect(connect).toContain(origin);
    }
    expect(directive(policy, "img-src")).toBe("img-src 'self' data: https://images.example.org");
    expect(directive(policy, "font-src")).toBe("font-src 'self' https://fonts.gstatic.com");
    expect(policy).not.toContain("ipfs");
    expect(connect).not.toContain("ws:");
  });

  it("reports through report-uri alone, which report-to would silence in Chrome", () => {
    expect(directive(production(), "report-uri")).toBe("report-uri /__csp-report");
    expect(directive(production(), "report-to")).toBeUndefined();
  });

  it("lets only the dev server evaluate code and reach Vite's HMR socket", () => {
    const dev = buildContentSecurityPolicy({ env: envOf(), dev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws://localhost:5173");
  });
});

describe("parseCspOrigins", () => {
  it("accepts whitespace-separated origins", () => {
    expect(
      parseCspOrigins("DEEP_CSP_CONNECT_SRC", " https://a.example  wss://b.example:8443 "),
    ).toEqual(["https://a.example", "wss://b.example:8443"]);
    expect(parseCspOrigins("DEEP_CSP_CONNECT_SRC", undefined)).toEqual([]);
  });

  it("refuses anything that would widen the directive or start another", () => {
    for (const token of [
      "*",
      "https:",
      "data:",
      "'unsafe-inline'",
      "https://a.example;",
      "https://a.example/path",
      "https://a.example,https://b.example",
    ]) {
      expect(() => parseCspOrigins("DEEP_CSP_IMG_SRC", token), token).toThrow(/DEEP_CSP_IMG_SRC/);
    }
  });
});

describe("cspOriginOf", () => {
  it("returns the origin of an http(s) URL, or null for an empty one", () => {
    expect(cspOriginOf("VITE_ZK_ASSET_BASE_URL", "https://proofs.example.org/files")).toBe(
      "https://proofs.example.org",
    );
    expect(cspOriginOf("VITE_RPC_URL", "http://127.0.0.1:8545")).toBe("http://127.0.0.1:8545");
    expect(cspOriginOf("VITE_RPC_URL", "")).toBeNull();
  });

  it("refuses URLs whose origin is not a plain http(s) host", () => {
    for (const url of [
      "https://rpc.example.org;",
      "https://a.example,b.example",
      "https://*.example.org",
      "wss://rpc.example.org",
      "rpc.example.org",
      "data:text/plain,x",
    ]) {
      expect(() => cspOriginOf("VITE_RPC_URL", url), url).toThrow(/VITE_RPC_URL/);
    }
  });
});

describe("buildSecurityHeaders", () => {
  it("enforces the policy and reports Trusted Types without enforcing them yet", () => {
    const headers = buildSecurityHeaders({ env: envOf() });
    expect(headers["Content-Security-Policy"]).toMatch(/^default-src 'self'; /);
    expect(headers["Content-Security-Policy"]).not.toContain("trusted-types");
    expect(headers["Content-Security-Policy-Report-Only"]).toBe(
      "require-trusted-types-for 'script'; trusted-types default; report-uri /__csp-report",
    );
  });

  it("severs cross-origin openers but keeps the popups the site opens", () => {
    expect(buildSecurityHeaders({ env: envOf() })["Cross-Origin-Opener-Policy"]).toBe(
      "same-origin-allow-popups",
    );
  });

  it("pins HTTPS for the site's own host, leaving subdomains and the preload list out", () => {
    expect(buildSecurityHeaders({ env: envOf() })["Strict-Transport-Security"]).toBe(
      "max-age=31536000",
    );
  });
});

describe("renderPagesHeaders", () => {
  it("applies every header to every path", () => {
    expect(renderPagesHeaders({ A: "1", B: "2" })).toBe("/*\n  A: 1\n  B: 2\n");
  });

  it("refuses a line longer than Pages accepts, which the default headers stay within", () => {
    expect(() => renderPagesHeaders({ A: "x".repeat(2000) })).toThrow(/2000/);
    expect(() =>
      renderPagesHeaders(
        buildSecurityHeaders({ env: envOf(), connectOrigins: ["https://proofs.example.org"] }),
      ),
    ).not.toThrow();
  });
});
