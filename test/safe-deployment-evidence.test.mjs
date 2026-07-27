// Canonical Safe deployment evidence shared by every pinned EVM chain profile.
import { expect } from "chai";
import { ethers } from "ethers";

import {
  CONFLUX_ESPACE_MAINNET_CHAIN_ID,
  CONFLUX_ESPACE_TESTNET_CHAIN_ID,
  assertCanonicalSafeDeploymentReceipt,
  assertCanonicalSafeOperationalAcceptance,
  createCanonicalSafeInterface,
  createCanonicalSafeProxyFactoryInterface,
  getCanonicalSafeDeploymentMetadata,
  inspectCanonicalSafeInfrastructure,
} from "../scripts/lib/safeGovernance.mjs";

const CHAIN_ID = CONFLUX_ESPACE_TESTNET_CHAIN_ID;
const SUCCESS_CHAIN_IDS = Object.freeze([
  CONFLUX_ESPACE_TESTNET_CHAIN_ID,
  CONFLUX_ESPACE_MAINNET_CHAIN_ID,
]);
const DEPLOYER = "0x1000000000000000000000000000000000000001";
const SAFE_ADDRESS = "0x2000000000000000000000000000000000000002";
const ACCEPTANCE_TARGET = "0x3000000000000000000000000000000000000003";
const RELAYER = "0x4000000000000000000000000000000000000004";
const OTHER_ADDRESS = "0x5000000000000000000000000000000000000005";
const TRANSACTION_HASH = ethers.keccak256(ethers.toUtf8Bytes("canonical Safe deployment"));
const ACCEPTANCE_TRANSACTION_HASH = ethers.keccak256(
  ethers.toUtf8Bytes("canonical Safe owner acceptance"),
);
const SAFE_TX_HASH = ethers.keccak256(ethers.toUtf8Bytes("canonical Safe transaction"));
const BLOCK_HASH = ethers.keccak256(ethers.toUtf8Bytes("canonical block"));

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

const buildDeploymentFixture = (chainId = CHAIN_ID) => {
  const metadata = getCanonicalSafeDeploymentMetadata(chainId);
  const factoryInterface = createCanonicalSafeProxyFactoryInterface(chainId);
  const data = factoryInterface.encodeFunctionData("createProxyWithNonce", [
    metadata.singleton.address,
    "0x1234",
    77n,
  ]);
  const proxyCreation = factoryInterface.encodeEventLog(
    factoryInterface.getEvent("ProxyCreation"),
    [SAFE_ADDRESS, metadata.singleton.address],
  );
  return {
    chainId,
    metadata,
    expectedDeploymentTransaction: {
      to: metadata.proxyFactory.address,
      value: 0n,
      data,
    },
    transaction: {
      hash: TRANSACTION_HASH,
      from: DEPLOYER,
      nonce: 9,
      to: metadata.proxyFactory.address,
      value: 0n,
      data,
      chainId,
    },
    receipt: {
      hash: TRANSACTION_HASH,
      status: 1,
      from: DEPLOYER,
      to: metadata.proxyFactory.address,
      contractAddress: null,
      logs: [
        {
          address: metadata.proxyFactory.address,
          topics: proxyCreation.topics,
          data: proxyCreation.data,
        },
      ],
    },
  };
};

const assertDeployment = (fixture) =>
  assertCanonicalSafeDeploymentReceipt({
    receipt: fixture.receipt,
    transaction: fixture.transaction,
    chainId: fixture.chainId,
    expectedDeployer: DEPLOYER,
    expectedNonce: 9,
    expectedSafeAddress: SAFE_ADDRESS,
    expectedDeploymentTransaction: fixture.expectedDeploymentTransaction,
  });

const buildSafeExecutionData = (overrides = {}, chainId = CHAIN_ID) => {
  const safeInterface = createCanonicalSafeInterface(chainId);
  const values = {
    to: ACCEPTANCE_TARGET,
    value: 0n,
    data: "0x",
    operation: 0,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: ethers.ZeroAddress,
    refundReceiver: ethers.ZeroAddress,
    signatures: "0x1234",
    ...overrides,
  };
  return safeInterface.encodeFunctionData("execTransaction", [
    values.to,
    values.value,
    values.data,
    values.operation,
    values.safeTxGas,
    values.baseGas,
    values.gasPrice,
    values.gasToken,
    values.refundReceiver,
    values.signatures,
  ]);
};

