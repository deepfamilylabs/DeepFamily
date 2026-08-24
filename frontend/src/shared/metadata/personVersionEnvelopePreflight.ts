import {
  DFM1_FORMAT_1_HEADER_BYTES,
  DFM1_FORMAT_1_OVERHEAD_BYTES,
  compressPersonVersionContent,
  serializeCanonicalPersonVersion,
  wipeBytes,
  type PersonVersionMetadataInput,
} from "@deepfamily/protocol-core";

export interface PersonVersionEnvelopeSizePreflightV1Result {
  canonicalJsonLength: number;
  compressedPlaintextLength: number;
  envelopeLength: number;
}

/**
 * Performs deterministic gzip-v1 sizing after the duplicate-commitment RPC
 * preflight and before Groth16. Format 1 has a 112-byte header and a 16-byte
 * content GCM tag; AES-GCM ciphertext has the same length as the compressed
 * plaintext, so this envelope length is exact before encryption randomness is
 * generated.
 */
export function preflightPersonVersionEnvelopeSizeV1(
  metadata: PersonVersionMetadataInput,
): PersonVersionEnvelopeSizePreflightV1Result {
  if (DFM1_FORMAT_1_OVERHEAD_BYTES !== DFM1_FORMAT_1_HEADER_BYTES + 16) {
    throw new Error("DFM1 format-1 overhead constants are inconsistent");
  }

  const canonicalJsonBytes = serializeCanonicalPersonVersion(metadata);
  let compressedPlaintext: Uint8Array | undefined;
  try {
    // This throws ENVELOPE_TOO_LARGE before any Groth16 or encryption work.
    compressedPlaintext = compressPersonVersionContent(canonicalJsonBytes);
    return {
      canonicalJsonLength: canonicalJsonBytes.length,
      compressedPlaintextLength: compressedPlaintext.length,
      envelopeLength: DFM1_FORMAT_1_OVERHEAD_BYTES + compressedPlaintext.length,
    };
  } finally {
    wipeBytes(compressedPlaintext);
    wipeBytes(canonicalJsonBytes);
  }
}
