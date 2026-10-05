import type { Groth16Proof } from "../shared/zk/zk";
import { serializeWorkerError } from "../shared/workers/workerErrors";
import {
  generateShieldedProof,
  type ShieldedCircuitName,
  type ShieldedWitness,
} from "../shared/zk/shieldedZk";
import {
  createShieldedReceiveCode,
  createShieldedReceiveCodeFromCredentials,
  verifyShieldedReceiveCode,
  type ShieldedReceiveCodeCheck,
  type ShieldedReceiveCodeIdentity,
} from "../shared/zk/shieldedReceiveCode";
import type { IdentityFields } from "@deepfamily/protocol-core";
import type {
  DisclosureBindingProofParameters,
  PersonRelationProofParameters,
} from "../shared/zk/zkSnark";
import { getProofDescriptorByPurpose } from "../shared/zk/proofDescriptors";
import {
  generatePersonRelationProof,
  verifyPersonRelationProof,
  generateDisclosureBindingProof,
  verifyDisclosureBindingProof,
} from "../shared/zk/zkSnark";

type ZkWorkerMethods = {
  generatePersonRelationProof: {
    params: PersonRelationProofParameters;
    result: { proof: Groth16Proof; publicSignals: string[] };
  };
  verifyPersonRelationProof: {
    params: { proof: Groth16Proof; publicSignals: string[] };
    result: { ok: boolean };
  };
  generateDisclosureBindingProof: {
    params: DisclosureBindingProofParameters;
    result: { proof: Groth16Proof; publicSignals: string[] };
  };
  verifyDisclosureBindingProof: {
    params: { proof: Groth16Proof; publicSignals: string[] };
    result: { ok: boolean };
  };
  generateShieldedProof: {
    params: {
      circuit: ShieldedCircuitName;
      witness: ShieldedWitness;
      expectedPublicSignals: string[];
    };
    result: { proof: Groth16Proof; publicSignals: string[] };
  };
  createShieldedReceiveCode: {
    params: ShieldedReceiveCodeIdentity;
    result: { code: string; personHash: string };
  };
  createShieldedReceiveCodeFromCredentials: {
    params: { identity: IdentityFields; rawPassphrase: string };
    result: { code: string; personHash: string };
  };
  verifyShieldedReceiveCode: {
    params: { code: string };
    result: ShieldedReceiveCodeCheck;
  };
};

type ZkWorkerRequest = { id: number; method: keyof ZkWorkerMethods; params: any };
type ZkWorkerResponse =
  | { id: number; ok: true; result: any }
  | { id: number; ok: false; error: { message: string; name?: string } };

function assertDescriptorPurpose(purpose: "PersonRelation" | "DisclosureBinding") {
  return getProofDescriptorByPurpose(purpose);
}

const handlers: {
  [K in keyof ZkWorkerMethods]: (
    params: ZkWorkerMethods[K]["params"],
  ) => Promise<ZkWorkerMethods[K]["result"]> | ZkWorkerMethods[K]["result"];
} = {
  generatePersonRelationProof: async (parameters) => {
    assertDescriptorPurpose("PersonRelation");
    return await generatePersonRelationProof(parameters);
  },
  verifyPersonRelationProof: async ({ proof, publicSignals }) => {
    assertDescriptorPurpose("PersonRelation");
    return { ok: await verifyPersonRelationProof(proof, publicSignals) };
  },
  generateDisclosureBindingProof: async (parameters) => {
    assertDescriptorPurpose("DisclosureBinding");
    return await generateDisclosureBindingProof(parameters);
  },
  verifyDisclosureBindingProof: async ({ proof, publicSignals }) => {
    assertDescriptorPurpose("DisclosureBinding");
    return { ok: await verifyDisclosureBindingProof(proof, publicSignals) };
  },
  generateShieldedProof: async (parameters) => await generateShieldedProof(parameters),
  createShieldedReceiveCode: async (identity) => await createShieldedReceiveCode(identity),
  createShieldedReceiveCodeFromCredentials: async (credentials) =>
    await createShieldedReceiveCodeFromCredentials(credentials),
  verifyShieldedReceiveCode: async ({ code }) => await verifyShieldedReceiveCode(code),
};

self.addEventListener("message", async (event: MessageEvent<ZkWorkerRequest>) => {
  let request = event.data || ({} as any);
  const { id, method } = request;
  const post = (resp: ZkWorkerResponse) => {
    (self as any).postMessage(resp);
  };
  try {
    const handler = (handlers as any)[method];
    if (typeof id !== "number" || !method || typeof handler !== "function") {
      post({ id, ok: false, error: { message: "Invalid ZK worker request" } });
      return;
    }
    const result = await handler(request.params);
    post({ id, ok: true, result });
  } catch (err) {
    post({ id, ok: false, error: serializeWorkerError(err) });
  } finally {
    // Bound private witness lifetime to this job. Strings cannot be zeroed, so
    // cancellation terminates this realm and normal completion severs the
    // request graph before the next message is processed.
    if (request && typeof request === "object") request.params = undefined;
    request = undefined as any;
  }
});
