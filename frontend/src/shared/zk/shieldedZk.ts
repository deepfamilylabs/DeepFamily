import {
  SHIELDED_POOL_ACTION,
  SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS,
  SHIELDED_RECEIVE_CODE_PUBLIC_SIGNAL_COUNT,
} from "@deepfamily/protocol-core";
import type { Groth16Proof } from "./zk";
// @ts-ignore snarkjs does not publish complete browser typings.
import * as snarkjs from "snarkjs";

export const SHIELDED_CIRCUIT_NAMES = Object.freeze({
  receiveCode: "shielded_receive_code",
  shield: "shielded_shield",
  fund: "shielded_fund",
  claim: "shielded_claim",
  privateTransfer: "shielded_private_transfer",
  unshield: "shielded_unshield",
});

export type ShieldedCircuitName = keyof typeof SHIELDED_CIRCUIT_NAMES;

/** Pool action counts mirror ProofConstants.sol; receive codes are verified off-chain. */
const PUBLIC_SIGNAL_COUNTS: Record<ShieldedCircuitName, number> = {
  receiveCode: SHIELDED_RECEIVE_CODE_PUBLIC_SIGNAL_COUNT,
  shield: SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS[SHIELDED_POOL_ACTION.Shield],
  fund: SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS[SHIELDED_POOL_ACTION.Fund],
  claim: SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS[SHIELDED_POOL_ACTION.Claim],
  privateTransfer: SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS[SHIELDED_POOL_ACTION.PrivateTransfer],
  unshield: SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS[SHIELDED_POOL_ACTION.Unshield],
};

/**
 * Receive codes are verified against the key embedded at build time rather than a fetched
 * file, because this key decides whether a payer trusts a recipient's payment keys.
 */
export const SHIELDED_RECEIVE_CODE_VERIFICATION_KEY = __SHIELDED_RECEIVE_CODE_VKEY__;
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
  const length = PUBLIC_SIGNAL_COUNTS[circuit];
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
  const verificationKey =
    input.circuit === "receiveCode" ? SHIELDED_RECEIVE_CODE_VERIFICATION_KEY : vkey;
  if (!(await snarkjs.groth16.verify(verificationKey, result.publicSignals, result.proof))) {
    throw new Error(`Shielded ${input.circuit} proof failed local verification`);
  }
  return result;
}
