import { describe, expect, it } from "vitest";
import { Interface, type Contract } from "ethers";
import { createLineageTree } from "@deepfamily/protocol-core";
import { auditKnownFundingClaimLink } from "./shieldedPublicObserverAudit";
import { loadPublicPoolActionObservations } from "./shieldedPublicObserverChain";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const PROXY = "0x2222222222222222222222222222222222222222";
const BLOCK_HASH = `0x${"ee".repeat(32)}`;
const NOTE = `0x${"ab".repeat(512)}`;
const ABI = [
  "event ActionExecuted(uint8 action,uint256 inputShardId0,uint256 inputShardId1)",
  "event NoteAppended(uint256 indexed shardId,uint256 indexed leafIndex,uint256 commitment,uint256 root,bytes ciphertext)",
];

function fixture(batchViaProxy = false) {
  const iface = new Interface(ABI);
  const tree = createLineageTree();
  const logs: Array<{
    address: string;
    topics: string[];
    data: string;
    blockNumber: number;
    blockHash: string;
    index: number;
    transactionHash: string;
  }> = [];
  const receipts = new Map<
    string,
    {
      status: number;
      to: string;
      hash: string;
      blockNumber: number;
      blockHash: string;
      logs: typeof logs;
    }
  >();
  const add = (action: number, ordinal: number, commitments: readonly [bigint, bigint]) => {
    const txNumber = batchViaProxy && ordinal === 3 ? 2 : ordinal;
    const txHash = `0x${txNumber.toString(16).padStart(64, "0")}`;
    const event = iface.encodeEventLog(iface.getEvent("ActionExecuted")!, [action, 0n, 0n]);
    const txLogs = [
      {
        ...event,
        address: ADDRESS,
        blockNumber: 1,
        blockHash: BLOCK_HASH,
        index: logs.length,
        transactionHash: txHash,
      },
    ];
    for (const commitment of commitments) {
      const leafIndex = tree.sizeBigInt;
      tree.insert(commitment);
      txLogs.push({
        ...iface.encodeEventLog(iface.getEvent("NoteAppended")!, [
          0n,
          leafIndex,
          commitment,
          tree.root,
          NOTE,
        ]),
        address: ADDRESS,
        blockNumber: 1,
        blockHash: BLOCK_HASH,
        index: logs.length + txLogs.length,
        transactionHash: txHash,
      });
    }
    logs.push(...txLogs);
    const existing = receipts.get(txHash);
    receipts.set(txHash, {
      status: 1,
      to: batchViaProxy && txNumber === 2 ? PROXY : ADDRESS,
      hash: txHash,
      blockNumber: 1,
      blockHash: BLOCK_HASH,
      logs: existing ? [...existing.logs, ...txLogs] : txLogs,
    });
    return txHash;
  };
  add(0, 1, [11n, 12n]);
  const fundTxHash = add(1, 2, [101n, 102n]);
  const claimTxHash = add(2, 3, [201n, 202n]);
  const filters: Array<Record<string, unknown>> = [];
  const provider = {
    getBlockNumber: async () => 1,
    getBlock: async () => ({ hash: BLOCK_HASH }),
    getNetwork: async () => ({ chainId: 71n }),
    getCode: async (_address: string, block: number) => (block === 0 ? "0x" : "0x6000"),
    getLogs: async (filter: Record<string, unknown>) => {
      filters.push(filter);
      return logs;
    },
    getTransactionReceipt: async (hash: string) => receipts.get(hash),
  };
  const pool = {
    interface: iface,
    runner: { provider },
    getAddress: async () => ADDRESS,
    currentShardId: async () => 0n,
    noteShard: async () => ({ size: tree.sizeBigInt, root: tree.root }),
  } as unknown as Contract;
  return { pool, logs, receipts, filters, fundTxHash, claimTxHash };
}

