import { useCallback } from "react";
import {
  IDENTITY_SUITE_CANDIDATE_1,
  PERSON_VERSION_SCHEMA,
  ProtocolError,
  canonicalizeFullName,
  type PersonVersionMetadataInput,
} from "@deepfamily/protocol-core";
import { cryptoWorkerCall } from "../../../../../shared/workers/cryptoWorkerClient";
import type { PersonHashCalculatorHandle } from "../../../../person";
import type {
  AddVersionFormData,
  IdentityMaterial,
  PersonInfoPublic,
} from "../model/addVersionTypes";

function identityFields(info: PersonInfoPublic) {
  return {
    fullName: canonicalizeFullName(info.fullName),
    gender: Number(info.gender),
    birthYear: Number(info.birthYear),
    birthMonth: Number(info.birthMonth),
    birthDay: Number(info.birthDay),
    isBirthBC: Boolean(info.isBirthBC),
  };
}

function getPublicIdentity(calc: PersonHashCalculatorHandle | null): PersonInfoPublic | null {
  const value = calc?.getPublicFormData();
  if (!value) return null;
  let fullName: string;
  try {
    fullName = canonicalizeFullName(value.fullName || "");
  } catch (error) {
    if (error instanceof ProtocolError && error.code === "EMPTY_FULL_NAME") return null;
    throw error;
  }
  return {
    fullName,
    gender: Number(value.gender),
    birthYear: Number(value.birthYear),
    birthMonth: Number(value.birthMonth),
    birthDay: Number(value.birthDay),
    isBirthBC: Boolean(value.isBirthBC),
  };
}

export function useAddVersionIdentityMaterials() {
  const resolveIdentityMaterial = useCallback(
    async (calc: PersonHashCalculatorHandle | null): Promise<IdentityMaterial | null> => {
      const identity = getPublicIdentity(calc);
      if (!calc || !identity) return null;
      if (!calc.passphrasesMatch()) {
        throw new Error("Identity passphrase confirmation does not match after NFKD normalization");
      }
      const rawPassphrase = calc.getSecretInputs().passphrase;
      const derived = await cryptoWorkerCall(
        "deriveIdentityMaterialV1",
        {
          identity,
          rawPassphrase,
          identitySuiteId: IDENTITY_SUITE_CANDIDATE_1,
        },
        { timeoutMs: 240_000 },
      );
      const derivedSecretField = BigInt(derived.derivedSecretField);
      return {
        personData: {
          ...identity,
          derivedSecretField,
          identitySuiteId: derived.identitySuiteId,
        },
        personHash: derived.personHash,
        identitySuiteId: derived.identitySuiteId,
        identityCommitment: BigInt(derived.identityCommitment),
        derivedSecretField,
      };
    },
    [],
  );

  const buildMetadataPayload = useCallback(
    (input: {
      processedData: AddVersionFormData;
      personIdentity: IdentityMaterial;
      fatherIdentity: IdentityMaterial | null;
      motherIdentity: IdentityMaterial | null;
    }): PersonVersionMetadataInput => {
      const { processedData } = input;
      const person = identityFields(input.personIdentity.personData);
      const father = input.fatherIdentity
        ? identityFields(input.fatherIdentity.personData)
        : null;
      const mother = input.motherIdentity
        ? identityFields(input.motherIdentity.personData)
        : null;

      return {
        schema: PERSON_VERSION_SCHEMA,
        person: { ...person, personHash: input.personIdentity.personHash },
        parents: {
          father: father
            ? {
                ...father,
                personHash: input.fatherIdentity!.personHash,
                versionIndex: BigInt(processedData.fatherVersionIndex),
              }
            : null,
          mother: mother
            ? {
                ...mother,
                personHash: input.motherIdentity!.personHash,
                versionIndex: BigInt(processedData.motherVersionIndex),
              }
            : null,
        },
        tag: processedData.tag,
        biography: processedData.biography,
      };
    },
    [],
  );

  return { buildMetadataPayload, resolveIdentityMaterial };
}
