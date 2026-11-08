import { type ContractRunner } from "ethers";
import { createChainContract } from "@deepfamily/chain-client";
import PrivateLetterArchive from "../../abi/PrivateLetterArchive.json";

export const PRIVATE_LETTER_ABI = PrivateLetterArchive.abi;

export function createPrivateLetterContract(address: string, runner: ContractRunner) {
  return createChainContract(address, PRIVATE_LETTER_ABI, runner);
}
