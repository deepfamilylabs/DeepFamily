import type { Contract } from "ethers";
import { loadLineageSnapshot } from "./inheritanceChain";

type Candidate = { personHash: string; identityCommitment: bigint; identitySuiteId: number };

export async function lookupRegisteredShieldedIdentities(
  candidates: readonly Candidate[],
  contracts: { family: Contract; lineageIndex: Contract },
  blockNumber: number,
) {
  const snapshot = await loadLineageSnapshot(contracts.lineageIndex, contracts.family, {
    toBlock: blockNumber,
    selection: { versionPersonHashes: candidates.map((entry) => entry.personHash) },
  });
  const matches = candidates.flatMap(({ personHash, identityCommitment, identitySuiteId }) => {
    const versions = snapshot.versions.get(personHash.toLowerCase());
    if (!versions?.length) return [];
    if (
      versions.some(
        (entry) =>
          entry.personHash.toLowerCase() !== personHash.toLowerCase() ||
          entry.identityCommitment !== identityCommitment ||
          entry.identitySuiteId !== identitySuiteId,
      )
    ) {
      throw new Error("Registered identity does not match its lineage record");
    }
    return [{ personHash, identitySuiteId }];
  });
  return { matches };
}
