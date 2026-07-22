import { expect } from "chai";
import { ethers } from "ethers";
import {
  CANONICAL_SAFE_OWNER_COUNT,
  CANONICAL_SAFE_THRESHOLD,
  CANONICAL_SAFE_VERSION,
  CONFLUX_ESPACE_MAINNET_CHAIN_ID,
  CONFLUX_ESPACE_TESTNET_CHAIN_ID,
  SAFE_FALLBACK_HANDLER_STORAGE_SLOT,
  SAFE_GUARD_STORAGE_SLOT,
  asEip1193Provider,
  assertCanonicalSafeProxyRuntime,
  assertSafeExecutionSuccess,
  buildCanonicalSafeAccountConfig,
  buildCanonicalSafeDeploymentConfig,
  createCanonicalSafeInterface,
  createCanonicalSafeTransaction,
  getCanonicalSafeDeploymentMetadata,
  normalizeSafeOwners,
  normalizeSafeSaltNonce,
  signCanonicalSafeTransaction,
} from "../scripts/lib/safeGovernance.mjs";

const OWNERS = [
  "0x1000000000000000000000000000000000000001",
  "0x2000000000000000000000000000000000000002",
  "0x3000000000000000000000000000000000000003",
];
const SAFE_ADDRESS = "0x4000000000000000000000000000000000000004";
const TARGET = "0x5000000000000000000000000000000000000005";
const SAFE_TX_HASH = ethers.keccak256(ethers.toUtf8Bytes("safe transaction"));

const expectRejected = async (operation, pattern) => {
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  expect(caught, "expected operation to reject").to.be.an("error");
  expect(caught.message).to.match(pattern);
};

