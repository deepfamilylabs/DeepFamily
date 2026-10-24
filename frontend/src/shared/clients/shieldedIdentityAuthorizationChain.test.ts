import { describe, expect, it, vi } from "vitest";
import { Contract, Interface } from "ethers";
import {
  buildShieldedIdentityAuthorizationState,
  createShieldedIdentityAuthorizationTree,
  getShieldedIdentityAuthorizationWitness,
} from "@deepfamily/protocol-core";
import {
  IDENTITY_AUTHORIZATION_ABI,
  loadShieldedIdentityAuthorizationState,
  loadShieldedIdentityAuthorizationWitness,
  loadShieldedIdentityAuthorizationWitnessForMode,
} from "./shieldedIdentityAuthorizationChain";
import type { ShieldedStateReadMode } from "../config/shieldedStateReadMode";

type Filter = { address: string; topics: unknown[]; fromBlock: number; toBlock: number };

function fixture() {
  const iface = new Interface(IDENTITY_AUTHORIZATION_ABI);
  const records = new Map<bigint, bigint>();
  const empty = buildShieldedIdentityAuthorizationState();
  const updates: Array<{
    blockNumber: number;
    checkpointId: bigint;
    state: ReturnType<typeof buildShieldedIdentityAuthorizationState>;
    log: { data: string; topics: string[]; blockNumber: number; index: number; removed: boolean };
  }> = [];
  let head = 20;
  const network = { chainId: 31337n };
  const hashes = new Map<number, string>();
  const block = (number: number) => ({
    hash: hashes.get(number) ?? `0xblock-${number}`,
    timestamp: 1000 + number * 10,
  });
  const stateAt = (number: number) => {
    const matching = updates.filter((update) => update.blockNumber <= number);
    return matching[matching.length - 1];
  };
  const append = (blockNumber: number, alias: bigint) => {
    const before = updates[updates.length - 1]?.state ?? empty;
    const oldCounter = records.get(alias) ?? 0n;
    records.set(alias, oldCounter + 1n);
    const state = buildShieldedIdentityAuthorizationState(records);
    const checkpointId = BigInt(updates.length + 2);
    const encoded = iface.encodeEventLog(iface.getEvent("CounterIncremented")!, [
      checkpointId,
      alias,
      oldCounter,
      oldCounter + 1n,
      before.root,
      state.root,
      checkpointId + 99n,
    ]);
    const log = { ...encoded, blockNumber, index: 0, removed: false };
    updates.push({ blockNumber, checkpointId, state, log });
    return state;
  };
  const logsFor = (filter: Filter) =>
    updates
      .filter(
        (update) => update.blockNumber >= filter.fromBlock && update.blockNumber <= filter.toBlock,
      )
      .map((update) => update.log);
  const provider = {
    getNetwork: vi.fn(async () => network),
    getBlockNumber: vi.fn(async () => head),
    getBlock: vi.fn(async (number: number) => block(number)),
    getLogs: vi.fn(async (filter: Filter) => logsFor(filter)),
  };
  const contract = {
    interface: iface,
    runner: { provider },
    getAddress: vi.fn(async () => "0x1111111111111111111111111111111111111111"),
    creationBlock: vi.fn(async (_overrides: { blockTag: number }) => 10n),
    currentCheckpointId: vi.fn(
      async ({ blockTag }: { blockTag: number }) => stateAt(blockTag)?.checkpointId ?? 1n,
    ),
    currentRoot: vi.fn(
      async ({ blockTag }: { blockTag: number }) => stateAt(blockTag)?.state.root ?? 0n,
    ),
    getCheckpoint: vi.fn(async (id: bigint, _overrides: { blockTag: number }) => {
      const update = updates.find((candidate) => candidate.checkpointId === BigInt(id));
      return {
        root: update?.state.root ?? 0n,
        createdAt: BigInt(block(update?.blockNumber ?? 10).timestamp),
        retiredAt: 0n,
      };
    }),
  };
  const after = append(15, 17n);
  return {
    provider,
    contract,
    after,
    append,
    block,
    logsFor,
    network,
    load: () => loadShieldedIdentityAuthorizationState(contract as unknown as Contract),
    setHead: (number: number) => {
      head = number;
    },
    setHash: (number: number, hash: string) => {
      hashes.set(number, hash);
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function pathFixture(
  entries: Array<[bigint, bigint]> = [
    [17n, 1n],
    [18n, 2n],
  ],
) {
  const state = buildShieldedIdentityAuthorizationState(entries);
  const rawProof = (alias: bigint) => {
    const witness = getShieldedIdentityAuthorizationWitness(state, alias);
    return { ...witness, isOld0: witness.isOld0 === 1n, absent: witness.absent === 1n };
  };
  const address = "0x1111111111111111111111111111111111111111";
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId: 31337n })),
    getBlockNumber: vi.fn(async () => 20),
    getBlock: vi.fn(async (_number: number) => ({ hash: "0xanchor", timestamp: 1200 })),
    getLogs: vi.fn(async () => {
      throw new Error("History unavailable");
    }),
  };
  const contract = {
    runner: { provider },
    getAddress: vi.fn(async () => address),
    currentCheckpointId: vi.fn(async (_overrides: { blockTag: number }) => 2n),
    currentRoot: vi.fn(async (_overrides: { blockTag: number }) => state.root),
    getCounterProof: vi.fn(async (alias: bigint, _overrides: { blockTag: number }) =>
      rawProof(alias),
    ),
    getCheckpoint: vi.fn(async (_id: bigint, _overrides: { blockTag: number }) => ({
      root: state.root,
      createdAt: 1100n,
      retiredAt: 0n,
    })),
  };
  const scope = { chainId: 31337n, authorizationStateAddress: address };
  return {
    state,
    provider,
    contract,
    scope,
    rawProof,
    load: (alias = 17n) =>
      loadShieldedIdentityAuthorizationWitness(contract as unknown as Contract, alias, scope),
  };
}

