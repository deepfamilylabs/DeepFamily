import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ethers } from "ethers";

import {
  acquireReleaseLock,
  createCheckpointedTransactionExecutor,
  readJsonIfExists,
  revalidateCheckpointTransactions,
  writeJsonAtomic,
} from "../scripts/lib/espaceMainnetReleaseState.mjs";

const ADDRESS = "0x2000000000000000000000000000000000000002";
const HASH = `0x${"34".repeat(32)}`;
const BLOCK_HASH = `0x${"56".repeat(32)}`;

const expectRejects = async (operation, expectedMessage) => {
  let error;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }
  expect(error, "expected operation to reject").to.be.an("error");
  expect(error.message).to.include(expectedMessage);
};

const fixture = ({
  nonce = 7,
  pendingNonce = nonce,
  latestNonce = nonce,
  cap = 10_000n,
  expectedNonces = {},
  expectedIntents = {},
  recoveryTransactions = {},
  gasUsed = 100n,
  estimatedGas = 100n,
  explicitGasLimit = 100n,
  balance = 10_000n,
} = {}) => {
  const checkpoint = { transactions: {} };
  let sends = 0;
  const predictedAddress = ethers.getCreateAddress({ from: ADDRESS, nonce });
  const transaction = {
    hash: HASH,
    from: ADDRESS,
    to: null,
    nonce,
    data: "0x6000",
    value: 0n,
    chainId: 1030n,
    gasLimit: explicitGasLimit ?? 130n,
  };
  const receipt = {
    hash: HASH,
    blockNumber: 100,
    blockHash: BLOCK_HASH,
    status: 1,
    contractAddress: predictedAddress,
    gasUsed,
    gasPrice: 2n,
  };
  const provider = {
    getTransactionCount: async (_address, tag) => (tag === "pending" ? pendingNonce : latestNonce),
    getTransaction: async (hash) => (hash === HASH ? transaction : null),
    getTransactionReceipt: async (hash) => (hash === HASH ? receipt : null),
    waitForTransaction: async () => receipt,
    getBlockNumber: async () => 101,
    getBlock: async () => ({ number: 100, hash: BLOCK_HASH }),
    getCode: async () => "0x6000",
    getBalance: async () => balance,
    getNetwork: async () => ({ chainId: 1030n }),
  };
  const signer = {
    getAddress: async () => ADDRESS,
    populateTransaction: async (request) => ({
      ...request,
      nonce: request.nonce,
      chainId: 1030n,
      gasLimit: 100n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
      type: 2,
    }),
    estimateGas: async () => estimatedGas,
    sendTransaction: async (request) => {
      sends += 1;
      expect(checkpoint.transactions.deployModule.status).to.equal("planned");
      expect(request.nonce).to.equal(nonce);
      return { hash: HASH, nonce };
    },
  };
  let saves = 0;
  const executor = createCheckpointedTransactionExecutor({
    provider,
    signer,
    checkpoint,
    saveCheckpoint: async () => {
      saves += 1;
    },
    maxCostWei: cap,
    expectedNonces,
    expectedIntents,
    recoveryTransactions,
  });
  const executeWith = (transactionRequest) =>
    executor({
      label: "deployModule",
      kind: "deployment",
      transactionRequest,
      transactionConfirmations: 2,
      transactionTimeoutMs: 1_000,
    });
  const execute = () =>
    executeWith({
      data: "0x6000",
      value: 0n,
      ...(explicitGasLimit == null ? {} : { gasLimit: explicitGasLimit }),
    });
  return {
    checkpoint,
    execute,
    executeWith,
    provider,
    signer,
    receipt,
    predictedAddress,
    sends: () => sends,
    saves: () => saves,
  };
};

const expectedDeploymentIntent = (nonce = 7) => ({
  label: "deployModule",
  kind: "deployment",
  nonce,
  from: ADDRESS,
  chainId: "1030",
  to: null,
  value: "0",
  data: "0x6000",
  dataHash: ethers.keccak256("0x6000"),
  predictedAddress: ethers.getCreateAddress({ from: ADDRESS, nonce }),
});

