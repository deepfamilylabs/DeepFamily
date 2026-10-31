import {
  linkGroth16Proofs,
  prepareReceivePresentationWitness,
  type Groth16Proof as LinkedGroth16Proof,
} from "@deepfamily/protocol-core";
import {
  generateShieldedProof,
  SHIELDED_RECEIVE_CREDENTIAL_VERIFICATION_KEYS,
  SHIELDED_RECEIVE_LINK_KEYS,
} from "./shieldedZk";

const PRESENTATION_CIRCUITS = {
  anonymous: "anonymousReceivePresentation",
  fund: "fundReceivePresentation",
} as const;

/** Prove the operation locally, then hide and link the reusable credential inputs. */
export async function proveShieldedReceivePresentation(
  request: Record<string, unknown>,
  expected: readonly (string | bigint | number)[],
) {
  const kind = request.kind;
  if (kind !== "anonymous" && kind !== "fund") {
    throw new Error("Unsupported receive proof kind");
  }
  const prepared = prepareReceivePresentationWitness(request);
  const circuit = PRESENTATION_CIRCUITS[kind];
  if (
    prepared.circuit !== circuit ||
    prepared.publicInputs.length !== expected.length ||
    prepared.publicInputs.some((value, index) => BigInt(value) !== BigInt(expected[index]))
  ) {
    throw new Error("Receive proof does not match the authenticated transaction");
  }
  const keys = SHIELDED_RECEIVE_LINK_KEYS?.[kind];
  if (!keys?.verificationKey || !keys.deltaG1 || !keys.issuerDeltaG1) {
    throw new Error("Receive presentation keys are missing; rebuild the ZK artifacts");
  }
  const { proof } = await generateShieldedProof({
    circuit,
    witness: prepared.witness,
    expectedPublicSignals: [...prepared.commonInputs, ...prepared.publicInputs].map(String),
  });
  const linkedProof = await linkGroth16Proofs({
    issuer: {
      proof: request.credentialProof as LinkedGroth16Proof,
      verificationKey: SHIELDED_RECEIVE_CREDENTIAL_VERIFICATION_KEYS[kind],
      deltaG1: keys.issuerDeltaG1,
    },
    presentation: {
      proof: proof as LinkedGroth16Proof,
      verificationKey: keys.verificationKey,
      deltaG1: keys.deltaG1,
    },
    commonInputs: prepared.commonInputs,
    publicInputs: prepared.publicInputs,
  });
  return { proof: linkedProof, publicSignals: prepared.publicInputs.map(String) };
}
