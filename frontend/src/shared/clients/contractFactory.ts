import { ethers } from "ethers";
import DeepFamily from "../../abi/DeepFamily.json";
import DeepFamilyReader from "../../abi/DeepFamilyReader.json";

export const DEEP_TOKEN_ABI = [
  "function recentReward() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function increaseAllowance(address,uint256) returns (bool)",
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

export function createDeepFamilyInterface(): ethers.Interface {
  return new ethers.Interface(DeepFamily.abi);
}
