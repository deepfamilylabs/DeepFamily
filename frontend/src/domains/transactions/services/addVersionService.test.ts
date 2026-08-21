import {
  computeVersionHash,
  packSubmitterAndSelfSuiteId,
} from "@deepfamily/protocol-core";
import { ethers } from "ethers";
import { describe, expect, it, vi } from "vitest";
import { createDeepFamilyInterface } from "../../../shared/clients/contractFactory";
import { wrapIdentityCommitmentAsPersonHash } from "../../../shared/zk/zk";
import {
  executeAddVersionFlow,
  type AddVersionPublicSignals,
} from "./addVersionService";

const CONTRACT = "0x0000000000000000000000000000000000000abc";
const ARCHIVE = "0x0000000000000000000000000000000000000acd";
const SUBMITTER = "0x00000000000000000000000000000000000000aa";
const VERIFIER = "0x0000000000000000000000000000000000000def";

const metadataEnvelope = (selfSuiteId = 1): Uint8Array => {
  const envelope = new Uint8Array(20);
  envelope.set(new TextEncoder().encode("DFM1"));
  envelope[4] = 1;
  envelope[16] = (selfSuiteId >>> 24) & 0xff;
  envelope[17] = (selfSuiteId >>> 16) & 0xff;
  envelope[18] = (selfSuiteId >>> 8) & 0xff;
  envelope[19] = selfSuiteId & 0xff;
  return envelope;
};

const proof = { circuitId: 1, proofEncodingId: 1, proofData: "0x1234" } as const;

const rootSignals = (submitter = SUBMITTER, selfSuiteId = 1): AddVersionPublicSignals => ({
  identityCommitment: 11n,
  fatherIdentityCommitment: 0n,
  motherIdentityCommitment: 0n,
  submitterAndSelfSuiteId: packSubmitterAndSelfSuiteId(submitter, selfSuiteId),
  versionCommitment: 99n,
});

const parentedSignals = (): AddVersionPublicSignals => ({
  identityCommitment: 11n,
  fatherIdentityCommitment: 22n,
  motherIdentityCommitment: 33n,
  submitterAndSelfSuiteId: packSubmitterAndSelfSuiteId(SUBMITTER, 1),
  versionCommitment: 99n,
});

const submitMethod = (receipt: any = { blockNumber: 55, logs: [] }) =>
  Object.assign(
    vi.fn(async () => ({
      hash: "0xtxhash",
      wait: vi.fn(async () => receipt),
    })),
    {
      estimateGas: vi.fn(async () => 1000n),
      staticCall: vi.fn(async () => undefined),
    },
  );

const preflightContract = (overrides: Record<string, unknown> = {}) => ({
  versionExists: vi.fn(async () => false),
  verifierRegistry: vi.fn(async () => VERIFIER),
  personVersionsCount: vi.fn(async () => 2n),
  ...overrides,
});

