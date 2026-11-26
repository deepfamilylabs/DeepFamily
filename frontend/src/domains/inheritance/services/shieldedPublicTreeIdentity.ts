import {
  decryptFormat1Compressed,
  deriveIdentityMaterial,
  gunzipV1Strict,
  parseCanonicalPersonVersion,
  parseFormat1Envelope,
  readMetadataEnvelopeFromRef,
  wipeBytes,
  type IdentityFields,
  type MetadataContextInput,
} from "@deepfamily/protocol-core";
import { getBigInt, isHexString, type Contract } from "ethers";
import { createArchiveContract } from "../../../shared/clients/contractFactory";

/** Empty and whitespace-only passphrases both prepare to this public family-tree passphrase. */
const PUBLIC_TREE_PASSPHRASE = "";

/** Worker wording for a refused recipient; shieldedUiErrors localizes it by matching this text. */
export const PUBLIC_TREE_RECIPIENT_MESSAGE =
  "The selected child is registered with the empty public family-tree passphrase, so anyone could claim a budget owned by that identity.";

/** The version whose public envelope shows that the empty passphrase reproduces the identity. */
export type PublicTreeIdentityEvidence = { versionIndex: number };

/**
 * An identity-derived budget owner is only as secret as the identity passphrase. This finds
 * public-tree identities from chain data alone, without the recipient's details: each version's
 * metadata envelope is tried with the empty passphrase, and an opened envelope counts only when
 * its identity fields and the empty passphrase reproduce `personHash`.
 *
 * Registration encrypts the envelope with the identity passphrase and round-trips it before
 * submission, so this covers every conforming record. It does not detect a weak nonempty
 * passphrase, or a non-conforming record whose envelope passphrase differs from its identity
 * passphrase. Read and format failures propagate so a caller cannot mistake an unverified
 * recipient for a protected one.
 */
export async function findPublicTreeIdentityEvidence(input: {
  family: Contract;
  chainId: bigint;
  personHash: string;
  blockTag: number;
}): Promise<PublicTreeIdentityEvidence | null> {
  if (!isHexString(input.personHash, 32)) throw new Error("Recipient person hash is invalid");
  const provider = input.family.runner?.provider;
  if (!provider) throw new Error("The family contract has no provider");
  const personHash = input.personHash.toLowerCase();
  const at = { blockTag: input.blockTag };
  const [deepFamilyProxy, archiveAddress, versionCount] = await Promise.all([
    input.family.getAddress(),
    input.family.archive(at),
    input.family.personVersionsCount(personHash, at),
  ]);
  const count = getBigInt(versionCount);
  if (count < 1n || count > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Recipient identity has no readable registered version");
  const archive = createArchiveContract(String(archiveAddress), provider);
  const getCode = (pointer: string, blockTag: string | number) =>
    provider.getCode(pointer, blockTag);
  for (let versionIndex = 1; versionIndex <= Number(count); versionIndex += 1) {
    const [version, ref] = await Promise.all([
      input.family.personVersionAt(personHash, versionIndex - 1, at),
      archive.metadataRef(personHash, versionIndex, at),
    ]);
    const { envelope } = await readMetadataEnvelopeFromRef({
      pointer: ref.pointer,
      payloadHash: ref.payloadHash,
      payloadLength: ref.payloadLength,
      segmentCount: ref.segmentCount,
      blockTag: input.blockTag,
      getCode,
    });
    // The contract bound this header suite to the version's proof.
    const { identitySuiteId } = parseFormat1Envelope(envelope);
    const opened = await openWithPublicTreePassphrase(envelope, {
      chainId: input.chainId,
      deepFamilyProxy,
      personHash,
      fatherHash: version.fatherHash,
      fatherVersionIndex: version.fatherVersionIndex,
      motherHash: version.motherHash,
      motherVersionIndex: version.motherVersionIndex,
      versionCommitment: version.versionCommitment,
    });
    if (opened && (await reproducesWithPublicTreePassphrase(opened, identitySuiteId, personHash)))
      return { versionIndex };
  }
  return null;
}

/** Returns the plaintext identity fields only when the envelope opens with the empty passphrase. */
async function openWithPublicTreePassphrase(
  envelope: Uint8Array,
  context: MetadataContextInput,
): Promise<IdentityFields | null> {
  let compressedPlaintext: Uint8Array;
  try {
    ({ compressedPlaintext } = await decryptFormat1Compressed({
      envelope,
      rawPassphrase: PUBLIC_TREE_PASSPHRASE,
      context,
    }));
  } catch (error) {
    // A passphrase-protected envelope fails authentication, revealing nothing to anyone.
    if ((error as { code?: unknown } | null)?.code === "AES_GCM_AUTHENTICATION_FAILED") return null;
    throw error;
  }
  let canonicalJsonBytes: Uint8Array | undefined;
  try {
    canonicalJsonBytes = gunzipV1Strict(compressedPlaintext);
    const { fullName, gender, birthYear, birthMonth, birthDay, isBirthBC } =
      parseCanonicalPersonVersion(canonicalJsonBytes).person;
    return { fullName, gender, birthYear, birthMonth, birthDay, isBirthBC };
  } finally {
    wipeBytes(compressedPlaintext);
    wipeBytes(canonicalJsonBytes);
  }
}

async function reproducesWithPublicTreePassphrase(
  identity: IdentityFields,
  identitySuiteId: number,
  personHash: string,
): Promise<boolean> {
  const material = await deriveIdentityMaterial({
    identity,
    rawPassphrase: PUBLIC_TREE_PASSPHRASE,
    identitySuiteId,
  });
  try {
    return material.personHash.toLowerCase() === personHash;
  } finally {
    wipeBytes(material.identitySalt);
    wipeBytes(material.derivedSecretBytes);
  }
}
