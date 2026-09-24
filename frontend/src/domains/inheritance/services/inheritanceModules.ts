import { ethers } from "ethers";
import { INHERITANCE_PERIOD_SECONDS } from "@deepfamily/protocol-core";
import {
  createDeepFamilyContract,
  createDeepTokenContract,
  createFamilyInheritanceContract,
  createLineageIndexContract,
} from "../../../shared/clients/contractFactory";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";
import { InheritanceError } from "../model/inheritanceErrors";

export interface InheritanceModuleConfig {
  rpcUrl: string;
  chainId: number;
  contractAddress: string;
  tokenAddress: string;
  inheritanceAddress: string;
}

/** Read-only contracts; writes reconnect the ones they need to the wallet. */
export interface InheritanceModules {
  /** The chain the contracts are read on, as the RPC reports it; the wallet must match it. */
  chainId: number;
  provider: ethers.Provider;
  deepFamily: ethers.Contract;
  lineageIndex: ethers.Contract;
  inheritance: ethers.Contract;
  token: ethers.Contract;
  inheritanceAddress: string;
  tokenAddress: string;
  /** The token's latest mining reward, the base of the suggested per-period amount. */
  recentReward: bigint;
}

const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/**
 * Opens the inheritance contract the environment names and checks it belongs to this DeepFamily
 * deployment: it must read the lineage index DeepFamily writes to and hold the same DEEP token.
 * Deposits cannot be withdrawn, so a stale or foreign address must never receive one.
 */
export async function resolveInheritanceModules(
  config: InheritanceModuleConfig,
): Promise<InheritanceModules> {
  const provider = getReadonlyProvider(config.rpcUrl, config.chainId);
  const deepFamily = createDeepFamilyContract(config.contractAddress, provider);
  const inheritance = createFamilyInheritanceContract(config.inheritanceAddress, provider);
  const token = createDeepTokenContract(config.tokenAddress, provider);

  const [network, lineageIndexAddress, boundIndex, boundToken, period, recentReward] =
    await Promise.all([
      provider.getNetwork(),
      deepFamily.lineageIndex() as Promise<string>,
      inheritance.LINEAGE_INDEX() as Promise<string>,
      inheritance.TOKEN() as Promise<string>,
      inheritance.PERIOD() as Promise<bigint>,
      token.recentReward() as Promise<bigint>,
    ]);
  if (
    sameAddress(lineageIndexAddress, ethers.ZeroAddress) ||
    !sameAddress(lineageIndexAddress, boundIndex) ||
    !sameAddress(boundToken, config.tokenAddress) ||
    BigInt(period) !== INHERITANCE_PERIOD_SECONDS
  ) {
    throw new InheritanceError("notWired");
  }

  return {
    // A custom RPC matches no preset and leaves the configured id at 0.
    chainId: Number(network.chainId),
    provider,
    deepFamily,
    lineageIndex: createLineageIndexContract(lineageIndexAddress, provider),
    inheritance,
    token,
    inheritanceAddress: config.inheritanceAddress,
    tokenAddress: config.tokenAddress,
    recentReward: BigInt(recentReward),
  };
}

/** The same contracts, able to send from the connected wallet. */
export function connectInheritanceWriters(modules: InheritanceModules, signer: ethers.Signer) {
  return {
    inheritance: createFamilyInheritanceContract(modules.inheritanceAddress, signer),
    token: createDeepTokenContract(modules.tokenAddress, signer),
  };
}
