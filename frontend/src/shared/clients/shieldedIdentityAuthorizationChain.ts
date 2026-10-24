import {
  createShieldedIdentityAuthorizationTree,
  bigintFrom,
  SNARK_SCALAR_FIELD,
  verifyShieldedIdentityAuthorizationWitness,
  type ShieldedIdentityAuthorizationState,
  type ShieldedIdentityAuthorizationWitness,
} from "@deepfamily/protocol-core";
import {
  Contract,
  getAddress,
  type BigNumberish,
  type ContractRunner,
  type Provider,
} from "ethers";
import { getEventScanConfig } from "../config/env";
import { hasPersistentPublicStateStorage } from "./publicStateStore";
import { loadPersistedIdentityAuthorizationWitness } from "./persistedIdentityAuthorization";
import {
  normalizeShieldedStateReadMode,
  type ShieldedStateReadMode,
} from "../config/shieldedStateReadMode";

export const IDENTITY_AUTHORIZATION_ABI = [
  "function creationBlock() view returns (uint256)",
  "function currentCheckpointId() view returns (uint256)",
  "function currentRoot() view returns (uint256)",
  "function getCheckpoint(uint256) view returns (tuple(uint256 root,uint64 createdAt,uint64 retiredAt))",
  "function validateCheckpoint(uint256,uint64) view returns (uint256)",
  "function getCounterProof(uint256 aliasR) view returns (tuple(uint64 authorizationCounter,uint256 stateRoot,uint256 depth,uint256[64] siblings,uint256 oldKey,uint64 oldValue,bool isOld0,bool absent))",
  "function getStateSnapshotHeader() view returns (tuple(uint256 formatVersion,uint64 rootNodeId,uint64 nodeCount,uint256 root,uint256 checkpointId))",
  "function getNodePage(uint256 startId,uint256 limit) view returns (tuple(uint256 hash,uint256 key,uint64 counter,uint64 left,uint64 right)[])",
  "function incrementCounter(uint256 authorizationNullifier,uint256 aliasR,uint64 oldCounter,uint64 newCounter,bytes proof)",
  "event CounterIncremented(uint256 indexed checkpointId,uint256 indexed aliasR,uint64 oldCounter,uint64 newCounter,uint256 oldRoot,uint256 newRoot,uint256 authorizationNullifier)",
] as const;

type AuthorizationTree = ReturnType<typeof createShieldedIdentityAuthorizationTree>;
type VerifiedReplay = {
  tree: AuthorizationTree;
  blockNumber: number;
  blockHash: string;
  checkpointId: bigint;
};
type ReplayCache = { sequence: number; published: number; replay?: VerifiedReplay };

// Only public state lives here. Every use rechecks its chain anchor and the latest
// on-chain root; returned snapshots never expose the cached mutable mirror.
const replays = new WeakMap<Provider, Map<string, ReplayCache>>();

export type ShieldedIdentityAuthorizationScope = {
  chainId: BigNumberish;
  authorizationStateAddress: string;
};

export function createIdentityAuthorizationContract(address: string, runner: ContractRunner) {
  return new Contract(address, IDENTITY_AUTHORIZATION_ABI, runner);
}

