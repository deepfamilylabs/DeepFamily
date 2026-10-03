import {
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
} from "@deepfamily/protocol-core";
import { findHeirLegitimacy, type LineageSnapshot } from "./inheritanceChain";
import type { ShieldedRecipientOption } from "./shieldedRecipientOptions";

export type ShieldedFundingParentOption = {
  personHash: string;
  identityCommitment: bigint;
  relation: "father" | "mother";
  latestVersionIndex: number;
  versions: { versionIndex: number; eligible: boolean }[];
};

type FundingFamilyInput = {
  snapshot: LineageSnapshot;
  heirPersonHash: string;
  asOf: bigint;
};

/** Current endorsements determine parents; old, replaced or cancelled leaves cannot add one. */
export function getShieldedFundingFamilyOptions({
  snapshot,
  heirPersonHash,
  asOf,
}: FundingFamilyInput): { parents: ShieldedFundingParentOption[] } {
  const heirHash = heirPersonHash.toLowerCase();
  const heirVersions = snapshot.versions.get(heirHash) ?? [];
  const heirIdentityCommitment = heirVersions[0]?.identityCommitment;
  if (heirIdentityCommitment === undefined) return { parents: [] };

  const parentRelations = new Map<bigint, "father" | "mother">();
  for (const [endorser, endorsement] of snapshot.endorsements.get(heirHash) ?? []) {
    if (endorsement.timestamp > asOf) continue;
    const version = heirVersions.find((item) => item.versionIndex === endorsement.versionIndex);
    if (!version || version.identityCommitment !== heirIdentityCommitment) continue;
    const leaf = computeLineageEndorsementLeaf({
      identityCommitment: heirIdentityCommitment,
      parentsDigest: computeLineageParentsDigest({
        fatherIdentityCommitment: version.fatherIdentityCommitment,
        motherIdentityCommitment: version.motherIdentityCommitment,
      }),
      versionIndex: version.versionIndex,
      endorser,
      writtenAt: endorsement.timestamp,
    });
    if (snapshot.endorsementTree.indexOf(leaf) < 0) continue;
    if (
      version.motherIdentityCommitment !== 0n &&
      !parentRelations.has(version.motherIdentityCommitment)
    ) {
      parentRelations.set(version.motherIdentityCommitment, "mother");
    }
    if (version.fatherIdentityCommitment !== 0n) {
      parentRelations.set(version.fatherIdentityCommitment, "father");
    }
  }

  if (!parentRelations.size) return { parents: [] };

  const parents: ShieldedFundingParentOption[] = [];
  for (const [personHash, versions] of snapshot.versions) {
    const identityCommitment = versions[0]?.identityCommitment;
    if (identityCommitment === undefined) continue;
    const relation = parentRelations.get(identityCommitment);
    if (!relation) continue;
    const orderedVersions = [...versions].sort((a, b) => b.versionIndex - a.versionIndex);
    const latestVersionIndex = orderedVersions[0].versionIndex;
    parents.push({
      personHash,
      identityCommitment,
      relation,
      latestVersionIndex,
      versions: orderedVersions.map(({ versionIndex }) => ({
        versionIndex,
        eligible: findHeirLegitimacy({
          snapshot,
          heir: { personHash: heirHash, identityCommitment: heirIdentityCommitment },
          root: { identityCommitment },
          rootVersionIndex: versionIndex,
        }).some((candidate) => candidate.writtenAt <= asOf),
      })),
    });
  }
  return {
    parents: parents.sort((a, b) =>
      a.relation === b.relation
        ? a.personHash.localeCompare(b.personHash)
        : a.relation === "father"
          ? -1
          : 1,
    ),
  };
}

/** The unlocked parent's own versions, newest first, without choosing one. */
export function listShieldedFundingParentVersions({
  snapshot,
  parentIdentityCommitment,
}: {
  snapshot: LineageSnapshot;
  parentIdentityCommitment: string | bigint;
}): number[] {
  const parentIdentity = BigInt(parentIdentityCommitment);
  const versionIndices = new Set<number>();
  for (const versions of snapshot.versions.values()) {
    for (const version of versions) {
      if (version.identityCommitment === parentIdentity) {
        versionIndices.add(version.versionIndex);
      }
    }
  }
  return [...versionIndices].sort((a, b) => b - a);
}

/**
 * Only confirmed direct children of this parent can be funding candidates.
 * Eligibility always uses the selected parent's exact root version.
 */
export function listShieldedFundingChildren({
  snapshot,
  asOf,
  parentIdentityCommitment,
  rootVersionIndex,
}: {
  snapshot: LineageSnapshot;
  asOf: bigint;
  parentIdentityCommitment: string | bigint;
  rootVersionIndex: number;
}): ShieldedRecipientOption[] {
  const parentIdentity = BigInt(parentIdentityCommitment);
  const candidates: ShieldedRecipientOption[] = [];
  for (const [personHash, versions] of snapshot.versions) {
    // Metadata only narrows the search. Live endorsements and the scoped
    // parent's trusted records still establish eligibility below.
    if (
      !versions.some(
        (version) =>
          version.fatherIdentityCommitment === parentIdentity ||
          version.motherIdentityCommitment === parentIdentity,
      )
    )
      continue;
    const { parents } = getShieldedFundingFamilyOptions({
      snapshot,
      heirPersonHash: personHash,
      asOf,
    });
    const scopedParents = parents.filter((parent) => parent.identityCommitment === parentIdentity);
    if (!scopedParents.length) continue;
    candidates.push({
      personHash,
      eligible: scopedParents.some((parent) =>
        parent.versions.some(
          (version) => version.eligible && version.versionIndex === rootVersionIndex,
        ),
      ),
    });
  }
  return candidates.sort((a, b) => a.personHash.localeCompare(b.personHash));
}
