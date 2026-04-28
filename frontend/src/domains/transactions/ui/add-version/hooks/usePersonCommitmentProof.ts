import { useCallback, useState } from "react";
import { formatGroth16ProofForContract, type PersonData } from "../../../../../shared/zk/zk";
import { decodePersonCommitmentPublicSignals } from "../../../../../shared/zk/publicSignalSpecs";
import { zkWorkerCall } from "../../../../../shared/workers/zkWorkerClient";
import type { AddVersionT } from "../model/addVersionTypes";

interface GeneratePersonCommitmentProofArgs {
  personData: PersonData;
  fatherData: PersonData | null;
  motherData: PersonData | null;
  submitterAddress: string;
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
    }: GeneratePersonCommitmentProofArgs) => {
      setProofGenerationStep(
        t(
          "addVersion.generatingProof",
          "Generating zero-knowledge proof... (this may take 30-60 seconds)",
        ),
      );

      const { proof, publicSignals } = await zkWorkerCall(
        "generatePersonCommitmentProof",
        {
          person: personData,
          father: fatherData,
          mother: motherData,
          submitterAddress,
        },
        { timeoutMs: 240_000 },
      );

      setProofGenerationStep(t("addVersion.verifyingProof", "Verifying proof..."));

      const { ok: isValid } = await zkWorkerCall(
        "verifyPersonCommitmentProof",
        { proof, publicSignals },
        { timeoutMs: 120_000 },
      );
      if (!isValid) {
        throw new Error(
          t("addVersion.proofVerificationFailed", "Generated proof verification failed"),
        );
      }

      return {
        proof: formatGroth16ProofForContract(proof),
        publicSignals: decodePersonCommitmentPublicSignals(publicSignals),
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