describe("canonical Conflux eSpace Safe governance helpers", function () {
  it("pins the same official canonical Safe v1.3.0 contracts on testnet and mainnet", function () {
    const testnet = getCanonicalSafeDeploymentMetadata(CONFLUX_ESPACE_TESTNET_CHAIN_ID);
    const mainnet = getCanonicalSafeDeploymentMetadata(CONFLUX_ESPACE_MAINNET_CHAIN_ID);

    expect(testnet.safeVersion).to.equal(CANONICAL_SAFE_VERSION);
    expect(testnet.singleton.address).to.equal("0x3E5c63644E683549055b9Be8653de26E0B4CD36E");
    expect(testnet.singleton.codeHash).to.equal(
      "0x21842597390c4c6e3c1239e434a682b054bd9548eee5e9b1d6a4482731023c0f",
    );
    expect(testnet.proxyFactory.address).to.equal("0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2");
    expect(testnet.proxyFactory.codeHash).to.equal(
      "0x337d7f54be11b6ed55fef7b667ea5488db53db8320a05d1146aa4bd169a39a9b",
    );
    expect(testnet.fallbackHandler.address).to.equal("0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4");
    expect(testnet.fallbackHandler.codeHash).to.equal(
      "0x03e69f7ce809e81687c69b19a7d7cca45b6d551ffdec73d9bb87178476de1abf",
    );
    expect(mainnet.singleton.address).to.equal(testnet.singleton.address);
    expect(mainnet.proxyFactory.address).to.equal(testnet.proxyFactory.address);
    expect(mainnet.fallbackHandler.address).to.equal(testnet.fallbackHandler.address);
    expect(Object.isFrozen(testnet)).to.equal(true);
    expect(() => getCanonicalSafeDeploymentMetadata(1)).to.throw(/restricted to Conflux eSpace/);
  });

  it("locks the expected 2-of-3 extension-free Safe setup", function () {
    const config = buildCanonicalSafeAccountConfig({
      chainId: CONFLUX_ESPACE_TESTNET_CHAIN_ID,
      owners: OWNERS,
    });
    expect(CANONICAL_SAFE_OWNER_COUNT).to.equal(3);
    expect(CANONICAL_SAFE_THRESHOLD).to.equal(2);
    expect(config).to.deep.equal({
      owners: OWNERS,
      threshold: 2,
      to: ethers.ZeroAddress,
      data: "0x",
      fallbackHandler: "0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4",
      paymentToken: ethers.ZeroAddress,
      payment: 0,
      paymentReceiver: ethers.ZeroAddress,
    });
    expect(SAFE_FALLBACK_HANDLER_STORAGE_SLOT).to.equal(
      "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5",
    );
    expect(SAFE_GUARD_STORAGE_SLOT).to.equal(
      "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8",
    );
  });

  it("requires the account proxy runtime to match the canonical factory runtime exactly", function () {
    const canonicalRuntimeCode = "0x6001600055";
    const matched = assertCanonicalSafeProxyRuntime({
      proxyCode: canonicalRuntimeCode,
      canonicalRuntimeCode,
    });
    expect(matched.proxyCodeHash).to.equal(ethers.keccak256(canonicalRuntimeCode));
    expect(matched.canonicalProxyCodeHash).to.equal(matched.proxyCodeHash);
    expect(() =>
      assertCanonicalSafeProxyRuntime({
        proxyCode: "0x6002600055",
        canonicalRuntimeCode,
      }),
    ).to.throw(/runtime codeHash mismatch/);
    expect(() =>
      assertCanonicalSafeProxyRuntime({ proxyCode: "0x", canonicalRuntimeCode }),
    ).to.throw(/no valid deployed bytecode/);
  });

  it("rejects malformed, zero, duplicate, or non-3-owner configurations", function () {
    expect(normalizeSafeOwners(OWNERS)).to.deep.equal(OWNERS);
    expect(() => normalizeSafeOwners(OWNERS.slice(0, 2))).to.throw(/exactly 3 owners/);
    expect(() => normalizeSafeOwners([...OWNERS, TARGET])).to.throw(/exactly 3 owners/);
    expect(() => normalizeSafeOwners([OWNERS[0], OWNERS[0], OWNERS[2]])).to.throw(/distinct/);
    expect(() => normalizeSafeOwners([ethers.ZeroAddress, OWNERS[1], OWNERS[2]])).to.throw(
      /nonzero EVM address/,
    );
    expect(() => normalizeSafeOwners(["not-an-address", OWNERS[1], OWNERS[2]])).to.throw(
      /nonzero EVM address/,
    );
  });

  it("normalizes only safe decimal salt nonces", function () {
    expect(normalizeSafeSaltNonce(0n)).to.equal("0");
    expect(normalizeSafeSaltNonce(42)).to.equal("42");
    expect(normalizeSafeSaltNonce("00042")).to.equal("42");
    expect(buildCanonicalSafeDeploymentConfig({ saltNonce: "42" })).to.deep.equal({
      saltNonce: "42",
      safeVersion: "1.3.0",
      deploymentType: "canonical",
    });
    for (const invalid of [-1, "-1", "1.5", "0x2a", "", Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => normalizeSafeSaltNonce(invalid)).to.throw(/non-negative base-10 integer/);
    }
  });

  it("adapts an ethers-style provider without changing EIP-1193 providers", async function () {
    const calls = [];
    const ethersProvider = {
      send: async (method, params) => {
        calls.push({ method, params });
        return "0x47";
      },
    };
    const adapted = asEip1193Provider(ethersProvider);
    expect(await adapted.request({ method: "eth_chainId", params: [] })).to.equal("0x47");
    expect(calls).to.deep.equal([{ method: "eth_chainId", params: [] }]);

    const eip1193 = { request: async () => "ok" };
    expect(asEip1193Provider(eip1193)).to.equal(eip1193);
    expect(() => asEip1193Provider(null)).to.throw(/provider object/);
    await expectRejected(
      () => adapted.request({ method: "eth_call", params: { to: TARGET } }),
      /params to be an array/,
    );
  });

  it("constructs a single CALL governance transaction with normalized values", async function () {
    const captured = [];
    const transaction = { signatures: new Map(), data: { nonce: 7 } };
    const safe = {
      createTransaction: async (input) => {
        captured.push(input);
        return transaction;
      },
      getTransactionHash: async () => SAFE_TX_HASH,
    };
    const result = await createCanonicalSafeTransaction({
      safe,
      target: TARGET,
      value: 9n,
      data: "0x1234",
      nonce: 7n,
    });
    expect(result.safeTransaction).to.equal(transaction);
    expect(result.safeTxHash).to.equal(SAFE_TX_HASH);
    expect(captured).to.deep.equal([
      {
        transactions: [{ to: TARGET, value: "9", data: "0x1234", operation: 0 }],
        options: { nonce: 7 },
      },
    ]);

    await expectRejected(
      () => createCanonicalSafeTransaction({ safe: {}, target: TARGET }),
      /Protocol Kit Safe/,
    );
    await expectRejected(
      () => createCanonicalSafeTransaction({ safe, target: ethers.ZeroAddress }),
      /nonzero EVM address/,
    );
    await expectRejected(
      () => createCanonicalSafeTransaction({ safe, target: TARGET, value: -1 }),
      /non-negative integer/,
    );
    await expectRejected(
      () => createCanonicalSafeTransaction({ safe, target: TARGET, data: "bad" }),
      /hexadecimal/,
    );
  });

  it("rejects unsafe signing inputs before any provider access", async function () {
    const unsigned = { signatures: new Map() };
    const alreadySigned = { signatures: new Map([[OWNERS[0], {}]]) };
    const privateKey = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const base = {
      provider: null,
      chainId: 71,
      safeAddress: SAFE_ADDRESS,
      safeTransaction: unsigned,
    };

    await expectRejected(
      () => signCanonicalSafeTransaction({ ...base, signerPrivateKeys: [] }),
      /between one and three/,
    );
    await expectRejected(
      () => signCanonicalSafeTransaction({ ...base, signerPrivateKeys: [privateKey, privateKey] }),
      /must be distinct/,
    );
    await expectRejected(
      () => signCanonicalSafeTransaction({ ...base, signerPrivateKeys: ["not-a-key"] }),
      /private key must contain/,
    );
    await expectRejected(
      () =>
        signCanonicalSafeTransaction({
          ...base,
          safeTransaction: alreadySigned,
          signerPrivateKeys: [privateKey],
        }),
      /must be an unsigned/,
    );
  });

  it("accepts only the matching ExecutionSuccess event", function () {
    const iface = createCanonicalSafeInterface(CONFLUX_ESPACE_TESTNET_CHAIN_ID);
    const success = iface.encodeEventLog(iface.getEvent("ExecutionSuccess"), [SAFE_TX_HASH, 0]);
    const receipt = {
      status: 1,
      logs: [{ address: SAFE_ADDRESS, topics: success.topics, data: success.data }],
    };
    expect(
      assertSafeExecutionSuccess({
        receipt,
        safeAddress: SAFE_ADDRESS,
        safeTxHash: SAFE_TX_HASH,
        chainId: CONFLUX_ESPACE_TESTNET_CHAIN_ID,
      }),
    ).to.deep.equal({ safeTxHash: SAFE_TX_HASH, payment: 0n });

    const failure = iface.encodeEventLog(iface.getEvent("ExecutionFailure"), [SAFE_TX_HASH, 0]);
    expect(() =>
      assertSafeExecutionSuccess({
        receipt: {
          status: 1,
          logs: [{ address: SAFE_ADDRESS, topics: failure.topics, data: failure.data }],
        },
        safeAddress: SAFE_ADDRESS,
        safeTxHash: SAFE_TX_HASH,
        chainId: 71,
      }),
    ).to.throw(/ExecutionFailure/);
    expect(() =>
      assertSafeExecutionSuccess({
        receipt: { status: 1, logs: [] },
        safeAddress: SAFE_ADDRESS,
        safeTxHash: SAFE_TX_HASH,
        chainId: 71,
      }),
    ).to.throw(/exactly one Safe ExecutionSuccess/);
    expect(() =>
      assertSafeExecutionSuccess({
        receipt: { status: 0, logs: [] },
        safeAddress: SAFE_ADDRESS,
        safeTxHash: SAFE_TX_HASH,
        chainId: 71,
      }),
    ).to.throw(/missing or reverted/);
  });
});
