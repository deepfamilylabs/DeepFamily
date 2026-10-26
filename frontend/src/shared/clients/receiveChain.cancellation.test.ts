import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContractRunner } from "ethers";
import {
  computeReceiveAuthorization,
  computeShieldedCiphertextHashField,
} from "@deepfamily/protocol-core";
import { ReceiveChain } from "./receiveChain";

const deployment = {
  chainId: 31337n,
  registryAddress: "0x0000000000000000000000000000000000001234",
  poolAddress: "0x0000000000000000000000000000000000004321",
  lettersAddress: "0x0000000000000000000000000000000000005678",
};
const tokenAddress = "0x0000000000000000000000000000000000009876";
const mocks = vi.hoisted(() => ({
  pool: {
    RECEIVE_REGISTRY: vi.fn(),
    protocolVersion: vi.fn(),
    assetKind: vi.fn(),
    TOKEN: vi.fn(),
    shield: vi.fn(),
    unshield: vi.fn(),
    transfer: vi.fn(),
  },
  token: { allowance: vi.fn(), approve: vi.fn() },
  letters: { RECEIVE_REGISTRY: vi.fn(), registerLetter: vi.fn() },
}));
vi.mock("ethers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ethers")>()),
  Contract: class {
    constructor(address: string) {
      if (address === deployment.poolAddress) return mocks.pool;
      if (address === deployment.lettersAddress) return mocks.letters;
      if (address === tokenAddress) return mocks.token;
      return {};
    }
  },
}));
const proof = {
  pi_a: [1n, 2n, 1n],
  pi_b: [
    [3n, 4n],
    [5n, 6n],
    [1n, 0n],
  ],
  pi_c: [7n, 8n, 1n],
};
const common = computeReceiveAuthorization({
  chainId: deployment.chainId,
  authorizerScope: deployment.registryAddress,
  nonce: 11n,
  ownerSecret: 13n,
  codeRootSecret: 17n,
  codeSecret: 19n,
  viewingKey: new Uint8Array(32).fill(3),
  expiresAt: 2_000_000_000n,
});
const code = { ...common, version: 1 as const, proof, capabilities: [] };
const outputCiphertexts = [new Uint8Array(512).fill(1), new Uint8Array(512).fill(2)];
const boundary = {
  amount: "1",
  inputShardIds: [],
  inputRoots: [],
  inputNullifiers: [],
  outputCommitments: [17n, 19n],
  outputCiphertexts,
  ciphertextHashes: outputCiphertexts.map(computeShieldedCiphertextHashField),
  publicSignals: [],
  proof,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  let active = true;
  const runner = {
    provider: { getNetwork: async () => ({ chainId: deployment.chainId }) },
    getAddress: async () => "0x0000000000000000000000000000000000001111",
  } as unknown as ContractRunner;
  const chain = new ReceiveChain(deployment, runner, {
    beforeTransaction() {
      if (!active) throw new Error("Receive transaction preparation cancelled");
    },
  });
  return {
    chain,
    cancel: () => {
      active = false;
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.pool.RECEIVE_REGISTRY.mockResolvedValue(deployment.registryAddress);
  mocks.pool.protocolVersion.mockResolvedValue(1n);
  mocks.pool.assetKind.mockResolvedValue(1n);
  mocks.pool.TOKEN.mockResolvedValue(tokenAddress);
  mocks.letters.RECEIVE_REGISTRY.mockResolvedValue(deployment.registryAddress);
});

describe("receiving cancellation during transaction reads", () => {
  const operations = {
    shield: (chain: ReceiveChain) => chain.sendShield(boundary),
    unshield: (chain: ReceiveChain) => chain.sendUnshield({ ...boundary, recipient: tokenAddress }),
    transfer: (chain: ReceiveChain) =>
      chain.sendTransfer(
        {
          ...boundary,
          code,
          inputNullifier: 13n,
          publicInput: {
            commonBinding: code.commonBinding,
            ownerCommitment: code.ownerCommitment,
            viewKeyLo: 3n,
            viewKeyHi: 3n,
            inputRoot: 11n,
            inputNullifier: 13n,
            outputCommitments: boundary.outputCommitments,
            ciphertextHashes: boundary.ciphertextHashes,
          },
        },
        0n,
      ),
    letter: (chain: ReceiveChain) =>
      chain.sendLetter({ code, messageId: 1n, ciphertext: Uint8Array.of(1) }),
  };
  it.each(Object.keys(operations) as Array<keyof typeof operations>)(
    "stops %s when the wallet locks during deployment checks",
    async (operation) => {
      const { chain, cancel } = setup();
      const version = deferred<bigint>();
      mocks.pool.protocolVersion.mockReturnValue(version.promise);
      const pending = operations[operation](chain);
      cancel();
      version.resolve(1n);
      await expect(pending).rejects.toThrow("cancelled");
      expect(mocks.pool.shield).not.toHaveBeenCalled();
      expect(mocks.pool.unshield).not.toHaveBeenCalled();
      expect(mocks.pool.transfer).not.toHaveBeenCalled();
      expect(mocks.letters.registerLetter).not.toHaveBeenCalled();
    },
  );
  it("stops ERC20 approval when the wallet locks while reading allowance", async () => {
    const { chain, cancel } = setup();
    mocks.pool.assetKind.mockResolvedValue(0n);
    mocks.token.allowance.mockImplementation(async () => {
      cancel();
      return 0n;
    });
    await expect(chain.sendShield(boundary)).rejects.toThrow("cancelled");
    expect(mocks.token.approve).not.toHaveBeenCalled();
    expect(mocks.pool.shield).not.toHaveBeenCalled();
  });
  it("stops the deposit when the wallet locks while an ERC20 approval confirms", async () => {
    const { chain, cancel } = setup();
    mocks.pool.assetKind.mockResolvedValue(0n);
    mocks.token.allowance.mockResolvedValue(0n);
    mocks.token.approve.mockResolvedValue({
      wait: async () => {
        cancel();
      },
    });
    await expect(chain.sendShield(boundary)).rejects.toThrow("cancelled");
    expect(mocks.token.approve).toHaveBeenCalledOnce();
    expect(mocks.pool.shield).not.toHaveBeenCalled();
  });
});
