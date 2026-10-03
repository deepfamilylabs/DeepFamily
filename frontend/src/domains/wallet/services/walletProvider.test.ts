import { BrowserProvider, type Eip1193Provider } from "ethers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWalletProvider } from "./walletProvider";

const LOCAL_CHAIN = "0x7a69";
const ACCOUNT = `0x${"1".repeat(40)}`;
const OTHER_ACCOUNT = `0x${"2".repeat(40)}`;
const TOKEN = `0x${"3".repeat(40)}`;
const POOL = `0x${"4".repeat(40)}`;
const APPROVE = { from: ACCOUNT, to: TOKEN, data: "0x095ea7b3" };
const SHIELD = { from: ACCOUNT, to: POOL, data: "0x12345678" };

type RpcRequest = { jsonrpc: string; id: number; method: string; params: unknown[] };
type Transaction = Record<string, unknown> & { from: string; nonce?: string };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function rpcResponse(request: RpcRequest, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
}

/** MetaMask retains its previous nonce; the automining node advances immediately. */
function createHarness() {
  const state = {
    walletChain: LOCAL_CHAIN,
    rpcChain: LOCAL_CHAIN,
    pending: new Map([
      [ACCOUNT, 1345n],
      [OTHER_ACCOUNT, 17n],
    ]),
    cachedWalletNonce: new Map<string, bigint>(),
    transactions: [] as Transaction[],
    nonceReads: [] as { address: string; block: unknown; nonce: bigint }[],
    rpcRequests: [] as RpcRequest[],
    beforeSend: undefined as ((transaction: Transaction) => Promise<void>) | undefined,
    afterMine: undefined as (() => void) | undefined,
    response: undefined as
      | ((request: RpcRequest, init: RequestInit) => Response | Promise<Response>)
      | undefined,
  };

  const request = vi.fn(async ({ method, params }: Parameters<Eip1193Provider["request"]>[0]) => {
    if (method === "eth_chainId") return state.walletChain;
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [ACCOUNT];
    if (method !== "eth_sendTransaction" || !Array.isArray(params)) {
      throw new Error(`Unexpected injected-wallet request: ${method}`);
    }
    const transaction = { ...params[0] } as Transaction;
    state.transactions.push(transaction);
    await state.beforeSend?.(transaction);
    const address = transaction.from.toLowerCase();
    const pending = state.pending.get(address) ?? 0n;
    if (!state.cachedWalletNonce.has(address)) state.cachedWalletNonce.set(address, pending);
    const nonce =
      transaction.nonce == null ? state.cachedWalletNonce.get(address)! : BigInt(transaction.nonce);
    if (nonce !== pending) {
      throw {
        code: -32603,
        message: `Nonce too low. Expected nonce to be ${pending} but got ${nonce}. Note that transactions can't be queued when automining.`,
      };
    }
    state.pending.set(address, pending + 1n);
    state.afterMine?.();
    return `0x${state.transactions.length.toString(16).padStart(64, "0")}`;
  });
  const raw: Eip1193Provider = { request };

  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toBe("http://127.0.0.1:8545");
    expect(init?.cache).toBe("no-store");
    const payload = JSON.parse(String(init?.body)) as RpcRequest;
    state.rpcRequests.push(payload);
    if (state.response) return state.response(payload, init!);
    if (payload.method === "eth_chainId") return rpcResponse(payload, state.rpcChain);
    if (payload.method === "eth_getTransactionCount") {
      const [address, block] = payload.params;
      const nonce = state.pending.get(String(address).toLowerCase()) ?? 0n;
      state.nonceReads.push({ address: String(address), block, nonce });
      return rpcResponse(payload, `0x${nonce.toString(16)}`);
    }
    throw new Error(`Unexpected direct-node request: ${payload.method}`);
  });

  vi.stubGlobal("fetch", fetch);
  return { state, raw, request, fetch };
}

const providers: BrowserProvider[] = [];

function createProvider(raw: Eip1193Provider, wrapped = true) {
  const provider = wrapped ? createWalletProvider(raw) : new BrowserProvider(raw);
  providers.push(provider);
  return provider;
}

beforeEach(() => {
  vi.stubEnv("DEV", true);
});