/** Read one chain-native path at a fixed block; RPC observers can see the queried alias. */
export async function loadShieldedIdentityAuthorizationWitness(
  contract: Contract,
  authorizationAlias: BigNumberish,
  expectedScope?: ShieldedIdentityAuthorizationScope,
): Promise<{
  witness: ShieldedIdentityAuthorizationWitness;
  stateRoot: bigint;
  checkpointId: bigint;
  asOf: bigint;
  blockNumber: number;
  blockHash: string;
  chainId: bigint;
  authorizationStateAddress: string;
}> {
  const provider = contract.runner?.provider;
  if (!provider) throw new Error("Authorization state has no provider");
  const alias = bigintFrom(authorizationAlias, "authorizationAlias", SNARK_SCALAR_FIELD - 1n);
  if (alias === 0n) throw new Error("Authorization alias must be nonzero");
  const [network, rawAddress] = await Promise.all([provider.getNetwork(), contract.getAddress()]);
  const chainId = BigInt(network.chainId);
  const address = getAddress(rawAddress);
  if (
    expectedScope &&
    (BigInt(expectedScope.chainId) !== chainId ||
      getAddress(expectedScope.authorizationStateAddress) !== address)
  )
    throw new Error("Authorization path scope does not match");
  const blockNumber = await provider.getBlockNumber();
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0)
    throw new Error("Invalid authorization scan block");
  const anchor = await provider.getBlock(blockNumber);
  if (!anchor?.hash) throw new Error("Authorization checkpoint block is unavailable");
  const overrides = { blockTag: blockNumber };
  const [rawCheckpointId, rawRoot, proof] = await Promise.all([
    contract.currentCheckpointId(overrides),
    contract.currentRoot(overrides),
    contract.getCounterProof(alias, overrides),
  ]);
  const checkpointId = BigInt(rawCheckpointId);
  if (checkpointId <= 0n) throw new Error("Authorization checkpoint is unavailable");
  const stateRoot = BigInt(rawRoot);
  if (typeof proof.isOld0 !== "boolean" || typeof proof.absent !== "boolean")
    throw new Error("Authorization path flags are not canonical");
  const witness = verifyShieldedIdentityAuthorizationWitness(
    {
      authorizationAlias: alias,
      authorizationCounter: proof.authorizationCounter,
      stateRoot: proof.stateRoot,
      depth: proof.depth,
      siblings: Array.from(proof.siblings) as bigint[],
      oldKey: proof.oldKey,
      oldValue: proof.oldValue,
      isOld0: proof.isOld0 ? 1n : 0n,
      absent: proof.absent ? 1n : 0n,
    },
    stateRoot,
    alias,
  );
  const checkpoint = await contract.getCheckpoint(checkpointId, overrides);
  const asOf = BigInt(anchor.timestamp);
  if (
    BigInt(checkpoint.root) !== stateRoot ||
    BigInt(checkpoint.createdAt) > asOf ||
    BigInt(checkpoint.retiredAt) !== 0n
  )
    throw new Error("Authorization checkpoint time is inconsistent");
  const [finalAnchor, finalNetwork, finalAddress] = await Promise.all([
    provider.getBlock(blockNumber),
    provider.getNetwork(),
    contract.getAddress(),
  ]);
  if (finalAnchor?.hash !== anchor.hash)
    throw new Error("Authorization checkpoint was reorganized");
  if (BigInt(finalNetwork.chainId) !== chainId || getAddress(finalAddress) !== address)
    throw new Error("Authorization path scope changed while reading");
  return {
    witness,
    stateRoot,
    checkpointId,
    asOf,
    blockNumber,
    blockHash: anchor.hash,
    chainId,
    authorizationStateAddress: address,
  };
}

/** Default replay keeps the queried alias local; failures never switch read modes. */
export async function loadShieldedIdentityAuthorizationWitnessForMode(
  contract: Contract,
  authorizationAlias: BigNumberish,
  mode?: ShieldedStateReadMode,
  expectedScope?: ShieldedIdentityAuthorizationScope,
): ReturnType<typeof loadShieldedIdentityAuthorizationWitness> {
  const selected = normalizeShieldedStateReadMode(mode);
  if (selected === "chain")
    return loadShieldedIdentityAuthorizationWitness(contract, authorizationAlias, expectedScope);
  if (hasPersistentPublicStateStorage())
    return loadPersistedIdentityAuthorizationWitness(contract, authorizationAlias, expectedScope);
  const alias = bigintFrom(authorizationAlias, "authorizationAlias", SNARK_SCALAR_FIELD - 1n);
  if (alias === 0n) throw new Error("Authorization alias must be nonzero");
  const result = await loadVerifiedAuthorizationReplay(contract, expectedScope);
  const tree = result.tree;
  const witness = verifyShieldedIdentityAuthorizationWitness(
    tree.getWitness(alias),
    tree.root,
    alias,
  );
  return {
    witness,
    stateRoot: tree.root,
    checkpointId: result.checkpointId,
    asOf: result.asOf,
    blockNumber: result.blockNumber,
    blockHash: result.blockHash,
    chainId: result.chainId,
    authorizationStateAddress: result.authorizationStateAddress,
  };
}

/** Export a complete public state only when a caller explicitly requests it. */
export async function loadShieldedIdentityAuthorizationState(
  contract: Contract,
  expectedScope?: ShieldedIdentityAuthorizationScope,
): Promise<{
  state: ShieldedIdentityAuthorizationState;
  checkpointId: bigint;
  asOf: bigint;
  blockNumber: number;
  blockHash: string;
  chainId: bigint;
  authorizationStateAddress: string;
}> {
  const { tree, ...checkpoint } = await loadVerifiedAuthorizationReplay(contract, expectedScope);
  return { state: tree.snapshot(), ...checkpoint };
}

