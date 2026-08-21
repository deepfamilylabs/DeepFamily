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

export function usePersonCommitmentProof(t: AddVersionT) {
  const [proofGenerationStep, setProofGenerationStep] = useState("");

  const reset = useCallback(() => {
    setProofGenerationStep("");
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
      setProofGenerationStep(
        t(
          "addVersion.generatingProof",
          "Generating zero-knowledge proof... (this may take 30-60 seconds)",
        ),
      );

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

      setProofGenerationStep(t("addVersion.verifyingProof", "Verifying proof..."));

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
    proofGenerationStep,
    setProofGenerationStep,
    generatePersonCommitmentProof,
    reset,
  };
}
