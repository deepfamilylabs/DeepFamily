import {
  deriveIdentityMaterial,
  deriveShieldedHeirKeyMaterial,
  SUPPORTED_IDENTITY_SUITE_IDS,
  wipeBytes,
  type IdentityFields,
} from "@deepfamily/protocol-core";
import { getAddress, getBytes, ZeroAddress, type Contract, type JsonRpcProvider } from "ethers";
import {
  createDeepFamilyContract,
  createLineageIndexContract,
  createShieldedPoolFactoryContract,
} from "../shared/clients/contractFactory";
import { getReadonlyProvider } from "../shared/clients/providerRegistry";
import {
  getShieldedPoolFactoryAddress,
  getShieldedPoolFactoryDeploymentBlock,
} from "../shared/config/env";
import {
  findWalletsWithNoteHistory,
  lookupFamilyIdentities,
} from "../domains/inheritance/services/shieldedIdentityLookup";
import type {
  CryptoWorkerCallMap,
  PersonIdentityCandidate,
} from "../shared/workers/cryptoWorkerClient";

type DiscoveryContext = {
  family: Contract;
  lineageIndex: Contract;
  provider: JsonRpcProvider;
  pools?: {
    factory: Contract;
    verifierAddress: string;
    lineageIndexAddress: string;
    factoryDeploymentBlock: number;
    chainId: string;
  };
};

type DerivedCandidate = {
  identitySuiteId: number;
  personHash: string;
  identityCommitment: bigint;
  keyMaterial?: { ownerSecret: bigint; ownerCommitment: bigint; hpkeIkm: Uint8Array; keyMode: 0 };
};

async function readIdentityHistory(
  candidates: DerivedCandidate[],
  env: DiscoveryContext,
  previousPersonHash?: string,
  current?: () => void,
) {
  const blockNumber = await env.provider.getBlockNumber();
  const anchor = await env.provider.getBlock(blockNumber);
  if (!anchor?.hash) throw new Error("Identity lookup block is unavailable");
  const { matches } = await lookupFamilyIdentities(candidates, env, blockNumber);
  const history = new Map<number, PersonIdentityCandidate["history"]>(
    matches.map(item => [item.identitySuiteId, item.history]),
  );
  const previous = candidates.find(item => item.personHash === previousPersonHash);
  if (previous && !history.has(previous.identitySuiteId)) history.set(previous.identitySuiteId, "used");
  if (env.pools) {
    const remaining = candidates.flatMap(item =>
      item.keyMaterial && !history.has(item.identitySuiteId) ? [{ ...item, keyMaterial: item.keyMaterial }] : [],
    );
    if (remaining.length) {
      const used = await findWalletsWithNoteHistory(
        remaining,
        { ...env.pools, provider: env.provider },
        env.pools,
        { number: blockNumber, hash: anchor.hash },
        current,
      );
      for (const id of used) history.set(id, "used");
    }
  }
  if ((await env.provider.getBlock(blockNumber))?.hash !== anchor.hash)
    throw new Error("Identity lookup block changed");
  return history;
}

/** Both form previews and wallet unlock compare candidates locally at one block. */
export async function discoverIdentityCandidates(
  input: { identity: IdentityFields; rawPassphrase: string; previousPersonHash?: string },
  context: () => Promise<DiscoveryContext>,
  purpose: "record" | "wallet",
  current?: () => void,
): Promise<PersonIdentityCandidate[]> {
  const candidates: DerivedCandidate[] = [];
  try {
    for (const identitySuiteId of SUPPORTED_IDENTITY_SUITE_IDS) {
      current?.();
      const material = await deriveIdentityMaterial({
        identity: input.identity,
        rawPassphrase: input.rawPassphrase,
        identitySuiteId,
      });
      try {
        const candidate: DerivedCandidate = {
          identitySuiteId,
          personHash: material.personHash,
          identityCommitment: material.identityCommitment,
        };
        candidates.push(candidate);
        if (SUPPORTED_IDENTITY_SUITE_IDS.length > 1) {
          const { ownerSecret, ownerCommitment, hpkeIkm } = deriveShieldedHeirKeyMaterial(
            material.derivedSecretField,
          );
          candidate.keyMaterial = {
            ownerSecret,
            ownerCommitment,
            hpkeIkm: getBytes(hpkeIkm),
            keyMode: 0,
          };
        }
      } finally {
        wipeBytes(material.derivedSecretBytes);
        wipeBytes(material.identitySalt);
      }
    }
    input.rawPassphrase = "";
    current?.();
    let history: Map<number, PersonIdentityCandidate["history"]> | undefined;
    try {
      history = await readIdentityHistory(candidates, await context(), input.previousPersonHash, current);
    } catch (error) {
      // Auto-unlock needs a complete scan to decide which wallet to open.
      // A family form already has an explicit suite and can use its local hash.
      if (purpose === "wallet") throw error;
    }
    current?.();
    return candidates.map(({ identitySuiteId, personHash }) => ({
      identitySuiteId,
      personHash,
      history: history ? history.get(identitySuiteId) ?? "none" : "unavailable",
    }));
  } finally {
    input.rawPassphrase = "";
    for (const candidate of candidates) {
      if (candidate.keyMaterial) wipeBytes(candidate.keyMaterial.hpkeIkm);
    }
  }
}

export async function findPersonIdentities(
  input: CryptoWorkerCallMap["findPersonIdentities"]["params"],
) {
  const { rpcUrl, chainId, familyAddress } = input.context;
  return discoverIdentityCandidates(input, async () => {
    const provider = getReadonlyProvider(rpcUrl, chainId);
    if ((await provider.getNetwork()).chainId !== BigInt(chainId))
      throw new Error("Identity lookup chain mismatch");
    const family = createDeepFamilyContract(familyAddress, provider);
    const lineageIndexAddress = getAddress(await family.lineageIndex());
    const lineageIndex = createLineageIndexContract(lineageIndexAddress, provider);
    const factoryAddress = getShieldedPoolFactoryAddress(chainId);
    if (!factoryAddress || getAddress(factoryAddress) === ZeroAddress)
      return { provider, family, lineageIndex };
    const factory = createShieldedPoolFactoryContract(factoryAddress, provider);
    const verifierAddress = getAddress(await factory.VERIFIER());
    return {
      provider,
      family,
      lineageIndex,
      pools: {
        factory,
        verifierAddress,
        lineageIndexAddress,
        factoryDeploymentBlock: getShieldedPoolFactoryDeploymentBlock(chainId),
        chainId: String(chainId),
      },
    };
  }, "record");
}
