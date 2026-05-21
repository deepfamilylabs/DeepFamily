import { ethers, type JsonRpcSigner } from "ethers";
import { createDeepFamilyContract, createDeepFamilyInterface } from "../../../shared/clients/contractFactory";
import { makeDraftStorySealAttestationRef } from "../../../shared/attestation";
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
    const actor = await signer.getAddress();
    const network = await signer.provider.getNetwork();
    const metadata = await contract.storyMetadata(tokenId);
    const attestationRef = makeDraftStorySealAttestationRef({
      chainId: network.chainId,
      contractAddress,
      actor,
      tokenId,
      totalChunks: metadata.totalChunks,
      fullStoryHash: metadata.fullStoryHash,
    });

    const tx = await contract.sealStory(tokenId, attestationRef);
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
