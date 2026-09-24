import {
  IDENTITY_SUITE_CANDIDATE_1,
  ProtocolError,
  canonicalizeFullName,
} from "@deepfamily/protocol-core";
import { classifyProtocolPassphraseRisk } from "../../../shared/crypto/passphraseStrength";
import {
  cryptoWorkerCall,
  type IdentityMaterialV1Result,
} from "../../../shared/workers/cryptoWorkerClient";
import { InheritanceError } from "../model/inheritanceErrors";
import type { IdentityFormHandle } from "../model/inheritanceTypes";

const DERIVE_TIMEOUT_MS = 240_000;

/**
 * Reads the form at the moment of the action and derives the identity in the crypto worker.
 * The passphrase is read here and handed to the worker; nothing keeps a copy of it.
 */
export async function deriveIdentityFromForm(
  form: IdentityFormHandle | null,
): Promise<IdentityMaterialV1Result> {
  if (!form) throw new InheritanceError("nameRequired");
  const data = form.getPublicFormData();
  let fullName: string;
  try {
    fullName = canonicalizeFullName(data.fullName || "");
  } catch (error) {
    if (error instanceof ProtocolError && error.code === "EMPTY_FULL_NAME") {
      throw new InheritanceError("nameRequired");
    }
    throw error;
  }
  const rawPassphrase = form.getSecretInputs().passphrase;
  if (classifyProtocolPassphraseRisk(rawPassphrase) === "disallowed") {
    throw new InheritanceError("passphraseDisallowed");
  }
  return cryptoWorkerCall(
    "deriveIdentityMaterialV1",
    {
      identity: {
        fullName,
        gender: Number(data.gender),
        birthYear: Number(data.birthYear),
        birthMonth: Number(data.birthMonth),
        birthDay: Number(data.birthDay),
        isBirthBC: Boolean(data.isBirthBC),
      },
      rawPassphrase,
      identitySuiteId: IDENTITY_SUITE_CANDIDATE_1,
    },
    { timeoutMs: DERIVE_TIMEOUT_MS },
  );
}
