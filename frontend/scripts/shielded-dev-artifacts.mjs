import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SHIELDED_CIRCUITS } from "../../scripts/zk-shielded-build.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const PREFIX = "/zk/shielded/";
const SHA256 = /^[0-9a-f]{64}$/;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceToAction = new Map(
  Object.entries(SHIELDED_CIRCUITS).map(([action, source]) => [source, action]),
);

/** Only ignored, manifest-pinned development artifacts are served by Vite's dev server. */
export function readShieldedDevelopmentArtifact(url, { root = ROOT } = {}) {
  const pathname = new URL(url, "http://localhost").pathname;
  if (!pathname.startsWith(PREFIX)) return null;
  const fileName = pathname.slice(PREFIX.length);
  const match = /^(shielded_[a-z_]+)(\.wasm|_final\.zkey|\.vkey\.json)$/.exec(fileName);
  if (!match) throw new Error("Unknown shielded development artifact path");
  const [, source, extension] = match;
  const action = sourceToAction.get(source);
  if (!action) throw new Error("Unknown shielded development circuit");

  const directory = path.join(root, "zk-artifacts", "shielded");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, "development-manifest.json"), "utf8"),
  );
  if (
    manifest.schema !== "deepfamily/shielded-development-keys@1" ||
    manifest.developmentOnly !== true ||
    manifest.productionReady !== false ||
    Object.keys(manifest.circuits ?? {})
      .sort()
      .join(",") !== Object.keys(SHIELDED_CIRCUITS).sort().join(",")
  ) {
    throw new Error("Shielded development proof manifest is invalid");
  }
  const entry = manifest.circuits[action];
  if (entry?.source !== source) throw new Error("Shielded development circuit source mismatch");
  const file =
    extension === ".wasm"
      ? path.join(directory, `${source}_js`, `${source}.wasm`)
      : extension === "_final.zkey"
        ? path.join(directory, `${source}_dev_final.zkey`)
        : path.join(directory, `${source}.vkey.json`);
  const expected =
    extension === ".wasm"
      ? entry.wasmSha256
      : extension === "_final.zkey"
        ? entry.zkeySha256
        : entry.verificationKeySha256;
  if (!SHA256.test(expected ?? "")) throw new Error("Shielded development artifact has no digest");
  if (!fs.realpathSync(file).startsWith(`${fs.realpathSync(directory)}${path.sep}`)) {
    throw new Error("Shielded development artifact escaped its directory");
  }
  const bytes = fs.readFileSync(file);
  if (sha256(bytes) !== expected) throw new Error("Shielded development artifact digest mismatch");
  return {
    bytes,
    contentType:
      extension === ".wasm"
        ? "application/wasm"
        : extension === ".vkey.json"
          ? "application/json; charset=utf-8"
          : "application/octet-stream",
  };
}

/** Production builds never register this route and never copy development keys to public/. */
export function shieldedDevelopmentArtifactPlugin({ root = ROOT } = {}) {
  return {
    name: "deepfamily:shielded-development-artifacts",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith(PREFIX)) return next();
        if (request.method !== "GET") {
          response.statusCode = 405;
          response.end();
          return;
        }
        try {
          const artifact = readShieldedDevelopmentArtifact(request.url, { root });
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Type", artifact.contentType);
          response.end(artifact.bytes);
        } catch (error) {
          response.statusCode = 404;
          response.setHeader("Cache-Control", "no-store");
          response.end(`Development proof artifact unavailable: ${error.message}`);
        }
      });
    },
  };
}

export function assertNoShieldedPublicArtifacts(frontendDirectory) {
  if (fs.existsSync(path.join(frontendDirectory, "public", "zk", "shielded"))) {
    throw new Error("Shielded proof artifacts must not be copied into frontend/public");
  }
}
