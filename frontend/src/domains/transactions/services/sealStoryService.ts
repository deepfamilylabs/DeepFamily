import { ethers, type JsonRpcSigner } from "ethers";
import {
  createDeepFamilyContract,
  createStoryArchiveContract,
  createStoryArchiveInterface,
} from "../../../shared/clients/contractFactory";
import { parseReceiptEvents, waitForTransactionReceipt } from "../api/txGateway";
import { normalizeStoryTxError } from "../../../shared/lib/errors";

export interface SealStoryResult {
  totalChunks: number;
  fullStoryHash: string;
  transactionHash: string;
  blockNumber: number;
  events: {
    StorySealed: {
      tokenId: string;
      totalChunks: number;
      fullStoryHash: string;
      sealer: string;
    } | null;
  };
}

export async function sealStoryService(
  signer: JsonRpcSigner,
  contractAddress: string,
  tokenId: string,
): Promise<SealStoryResult> {
  const deepFamily = createDeepFamilyContract(contractAddress, signer);
  let errorContract = deepFamily;

  try {
    const storyArchiveAddress = await deepFamily.storyArchive();
    const contract = createStoryArchiveContract(storyArchiveAddress, signer);
    errorContract = contract;
    const tx = await contract.sealStory(tokenId);
    const receipt = await waitForTransactionReceipt(tx);
    const eventInterface = createStoryArchiveInterface();
    const sealEvent = parseReceiptEvents(receipt, eventInterface, storyArchiveAddress).find(
      (event) => event.name === "StorySealed",
    );

    const storySealed = sealEvent
      ? {
          tokenId: sealEvent.args.tokenId.toString(),
          totalChunks: Number(sealEvent.args.totalChunks),
          fullStoryHash: sealEvent.args.fullStoryHash,
          sealer: sealEvent.args.sealer,
        }
      : null;

    return {
      totalChunks: storySealed?.totalChunks ?? 0,
      fullStoryHash: storySealed?.fullStoryHash ?? ethers.ZeroHash,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber,
      events: {
        StorySealed: storySealed,
      },
    };
  } catch (error: any) {
    throw normalizeStoryTxError(error, errorContract);
  }
}
