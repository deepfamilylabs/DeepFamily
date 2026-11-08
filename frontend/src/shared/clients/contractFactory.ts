import { ethers } from "ethers";
import { createChainContract } from "@deepfamily/chain-client";
import DeepFamily from "../../abi/DeepFamily.json";
import DeepFamilyArchive from "../../abi/DeepFamilyArchive.json";
import DeepFamilyReader from "../../abi/DeepFamilyReader.json";
import DeepFamilyLineageIndex from "../../abi/DeepFamilyLineageIndex.json";
import DeepFamilyToken from "../../abi/DeepFamilyToken.json";
import ShieldedErc20Pool from "../../abi/ShieldedErc20Pool.json";
import ShieldedNativePool from "../../abi/ShieldedNativePool.json";
import ShieldedPoolFactory from "../../abi/ShieldedPoolFactory.json";

export function createDeepFamilyContract(
  contractAddress: string,
  runner: ethers.ContractRunner,
): ethers.Contract {
  return createChainContract(contractAddress, DeepFamily.abi, runner);
}

export function createDeepTokenContract(
  tokenAddress: string,
  runner: ethers.ContractRunner,
): ethers.Contract {
  return createChainContract(tokenAddress, DeepFamilyToken.abi, runner);
}

export function createDeepFamilyReaderContract(
  readerAddress: string,
  runner: ethers.ContractRunner,
): ethers.Contract {
  return createChainContract(readerAddress, DeepFamilyReader.abi, runner);
}

export function createArchiveContract(
  archiveAddress: string,
  runner: ethers.ContractRunner,
): ethers.Contract {
  return createChainContract(archiveAddress, DeepFamilyArchive.abi, runner);
}

export function createLineageIndexContract(
  lineageIndexAddress: string,
  runner: ethers.ContractRunner,
): ethers.Contract {
  return createChainContract(lineageIndexAddress, DeepFamilyLineageIndex.abi, runner);
}

export function createShieldedErc20PoolContract(
  poolAddress: string,
  runner: ethers.ContractRunner,
): ethers.Contract {
  return createChainContract(poolAddress, ShieldedErc20Pool.abi, runner);
}

export function createShieldedNativePoolContract(
  poolAddress: string,
  runner: ethers.ContractRunner,
): ethers.Contract {
  return createChainContract(poolAddress, ShieldedNativePool.abi, runner);
}

export function createShieldedPoolFactoryContract(
  factoryAddress: string,
  runner: ethers.ContractRunner,
): ethers.Contract {
  return createChainContract(factoryAddress, ShieldedPoolFactory.abi, runner);
}

export function createDeepFamilyInterface(): ethers.Interface {
  return new ethers.Interface(DeepFamily.abi);
}

export function createArchiveInterface(): ethers.Interface {
  return new ethers.Interface(DeepFamilyArchive.abi);
}
