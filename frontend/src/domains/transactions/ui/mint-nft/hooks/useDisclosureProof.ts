import { useCallback, useState } from "react";
import { ethers } from "ethers";
import { useTranslation } from "react-i18next";
import {
  computeDisclosureBinding,
  formatGroth16ProofForContract,
  type PersonData,
} from "../../../../../shared/zk/zk";
import { DISCLOSURE_BINDING_PROOF_DESCRIPTOR } from "../../../../../shared/zk/proofDescriptors";
import { decodeDisclosureBindingPublicSignals } from "../../../../../shared/zk/publicSignalSpecs";
import { cryptoWorkerCall } from "../../../../../shared/workers/cryptoWorkerClient";
import { zkWorkerCall } from "../../../../../shared/workers/zkWorkerClient";
import { safeCanonicalizeFullName } from "../../../../../shared/crypto/identityCommitment";
import type { MintNFTFormValues, MintPersonInfo } from "../model/mintNftTypes";

interface GenerateDisclosureProofArgs {
  address: string;
  personInfo: MintPersonInfo;
  formData: MintNFTFormValues;
  targetPersonHash: string;
  selfSuiteId: number;
  getPassphrase: () => string;
}

function toNumberOrZero(value: number | string | undefined) {
  return value === "" || value === undefined ? 0 : Number(value);
}

export function useDisclosureProof() {
  const { t } = useTranslation();
  const [proofGenerationStep, setProofGenerationStep] = useState("");

  const reset = useCallback(() => {
    setProofGenerationStep("");
  }, []);

  const generateDisclosureProof = useCallback(
    async ({
      address,
      personInfo,
      formData,
      targetPersonHash,
      selfSuiteId,
      getPassphrase,
    }: GenerateDisclosureProofArgs) => {
      setProofGenerationStep(t("mintNFT.preparingProof", "Preparing proof inputs..."));

      const normalizedFullName = safeCanonicalizeFullName(personInfo.fullName || "");
      if (!normalizedFullName) {
        throw new Error(t("mintNFT.fullNameRequired", "Full name is required to generate proof"));
      }

      const identity = await cryptoWorkerCall(
        "deriveIdentityMaterialV1",
        {
          identity: {
            fullName: normalizedFullName,
            isBirthBC: personInfo.isBirthBC,
            birthYear: personInfo.birthYear,
            birthMonth: personInfo.birthMonth,
            birthDay: personInfo.birthDay,
            gender: personInfo.gender,
          },
          rawPassphrase: getPassphrase(),
          identitySuiteId: selfSuiteId,
        },
        { timeoutMs: 240_000 },
      );
      const canonicalFullName = identity.identity.fullName;
      const derivedSecretField = BigInt(identity.derivedSecretField);
      const identityCommitment = BigInt(identity.identityCommitment);
      const computedPersonHash = identity.personHash;
      const nameField = BigInt(identity.nameField);
      const suiteCommitment = BigInt(identity.suiteCommitment);
      const packedBirthGenderField = BigInt(identity.packedBirthGenderField);

      if (targetPersonHash && computedPersonHash !== targetPersonHash) {
        throw new Error(
          t(
            "mintNFT.personHashMismatch",
            "The passphrase or identity suite does not match the target person hash",
          ),
        );
      }

      const personData: PersonData = {
        fullName: canonicalFullName,
        derivedSecretField,
        birthYear: personInfo.birthYear,
        birthMonth: personInfo.birthMonth,
        birthDay: personInfo.birthDay,
        isBirthBC: personInfo.isBirthBC,
        gender: personInfo.gender,
        identitySuiteId: selfSuiteId,
      };

      const processedData = {
        ...formData,
        deathYear: toNumberOrZero(formData.deathYear),
        deathMonth: toNumberOrZero(formData.deathMonth),
        deathDay: toNumberOrZero(formData.deathDay),
      };

      const coreInfo = {
        basicInfo: {
          identityCommitment: ethers.zeroPadValue(ethers.toBeHex(identityCommitment), 32),
          isBirthBC: personInfo.isBirthBC,
          birthYear: personInfo.birthYear,
          birthMonth: personInfo.birthMonth,
          birthDay: personInfo.birthDay,
          gender: personInfo.gender,
        },
        supplementInfo: {
          fullName: canonicalFullName,
          birthPlace: processedData.birthPlace,
          isDeathBC: processedData.isDeathBC,
          deathYear: processedData.deathYear,
          deathMonth: processedData.deathMonth,
          deathDay: processedData.deathDay,
          deathPlace: processedData.deathPlace,
          story: processedData.story,
        },
      };

      setProofGenerationStep(
        t(
          "mintNFT.generatingProof",
          "Generating zero-knowledge proof... (this may take 30-60 seconds)",
        ),
      );
      const { proof: generatedProof, publicSignals } = await zkWorkerCall(
        "generateDisclosureBindingProof",
        {
          person: personData,
          minterAddress: address,
          selfSuiteId,
        },
        { timeoutMs: 240_000 },
      );

      setProofGenerationStep(t("mintNFT.verifyingProof", "Verifying zero-knowledge proof..."));
      const { ok: isProofValid } = await zkWorkerCall(
        "verifyDisclosureBindingProof",
        { proof: generatedProof, publicSignals },
        { timeoutMs: 120_000 },
      );
      if (!isProofValid) {
        throw new Error(
          t("mintNFT.proofVerificationFailed", "Generated proof verification failed"),
        );
      }

      const proofEnvelope = formatGroth16ProofForContract(generatedProof, {
        circuitId: DISCLOSURE_BINDING_PROOF_DESCRIPTOR.circuitId,
        proofEncodingId: DISCLOSURE_BINDING_PROOF_DESCRIPTOR.proofEncodingId,
      });
      const publicSignalsStruct = decodeDisclosureBindingPublicSignals(publicSignals);
      const disclosureBindingValue = computeDisclosureBinding(
        nameField,
        packedBirthGenderField,
        suiteCommitment,
      );
      if (publicSignalsStruct.disclosureBinding !== disclosureBindingValue) {
        throw new Error("Disclosure binding mismatch");
      }
      if (publicSignalsStruct.suiteCommitment !== suiteCommitment) {
        throw new Error("Disclosure suite commitment mismatch");
      }

      setProofGenerationStep(
        t("mintNFT.proofVerified", "Zero-knowledge proof verified. Submitting transaction..."),
      );

      return {
        computedPersonHash,
        proofEnvelope,
        publicSignals: publicSignalsStruct,
        coreInfo,
        tokenURI: processedData.tokenURI || "",
      };
    },
    [t],
  );

  return {
    proofGenerationStep,
    generateDisclosureProof,
    reset,
  };
}
