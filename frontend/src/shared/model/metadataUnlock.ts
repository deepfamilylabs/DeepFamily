import { DFM1_MAX_ENVELOPE_BYTES } from "@deepfamily/protocol-core";
import type {
  MetadataParentDisplay,
  MetadataParentsDisplay,
  MetadataPersonDisplay,
  NodeData,
} from "./graph";

export const METADATA_CACHE_PROTOCOL_GENERATION = "df-onchain-biography-v1";

export interface MetadataUnlockAnchors {
  personHash: string;
  versionIndex: number;
  versionCommitment: string;
  metadataPointer: string;
  metadataPayloadHash: string;
  metadataPayloadLength: number;
}

export interface ValidatedMetadataUnlock {
  person: MetadataPersonDisplay;
  parents: MetadataParentsDisplay;
  tag: string;
  biography: string;
  formatVersion: number;
  identitySuiteId: number;
}

const sameHex = (left: string | undefined, right: string | undefined): boolean =>
  typeof left === "string" &&
  typeof right === "string" &&
  left.toLowerCase() === right.toLowerCase();

const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_HEX = /^0x[0-9a-fA-F]{40}$/;
const CANONICAL_UNSIGNED_DECIMAL = /^(0|[1-9][0-9]*)$/;

const copyPerson = (person: MetadataPersonDisplay): MetadataPersonDisplay => ({
  fullName: person.fullName,
  gender: person.gender,
  birthYear: person.birthYear,
  birthMonth: person.birthMonth,
  birthDay: person.birthDay,
  isBirthBC: person.isBirthBC,
  personHash: person.personHash,
});

const copyParent = (parent: MetadataParentDisplay | null): MetadataParentDisplay | null =>
  parent === null ? null : { ...copyPerson(parent), versionIndex: parent.versionIndex };

export function metadataAnchorsMatch(
  node: Pick<
    NodeData,
    | "personHash"
    | "versionIndex"
    | "versionCommitment"
    | "metadataPointer"
    | "metadataPayloadHash"
    | "metadataPayloadLength"
  >,
  anchors: MetadataUnlockAnchors,
): boolean {
  return (
    sameHex(node.personHash, anchors.personHash) &&
    node.versionIndex === anchors.versionIndex &&
    node.versionCommitment === anchors.versionCommitment &&
    sameHex(node.metadataPointer, anchors.metadataPointer) &&
    sameHex(node.metadataPayloadHash, anchors.metadataPayloadHash) &&
    node.metadataPayloadLength === anchors.metadataPayloadLength
  );
}

export function isMetadataUnlockUsable(node: NodeData | undefined): boolean {
  return Boolean(
    node?.metadataUnlockValidated === true &&
    node.metadataProtocolGeneration === METADATA_CACHE_PROTOCOL_GENERATION &&
    Number.isSafeInteger(node.versionIndex) &&
    node.versionIndex > 0 &&
    BYTES32_HEX.test(node.personHash) &&
    typeof node.versionCommitment === "string" &&
    CANONICAL_UNSIGNED_DECIMAL.test(node.versionCommitment) &&
    typeof node.metadataPointer === "string" &&
    ADDRESS_HEX.test(node.metadataPointer) &&
    typeof node.metadataPayloadHash === "string" &&
    BYTES32_HEX.test(node.metadataPayloadHash) &&
    Number.isSafeInteger(node.metadataPayloadLength) &&
    node.metadataPayloadLength! > 0 &&
    node.metadataPayloadLength! <= DFM1_MAX_ENVELOPE_BYTES &&
    Number.isSafeInteger(node.metadataFormatVersion) &&
    node.metadataFormatVersion! > 0 &&
    Number.isSafeInteger(node.identitySuiteId) &&
    node.identitySuiteId! > 0 &&
    node.metadataPerson &&
    sameHex(node.metadataPerson.personHash, node.personHash) &&
    typeof node.metadataPerson.fullName === "string" &&
    node.metadataPerson.fullName.length > 0 &&
    node.metadataParents &&
    typeof node.tag === "string" &&
    typeof node.biography === "string",
  );
}

