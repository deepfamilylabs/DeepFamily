import { useCallback, useState } from "react";
import { formatGroth16ProofForContract, type PersonData } from "../../../../../shared/zk/zk";
import { decodePersonRelationPublicSignals } from "../../../../../shared/zk/publicSignalSpecs";
import { PERSON_RELATION_PROOF_DESCRIPTOR } from "../../../../../shared/zk/proofDescriptors";
import { zkWorkerCall } from "../../../../../shared/workers/zkWorkerClient";
import type { AddVersionT } from "../model/addVersionTypes";

interface GeneratePersonCommitmentProofArgs {
  personData: PersonData;
  fatherData: PersonData | null;
  motherData: PersonData | null;
  submitterAddress: string;
  contentDigestLo: string | bigint;
  contentDigestHi: string | bigint;
}

/** Where the add-version work is, as a step the timeline can place. */
export type AddVersionProofStep =
  | ""
  | "preparing"
  | "generating"
  | "verifying"
  | "encrypting"
  /** The frozen package has been handed to the flow; not yet on chain. */
  | "handoff";

export function usePersonCommitmentProof(t: AddVersionT) {
  const [proofStep, setProofStep] = useState<AddVersionProofStep>("");

  const reset = useCallback(() => {
    setProofStep("");
  }, []);

  const generatePersonCommitmentProof = useCallback(
    async ({
      personData,
      fatherData,
      motherData,
      submitterAddress,
      contentDigestLo,
      contentDigestHi,
    }: GeneratePersonCommitmentProofArgs) => {
      setProofStep("generating");

      const { proof, publicSignals } = await zkWorkerCall(
        "generatePersonRelationProof",
        {
          person: personData,
          father: fatherData,
          mother: motherData,
          submitterAddress,
          selfSuiteId: personData.identitySuiteId ?? 1,
          fatherSuiteId: fatherData?.identitySuiteId ?? 0,
          motherSuiteId: motherData?.identitySuiteId ?? 0,
          contentDigestLo,
          contentDigestHi,
        },
        { timeoutMs: 240_000 },
      );

      setProofStep("verifying");

      const { ok: isValid } = await zkWorkerCall(
        "verifyPersonRelationProof",
        { proof, publicSignals },
        { timeoutMs: 120_000 },
      );
      if (!isValid) {
        throw new Error(
          t("addVersion.proofVerificationFailed", "Generated proof verification failed"),
        );
      }

      return {
        proof: formatGroth16ProofForContract(proof, {
          circuitId: PERSON_RELATION_PROOF_DESCRIPTOR.circuitId,
          proofEncodingId: PERSON_RELATION_PROOF_DESCRIPTOR.proofEncodingId,
        }),
        publicSignals: decodePersonRelationPublicSignals(publicSignals),
      };
    },
    [t],
  );

  return {
    proofStep,
    setProofStep,
    generatePersonCommitmentProof,
    reset,
  };
}