const buildOperationalFixture = ({ chainId = CHAIN_ID, executionOverrides, payment = 0n } = {}) => {
  const safeInterface = createCanonicalSafeInterface(chainId);
  const success = safeInterface.encodeEventLog(safeInterface.getEvent("ExecutionSuccess"), [
    SAFE_TX_HASH,
    payment,
  ]);
  const transaction = {
    hash: ACCEPTANCE_TRANSACTION_HASH,
    chainId,
    from: RELAYER,
    to: SAFE_ADDRESS,
    value: 0n,
    data: buildSafeExecutionData(executionOverrides, chainId),
    blockNumber: 101,
    blockHash: BLOCK_HASH,
  };
  const receipt = {
    hash: ACCEPTANCE_TRANSACTION_HASH,
    status: 1,
    from: RELAYER,
    to: SAFE_ADDRESS,
    contractAddress: null,
    blockNumber: 101,
    blockHash: BLOCK_HASH,
    gasUsed: 123_456n,
    logs: [{ address: SAFE_ADDRESS, topics: success.topics, data: success.data }],
  };
  const provider = {
    send: async (method) => {
      if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
      throw new Error(`Unexpected RPC method ${method}`);
    },
    getNetwork: async () => ({ chainId }),
    getCode: async () => "0x01",
    getTransaction: async (hash) =>
      hash.toLowerCase() === ACCEPTANCE_TRANSACTION_HASH ? transaction : null,
    getTransactionReceipt: async (hash) =>
      hash.toLowerCase() === ACCEPTANCE_TRANSACTION_HASH ? receipt : null,
  };
  return { chainId, provider, transaction, receipt, safeInterface };
};

const assertOperational = ({ provider, chainId = CHAIN_ID }) =>
  assertCanonicalSafeOperationalAcceptance({
    provider,
    chainId,
    safeAddress: SAFE_ADDRESS,
    expectedTarget: ACCEPTANCE_TARGET,
    transactionHash: ACCEPTANCE_TRANSACTION_HASH,
  });

