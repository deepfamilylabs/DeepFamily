import { useCallback, useState } from "react";
import { ethers } from "ethers";
import { useTranslation } from "react-i18next";
import {
  computeDisclosureBinding,
  formatGroth16ProofForContract,
  type PersonData,
} from "../../../../../shared/zk/zk";
import { decodeDisclosureBindingPublicSignals } from "../../../../../shared/zk/publicSignalSpecs";
import { zkWorkerCall } from "../../../../../shared/workers/zkWorkerClient";
import { safeCanonicalizeFullName } from "../../../../../shared/crypto/identityCommitment";
import {
  computeIdentityHashMaterial,
  normalizeIdentitySaltHex,
  type IdentitySaltMode,
} from "../../../../../shared/crypto/identityHash";
import { normalizePassphraseForHash } from "../../../../../shared/crypto/passphraseStrength";
import type { MintNFTFormValues, MintPersonInfo } from "../model/mintNftTypes";

interface GenerateDisclosureProofArgs {
  address: string;
  personInfo: MintPersonInfo;
  formData: MintNFTFormValues;
  targetPersonHash: string;
  identityMode: IdentitySaltMode;
  recoverySaltHex: string;
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
      identityMode,
      recoverySaltHex,
      getPassphrase,
    }: GenerateDisclosureProofArgs) => {
      setProofGenerationStep(t("mintNFT.preparingProof", "Preparing proof inputs..."));

      const normalizedFullName = safeCanonicalizeFullName(personInfo.fullName || "");
      if (!normalizedFullName) {
        throw new Error(t("mintNFT.fullNameRequired", "Full name is required to generate proof"));
      }

      const passphrase = getPassphrase();
      const identitySaltHex = (() => {
        if (identityMode !== "random") return null;

        const normalizedPassphrase = normalizePassphraseForHash(passphrase);
        if (!normalizedPassphrase.length) {
          throw new Error(
            t(
              "mintNFT.randomModePassphraseRequired",
              "Enhanced identity mode requires a non-empty identity passphrase",
            ),
          );
        }
        if (recoverySaltHex.trim()) {
          return normalizeIdentitySaltHex(recoverySaltHex);
        }
        throw new Error(
          t(
            "mintNFT.recoverySaltRequired",
            "Enhanced identity mode requires the saved recovery salt for this identity",
          ),
        );
      })();

      const {
        canonicalFullName,
        derivedSecretField,
        identityCommitment,
        personHash: computedPersonHash,
        nameField,
        suiteCommitment,
        packedBirthGenderField,
      } = await computeIdentityHashMaterial({
        fullName: normalizedFullName,
        passphrase,
        isBirthBC: personInfo.isBirthBC,
        birthYear: personInfo.birthYear,
        birthMonth: personInfo.birthMonth,
        birthDay: personInfo.birthDay,
        gender: personInfo.gender,
        identityMode,
        identitySaltHex,
      });

      if (targetPersonHash && computedPersonHash !== targetPersonHash) {
        throw new Error(
          t(
            "mintNFT.personHashMismatch",
            "The selected identity mode or recovery salt does not match the target person hash",
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

      const proofEnvelope = formatGroth16ProofForContract(generatedProof);
      const publicSignalsStruct = decodeDisclosureBindingPublicSignals(publicSignals);
      const disclosureBindingValue = computeDisclosureBinding(
        nameField,
        packedBirthGenderField,
        suiteCommitment,
      );
      if (publicSignalsStruct.disclosureBinding !== disclosureBindingValue) {
        throw new Error("Disclosure binding mismatch");
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
