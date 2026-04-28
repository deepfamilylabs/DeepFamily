import { ethers } from "ethers";
import { useCallback } from "react";
import {
  computeIdentityHashMaterial,
  generateRandomIdentitySaltHex,
  normalizeIdentitySaltHex,
  type IdentitySaltMode,
} from "../../../../../shared/crypto/identityHash";
import { normalizePassphraseForHash } from "../../../../../shared/crypto/passphraseStrength";
import { safeCanonicalizeFullName } from "../../../../../shared/crypto/identityCommitment";
import type { PersonHashCalculatorHandle } from "../../../../person";
import type {
  AddVersionFormData,
  IdentityMaterial,
  IdentityResolutionOptions,
  IdentitySaltSelections,
  PersonInfoPublic,
} from "../model/addVersionTypes";

interface ResolveSelectedIdentitySaltArgs {
  mode: IdentitySaltMode;
  calc: PersonHashCalculatorHandle | null;
  recoverySaltHex: string;
  setRecoverySaltHex: (value: string) => void;
  errorMessage: string;
}

interface BuildMetadataPayloadArgs {
  tagValue: string;
  processedData: AddVersionFormData;
  identitySaltSelections: IdentitySaltSelections;
  personCalc: PersonHashCalculatorHandle | null;
  fatherCalc: PersonHashCalculatorHandle | null;
  motherCalc: PersonHashCalculatorHandle | null;
  personInfo: PersonInfoPublic | null;
  fatherInfo: PersonInfoPublic | null;
  motherInfo: PersonInfoPublic | null;
  personIdentityMode: IdentitySaltMode;
  fatherIdentityMode: IdentitySaltMode;
  motherIdentityMode: IdentitySaltMode;
}

function sanitizeInfo(info: PersonInfoPublic | null) {
  if (!info) return null;
  return {
    fullName: info.fullName,
    gender: info.gender,
    birthYear: info.birthYear,
    birthMonth: info.birthMonth,
    birthDay: info.birthDay,
    isBirthBC: info.isBirthBC,
  };
}

function hasNamedIdentityInput(calc: PersonHashCalculatorHandle | null) {
  const canonicalFullName = safeCanonicalizeFullName(calc?.getPublicFormData()?.fullName || "");
  return Boolean(canonicalFullName);
}