describe("chain-native identity authorization paths", () => {
  it("reads an authenticated member at one block without any event history", async () => {
    const f = pathFixture();
    const result = await f.load();
    expect(result.witness).toEqual(getShieldedIdentityAuthorizationWitness(f.state, 17n));
    expect(result.stateRoot).toBe(f.state.root);
    expect(result.checkpointId).toBe(2n);
    expect(result.asOf).toBe(1200n);
    expect(result.blockNumber).toBe(20);
    expect(result.chainId).toBe(31337n);
    expect(result.authorizationStateAddress).toBe(f.scope.authorizationStateAddress);
    expect(f.provider.getLogs).not.toHaveBeenCalled();
    expect(f.contract.getCounterProof).toHaveBeenCalledExactlyOnceWith(17n, { blockTag: 20 });
    expect(f.contract.currentRoot).toHaveBeenCalledExactlyOnceWith({ blockTag: 20 });
    expect(f.contract.currentCheckpointId).toHaveBeenCalledExactlyOnceWith({ blockTag: 20 });
    expect(f.contract.getCheckpoint).toHaveBeenCalledExactlyOnceWith(2n, { blockTag: 20 });
  });

  it("authenticates zero only through empty or collision nonmembership", async () => {
    for (const entries of [[], [[17n, 1n]] as Array<[bigint, bigint]>]) {
      const f = pathFixture(entries);
      const result = await f.load(19n);
      expect(result.witness.authorizationCounter).toBe(0n);
      expect(result.witness.absent).toBe(1n);
      expect(result.witness).toEqual(getShieldedIdentityAuthorizationWitness(f.state, 19n));
      expect(f.provider.getLogs).not.toHaveBeenCalled();
    }
  });

  it("rejects malformed paths, mismatched roots and a different queried alias", async () => {
    for (const patch of [
      { stateRoot: 1n },
      { authorizationCounter: 0n },
      { depth: 65n },
      { oldValue: 3n },
      { absent: true },
      { isOld0: true },
      { siblings: Array(64).fill(0n) },
      { siblings: Array(63).fill(0n) },
      { siblings: [...Array(63).fill(0n), 1n] },
    ]) {
      const f = pathFixture();
      f.contract.getCounterProof.mockResolvedValueOnce({ ...f.rawProof(17n), ...patch });
      await expect(f.load()).rejects.toThrow();
      expect(f.provider.getLogs).not.toHaveBeenCalled();
    }
    const f = pathFixture();
    f.contract.getCounterProof.mockResolvedValueOnce(f.rawProof(18n));
    await expect(f.load()).rejects.toThrow();
    const g = pathFixture();
    g.contract.currentRoot.mockResolvedValueOnce(42n);
    await expect(g.load()).rejects.toThrow("root does not match");
  });

  it("rejects invalid live checkpoints and never falls back to counter zero", async () => {
    for (const checkpoint of [
      { root: 42n, createdAt: 1100n, retiredAt: 0n },
      { root: pathFixture().state.root, createdAt: 1201n, retiredAt: 0n },
      { root: pathFixture().state.root, createdAt: 1100n, retiredAt: 1n },
    ]) {
      const f = pathFixture();
      f.contract.getCheckpoint.mockResolvedValueOnce(checkpoint);
      await expect(f.load()).rejects.toThrow("time is inconsistent");
    }
    const f = pathFixture();
    f.contract.currentCheckpointId.mockResolvedValueOnce(0n);
    await expect(f.load()).rejects.toThrow("unavailable");
    f.contract.getCounterProof.mockRejectedValueOnce(new Error("RPC unavailable"));
    await expect(f.load()).rejects.toThrow("RPC unavailable");
    expect((await f.load()).witness.authorizationCounter).toBe(1n);
  });

  it("rejects block reorganization or scope change during a path read", async () => {
    const f = pathFixture();
    f.provider.getBlock
      .mockResolvedValueOnce({ hash: "0xanchor", timestamp: 1200 })
      .mockResolvedValueOnce({ hash: "0xreorg", timestamp: 1200 });
    await expect(f.load()).rejects.toThrow("reorganized");
    const g = pathFixture();
    g.provider.getNetwork
      .mockResolvedValueOnce({ chainId: 31337n })
      .mockResolvedValueOnce({ chainId: 1030n });
    await expect(g.load()).rejects.toThrow("scope changed");
    const h = pathFixture();
    h.contract.getAddress
      .mockResolvedValueOnce(h.scope.authorizationStateAddress)
      .mockResolvedValueOnce("0x2222222222222222222222222222222222222222");
    await expect(h.load()).rejects.toThrow("scope changed");
  });

  it("checks the caller's chain and contract scope before requesting a path", async () => {
    const f = pathFixture();
    for (const scope of [
      { ...f.scope, chainId: 1030n },
      { ...f.scope, authorizationStateAddress: "0x2222222222222222222222222222222222222222" },
    ])
      await expect(
        loadShieldedIdentityAuthorizationWitness(f.contract as unknown as Contract, 17n, scope),
      ).rejects.toThrow("scope does not match");
    expect(f.contract.getCounterProof).not.toHaveBeenCalled();
  });
});