afterEach(() => {
  for (const provider of providers.splice(0)) provider.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("createWalletProvider local development transactions", () => {
  it("reproduces the stale wallet nonce through an unwrapped ethers BrowserProvider", async () => {
    const { raw, state, fetch } = createHarness();
    const provider = createProvider(raw, false);

    await provider.send("eth_sendTransaction", [APPROVE]);
    await expect(provider.send("eth_sendTransaction", [SHIELD])).rejects.toMatchObject({
      code: "NONCE_EXPIRED",
    });
    expect(state.pending.get(ACCOUNT)).toBe(1346n);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("completes repeated approve/shield pairs despite MetaMask's stale nonce", async () => {
    const { raw, state } = createHarness();
    const provider = createProvider(raw);

    for (const transaction of [APPROVE, SHIELD, APPROVE, SHIELD]) {
      await expect(provider.send("eth_sendTransaction", [transaction])).resolves.toMatch(/^0x/);
    }

    expect(state.pending.get(ACCOUNT)).toBe(1349n);
    expect(state.nonceReads).toEqual(
      [1345n, 1346n, 1347n, 1348n].map((nonce) => ({
        address: ACCOUNT,
        block: "pending",
        nonce,
      })),
    );
    expect(state.transactions.map(({ to }) => to)).toEqual([TOKEN, POOL, TOKEN, POOL]);
    expect(state.transactions.every(({ chainId }) => chainId === LOCAL_CHAIN)).toBe(true);
    expect(APPROVE).not.toHaveProperty("nonce");
    expect(SHIELD).not.toHaveProperty("nonce");
  });

  it("serializes simultaneous sends even after recreating the provider for the same wallet", async () => {
    const { raw, state, request } = createHarness();
    const entered = deferred();
    const release = deferred();
    state.beforeSend = async () => {
      if (state.transactions.length === 1) {
        entered.resolve();
        await release.promise;
      }
    };
    const original = createProvider(raw);
    const recreated = createProvider(raw);
    await Promise.all([original.getNetwork(), recreated.getNetwork()]);

    const first = original.send("eth_sendTransaction", [APPROVE]);
    await entered.promise;
    const initialChainReads = request.mock.calls.filter(
      ([call]) => call.method === "eth_chainId",
    ).length;
    const second = recreated.send("eth_sendTransaction", [SHIELD]);
    try {
      await vi.waitFor(() =>
        expect(
          request.mock.calls.filter(([call]) => call.method === "eth_chainId").length,
        ).toBeGreaterThan(initialChainReads),
      );
      expect(state.nonceReads).toHaveLength(1);
      expect(state.transactions).toHaveLength(1);
    } finally {
      release.resolve();
    }
    await Promise.all([first, second]);

    expect(state.pending.get(ACCOUNT)).toBe(1347n);
    expect(state.nonceReads.map(({ nonce }) => nonce)).toEqual([1345n, 1346n]);
  });

  it("reads the current node state after another transaction advances the account", async () => {
    const { raw, state } = createHarness();
    const provider = createProvider(raw);
    await provider.send("eth_sendTransaction", [APPROVE]);
    state.pending.set(ACCOUNT, 1352n);

    await provider.send("eth_sendTransaction", [SHIELD]);

    expect(state.pending.get(ACCOUNT)).toBe(1353n);
    expect(state.nonceReads.map(({ nonce }) => nonce)).toEqual([1345n, 1352n]);
  });

  it("uses each sending account's nonce without blocking a different account", async () => {
    const { raw, state } = createHarness();
    const entered = deferred();
    const release = deferred();
    state.beforeSend = async ({ from }) => {
      if (from === ACCOUNT) {
        entered.resolve();
        await release.promise;
      }
    };
    const provider = createProvider(raw);
    const first = provider.send("eth_sendTransaction", [APPROVE]);
    await entered.promise;
    try {
      await provider.send("eth_sendTransaction", [{ ...SHIELD, from: OTHER_ACCOUNT }]);
      expect(state.pending.get(OTHER_ACCOUNT)).toBe(18n);
      expect(state.pending.get(ACCOUNT)).toBe(1345n);
    } finally {
      release.resolve();
      await first;
    }
    expect(state.nonceReads.map(({ address, nonce }) => [address, nonce])).toEqual([
      [ACCOUNT, 1345n],
      [OTHER_ACCOUNT, 17n],
    ]);
  });

  it("preserves a caller's explicit nonce", async () => {
    const { raw, state, fetch } = createHarness();
    const transaction = { ...APPROVE, nonce: "0x541" };
    await createProvider(raw).send("eth_sendTransaction", [transaction]);

    expect(state.transactions).toEqual([transaction]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { dev: true, chain: "0x1", name: "Ethereum mainnet" },
    { dev: true, chain: "0x406", name: "Conflux eSpace" },
    { dev: false, chain: LOCAL_CHAIN, name: "a production build on localhost" },
  ])("leaves wallet nonce management unchanged for $name", async ({ dev, chain }) => {
    vi.stubEnv("DEV", dev);
    const { raw, state, fetch } = createHarness();
    state.walletChain = chain;
    await createProvider(raw).send("eth_sendTransaction", [APPROVE]);

    expect(state.transactions).toEqual([APPROVE]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not use the local nonce if the wallet switches networks during the read", async () => {
    const { raw, state } = createHarness();
    state.response = (request) => {
      if (request.method === "eth_getTransactionCount") state.walletChain = "0x1";
      return rpcResponse(request, request.method === "eth_chainId" ? LOCAL_CHAIN : "0x541");
    };

    await expect(createProvider(raw).send("eth_sendTransaction", [APPROVE])).rejects.toThrow();
    expect(state.transactions).toEqual([]);
  });

  it("refuses a transaction explicitly bound to a different network", async () => {
    const { raw, state } = createHarness();
    await expect(
      createProvider(raw).send("eth_sendTransaction", [{ ...APPROVE, chainId: "0x1" }]),
    ).rejects.toThrow();
    expect(state.transactions).toEqual([]);
  });

  it.each([
    { name: "a different RPC chain", chain: "0x1", nonce: "0x541" },
    { name: "an absent nonce", chain: LOCAL_CHAIN, nonce: undefined },
    { name: "a decimal nonce", chain: LOCAL_CHAIN, nonce: "1345" },
    { name: "a negative nonce", chain: LOCAL_CHAIN, nonce: "-0x1" },
    { name: "a noncanonical nonce", chain: LOCAL_CHAIN, nonce: "0x0541" },
    { name: "an unsafe nonce", chain: LOCAL_CHAIN, nonce: "0x20000000000000" },
  ])("does not broadcast with $name", async ({ chain, nonce }) => {
    const { raw, state } = createHarness();
    state.response = (request) =>
      rpcResponse(request, request.method === "eth_chainId" ? chain : nonce);

    await expect(createProvider(raw).send("eth_sendTransaction", [APPROVE])).rejects.toThrow();
    expect(state.transactions).toEqual([]);
  });

  it.each(["http", "rpc", "id", "json", "version"])(
    "does not broadcast or retry after a %s RPC response failure",
    async (failure) => {
      const { raw, state, fetch } = createHarness();
      state.response = (request) => {
        if (failure === "http") return new Response("Unavailable", { status: 503 });
        if (failure === "json") return new Response("not JSON");
        return new Response(
          JSON.stringify({
            jsonrpc: failure === "version" ? "1.0" : "2.0",
            id: failure === "id" ? request.id + 100 : request.id,
            ...(failure === "rpc"
              ? { error: { code: -32000, message: "Node unavailable" } }
              : { result: request.method === "eth_chainId" ? LOCAL_CHAIN : "0x541" }),
          }),
        );
      };

      await expect(createProvider(raw).send("eth_sendTransaction", [APPROVE])).rejects.toThrow();
      expect(state.transactions).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it("aborts a timed-out RPC read without broadcasting or retrying", async () => {
    const { raw, state, fetch } = createHarness();
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    state.response = (_request, init) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      });
    const send = createProvider(raw).send("eth_sendTransaction", [APPROVE]);
    const failure = expect(send).rejects.toThrow();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    controller.abort(new DOMException("RPC read timed out", "TimeoutError"));
    await failure;

    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(state.transactions).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a rejected wallet request and allows a later user-initiated send", async () => {
    const { raw, state } = createHarness();
    state.beforeSend = async () => {
      throw { code: 4001, message: "User rejected the request" };
    };
    const provider = createProvider(raw);
    await expect(provider.send("eth_sendTransaction", [APPROVE])).rejects.toMatchObject({
      code: "ACTION_REJECTED",
    });
    expect(state.transactions).toHaveLength(1);
    expect(state.pending.get(ACCOUNT)).toBe(1345n);
    state.beforeSend = undefined;

    await provider.send("eth_sendTransaction", [APPROVE]);
    expect(state.transactions).toHaveLength(2);
    expect(state.pending.get(ACCOUNT)).toBe(1346n);
  });

  it("does not repeat a send whose response is lost after the node accepts it", async () => {
    const { raw, state } = createHarness();
    state.afterMine = () => {
      throw { code: -32603, message: "Wallet transport disconnected" };
    };
    const provider = createProvider(raw);
    await expect(provider.send("eth_sendTransaction", [APPROVE])).rejects.toThrow();
    expect(state.transactions).toHaveLength(1);
    expect(state.pending.get(ACCOUNT)).toBe(1346n);
    state.afterMine = undefined;

    await provider.send("eth_sendTransaction", [SHIELD]);
    expect(state.transactions).toHaveLength(2);
    expect(state.pending.get(ACCOUNT)).toBe(1347n);
    expect(state.nonceReads.map(({ nonce }) => nonce)).toEqual([1345n, 1346n]);
  });
});
