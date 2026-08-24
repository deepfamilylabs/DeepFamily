import type { NodeData } from "../../../../shared/model";

/**
 * Paper layout fixtures that opt into private biography rendering must model
 * the same complete validated cache shape as production. Keeping this helper
 * test-only avoids weakening the runtime predicate merely to support layout
 * fixtures whose focus is pagination rather than cryptographic decoding.
 */
export function withValidatedPaperMetadata(
  nodesData: Record<string, NodeData>,
): Record<string, NodeData> {
  return Object.fromEntries(
    Object.entries(nodesData).map(([id, node]) => {
      if (node.metadataUnlockValidated !== true) return [id, node];
      return [
        id,
        {
          ...node,
          versionCommitment: node.versionCommitment ?? "1",
          metadataPointer: node.metadataPointer ?? `0x${"11".repeat(20)}`,
          metadataPayloadHash: node.metadataPayloadHash ?? `0x${"22".repeat(32)}`,
          metadataPayloadLength: node.metadataPayloadLength ?? 256,
          metadataProtocolGeneration: node.metadataProtocolGeneration ?? "df-onchain-biography-v1",
          metadataFormatVersion: node.metadataFormatVersion ?? 1,
          identitySuiteId: node.identitySuiteId ?? 1,
          metadataPerson: node.metadataPerson ?? {
            fullName: node.fullName ?? "Validated paper fixture",
            gender: node.gender ?? 0,
            birthYear: node.birthYear ?? 0,
            birthMonth: node.birthMonth ?? 0,
            birthDay: node.birthDay ?? 0,
            isBirthBC: node.isBirthBC ?? false,
            personHash: node.personHash,
          },
          metadataParents: node.metadataParents ?? { father: null, mother: null },
          tag: node.tag ?? "",
          biography: node.biography ?? "",
        },
      ];
    }),
  );
}