const plannedEntry = (nonce = 7) => ({
  label: "deployModule",
  kind: "deployment",
  status: "planned",
  from: ADDRESS,
  request: {
    to: null,
    data: "0x6000",
    value: "0",
    nonce,
    chainId: "1030",
    gasLimit: "100",
    type: 2,
    gasPrice: null,
    maxFeePerGas: "2",
    maxPriorityFeePerGas: "1",
    accessList: null,
  },
  dataHash: ethers.keccak256("0x6000"),
  predictedAddress: ethers.getCreateAddress({ from: ADDRESS, nonce }),
  maximumCostWei: "200",
  hash: null,
  receipt: null,
});

describe("eSpace Mainnet release checkpoint state", function () {
  it("persists planned state before broadcast, then submitted and confirmed evidence", async function () {
    const run = fixture();
    const receipt = await run.execute();
    expect(receipt.hash).to.equal(HASH);
    expect(run.sends()).to.equal(1);
    expect(run.saves()).to.equal(3);
    expect(run.checkpoint.transactions.deployModule).to.include({
      status: "confirmed",
      hash: HASH,
      predictedAddress: run.predictedAddress,
      actualCostWei: "200",
    });
  });

  it("never rebroadcasts a planned nonce that is pending or consumed", async function () {
    const run = fixture({ pendingNonce: 8, latestNonce: 8 });
    run.checkpoint.transactions.deployModule = {
      label: "deployModule",
      kind: "deployment",
      status: "planned",
      from: ADDRESS,
      request: {
        to: null,
        data: "0x6000",
        value: "0",
        nonce: 7,
        chainId: "1030",
        gasLimit: "100",
        type: 2,
        gasPrice: null,
        maxFeePerGas: "2",
        maxPriorityFeePerGas: "1",
        accessList: null,
      },
      dataHash: ethers.keccak256("0x6000"),
      predictedAddress: ethers.getCreateAddress({ from: ADDRESS, nonce: 7 }),
      maximumCostWei: "200",
      hash: null,
      receipt: null,
    };
    await expectRejects(run.execute, "Do not resend it");
    expect(run.sends()).to.equal(0);
  });

  it("adopts a recovered hash for a mined hashless planned step without rebroadcasting", async function () {
    const run = fixture({
      pendingNonce: 8,
      latestNonce: 8,
      recoveryTransactions: { deployModule: HASH },
    });
    run.checkpoint.transactions.deployModule = {
      label: "deployModule",
      kind: "deployment",
      status: "planned",
      from: ADDRESS,
      request: {
        to: null,
        data: "0x6000",
        value: "0",
        nonce: 7,
        chainId: "1030",
        gasLimit: "100",
        type: 2,
        gasPrice: null,
        maxFeePerGas: "2",
        maxPriorityFeePerGas: "1",
        accessList: null,
      },
      dataHash: ethers.keccak256("0x6000"),
      predictedAddress: ethers.getCreateAddress({ from: ADDRESS, nonce: 7 }),
      maximumCostWei: "200",
      hash: null,
      receipt: null,
    };
    await run.execute();
    expect(run.sends()).to.equal(0);
    expect(run.checkpoint.transactions.deployModule).to.include({
      status: "confirmed",
      hash: HASH,
      recoveredHash: true,
    });
  });

  it("rejects a recovered transaction whose actual cost exceeds its checkpoint maximum", async function () {
    const run = fixture({
      recoveryTransactions: { deployModule: HASH },
      gasUsed: 101n,
    });
    run.checkpoint.transactions.deployModule = {
      label: "deployModule",
      kind: "deployment",
      status: "planned",
      from: ADDRESS,
      request: {
        to: null,
        data: "0x6000",
        value: "0",
        nonce: 7,
        chainId: "1030",
        gasLimit: "100",
        type: 2,
        gasPrice: null,
        maxFeePerGas: "2",
        maxPriorityFeePerGas: "1",
        accessList: null,
      },
      dataHash: ethers.keccak256("0x6000"),
      predictedAddress: ethers.getCreateAddress({ from: ADDRESS, nonce: 7 }),
      maximumCostWei: "200",
      hash: null,
      receipt: null,
    };
    await expectRejects(run.execute, "actual cost 202 wei exceeds its checkpoint maximum 200 wei");
    expect(run.sends()).to.equal(0);
    expect(run.checkpoint.transactions.deployModule.status).to.equal("submitted");
  });

  it("revalidates a confirmed transaction without broadcasting another one", async function () {
    const run = fixture();
    await run.execute();
    expect(run.sends()).to.equal(1);
    await run.execute();
    expect(run.sends()).to.equal(1);
  });

  it("adopts a submitted receipt before later state checks or finality", async function () {
    const run = fixture();
    await run.execute();
    const entry = run.checkpoint.transactions.deployModule;
    entry.status = "submitted";
    entry.receipt = null;
    entry.actualCostWei = null;
    let saves = 0;
    await revalidateCheckpointTransactions({
      provider: run.provider,
      checkpoint: run.checkpoint,
      confirmations: 2,
      timeoutMs: 1_000,
      saveCheckpoint: async () => {
        saves += 1;
      },
    });
    expect(entry.status).to.equal("confirmed");
    expect(entry.receipt.hash).to.equal(HASH);
    expect(entry.actualCostWei).to.equal("200");
    expect(saves).to.equal(1);
  });

  it("rejects cumulative confirmed costs above the mainnet release cap", async function () {
    const run = fixture();
    await run.execute();
    await expectRejects(
      () =>
        revalidateCheckpointTransactions({
          provider: run.provider,
          checkpoint: run.checkpoint,
          confirmations: 2,
          timeoutMs: 1_000,
          maxCostWei: 199n,
        }),
      "Checkpoint fee reservations exceed ESPACE_MAINNET_MAX_CFX",
    );
  });

  it("rejects checkpoint actual cost evidence that differs from the canonical receipt", async function () {
    const run = fixture();
    await run.execute();
    run.checkpoint.transactions.deployModule.actualCostWei = "201";
    await expectRejects(
      () =>
        revalidateCheckpointTransactions({
          provider: run.provider,
          checkpoint: run.checkpoint,
          confirmations: 2,
          timeoutMs: 1_000,
          maxCostWei: 10_000n,
        }),
      "checkpoint actualCostWei does not match its canonical receipt",
    );
  });

  it("stops before broadcast when the cumulative worst-case fee exceeds the cap", async function () {
    const run = fixture({ cap: 199n });
    await expectRejects(run.execute, "would exceed ESPACE_MAINNET_MAX_CFX");
    expect(run.sends()).to.equal(0);
  });

  it("stops before planning when the deployer nonce differs from the immutable sequence", async function () {
    const run = fixture({ expectedNonces: { deployModule: 8 } });
    await expectRejects(run.execute, "expected deployer nonce 8");
    expect(run.sends()).to.equal(0);
    expect(run.checkpoint.transactions).to.deep.equal({});
  });

  it("fails closed for labels absent from a non-empty immutable nonce plan", async function () {
    const run = fixture({ expectedNonces: { anotherStep: 7 } });
    await expectRejects(run.execute, "not present in the immutable release transaction plan");
    expect(run.sends()).to.equal(0);
    expect(run.checkpoint.transactions).to.deep.equal({});
  });

  it("fails closed for labels absent from a non-empty immutable intent plan", async function () {
    const otherIntent = { ...expectedDeploymentIntent(), label: "anotherStep" };
    const run = fixture({ expectedIntents: [otherIntent] });
    await expectRejects(run.execute, "not present in the immutable release intent plan");
    expect(run.sends()).to.equal(0);
    expect(run.checkpoint.transactions).to.deep.equal({});
  });

  it("checks every checkpoint intent field and fee reservation before any send", async function () {
    const mutations = {
      label: (entry) => (entry.label = "changedLabel"),
      kind: (entry) => (entry.kind = "call"),
      from: (entry) => (entry.from = "0x3000000000000000000000000000000000000003"),
      nonce: (entry) => {
        entry.request.nonce = 8;
        entry.predictedAddress = ethers.getCreateAddress({ from: ADDRESS, nonce: 8 });
      },
      chainId: (entry) => (entry.request.chainId = "1"),
      to: (entry) => (entry.request.to = "0x3000000000000000000000000000000000000003"),
      value: (entry) => {
        entry.request.value = "1";
        entry.maximumCostWei = "201";
      },
      calldata: (entry) => {
        entry.request.data = "0x6001";
        entry.dataHash = ethers.keccak256("0x6001");
      },
      dataHash: (entry) => (entry.dataHash = ethers.keccak256("0x6001")),
      predictedAddress: (entry) =>
        (entry.predictedAddress = "0x3000000000000000000000000000000000000003"),
      maximumCostWei: (entry) => (entry.maximumCostWei = "201"),
    };
    for (const [field, mutate] of Object.entries(mutations)) {
      const run = fixture({ expectedIntents: [expectedDeploymentIntent()] });
      run.checkpoint.transactions.deployModule = plannedEntry();
      mutate(run.checkpoint.transactions.deployModule);
      await expectRejects(run.execute, "checkpoint");
      expect(run.sends(), field).to.equal(0);
    }
  });

  it("rejects a new request whose calldata differs from the immutable intent", async function () {
    const run = fixture({ expectedIntents: [expectedDeploymentIntent()] });
    await expectRejects(
      () => run.executeWith({ data: "0x6001", value: 0n, gasLimit: 100n }),
      "transaction request calldata differs",
    );
    expect(run.sends()).to.equal(0);
    expect(run.checkpoint.transactions).to.deep.equal({});
  });

  it("allows null recovery preflight only when an immutable intent is present", async function () {
    const withoutIntent = fixture({ recoveryTransactions: { deployModule: HASH } });
    withoutIntent.checkpoint.transactions.deployModule = plannedEntry();
    await expectRejects(
      () => withoutIntent.executeWith(null),
      "null transaction request requires an immutable release intent",
    );
    expect(withoutIntent.sends()).to.equal(0);

    const withIntent = fixture({
      expectedIntents: [expectedDeploymentIntent()],
      recoveryTransactions: { deployModule: HASH },
    });
    withIntent.checkpoint.transactions.deployModule = plannedEntry();
    await withIntent.executeWith(null);
    expect(withIntent.sends()).to.equal(0);
    expect(withIntent.checkpoint.transactions.deployModule.recoveredHash).to.equal(true);
  });

  it("uses a 130% estimate when gasLimit was not explicitly requested", async function () {
    const run = fixture({ explicitGasLimit: null, estimatedGas: 100n, gasUsed: 100n });
    await run.execute();
    const entry = run.checkpoint.transactions.deployModule;
    expect(entry.request.gasLimit).to.equal("130");
    expect(entry.maximumCostWei).to.equal("260");
    expect(entry.receipt.gasCharged).to.equal("100");
    expect(entry.actualCostWei).to.equal("200");
  });

  it("applies the eSpace three-quarter charged-gas floor", async function () {
    const run = fixture({ explicitGasLimit: 130n, gasUsed: 50n });
    await run.execute();
    const entry = run.checkpoint.transactions.deployModule;
    expect(entry.request.gasLimit).to.equal("130");
    expect(entry.receipt.gasUsed).to.equal("50");
    expect(entry.receipt.gasCharged).to.equal("98");
    expect(entry.actualCostWei).to.equal("196");
  });

  it("checks deployer balance against the current reservation before sending", async function () {
    const run = fixture({ balance: 199n });
    await expectRejects(run.execute, "balance is below its maximum reserved transaction cost");
    expect(run.sends()).to.equal(0);
    expect(run.checkpoint.transactions.deployModule.status).to.equal("planned");
  });

  it("writes private checkpoint files atomically and prevents concurrent execution", async function () {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-mainnet-state-"));
    const statePath = path.join(directory, "state.json");
    const lockPath = path.join(directory, "release.lock");
    try {
      await writeJsonAtomic(statePath, { amount: 1n });
      expect(await readJsonIfExists(statePath)).to.deep.equal({ amount: "1" });
      const mode = (await fs.stat(statePath)).mode & 0o777;
      expect(mode).to.equal(0o600);
      const release = await acquireReleaseLock(lockPath, { planDigest: HASH });
      await expectRejects(() => acquireReleaseLock(lockPath), "already exists");
      await release();
      const releaseAgain = await acquireReleaseLock(lockPath);
      await releaseAgain();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
