import {
  buildShieldedIdentityAuthorizationState,
  type ShieldedIdentityAuthorizationState,
} from "@deepfamily/protocol-core";
import { Contract, type ContractRunner } from "ethers";
import { getEventScanConfig } from "../config/env";

export const IDENTITY_AUTHORIZATION_ABI = [
  "function creationBlock() view returns (uint256)",
  "function currentCheckpointId() view returns (uint256)",
  "function currentRoot() view returns (uint256)",
  "function getCheckpoint(uint256) view returns (tuple(uint256 root,uint64 createdAt,uint64 retiredAt))",
  "function validateCheckpoint(uint256,uint64) view returns (uint256)",
  "function incrementCounter(uint256 authorizationNullifier,uint256 aliasR,uint256 oldRoot,uint256 newRoot,uint64 oldCounter,uint64 newCounter,bytes proof)",
  "event CounterIncremented(uint256 indexed checkpointId,uint256 indexed aliasR,uint64 oldCounter,uint64 newCounter,uint256 oldRoot,uint256 newRoot,uint256 authorizationNullifier)",
] as const;

export function createIdentityAuthorizationContract(address: string, runner: ContractRunner) {
  return new Contract(address, IDENTITY_AUTHORIZATION_ABI, runner);
}

/** Replay every update locally: no recipient alias is ever sent in an RPC filter. */
export async function loadShieldedIdentityAuthorizationState(contract: Contract): Promise<{
  state: ShieldedIdentityAuthorizationState;
  checkpointId: bigint;
  asOf: bigint;
  blockNumber: number;
}> {
  const provider = contract.runner?.provider;
  if (!provider) throw new Error("Authorization state has no provider");
  const blockNumber = await provider.getBlockNumber();
  const anchor = await provider.getBlock(blockNumber);
  if (!anchor?.hash) throw new Error("Authorization checkpoint block is unavailable");
  const overrides = { blockTag: blockNumber };
  const [creationBlock, checkpointId, root] = await Promise.all([
    contract.creationBlock(overrides), contract.currentCheckpointId(overrides), contract.currentRoot(overrides),
  ]);
  const event = contract.interface.getEvent("CounterIncremented");
  if (!event) throw new Error("Authorization state ABI is incomplete");
  const records = new Map<bigint, bigint>();
  let mirror = buildShieldedIdentityAuthorizationState();
  let nextCheckpoint = 2n;
  const chunk = getEventScanConfig().blockChunk;
  for (let start = Number(creationBlock); start <= blockNumber; start += chunk) {
    const logs = await provider.getLogs({ address: await contract.getAddress(), topics: [event.topicHash], fromBlock: start, toBlock: Math.min(blockNumber, start + chunk - 1) });
    logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
    for (const log of logs) {
      const update = contract.interface.parseLog(log)?.args;
      if (!update || BigInt(update.checkpointId) !== nextCheckpoint++ || BigInt(update.oldRoot) !== mirror.root)
        throw new Error("Authorization update history is incomplete");
      const alias = BigInt(update.aliasR), oldCounter = BigInt(update.oldCounter), newCounter = BigInt(update.newCounter);
      if ((records.get(alias) ?? 0n) !== oldCounter || newCounter !== oldCounter + 1n)
        throw new Error("Authorization counter history is inconsistent");
      records.set(alias, newCounter);
      mirror = buildShieldedIdentityAuthorizationState(records);
      if (mirror.root !== BigInt(update.newRoot)) throw new Error("Authorization root does not match replay");
    }
  }
  if (BigInt(checkpointId) !== nextCheckpoint - 1n || mirror.root !== BigInt(root))
    throw new Error("Authorization checkpoint does not match replay");
  const checkpoint = await contract.getCheckpoint(checkpointId, overrides);
  if (BigInt(checkpoint.root) !== mirror.root || BigInt(checkpoint.createdAt) > BigInt(anchor.timestamp))
    throw new Error("Authorization checkpoint time is inconsistent");
  if ((await provider.getBlock(blockNumber))?.hash !== anchor.hash)
    throw new Error("Authorization checkpoint was reorganized");
  return { state: mirror, checkpointId: BigInt(checkpointId), asOf: BigInt(anchor.timestamp), blockNumber };
}
