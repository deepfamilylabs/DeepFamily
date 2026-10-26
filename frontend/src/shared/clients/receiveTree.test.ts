import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLineageTree, hashLineageNodes, SNARK_SCALAR_FIELD } from "@deepfamily/protocol-core";
import { Interface, toBeHex, type Contract, type Log, type Provider } from "ethers";
import {
  assertReceiveTreeAnchor,
  readReceiveTreeAnchor,
  readReceiveTreePath,
  validateReceiveTreePath,
} from "./receiveTree";

const scan = vi.hoisted(() => ({ fromBlock: 0, blockChunk: 100 }));
vi.mock("../config/env", () => ({ getEventScanConfig: () => scan }));
const iface = new Interface([
  "event CredentialIssued(uint256 indexed leafIndex,uint256 credential,uint256 root)",
  "event SourceLeafPublished(uint8 indexed treeId,uint256 indexed leafIndex,uint256 leaf,uint256 root)",
]);
let addressSequence = 1000n;
const hash = (number: number) => toBeHex(BigInt(number) + 10000n, 32);

function fixture(treeId?: 0 | 1) {
  const address = toBeHex(addressSequence++, 20);
  const tree = createLineageTree();
  const logs: Log[] = [];
  const blockHashes = new Map<number, string>();
  let latest = 10;
  const add = (leaf: bigint, blockNumber: number) => {
    const leafIndex = tree.sizeBigInt;
    tree.insert(leaf);
    const encoded = iface.encodeEventLog(
      iface.getEvent(treeId === undefined ? "CredentialIssued" : "SourceLeafPublished")!,
      treeId === undefined ? [leafIndex, leaf, tree.root] : [treeId, leafIndex, leaf, tree.root],
    );
    logs.push({
      address,
      ...encoded,
      blockNumber,
      blockHash: hash(blockNumber),
      index: 0,
      transactionHash: hash(blockNumber + 100),
      removed: false,
    } as unknown as Log);
  };
  for (const [index, leaf] of [11n, 13n, 17n].entries()) add(leaf, index + 1);
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId: 31337n })),
    getBlockNumber: vi.fn(async () => latest),
    getBlock: vi.fn(async (number: number) => ({
      number,
      hash: blockHashes.get(number) ?? hash(number),
    })),
    getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: number; toBlock: number }) =>
      logs.filter((log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock),
    ),
  };
  const path = (index: bigint) => {
    const proof = tree.generateProof(index);
    return { ...proof, depth: BigInt(proof.siblings.length) };
  };
  const contract = {
    runner: { provider },
    interface: iface,
    getAddress: async () => address,
    credentialCount: vi.fn(async () => tree.sizeBigInt),
    issuanceRoot: vi.fn(async () => tree.root),
    sourceSize: vi.fn(async () => tree.sizeBigInt),
    sourceRoot: vi.fn(async () => tree.root),
    trustedRoot: vi.fn(async () => tree.root),
    getCredentialProof: vi.fn(async (index: bigint) => path(index)),
    getSourceProof: vi.fn(async (_tree: number, index: bigint) => path(index)),
  };
  const request = (leafIndex = 2n, mode: "rebuild" | "chain" = "rebuild") => ({
    contract: contract as unknown as Contract,
    chainId: 31337n,
    anchor: { blockNumber: latest, blockHash: blockHashes.get(latest) ?? hash(latest) },
    mode,
    treeId,
    leafIndex,
  });
  return {
    provider,
    contract,
    request,
    tree,
    logs,
    blockHashes,
    add,
    path,
    setLatest: (number: number) => {
      latest = number;
    },
  };
}

