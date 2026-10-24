import {
  SHIELDED_POOL_ACTION,
  SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS,
  SHIELDED_VALUE_PUBLIC_SIGNAL_COUNTS,
  SHIELDED_RECEIVE_CREDENTIAL_PUBLIC_SIGNAL_COUNTS,
} from "@deepfamily/protocol-core";
import type { Groth16Proof } from "./zk";
import { fetchZkAsset } from "./zkAssets";
// @ts-ignore snarkjs does not publish complete browser typings.
import * as snarkjs from "snarkjs";

export const SHIELDED_CIRCUIT_NAMES = Object.freeze({
  anonymousReceiveCredential: "shielded_anonymous_receive_credential",
  fundReceiveCredential: "shielded_fund_receive_credential",
  anonymousReceivePresentation: "shielded_anonymous_receive_presentation",
  fundReceivePresentation: "shielded_fund_receive_presentation",
  attachedReceivePresentation: "shielded_attached_receive_presentation",
  identityAuthorizationUpdate: "shielded_identity_authorization_update",
  shield: "shielded_shield",
  fund: "shielded_fund",
  fundContinuation: "shielded_fund_continuation",
  claim: "shielded_claim_64",
  claim32: "shielded_claim_32",
  privateTransfer: "shielded_private_transfer",
  privateTransfer4: "shielded_private_transfer_4",
  unshield: "shielded_unshield",
  unshield4: "shielded_unshield_4",
});

export type ShieldedCircuitName = keyof typeof SHIELDED_CIRCUIT_NAMES;

/** Pool action counts mirror ProofConstants.sol; receive codes are verified off-chain. */
const PUBLIC_SIGNAL_COUNTS: Record<ShieldedCircuitName, number> = {
  anonymousReceiveCredential: SHIELDED_RECEIVE_CREDENTIAL_PUBLIC_SIGNAL_COUNTS.anonymous,
  fundReceiveCredential: SHIELDED_RECEIVE_CREDENTIAL_PUBLIC_SIGNAL_COUNTS.fund,
  anonymousReceivePresentation: SHIELDED_RECEIVE_CREDENTIAL_PUBLIC_SIGNAL_COUNTS.anonymous + 11,
  fundReceivePresentation: SHIELDED_RECEIVE_CREDENTIAL_PUBLIC_SIGNAL_COUNTS.fund + 11,
  attachedReceivePresentation: SHIELDED_RECEIVE_CREDENTIAL_PUBLIC_SIGNAL_COUNTS.anonymous + 14,
  identityAuthorizationUpdate: 6,
  shield: SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS[SHIELDED_POOL_ACTION.Shield],
  fund: SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS[SHIELDED_POOL_ACTION.Fund],
  fundContinuation: SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS[SHIELDED_POOL_ACTION.Fund],
  claim: SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS[SHIELDED_POOL_ACTION.Claim],
  claim32: SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS[SHIELDED_POOL_ACTION.Claim],
  privateTransfer: SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS[SHIELDED_POOL_ACTION.PrivateTransfer],
  unshield: SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS[SHIELDED_POOL_ACTION.Unshield],
  privateTransfer4: SHIELDED_VALUE_PUBLIC_SIGNAL_COUNTS[4],
  unshield4: SHIELDED_VALUE_PUBLIC_SIGNAL_COUNTS[4],
};

/**
 * Receive codes are verified against the key embedded at build time rather than a fetched
 * file, because this key decides whether a payer trusts a recipient's payment keys.
 */
export const SHIELDED_RECEIVE_CREDENTIAL_VERIFICATION_KEYS = __SHIELDED_RECEIVE_CREDENTIAL_VKEYS__;
export const SHIELDED_RECEIVE_LINK_KEYS = __RECEIVE_LINK_KEYS__;
export type ShieldedWitness = Record<string, string | number | Array<string | string[]>>;
type Artifacts = { wasm: Uint8Array; zkey: Uint8Array; vkey: unknown };
const cache = new Map<ShieldedCircuitName, Promise<Artifacts>>();

function artifactPath(circuit: ShieldedCircuitName, extension: string) {
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
    const linkedKind = receivePresentationKind(circuit);
    const pinnedKey = linkedKind ? SHIELDED_RECEIVE_LINK_KEYS?.[linkedKind]?.verificationKey : null;
    if (linkedKind && !pinnedKey) {
      throw new Error("Receive presentation keys are missing; rebuild the ZK artifacts");
    }
    const [wasm, zkey, vkey] = await Promise.all([
      fetchZkAsset(artifactPath(circuit, ".wasm")),
      fetchZkAsset(artifactPath(circuit, "_final.zkey")),
      pinnedKey ??
        fetchArtifact(artifactPath(circuit, ".vkey.json")).then((response) => response.json()),
    ]);
    return { wasm, zkey, vkey };
  })().catch((error) => {
    cache.delete(circuit);
    throw error;
  });
  cache.set(circuit, pending);
  return pending;
}

