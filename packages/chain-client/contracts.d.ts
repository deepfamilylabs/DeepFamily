import type { Contract, ContractRunner, Interface, InterfaceAbi } from "ethers";
/** Keeps dynamic ethers methods, getFunction, connect, attach and event APIs. */
export function instrumentChainContract<T extends Contract>(contract: T): T;
export function createChainContract(address: string, abi: Interface | InterfaceAbi, runner?: ContractRunner | null): Contract;