/** Detects any private unlock state that must be physically removed on anchor changes. */
export function hasMetadataUnlockFootprint(node: NodeData | undefined): boolean {
  return Boolean(
    node &&
    (node.metadataUnlockValidated !== undefined ||
      node.metadataProtocolGeneration !== undefined ||
      node.metadataFormatVersion !== undefined ||
      node.identitySuiteId !== undefined ||
      node.metadataPerson !== undefined ||
      node.metadataParents !== undefined ||
      node.tag !== undefined ||
      node.biography !== undefined),
  );
}

export function mergeValidatedMetadataUnlock(
  node: NodeData,
  anchors: MetadataUnlockAnchors,
  unlocked: ValidatedMetadataUnlock,
): NodeData {
  if (!metadataAnchorsMatch(node, anchors)) {
    throw new Error("Refusing to cache metadata whose public anchors do not match NodeData");
  }
  if (!sameHex(unlocked.person.personHash, node.personHash)) {
    throw new Error("Refusing to cache metadata for another person");
  }
  if (!Number.isInteger(unlocked.formatVersion) || unlocked.formatVersion <= 0) {
    throw new Error("Validated metadata formatVersion must be a positive integer");
  }
  if (!Number.isInteger(unlocked.identitySuiteId) || unlocked.identitySuiteId <= 0) {
    throw new Error("Validated metadata identitySuiteId must be a positive integer");
  }

  return {
    ...node,
    fullName: unlocked.person.fullName,
    gender: unlocked.person.gender,
    birthYear: unlocked.person.birthYear,
    birthMonth: unlocked.person.birthMonth,
    birthDay: unlocked.person.birthDay,
    isBirthBC: unlocked.person.isBirthBC,
    tag: unlocked.tag,
    biography: unlocked.biography,
    metadataPerson: copyPerson(unlocked.person),
    metadataParents: {
      father: copyParent(unlocked.parents.father),
      mother: copyParent(unlocked.parents.mother),
    },
    metadataFormatVersion: unlocked.formatVersion,
    identitySuiteId: unlocked.identitySuiteId,
    metadataProtocolGeneration: METADATA_CACHE_PROTOCOL_GENERATION,
    metadataUnlockValidated: true,
  };
}

export function rebaseValidatedMetadataUnlock(current: NodeData, unlocked: NodeData): NodeData {
  if (!isMetadataUnlockUsable(unlocked)) {
    throw new Error("Only a fully validated metadata unlock may be committed");
  }

  return mergeValidatedMetadataUnlock(
    current,
    {
      personHash: unlocked.personHash,
      versionIndex: unlocked.versionIndex,
      versionCommitment: unlocked.versionCommitment!,
      metadataPointer: unlocked.metadataPointer!,
      metadataPayloadHash: unlocked.metadataPayloadHash!,
      metadataPayloadLength: unlocked.metadataPayloadLength!,
    },
    {
      person: unlocked.metadataPerson!,
      parents: unlocked.metadataParents!,
      tag: unlocked.tag!,
      biography: unlocked.biography!,
      formatVersion: unlocked.metadataFormatVersion!,
      identitySuiteId: unlocked.identitySuiteId!,
    },
  );
}

export function clearMetadataUnlock(node: NodeData): NodeData {
  const next = { ...node };
  delete next.tag;
  delete next.biography;
  delete next.metadataPerson;
  delete next.metadataParents;
  delete next.metadataFormatVersion;
  delete next.identitySuiteId;
  delete next.metadataProtocolGeneration;
  // For an unminted version these display fields came only from decrypted
  // metadata. Minted versions have an independently public NFT core and keep it.
  if (!next.tokenId || String(next.tokenId) === "0") {
    delete next.fullName;
    delete next.gender;
    delete next.birthYear;
    delete next.birthMonth;
    delete next.birthDay;
    delete next.isBirthBC;
  }
  next.metadataUnlockValidated = false;
  return next;
}

export function clearAllMetadataUnlocks(nodes: Record<string, NodeData>): Record<string, NodeData> {
  return Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => [
      id,
      hasMetadataUnlockFootprint(node) ? clearMetadataUnlock(node) : node,
    ]),
  );
}

export function sanitizeHydratedMetadataUnlocks(
  nodes: Record<string, NodeData>,
): Record<string, NodeData> {
  return Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => [
      id,
      !hasMetadataUnlockFootprint(node) || isMetadataUnlockUsable(node)
        ? node
        : clearMetadataUnlock(node),
    ]),
  );
}