describe("identity authorization read modes", () => {
  it("reads a local path without exporting a complete public-state snapshot", async () => {
    const f = fixture();
    const expected = getShieldedIdentityAuthorizationWitness(f.after, 17n);
    const prototype = Object.getPrototypeOf(createShieldedIdentityAuthorizationTree());
    const snapshot = vi.spyOn(prototype, "snapshot").mockImplementation(() => {
      throw new Error("Full state export is unavailable");
    });
    try {
      const result = await loadShieldedIdentityAuthorizationWitnessForMode(
        f.contract as unknown as Contract,
        17n,
      );
      expect(result.witness).toEqual(expected);
      expect(snapshot).not.toHaveBeenCalled();
      await expect(f.load()).rejects.toThrow("Full state export is unavailable");
    } finally {
      snapshot.mockRestore();
    }
  });

  it.each([undefined, "rebuild"] as const)(
    "keeps alias queries local for mode %s",
    async (mode) => {
      const f = fixture();
      const getCounterProof = vi.fn(async () => {
        throw new Error("Target queries forbidden");
      });
      const contract = { ...f.contract, getCounterProof };
      const scope = { chainId: 31337n, authorizationStateAddress: await f.contract.getAddress() };
      const result = await loadShieldedIdentityAuthorizationWitnessForMode(
        contract as unknown as Contract,
        17n,
        mode,
        scope,
      );
      expect(result.witness).toEqual(getShieldedIdentityAuthorizationWitness(f.after, 17n));
      expect(result.stateRoot).toBe(f.after.root);
      expect(result.blockHash).toBe("0xblock-20");
      expect(result.chainId).toBe(31337n);
      expect(result.authorizationStateAddress).toBe(scope.authorizationStateAddress);
      expect(getCounterProof).not.toHaveBeenCalled();
      expect(f.provider.getLogs).toHaveBeenCalled();
      for (const [filter] of f.provider.getLogs.mock.calls)
        expect(filter.topics).toEqual([
          f.contract.interface.getEvent("CounterIncremented")!.topicHash,
        ]);
    },
  );

  it("uses explicit chain mode even when historical logs cannot be read", async () => {
    const f = pathFixture();
    const result = await loadShieldedIdentityAuthorizationWitnessForMode(
      f.contract as unknown as Contract,
      17n,
      "chain",
      f.scope,
    );
    expect(result.witness.authorizationCounter).toBe(1n);
    expect(f.contract.getCounterProof).toHaveBeenCalledExactlyOnceWith(17n, { blockTag: 20 });
    expect(f.provider.getLogs).not.toHaveBeenCalled();
  });

  it("rejects unknown request modes before sending any chain requests", async () => {
    const f = pathFixture();
    await expect(
      loadShieldedIdentityAuthorizationWitnessForMode(
        f.contract as unknown as Contract,
        17n,
        "onchain" as ShieldedStateReadMode,
        f.scope,
      ),
    ).rejects.toThrow("Unsupported shielded state read mode");
    expect(f.provider.getNetwork).not.toHaveBeenCalled();
    expect(f.contract.getCounterProof).not.toHaveBeenCalled();
    expect(f.provider.getLogs).not.toHaveBeenCalled();
  });

  it("does not switch to a targeted query after a rebuild failure", async () => {
    const f = fixture();
    f.provider.getLogs.mockRejectedValueOnce(new Error("History unavailable"));
    const getCounterProof = vi.fn();
    await expect(
      loadShieldedIdentityAuthorizationWitnessForMode(
        { ...f.contract, getCounterProof } as unknown as Contract,
        17n,
      ),
    ).rejects.toThrow("History unavailable");
    expect(getCounterProof).not.toHaveBeenCalled();
  });

  it("does not switch to historical scans after a targeted-query failure", async () => {
    const f = pathFixture();
    f.contract.getCounterProof.mockRejectedValueOnce(new Error("Path unavailable"));
    await expect(
      loadShieldedIdentityAuthorizationWitnessForMode(
        f.contract as unknown as Contract,
        17n,
        "chain",
        f.scope,
      ),
    ).rejects.toThrow("Path unavailable");
    expect(f.provider.getLogs).not.toHaveBeenCalled();
  });

  it("rejects replay root, scope and anchor mismatches without trying a targeted query", async () => {
    for (const failure of ["root", "scope", "reorg", "switch"] as const) {
      const f = fixture();
      const getCounterProof = vi.fn();
      if (failure === "root") f.contract.currentRoot.mockResolvedValueOnce(42n);
      if (failure === "reorg")
        f.provider.getBlock
          .mockResolvedValueOnce({ hash: "0xblock-20", timestamp: 1200 })
          .mockResolvedValueOnce({ hash: "0xreorg", timestamp: 1200 });
      if (failure === "switch")
        f.provider.getNetwork
          .mockResolvedValueOnce({ chainId: 31337n })
          .mockResolvedValueOnce({ chainId: 1030n });
      const scope = {
        chainId: failure === "scope" ? 1030n : 31337n,
        authorizationStateAddress: await f.contract.getAddress(),
      };
      await expect(
        loadShieldedIdentityAuthorizationWitnessForMode(
          { ...f.contract, getCounterProof } as unknown as Contract,
          17n,
          "rebuild",
          scope,
        ),
      ).rejects.toThrow();
      expect(getCounterProof).not.toHaveBeenCalled();
    }
  });
});

