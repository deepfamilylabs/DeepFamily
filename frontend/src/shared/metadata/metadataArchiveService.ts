import {
  PROTOCOL_GENERATION,
  ZERO_BYTES32,
  bytesToHex,
  parseMetadataEnvelope,
  readMetadataEnvelopeFromRef,
  type BigNumberish,
  type BytesLike,
  type MetadataContextInput,
} from "@deepfamily/protocol-core";
import type { NodeData } from "../model/graph";
import {
  mergeValidatedMetadataUnlock,
  type MetadataUnlockAnchors,
  type ValidatedMetadataUnlock,
} from "../model/metadataUnlock";
import {
  cryptoWorkerCall,
  type ValidatedPersonVersionV1Result,
} from "../workers/cryptoWorkerClient";

export type MetadataCodeReader = (
  pointer: string,
  blockTag: "latest",
) => Promise<BytesLike>;

export interface ReadPersonVersionEnvelopeInput {
  node: NodeData;
  chainId: BigNumberish;
  deepFamilyProxy: string;
  getCode: MetadataCodeReader;
}

export interface ReadPersonVersionEnvelopeResult {
  anchors: MetadataUnlockAnchors;
  context: MetadataContextInput;
  envelopeHex: string;
  formatVersion: number;
  identitySuiteId: number;
}

export interface DecryptPersonVersionEnvelopeV1Params {
  envelopeHex: string;
  rawPassphrase: string;
  context: MetadataContextInput;
}

export type PersonVersionEnvelopeDecryptor = (
  params: DecryptPersonVersionEnvelopeV1Params,
) => Promise<ValidatedPersonVersionV1Result>;

export interface UnlockPersonVersionNodeInput extends ReadPersonVersionEnvelopeInput {
  rawPassphrase: string;
  signal?: AbortSignal;
  decryptEnvelope?: PersonVersionEnvelopeDecryptor;
}

export class MetadataUnlockCancelledError extends Error {
  constructor() {
    super("Metadata unlock cancelled");
    this.name = "MetadataUnlockCancelledError";
  }
}