describe("addVersionService fresh-v1 flow", () => {
  it("rejects a duplicate versionCommitment before proof submission", async () => {
    const signals = rootSignals();
    const preflight = preflightContract({ versionExists: vi.fn(async () => true) });
    const submit = submitMethod();

    await expect(
      executeAddVersionFlow({
        submitContract: { addPersonVersion: submit },
        preflightContract: preflight,
        contractAddress: CONTRACT,
        submitterAddress: SUBMITTER,
        proof,
        publicSignals: signals,
        fatherVersionIndex: 0,
        motherVersionIndex: 0,
        metadataEnvelope: metadataEnvelope(),
      }),
    ).rejects.toMatchObject({ reason: "DuplicateVersionCommitment" });

    const personHash = wrapIdentityCommitmentAsPersonHash(signals.identityCommitment);
    const expectedVersionHash = computeVersionHash({
      personHash,
      fatherHash: ethers.ZeroHash,
      fatherVersionIndex: 0,
      motherHash: ethers.ZeroHash,
      motherVersionIndex: 0,
      versionCommitment: signals.versionCommitment,
    });
    expect(preflight.versionExists).toHaveBeenCalledWith(personHash, expectedVersionHash);
    expect(submit).not.toHaveBeenCalled();
  });

  it("fails closed when circuitId has no PersonRelation verifier route", async () => {
    const submit = submitMethod();
    await expect(
      executeAddVersionFlow({
        submitContract: { addPersonVersion: submit },
        preflightContract: preflightContract({
          verifierRegistry: vi.fn(async () => ethers.ZeroAddress),
        }),
        contractAddress: CONTRACT,
        submitterAddress: SUBMITTER,
        proof,
        publicSignals: rootSignals(),
        fatherVersionIndex: 0,
        motherVersionIndex: 0,
        metadataEnvelope: metadataEnvelope(),
      }),
    ).rejects.toMatchObject({ reason: "VerifierRouteNotSet" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("rejects packed submitter or self-suite values that disagree with caller/header", async () => {
    const base = {
      submitContract: { addPersonVersion: submitMethod() },
      preflightContract: preflightContract(),
      contractAddress: CONTRACT,
      proof,
      fatherVersionIndex: 0,
      motherVersionIndex: 0,
    };

    await expect(
      executeAddVersionFlow({
        ...base,
        submitterAddress: SUBMITTER,
        publicSignals: rootSignals("0x00000000000000000000000000000000000000BB"),
        metadataEnvelope: metadataEnvelope(),
      }),
    ).rejects.toMatchObject({ reason: "CallerMismatch" });

    await expect(
      executeAddVersionFlow({
        ...base,
        submitterAddress: SUBMITTER,
        publicSignals: rootSignals(SUBMITTER, 2),
        metadataEnvelope: metadataEnvelope(1),
      }),
    ).rejects.toMatchObject({ reason: "CallerOrIdentitySuiteMismatch" });
  });

  it("rejects parent indices without commitments and out-of-range referenced versions", async () => {
    const submit = submitMethod();
    await expect(
      executeAddVersionFlow({
        submitContract: { addPersonVersion: submit },
        preflightContract: preflightContract(),
        contractAddress: CONTRACT,
        submitterAddress: SUBMITTER,
        proof,
        publicSignals: rootSignals(),
        fatherVersionIndex: 1,
        motherVersionIndex: 0,
        metadataEnvelope: metadataEnvelope(),
      }),
    ).rejects.toMatchObject({ reason: "InvalidParentHash" });

    const count = vi.fn(async () => 0n);
    await expect(
      executeAddVersionFlow({
        submitContract: { addPersonVersion: submit },
        preflightContract: preflightContract({ personVersionsCount: count }),
        contractAddress: CONTRACT,
        submitterAddress: SUBMITTER,
        proof,
        publicSignals: parentedSignals(),
        fatherVersionIndex: 1,
        motherVersionIndex: 1,
        metadataEnvelope: metadataEnvelope(),
      }),
    ).rejects.toMatchObject({ reason: "InvalidFatherVersionIndex" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("reconciles a known submitted transaction before duplicate preflight or resubmission", async () => {
    const signals = rootSignals();
    const envelope = metadataEnvelope();
    const personHash = wrapIdentityCommitmentAsPersonHash(signals.identityCommitment);
    const eventInterface = createDeepFamilyInterface();
    const archiveInterface = new ethers.Interface([
      "event MetadataStored(bytes32 indexed personHash,uint256 indexed versionIndex,address pointer,bytes32 payloadHash,uint32 payloadLength)",
    ]);
    const added = eventInterface.getEvent("PersonVersionAdded")!;
    const stored = archiveInterface.getEvent("MetadataStored")!;
    const pointer = "0x0000000000000000000000000000000000000b10";
    const payloadHash = ethers.keccak256(envelope);
    const transactionHash = `0x${"aa".repeat(32)}`;
    const addedLog = eventInterface.encodeEventLog(added, [
      personHash,
      1n,
      SUBMITTER,
      123n,
      ethers.ZeroHash,
      0n,
      ethers.ZeroHash,
      0n,
      signals.versionCommitment,
    ]);
    const storedLog = archiveInterface.encodeEventLog(stored, [
      personHash,
      1n,
      pointer,
      payloadHash,
      envelope.length,
    ]);
    const receipt = {
      hash: transactionHash,
      status: 1,
      blockNumber: 55,
      logs: [
        { address: CONTRACT, topics: addedLog.topics, data: addedLog.data },
        { address: ARCHIVE, topics: storedLog.topics, data: storedLog.data },
      ],
    };
    const getTransactionReceipt = vi.fn(async () => receipt);
    const submit = submitMethod();
    submit.mockResolvedValueOnce({
      hash: transactionHash,
      wait: vi.fn(async () => {
        throw new Error("RPC timeout while waiting for receipt");
      }),
    });
    const versionExists = vi.fn(async () => false);
    const preflight = preflightContract({ versionExists });
    const onTransactionSubmitted = vi.fn();

    await expect(
      executeAddVersionFlow({
        submitContract: { addPersonVersion: submit },
        preflightContract: preflight,
        contractAddress: CONTRACT,
        submitterAddress: SUBMITTER,
        proof,
        publicSignals: signals,
        fatherVersionIndex: 0,
        motherVersionIndex: 0,
        metadataEnvelope: envelope,
        onTransactionSubmitted,
      }),
    ).rejects.toThrow("RPC timeout while waiting for receipt");
    expect(onTransactionSubmitted).toHaveBeenCalledWith(transactionHash);

    // Simulate the exact race that must not trigger a duplicate resubmission:
    // by retry time the immutable version now exists, but only our recorded tx
    // hash is accepted as evidence that this submission succeeded.
    versionExists.mockResolvedValue(true);

    const result = await executeAddVersionFlow({
      submitContract: { addPersonVersion: submit },
      preflightContract: preflight,
      contractAddress: CONTRACT,
      submitterAddress: SUBMITTER,
      proof,
      publicSignals: signals,
      fatherVersionIndex: 0,
      motherVersionIndex: 0,
      metadataEnvelope: envelope,
      reconcileTransactionHash: transactionHash,
      getTransactionReceipt,
    });

    expect(getTransactionReceipt).toHaveBeenCalledWith(transactionHash);
    expect(preflight.verifierRegistry).toHaveBeenCalledTimes(1);
    expect(preflight.versionExists).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      hash: personHash,
      index: 1,
      transactionHash,
      events: {
        PersonVersionAdded: { versionCommitment: "99", addedBy: ethers.getAddress(SUBMITTER) },
        MetadataStored: { payloadHash, payloadLength: envelope.length },
      },
    });
  });

  it("never treats another transaction's duplicate version as success while its own hash is pending", async () => {
    const submit = submitMethod();
    const versionExists = vi.fn(async () => true);
    const getTransactionReceipt = vi.fn(async () => null);
    const transactionHash = `0x${"bb".repeat(32)}`;

    await expect(
      executeAddVersionFlow({
        submitContract: { addPersonVersion: submit },
        preflightContract: preflightContract({ versionExists }),
        contractAddress: CONTRACT,
        submitterAddress: SUBMITTER,
        proof,
        publicSignals: rootSignals(),
        fatherVersionIndex: 0,
        motherVersionIndex: 0,
        metadataEnvelope: metadataEnvelope(),
        reconcileTransactionHash: transactionHash,
        getTransactionReceipt,
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_RECEIPT_PENDING" });

    expect(getTransactionReceipt).toHaveBeenCalledWith(transactionHash);
    expect(versionExists).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("rejects a receipt returned for any hash other than the exact submitted transaction", async () => {
    const submit = submitMethod();
    const transactionHash = `0x${"bb".repeat(32)}`;

    await expect(
      executeAddVersionFlow({
        submitContract: { addPersonVersion: submit },
        preflightContract: preflightContract({ versionExists: vi.fn(async () => true) }),
        contractAddress: CONTRACT,
        submitterAddress: SUBMITTER,
        proof,
        publicSignals: rootSignals(),
        fatherVersionIndex: 0,
        motherVersionIndex: 0,
        metadataEnvelope: metadataEnvelope(),
        reconcileTransactionHash: transactionHash,
        getTransactionReceipt: async () => ({
          hash: `0x${"bc".repeat(32)}`,
          status: 1,
          blockNumber: 55,
          logs: [],
        }),
      }),
    ).rejects.toMatchObject({
      code: "TRANSACTION_RECONCILIATION_MISMATCH",
      transactionReconciliationFinal: true,
    });

    expect(submit).not.toHaveBeenCalled();
  });

  it("fails terminally when the exact submitted transaction receipt reverted", async () => {
    const submit = submitMethod();
    const versionExists = vi.fn(async () => true);
    const transactionHash = `0x${"cc".repeat(32)}`;

    await expect(
      executeAddVersionFlow({
        submitContract: { addPersonVersion: submit },
        preflightContract: preflightContract({ versionExists }),
        contractAddress: CONTRACT,
        submitterAddress: SUBMITTER,
        proof,
        publicSignals: rootSignals(),
        fatherVersionIndex: 0,
        motherVersionIndex: 0,
        metadataEnvelope: metadataEnvelope(),
        reconcileTransactionHash: transactionHash,
        getTransactionReceipt: async () => ({
          hash: transactionHash,
          status: 0,
          blockNumber: 55,
          logs: [],
        }),
      }),
    ).rejects.toMatchObject({ code: "CALL_EXCEPTION", transactionReconciliationFinal: true });

    expect(versionExists).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("continues when the duplicate preflight RPC is unavailable and submits only the v1 ABI tuple", async () => {
    const submit = submitMethod();
    const signals = rootSignals();
    const envelope = metadataEnvelope();
    const result = await executeAddVersionFlow({
      submitContract: { addPersonVersion: submit },
      preflightContract: preflightContract({
        versionExists: vi.fn(async () => {
          throw new Error("rpc unavailable");
        }),
      }),
      contractAddress: CONTRACT,
      submitterAddress: SUBMITTER,
      proof,
      publicSignals: signals,
      fatherVersionIndex: 0,
      motherVersionIndex: 0,
      metadataEnvelope: envelope,
    });

    expect(submit).toHaveBeenCalledWith(proof, signals, 0, 0, envelope, { gasLimit: 1200n });
    expect(result.transactionHash).toBe("0xtxhash");
  });

  it("parses PersonVersionAdded and Archive MetadataStored without tag or CID", async () => {
    const signals = parentedSignals();
    const personHash = wrapIdentityCommitmentAsPersonHash(signals.identityCommitment);
    const fatherHash = wrapIdentityCommitmentAsPersonHash(signals.fatherIdentityCommitment);
    const motherHash = wrapIdentityCommitmentAsPersonHash(signals.motherIdentityCommitment);
    const eventInterface = createDeepFamilyInterface();
    const archiveInterface = new ethers.Interface([
      "event MetadataStored(bytes32 indexed personHash,uint256 indexed versionIndex,address pointer,bytes32 payloadHash,uint32 payloadLength)",
    ]);
    const verified = eventInterface.getEvent("PersonHashZKVerified")!;
    const added = eventInterface.getEvent("PersonVersionAdded")!;
    const rewarded = eventInterface.getEvent("TokenRewardDistributed")!;
    const stored = archiveInterface.getEvent("MetadataStored")!;
    const pointer = "0x0000000000000000000000000000000000000b10";
    const payloadHash = `0x${"44".repeat(32)}`;
    const encodedLogs = [
      { address: CONTRACT, ...eventInterface.encodeEventLog(verified, [personHash, SUBMITTER]) },
      {
        address: CONTRACT,
        ...eventInterface.encodeEventLog(added, [
          personHash,
          2n,
          SUBMITTER,
          123n,
          fatherHash,
          1n,
          motherHash,
          1n,
          signals.versionCommitment,
        ]),
      },
      {
        address: CONTRACT,
        ...eventInterface.encodeEventLog(rewarded, [
          SUBMITTER,
          personHash,
          2n,
          1_000_000_000_000_000_000n,
        ]),
      },
      {
        address: ARCHIVE,
        ...archiveInterface.encodeEventLog(stored, [personHash, 2n, pointer, payloadHash, 20]),
      },
    ];
    const receipt = {
      blockNumber: 55,
      logs: encodedLogs.map((log) => ({
        address: log.address,
        topics: log.topics,
        data: log.data,
      })),
    };
    const submit = submitMethod(receipt);
    const onTransactionSubmitted = vi.fn();
    const envelope = metadataEnvelope();

    const result = await executeAddVersionFlow({
      submitContract: { addPersonVersion: submit },
      preflightContract: preflightContract(),
      contractAddress: CONTRACT,
      submitterAddress: SUBMITTER,
      proof,
      publicSignals: signals,
      fatherVersionIndex: 1,
      motherVersionIndex: 1,
      metadataEnvelope: envelope,
      onTransactionSubmitted,
    });

    expect(onTransactionSubmitted).toHaveBeenCalledWith("0xtxhash");
    expect(submit).toHaveBeenCalledWith(proof, signals, 1, 1, envelope, { gasLimit: 1200n });
    expect(result).toMatchObject({
      hash: personHash,
      index: 2,
      rewardAmount: 1,
      events: {
        PersonVersionAdded: {
          personHash,
          versionIndex: 2,
          versionCommitment: "99",
          fatherHash,
          motherHash,
        },
        MetadataStored: {
          personHash,
          versionIndex: 2,
          pointer: ethers.getAddress(pointer),
          payloadHash,
          payloadLength: 20,
        },
      },
    });
  });
});