describe("identity authorization chain replay", () => {
  it("rebuilds the canonical dictionary without an identity or alias RPC filter", async () => {
    const f = fixture();
    const result = await f.load();
    expect(result.state).toEqual(f.after);
    expect(result.checkpointId).toBe(2n);
    expect(result.asOf).toBe(1200n);
    expect(f.provider.getLogs).toHaveBeenCalledExactlyOnceWith({
      address: await f.contract.getAddress(),
      topics: [f.contract.interface.getEvent("CounterIncremented")!.topicHash],
      fromBlock: 10,
      toBlock: 20,
    });
  });

  it("scans only newer blocks and matches full rebuilds for new and repeated aliases", async () => {
    const f = fixture();
    const first = await f.load();
    f.append(22, 18n);
    const latest = f.append(24, 17n);
    f.setHead(25);
    const result = await f.load();
    expect(result.state).toEqual(latest);
    expect(result.state.entries).toEqual(
      new Map([
        [17n, 2n],
        [18n, 1n],
      ]),
    );
    expect(result.checkpointId).toBe(4n);
    expect(first.state).toEqual(f.after);
    expect(
      f.provider.getLogs.mock.calls.map(([filter]) => [filter.fromBlock, filter.toBlock]),
    ).toEqual([
      [10, 20],
      [21, 25],
    ]);
    for (const [filter] of f.provider.getLogs.mock.calls)
      expect(filter.topics).toEqual([
        f.contract.interface.getEvent("CounterIncremented")!.topicHash,
      ]);
  });

  it("skips logs at the same head while rechecking the live root and checkpoint", async () => {
    const f = fixture();
    await f.load();
    expect((await f.load()).state).toEqual(f.after);
    expect(f.provider.getLogs).toHaveBeenCalledTimes(1);
    expect(f.contract.currentRoot).toHaveBeenCalledTimes(2);
    expect(f.contract.currentCheckpointId).toHaveBeenCalledTimes(2);
    expect(f.contract.getCheckpoint).toHaveBeenCalledTimes(2);
    f.contract.currentRoot.mockResolvedValueOnce(42n);
    await expect(f.load()).rejects.toThrow("does not match replay");
    f.contract.getCheckpoint.mockResolvedValueOnce({
      root: f.after.root,
      createdAt: 1100n,
      retiredAt: 1n,
    });
    await expect(f.load()).rejects.toThrow("time is inconsistent");
    expect((await f.load()).state).toEqual(f.after);
    expect(f.provider.getLogs).toHaveBeenCalledTimes(1);
  });

  it("isolates cached nodes and records from returned entries and root mutations", async () => {
    const f = fixture();
    const first = await f.load();
    first.state.root = 42n;
    first.state.entries.set(17n, 99n);
    first.state.entries.set(19n, 1n);
    const second = await f.load();
    expect(second.state).toEqual(f.after);
    second.state.entries.clear();
    const latest = f.append(22, 17n);
    f.setHead(25);
    expect((await f.load()).state).toEqual(latest);
    expect(f.provider.getLogs.mock.calls.map(([filter]) => filter.fromBlock)).toEqual([10, 21]);
  });

  it("replays from deployment when the previous anchor changes", async () => {
    const f = fixture();
    await f.load();
    f.setHash(20, "0xreorganized-20");
    const latest = f.append(22, 18n);
    f.setHead(25);
    expect((await f.load()).state).toEqual(latest);
    expect(
      f.provider.getLogs.mock.calls.map(([filter]) => [filter.fromBlock, filter.toBlock]),
    ).toEqual([
      [10, 20],
      [10, 25],
    ]);
  });

  it("replays from deployment when the chain head moves behind the cache", async () => {
    const f = fixture();
    f.append(22, 18n);
    f.setHead(25);
    await f.load();
    f.setHead(18);
    const earlier = await f.load();
    expect(earlier.state).toEqual(f.after);
    expect(earlier.checkpointId).toBe(2n);
    expect(
      f.provider.getLogs.mock.calls.map(([filter]) => [filter.fromBlock, filter.toBlock]),
    ).toEqual([
      [10, 25],
      [10, 18],
    ]);
  });

  it("rejects a reorganization during replay without publishing a partially updated cache", async () => {
    const f = fixture();
    await f.load();
    const latest = f.append(22, 18n);
    f.setHead(25);
    let reads = 0;
    f.provider.getBlock.mockImplementation(async (number) => {
      if (number === 25 && ++reads > 1) return { hash: "0xnew-25", timestamp: 1250 };
      return f.block(number);
    });
    await expect(f.load()).rejects.toThrow("reorganized");
    f.provider.getBlock.mockImplementation(async (number) => f.block(number));
    expect((await f.load()).state).toEqual(latest);
    expect(
      f.provider.getLogs.mock.calls.map(([filter]) => [filter.fromBlock, filter.toBlock]),
    ).toEqual([
      [10, 20],
      [21, 25],
      [21, 25],
    ]);
  });

  it.each(["logs", "root", "checkpoint"] as const)(
    "retries after a %s failure without poisoning the previous cache",
    async (failure) => {
      const f = fixture();
      await f.load();
      const latest = f.append(22, 18n);
      f.setHead(25);
      if (failure === "logs")
        f.provider.getLogs.mockRejectedValueOnce(new Error("RPC unavailable"));
      if (failure === "root")
        f.contract.currentRoot.mockRejectedValueOnce(new Error("RPC unavailable"));
      if (failure === "checkpoint")
        f.contract.getCheckpoint.mockRejectedValueOnce(new Error("RPC unavailable"));
      await expect(f.load()).rejects.toThrow("RPC unavailable");
      expect((await f.load()).state).toEqual(latest);
      const ranges = f.provider.getLogs.mock.calls.map(([filter]) => [
        filter.fromBlock,
        filter.toBlock,
      ]);
      expect(ranges).toEqual(
        failure === "root"
          ? [
              [10, 20],
              [21, 25],
            ]
          : [
              [10, 20],
              [21, 25],
              [21, 25],
            ],
      );
    },
  );

  it("isolates cached mirrors by contract address, chain and provider", async () => {
    const f = fixture();
    await f.load();
    const otherContract = {
      ...f.contract,
      getAddress: async () => "0x2222222222222222222222222222222222222222",
    };
    await loadShieldedIdentityAuthorizationState(otherContract as unknown as Contract);
    f.network.chainId = 1030n;
    await f.load();
    f.network.chainId = 31337n;
    await f.load();
    const otherProvider = { ...f.provider };
    await loadShieldedIdentityAuthorizationState({
      ...f.contract,
      runner: { provider: otherProvider },
    } as unknown as Contract);
    expect(
      f.provider.getLogs.mock.calls.map(([filter]) => [filter.address, filter.fromBlock]),
    ).toEqual([
      ["0x1111111111111111111111111111111111111111", 10],
      ["0x2222222222222222222222222222222222222222", 10],
      ["0x1111111111111111111111111111111111111111", 10],
      ["0x1111111111111111111111111111111111111111", 10],
    ]);
  });

  it("keeps a newer cache when an older concurrent request finishes later", async () => {
    const f = fixture();
    await f.load();
    const olderState = f.append(22, 18n);
    f.setHead(25);
    const started = deferred();
    const release = deferred();
    f.provider.getLogs.mockImplementationOnce(async (filter) => {
      started.resolve();
      await release.promise;
      return f.logsFor(filter);
    });
    const older = f.load();
    await started.promise;
    const newerState = f.append(28, 17n);
    f.setHead(30);
    const newer = await f.load();
    release.resolve();
    expect((await older).state).toEqual(olderState);
    expect(newer.state).toEqual(newerState);
    f.provider.getLogs.mockClear();
    f.setHead(31);
    expect((await f.load()).state).toEqual(newerState);
    expect(
      f.provider.getLogs.mock.calls.map(([filter]) => [filter.fromBlock, filter.toBlock]),
    ).toEqual([[31, 31]]);
  });

  it("rejects missing updates and replayed roots that differ from live state", async () => {
    const f = fixture();
    f.provider.getLogs.mockResolvedValueOnce([]);
    await expect(f.load()).rejects.toThrow("does not match replay");
    expect((await f.load()).state).toEqual(f.after);
    expect(f.provider.getLogs.mock.calls.map(([filter]) => filter.fromBlock)).toEqual([10, 10]);
    const g = fixture();
    g.contract.currentRoot.mockResolvedValueOnce(42n);
    await expect(g.load()).rejects.toThrow("does not match replay");
  });
});