export function useAddVersionIdentityMaterials() {
  const resolveIdentityMaterial = useCallback(
    async (
      calc: PersonHashCalculatorHandle | null,
      options?: IdentityResolutionOptions,
    ): Promise<IdentityMaterial | null> => {
      if (!calc) return null;
      const publicData = calc.getPublicFormData();
      const secretInputs = calc.getSecretInputs();
      const canonicalFullName = safeCanonicalizeFullName(publicData?.fullName || "");
      if (!publicData || !canonicalFullName) return null;

      const computed = await computeIdentityHashMaterial({
        fullName: canonicalFullName,
        passphrase: secretInputs?.passphrase || "",
        isBirthBC: publicData.isBirthBC,
        birthYear: publicData.birthYear,
        birthMonth: publicData.birthMonth,
        birthDay: publicData.birthDay,
        gender: publicData.gender,
        identityMode: options?.identityMode,
        identitySaltHex: options?.identitySaltHex,
      });

      return {
        personData: {
          fullName: computed.canonicalFullName,
          derivedSecretField: computed.derivedSecretField,
          birthYear: publicData.birthYear,
          birthMonth: publicData.birthMonth,
          birthDay: publicData.birthDay,
          isBirthBC: publicData.isBirthBC,
          gender: publicData.gender,
        },
        personHash: computed.personHash,
        identityMode: computed.identityMode,
        identitySaltHex: computed.identitySaltHex,
        recovery: computed.derivedSecretBundle
          ? {
              algorithm: computed.derivedSecretBundle.algorithm,
              kdfVersion: computed.derivedSecretBundle.kdfVersion,
              params: computed.derivedSecretBundle.params,
              saltHex: computed.derivedSecretBundle.saltHex,
            }
          : null,
      };
    },
    [],
  );

  const resolveSelectedIdentitySaltHex = useCallback(
    ({
      mode,
      calc,
      recoverySaltHex,
      setRecoverySaltHex,
      errorMessage,
    }: ResolveSelectedIdentitySaltArgs): string | null => {
      if (mode !== "random") return null;
      const normalizedPassphrase = normalizePassphraseForHash(
        calc?.getSecretInputs().passphrase || "",
      );
      if (!normalizedPassphrase.length) {
        throw new Error(errorMessage);
      }
      if (recoverySaltHex.trim()) {
        return normalizeIdentitySaltHex(recoverySaltHex);
      }
      const generated = generateRandomIdentitySaltHex();
      setRecoverySaltHex(generated);
      return generated;
    },
    [],
  );

  const resolveIdentitySaltSelections = useCallback(
    (input: {
      personMode: IdentitySaltMode;
      personCalc: PersonHashCalculatorHandle | null;
      personRecoverySaltHex: string;
      setPersonRecoverySaltHex: (value: string) => void;
      personErrorMessage: string;
      fatherMode: IdentitySaltMode;
      fatherCalc: PersonHashCalculatorHandle | null;
      fatherRecoverySaltHex: string;
      setFatherRecoverySaltHex: (value: string) => void;
      fatherErrorMessage: string;
      motherMode: IdentitySaltMode;
      motherCalc: PersonHashCalculatorHandle | null;
      motherRecoverySaltHex: string;
      setMotherRecoverySaltHex: (value: string) => void;
      motherErrorMessage: string;
    }): IdentitySaltSelections => ({
      personIdentitySaltHex: resolveSelectedIdentitySaltHex({
        mode: input.personMode,
        calc: input.personCalc,
        recoverySaltHex: input.personRecoverySaltHex,
        setRecoverySaltHex: input.setPersonRecoverySaltHex,
        errorMessage: input.personErrorMessage,
      }),
      fatherIdentitySaltHex: hasNamedIdentityInput(input.fatherCalc)
        ? resolveSelectedIdentitySaltHex({
            mode: input.fatherMode,
            calc: input.fatherCalc,
            recoverySaltHex: input.fatherRecoverySaltHex,
            setRecoverySaltHex: input.setFatherRecoverySaltHex,
            errorMessage: input.fatherErrorMessage,
          })
        : null,
      motherIdentitySaltHex: hasNamedIdentityInput(input.motherCalc)
        ? resolveSelectedIdentitySaltHex({
            mode: input.motherMode,
            calc: input.motherCalc,
            recoverySaltHex: input.motherRecoverySaltHex,
            setRecoverySaltHex: input.setMotherRecoverySaltHex,
            errorMessage: input.motherErrorMessage,
          })
        : null,
    }),
    [resolveSelectedIdentitySaltHex],
  );

  const buildMetadataPayload = useCallback(
    async ({
      tagValue,
      processedData,
      identitySaltSelections,
      personCalc,
      fatherCalc,
      motherCalc,
      personInfo,
      fatherInfo,
      motherInfo,
      personIdentityMode,
      fatherIdentityMode,
      motherIdentityMode,
    }: BuildMetadataPayloadArgs) => {
      const baseEmpty = {
        fullName: "",
        gender: 0,
        birthYear: 0,
        birthMonth: 0,
        birthDay: 0,
        isBirthBC: false,
      };

      const personIdentity = await resolveIdentityMaterial(personCalc, {
        identityMode: personIdentityMode,
        identitySaltHex: identitySaltSelections.personIdentitySaltHex,
      });
      const fatherIdentity = await resolveIdentityMaterial(fatherCalc, {
        identityMode: fatherIdentityMode,
        identitySaltHex: identitySaltSelections.fatherIdentitySaltHex,
      });
      const motherIdentity = await resolveIdentityMaterial(motherCalc, {
        identityMode: motherIdentityMode,
        identitySaltHex: identitySaltSelections.motherIdentitySaltHex,
      });

      const personData = sanitizeInfo(personInfo) ?? baseEmpty;
      const fatherData = sanitizeInfo(fatherInfo) ?? baseEmpty;
      const motherData = sanitizeInfo(motherInfo) ?? baseEmpty;

      return {
        schema: "deepfamily/person-version@2.0",
        identity: {
          mode: personIdentity?.identityMode || personIdentityMode,
        },
        tag: tagValue || "",
        person: {
          fullName: personData.fullName,
          gender: personData.gender,
          birthYear: personData.birthYear,
          birthMonth: personData.birthMonth,
          birthDay: personData.birthDay,
          isBirthBC: personData.isBirthBC,
          personHash: personIdentity?.personHash || ethers.ZeroHash,
        },
        parents: {
          father: {
            fullName: fatherData.fullName,
            gender: fatherData.gender,
            birthYear: fatherData.birthYear,
            birthMonth: fatherData.birthMonth,
            birthDay: fatherData.birthDay,
            isBirthBC: fatherData.isBirthBC,
            personHash: fatherIdentity?.personHash || ethers.ZeroHash,
            identityMode: fatherIdentity?.identityMode || fatherIdentityMode,
            versionIndex: processedData.fatherVersionIndex ?? 0,
          },
          mother: {
            fullName: motherData.fullName,
            gender: motherData.gender,
            birthYear: motherData.birthYear,
            birthMonth: motherData.birthMonth,
            birthDay: motherData.birthDay,
            isBirthBC: motherData.isBirthBC,
            personHash: motherIdentity?.personHash || ethers.ZeroHash,
            identityMode: motherIdentity?.identityMode || motherIdentityMode,
            versionIndex: processedData.motherVersionIndex ?? 0,
          },
        },
        recovery: personIdentity?.recovery
          ? {
              identityMode: personIdentity.identityMode,
              identityKdf: {
                algorithm: personIdentity.recovery.algorithm,
                kdfVersion: personIdentity.recovery.kdfVersion,
                params: personIdentity.recovery.params,
                saltHex: personIdentity.recovery.saltHex,
              },
            }
          : null,
      };
    },
    [resolveIdentityMaterial],
  );

  return {
    buildMetadataPayload,
    resolveIdentityMaterial,
    resolveIdentitySaltSelections,
    resolveSelectedIdentitySaltHex,
  };
}
