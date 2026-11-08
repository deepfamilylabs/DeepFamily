import { readArchiveBlob } from "@deepfamily/protocol-core";
import { type Contract, id, isError, keccak256, type Provider, type Signer, type ContractTransactionResponse, type TransactionReceipt } from "ethers";
import { executeChainTransaction, runChainRead, normalizeChainError, withConfirmedTransaction } from "@deepfamily/chain-client";
import { createPrivateLetterContract } from "../../../shared/clients/privateLetterClient";
import { getEventScanConfig } from "../../../shared/config/env";
import { createIdentityAuthorizationContract } from "./shieldedIdentityAuthorizationChain";

export type ProvenPrivateLetter = {
  delivery: { messageId: string; checkpointId: string; asOf: string; deadline: string; recipientBinding: string };
  ciphertext: string;
  proof: string;
};
export type PrivateLetterChainRecord = {
  messageId: string; recipientBinding: string;
  registeredAt: string; deadline: string; ciphertextHash: string; ciphertext: Uint8Array;
  transactionHash: string;
};
/** Public values needed to reconcile one original message without its proof or ciphertext. */
export type ExpectedPrivateLetterRegistration = {
  messageId: string;
  recipientBinding: string;
  deadline: string;
  ciphertextHash: string;
};
export type PrivateLetterCheckResult =
  | { state: "pending" }
  | { state: "confirmed" | "failed"; transactionHash: string };

function matchesLetterEvent(
  contract: Contract,
  address: string,
  log: TransactionReceipt["logs"][number],
  expected: ExpectedPrivateLetterRegistration,
): boolean {
  if (log.address.toLowerCase() !== address.toLowerCase()) return false;
  try {
    const event = contract.interface.parseLog(log);
    return event?.name === "LetterRegistered" && BigInt(event.args.messageId) === BigInt(expected.messageId) &&
      BigInt(event.args.recipientBinding) === BigInt(expected.recipientBinding) &&
      BigInt(event.args.deadline) === BigInt(expected.deadline) &&
      String(event.args.blob.payloadHash).toLowerCase() === expected.ciphertextHash.toLowerCase();
  } catch { return false; }
}

/** Reconcile public state only. An absent registration or expired proof never authorizes a resend. */
export function checkPrivateLetter(input: {
  address: string; provider: Provider; chainId: string;
  expected: ExpectedPrivateLetterRegistration; transactionHash?: string;
}): Promise<PrivateLetterCheckResult> {
  return runChainRead({ read: async () => {
    const { provider, expected } = input;
    if ((await provider.getNetwork()).chainId !== BigInt(input.chainId))
      throw normalizeChainError(new Error("Private letter reader is connected to the wrong network"), { category: "validation", operation: "read" });
    const blockNumber = await provider.getBlockNumber();
    if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) throw new Error("Private letter check block is invalid");
    const anchor = await provider.getBlock(blockNumber);
    if (!anchor?.hash) throw new Error("Private letter check block is unavailable");
    const anchorCurrent = async () => (await provider.getBlock(blockNumber))?.hash === anchor.hash;
    const contract = createPrivateLetterContract(input.address, provider);
    const record = await contract.letterRecord(expected.messageId, { blockTag: blockNumber });
    // The desired registration may be under a replacement hash. Check it before
    // interpreting a failed original receipt as failure of the message itself.
    if (BigInt(record.registeredAt) !== 0n) {
      if (BigInt(record.recipientBinding) !== BigInt(expected.recipientBinding) ||
        BigInt(record.deadline) !== BigInt(expected.deadline) ||
        String(record.blob.payloadHash).toLowerCase() !== expected.ciphertextHash.toLowerCase())
        throw normalizeChainError(new Error("Message number belongs to another registered letter"), { category: "verification", operation: "verify" });
      const filter = contract.filters.LetterRegistered(expected.messageId);
      const fromBlock = Number(await contract.creationBlock({ blockTag: blockNumber }));
      const chunk = getEventScanConfig().blockChunk;
      const matches: { transactionHash: string }[] = [];
      for (let start = fromBlock; start <= blockNumber; start += chunk) {
        const logs = await contract.queryFilter(filter, start, Math.min(blockNumber, start + chunk - 1));
        for (const log of logs) {
          if (!matchesLetterEvent(contract, input.address, log, expected) ||
            BigInt(contract.interface.parseLog(log)!.args.registeredAt) !== BigInt(record.registeredAt))
            throw normalizeChainError(new Error("Private letter registration event does not match its record"), { category: "verification", operation: "verify" });
          matches.push(log);
        }
      }
      if (matches.length !== 1) throw new Error("Existing letter registration could not be confirmed");
      if (!await anchorCurrent()) return { state: "pending" };
      return { state: "confirmed", transactionHash: matches[0].transactionHash };
    }
    if (!input.transactionHash) return { state: "pending" };
    const receipt = await provider.getTransactionReceipt(input.transactionHash);
    if (!receipt || receipt.blockNumber > blockNumber) return { state: "pending" };
    if (receipt.hash.toLowerCase() !== input.transactionHash.toLowerCase() ||
      receipt.to?.toLowerCase() !== input.address.toLowerCase())
      throw normalizeChainError(new Error("Private letter receipt does not match the original transaction"), { category: "verification", operation: "verify" });
    if ((await provider.getBlock(receipt.blockNumber))?.hash !== receipt.blockHash || !await anchorCurrent())
      return { state: "pending" };
    if (receipt.status === 0) return { state: "failed", transactionHash: input.transactionHash };
    if (receipt.status === 1) throw withConfirmedTransaction(
      new Error(receipt.logs.some(log => matchesLetterEvent(contract, input.address, log, expected))
        ? "Letter receipt is confirmed but the registration record could not be verified"
        : "Letter transaction did not register the expected authenticated message"),
      input.transactionHash, "mismatch",
    );
    return { state: "pending" };
  } });
}