beforeEach(() => {
  scan.fromBlock = 0;
  scan.blockChunk = 100;
});
describe("receive public tree paths", () => {
  it("rebuilds all Q leaves locally, including compact odd-width paths, without an indexed getter", async () => {
    const f = fixture();
    const result = await readReceiveTreePath(f.request());
    expect(result).toEqual({ ...f.path(2n), index: 1n, depth: 1n });
    expect(f.contract.getCredentialProof).not.toHaveBeenCalled();
    expect(f.provider.getLogs).toHaveBeenCalledWith({
      address: await f.contract.getAddress(),
      topics: [iface.getEvent("CredentialIssued")!.topicHash],
      fromBlock: 0,
      toBlock: 10,
    });
    expect(f.contract.credentialCount).toHaveBeenCalledWith({ blockTag: 10 });
    expect(f.contract.issuanceRoot).toHaveBeenCalledWith({ blockTag: 10 });
  });
  it.each([0, 1] as const)(
    "rebuilds source partition %s with only its public tree-id filter",
    async (treeId) => {
      const f = fixture(treeId);
      expect(await readReceiveTreePath(f.request(1n))).toEqual({ ...f.path(1n), index: 1n });
      expect(f.contract.getSourceProof).not.toHaveBeenCalled();
      expect(f.provider.getLogs.mock.calls[0][0]).toMatchObject({
        topics: [iface.getEvent("SourceLeafPublished")!.topicHash, toBeHex(treeId, 32)],
      });
      expect(f.contract.sourceSize).toHaveBeenCalledWith(treeId, { blockTag: 10 });
      expect(treeId === 0 ? f.contract.sourceRoot : f.contract.trustedRoot).toHaveBeenCalledWith({
        blockTag: 10,
      });
    },
  );
  it.each([undefined, 0, 1] as const)(
    "uses an explicit chain getter for tree %s, bound to the anchor and requested slot",
    async (treeId) => {
      const f = fixture(treeId);
      expect(await readReceiveTreePath(f.request(2n, "chain"))).toMatchObject({
        leaf: 17n,
        index: 1n,
        depth: 1n,
      });
      expect(f.provider.getLogs).not.toHaveBeenCalled();
      if (treeId === undefined)
        expect(f.contract.getCredentialProof).toHaveBeenCalledWith(2n, { blockTag: 10 });
      else expect(f.contract.getSourceProof).toHaveBeenCalledWith(treeId, 2n, { blockTag: 10 });
      f.contract.getCredentialProof.mockImplementation(async () => f.path(0n));
      f.contract.getSourceProof.mockImplementation(async () => f.path(0n));
      await expect(readReceiveTreePath(f.request(2n, "chain"))).rejects.toThrow(
        /another leaf slot/,
      );
    },
  );
  it("deduplicates concurrent full replays for different requested leaves", async () => {
    const f = fixture();
    const paths = await Promise.all(
      [0n, 1n, 2n].map((index) => readReceiveTreePath(f.request(index))),
    );
    expect(paths.map((path) => path.leaf)).toEqual([11n, 13n, 17n]);
    expect(f.provider.getLogs).toHaveBeenCalledTimes(1);
  });
  it("does not replace a newer cached anchor when an older concurrent replay finishes last", async () => {
    const f = fixture();
    let startOld!: () => void, finishOld!: () => void;
    const started = new Promise<void>((resolve) => {
      startOld = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      finishOld = resolve;
    });
    const original = f.provider.getLogs.getMockImplementation()!;
    f.provider.getLogs.mockImplementation(async (range) => {
      const result = await original(range);
      if (range.toBlock === 10) {
        startOld();
        await gate;
      }
      return result;
    });
    const old = readReceiveTreePath(f.request());
    await started;
    f.add(19n, 11);
    f.setLatest(11);
    expect(await readReceiveTreePath(f.request(3n))).toMatchObject({ leaf: 19n });
    finishOld();
    expect(await old).toMatchObject({ leaf: 17n });
    await readReceiveTreePath(f.request(3n));
    expect(f.provider.getLogs).toHaveBeenCalledTimes(2);
  });
  it("bounds retained public datasets and fully replays an evicted tree", async () => {
    const first = fixture();
    await readReceiveTreePath(first.request());
    for (let index = 0; index < 13; index++) {
      const next = fixture();
      await readReceiveTreePath(next.request());
    }
    await readReceiveTreePath(first.request());
    expect(first.provider.getLogs).toHaveBeenCalledTimes(2);
    expect(first.provider.getLogs.mock.calls[1][0]).toMatchObject({ fromBlock: 0 });
  });
  it("reuses a public cache across provider instances and scans only newly anchored blocks", async () => {
    const f = fixture();
    await readReceiveTreePath(f.request());
    f.add(19n, 11);
    f.setLatest(11);
    const getLogs = vi.fn(f.provider.getLogs.getMockImplementation()!);
    const contract = {
      ...f.contract,
      runner: { provider: { ...f.provider, getLogs } },
    } as unknown as Contract;
    expect(await readReceiveTreePath({ ...f.request(3n), contract })).toMatchObject({ leaf: 19n });
    expect(getLogs).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 11, toBlock: 11 }));
  });
  it("discards a reorganized cached ancestor and replays the full public history", async () => {
    const f = fixture();
    await readReceiveTreePath(f.request());
    f.blockHashes.set(10, hash(1010));
    f.setLatest(11);
    await readReceiveTreePath(f.request());
    expect(f.provider.getLogs.mock.calls[1][0]).toMatchObject({ fromBlock: 0, toBlock: 11 });
  });
  it.each(["prefix", "tail", "middle", "duplicate", "wrong root"])(
    "rejects %s corruption without falling back to an indexed getter",
    async (kind) => {
      const f = fixture();
      if (kind === "prefix") f.logs.shift();
      else if (kind === "tail") f.logs.pop();
      else if (kind === "middle") f.logs.splice(1, 1);
      else if (kind === "duplicate") f.logs.splice(1, 0, f.logs[0]);
      else {
        const event = iface.encodeEventLog(iface.getEvent("CredentialIssued")!, [1n, 13n, 999n]);
        Object.assign(f.logs[1], event);
      }
      await expect(readReceiveTreePath(f.request())).rejects.toThrow(
        /sequence|position|history|root/,
      );
      expect(f.contract.getCredentialProof).not.toHaveBeenCalled();
    },
  );
  it("fails on a reorg during replay and does not publish the partial cache", async () => {
    const f = fixture();
    let calls = 0;
    f.provider.getBlock.mockImplementation(async (number) => ({
      number,
      hash: ++calls === 1 ? hash(number) : hash(9999),
    }));
    await expect(readReceiveTreePath(f.request())).rejects.toThrow(/reorganized/);
    f.provider.getBlock.mockImplementation(async (number) => ({ number, hash: hash(number) }));
    await readReceiveTreePath(f.request());
    expect(f.provider.getLogs).toHaveBeenCalledTimes(2);
    expect(f.provider.getLogs.mock.calls[1][0]).toMatchObject({ fromBlock: 0 });
  });
  it("preserves a valid cached snapshot when a later scan fails and retries the missing interval", async () => {
    const f = fixture();
    await readReceiveTreePath(f.request());
    f.add(19n, 11);
    f.setLatest(11);
    const original = f.provider.getLogs.getMockImplementation()!;
    f.provider.getLogs.mockRejectedValueOnce(new Error("RPC unavailable"));
    await expect(readReceiveTreePath(f.request(3n))).rejects.toThrow("RPC unavailable");
    f.provider.getLogs.mockImplementation(original);
    await readReceiveTreePath(f.request(3n));
    expect(f.provider.getLogs.mock.calls[2][0]).toMatchObject({ fromBlock: 11 });
    expect(f.contract.getCredentialProof).not.toHaveBeenCalled();
  });
  it("rejects wrong network, bounds and invalid replay configuration", async () => {
    const f = fixture();
    await expect(readReceiveTreePath({ ...f.request(), chainId: 1n })).rejects.toThrow(
      /another chain/,
    );
    await expect(readReceiveTreePath(f.request(3n))).rejects.toThrow(/out of range/);
    await expect(readReceiveTreePath(f.request(-1n))).rejects.toThrow(/leaf index/);
    scan.blockChunk = 0;
    await expect(readReceiveTreePath(f.request())).rejects.toThrow(/replay range/);
  });
  it("uses configured bounded chunks while validating the whole append sequence", async () => {
    const f = fixture();
    scan.blockChunk = 2;
    await readReceiveTreePath(f.request());
    expect(
      f.provider.getLogs.mock.calls.map(([range]) => [range.fromBlock, range.toBlock]),
    ).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
      [6, 7],
      [8, 9],
      [10, 10],
    ]);
    const skipped = fixture();
    scan.fromBlock = 2;
    await expect(readReceiveTreePath(skipped.request())).rejects.toThrow(/sequence/);
  });
  it("supports source slots above Number.MAX_SAFE_INTEGER without rounding", async () => {
    const f = fixture(0);
    const leafIndex = (1n << 63n) + 5n;
    const siblings = Array<bigint>(64).fill(13n);
    let root = 11n;
    for (let i = 0; i < 64; i++)
      root =
        (leafIndex >> BigInt(i)) & 1n
          ? hashLineageNodes(siblings[i], root)
          : hashLineageNodes(root, siblings[i]);
    f.contract.sourceSize.mockResolvedValue(1n << 64n);
    f.contract.sourceRoot.mockResolvedValue(root);
    f.contract.getSourceProof.mockResolvedValue({
      leaf: 11n,
      root,
      depth: 64n,
      index: leafIndex,
      siblings,
    });
    expect(await readReceiveTreePath(f.request(leafIndex, "chain"))).toMatchObject({
      index: leafIndex,
      depth: 64n,
    });
    expect(f.contract.getSourceProof).toHaveBeenCalledWith(0, leafIndex, { blockTag: 10 });
  });
});