function receivePresentationKind(circuit: ShieldedCircuitName) {
  if (circuit === "anonymousReceivePresentation") return "anonymous";
  if (circuit === "fundReceivePresentation") return "fund";
  if (circuit === "attachedReceivePresentation") return "attachment";
  return null;
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

/** Both compact qualification paths must fit the selected circuit's capacity. */
export function selectShieldedClaimCircuit(witness: ShieldedWitness): "claim32" | "claim" {
  const rawDepths = [witness.endorsementDepth, witness.trustedDepth];
  if (
    rawDepths.some(
      (value) =>
        typeof value !== "number" &&
        (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)),
    )
  ) {
    throw new Error("Claim qualification path depth must be an integer from 0 to 64");
  }
  const depths = rawDepths.map(Number);
  if (depths.some((depth) => !Number.isInteger(depth) || depth < 0 || depth > 64)) {
    throw new Error("Claim qualification path depth must be an integer from 0 to 64");
  }
  return depths.every((depth) => depth <= 32) ? "claim32" : "claim";
}

function claimWitness(witness: ShieldedWitness, circuit: "claim32" | "claim"): ShieldedWitness {
  const selected = selectShieldedClaimCircuit(witness);
  if (circuit === "claim32" && selected !== "claim32") {
    throw new Error("Claim32 qualification paths cannot exceed 32 levels");
  }
  const maximum = circuit === "claim32" ? 32 : 64;
  const trimmed = { ...witness };
  for (const [field, depthField] of [
    ["endorsementSiblings", "endorsementDepth"],
    ["trustedSiblings", "trustedDepth"],
  ]) {
    const siblings = witness[field];
    if (
      !Array.isArray(siblings) ||
      siblings.length < Number(witness[depthField]) ||
      siblings.length > 64 ||
      siblings.some((value) => typeof value !== "string")
    ) {
      throw new Error("Claim qualification siblings do not match their path depth");
    }
    trimmed[field] = [
      ...siblings.slice(0, maximum),
      ...Array<string>(Math.max(0, maximum - siblings.length)).fill("0"),
    ];
  }
  return trimmed;
}

/** Select before downloading artifacts so a single-note spend never fetches the four-input key. */
export function selectShieldedValueCircuit(
  circuit: "privateTransfer" | "unshield",
  witness: ShieldedWitness,
): "privateTransfer" | "privateTransfer4" | "unshield" | "unshield4" {
  const enabled = witness.inputEnabled;
  if (!Array.isArray(enabled) || (enabled.length !== 1 && enabled.length !== 4)) {
    throw new Error("VALUE proof witness must have one or four input slots");
  }
  if (enabled.length === 1) return circuit;
  return circuit === "privateTransfer" ? "privateTransfer4" : "unshield4";
}

/** First funding retains both depth-64 qualification paths; refills use their historical budget. */
export function selectShieldedFundCircuit(witness: ShieldedWitness): "fund" | "fundContinuation" {
  if (witness.fundMode === 0 || witness.fundMode === "0") return "fund";
  if (witness.fundMode === 1 || witness.fundMode === "1") return "fundContinuation";
  throw new Error("Fund proof witness mode must be 0 or 1");
}

/** Runs entirely inside the local browser worker; no witness is posted to a prover. */
export async function generateShieldedProof(input: {
  circuit: ShieldedCircuitName;
  witness: ShieldedWitness;
  expectedPublicSignals: string[];
}): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
  const circuit =
    input.circuit === "fund" || input.circuit === "fundContinuation"
      ? selectShieldedFundCircuit(input.witness)
      : input.circuit === "claim"
        ? selectShieldedClaimCircuit(input.witness)
        : input.circuit === "privateTransfer" || input.circuit === "unshield"
          ? selectShieldedValueCircuit(input.circuit, input.witness)
          : input.circuit;
  if (input.circuit === "fundContinuation" && circuit !== "fundContinuation") {
    throw new Error("Fund continuation proof requires mode 1");
  }
  const witness =
    circuit === "claim" || circuit === "claim32"
      ? claimWitness(input.witness, circuit)
      : input.witness;
  const { wasm, zkey, vkey } = await loadArtifacts(circuit);
  const result = await snarkjs.groth16.fullProve(witness, wasm, zkey);
  assertShieldedPublicSignals(circuit, result.publicSignals, input.expectedPublicSignals);
  const verificationKey =
    input.circuit === "anonymousReceiveCredential"
      ? SHIELDED_RECEIVE_CREDENTIAL_VERIFICATION_KEYS.anonymous
      : input.circuit === "fundReceiveCredential"
        ? SHIELDED_RECEIVE_CREDENTIAL_VERIFICATION_KEYS.fund
        : vkey;
  if (!(await snarkjs.groth16.verify(verificationKey, result.publicSignals, result.proof))) {
    throw new Error(`Shielded ${input.circuit} proof failed local verification`);
  }
  return result;
}
