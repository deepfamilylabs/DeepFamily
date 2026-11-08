import assert from "node:assert/strict";
import { describe, it } from "mocha";
import {
  ContractTransactionResponse,
  Interface,
  TransactionResponse,
  ZeroHash,
  getBytes,
  hexlify,
  keccak256,
} from "ethers";
import {
  computeStoryRecordHash,
  computeStoryHead,
  STORY_ENVELOPE_SCHEMA_ID,
} from "@deepfamily/protocol-core";
import { getTransactionErrorContext } from "@deepfamily/chain-client";
import { expectedContractInterfaces } from "../scripts/lib/archiveInterfaceDefinition.mjs";
import { appendDfsStoryRecord, sealArchiveStory } from "../lib/archiveOperations.js";

const address = `0x${"11".repeat(20)}`;
const author = `0x${"22".repeat(20)}`;
const pointer = `0x${"33".repeat(20)}`;
const hash = `0x${"ab".repeat(32)}`;
const repricedHash = `0x${"cd".repeat(32)}`;
function fixture({ readFailure, mismatch, badEvent, repriced } = {}) {
  const iface = new Interface(expectedContractInterfaces().deepFamilyArchive.abi);
  let state = {
    totalRecords: 0n,
    recordsHead: ZeroHash,
    totalPayloadLength: 0n,
    isSealed: false,
    lastUpdateTime: 0n,
  };
  let ref;
  let payload;
  let confirmed;
  let replacement;
  const provider = {
    getNetwork: async () => ({ chainId: 31337n }),
    getBlockNumber: async () => 12,
    getTransactionReceipt: async (transactionHash) => (transactionHash === hash ? null : confirmed),
    getTransactionCount: async () => 2,
    getTransaction: async () => null,
    getBlock: async (_number, prefetch) =>
      prefetch
        ? {
            length: 1,
            [Symbol.iterator]: function* () {
              yield repricedHash;
            },
            getTransaction: async () => replacement,
          }
        : { gasLimit: 30_000_000n },
    getCode: async () => {
      if (readFailure === "code") throw new Error("code RPC unavailable");
      return `0x00${payload.slice(2)}`;
    },
  };
  const method = (send) =>
    Object.assign(send, {
      estimateGas: async () => 100_000n,
      populateTransaction: async () => ({ data: "0x1234" }),
    });
  const transaction = (eventName, eventArgs) => {
    confirmed = {
      hash: repriced ? repricedHash : hash,
      status: 1,
      blockNumber: 12,
      logs: [{ address, ...iface.encodeEventLog(iface.getEvent(eventName), eventArgs) }],
    };
    const parameters = {
      hash,
      chainId: 31337n,
      from: author,
      to: address,
      data: "0x1234",
      value: 0n,
      nonce: 1,
      gasLimit: 100_000n,
      gasPrice: 1n,
      type: 0,
      index: 0,
    };
    if (repriced) {
      replacement = new TransactionResponse(
        { ...parameters, hash: repricedHash, gasPrice: 2n, blockNumber: 12 },
        provider,
      );
      // A real ContractTransactionResponse discards the signer's replacement anchor.
      return new ContractTransactionResponse(iface, provider, parameters);
    }
    const response = {
      ...parameters,
      replaceableTransaction: (fromBlock) => {
        assert.equal(fromBlock, 12);
        return response;
      },
      wait: async () => confirmed,
    };
    return response;
  };
  const archive = {
    interface: iface,
    runner: { provider, getAddress: async () => author },
    getAddress: async () => address,
    storyState: async (_id, options) => {
      if (options?.blockTag && readFailure === "state") throw new Error("state RPC unavailable");
      return { ...state };
    },
    storyRecordRef: async () => {
      if (readFailure === "ref") throw new Error("ref RPC unavailable");
      return mismatch ? { ...ref, blob: { ...ref.blob, payloadHash: ZeroHash } } : ref;
    },
    appendStoryRecord: method(
      async (tokenId, index, previousHead, schemaId, bytes, payloadHash) => {
        payload = bytes;
        const blob = {
          pointer,
          payloadHash,
          payloadLength: BigInt(getBytes(bytes).length),
          segmentCount: 1n,
        };
        ref = { blob, schemaId, author, timestamp: 100n };
        const recordHash = computeStoryRecordHash({
          chainId: 31337n,
          archive: address,
          tokenId,
          index,
          schemaId,
          payloadHash,
          payloadLength: blob.payloadLength,
          author,
          timestamp: 100n,
        });
        const head = computeStoryHead({ previousHead, recordHash });
        state = {
          totalRecords: 1n,
          recordsHead: head,
          totalPayloadLength: blob.payloadLength,
          isSealed: false,
          lastUpdateTime: 100n,
        };
        return transaction("StoryRecordAppended", [
          tokenId,
          index,
          blob,
          schemaId,
          badEvent ? pointer : author,
          100n,
          recordHash,
          head,
        ]);
      },
    ),
    sealStory: method(async (tokenId) => {
      state = { ...state, isSealed: true, lastUpdateTime: 101n };
      return transaction("StorySealed", [
        tokenId,
        state.totalRecords,
        state.recordsHead,
        state.totalPayloadLength,
        badEvent ? pointer : author,
        101n,
      ]);
    }),
  };
  return { archive };
}

