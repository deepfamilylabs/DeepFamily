import { ethers } from "ethers";
import DeepFamily from "../../abi/DeepFamily.json";
import DeepFamilyArchive from "../../abi/DeepFamilyArchive.json";
import DeepFamilyReader from "../../abi/DeepFamilyReader.json";
import DeepFamilyLineageIndex from "../../abi/DeepFamilyLineageIndex.json";
import { POOL_ABI } from "./receiveChain";
export const SHIELDED_FACTORY_ABI = ["function poolFor(address) view returns(address)", "function DEEP_TOKEN() view returns(address)", "function VERIFIER() view returns(address)", "function RECEIVE_REGISTRY() view returns(address)", "function NATIVE_POOL() view returns(address)", "function createPool(address) returns(address pool,bool created)", "event PoolCreated(address indexed asset,address indexed pool)"] as const;

export const DEEP_TOKEN_ABI = [
  "function recentReward() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function symbol() view returns (string)",
] as const;

export function createDeepFamilyContract(
  contractAddress: string,
  runner: ethers.ContractRunner,
): ethers.Contract {
  return new ethers.Contract(contractAddress, DeepFamily.abi, runner);
}

export function createDeepTokenContract(
  tokenAddress: string,
  runner: ethers.ContractRunner,
): ethers.Contract {
  return new ethers.Contract(tokenAddress, DEEP_TOKEN_ABI, runner);
}

export function createDeepFamilyReaderContract(
  readerAddress: string,
  runner: ethers.ContractRunner,
): ethers.Contract {
  return new ethers.Contract(readerAddress, DeepFamilyReader.abi, runner);
}

export function createArchiveContract(
  archiveAddress: string,
  runner: ethers.ContractRunner,
): ethers.Contract {
  return new ethers.Contract(archiveAddress, DeepFamilyArchive.abi, runner);
}

export function createLineageIndexContract(
  lineageIndexAddress: string,
  runner: ethers.ContractRunner,
): ethers.Contract {
  return new ethers.Contract(lineageIndexAddress, DeepFamilyLineageIndex.abi, runner);
}

export function createShieldedErc20PoolContract(
  poolAddress: string,
  runner: ethers.ContractRunner,
): ethers.Contract {
  return new ethers.Contract(poolAddress, POOL_ABI, runner);
}

export function createShieldedNativePoolContract(
  poolAddress: string,
  runner: ethers.ContractRunner,
): ethers.Contract {
  return new ethers.Contract(poolAddress, POOL_ABI, runner);
}

export function createShieldedPoolFactoryContract(
  factoryAddress: string,
  runner: ethers.ContractRunner,
): ethers.Contract {
  return new ethers.Contract(factoryAddress, SHIELDED_FACTORY_ABI, runner);
}

export function createDeepFamilyInterface(): ethers.Interface {
  return new ethers.Interface(DeepFamily.abi);
}

export function createArchiveInterface(): ethers.Interface {
  return new ethers.Interface(DeepFamilyArchive.abi);
}