/** This proof can no longer execute, so retrying may safely prepare a fresh message. */
export class PrivateLetterPreparationExpiredError extends Error {
  constructor() {
    super("The receive authorization or its checkpoint expired before letter submission");
    this.name = "PrivateLetterPreparationExpiredError";
    normalizeChainError(this, { category: "validation", operation: "submit" });
  }
}

export class PrivateLetterTransactionFailedError extends Error {
  constructor(readonly transactionHash: string) {
    super("The private letter transaction reverted");
    this.name = "PrivateLetterTransactionFailedError";
    normalizeChainError(this, { category: "reverted", operation: "confirm" });
  }
}

/** Only events from the configured authenticated archive become inbox candidates. */
export function readPrivateLetters(contract: Contract): Promise<PrivateLetterChainRecord[]> {
  return runChainRead({ read: () => readPrivateLetterHistory(contract) });
}

async function readPrivateLetterHistory(contract: Contract): Promise<PrivateLetterChainRecord[]> {
  const provider = contract.runner?.provider;
  if (!provider) throw new Error("Private letter archive has no provider");
  const toBlock = await provider.getBlockNumber();
  const anchor = await provider.getBlock(toBlock);
  if (!anchor?.hash) throw new Error("Private letter archive block is unavailable");
  const event = contract.interface.getEvent("LetterRegistered");
  if (!event) throw new Error("Private letter archive ABI is incomplete");
  const fromBlock = Number(await contract.creationBlock({ blockTag: toBlock }));
  const chunk = getEventScanConfig().blockChunk;
  const letters: PrivateLetterChainRecord[] = [];
  const seen = new Set<string>();
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const logs = await provider.getLogs({ address: await contract.getAddress(), topics: [event.topicHash], fromBlock: start, toBlock: Math.min(toBlock, start + chunk - 1) });
    logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
    for (const log of logs) {
      const parsed = contract.interface.parseLog(log)?.args;
      if (!parsed) throw new Error("Private letter event is invalid");
      const messageId = String(parsed.messageId);
      if (seen.has(messageId)) throw new Error("Private letter history contains duplicate messages");
      seen.add(messageId);
      const record = await contract.letterRecord(messageId, { blockTag: toBlock });
      for (const field of ["recipientBinding", "registeredAt", "deadline"])
        if (BigInt(record[field]) !== BigInt(parsed[field])) throw new Error("Private letter record does not match its registration");
      for (const field of ["pointer", "payloadHash", "payloadLength", "segmentCount"])
        if (String(record.blob[field]).toLowerCase() !== String(parsed.blob[field]).toLowerCase()) throw new Error("Private letter archive reference does not match its registration");
      const blob = await readArchiveBlob({ pointer: record.blob.pointer, payloadHash: record.blob.payloadHash, payloadLength: record.blob.payloadLength, segmentCount: record.blob.segmentCount, blockTag: toBlock, getCode: (pointer, blockTag) => provider.getCode(pointer, blockTag) });
      letters.push({ messageId, recipientBinding: String(record.recipientBinding), registeredAt: String(record.registeredAt), deadline: String(record.deadline), ciphertextHash: blob.payloadHash, ciphertext: blob.payload, transactionHash: log.transactionHash });
    }
  }
  if ((await provider.getBlock(toBlock))?.hash !== anchor.hash) throw new Error("Private letter archive was reorganized");
  return letters;
}

