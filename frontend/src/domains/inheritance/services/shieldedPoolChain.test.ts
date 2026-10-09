import { describe, expect, it } from "vitest";
import { Interface, type Contract } from "ethers";
import { createLineageTree } from "@deepfamily/protocol-core";
import { getLocalShieldedNoteProof, loadShieldedPoolSnapshot } from "./shieldedPoolChain";

const ABI = [
  "event NoteAppended(uint256 indexed shardId,uint256 indexed leafIndex,uint256 commitment,uint256 root,bytes ciphertext)",
  "event NullifierSpent(uint256 nullifier)",
];
const ADDRESS = "0x1111111111111111111111111111111111111111";
const CIPHERTEXT = `0x${"ab".repeat(512)}`;

function fixture() {
  const iface = new Interface(ABI);
  const tree = createLineageTree();
  tree.insert(111n);
  const firstRoot = tree.root;
  tree.insert(222n);
  const secondRoot = tree.root;
  const noteLog = (blockNumber: number, leafIndex: number, commitment: bigint, root: bigint) => {
    const encoded = iface.encodeEventLog(iface.getEvent("NoteAppended")!, [
      0n,
      BigInt(leafIndex),
      commitment,
      root,
      CIPHERTEXT,
    ]);
    return { ...encoded, address: ADDRESS, blockNumber, index: 0 };
  };
  const spent = iface.encodeEventLog(iface.getEvent("NullifierSpent")!, [999n]);
  const logs = [
    noteLog(1, 0, 111n, firstRoot),
    noteLog(2, 1, 222n, secondRoot),
    { ...spent, address: ADDRESS, blockNumber: 2, index: 1 },
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
    currentShardId: async () => 0n,
    noteShard: async (_shardId: bigint, overrides: { blockTag: number }) => ({
      size: overrides.blockTag === 1 ? 1n : 2n,
      root: overrides.blockTag === 1 ? firstRoot : secondRoot,
    }),
  } as unknown as Contract;
  return {
    pool,
    calls,
    logs,
    setTip: (value: number) => {
      tip = value;
    },
    secondRoot,
  };
}

describe("shielded pool public event recovery", () => {
  it("requires v3 action and complete nullifier history at the fixed recovery block", async () => {
    const context = fixture();
    const iface = new Interface([
      ...ABI,
      "event ActionExecuted(uint8 action,uint256 inputShardId0,uint256 inputShardId1)",
    ]);
    const hash = `0x${"ab".repeat(32)}`;
    const action = {
      ...iface.encodeEventLog(iface.getEvent("ActionExecuted")!, [0, 0n, 0n]),
      address: ADDRESS,
      blockNumber: 1,
      index: 0,
      transactionHash: hash,
    };
    context.logs[0] = {
      ...context.logs[0],
      index: 1,
      transactionHash: hash,
    } as (typeof context.logs)[0];
    context.logs.unshift(action);
    const v3 = {
      ...context.pool,
      interface: iface,
      protocolVersion: async () => 3n,
      nullifierCount: async () => 1n,
    } as unknown as Contract;
    await expect(
      loadShieldedPoolSnapshot(v3, async () => null, { fromBlock: 1, toBlock: 1 }),
    ).rejects.toThrow("nullifier history");
    const complete = {
      ...v3,
      nullifierCount: async (overrides: { blockTag: number }) => {
        expect(overrides.blockTag).toBe(1);
        return 0n;
      },
    } as unknown as Contract;
    await expect(
      loadShieldedPoolSnapshot(complete, async () => null, { fromBlock: 1, toBlock: 1 }),
    ).resolves.toMatchObject({ toBlock: 1 });
    context.logs.shift();
    await expect(
      loadShieldedPoolSnapshot(complete, async () => null, { fromBlock: 1, toBlock: 1 }),
    ).rejects.toThrow("action history");
  });
  it("replays every public note, checks roots, and extends only from the last scanned block", async () => {
    const context = fixture();
    const decoder = async (event: { commitment: bigint }) =>
      event.commitment === 111n ? { note: "owned", commitment: 111n } : null;
    const first = await loadShieldedPoolSnapshot(context.pool, decoder, {
      fromBlock: 1,
      blockChunk: 1,
    });
    expect(first.ownedNotes.get(111n)?.note).toBe("owned");
    expect(first.shards.get(0n)?.sizeBigInt).toBe(1n);
    expect(() => getLocalShieldedNoteProof(first, 111n)).toThrow("Single-leaf note roots");
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
    expect(proof.proofDepth).toBe(1);
    expect(proof.siblings[0]).toBe(222n);
    expect(proof.siblings).toHaveLength(32);
    expect(context.calls.map((call) => [call.fromBlock, call.toBlock])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(
      context.calls.every(
        (call) => Array.isArray(call.topics) && (call.topics as unknown[]).length === 1,
      ),
    ).toBe(true);
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
    context.logs[0] = { ...forged, address: ADDRESS, blockNumber: 1, index: 0 };
    await expect(
      loadShieldedPoolSnapshot(context.pool, async () => null, { fromBlock: 1 }),
    ).rejects.toThrow("root does not match replay");
  });
});
