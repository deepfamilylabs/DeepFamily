import { getAddress, type Signer, type ContractTransactionResponse, type TransactionReceipt } from "ethers";
import { executeChainTransaction, runChainRead, normalizeChainError } from "@deepfamily/chain-client";
import {
  createDeepFamilyContract,
  createLineageIndexContract,
  createShieldedPoolFactoryContract,
} from "../../../shared/clients/contractFactory";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";
import { readShieldedAsset, resolveShieldedAssetPool, type ShieldedAsset } from "./shieldedAssetRegistry";

export class ShieldedConfigurationMismatchError extends Error {
  constructor() {
    super("Shielded modules do not match the configured network");
    normalizeChainError(this, { category: "validation", operation: "read" });
  }
}

export class ShieldedWalletChangedError extends Error {
  constructor() {
    super("The transaction wallet changed before pool creation");
    normalizeChainError(this, { category: "wallet", operation: "submit" });
  }
}

export interface ShieldedModuleInput {
  rpcUrl: string;
  chainId: number;
  contractAddress: string;
  tokenAddress: string;
  factoryAddress: string;
  assetAddress: string;
  nativeSymbol: string;
}

export type ShieldedModuleResult =
  | { status: "missingPool"; asset: ShieldedAsset }
  | { status: "ready"; modules: ShieldedPageModules };

export async function loadShieldedAssetMetadata(input: Pick<ShieldedModuleInput, "rpcUrl" | "chainId" | "assetAddress" | "nativeSymbol">) {
  const provider = getReadonlyProvider(input.rpcUrl, input.chainId);
  return runChainRead({ read: async () => readShieldedAsset(input.assetAddress, provider, input.nativeSymbol, { blockTag: await provider.getBlockNumber() }) });
}

/** Resolve and validate a selected pool independently of the page lifecycle. */
export function loadShieldedModules(input: ShieldedModuleInput): Promise<ShieldedModuleResult> {
  return runChainRead({ read: () => resolveShieldedModules(input) });
}

async function resolveShieldedModules(input: ShieldedModuleInput): Promise<ShieldedModuleResult> {
  const provider = getReadonlyProvider(input.rpcUrl, input.chainId);
  const deepFamily = createDeepFamilyContract(input.contractAddress, provider);
  const factory = createShieldedPoolFactoryContract(input.factoryAddress, provider);
  const toBlock = await provider.getBlockNumber();
  const [network, familyIndex, deepToken, asset] = await Promise.all([
    provider.getNetwork(),
    deepFamily.lineageIndex({ blockTag: toBlock }) as Promise<string>,
    factory.DEEP_TOKEN({ blockTag: toBlock }) as Promise<string>,
    readShieldedAsset(input.assetAddress, provider, input.nativeSymbol, { blockTag: toBlock }),
  ]);
  if (network.chainId !== BigInt(input.chainId) || getAddress(deepToken) !== getAddress(input.tokenAddress)) {
    throw new ShieldedConfigurationMismatchError();
  }
  const resolved = await resolveShieldedAssetPool(factory, asset, provider, familyIndex, { blockTag: toBlock });
  if (!resolved) return { status: "missingPool", asset };
  return {
    status: "ready",
    modules: {
      chainId: network.chainId,
      provider,
      deepFamily,
      lineageIndex: createLineageIndexContract(familyIndex, provider),
      token: asset.token,
      assetAddress: asset.address,
      assetKind: asset.kind,
      assetSymbol: asset.symbol,
      factory,
      ...resolved,
      tokenDecimals: asset.decimals,
    },
  };
}

/** A page can cancel local completion, while a broadcast keeps its public receipt tracking. */
export async function createShieldedAssetPool(input: {
  signer: Signer;
  chainId: number;
  account: string;
  factoryAddress: string;
  assetAddress: string;
  isCurrent: () => boolean;
  onSubmitted?: (hash: string) => void;
}) {
  const provider = input.signer.provider;
  if (!provider) throw new ShieldedWalletChangedError();
  const [network, account, fromBlock] = await runChainRead({ read: () => Promise.all([
    provider.getNetwork(), input.signer.getAddress(), provider.getBlockNumber(),
  ]) });
  if (!input.isCurrent() || network.chainId !== BigInt(input.chainId) || getAddress(account) !== getAddress(input.account)) {
    throw new ShieldedWalletChangedError();
  }
  if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) throw new Error("Pool creation block is unavailable");
  const factory = createShieldedPoolFactoryContract(input.factoryAddress, input.signer);
  return executeChainTransaction<TransactionReceipt, ContractTransactionResponse>({
    fromBlock,
    assertActive: () => { if (!input.isCurrent()) throw new ShieldedWalletChangedError(); },
    send: (): Promise<ContractTransactionResponse> => factory.createPool(input.assetAddress),
    expected: { chainId: input.chainId, from: account, to: input.factoryAddress, value: 0n },
    onSubmitted: input.onSubmitted,
    requireSuccess: false,
  });
}
