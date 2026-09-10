import { ethers, type JsonRpcSigner } from "ethers";
import {
  computeStoryHead,
  computeStoryRecordHash,
  readStoryRecord,
  STORY_BIOGRAPHY_SCHEMA_ID,
} from "@deepfamily/protocol-core";
import {
  createArchiveContract,
  createArchiveInterface,
  createDeepFamilyInterface,
} from "../../../shared/clients/contractFactory";
import { parseReceiptEvents, waitForTransactionReceipt } from "../api/txGateway";
import {
  archiveValidationError,
  assertBlobRefMatches,
  estimateArchiveTransaction,
  type ArchiveTransactionPreview,
} from "./archiveTransaction";

/** Mint and its initial biography are estimated, sent, and verified as one transaction. */
export async function mintBiographyTransaction(input: {
  contract: any;
  signer: JsonRpcSigner;
  args: readonly unknown[];
  personHash: string;
  confirm: (preview: ArchiveTransactionPreview) => Promise<boolean>;
  onSubmitted?: () => void;
}) {
  const { contract, signer } = input;
  // Clone nested proof/core-info data too; edits during the preview cannot alter the call.
  const args = structuredClone(input.args);
  const payload = String(args[5]);
  if (ethers.keccak256(payload) !== args[6])
    throw archiveValidationError("Mint biography hash mismatch");
  const [author, network, archiveAddress, contractAddress] = await Promise.all([
    signer.getAddress(),
    signer.provider.getNetwork(),
    contract.archive(),
    contract.getAddress(),
  ]);
  const preview = await estimateArchiveTransaction({
    contractMethod: contract.mintPersonVersionNFT,
    args,
    provider: signer.provider,
    calldata: contract.interface.encodeFunctionData("mintPersonVersionNFT", args),
    payload,
    kind: "Mint",
  });
  if (!(await input.confirm(preview)))
    throw archiveValidationError("Mint cancelled before wallet request");
  const [currentAuthor, currentNetwork] = await Promise.all([
    signer.getAddress(),
    signer.provider.getNetwork(),
  ]);
  if (
    author.toLowerCase() !== currentAuthor.toLowerCase() ||
    network.chainId !== currentNetwork.chainId
  )
    throw archiveValidationError("Wallet network or account changed; preview the mint again");
  const tx = await contract.mintPersonVersionNFT(...args, { gasLimit: preview.gasLimit });
  input.onSubmitted?.();
  const receipt = await waitForTransactionReceipt(tx);
  const mints = parseReceiptEvents(receipt, createDeepFamilyInterface(), contractAddress).filter(
    (event) => event.name === "PersonNFTMinted",
  );
  const mint = mints[0]?.args;
  if (
    Number(receipt?.status) !== 1 ||
    String(receipt.hash ?? receipt.transactionHash).toLowerCase() !== tx.hash.toLowerCase() ||
    mints.length !== 1 ||
    String(mint.personHash).toLowerCase() !== input.personHash.toLowerCase() ||
    String(mint.tokenURI) !== args[3] ||
    String(mint.owner).toLowerCase() !== author.toLowerCase() ||
    BigInt(mint.versionIndex) !== BigInt(args[2] as number)
  )
    throw archiveValidationError("Mint receipt does not match the frozen submission");
  const archive = createArchiveContract(archiveAddress, signer);
  const blockTag = receipt.blockNumber;
  const state = await archive.storyState(mint.tokenId, { blockTag });
  const events = parseReceiptEvents(receipt, createArchiveInterface(), archiveAddress).filter(
    (event) =>
      event.name === "StoryRecordAppended" &&
      BigInt(event.args.tokenId) === BigInt(mint.tokenId) &&
      BigInt(event.args.index) === 0n,
  );
  if (preview.payloadBytes === 0) {
    if (events.some((event) => event.args.schemaId === STORY_BIOGRAPHY_SCHEMA_ID))
      throw archiveValidationError("An empty biography unexpectedly produced a record");
    return receipt;
  }
  const event = events[0]?.args;
  if (
    events.length !== 1 ||
    event.schemaId !== STORY_BIOGRAPHY_SCHEMA_ID ||
    String(event.author).toLowerCase() !== author.toLowerCase()
  )
    throw archiveValidationError("Mint biography event is missing or mismatched");
  const expected = {
    payloadHash: preview.payloadHash,
    payloadLength: preview.payloadBytes,
    segmentCount: preview.segmentCount,
  };
  assertBlobRefMatches(event.blob, expected);
  const ref = await archive.storyRecordRef(mint.tokenId, 0, { blockTag });
  assertBlobRefMatches(ref.blob, { ...expected, pointer: event.blob.pointer });
  if (
    ref.schemaId !== STORY_BIOGRAPHY_SCHEMA_ID ||
    String(ref.author).toLowerCase() !== author.toLowerCase() ||
    BigInt(ref.timestamp) !== BigInt(event.timestamp)
  )
    throw archiveValidationError("Mint biography reference does not match its event");
  const restored = await readStoryRecord({
    recordRef: ref,
    blockTag,
    getCode: (address, block) => signer.provider.getCode(address, block),
  });
  if (ethers.hexlify(restored.payload) !== payload || restored.decoded?.chunkType !== 0)
    throw archiveValidationError("Mint biography readback does not match the submitted bytes");
  const recordHash = computeStoryRecordHash({
    chainId: network.chainId,
    archive: archiveAddress,
    tokenId: mint.tokenId,
    index: 0,
    schemaId: ref.schemaId,
    payloadHash: preview.payloadHash,
    payloadLength: preview.payloadBytes,
    author: ref.author,
    timestamp: ref.timestamp,
  });
  const head = computeStoryHead({ previousHead: ethers.ZeroHash, recordHash });
  if (
    event.recordHash !== recordHash ||
    event.newHead !== head ||
    BigInt(state.totalRecords) < 1n ||
    BigInt(state.totalPayloadLength) < BigInt(preview.payloadBytes) ||
    (BigInt(state.totalRecords) === 1n &&
      (state.recordsHead !== head ||
        BigInt(state.totalPayloadLength) !== BigInt(preview.payloadBytes)))
  )
    throw archiveValidationError("Mint biography commitment does not match the final story state");
  return receipt;
}
