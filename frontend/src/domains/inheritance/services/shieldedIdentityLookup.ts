import type { Contract, JsonRpcProvider } from "ethers";
import { loadLineageSnapshot } from "./inheritanceChain";
import { discoverShieldedFactoryPools } from "./shieldedAssetRegistry";
import { recoverLocalShieldedWallet, type ShieldedWalletRecoveryInput } from "./shieldedWalletRecovery";

type Candidate = { personHash: string; identityCommitment: bigint; identitySuiteId: number };

export async function lookupFamilyIdentities(
  candidates: readonly Candidate[],
  contracts: { family: Contract; lineageIndex: Contract },
  blockNumber: number,
) {
  const snapshot = await loadLineageSnapshot(contracts.lineageIndex, contracts.family, {
    toBlock: blockNumber,
    selection: {
      versionPersonHashes: candidates.map(entry => entry.personHash),
      referencedParentCommitments: candidates.map(entry => entry.identityCommitment),
    },
  });
  // In-memory snapshots contain all versions. IndexedDB reads only the requested parent links.
  const parents = snapshot.referencedParents ?? new Set(
    [...snapshot.versions.values()].flatMap(versions => versions.flatMap(v => [v.fatherIdentityCommitment, v.motherIdentityCommitment])),
  );
  const matches = candidates.flatMap(({ personHash, identityCommitment, identitySuiteId }) => {
    const versions = snapshot.versions.get(personHash.toLowerCase());
    if (!versions?.length && !parents.has(identityCommitment)) return [];
    if (
      versions?.some(
        (entry) =>
          entry.personHash.toLowerCase() !== personHash.toLowerCase() ||
          entry.identityCommitment !== identityCommitment ||
          entry.identitySuiteId !== identitySuiteId,
      )
    ) {
      throw new Error("Registered identity does not match its lineage record");
    }
    const history: "registered" | "referenced" = versions?.length ? "registered" : "referenced";
    return [{ personHash, identitySuiteId, history }];
  });
  return { matches };
}

/** Private keys stay in the worker. Only verified, locally opened notes count as wallet history. */
export async function findWalletsWithNoteHistory(
  candidates: readonly (Candidate & { keyMaterial: ShieldedWalletRecoveryInput["keyMaterial"] })[],
  env: { factory: Contract; provider: JsonRpcProvider; verifierAddress: string },
  scope: { factoryDeploymentBlock: number; lineageIndexAddress: string; chainId: string },
  anchor: { number: number; hash: string },
  current?: () => void,
) {
  const found = await discoverShieldedFactoryPools(env.factory, env.provider, {
    factoryDeploymentBlock: scope.factoryDeploymentBlock,
    lineageIndexAddress: scope.lineageIndexAddress,
    verifierAddress: env.verifierAddress,
    chainId: BigInt(scope.chainId),
    toBlock: anchor.number,
  });
  current?.();
  if (found.toBlock !== anchor.number || found.blockHash !== anchor.hash)
    throw new Error("Pool history changed during wallet lookup");
  if (!found.enumerationComplete) throw new Error("Incomplete pool history during wallet lookup");
  const matches = new Set<number>();
  for (const item of found.pools) {
    if (matches.size === candidates.length) break;
    if (!item.configurationVerified || !item.pool || item.poolDeploymentBlock === undefined)
      throw new Error("Unverified pool during wallet lookup");
    for (const candidate of candidates) {
      if (matches.has(candidate.identitySuiteId)) continue;
      const wallet = await recoverLocalShieldedWallet(
        item.pool,
        { keyMaterial: candidate.keyMaterial, identityCommitment: candidate.identityCommitment },
        { fromBlock: item.poolDeploymentBlock, toBlock: anchor.number },
      );
      current?.();
      if (wallet.invalidated || wallet.toBlock !== anchor.number || wallet.blockHash !== anchor.hash)
        throw new Error("Pool history changed during wallet lookup");
      if (wallet.ownedNotes.size) matches.add(candidate.identitySuiteId);
    }
  }
  return matches;
}
