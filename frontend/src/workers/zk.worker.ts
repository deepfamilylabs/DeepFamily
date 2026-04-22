import type { Groth16Proof, PersonData } from "../shared/zk/zk";
import { getProofDescriptorByPurpose } from "../shared/zk/proofDescriptors";
import {
  generatePersonCommitmentProof,
  verifyPersonCommitmentProof,
  generateDisclosureBindingProof,
  verifyDisclosureBindingProof,
} from "../shared/zk/zkSnark";

type ZkWorkerMethods = {
  generatePersonCommitmentProof: {
    params: {
      person: PersonData;
      father: PersonData | null;
      mother: PersonData | null;
      submitterAddress: string;
    };
    result: { proof: Groth16Proof; publicSignals: string[] };
  };
  verifyPersonCommitmentProof: {
    params: { proof: Groth16Proof; publicSignals: string[] };
    result: { ok: boolean };
  };
  generateDisclosureBindingProof: {
    params: {
      person: PersonData;
      minterAddress: string;
    };
    result: { proof: Groth16Proof; publicSignals: string[] };
  };
  verifyDisclosureBindingProof: {
    params: { proof: Groth16Proof; publicSignals: string[] };
    result: { ok: boolean };
  };
};

type ZkWorkerRequest = { id: number; method: keyof ZkWorkerMethods; params: any };
type ZkWorkerResponse =
  | { id: number; ok: true; result: any }
  | { id: number; ok: false; error: { message: string; name?: string } };

const getErrorShape = (err: unknown): { message: string; name?: string } => {
  if (err && typeof err === "object") {
    const anyErr = err as any;
    if (typeof anyErr.message === "string")
      return {
        message: anyErr.message,
        name: typeof anyErr.name === "string" ? anyErr.name : undefined,
      };
  }
  return { message: String(err) };
};

function assertDescriptorPurpose(purpose: "PersonCommitment" | "DisclosureBinding") {
  return getProofDescriptorByPurpose(purpose);
}

const handlers: {
  [K in keyof ZkWorkerMethods]: (
    params: ZkWorkerMethods[K]["params"],
  ) => Promise<ZkWorkerMethods[K]["result"]> | ZkWorkerMethods[K]["result"];
} = {
  generatePersonCommitmentProof: async ({ person, father, mother, submitterAddress }) => {
    assertDescriptorPurpose("PersonCommitment");
    return await generatePersonCommitmentProof(person, father, mother, submitterAddress);
  },
  verifyPersonCommitmentProof: async ({ proof, publicSignals }) => {
    assertDescriptorPurpose("PersonCommitment");
    return { ok: await verifyPersonCommitmentProof(proof, publicSignals) };
  },
  generateDisclosureBindingProof: async ({ person, minterAddress }) => {
    assertDescriptorPurpose("DisclosureBinding");
    return await generateDisclosureBindingProof(person, minterAddress);
  },
  verifyDisclosureBindingProof: async ({ proof, publicSignals }) => {
    assertDescriptorPurpose("DisclosureBinding");
    return { ok: await verifyDisclosureBindingProof(proof, publicSignals) };
  },
};

self.addEventListener("message", async (event: MessageEvent<ZkWorkerRequest>) => {
  const { id, method, params } = event.data || ({} as any);
  const post = (resp: ZkWorkerResponse) => {
    (self as any).postMessage(resp);
  };
  try {
    const handler = (handlers as any)[method];
    if (typeof id !== "number" || !method || typeof handler !== "function") {
      post({ id, ok: false, error: { message: "Invalid ZK worker request" } });
      return;
    }
    const result = await handler(params);
    post({ id, ok: true, result });
  } catch (err) {
    post({ id, ok: false, error: getErrorShape(err) });
  }
});
