import {
  PROTOCOL_GENERATION,
  assembleFormat1Envelope,
  concatBytes,
} from "@deepfamily/protocol-core";
import { keccak256 } from "ethers";
import { describe, expect, it, vi } from "vitest";
import type { NodeData } from "../model/graph";
import {
  readPersonVersionEnvelope,
  unlockPersonVersionNode,
  type PersonVersionEnvelopeDecryptor,
} from "./metadataArchiveService";

const PERSON_HASH = `0x${"11".repeat(32)}`;
const POINTER = `0x${"22".repeat(20)}`;
const VERSION_COMMITMENT = "123456";
const PROXY = `0x${"33".repeat(20)}`;

const format1Envelope = (): Uint8Array =>
  assembleFormat1Envelope({
    identitySuiteId: 1,
    fileSalt: new Uint8Array(16).fill(1),
    wrapIV: new Uint8Array(12).fill(2),
    contentIV: new Uint8Array(12).fill(3),
    wrappedDEK: new Uint8Array(32).fill(4),
    wrappedDEKTag: new Uint8Array(16).fill(5),
    contentCiphertext: new Uint8Array([6]),
    contentTag: new Uint8Array(16).fill(7),
  });

const nodeForEnvelope = (envelope: Uint8Array): NodeData => ({
  id: `${PERSON_HASH}-v-1`,
  personHash: PERSON_HASH,
  versionIndex: 1,
  versionCommitment: VERSION_COMMITMENT,
  metadataPointer: POINTER,
  metadataPayloadHash: keccak256(envelope),
  metadataPayloadLength: envelope.length,
});

describe("metadata Archive read/decrypt service", () => {
  it("validates STOP/length/hash/header before returning an envelope", async () => {
    const envelope = format1Envelope();
    const getCode = vi.fn(async () => concatBytes(Uint8Array.of(0), envelope));
    const read = await readPersonVersionEnvelope({
      node: nodeForEnvelope(envelope),
      chainId: 71,
      deepFamilyProxy: PROXY,
      getCode,
    });

    expect(getCode).toHaveBeenCalledWith(POINTER, "latest");
    expect(read.formatVersion).toBe(1);
    expect(read.identitySuiteId).toBe(1);
    expect(read.context).toMatchObject({
      chainId: 71,
      deepFamilyProxy: PROXY,
      personHash: PERSON_HASH,
      versionCommitment: VERSION_COMMITMENT,
    });
  });

  it("merges only a fully validated plaintext DTO, including empty tag and biography", async () => {
    const envelope = format1Envelope();
    const node = nodeForEnvelope(envelope);
    const decryptEnvelope: PersonVersionEnvelopeDecryptor = vi.fn(async () => ({
      metadata: {
        schema: "deepfamily/person-version@1.0" as const,
        person: {
          fullName: "Alice",
          gender: 2,
          birthYear: 1980,
          birthMonth: 1,
          birthDay: 2,
          isBirthBC: false,
          personHash: PERSON_HASH,
        },
        parents: { father: null, mother: null },
        tag: "",
        biography: "",
      },
      formatVersion: 1 as const,
      identitySuiteId: 1,
      payloadHash: node.metadataPayloadHash!,
      versionCommitment: VERSION_COMMITMENT,
      metadataUnlockValidated: true as const,
      protocolGeneration: PROTOCOL_GENERATION,
    }));

    const unlocked = await unlockPersonVersionNode({
      node,
      chainId: 71,
      deepFamilyProxy: PROXY,
      getCode: async () => concatBytes(Uint8Array.of(0), envelope),
      rawPassphrase: "not-persisted",
      decryptEnvelope,
    });

    expect(decryptEnvelope).toHaveBeenCalledOnce();
    expect(unlocked).toMatchObject({
      tag: "",
      biography: "",
      metadataUnlockValidated: true,
      metadataProtocolGeneration: PROTOCOL_GENERATION,
      metadataFormatVersion: 1,
      identitySuiteId: 1,
      metadataPerson: { fullName: "Alice", personHash: PERSON_HASH },
      metadataParents: { father: null, mother: null },
    });
    expect(JSON.stringify(unlocked)).not.toContain("not-persisted");
  });

  it("fails closed on an unknown format before invoking the decrypt/KDF worker", async () => {
    const unknown = new Uint8Array(20);
    unknown.set(new TextEncoder().encode("DFM1"), 0);
    unknown[4] = 2;
    unknown[19] = 1; // uint32 big-endian self identitySuiteId = 1
    const decryptEnvelope = vi.fn<PersonVersionEnvelopeDecryptor>();

    await expect(
      unlockPersonVersionNode({
        node: nodeForEnvelope(unknown),
        chainId: 71,
        deepFamilyProxy: PROXY,
        getCode: async () => concatBytes(Uint8Array.of(0), unknown),
        rawPassphrase: "must-never-reach-kdf",
        decryptEnvelope,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ENVELOPE_FORMAT" });
    expect(decryptEnvelope).not.toHaveBeenCalled();
  });

  it("rejects an Archive payloadHash mismatch before invoking the decrypt worker", async () => {
    const envelope = format1Envelope();
    const node = { ...nodeForEnvelope(envelope), metadataPayloadHash: `0x${"ff".repeat(32)}` };
    const decryptEnvelope = vi.fn<PersonVersionEnvelopeDecryptor>();

    await expect(
      unlockPersonVersionNode({
        node,
        chainId: 71,
        deepFamilyProxy: PROXY,
        getCode: async () => concatBytes(Uint8Array.of(0), envelope),
        rawPassphrase: "must-never-reach-kdf",
        decryptEnvelope,
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_HASH_MISMATCH" });
    expect(decryptEnvelope).not.toHaveBeenCalled();
  });
});
