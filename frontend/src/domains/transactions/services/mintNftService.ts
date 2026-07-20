import { createDeepFamilyInterface } from "../../../shared/clients/contractFactory";
import { parseReceiptEvents } from "../api/txGateway";

export type MintDisclosurePublicSignals = {
  identityCommitment: bigint;
  disclosureBinding: bigint;
  minter: bigint;
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
};

export type MintCoreInfo = {
  basicInfo: {
    identityCommitment: string;
    isBirthBC: boolean;
    birthYear: number;
    birthMonth: number;
    birthDay: number;
    gender: number;
  };
  supplementInfo: {
    fullName: string;
    birthPlace: string;
    isDeathBC: boolean;
    deathYear: number;
    deathMonth: number;
    deathDay: number;
    deathPlace: string;
    story: string;
  };
};

export type MintPersonVersionNFTFn = (
  proof: any,
  publicSignals: MintDisclosurePublicSignals,
  versionIndex: number,
  tokenURI: string,
  coreInfo: MintCoreInfo,
) => Promise<any>;

export type MintReceiptEvent = {
  personHash: string;
  tokenId: number;
  owner: string;
  versionIndex: number;
  tokenURI: string;
  timestamp: number;
};

export type ExecuteMintFlowParams = {
  contract: any;
  address: string;
  personHash: string;
  versionIndex: number;
  proofEnvelope: any;
  publicSignals: MintDisclosurePublicSignals;
  tokenURI: string;
  coreInfo: MintCoreInfo;
  mintPersonVersionNFT: MintPersonVersionNFTFn;
  getVersionDetails?: (personHash: string, versionIndex: number) => Promise<any>;
};

export type ExecuteMintFlowResult =
  | {
      requiresEndorsement: true;
    }
  | {
      requiresEndorsement: false;
      receipt: any;
      transactionHash: string;
      blockNumber: number;
      tokenId: number;
      event: MintReceiptEvent | null;
    };

export async function executeMintFlow({
  contract,
  address,
  personHash,
  versionIndex,
  proofEnvelope,
  publicSignals,
  tokenURI,
  coreInfo,
  mintPersonVersionNFT,
  getVersionDetails,
}: ExecuteMintFlowParams): Promise<ExecuteMintFlowResult> {
  const endorsedIdx = await contract.endorsedVersionIndex(personHash, address);
  if (Number(endorsedIdx) !== Number(versionIndex)) {
    return { requiresEndorsement: true };
  }

  const contractAddress = await contract.getAddress();
  const receipt = await mintPersonVersionNFT(
    proofEnvelope,
    publicSignals,
    versionIndex,
    tokenURI,
    coreInfo,
  );

  const eventInterface = createDeepFamilyInterface();
  const mintedEvent = parseReceiptEvents(receipt, eventInterface, contractAddress).find(
    (event) => event.name === "PersonNFTMinted",
  );

  let tokenId = 0;
  if (getVersionDetails) {
    try {
      const details = await getVersionDetails(personHash, versionIndex);
      tokenId = Number(details?.tokenId ?? 0);
    } catch {
      tokenId = 0;
    }
  }

  if (!tokenId && mintedEvent) {
    tokenId = Number(mintedEvent.args?.tokenId ?? 0);
  }

  return {
    requiresEndorsement: false,
    receipt,
    transactionHash: receipt?.hash || receipt?.transactionHash || "",
    blockNumber: Number(receipt?.blockNumber || 0),
    tokenId,
    event: mintedEvent
      ? {
          personHash: mintedEvent.args?.personHash || personHash,
          tokenId: Number(mintedEvent.args?.tokenId ?? tokenId),
          owner: mintedEvent.args?.owner || address,
          versionIndex: Number(mintedEvent.args?.versionIndex ?? versionIndex),
          tokenURI: mintedEvent.args?.tokenURI || tokenURI,
          timestamp: Number(mintedEvent.args?.timestamp || 0),
        }
      : null,
  };
}
