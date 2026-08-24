import {
  DFM1_FORMAT_1_HEADER_BYTES,
  DFM1_FORMAT_1_OVERHEAD_BYTES,
  DFM1_MAX_ENVELOPE_BYTES,
  PERSON_VERSION_SCHEMA,
  ProtocolError,
  compressPersonVersionContent,
  serializeCanonicalPersonVersion,
  type PersonVersionMetadataInput,
} from "@deepfamily/protocol-core";
import { describe, expect, it } from "vitest";
import { preflightPersonVersionEnvelopeSizeV1 } from "./personVersionEnvelopePreflight";

const PERSON_HASH = `0x${"11".repeat(32)}`;

function metadata(biography = "A private biography"): PersonVersionMetadataInput {
  return {
    schema: PERSON_VERSION_SCHEMA,
    person: {
      fullName: "Ada Lovelace",
      gender: 2,
      birthYear: 1815,
      birthMonth: 12,
      birthDay: 10,
      isBirthBC: false,
      personHash: PERSON_HASH,
    },
    parents: { father: null, mother: null },
    tag: "verified",
    biography,
  };
}

function deterministicHighEntropyText(length: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let state = 0x9e37_79b9;
  let output = "";
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    output += alphabet[(state >>> 0) & 63];
  }
  return output;
}

describe("person-version envelope size preflight", () => {
  it("returns the exact format-1 envelope length before encryption", () => {
    const value = metadata();
    const canonical = serializeCanonicalPersonVersion(value);
    const compressed = compressPersonVersionContent(canonical);

    const result = preflightPersonVersionEnvelopeSizeV1(value);

    expect(DFM1_FORMAT_1_OVERHEAD_BYTES).toBe(DFM1_FORMAT_1_HEADER_BYTES + 16);
    expect(result.canonicalJsonLength).toBe(canonical.length);
    expect(result.compressedPlaintextLength).toBe(compressed.length);
    expect(result.envelopeLength).toBe(DFM1_FORMAT_1_OVERHEAD_BYTES + compressed.length);
  });

  it("rejects compressed content that cannot fit in the 16 KiB envelope", () => {
    const run = () =>
      preflightPersonVersionEnvelopeSizeV1(metadata(deterministicHighEntropyText(30_000)));

    expect(run).toThrowError(ProtocolError);
    try {
      run();
      throw new Error("expected envelope size preflight to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "ENVELOPE_TOO_LARGE" });
      expect((error as Error).message).toContain(String(DFM1_MAX_ENVELOPE_BYTES));
    }
  });
});
