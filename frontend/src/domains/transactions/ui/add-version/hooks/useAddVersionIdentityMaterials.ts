import { useCallback } from "react";
import {
  DEFAULT_IDENTITY_SUITE_ID,
  PERSON_VERSION_SCHEMA,
  ProtocolError,
  canonicalizeFullName,
  type PersonVersionMetadataInput,
} from "@deepfamily/protocol-core";
import { classifyProtocolPassphraseRisk } from "../../../../../shared/crypto/passphraseStrength";
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

function getPublicIdentity(calc: PersonHashCalculatorHandle | null) {
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
    identitySuiteId: value.identitySuiteId,
    resolvedPersonHash: value.resolvedPersonHash,
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
      const fields = getPublicIdentity(calc);
      if (!calc || !fields) return null;
      const { identitySuiteId, resolvedPersonHash, ...identity } = fields;
      if (DEFAULT_IDENTITY_SUITE_ID > 1 && (!identitySuiteId || !resolvedPersonHash))
        throw new Error("The person identity lookup has not finished");
      if (!calc.passphrasesMatch()) {
        throw new Error(
          "Identity passphrase confirmation does not match after trimming surrounding whitespace",
        );
      }
      const rawPassphrase = calc.getSecretInputs().passphrase;
      if (classifyProtocolPassphraseRisk(rawPassphrase) === "disallowed") {
        throw new Error("Identity passphrase contains malformed Unicode");
      }
      const derived = await cryptoWorkerCall(
        "deriveIdentityMaterialV1",
        {
          identity,
          rawPassphrase,
          identitySuiteId: identitySuiteId ?? DEFAULT_IDENTITY_SUITE_ID,
        },
        { timeoutMs: 240_000 },
      );
      if (resolvedPersonHash && (derived.identitySuiteId !== identitySuiteId ||
        derived.personHash.toLowerCase() !== resolvedPersonHash.toLowerCase()))
        throw new Error("The identity credentials changed after the lookup");
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
      const father = input.fatherIdentity ? identityFields(input.fatherIdentity.personData) : null;
      const mother = input.motherIdentity ? identityFields(input.motherIdentity.personData) : null;

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