describe("public shielded pool observer loader", () => {
  it.each([5, 255])("rejects unknown pool action code %i", async (action) => {
    const f = fixture();
    Object.assign(
      f.logs[6],
      f.pool.interface.encodeEventLog(f.pool.interface.getEvent("ActionExecuted")!, [action, 0n, 0n]),
    );
    await expect(loadPublicPoolActionObservations(f.pool, { deploymentBlock: 1 })).rejects.toThrow(
      "unknown action code",
    );
  });
  it("replays all public actions and notes, then feeds the linkability audit", async () => {
    const { pool, filters, claimTxHash } = fixture();
    const observed = await loadPublicPoolActionObservations(pool, { deploymentBlock: 1 });
    expect(observed.historyVerifiedFromDeployment).toBe(true);
    expect(observed.actions.map((action) => action.outputs[0].commitment)).toEqual([
      11n,
      101n,
      201n,
    ]);
    expect(filters).toHaveLength(1);
    expect(filters[0]).toMatchObject({ address: ADDRESS.toLowerCase(), fromBlock: 1, toBlock: 1 });
    expect(filters[0].topics).toEqual([
      [
        pool.interface.getEvent("ActionExecuted")!.topicHash,
        pool.interface.getEvent("NoteAppended")!.topicHash,
      ],
    ]);
    expect(
      auditKnownFundingClaimLink({
        actions: observed.actions,
        knownFundingCommitment: 101n,
        claimTxHash,
        historyVerifiedFromDeployment: observed.historyVerifiedFromDeployment,
      }).verdict,
    ).toBe("directly-linkable");
  });

  it("accepts two pool calls through a proxy in the same successful transaction", async () => {
    const { pool, fundTxHash, claimTxHash, receipts } = fixture(true);
    expect(fundTxHash).toBe(claimTxHash);
    expect(receipts.get(claimTxHash)?.to).toBe(PROXY);
    const observed = await loadPublicPoolActionObservations(pool, { deploymentBlock: 1 });
    expect(observed.actions).toHaveLength(3);
    expect(observed.actions[1].txHash).toBe(observed.actions[2].txHash);
    expect(observed.actions[1].actionLogIndex).not.toBe(observed.actions[2].actionLogIndex);
    expect(
      auditKnownFundingClaimLink({
        actions: observed.actions,
        knownFundingCommitment: 101n,
        claimTxHash,
        claimActionLogIndex: observed.actions[2].actionLogIndex,
        historyVerifiedFromDeployment: observed.historyVerifiedFromDeployment,
      }).verdict,
    ).toBe("directly-linkable");
  });

  it("rejects missing action boundaries, incomplete outputs, failed receipts, and wrong deployment", async () => {
    const missingAction = fixture();
    missingAction.logs.splice(3, 1);
    await expect(
      loadPublicPoolActionObservations(missingAction.pool, { deploymentBlock: 1 }),
    ).rejects.toThrow("no matching action boundary");

    const missingOutput = fixture();
    missingOutput.logs.splice(8, 1);
    await expect(
      loadPublicPoolActionObservations(missingOutput.pool, { deploymentBlock: 1 }),
    ).rejects.toThrow("ended without two output notes");

    const badReceipt = fixture();
    badReceipt.receipts.get(badReceipt.claimTxHash)!.status = 0;
    await expect(
      loadPublicPoolActionObservations(badReceipt.pool, { deploymentBlock: 1 }),
    ).rejects.toThrow("receipt is missing or inconsistent");

    const forkMixedReceipt = fixture();
    forkMixedReceipt.receipts.get(forkMixedReceipt.claimTxHash)!.blockHash = `0x${"ff".repeat(32)}`;
    await expect(
      loadPublicPoolActionObservations(forkMixedReceipt.pool, { deploymentBlock: 1 }),
    ).rejects.toThrow("receipt is missing or inconsistent");

    const wrongDeployment = fixture();
    await expect(
      loadPublicPoolActionObservations(wrongDeployment.pool, { deploymentBlock: 0 }),
    ).rejects.toThrow("first code block");
  });
});
