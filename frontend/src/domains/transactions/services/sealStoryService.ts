import { ethers, type JsonRpcSigner } from "ethers";
import {
  createDeepFamilyContract,
  createDeepFamilyInterface,
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
  const contract = createDeepFamilyContract(contractAddress, signer);

  try {
    const tx = await contract.sealStory(tokenId);
    const receipt = await waitForTransactionReceipt(tx);
    const eventInterface = createDeepFamilyInterface();
    const sealEvent = parseReceiptEvents(receipt, eventInterface, contractAddress).find(
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
    throw normalizeStoryTxError(error, contract);
  }
}
