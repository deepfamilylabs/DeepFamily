import { loadReceiveProver } from "./browser.mjs";

let prover;
let busy = false;
self.onmessage = async ({ data }) => {
  if (busy) {
    self.postMessage({ id: data.id, error: "One receive proof operation at a time" });
    return;
  }
  busy = true;
  try {
    let result;
    if (data.type === "load") {
      if (prover) throw new Error("Receive prover already loaded");
      prover = await loadReceiveProver({
        ...data.options,
        onProgress: (progress) => self.postMessage({ type: "progress", progress }),
      });
      result = { kind: prover.manifest.kind, publicSignals: prover.manifest.publicSignals };
    } else if (data.type === "prove") {
      if (!prover) throw new Error("Load receive prover artifacts first");
      result = await prover.prove(data.request);
    } else {
      throw new Error("Unknown receive proof operation");
    }
    self.postMessage({ id: data.id, result });
  } catch {
    self.postMessage({ id: data.id, error: data.type === "load" ? "Unable to load receive proof assets" : "Unable to create receive proof" });
  } finally {
    busy = false;
  }
};
