import { describe, expect, it, vi } from "vitest";
import { createDeepFamilyInterface } from "../../../shared/clients/contractFactory";
import { executeAddVersionFlow } from "./addVersionService";

describe("addVersionService executeAddVersionFlow", () => {
  it("throws DuplicateVersion when preflight reports an existing version", async () => {
    const submitContract = {
      addPersonVersion: vi.fn(),
    };
    const preflightMethod = Object.assign(vi.fn(), {
      estimateGas: vi.fn(),
      staticCall: vi.fn(),
    });
    const preflightContract = {
      versionExists: vi.fn(async () => true),
      addPersonVersion: preflightMethod,
    };

    await expect(
      executeAddVersionFlow({
        submitContract,
        preflightContract,
        contractAddress: "0x0000000000000000000000000000000000000abc",
        proof: {} as any,
        publicSignals: {
          identityCommitment: 1n,
          fatherIdentityCommitment: 0n,
          motherIdentityCommitment: 0n,
          submitter: 2n,
          schemaVersion: 1,
          cryptoSuiteVersion: 1,
          hashAlgoId: 1,
        },
        fatherVersionIndex: 0,
        motherVersionIndex: 0,
        tag: "root",
        metadataCID: "cid",
      }),
    ).rejects.toMatchObject({ reason: "DuplicateVersion" });

    expect(submitContract.addPersonVersion).not.toHaveBeenCalled();
  });

  it("continues to submit when duplicate preflight fails for non-duplicate reasons", async () => {
    const proof = {} as any;
    const publicSignals = {
      identityCommitment: 1n,
      fatherIdentityCommitment: 2n,
      motherIdentityCommitment: 3n,
      submitter: 2n,
      schemaVersion: 1,
      cryptoSuiteVersion: 1,
      hashAlgoId: 1,
    };
    const preflightMethod = Object.assign(vi.fn(), {
      estimateGas: vi.fn(async () => 1000n),
      staticCall: vi.fn(async () => undefined),
    });
    const preflightContract = {
      versionExists: vi.fn(async () => {
        throw new Error("rpc unavailable");
      }),
      addPersonVersion: preflightMethod,
    };
    const submitMethod = Object.assign(
      vi.fn(async () => ({
        hash: "0xtxhash",
        wait: vi.fn(async () => ({ blockNumber: 55, logs: [] })),
      })),
      {
        estimateGas: vi.fn(async () => 1000n),
        staticCall: vi.fn(async () => undefined),
      },
    );
    const submitContract = {
      addPersonVersion: submitMethod,
    };

    const result = await executeAddVersionFlow({
      submitContract,
      preflightContract,
      contractAddress: "0x0000000000000000000000000000000000000abc",
      proof,
      publicSignals,
      fatherVersionIndex: 0,
      motherVersionIndex: 0,
      tag: "root",
      metadataCID: "cid",
    });

    expect(submitContract.addPersonVersion).toHaveBeenCalledTimes(1);
    expect(result.transactionHash).toBe("0xtxhash");
  });

  it("uses the signer-backed addPersonVersion method for gas estimation", async () => {
    const proof = {} as any;
    const publicSignals = {
      identityCommitment: 1n,
      fatherIdentityCommitment: 2n,
      motherIdentityCommitment: 3n,
      submitter: 2n,
      schemaVersion: 1,
      cryptoSuiteVersion: 1,
      hashAlgoId: 1,
    };
    const preflightMethod = Object.assign(vi.fn(), {
      estimateGas: vi.fn(async () => {
        throw Object.assign(new Error("CallerMismatch"), { reason: "CallerMismatch" });
      }),
      staticCall: vi.fn(async () => {
        throw Object.assign(new Error("CallerMismatch"), { reason: "CallerMismatch" });
      }),
    });
    const submitMethod = Object.assign(
      vi.fn(async () => ({
        hash: "0xtxhash",
        wait: vi.fn(async () => ({ blockNumber: 55, logs: [] })),
      })),
      {
        estimateGas: vi.fn(async () => 1000n),
        staticCall: vi.fn(async () => undefined),
      },
    );
    const preflightContract = {
      versionExists: vi.fn(async () => false),
      verifierRegistry: vi.fn(async () => "0x0000000000000000000000000000000000000def"),
      listPersonVersions: vi.fn(async () => [[], 2n, false, 0n]),
      addPersonVersion: preflightMethod,
    };
    const submitContract = {
      addPersonVersion: submitMethod,
    };

    const result = await executeAddVersionFlow({
      submitContract,
      preflightContract,
      contractAddress: "0x0000000000000000000000000000000000000abc",
      proof,
      publicSignals,
      fatherVersionIndex: 1,
      motherVersionIndex: 1,
      tag: "root",
      metadataCID: "cid",
    });

    expect(preflightMethod.estimateGas).not.toHaveBeenCalled();
    expect(preflightMethod.staticCall).not.toHaveBeenCalled();
    expect(submitMethod.estimateGas).toHaveBeenCalledTimes(1);
    expect(result.transactionHash).toBe("0xtxhash");
  });

  it("throws CallerMismatch before chain submission when signer address differs from proof submitter", async () => {
    const submitContract = {
      addPersonVersion: Object.assign(vi.fn(), {
        estimateGas: vi.fn(),
        staticCall: vi.fn(),
      }),
    };
    const preflightContract = {
      versionExists: vi.fn(async () => false),
      verifierRegistry: vi.fn(async () => "0x0000000000000000000000000000000000000def"),
      addPersonVersion: Object.assign(vi.fn(), {
        estimateGas: vi.fn(),
        staticCall: vi.fn(),
      }),
    };

    await expect(
      executeAddVersionFlow({
        submitContract,
        preflightContract,
        contractAddress: "0x0000000000000000000000000000000000000abc",
        submitterAddress: "0x00000000000000000000000000000000000000aa",
        proof: { proofSystemId: 1 } as any,
        publicSignals: {
          identityCommitment: 1n,
          fatherIdentityCommitment: 0n,
          motherIdentityCommitment: 0n,
          submitter: 2n,
          schemaVersion: 1,
          cryptoSuiteVersion: 1,
          hashAlgoId: 1,
        },
        fatherVersionIndex: 0,
        motherVersionIndex: 0,
        tag: "root",
        metadataCID: "cid",
      }),
    ).rejects.toMatchObject({ reason: "CallerMismatch" });

    expect(submitContract.addPersonVersion).not.toHaveBeenCalled();
  });

  it("throws InvalidParentHash before chain submission when a parent index is provided without a parent commitment", async () => {
    const submitContract = {
      addPersonVersion: vi.fn(),
    };
    const preflightContract = {
      versionExists: vi.fn(async () => false),
      verifierRegistry: vi.fn(async () => "0x0000000000000000000000000000000000000def"),
      addPersonVersion: Object.assign(vi.fn(), {
        estimateGas: vi.fn(),
        staticCall: vi.fn(),
      }),
    };

    await expect(
      executeAddVersionFlow({
        submitContract,
        preflightContract,
        contractAddress: "0x0000000000000000000000000000000000000abc",
        proof: { proofSystemId: 1 } as any,
        publicSignals: {
          identityCommitment: 1n,
          fatherIdentityCommitment: 0n,
          motherIdentityCommitment: 0n,
          submitter: 2n,
          schemaVersion: 1,
          cryptoSuiteVersion: 1,
          hashAlgoId: 1,
        },
        fatherVersionIndex: 1,
        motherVersionIndex: 0,
        tag: "root",
        metadataCID: "cid",
      }),
    ).rejects.toMatchObject({ reason: "InvalidParentHash" });

    expect(submitContract.addPersonVersion).not.toHaveBeenCalled();
  });

  it("throws InvalidFatherVersionIndex before chain submission when requested parent version is out of range", async () => {
    const submitContract = {
      addPersonVersion: vi.fn(),
    };
    const preflightContract = {
      versionExists: vi.fn(async () => false),
      verifierRegistry: vi.fn(async () => "0x0000000000000000000000000000000000000def"),
      listPersonVersions: vi.fn(async () => [[], 0n, false, 0n]),
      addPersonVersion: Object.assign(vi.fn(), {
        estimateGas: vi.fn(),
        staticCall: vi.fn(),
      }),
    };

    await expect(
      executeAddVersionFlow({
        submitContract,
        preflightContract,
        contractAddress: "0x0000000000000000000000000000000000000abc",
        proof: { proofSystemId: 1 } as any,
        publicSignals: {
          identityCommitment: 1n,
          fatherIdentityCommitment: 3n,
          motherIdentityCommitment: 0n,
          submitter: 2n,
          schemaVersion: 1,
          cryptoSuiteVersion: 1,
          hashAlgoId: 1,
        },
        fatherVersionIndex: 1,
        motherVersionIndex: 0,
        tag: "root",
        metadataCID: "cid",
      }),
    ).rejects.toMatchObject({ reason: "InvalidFatherVersionIndex" });

    expect(preflightContract.listPersonVersions).toHaveBeenCalledTimes(1);
    expect(submitContract.addPersonVersion).not.toHaveBeenCalled();
  });

  it("throws VerifierRouteNotSet before chain submission when person verifier is missing", async () => {
    const submitContract = {
      addPersonVersion: vi.fn(),
    };
    const preflightContract = {
      versionExists: vi.fn(async () => false),
      verifierRegistry: vi.fn(async () => "0x0000000000000000000000000000000000000000"),
      addPersonVersion: Object.assign(vi.fn(), {
        estimateGas: vi.fn(),
        staticCall: vi.fn(),
      }),
    };

    await expect(
      executeAddVersionFlow({
        submitContract,
        preflightContract,
        contractAddress: "0x0000000000000000000000000000000000000abc",
        proof: { proofSystemId: 1 } as any,
        publicSignals: {
          identityCommitment: 1n,
          fatherIdentityCommitment: 0n,
          motherIdentityCommitment: 0n,
          submitter: 2n,
          schemaVersion: 1,
          cryptoSuiteVersion: 1,
          hashAlgoId: 1,
        },
        fatherVersionIndex: 0,
        motherVersionIndex: 0,
        tag: "root",
        metadataCID: "cid",
      }),
    ).rejects.toMatchObject({ reason: "VerifierRouteNotSet" });

    expect(submitContract.addPersonVersion).not.toHaveBeenCalled();
  });

  it("submits addPersonVersion, reports submission, and parses receipt events", async () => {
    const proof = {} as any;
    const publicSignals = {
      identityCommitment: 1n,
      fatherIdentityCommitment: 2n,
      motherIdentityCommitment: 3n,
      submitter: 2n,
      schemaVersion: 1,
      cryptoSuiteVersion: 1,
      hashAlgoId: 1,
    };
    const eventInterface = createDeepFamilyInterface();
    const verifiedEvent = eventInterface.getEvent("PersonHashZKVerified");
    const addedEvent = eventInterface.getEvent("PersonVersionAdded");
    const rewardEvent = eventInterface.getEvent("TokenRewardDistributed");
    if (!verifiedEvent || !addedEvent || !rewardEvent) {
      throw new Error("Missing add-version events in ABI");
    }

    const contractAddress = "0x0000000000000000000000000000000000000abc";
    const logs = [
      eventInterface.encodeEventLog(verifiedEvent, [
        "0x00000000000000000000000000000000000000000000000000000000000000aa",
        "0x00000000000000000000000000000000000000bb",
      ]),
      eventInterface.encodeEventLog(addedEvent, [
        "0x00000000000000000000000000000000000000000000000000000000000000aa",
        2n,
        "0x00000000000000000000000000000000000000bb",
        123n,
        "0x00000000000000000000000000000000000000000000000000000000000000cc",
        1n,
        "0x00000000000000000000000000000000000000000000000000000000000000dd",
        1n,
        "root",
      ]),
      eventInterface.encodeEventLog(rewardEvent, [
        "0x00000000000000000000000000000000000000bb",
        "0x00000000000000000000000000000000000000000000000000000000000000aa",
        2n,
        1000000000000000000n,
      ]),
    ];

    const preflightMethod = Object.assign(vi.fn(), {
      estimateGas: vi.fn(async () => 1000n),
      staticCall: vi.fn(async () => undefined),
    });
    const preflightContract = {
      versionExists: vi.fn(async () => false),
      verifierRegistry: vi.fn(async () => "0x0000000000000000000000000000000000000def"),
      listPersonVersions: vi.fn(async () => [[], 2n, false, 0n]),
      addPersonVersion: preflightMethod,
    };
    const tx = {
      hash: "0xtxhash",
      wait: vi.fn(async () => ({
        blockNumber: 55,
        logs: logs.map((log) => ({ address: contractAddress, topics: log.topics, data: log.data })),
      })),
    };
    const submitMethod = Object.assign(vi.fn(async () => tx), {
      estimateGas: vi.fn(async () => 1000n),
      staticCall: vi.fn(async () => undefined),
    });
    const submitContract = {
      addPersonVersion: submitMethod,
    };
    const onTransactionSubmitted = vi.fn();

    const result = await executeAddVersionFlow({
      submitContract,
      preflightContract,
      contractAddress,
      proof,
      publicSignals,
      fatherVersionIndex: 1,
      motherVersionIndex: 1,
      tag: "root",
      metadataCID: "cid",
      onTransactionSubmitted,
    });

    expect(onTransactionSubmitted).toHaveBeenCalledWith("0xtxhash");
    expect(submitContract.addPersonVersion).toHaveBeenCalledWith(
      proof,
      publicSignals,
      1,
      1,
      "root",
      "cid",
      { gasLimit: 1200n },
    );
    expect(result.hash).toBe("0x00000000000000000000000000000000000000000000000000000000000000aa");
    expect(result.index).toBe(2);
    expect(result.events.PersonVersionAdded?.tag).toBe("root");
    expect(result.rewardAmount).toBe(1);
  });
});
