import { ContractTransactionResponse, TransactionResponse, id, type Interface, type Provider } from "ethers";
import type { ContractReceipt } from "../../../shared/clients/transactionTypes";

/** Real ethers response: replacement discovery works only after the caller restores its block anchor. */
export function contractFeeReplacement(input: {
  eventInterface: Interface;
  receipt: ContractReceipt;
  from: string;
  to: string;
  data: string;
  chainId?: bigint;
  nonce?: number;
}) {
  const hash = id("original contract transaction");
  const replacementHash = id("repriced contract transaction");
  const blockNumber = 12;
  const receipt = {...input.receipt, hash: replacementHash, blockNumber};
  let replacement: TransactionResponse;
  let scanned = false;
  const provider = {
    getBlockNumber: async () => blockNumber,
    getTransactionCount: async () => (input.nonce ?? 1) + 1,
    getTransaction: async () => null,
    getTransactionReceipt: async (requestedHash: string) => requestedHash === replacementHash ? receipt : null,
    getBlock: async (_number: number, prefetch: boolean) => {
      if (!prefetch) return null;
      scanned = true;
      return {
        length: 1,
        [Symbol.iterator]: function* () { yield replacementHash; },
        getTransaction: async () => replacement,
      };
    },
  } as unknown as Provider;
  const parameters = {
    hash, chainId: input.chainId ?? 31337n, from: input.from, to: input.to,
    data: input.data, value: 0n, nonce: input.nonce ?? 1,
    gasLimit: 100_000n, gasPrice: 1n, type: 0, index: 0,
  } as ConstructorParameters<typeof TransactionResponse>[0];
  replacement = new TransactionResponse({...parameters, hash: replacementHash, gasPrice: 2n, blockNumber}, provider);
  return {
    transaction: new ContractTransactionResponse(input.eventInterface, provider, new TransactionResponse(parameters, provider)),
    transactionHash: replacementHash,
    receipt,
    wasScanned: () => scanned,
  };
}