const requireNonemptyString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is required before metadata can be read`);
  }
  return value;
};

const requireVersionIndex = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error("A positive, safe versionIndex is required before metadata can be read");
  }
  return Number(value);
};

const assertNotCancelled = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new MetadataUnlockCancelledError();
};

const parentVersionIndex = (
  hash: string,
  value: NodeData["fatherVersionIndex"] | NodeData["motherVersionIndex"],
): BigNumberish => {
  if (hash.toLowerCase() === ZERO_BYTES32) return value ?? 0;
  if (value === undefined || value === null || value === "") {
    throw new Error("A non-null parent reference requires its chain versionIndex");
  }
  return value;
};

export function metadataUnlockAnchorsFromNode(node: NodeData): MetadataUnlockAnchors {
  const versionIndex = requireVersionIndex(node.versionIndex);
  const payloadLength = node.metadataPayloadLength;
  if (!Number.isSafeInteger(payloadLength) || Number(payloadLength) < 1) {
    throw new Error("A positive metadata payloadLength is required before metadata can be read");
  }
  return {
    personHash: requireNonemptyString(node.personHash, "personHash"),
    versionIndex,
    versionCommitment: requireNonemptyString(node.versionCommitment, "versionCommitment"),
    metadataPointer: requireNonemptyString(node.metadataPointer, "metadata pointer"),
    metadataPayloadHash: requireNonemptyString(node.metadataPayloadHash, "metadata payloadHash"),
    metadataPayloadLength: Number(payloadLength),
  };
}

export function metadataContextFromNode(
  node: NodeData,
  chainId: BigNumberish,
  deepFamilyProxy: string,
): MetadataContextInput {
  const anchors = metadataUnlockAnchorsFromNode(node);
  const fatherHash = node.fatherHash || ZERO_BYTES32;
  const motherHash = node.motherHash || ZERO_BYTES32;
  return {
    chainId,
    deepFamilyProxy,
    personHash: anchors.personHash,
    fatherHash,
    fatherVersionIndex: parentVersionIndex(fatherHash, node.fatherVersionIndex),
    motherHash,
    motherVersionIndex: parentVersionIndex(motherHash, node.motherVersionIndex),
    versionCommitment: anchors.versionCommitment,
  };
}

/**
 * Reads and authenticates the public data-contract bytes without accepting a
 * passphrase. Strict format dispatch is deliberately completed here, so an
 * unknown format/suite fails before the caller shows a passphrase prompt or
 * starts a KDF worker job.
 */
export async function readPersonVersionEnvelope(
  input: ReadPersonVersionEnvelopeInput,
): Promise<ReadPersonVersionEnvelopeResult> {
  const anchors = metadataUnlockAnchorsFromNode(input.node);
  const context = metadataContextFromNode(input.node, input.chainId, input.deepFamilyProxy);
  const verified = await readMetadataEnvelopeFromRef({
    getCode: input.getCode,
    pointer: anchors.metadataPointer,
    payloadLength: anchors.metadataPayloadLength,
    payloadHash: anchors.metadataPayloadHash,
  });

  // readMetadataEnvelopeFromRef validates STOP/length/hash/common prefix.
  // This second dispatch performs every format-1 selector/header check and
  // rejects unknown formats before any passphrase enters a worker message.
  const parsed = parseMetadataEnvelope(verified.envelope);
  return {
    anchors,
    context,
    envelopeHex: bytesToHex(verified.envelope),
    formatVersion: parsed.formatVersion,
    identitySuiteId: parsed.identitySuiteId,
  };
}

const defaultDecryptEnvelope: PersonVersionEnvelopeDecryptor = (params) =>
  cryptoWorkerCall("decryptPersonVersionEnvelopeV1", params);

const equalHex = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase();

const toValidatedMetadataUnlock = (
  result: ValidatedPersonVersionV1Result,
): ValidatedMetadataUnlock => ({
  person: { ...result.metadata.person },
  parents: {
    father: result.metadata.parents.father ? { ...result.metadata.parents.father } : null,
    mother: result.metadata.parents.mother ? { ...result.metadata.parents.mother } : null,
  },
  tag: result.metadata.tag,
  biography: result.metadata.biography,
  formatVersion: result.formatVersion,
  identitySuiteId: result.identitySuiteId,
});

/**
 * Performs the complete production read/decrypt/semantic-validation path and
 * only then merges the whitelisted plaintext display DTO into NodeData.
 */
export async function unlockPersonVersionNode(
  input: UnlockPersonVersionNodeInput,
): Promise<NodeData> {
  assertNotCancelled(input.signal);
  const read = await readPersonVersionEnvelope(input);
  assertNotCancelled(input.signal);

  const decryptEnvelope = input.decryptEnvelope ?? defaultDecryptEnvelope;
  const validated = await decryptEnvelope({
    envelopeHex: read.envelopeHex,
    rawPassphrase: input.rawPassphrase,
    context: read.context,
  });
  assertNotCancelled(input.signal);

  if (
    validated.metadataUnlockValidated !== true ||
    validated.protocolGeneration !== PROTOCOL_GENERATION
  ) {
    throw new Error("Metadata decoder did not return a validated v1 result");
  }
  if (!equalHex(validated.payloadHash, read.anchors.metadataPayloadHash)) {
    throw new Error("Decoded payloadHash does not match the Archive reference");
  }
  if (BigInt(validated.versionCommitment) !== BigInt(read.anchors.versionCommitment)) {
    throw new Error("Decoded versionCommitment does not match the chain version");
  }
  if (
    validated.formatVersion !== read.formatVersion ||
    validated.identitySuiteId !== read.identitySuiteId
  ) {
    throw new Error("Decoded metadata header differs from the preflighted envelope header");
  }

  return mergeValidatedMetadataUnlock(
    input.node,
    read.anchors,
    toValidatedMetadataUnlock(validated),
  );
}
