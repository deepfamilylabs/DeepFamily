import type {
  ExecuteMintFlowResult,
  MintNFTErrorResultView,
  MintNFTSuccessResultView,
} from "./mintNftTypes";

type SuccessfulMintResult = Extract<ExecuteMintFlowResult, { requiresEndorsement: false }>;

interface BuildMintNFTSuccessResultArgs {
  result: SuccessfulMintResult;
  personHash: string;
  versionIndex: number;
  tokenURI: string;
  owner?: string | null;
}

export function toMintNFTErrorResult(
  type: string,
  message: string,
  retryable?: boolean,
): MintNFTErrorResultView {
  return {
    type,
    message,
    details: message,
    retryable,
  };
}

export function buildMintNFTSuccessResultView({
  result,
  personHash,
  versionIndex,
  tokenURI,
  owner,
}: BuildMintNFTSuccessResultArgs): MintNFTSuccessResultView {
  const timestamp = Math.floor(Date.now() / 1000);

  return {
    tokenId: result.tokenId,
    personHash,
    versionIndex,
    tokenURI,
    transactionHash: result.transactionHash,
    blockNumber: result.blockNumber,
    events: {
      PersonNFTMinted: result.event
        ? {
            personHash: result.event.personHash,
            tokenId: result.event.tokenId || result.tokenId,
            owner: result.event.owner || owner,
            versionIndex: result.event.versionIndex || versionIndex,
            tokenURI: result.event.tokenURI || tokenURI,
            timestamp: result.event.timestamp || timestamp,
          }
        : null,
    },
  };
}
