#!/usr/bin/env node
// Real browser / Worker / Go-WASM test. The worker receives raw JSON containing
// a reusable issuer proof and constructs its own complete private witness.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(root, "frontend/package.json"));
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export async function smokeReceiveBrowser({
  artifacts = path.join(root, "zk-artifacts/receive"),
  input, output, chromePath = process.env.DEEPFAMILY_CHROME_PATH ?? "/usr/bin/google-chrome",
} = {}) {
  if (!input) throw new Error("A raw receive request JSON path is required");
  artifacts = path.resolve(artifacts);
  const request = JSON.parse(fs.readFileSync(input, "utf8"));
  const kind = request.kind;
  const runtimeArtifacts = { "receive-prover.wasm": sha256(path.join(artifacts, "receive-prover.wasm")),
    "wasm_exec.js": sha256(path.join(artifacts, "wasm_exec.js")) };
  const server = http.createServer((req, res) => {
    const route = new URL(req.url, "http://127.0.0.1").pathname;
    res.setHeader("Cache-Control", "no-store");
    if (route === "/") { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>Receive presentation browser smoke</title>"); return; }
    if (route === `/zk/receive/${kind}/manifest.json`) {
      const manifest = JSON.parse(fs.readFileSync(path.join(artifacts, kind, "manifest.json"), "utf8"));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ...manifest, runtimeArtifacts }));
      return;
    }
    let file;
    if (/^\/module\/(?:browser\.mjs|worker\.mjs|wasm_exec\.js)$/u.test(route)) file = path.join(root, "packages/receive-prover", path.basename(route));
    if (/^\/zk\/receive\/(?:anonymous\/|fund\/|attachment\/)?(?:receipt\.(?:r1cs|pk|vk)|receive-prover\.wasm)$/u.test(route)) file = path.join(artifacts, route.slice("/zk/receive/".length));
    if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader("Content-Type", /\.(?:mjs|js)$/u.test(file) ? "text/javascript" : file.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
    res.setHeader("Content-Length", fs.statSync(file).size);
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { chromium } = require("playwright-core");
  let browser;
  try {
    browser = await chromium.launch({ executablePath: chromePath, headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check"] });
    const page = await browser.newPage();
    page.setDefaultTimeout(15 * 60 * 1000);
    page.on("console", (message) => console.log(`browser ${message.type()}: ${message.text()}`));
    page.on("pageerror", (error) => console.error(`browser error: ${error.message}`));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const started = Date.now();
    const result = await page.evaluate(async (rawRequest) => {
      const { createReceiveProver } = await import("/module/browser.mjs");
      const client = createReceiveProver({ artifactBaseUrl: `/zk/receive/${rawRequest.kind}/`,
        wasmUrl: "/zk/receive/receive-prover.wasm", allowDevelopmentArtifacts: true,
        onProgress: (progress) => console.log(JSON.stringify(progress)) });
      try {
        const proof = await client.prove(rawRequest);
        const invalid = structuredClone(rawRequest);
        invalid.presentation.binding = String(BigInt(invalid.presentation.binding) + 1n);
        let invalidBindingRejected = false;
        try { await client.prove(invalid); } catch { invalidBindingRejected = true; }
        return { ...proof, invalidBindingRejected };
      } finally { client.terminate(); }
    }, request);
    assert.equal(result.verified, true);
    assert.equal(result.invalidBindingRejected, true);
    assert.equal(result.publicSignals.length, kind === "attachment" ? 14 : 11);
    assert.match(result.solidityProof, /^0x[a-f0-9]+$/u);
    result.browserVersion = browser.version();
    result.wallMillis = Date.now() - started;
    result.rawWitnessConstructedInWorker = true;
    result.productionReady = false;
    if (output) fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`Real receive browser proof verified; tampered private binding rejected; ${result.wallMillis} ms`);
    return result;
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = (name) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
  await smokeReceiveBrowser({ artifacts: flag("--artifacts"), input: flag("--input"), output: flag("--output"), chromePath: flag("--chrome") });
}
