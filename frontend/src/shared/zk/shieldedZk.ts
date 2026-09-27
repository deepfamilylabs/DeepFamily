import type { Groth16Proof } from "./zk";
// @ts-ignore snarkjs does not publish complete browser typings.
import * as snarkjs from "snarkjs";

export const SHIELDED_CIRCUIT_NAMES = Object.freeze({
  keyRegistration: "shielded_key_registration",
  shield: "shielded_shield",
  createPolicy: "shielded_create_policy",
  allocate: "shielded_allocate",
  topUp: "shielded_top_up",
  mergeBudget: "shielded_merge_budget",
  claim: "shielded_claim",
  privateTransfer: "shielded_private_transfer",
  unshield: "shielded_unshield",
});

export type ShieldedCircuitName = keyof typeof SHIELDED_CIRCUIT_NAMES;
export type ShieldedWitness = Record<string, string | number | Array<string | string[]>>;
type Artifacts = { wasm: Uint8Array; zkey: Uint8Array; vkey: unknown };
const cache = new Map<ShieldedCircuitName, Promise<Artifacts>>();

function sameOriginPath(circuit: ShieldedCircuitName, extension: string) {
  return `/zk/shielded/${SHIELDED_CIRCUIT_NAMES[circuit]}${extension}`;
}

async function fetchArtifact(url: string): Promise<Response> {
  const response = await fetch(url, { cache: "no-cache", credentials: "same-origin" });
  if (!response.ok) throw new Error(`Shielded proof artifact unavailable: ${url}`);
  return response;
}

async function loadArtifacts(circuit: ShieldedCircuitName): Promise<Artifacts> {
  const existing = cache.get(circuit);
  if (existing) return existing;
  const pending = (async () => {
    const [wasm, zkey, vkey] = await Promise.all([
      fetchArtifact(sameOriginPath(circuit, ".wasm")),
      fetchArtifact(sameOriginPath(circuit, "_final.zkey")),
      fetchArtifact(sameOriginPath(circuit, ".vkey.json")),
    ]);
    return {
      wasm: new Uint8Array(await wasm.arrayBuffer()),
      zkey: new Uint8Array(await zkey.arrayBuffer()),
      vkey: await vkey.json(),
    };
  })().catch((error) => {
    cache.delete(circuit);
    throw error;
  });
  cache.set(circuit, pending);
  return pending;
}

/** A proof is accepted locally only for the exact public values sent on chain. */
export function assertShieldedPublicSignals(
  circuit: ShieldedCircuitName,
  actual: ReadonlyArray<string | bigint | number>,
  expected: ReadonlyArray<string | bigint | number>,
) {
  const length = circuit === "keyRegistration" ? 7 : 32;
  if (actual.length !== length || expected.length !== length) {
    throw new Error(`Shielded ${circuit} proof must have ${length} public signals`);
  }
  for (let index = 0; index < length; index += 1) {
    if (BigInt(actual[index]) !== BigInt(expected[index])) {
      throw new Error(`Shielded ${circuit} public signal ${index} does not match transaction`);
    }
  }
}

/** Runs entirely inside the local browser worker; no witness is posted to a prover. */
export async function generateShieldedProof(input: {
  circuit: ShieldedCircuitName;
  witness: ShieldedWitness;
  expectedPublicSignals: string[];
}): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
  const { wasm, zkey, vkey } = await loadArtifacts(input.circuit);
  const result = await snarkjs.groth16.fullProve(input.witness, wasm, zkey);
  assertShieldedPublicSignals(input.circuit, result.publicSignals, input.expectedPublicSignals);
  if (!(await snarkjs.groth16.verify(vkey, result.publicSignals, result.proof))) {
    throw new Error(`Shielded ${input.circuit} proof failed local verification`);
  }
  return result;
}
