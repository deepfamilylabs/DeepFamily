export const RECEIVE_CIRCUIT_VERSION = "receive-presentation-v1-64-32-checkpoint-bound";

function validateManifest(manifest, options) {
  const kinds = { anonymous: 11, fund: 11, attachment: 14 };
  if (manifest?.circuitVersion !== RECEIVE_CIRCUIT_VERSION ||
      !Object.hasOwn(kinds, manifest.kind) || manifest.publicSignals !== kinds[manifest.kind]) {
    throw new Error("Unsupported receive presentation manifest");
  }
  if (!options.allowDevelopmentArtifacts &&
      (manifest.productionCeremony !== true || manifest.setup === "insecure-local-development")) {
    throw new Error("Receive presentation requires production ceremony artifacts");
  }
  if (options.expectedKind && options.expectedKind !== manifest.kind) {
    throw new Error("Receive artifact kind does not match the operation");
  }
  if (options.expectedIssuerVkSha256 && manifest.issuerVkSha256 !== options.expectedIssuerVkSha256) {
    throw new Error("Receive artifacts use a different fixed credential issuer key");
  }
  for (const name of ["receipt.r1cs", "receipt.pk", "receipt.vk"]) {
    if (!/^[a-f0-9]{64}$/u.test(manifest.artifacts?.[name] ?? "")) {
      throw new Error(`Missing receive artifact digest: ${name}`);
    }
  }
  return manifest;
}

async function fetchBytes(url, options) {
  const original = new URL(url, globalThis.location?.href);
  const digest = options.assetHost?.digests?.[original.pathname];
  const remoteBase = options.assetHost?.baseUrl;
  if (remoteBase && !digest) throw new Error(`Missing pinned receive asset digest: ${original.pathname}`);
  const target = remoteBase
    ? `${remoteBase.replace(/\/$/u, "")}/${digest}/${original.pathname.split("/").at(-1)}`
    : original;
  const response = await fetch(target, { credentials: remoteBase ? "omit" : "same-origin" });
  if (!response.ok) throw new Error(`Could not load receive proof artifact (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (digest) await digestMatches(bytes, digest, `Receive asset ${original.pathname}`);
  return bytes;
}

async function digestMatches(bytes, expected, label) {
  if (!/^[a-f0-9]{64}$/u.test(expected ?? "")) throw new Error(`Missing pinned ${label} digest`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const actual = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== expected) throw new Error(`${label} digest mismatch`);
}

/** Runs inside a dedicated Worker. Only public artifacts are downloaded. */
export async function loadReceiveProver(options) {
  const { artifactBaseUrl, onProgress = () => {} } = options;
  if (!options.allowDevelopmentArtifacts &&
      (!/^[a-f0-9]{64}$/u.test(options.expectedManifestSha256 ?? "") ||
       !/^[a-f0-9]{64}$/u.test(options.expectedIssuerVkSha256 ?? ""))) {
    throw new Error("Production receive proving requires pinned manifest and fixed issuer key digests");
  }
  const base = new URL(artifactBaseUrl.endsWith("/") ? artifactBaseUrl : `${artifactBaseUrl}/`, globalThis.location?.href);
  const manifestBytes = await fetchBytes(new URL("manifest.json", base), options);
  if (options.expectedManifestSha256) {
    await digestMatches(manifestBytes, options.expectedManifestSha256, "Receive manifest");
  }
  const manifest = validateManifest(JSON.parse(new TextDecoder().decode(manifestBytes)), options);
  if (globalThis.deepFamilyReceiveProver) throw new Error("Use a fresh Worker for each receive prover");
  onProgress({ phase: "runtime" });
  // Trusted, vendored Go runtime is bundled by Vite. Do not execute remote JS.
  await import("./wasm_exec.js");
  if (typeof globalThis.Go !== "function") throw new Error("Receive Go/WASM runtime did not initialize");
  const go = new globalThis.Go();
  go.env = { GOMAXPROCS: "1", GOMEMLIMIT: "3GiB" };
  const wasm = await fetchBytes(options.wasmUrl ?? new URL("../receive-prover.wasm", base), options);
  await digestMatches(wasm, manifest.runtimeArtifacts?.["receive-prover.wasm"], "Receive WASM");
  const { instance } = await WebAssembly.instantiate(wasm, go.importObject);
  let runtimeError;
  void go.run(instance).catch((error) => { runtimeError = error; });
  while (!globalThis.deepFamilyReceiveProver) {
    if (runtimeError) throw runtimeError;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const engine = globalThis.deepFamilyReceiveProver;
  await engine.configure(JSON.stringify(manifest));
  for (const kind of ["r1cs", "pk", "vk"]) {
    onProgress({ phase: "artifact", kind });
    // Decode one file at a time to bound peak browser memory. The Go loader
    // verifies SHA-256 while decoding and does not accept a serialized witness.
    await engine.load(kind, await fetchBytes(new URL(`receipt.${kind}`, base), options));
  }
  onProgress({ phase: "ready" });
  return {
    manifest,
    async prove(request) {
      if (request?.kind !== manifest.kind) throw new Error("Receive request does not match the fixed circuit");
      onProgress({ phase: "proving" });
      const result = await engine.prove(JSON.stringify(request));
      if (!result.verified || result.publicSignals?.length !== manifest.publicSignals) {
        throw new Error("Receive prover returned an invalid result");
      }
      onProgress({ phase: "complete" });
      return result;
    },
  };
}

/** Main-thread facade. Terminate the Worker to cancel proving and discard secrets. */
export function createReceiveProver(options) {
  const { onProgress, workerUrl, ...workerOptions } = options;
  const worker = new Worker(workerUrl ?? new URL("./worker.mjs", import.meta.url), { type: "module" });
  let nextId = 0;
  let closed = false;
  const pending = new Map();
  function rejectAll(error) {
    for (const operation of pending.values()) operation.reject(error);
    pending.clear();
  }
  worker.onmessage = ({ data }) => {
    if (data.type === "progress") { onProgress?.(data.progress); return; }
    const operation = pending.get(data.id);
    if (!operation) return;
    pending.delete(data.id);
    if (data.error) operation.reject(new Error(data.error));
    else operation.resolve(data.result);
  };
  worker.onerror = () => rejectAll(new Error("Receive proof worker failed"));
  function call(type, data) {
    if (closed) return Promise.reject(new Error("Receive proof worker is closed"));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, ...data });
    });
  }
  const ready = call("load", { options: workerOptions });
  // Attach a rejection handler immediately even if a caller only uses prove().
  void ready.catch(() => {});
  return {
    ready,
    async prove(request) { await ready; return call("prove", { request }); },
    terminate() {
      closed = true;
      worker.terminate();
      rejectAll(new Error("Receive proof worker terminated"));
    },
  };
}

/** One-shot frontend API. Keeps raw witness data inside the Worker lifecycle. */
export async function prove(request, options = {}) {
  const artifactRoot = options.artifactRoot ?? "/zk/receive/";
  const client = createReceiveProver({
    artifactBaseUrl: `${artifactRoot}${request.kind}/`,
    wasmUrl: `${artifactRoot}receive-prover.wasm`,
    expectedKind: request.kind,
    ...options,
  });
  try {
    const result = await client.prove(request);
    return { proof: result.solidityProof, publicSignals: result.publicSignals };
  } finally {
    client.terminate();
  }
}
