import { afterEach, describe, expect, it, vi } from "vitest";
import { Interface, toBeHex, type ContractRunner, type Log } from "ethers";
import { createLineageTree } from "@deepfamily/protocol-core";
import {
  ELIGIBILITY_SOURCE_ABI,
  POOL_ABI,
  RECEIVE_REGISTRY_ABI,
  ReceiveChain,
} from "./receiveChain";

let fixtureIndex = 0;
function setup() {
  const base = 0x10000n + BigInt(++fixtureIndex) * 16n;
  const registryAddress = toBeHex(base + 1n, 20),
    poolAddress = toBeHex(base + 2n, 20),
    sourceAddress = toBeHex(base + 3n, 20);
  const deployment = { chainId: 31337n, registryAddress, poolAddress };
  const registry = new Interface(RECEIVE_REGISTRY_ABI),
    pool = new Interface(POOL_ABI),
    source = new Interface(ELIGIBILITY_SOURCE_ABI);
  const credentials = createLineageTree(),
    facts = createLineageTree(),
    trusted = createLineageTree();
  const logs: Log[] = [];
  const calls: { name: string; args: unknown[]; blockTag: unknown }[] = [];
  for (const [tree, leaves, treeId] of [
    [credentials, [11n, 13n, 17n], undefined],
    [facts, [23n, 29n], 0],
    [trusted, [31n, 37n, 41n], 1],
  ] as const) {
    for (const [index, leaf] of leaves.entries()) {
      tree.insert(leaf);
      const event =
        treeId === undefined
          ? registry.encodeEventLog(registry.getEvent("CredentialIssued")!, [
              index,
              leaf,
              tree.root,
            ])
          : source.encodeEventLog(source.getEvent("SourceLeafPublished")!, [
              treeId,
              index,
              leaf,
              tree.root,
            ]);
      logs.push({
        ...event,
        address: treeId === undefined ? registryAddress : sourceAddress,
        blockNumber: 10 + logs.length,
        blockHash: toBeHex(100n, 32),
        transactionHash: toBeHex(BigInt(logs.length + 1), 32),
        transactionIndex: 0,
        index: logs.length,
        removed: false,
      } as unknown as Log);
    }
  }
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId: 31337n })),
    getBlockNumber: vi.fn(async () => 100),
    getBlock: vi.fn(async (number: number) => ({ number, hash: toBeHex(100n, 32) })),
    getLogs: vi.fn(
      async (filter: {
        address: string;
        topics: (string | string[] | null)[];
        fromBlock: number;
        toBlock: number;
      }) =>
        logs.filter(
          (log) =>
            log.address.toLowerCase() === filter.address.toLowerCase() &&
            log.blockNumber >= filter.fromBlock &&
            log.blockNumber <= filter.toBlock &&
            filter.topics.every(
              (topic, i) =>
                topic === null ||
                (Array.isArray(topic) ? topic.includes(log.topics[i]) : topic === log.topics[i]),
            ),
        ),
    ),
  };
  const path = (tree: typeof credentials, index: bigint) => {
    const value = tree.generateProof(index);
    return [value.leaf, value.root, value.index, value.siblings.length, value.siblings];
  };
  let corruptPath = false;
  const runner = {
    provider,
    call: async (transaction: { to: string; data: string; blockTag?: unknown }) => {
      const address = transaction.to.toLowerCase();
      const abi = address === poolAddress ? pool : address === registryAddress ? registry : source;
      const parsed = abi.parseTransaction({ data: transaction.data })!;
      const { name, args } = parsed;
      calls.push({ name, args: Array.from(args), blockTag: transaction.blockTag });
      let values: unknown[];
      if (name === "RECEIVE_REGISTRY") values = [registryAddress];
      else if (name === "protocolVersion") values = [1n];
      else if (name === "SOURCE") values = [sourceAddress];
      else if (name === "credentialCount") values = [credentials.sizeBigInt];
      else if (name === "issuanceRoot") values = [credentials.root];
      else if (name === "isKnownIssuanceRoot") values = [true];
      else if (name === "sourceRoot") values = [facts.root];
      else if (name === "trustedRoot") values = [trusted.root];
      else if (name === "sourceSize")
        values = [Number(args[0]) === 0 ? facts.sizeBigInt : trusted.sizeBigInt];
      else if (name === "getCredentialProof") values = path(credentials, BigInt(args[0]));
      else if (name === "getSourceProof")
        values = path(Number(args[0]) === 0 ? facts : trusted, BigInt(args[1]));
      else throw new Error(`Unexpected ${name}`);
      if (corruptPath && (name === "getCredentialProof" || name === "getSourceProof"))
        values[1] = BigInt(values[1] as bigint) + 1n;
      return abi.encodeFunctionResult(name, values);
    },
  } as unknown as ContractRunner;
  return {
    deployment,
    runner,
    provider,
    calls,
    credentials,
    facts,
    trusted,
    logs,
    corrupt: () => {
      corruptPath = true;
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("receiving path strategy integration", () => {
  it("uses the build default to rebuild qualification paths without indexed RPC reads", async () => {
    vi.stubEnv("VITE_SHIELDED_STATE_READ_MODE", "");
    vi.stubEnv("VITE_DF_EVENT_FROM_BLOCK", "0");
    const test = setup(),
      chain = new ReceiveChain(test.deployment, test.runner);
    expect(chain.stateReadMode).toBe("rebuild");
    const actual = await chain.readCredentialProof(2n),
      expected = test.credentials.generateProof(2n);
    expect(actual).toEqual({
      ...expected,
      depth: BigInt(expected.siblings.length),
      index: BigInt(expected.index),
    });
    expect(test.calls.some((call) => call.name === "getCredentialProof")).toBe(false);
    expect(test.provider.getLogs).toHaveBeenCalled();
    for (const [filter] of test.provider.getLogs.mock.calls) expect(filter.topics).toHaveLength(1);
    expect(test.calls.every((call) => call.blockTag === 100)).toBe(true);
  });

  it("honors explicit chain mode and validates the returned compact path", async () => {
    vi.stubEnv("VITE_SHIELDED_STATE_READ_MODE", "chain");
    const test = setup(),
      chain = new ReceiveChain(test.deployment, test.runner);
    expect(chain.stateReadMode).toBe("chain");
    expect((await chain.readCredentialProof(1n)).leaf).toBe(13n);
    expect(test.calls.filter((call) => call.name === "getCredentialProof")).toMatchObject([
      { args: [1n], blockTag: 100 },
    ]);
    expect(test.provider.getLogs).not.toHaveBeenCalled();
    test.corrupt();
    await expect(chain.readCredentialProof(1n)).rejects.toThrow();
  });

  it("prepares both Source paths using one block and no requested-leaf log filters", async () => {
    vi.stubEnv("VITE_SHIELDED_STATE_READ_MODE", "rebuild");
    vi.stubEnv("VITE_DF_EVENT_FROM_BLOCK", "0");
    const test = setup(),
      chain = new ReceiveChain(test.deployment, test.runner);
    const actual = await chain.readSourcePaths(1n, 2n);
    expect(actual.sourcePath.leaf).toBe(29n);
    expect(actual.trustedPath.leaf).toBe(41n);
    expect(actual.sourceRoot).toBe(test.facts.root);
    expect(actual.trustedRoot).toBe(test.trusted.root);
    expect(actual.blockNumber).toBe(100);
    expect(test.calls.every((call) => call.blockTag === 100)).toBe(true);
    expect(test.calls.some((call) => call.name === "getSourceProof")).toBe(false);
    for (const [filter] of test.provider.getLogs.mock.calls)
      expect(filter.topics.length).toBeLessThanOrEqual(2);
    expect(test.calls.filter((call) => call.name === "SOURCE")).toHaveLength(1);
  });

  it("uses the same paired Source API for chain mode and keeps failure closed in rebuild mode", async () => {
    const test = setup(),
      chain = new ReceiveChain(test.deployment, test.runner, { stateReadMode: "chain" });
    const paths = await chain.readSourcePaths(0n, 1n);
    expect(paths.sourcePath.leaf).toBe(23n);
    expect(paths.trustedPath.leaf).toBe(37n);
    expect(test.provider.getLogs).not.toHaveBeenCalled();
    expect(test.calls.filter((call) => call.name === "getSourceProof")).toMatchObject([
      { args: [0n, 0n], blockTag: 100 },
      { args: [1n, 1n], blockTag: 100 },
    ]);
    const failed = setup();
    failed.provider.getLogs.mockRejectedValue(new Error("RPC history unavailable"));
    const rebuilding = new ReceiveChain(failed.deployment, failed.runner, {
      stateReadMode: "rebuild",
    });
    await expect(rebuilding.readCredentialProof(0n)).rejects.toThrow("RPC history unavailable");
    expect(failed.calls.some((call) => call.name === "getCredentialProof")).toBe(false);
  });

  it("rejects invalid indices and strategy values instead of changing lookup semantics", async () => {
    const test = setup(),
      chain = new ReceiveChain(test.deployment, test.runner);
    for (const index of [-1n, 1n << 32n])
      await expect(chain.readCredentialProof(index)).rejects.toThrow(/index/);
    await expect(chain.readSourceProof(2 as 0, 0n)).rejects.toThrow(/tree/);
    expect(
      () =>
        new ReceiveChain(test.deployment, test.runner, { stateReadMode: "automatic" as "chain" }),
    ).toThrow(/mode/);
    expect(test.provider.getLogs).not.toHaveBeenCalled();
  });
});
