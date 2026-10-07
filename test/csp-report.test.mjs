import { expect } from "chai";

import { onRequest } from "../functions/__csp-report.ts";
import { handleCspReportRequest, redactReportUrl, summarizeCspReport } from "../lib/cspReport.js";

const KEYED_RPC = "https://mainnet.infura.io/v3/SECRET_API_KEY?token=abc";

const reportRequest = (report, { method = "POST", contentType = "application/csp-report" } = {}) =>
  new Request("https://deepfamily.org/__csp-report", {
    method,
    headers: { "content-type": contentType },
    body: method === "POST" ? JSON.stringify({ "csp-report": report }) : undefined,
  });

describe("CSP violation reports", function () {
  describe("redactReportUrl", function () {
    it("keeps only the origin of a blocked URL", function () {
      expect(redactReportUrl(KEYED_RPC)).to.equal("https://mainnet.infura.io");
      expect(redactReportUrl("wss://rpc.example.org/socket?key=1")).to.equal(
        "wss://rpc.example.org",
      );
    });

    it("keeps a document's path but never its query or fragment", function () {
      expect(
        redactReportUrl("https://deepfamily.org/create?tab=mint-nft&hash=0x1#top", {
          keepPath: true,
        }),
      ).to.equal("https://deepfamily.org/create");
    });

    it("keeps the creating origin of a blob: URL, path or not", function () {
      const thread = "blob:https://deepfamily.org/6b1f0c5e-1c2d-4e3f-9a8b-7c6d5e4f3a2b";
      expect(redactReportUrl(thread, { keepPath: true })).to.equal("blob:https://deepfamily.org");
      expect(redactReportUrl(thread)).to.equal("blob:https://deepfamily.org");
    });

    it("passes keywords through and reduces other schemes to their name", function () {
      expect(redactReportUrl("eval")).to.equal("eval");
      expect(redactReportUrl("wasm-eval")).to.equal("wasm-eval");
      expect(redactReportUrl("data:image/png;base64,AAAA")).to.equal("data");
      expect(redactReportUrl("not a url")).to.equal(undefined);
      expect(redactReportUrl(42)).to.equal(undefined);
    });
  });

  describe("summarizeCspReport", function () {
    it("reads a report-uri body", function () {
      const entry = summarizeCspReport(
        JSON.stringify({
          "csp-report": {
            "effective-directive": "connect-src",
            "blocked-uri": KEYED_RPC,
            "document-uri": "https://deepfamily.org/family?root=0x1",
            "source-file": "https://deepfamily.org/assets/index.js",
            "line-number": 1,
            "column-number": 2586,
            disposition: "enforce",
            "script-sample": "",
          },
        }),
      );
      expect(entry).to.deep.equal({
        directive: "connect-src",
        blocked: "https://mainnet.infura.io",
        document: "https://deepfamily.org/family",
        sourceFile: "https://deepfamily.org/assets/index.js",
        line: 1,
        column: 2586,
        disposition: "enforce",
      });
    });

    it("keeps the script sample only when asked", function () {
      const raw = JSON.stringify({ "csp-report": { "script-sample": "alert(1)" } });
      expect(summarizeCspReport(raw)).not.to.have.property("sample");
      expect(summarizeCspReport(raw, { includeSample: true }).sample).to.equal("alert(1)");
    });

    it("throws on a body that is not a CSP report", function () {
      expect(() => summarizeCspReport("not json")).to.throw(SyntaxError);
      expect(() => summarizeCspReport(JSON.stringify([{ type: "csp-violation" }]))).to.throw(
        TypeError,
      );
    });
  });

  describe("handleCspReportRequest", function () {
    it("records a redacted entry and answers 204", async function () {
      const entries = [];
      const response = await handleCspReportRequest(
        reportRequest({ "effective-directive": "connect-src", "blocked-uri": KEYED_RPC }),
        (entry) => entries.push(entry),
      );
      expect(response.status).to.equal(204);
      expect(entries).to.have.length(1);
      expect(entries[0].blocked).to.equal("https://mainnet.infura.io");
    });

    it("refuses anything that is not a browser's CSP report", async function () {
      const record = () => expect.fail("nothing should be recorded");
      const wrongMethod = await handleCspReportRequest(
        reportRequest({}, { method: "GET" }),
        record,
      );
      expect(wrongMethod.status).to.equal(405);
      expect(wrongMethod.headers.get("allow")).to.equal("POST");

      const wrongType = reportRequest({}, { contentType: "application/json" });
      expect((await handleCspReportRequest(wrongType, record)).status).to.equal(415);

      const malformed = new Request("https://deepfamily.org/__csp-report", {
        method: "POST",
        headers: { "content-type": "application/csp-report" },
        body: "{",
      });
      expect((await handleCspReportRequest(malformed, record)).status).to.equal(400);
    });
  });

  describe("Pages Function", function () {
    let warnings;
    let originalWarn;

    beforeEach(function () {
      warnings = [];
      originalWarn = console.warn;
      console.warn = (...args) => warnings.push(args);
    });

    afterEach(function () {
      console.warn = originalWarn;
    });

    it("logs the redacted entry and nothing of the key", async function () {
      const response = await onRequest({
        request: reportRequest({
          "effective-directive": "connect-src",
          "blocked-uri": KEYED_RPC,
          "document-uri": "https://deepfamily.org/family?root=0x1",
        }),
      });
      expect(response.status).to.equal(204);
      const logged = JSON.stringify(warnings);
      expect(logged).to.include("https://mainnet.infura.io");
      expect(logged).not.to.include("SECRET_API_KEY");
      expect(logged).not.to.include("root=0x1");
    });
  });
});