describe("Archive Node client confirmation context", () => {
  for (const readFailure of ["ref", "code", "state"]) {
    it(`retains a matched successful receipt when ${readFailure} readback fails`, async () => {
      const { archive } = fixture({ readFailure });
      await assert.rejects(
        appendDfsStoryRecord({ archive, tokenId: 1n, content: "public story" }),
        (error) => {
          assert.deepEqual(getTransactionErrorContext(error), {
            transactionHash: hash,
            transactionConfirmed: true,
            verificationFailure: "read",
          });
          return true;
        },
      );
    });
  }
  it("distinguishes invalid returned refs from RPC failures", async () => {
    const { archive } = fixture({ mismatch: true });
    await assert.rejects(
      appendDfsStoryRecord({ archive, tokenId: 1n, content: "public story" }),
      (error) => {
        assert.deepEqual(getTransactionErrorContext(error), {
          transactionHash: hash,
          transactionConfirmed: true,
          verificationFailure: "mismatch",
        });
        return true;
      },
    );
  });
  it("does not call a mismatched event a verified record", async () => {
    const { archive } = fixture({ badEvent: true });
    await assert.rejects(
      appendDfsStoryRecord({ archive, tokenId: 1n, content: "public story" }),
      (error) => {
        assert.deepEqual(getTransactionErrorContext(error), {
          transactionHash: hash,
          transactionConfirmed: true,
          verificationFailure: "mismatch",
        });
        return true;
      },
    );
  });
  it("retains confirmation without verifying a mismatched seal event", async () => {
    const { archive } = fixture({ badEvent: true });
    await assert.rejects(sealArchiveStory({ archive, tokenId: 1n }), (error) => {
      assert.deepEqual(getTransactionErrorContext(error), {
        transactionHash: hash,
        transactionConfirmed: true,
        verificationFailure: "mismatch",
      });
      return true;
    });
  });
  it("still verifies canonical stored bytes and final state on success", async () => {
    const { archive } = fixture();
    const result = await appendDfsStoryRecord({ archive, tokenId: 1n, content: "public story" });
    assert.equal(result.record.decoded.content, "public story");
    assert.equal(result.transactionHash, hash);
    assert.equal(keccak256(result.payload), result.recordRef.blob.payloadHash);
  });
  it("tracks a repriced append through the real ethers contract response", async () => {
    const { archive } = fixture({ repriced: true });
    const result = await appendDfsStoryRecord({ archive, tokenId: 1n, content: "public story" });
    assert.equal(result.transactionHash, repricedHash);
    assert.equal(result.record.decoded.content, "public story");
  });
  it("tracks a repriced seal through the real ethers contract response", async () => {
    const { archive } = fixture({ repriced: true });
    const result = await sealArchiveStory({ archive, tokenId: 1n });
    assert.equal(result.transactionHash, repricedHash);
    assert.equal(result.state.isSealed, true);
  });
  it("retains the seal receipt if final state is unavailable", async () => {
    const { archive } = fixture({ readFailure: "state" });
    await assert.rejects(sealArchiveStory({ archive, tokenId: 1n }), (error) => {
      assert.deepEqual(getTransactionErrorContext(error), {
        transactionHash: hash,
        transactionConfirmed: true,
        verificationFailure: "read",
      });
      return true;
    });
  });
});