describe("receive tree proof and anchor validation", () => {
  it("validates singleton and maximum-depth compact paths and rejects malformed API data", () => {
    expect(
      validateReceiveTreePath(
        { leaf: 11n, root: 11n, depth: 0n, index: 0n, siblings: [] },
        11n,
        32,
      ),
    ).toMatchObject({ leaf: 11n, depth: 0n });
    const siblings = Array<bigint>(64).fill(13n);
    let root = 11n;
    for (const sibling of siblings) root = hashLineageNodes(root, sibling);
    const path = { leaf: 11n, root, depth: 64n, index: 0n, siblings };
    expect(validateReceiveTreePath(path, root, 64)).toMatchObject({ depth: 64n });
    expect(() => validateReceiveTreePath(path, root, 32)).toThrow(/membership/);
    for (const altered of [
      { ...path, root: 17n },
      { ...path, depth: 63n },
      { ...path, index: 1n << 64n },
      { ...path, siblings: [SNARK_SCALAR_FIELD, ...siblings.slice(1)] },
      { ...path, leaf: 0n },
      { ...path, siblings: [17n, ...siblings.slice(1)] },
    ])
      expect(() => validateReceiveTreePath(altered, root, 64)).toThrow();
  });
  it("reads uncached RPC anchors and detects a reorg even if normal getBlock is stale", async () => {
    let current = hash(10);
    const send = vi.fn(async (method: string) =>
      method === "eth_blockNumber" ? "0xa" : { number: "0xa", hash: current },
    );
    const getBlock = vi.fn(async () => ({ number: 10, hash: hash(10) }));
    const provider = { send, getBlock } as unknown as Provider;
    const anchor = await readReceiveTreeAnchor(provider);
    expect(anchor).toEqual({ blockNumber: 10, blockHash: hash(10) });
    expect(send).toHaveBeenCalledWith("eth_getBlockByNumber", ["0xa", false]);
    current = hash(9999);
    await expect(assertReceiveTreeAnchor(provider, anchor)).rejects.toThrow(/reorganized/);
    expect(getBlock).not.toHaveBeenCalled();
  });
  it("rejects unavailable or noncanonical anchor metadata", async () => {
    const f = fixture();
    expect(await readReceiveTreeAnchor(f.provider as unknown as Provider)).toEqual(
      f.request().anchor,
    );
    await expect(
      assertReceiveTreeAnchor(f.provider as unknown as Provider, {
        blockNumber: -1,
        blockHash: hash(1),
      }),
    ).rejects.toThrow(/anchor/);
    const unavailable = {
      send: vi.fn(async (method: string) => (method === "eth_blockNumber" ? "0xa" : null)),
    } as unknown as Provider;
    await expect(readReceiveTreeAnchor(unavailable)).rejects.toThrow(/unavailable/);
    const excessive = { send: vi.fn(async () => toBeHex(1n << 80n)) } as unknown as Provider;
    await expect(readReceiveTreeAnchor(excessive)).rejects.toThrow(/block number/);
  });
});
