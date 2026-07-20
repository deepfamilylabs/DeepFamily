import { ethers } from "ethers";
import {
  createDeepFamilyInterface,
  createDeepTokenContract,
} from "../../../shared/clients/contractFactory";
import { ensureAllowance } from "../api/erc20Gateway";
import { estimateGasWithFallback, parseReceiptEvents } from "../api/txGateway";

export type EndorseServiceStage = "checking" | "approving" | "submitting";

export type EndorseReceiptEvent = {
  personHash: string;
  endorser: string;
  versionIndex: number;
  recipient?: string;
  recipientShare?: string;
  protocolRecipient?: string;
  protocolShare?: string;
  endorsementFee: string;
  timestamp: number;
};

export type EndorseVersionFn = (
  personHash: string,
  versionIndex: number,
  overrides?: Record<string, unknown>,
  txOptions?: { suppressToasts?: boolean },
) => Promise<any>;

export type ExecuteEndorseFlowParams = {
  contract: ethers.Contract;
  signer: ethers.Signer;
  address: string;
  personHash: string;
  versionIndex: number;
  endorseVersion: EndorseVersionFn;
  deepTokenAddress?: string;
  fallbackGas?: bigint;
  suppressToasts?: boolean;
  onStageChange?: (stage: EndorseServiceStage) => void;
};

export type ExecuteEndorseFlowResult =
  | {
      alreadyEndorsed: true;
    }
  | {
      alreadyEndorsed: false;
      receipt: any;
      transactionHash: string;
      blockNumber: number;
      approvalTxHash?: string;
      deepTokenAddress: string;
      fee: bigint;
      feeFormatted: string;
      balanceBefore: bigint;
      balanceFormatted: string;
      decimals: number;
      symbol: string;
      event: EndorseReceiptEvent | null;
    };

type TokenAllowanceContract = {
  allowance: (owner: string, spender: string) => Promise<bigint>;
  approve: (
    spender: string,
    amount: bigint,
  ) => Promise<{ wait: () => Promise<any>; hash?: string }>;
  increaseAllowance?: (
    spender: string,
    amount: bigint,
  ) => Promise<{ wait: () => Promise<any>; hash?: string }>;
  recentReward: () => Promise<bigint>;
  balanceOf: (owner: string) => Promise<bigint>;
  decimals: () => Promise<bigint | number>;
  symbol: () => Promise<string>;
};

function attachErrorCode(error: unknown, code: string): Error {
  const normalized =
    error instanceof Error ? error : new Error(typeof error === "string" ? error : String(error));
  (normalized as any).code = (normalized as any).code ?? code;
  return normalized;
}

export async function executeEndorseFlow({
  contract,
  signer,
  address,
  personHash,
  versionIndex,
  endorseVersion,
  deepTokenAddress,
  fallbackGas = 400_000n,
  suppressToasts = false,
  onStageChange,
}: ExecuteEndorseFlowParams): Promise<ExecuteEndorseFlowResult> {
  const endorsedIdx = await contract.endorsedVersionIndex(personHash, address);
  if (Number(endorsedIdx) === Number(versionIndex)) {
    return { alreadyEndorsed: true };
  }

  onStageChange?.("checking");

  const tokenAddress = deepTokenAddress || (await contract.DEEP_FAMILY_TOKEN_CONTRACT());
  const tokenContract = createDeepTokenContract(
    tokenAddress,
    signer,
  ) as unknown as TokenAllowanceContract;
  const spender = await contract.getAddress();

  const fee: bigint = await tokenContract.recentReward();

  let decimals = 18;
  try {
    decimals = Number(await tokenContract.decimals());
  } catch {
    decimals = 18;
  }

  let symbol = "DEEP";
  try {
    const nextSymbol = await tokenContract.symbol();
    if (nextSymbol) symbol = nextSymbol;
  } catch {
    symbol = "DEEP";
  }

  const balanceBefore: bigint = await tokenContract.balanceOf(address);
  if (balanceBefore < fee) {
    throw attachErrorCode(
      new Error(
        `Insufficient DEEP token balance: have ${ethers.formatUnits(balanceBefore, decimals)}, need ${ethers.formatUnits(fee, decimals)}`,
      ),
      "INSUFFICIENT_DEEP_BALANCE",
    );
  }

  let approvalTxHash: string | undefined;
  if (fee > 0n) {
    onStageChange?.("approving");
    const approval = await ensureAllowance({
      tokenContract,
      owner: address,
      spender,
      required: fee,
    });
    approvalTxHash = approval.approvalTxHash;
  }

  onStageChange?.("submitting");
  const gasLimit = await estimateGasWithFallback({
    contractMethod: (contract as any).endorseVersion,
    args: [personHash, versionIndex] as const,
    decodeContract: contract,
    fallbackGas,
    label: "endorseVersion",
  });

  const receipt = await endorseVersion(
    personHash,
    versionIndex,
    gasLimit ? { gasLimit } : undefined,
    { suppressToasts },
  );

  const contractAddress = spender;
  const eventInterface = createDeepFamilyInterface();
  const endorsementEvent = parseReceiptEvents(receipt, eventInterface, contractAddress).find(
    (event) => event.name === "PersonVersionEndorsed",
  );

  return {
    alreadyEndorsed: false,
    receipt,
    transactionHash: receipt?.hash || receipt?.transactionHash || "",
    blockNumber: Number(receipt?.blockNumber || 0),
    approvalTxHash,
    deepTokenAddress: tokenAddress,
    fee,
    feeFormatted: ethers.formatUnits(fee, decimals),
    balanceBefore,
    balanceFormatted: ethers.formatUnits(balanceBefore, decimals),
    decimals,
    symbol,
    event: endorsementEvent
      ? {
          personHash: endorsementEvent.args.personHash,
          endorser: endorsementEvent.args.endorser,
          versionIndex: Number(endorsementEvent.args.versionIndex),
          recipient: endorsementEvent.args.recipient,
          recipientShare: endorsementEvent.args.recipientShare?.toString(),
          protocolRecipient: endorsementEvent.args.protocolRecipient,
          protocolShare: endorsementEvent.args.protocolShare?.toString(),
          endorsementFee: endorsementEvent.args.endorsementFee?.toString() || fee.toString(),
          timestamp: Number(endorsementEvent.args.timestamp || 0),
        }
      : null,
  };
}