/** Keep the verified replay tree private so path readers never copy its full map. */
async function loadVerifiedAuthorizationReplay(
  contract: Contract,
  expectedScope?: ShieldedIdentityAuthorizationScope,
): Promise<{
  tree: AuthorizationTree;
  checkpointId: bigint;
  asOf: bigint;
  blockNumber: number;
  blockHash: string;
  chainId: bigint;
  authorizationStateAddress: string;
}> {
  const provider = contract.runner?.provider;
  if (!provider) throw new Error("Authorization state has no provider");
  const [network, rawAddress] = await Promise.all([provider.getNetwork(), contract.getAddress()]);
  const chainId = BigInt(network.chainId);
  const address = getAddress(rawAddress);
  if (
    expectedScope &&
    (BigInt(expectedScope.chainId) !== chainId ||
      getAddress(expectedScope.authorizationStateAddress) !== address)
  )
    throw new Error("Authorization path scope does not match");
  const blockNumber = await provider.getBlockNumber();
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0)
    throw new Error("Invalid authorization scan block");
  const anchor = await provider.getBlock(blockNumber);
  if (!anchor?.hash) throw new Error("Authorization checkpoint block is unavailable");
  const overrides = { blockTag: blockNumber };
  const [creationBlock, checkpointId, root] = await Promise.all([
    contract.creationBlock(overrides),
    contract.currentCheckpointId(overrides),
    contract.currentRoot(overrides),
  ]);
  const deploymentBlock = Number(creationBlock);
  const chunk = getEventScanConfig().blockChunk;
  if (
    !Number.isSafeInteger(deploymentBlock) ||
    deploymentBlock < 0 ||
    deploymentBlock > blockNumber ||
    !Number.isSafeInteger(chunk) ||
    chunk < 1
  )
    throw new Error("Invalid authorization replay block range");
  const key = `${chainId}:${address.toLowerCase()}:${deploymentBlock}`;
  let byContract = replays.get(provider);
  if (!byContract) {
    byContract = new Map();
    replays.set(provider, byContract);
  }
  let cache = byContract.get(key);
  if (!cache) {
    cache = { sequence: 0, published: 0 };
    byContract.set(key, cache);
  }
  const request = ++cache.sequence;
  let previous = cache.replay;
  if (previous) {
    const ancestor =
      previous.blockNumber <= blockNumber ? await provider.getBlock(previous.blockNumber) : null;
    if (!ancestor || ancestor.hash !== previous.blockHash) {
      if (cache.replay === previous) cache.replay = undefined;
      previous = undefined;
    }
  }
  const event = contract.interface.getEvent("CounterIncremented");
  if (!event) throw new Error("Authorization state ABI is incomplete");
  const mirror = previous?.tree.clone() ?? createShieldedIdentityAuthorizationTree();
  let nextCheckpoint = (previous?.checkpointId ?? 1n) + 1n;
  const fromBlock = previous ? previous.blockNumber + 1 : deploymentBlock;
  for (let start = fromBlock; start <= blockNumber; start += chunk) {
    const end = Math.min(blockNumber, start + chunk - 1);
    const logs = await provider.getLogs({
      address,
      topics: [event.topicHash],
      fromBlock: start,
      toBlock: end,
    });
    logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
    for (const log of logs) {
      if (log.removed || log.blockNumber < start || log.blockNumber > end)
        throw new Error("Authorization update history is inconsistent");
      const update = contract.interface.parseLog(log)?.args;
      if (
        !update ||
        BigInt(update.checkpointId) !== nextCheckpoint++ ||
        BigInt(update.oldRoot) !== mirror.root
      )
        throw new Error("Authorization update history is incomplete");
      const alias = BigInt(update.aliasR);
      const oldCounter = BigInt(update.oldCounter);
      const newCounter = BigInt(update.newCounter);
      if (mirror.getCounter(alias) !== oldCounter || newCounter !== oldCounter + 1n)
        throw new Error("Authorization counter history is inconsistent");
      mirror.increment(alias, oldCounter, newCounter);
      if (mirror.root !== BigInt(update.newRoot))
        throw new Error("Authorization root does not match replay");
    }
  }
  if (BigInt(checkpointId) !== nextCheckpoint - 1n || mirror.root !== BigInt(root))
    throw new Error("Authorization checkpoint does not match replay");
  const checkpoint = await contract.getCheckpoint(checkpointId, overrides);
  if (
    BigInt(checkpoint.root) !== mirror.root ||
    BigInt(checkpoint.createdAt) > BigInt(anchor.timestamp) ||
    BigInt(checkpoint.retiredAt) !== 0n
  )
    throw new Error("Authorization checkpoint time is inconsistent");
  const [finalAnchor, finalNetwork, finalAddress] = await Promise.all([
    provider.getBlock(blockNumber),
    provider.getNetwork(),
    contract.getAddress(),
  ]);
  if (finalAnchor?.hash !== anchor.hash)
    throw new Error("Authorization checkpoint was reorganized");
  if (BigInt(finalNetwork.chainId) !== chainId || getAddress(finalAddress) !== address)
    throw new Error("Authorization path scope changed while reading");
  // An older concurrent load may return its verified block, but must not replace
  // a newer cache or publish over a later successful request at the same height.
  if (request >= cache.published && (!cache.replay || cache.replay.blockNumber <= blockNumber)) {
    cache.replay = {
      tree: mirror,
      blockNumber,
      blockHash: anchor.hash,
      checkpointId: BigInt(checkpointId),
    };
    cache.published = request;
  }
  return {
    tree: mirror,
    checkpointId: BigInt(checkpointId),
    asOf: BigInt(anchor.timestamp),
    blockNumber,
    blockHash: anchor.hash,
    chainId,
    authorizationStateAddress: address,
  };
}
