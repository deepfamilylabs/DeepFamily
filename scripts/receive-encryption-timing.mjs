import { parseArgs } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { getReceiveWasmBackend } from "../packages/protocol-core/shielded-receive-wasm.js";
import * as receiveEncryption from "../packages/protocol-core/shielded-receive-encryption.js";
import {
  sampleReceiveEncryptionTiming,
  verifyReceiveEncryptionVectors,
} from "./lib/receiveEncryptionTiming.mjs";

const { values } = parseArgs({
  options: {
    browser: { type: "string", default: "node" },
    samples: { type: "string", default: "1000" },
    batch: { type: "string", default: "16" },
  },
});
const options = { samples: Number(values.samples), batch: Number(values.batch) };
const root = fileURLToPath(new URL("../", import.meta.url));
const { vectors } = JSON.parse(
  await fs.readFile(
    new URL(
      "../packages/protocol-core/test/fixtures/shielded-receive-encryption.vectors.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

async function browserSample(name) {
  if (!["chromium", "firefox", "webkit"].includes(name)) throw new Error("Unknown browser engine");
  const { build } = await import("vite");
  const playwright = await import("playwright-core");
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-receive-timing-"));
  const output = path.join(temporary, "dist");
  let server, browser;
  try {
    const entry = path.join(temporary, "timing.mjs");
    await fs.writeFile(
      entry,
      [
        `import { getReceiveWasmBackend } from ${JSON.stringify(path.join(root, "packages/protocol-core/shielded-receive-wasm.js"))};`,
        `import * as receiveEncryption from ${JSON.stringify(path.join(root, "packages/protocol-core/shielded-receive-encryption.js"))};`,
        `import { sampleReceiveEncryptionTiming, verifyReceiveEncryptionVectors } from ${JSON.stringify(path.join(root, "scripts/lib/receiveEncryptionTiming.mjs"))};`,
        `const vectors = ${JSON.stringify(vectors)};`,
        "self.onmessage = async ({data}) => { try {",
        "const vectorsVerified = await verifyReceiveEncryptionVectors(vectors, receiveEncryption);",
        "const result = await sampleReceiveEncryptionTiming(await getReceiveWasmBackend(), data);",
        "self.postMessage({ok:true,result:{...result,vectorsVerified}}); } catch { self.postMessage({ok:false}); } };",
      ].join("\n"),
    );
    await build({
      configFile: false,
      root,
      logLevel: "error",
      build: {
        outDir: output,
        emptyOutDir: true,
        target: "es2022",
        rollupOptions: { input: entry, output: { entryFileNames: "timing.js", format: "es" } },
      },
    });
    server = http.createServer(async (request, response) => {
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'",
      );
      response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      try {
        const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
        if (pathname === "/") {
          response.setHeader("Content-Type", "text/html");
          response.end(
            "<!doctype html><meta charset=utf-8><title>Receive timing diagnostic</title>",
          );
          return;
        }
        const filename = path.resolve(output, `.${pathname}`);
        if (!filename.startsWith(output + path.sep) || !filename.endsWith(".js"))
          throw new Error("Unknown asset");
        response.setHeader("Content-Type", "text/javascript");
        response.end(await fs.readFile(filename));
      } catch {
        response.writeHead(404);
        response.end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    browser = await playwright[name].launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(
      (settings) =>
        new Promise((resolve, reject) => {
          const worker = new Worker("/timing.js", { type: "module" });
          const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error("Timing diagnostic timed out"));
          }, 120_000);
          worker.onmessage = ({ data }) => {
            clearTimeout(timer);
            worker.terminate();
            data.ok ? resolve(data.result) : reject(new Error("Receive WASM worker failed"));
          };
          worker.onerror = () => {
            clearTimeout(timer);
            worker.terminate();
            reject(new Error("Receive timing worker could not load"));
          };
          worker.postMessage(settings);
        }),
      options,
    );
    return { runtime: `${name} ${browser.version()}`, ...result };
  } finally {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

const result =
  values.browser === "node"
    ? {
        runtime: `node ${process.version} ${process.platform}/${process.arch}`,
        vectorsVerified: await verifyReceiveEncryptionVectors(vectors, receiveEncryption),
        ...(await sampleReceiveEncryptionTiming(await getReceiveWasmBackend(), options)),
      }
    : await browserSample(values.browser);
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
