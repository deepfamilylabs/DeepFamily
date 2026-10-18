import { describe, expect, it } from "vitest";
import { Interface, type Contract } from "ethers";
import { SHIELDED_POOL_PROTOCOL_VERSION, createLineageTree } from "@deepfamily/protocol-core";
import { getLocalShieldedNoteProof, loadShieldedPoolSnapshot } from "./shieldedPoolChain";

const ABI = [
  "event NoteAppended(uint256 indexed shardId,uint256 indexed leafIndex,uint256 commitment,uint256 root,bytes ciphertext)",
  "event NullifierSpent(uint256 nullifier)",
  "event ActionExecuted(uint8 action,uint256 inputShardId0,uint256 inputShardId1)",
  "function protocolVersion() view returns (uint256)",
  "function nullifierCount() view returns (uint256)",
];
const ADDRESS = "0x1111111111111111111111111111111111111111";
const CIPHERTEXT = `0x${"ab".repeat(512)}`;

function fixture() {
  const iface = new Interface(ABI);
  const tree = createLineageTree();
  const commitments = [111n, 222n, 333n, 444n];
  const roots = commitments.map((commitment) => {
    tree.insert(commitment);
    return tree.root;
  });
  const transactionHash = (blockNumber: number) =>
    `0x${blockNumber.toString(16).padStart(64, "0")}`;
  const noteLog = (blockNumber: number, leafIndex: number, index: number) => ({
    ...iface.encodeEventLog(iface.getEvent("NoteAppended")!, [
      0n,
      BigInt(leafIndex),
      commitments[leafIndex],
      roots[leafIndex],
      CIPHERTEXT,
    ]),
    address: ADDRESS,
    blockNumber,
    index,
    transactionHash: transactionHash(blockNumber),
  });
  const actionLog = (blockNumber: number, index: number) => ({
    ...iface.encodeEventLog(iface.getEvent("ActionExecuted")!, [0, 0n, 0n]),
    address: ADDRESS,
    blockNumber,
    index,
    transactionHash: transactionHash(blockNumber),
  });
  const logs = [
    actionLog(1, 0),
    noteLog(1, 0, 1),
    noteLog(1, 1, 2),
    {
      ...iface.encodeEventLog(iface.getEvent("NullifierSpent")!, [999n]),
      address: ADDRESS,
      blockNumber: 2,
      index: 0,
      transactionHash: transactionHash(2),
    },
    actionLog(2, 1),
    noteLog(2, 2, 2),
    noteLog(2, 3, 3),
  ];
  const calls: Array<{ fromBlock: number; toBlock: number; topics: unknown }> = [];
  let tip = 1;
  const provider = {
    getNetwork: async () => ({ chainId: 71n }),
    getBlockNumber: async () => tip,
    getBlock: async (number: number) => ({ hash: `0x${number.toString(16).padStart(64, "0")}` }),
    getLogs: async (filter: { fromBlock: number; toBlock: number; topics: unknown }) => {
      calls.push(filter);
      return logs.filter(
        (log) => log.blockNumber >= filter.fromBlock && log.blockNumber <= filter.toBlock,
      );
    },
  };
  const pool = {
    interface: iface,
    runner: { provider },
    getAddress: async () => ADDRESS,
    protocolVersion: async () => BigInt(SHIELDED_POOL_PROTOCOL_VERSION),
    nullifierCount: async (overrides: { blockTag: number }) => overrides.blockTag === 1 ? 0n : 1n,
    currentShardId: async () => 0n,
    noteShard: async (_shardId: bigint, overrides: { blockTag: number }) => ({
      size: overrides.blockTag === 1 ? 2n : 4n,
      root: overrides.blockTag === 1 ? roots[1] : roots[3],
    }),
  } as unknown as Contract;
  return {
    pool,
    calls,
    logs,
    setTip: (value: number) => {
      tip = value;
    },
    secondRoot: roots[3],
  };
}

