import {
  IDENTITY_SUITE_CANDIDATE_1,
  bytesToHex,
  deriveDeterministicIdentitySalt,
  deriveIdentityMaterial,
  wipeBytes,
  type IdentityFields,
} from "@deepfamily/protocol-core";

/** Fresh-v1 identity input. Callers cannot provide or persist an identity salt. */
export type IdentityHashInput = IdentityFields & {
  passphrase: string;
  identitySuiteId?: number;
};

/**
 * Public values plus the transient field witness needed by proof generation.
 * Raw Argon2 output and the deterministic salt are wiped before this returns.
 */
export type IdentityHashComputation = {
  identitySuiteId: number;
  canonicalFullName: string;
  personHash: string;
  identityCommitment: bigint;
  nameField: bigint;
  suiteCommitment: bigint;
  packedBirthGenderField: bigint;
  derivedSecretField: bigint;
};

export function computeIdentitySaltHex(
  input: IdentityFields,
  identitySuiteId = IDENTITY_SUITE_CANDIDATE_1,
): string {
  const salt = deriveDeterministicIdentitySalt(input, identitySuiteId);
  try {
    return bytesToHex(salt).slice(2);
  } finally {
    wipeBytes(salt);
  }
}

export async function computeIdentityHashMaterial(
  input: IdentityHashInput,
): Promise<IdentityHashComputation> {
  let material: Awaited<ReturnType<typeof deriveIdentityMaterial>> | undefined;
  try {
    material = await deriveIdentityMaterial({
      identity: input,
      rawPassphrase: input.passphrase,
      identitySuiteId: input.identitySuiteId ?? IDENTITY_SUITE_CANDIDATE_1,
    });
    return {
      identitySuiteId: material.identitySuiteId,
      canonicalFullName: material.identity.fullName,
      personHash: material.personHash,
      identityCommitment: material.identityCommitment,
      nameField: material.nameField,
      suiteCommitment: material.suiteCommitment,
      packedBirthGenderField: material.packedBirthGenderField,
      derivedSecretField: material.derivedSecretField,
    };
  } finally {
    wipeBytes(material?.identitySalt);
    wipeBytes(material?.derivedSecretBytes);
  }
}

export async function computePersonHash(input: IdentityHashInput): Promise<string> {
  try {
    return (await computeIdentityHashMaterial(input)).personHash;
  } catch {
    return "";
  }
}

export const computeIdentityHash = computePersonHash;
