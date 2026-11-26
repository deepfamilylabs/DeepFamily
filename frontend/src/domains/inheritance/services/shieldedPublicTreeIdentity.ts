import {
  ProtocolError,
  decryptFormat1Compressed,
  deriveIdentityMaterial,
  gunzipV1Strict,
  parseCanonicalPersonVersion,
  parseFormat1Envelope,
  wipeBytes,
  type IdentityFields,
  type MetadataContextInput,
} from "@deepfamily/protocol-core";
import { getBigInt, isHexString, type Contract } from "ethers";
import { fundingMetadataSource, loadRebuiltFundingMetadata, readFundingVersionMetadata } from "./fundingRecipientMetadata";
import type { LineageSnapshot } from "./inheritanceChain";

/** Empty and whitespace-only passphrases both prepare to this public family-tree passphrase. */
const PUBLIC_TREE_PASSPHRASE = "";

/** Worker wording for a refused recipient; shieldedUiErrors localizes it by matching this text. */
export const PUBLIC_TREE_RECIPIENT_MESSAGE =
  "The selected child is registered with the empty public family-tree passphrase, so anyone could claim a budget owned by that identity.";
export const PUBLIC_TREE_METADATA_UNAVAILABLE_MESSAGE =
  "The wallet could not verify public family metadata for identity-derived funding.";
export const PUBLIC_TREE_METADATA_UNAVAILABLE_CODE = "SHIELDED_FUNDING_METADATA_UNAVAILABLE";

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
  const personHash = input.personHash.toLowerCase();
  const [source, versionCount] = await Promise.all([
    fundingMetadataSource(input.family, input.chainId, input.blockTag),
    input.family.personVersionsCount(personHash, { blockTag: input.blockTag }),
  ]);
  const count = getBigInt(versionCount);
  if (count < 1n || count > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Recipient identity has no readable registered version");
  for (let versionIndex = 1; versionIndex <= Number(count); versionIndex += 1) {
    const { envelope, context } = await readFundingVersionMetadata(source, personHash, versionIndex);
    if (await isPublicTreeEnvelope(envelope, context, personHash)) return { versionIndex };
  }
  return null;
}

export async function findRebuiltPublicTreeIdentityEvidence(input: {
  family: Contract;
  lineageIndex: Contract;
  chainId: bigint;
  personHash: string;
  lineage: Pick<LineageSnapshot, "blockNumber" | "blockHash" | "versions">;
}): Promise<PublicTreeIdentityEvidence | null> {
  if (!isHexString(input.personHash, 32)) throw new Error("Recipient person hash is invalid");
  const personHash = input.personHash.toLowerCase();
  const { blockNumber, blockHash, versions } = input.lineage;
  const versionIndices = (versions.get(personHash) ?? [])
    .map((version) => version.versionIndex)
    .sort((a, b) => a - b);
  try {
    if (!versionIndices.length) throw new Error("Recipient identity has no readable registered version");
    const metadata = await loadRebuiltFundingMetadata({
      family: input.family,
      lineageIndex: input.lineageIndex,
      chainId: input.chainId,
      blockNumber,
      blockHash,
    }, personHash, versionIndices);
    for (const [index, { envelope, context }] of metadata.entries()) {
      if (await isPublicTreeEnvelope(envelope, context, personHash)) {
        return { versionIndex: versionIndices[index] };
      }
    }
    return null;
  } catch (cause) {
    throw new ProtocolError(
      PUBLIC_TREE_METADATA_UNAVAILABLE_CODE,
      PUBLIC_TREE_METADATA_UNAVAILABLE_MESSAGE,
      { cause },
    );
  }
}

async function isPublicTreeEnvelope(envelope: Uint8Array, context: MetadataContextInput, personHash: string) {
  // The contract bound this header suite to the version's proof.
  const { identitySuiteId } = parseFormat1Envelope(envelope);
  const opened = await openWithPublicTreePassphrase(envelope, context);
  return opened !== null && (await reproducesWithPublicTreePassphrase(opened, identitySuiteId, personHash));
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