describe("shielded pool public event recovery", () => {
  it.each([0n, 2n])("rejects unsupported protocol version %s", async (version) => {
    const context = fixture();
    const pool = {
      ...context.pool,
      protocolVersion: async () => version,
    } as unknown as Contract;
    await expect(
      loadShieldedPoolSnapshot(pool, async () => null, { fromBlock: 1 }),
    ).rejects.toThrow("Unsupported shielded pool protocol version");
    expect(context.calls).toEqual([]);
  });

  it.each(["ActionExecuted", "protocolVersion", "nullifierCount"])(
    "requires %s in the current recovery ABI",
    async (fragment) => {
      const context = fixture();
      const pool = {
        ...context.pool,
        interface: new Interface(ABI.filter((entry) => !entry.includes(fragment))),
      } as unknown as Contract;
      await expect(
        loadShieldedPoolSnapshot(pool, async () => null, { fromBlock: 1 }),
      ).rejects.toThrow("recovery ABI is incomplete");
      expect(context.calls).toEqual([]);
    },
  );

  it("rejects an ActionExecuted ABI that omits the input shard fields", async () => {
    const context = fixture();
    const pool = {
      ...context.pool,
      interface: new Interface([
        ...ABI.filter((entry) => !entry.includes("ActionExecuted")),
        "event ActionExecuted(uint8 indexed action)",
      ]),
    } as unknown as Contract;
    await expect(
      loadShieldedPoolSnapshot(pool, async () => null, { fromBlock: 1 }),
    ).rejects.toThrow("recovery ABI is incomplete");
  });

  it("requires complete nullifier history at the fixed recovery block", async () => {
    const context = fixture();
    const incomplete = {
      ...context.pool,
      protocolVersion: async (overrides: { blockTag: number }) => {
        expect(overrides.blockTag).toBe(1);
        return BigInt(SHIELDED_POOL_PROTOCOL_VERSION);
      },
      nullifierCount: async (overrides: { blockTag: number }) => {
        expect(overrides.blockTag).toBe(1);
        return 1n;
      },
    } as unknown as Contract;
    await expect(
      loadShieldedPoolSnapshot(incomplete, async () => null, { fromBlock: 1, toBlock: 1 }),
    ).rejects.toThrow("nullifier history");
    await expect(
      loadShieldedPoolSnapshot(context.pool, async () => null, { fromBlock: 1, toBlock: 1 }),
    ).resolves.toMatchObject({ toBlock: 1 });
  });

  it.each(["missing boundary", "other transaction", "incomplete outputs"])(
    "rejects an action with %s",
    async (failure) => {
      const context = fixture();
      if (failure === "missing boundary") context.logs.shift();
      if (failure === "other transaction") context.logs[1].transactionHash = `0x${"ab".repeat(32)}`;
      if (failure === "incomplete outputs") context.logs.splice(2, 1);
      await expect(
        loadShieldedPoolSnapshot(context.pool, async () => null, { fromBlock: 1 }),
      ).rejects.toThrow("action history is incomplete");
    },
  );

  it("replays every public note, checks roots, and extends only from the last scanned block", async () => {
    const context = fixture();
    const decoder = async (event: { commitment: bigint }) =>
      event.commitment === 111n ? { note: "owned", commitment: 111n } : null;
    const first = await loadShieldedPoolSnapshot(context.pool, decoder, {
      fromBlock: 1,
      blockChunk: 1,
    });
    expect(first.ownedNotes.get(111n)).toMatchObject({
      note: "owned", action: 0, actionLogIndex: 0, outputIndex: 0,
      transactionHash: context.logs[1].transactionHash,
    });
    expect(first.shards.get(0n)?.sizeBigInt).toBe(2n);
    expect(getLocalShieldedNoteProof(first, 111n).proofDepth).toBe(1);
    context.setTip(2);
    const second = await loadShieldedPoolSnapshot(context.pool, decoder, {
      previous: first,
      blockChunk: 1,
    });
    expect(second.shards.get(0n)?.root).toBe(context.secondRoot);
    expect(second.spentNullifiers.has(999n)).toBe(true);
    expect(first.invalidated).toBe(true);
    expect(() => getLocalShieldedNoteProof(first, 111n)).toThrow("snapshot is invalid");
    await expect(
      loadShieldedPoolSnapshot(context.pool, decoder, { previous: first }),
    ).rejects.toThrow("snapshot is invalid");
    const proof = getLocalShieldedNoteProof(second, 111n);
    expect(proof.root).toBe(context.secondRoot);
    expect(proof.proofDepth).toBe(2);
    expect(proof.siblings[0]).toBe(222n);
    expect(proof.siblings).toHaveLength(32);
    expect(context.calls.map((call) => [call.fromBlock, call.toBlock])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    const iface = context.pool.interface;
    expect(context.calls.every((call) => JSON.stringify(call.topics) === JSON.stringify([[
      iface.getEvent("NoteAppended")!.topicHash,
      iface.getEvent("NullifierSpent")!.topicHash,
      iface.getEvent("ActionExecuted")!.topicHash,
    ]]))).toBe(true);
  });

  it("does not build a spending path for a one-leaf local root", async () => {
    const context = fixture();
    const snapshot = await loadShieldedPoolSnapshot(
      context.pool,
      async (event) => ({ note: "owned", commitment: event.commitment }),
      { fromBlock: 1 },
    );
    snapshot.shards = new Map([[0n, createLineageTree([111n])]]);
    expect(() => getLocalShieldedNoteProof(snapshot, 111n)).toThrow("Single-leaf note roots");
  });

  it("rejects a successful decryption whose private note disagrees with the public commitment", async () => {
    const context = fixture();
    await expect(
      loadShieldedPoolSnapshot(context.pool, async () => ({ note: "forged", commitment: 222n }), {
        fromBlock: 1,
      }),
    ).rejects.toThrow("does not match its public commitment");
  });

  it("rejects a forged event root before presenting recovered notes", async () => {
    const context = fixture();
    const iface = context.pool.interface;
    const forged = iface.encodeEventLog(iface.getEvent("NoteAppended")!, [
      0n,
      0n,
      111n,
      555n,
      CIPHERTEXT,
    ]);
    context.logs[1] = { ...context.logs[1], ...forged };
    await expect(
      loadShieldedPoolSnapshot(context.pool, async () => null, { fromBlock: 1 }),
    ).rejects.toThrow("root does not match replay");
  });
});