describe("canonical Safe deployment and operational evidence", function () {
  for (const chainId of SUCCESS_CHAIN_IDS) {
    it(`exports the pinned ProxyFactory interface on chainId ${chainId}`, function () {
      const factoryInterface = createCanonicalSafeProxyFactoryInterface(chainId);
      expect(factoryInterface.getFunction("createProxyWithNonce")).to.not.equal(null);
      expect(factoryInterface.getEvent("ProxyCreation")).to.not.equal(null);
    });

    it(`binds a successful factory receipt to the exact original transaction and proxy event on chainId ${chainId}`, function () {
      const fixture = buildDeploymentFixture(chainId);
      const evidence = assertDeployment(fixture);

      expect(evidence).to.include({
        chainId,
        transactionHash: TRANSACTION_HASH,
        deployer: DEPLOYER,
        nonce: 9n,
        proxyFactory: fixture.metadata.proxyFactory.address,
        safeAddress: SAFE_ADDRESS,
        singleton: fixture.metadata.singleton.address,
        value: 0n,
        saltNonce: 77n,
        proxyCreationLogIndex: 0,
      });
      expect(evidence.dataHash).to.equal(
        ethers.keccak256(fixture.expectedDeploymentTransaction.data),
      );
      expect(evidence.initializerHash).to.equal(ethers.keccak256("0x1234"));
      expect(Object.isFrozen(evidence)).to.equal(true);
    });
  }

  it("rejects every mismatched original factory transaction field", function () {
    const mutations = [
      ["sender", { from: OTHER_ADDRESS }, /sender/],
      ["nonce", { nonce: 10 }, /nonce/],
      ["target", { to: OTHER_ADDRESS }, /target/],
      ["value", { value: 1n }, /value/],
      ["calldata", { data: "0x1234" }, /calldata/],
      ["chainId", { chainId: 1030n }, /chainId/],
    ];
    for (const [label, mutation, pattern] of mutations) {
      const fixture = buildDeploymentFixture();
      fixture.transaction = { ...fixture.transaction, ...mutation };
      expect(() => assertDeployment(fixture), label).to.throw(pattern);
    }
  });

  it("requires the immutable plan itself to use canonical createProxyWithNonce calldata", function () {
    const fixture = buildDeploymentFixture();
    const factoryInterface = createCanonicalSafeProxyFactoryInterface(CHAIN_ID);

    fixture.expectedDeploymentTransaction = {
      ...fixture.expectedDeploymentTransaction,
      data: factoryInterface.encodeFunctionData("createProxy", [
        fixture.metadata.singleton.address,
        "0x1234",
      ]),
    };
    expect(() => assertDeployment(fixture)).to.throw(/must call createProxyWithNonce/);

    const wrongSingleton = buildDeploymentFixture();
    wrongSingleton.expectedDeploymentTransaction = {
      ...wrongSingleton.expectedDeploymentTransaction,
      data: factoryInterface.encodeFunctionData("createProxyWithNonce", [
        OTHER_ADDRESS,
        "0x1234",
        77n,
      ]),
    };
    expect(() => assertDeployment(wrongSingleton)).to.throw(/canonical L2 singleton/);

    const emptyInitializer = buildDeploymentFixture();
    emptyInitializer.expectedDeploymentTransaction = {
      ...emptyInitializer.expectedDeploymentTransaction,
      data: factoryInterface.encodeFunctionData("createProxyWithNonce", [
        fixture.metadata.singleton.address,
        "0x",
        77n,
      ]),
    };
    expect(() => assertDeployment(emptyInitializer)).to.throw(/initializer cannot be empty/);
  });

  it("rejects reverted, unrelated, or top-level-creation receipts", function () {
    const mutations = [
      ["reverted", { status: 0 }, /missing or reverted/],
      ["hash", { hash: SAFE_TX_HASH }, /does not belong/],
      ["sender", { from: OTHER_ADDRESS }, /receipt sender/],
      ["target", { to: OTHER_ADDRESS }, /receipt target/],
      ["contract", { contractAddress: SAFE_ADDRESS }, /top-level contractAddress/],
    ];
    for (const [label, mutation, pattern] of mutations) {
      const fixture = buildDeploymentFixture();
      fixture.receipt = { ...fixture.receipt, ...mutation };
      expect(() => assertDeployment(fixture), label).to.throw(pattern);
    }
  });

  it("requires exactly one matching canonical ProxyCreation event", function () {
    const missing = buildDeploymentFixture();
    missing.receipt = { ...missing.receipt, logs: [] };
    expect(() => assertDeployment(missing)).to.throw(/exactly one.*got 0/);

    const duplicate = buildDeploymentFixture();
    duplicate.receipt = {
      ...duplicate.receipt,
      logs: [...duplicate.receipt.logs, ...duplicate.receipt.logs],
    };
    expect(() => assertDeployment(duplicate)).to.throw(/exactly one.*got 2/);

    const wrongProxy = buildDeploymentFixture();
    const factoryInterface = createCanonicalSafeProxyFactoryInterface(CHAIN_ID);
    const proxyCreation = factoryInterface.encodeEventLog(
      factoryInterface.getEvent("ProxyCreation"),
      [OTHER_ADDRESS, wrongProxy.metadata.singleton.address],
    );
    wrongProxy.receipt = {
      ...wrongProxy.receipt,
      logs: [
        {
          address: wrongProxy.metadata.proxyFactory.address,
          topics: proxyCreation.topics,
          data: proxyCreation.data,
        },
      ],
    };
    expect(() => assertDeployment(wrongProxy)).to.throw(/predicted Safe/);

    const wrongSingleton = buildDeploymentFixture();
    const wrongSingletonEvent = factoryInterface.encodeEventLog(
      factoryInterface.getEvent("ProxyCreation"),
      [SAFE_ADDRESS, OTHER_ADDRESS],
    );
    wrongSingleton.receipt = {
      ...wrongSingleton.receipt,
      logs: [
        {
          address: wrongSingleton.metadata.proxyFactory.address,
          topics: wrongSingletonEvent.topics,
          data: wrongSingletonEvent.data,
        },
      ],
    };
    expect(() => assertDeployment(wrongSingleton)).to.throw(/not the canonical L2 singleton/);
  });

  it("checks raw and provider chain ids before inspecting Safe infrastructure", async function () {
    const malformedRawChainId = {
      send: async () => 71,
      getNetwork: async () => ({ chainId: CHAIN_ID }),
      getCode: async () => "0x",
    };
    await expectRejected(
      () =>
        inspectCanonicalSafeInfrastructure({
          provider: malformedRawChainId,
          chainId: CHAIN_ID,
        }),
      /invalid raw chainId/,
    );

    const rawMismatch = {
      send: async () => "0x1",
      getNetwork: async () => ({ chainId: CHAIN_ID }),
      getCode: async () => "0x",
    };
    await expectRejected(
      () => inspectCanonicalSafeInfrastructure({ provider: rawMismatch, chainId: CHAIN_ID }),
      /raw chainId mismatch/,
    );

    const providerMismatch = {
      send: async () => "0x47",
      getNetwork: async () => ({ chainId: 1030n }),
      getCode: async () => "0x",
    };
    await expectRejected(
      () => inspectCanonicalSafeInfrastructure({ provider: providerMismatch, chainId: CHAIN_ID }),
      /provider chainId mismatch/,
    );

    const missingComponent = {
      send: async () => "0x47",
      getNetwork: async () => ({ chainId: CHAIN_ID }),
      getCode: async () => "0x",
    };
    await expectRejected(
      () => inspectCanonicalSafeInfrastructure({ provider: missingComponent, chainId: CHAIN_ID }),
      /singleton has no deployed bytecode/,
    );
  });

  for (const chainId of SUCCESS_CHAIN_IDS) {
    it(`accepts public evidence for a refund-free Safe CALL smoke transaction on chainId ${chainId}`, async function () {
      const fixture = buildOperationalFixture({ chainId });
      const evidence = await assertOperational(fixture);

      expect(evidence).to.include({
        chainId,
        transactionHash: ACCEPTANCE_TRANSACTION_HASH,
        safeTxHash: SAFE_TX_HASH,
        safeAddress: SAFE_ADDRESS,
        relayer: RELAYER,
        innerTarget: ACCEPTANCE_TARGET,
        operation: 0,
        value: 0n,
        data: "0x",
        payment: 0n,
        executionSuccessLogIndex: 0,
      });
      expect(evidence.receipt).to.deep.equal({
        status: 1,
        blockNumber: 101,
        blockHash: BLOCK_HASH,
        gasUsed: 123_456n,
      });
      expect(Object.isFrozen(evidence.receipt)).to.equal(true);
    });
  }

  it("requires the original outer transaction to be on-chain and target the expected Safe", async function () {
    const unavailable = buildOperationalFixture();
    unavailable.provider.getTransaction = async () => null;
    await expectRejected(() => assertOperational(unavailable), /unavailable from the RPC/);

    const wrongChain = buildOperationalFixture();
    wrongChain.transaction.chainId = 1030n;
    await expectRejected(() => assertOperational(wrongChain), /chainId is incorrect/);

    const wrongSafe = buildOperationalFixture();
    wrongSafe.transaction.to = OTHER_ADDRESS;
    await expectRejected(() => assertOperational(wrongSafe), /does not target the expected Safe/);

    const nonzeroOuterValue = buildOperationalFixture();
    nonzeroOuterValue.transaction.value = 1n;
    await expectRejected(() => assertOperational(nonzeroOuterValue), /outer transaction value/);
  });

  it("requires a zero-value, empty-data CALL to the reviewed acceptance target", async function () {
    const cases = [
      [{ to: OTHER_ADDRESS }, /inner target is incorrect/],
      [{ value: 1n }, /inner value must be zero/],
      [{ data: "0x12" }, /inner data must be empty/],
      [{ operation: 1 }, /must use CALL/],
    ];
    for (const [executionOverrides, pattern] of cases) {
      const fixture = buildOperationalFixture({ executionOverrides });
      await expectRejected(() => assertOperational(fixture), pattern);
    }
  });

  it("rejects every Safe refund or payment gas mechanism", async function () {
    const cases = [
      [{ safeTxGas: 1n }, /fields must all be zero/],
      [{ baseGas: 1n }, /fields must all be zero/],
      [{ gasPrice: 1n }, /fields must all be zero/],
      [{ gasToken: OTHER_ADDRESS }, /fields must all be zero/],
      [{ refundReceiver: OTHER_ADDRESS }, /fields must all be zero/],
    ];
    for (const [executionOverrides, pattern] of cases) {
      const fixture = buildOperationalFixture({ executionOverrides });
      await expectRejected(() => assertOperational(fixture), pattern);
    }
  });

  it("requires one zero-payment ExecutionSuccess and rejects every failure result", async function () {
    const reverted = buildOperationalFixture();
    reverted.receipt.status = 0;
    await expectRejected(() => assertOperational(reverted), /missing or reverted/);

    const wrongReceiptRelayer = buildOperationalFixture();
    wrongReceiptRelayer.receipt.from = OTHER_ADDRESS;
    await expectRejected(() => assertOperational(wrongReceiptRelayer), /receipt relayer/);

    const missing = buildOperationalFixture();
    missing.receipt.logs = [];
    await expectRejected(() => assertOperational(missing), /exactly one.*got 0/);

    const duplicate = buildOperationalFixture();
    duplicate.receipt.logs.push(...duplicate.receipt.logs);
    await expectRejected(() => assertOperational(duplicate), /exactly one.*got 2/);

    const failure = buildOperationalFixture();
    const encodedFailure = failure.safeInterface.encodeEventLog(
      failure.safeInterface.getEvent("ExecutionFailure"),
      [SAFE_TX_HASH, 0n],
    );
    failure.receipt.logs = [
      { address: SAFE_ADDRESS, topics: encodedFailure.topics, data: encodedFailure.data },
    ];
    await expectRejected(() => assertOperational(failure), /emitted ExecutionFailure/);

    const paid = buildOperationalFixture({ payment: 1n });
    await expectRejected(() => assertOperational(paid), /payment must be zero/);
  });
});