/** Wallet submission has no plaintext, credential, identity, recipient key or witness. */
export async function submitPrivateLetter(input: { address: string; signer: Signer; chainId: string; letter: ProvenPrivateLetter; onWalletRequest?: () => () => void; onBroadcast?: (hash: string) => void; onStage?: (stage: "checking" | "submitting" | "confirming") => void; isCurrent?: () => boolean }) {
  input.onStage?.("checking");
  const provider = input.signer.provider;
  if (!provider || (await provider.getNetwork()).chainId !== BigInt(input.chainId))
    throw normalizeChainError(new Error("Transaction wallet is connected to the wrong network"), { category: "wallet", operation: "submit" });
  const submitterAddress = await input.signer.getAddress();
  const contract = createPrivateLetterContract(input.address, input.signer);
  const { delivery, ciphertext, proof } = input.letter;
  const existing = await runChainRead({ read: () => contract.letterRecord(delivery.messageId) });
  if (BigInt(existing.registeredAt) !== 0n) {
    if (BigInt(existing.recipientBinding) !== BigInt(delivery.recipientBinding) ||
      String(existing.blob.payloadHash).toLowerCase() !== keccak256(ciphertext).toLowerCase() ||
      BigInt(existing.deadline) !== BigInt(delivery.deadline)) throw new Error("Message number belongs to another registered letter");
    const logs = await contract.queryFilter(contract.filters.LetterRegistered(delivery.messageId), await contract.creationBlock());
    if (logs.length !== 1) throw new Error("Existing letter registration could not be confirmed");
    return { transactionHash: logs[0].transactionHash };
  }
  const block = await provider.getBlock("latest");
  if (!block) throw new Error("The latest chain block is unavailable");
  if (BigInt(block.timestamp) >= BigInt(delivery.deadline)) throw new PrivateLetterPreparationExpiredError();
  const authorization = createIdentityAuthorizationContract(await contract.AUTHORIZATION_STATE(), provider);
  try {
    await runChainRead({ read: () => authorization.validateCheckpoint(delivery.checkpointId, delivery.asOf) });
  } catch (error) {
    // Only this irreversible expiry permits discarding an uncertain prior attempt.
    // RPC failures retain the original message number so a retry can reconcile it.
    if (isError(error, "CALL_EXCEPTION") && error.data?.slice(0, 10) === id("CheckpointExpired()").slice(0, 10))
      throw new PrivateLetterPreparationExpiredError();
    throw error;
  }
  const fromBlock = await provider.getBlockNumber();
  if (!Number.isSafeInteger(fromBlock) || fromBlock < 0)
    throw normalizeChainError(new Error("Letter submission block is unavailable"), { category: "validation", operation: "submit" });
  const confirmed = await executeChainTransaction<TransactionReceipt, ContractTransactionResponse>({
    fromBlock,
    assertActive: () => {
      if (input.isCurrent && !input.isCurrent())
        throw normalizeChainError(new Error("The transaction wallet changed before letter submission"), { category: "cancelled", operation: "submit" });
    },
    send: async () => {
      input.onStage?.("submitting");
      const finishWalletRequest = input.onWalletRequest?.();
      try {
        return await contract.registerLetter(delivery, ciphertext, proof, { chainId: BigInt(input.chainId) });
      } finally { finishWalletRequest?.(); }
    },
    expected: {
      chainId: BigInt(input.chainId),
      from: submitterAddress,
      to: input.address,
      data: contract.interface.encodeFunctionData("registerLetter", [delivery, ciphertext, proof]),
      value: 0n,
    },
    onSubmitted: hash => { input.onStage?.("confirming"); input.onBroadcast?.(hash); },
    requireSuccess: false,
  });
  const receipt = confirmed.receipt;
  if (receipt.status !== 1) throw new PrivateLetterTransactionFailedError(confirmed.transactionHash);
  const registered = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== input.address.toLowerCase()) return false;
    try {
      const event = contract.interface.parseLog(log);
      return event?.name === "LetterRegistered" && BigInt(event.args.messageId) === BigInt(delivery.messageId) &&
        BigInt(event.args.recipientBinding) === BigInt(delivery.recipientBinding) &&
        BigInt(event.args.deadline) === BigInt(delivery.deadline) &&
        String(event.args.blob.payloadHash).toLowerCase() === keccak256(ciphertext).toLowerCase();
    } catch { return false; }
  });
  if (!registered) throw withConfirmedTransaction(
    new Error("Letter transaction did not register the expected authenticated message"),
    confirmed.transactionHash,
    "mismatch",
  );
  return { transactionHash: confirmed.transactionHash };
}
