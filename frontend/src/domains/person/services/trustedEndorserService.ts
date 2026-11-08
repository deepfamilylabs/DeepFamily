import { getAddress, type Signer, type TransactionReceipt } from "ethers";
import { executeChainTransaction, runChainRead, withConfirmedTransaction } from "@deepfamily/chain-client";
import {
  createDeepFamilyContract,
  createDeepFamilyInterface,
  createDeepFamilyReaderContract,
} from "../../../shared/clients/contractFactory";
import { getReadonlyProvider } from "../../../shared/clients/providerRegistry";

export interface TrustedEndorserScope {
  rpcUrl: string;
  chainId: number;
  contractAddress: string;
  readerAddress: string;
}

export async function loadTrustedEndorsers(input: TrustedEndorserScope & {
  personHash: string;
  versionIndex: number;
}): Promise<string[]> {
  const reader = createDeepFamilyReaderContract(input.readerAddress, getReadonlyProvider(input.rpcUrl, input.chainId));
  const accounts: string[] = [];
  const pageLimit = 200;
  let offset = 0;
  while (true) {
    const out = await runChainRead({ read: () => reader.listTrustedEndorsers(input.personHash, input.versionIndex, offset, pageLimit) });
    accounts.push(...Array.from(out[0] as readonly string[]));
    if (!out[2]) return accounts;
    const nextOffset = Number(out[3]);
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) {
      throw new Error("Recommended source pagination did not advance");
    }
    offset = nextOffset;
  }
}

/** Owns wallet checks, receipt tracking and event verification for both mutations. */
export async function updateTrustedEndorser(input: {
  signer: Signer;
  chainId: number;
  connectedAddress: string;
  contractAddress: string;
  personHash: string;
  versionIndex: number;
  account: string;
  action: "add" | "remove";
  isCurrent: () => boolean;
  onSubmitted?: (hash: string) => void;
}) {
  const provider = input.signer.provider;
  if (!provider) throw new Error("Wallet not connected");
  const account = getAddress(input.account);
  const [network, signerAddress, fromBlock] = await Promise.all([
    provider.getNetwork(), input.signer.getAddress(), provider.getBlockNumber(),
  ]);
  if (!input.isCurrent() || network.chainId !== BigInt(input.chainId) || getAddress(signerAddress) !== getAddress(input.connectedAddress)) {
    throw new Error("The transaction wallet changed before updating recommended sources");
  }
  if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) throw new Error("Transaction block is unavailable");
  const contract = createDeepFamilyContract(input.contractAddress, input.signer);
  const method = input.action === "add" ? contract.addTrustedEndorser : contract.removeTrustedEndorser;
  const result = await executeChainTransaction<TransactionReceipt>({
    fromBlock,
    assertActive: () => {
      if (!input.isCurrent()) throw new Error("The transaction wallet changed before updating recommended sources");
    },
    send: () => method(input.personHash, input.versionIndex, account),
    expected: { chainId: input.chainId, from: signerAddress, to: input.contractAddress, value: 0n },
    onSubmitted: input.onSubmitted,
  });
  const iface = createDeepFamilyInterface();
  const eventName = input.action === "add" ? "TrustedEndorserAdded" : "TrustedEndorserRemoved";
  const matches = result.receipt.logs.filter((log) => {
    if (log.address.toLowerCase() !== input.contractAddress.toLowerCase()) return false;
    try {
      const event = iface.parseLog(log);
      return event?.name === eventName &&
        String(event.args.personHash).toLowerCase() === input.personHash.toLowerCase() &&
        BigInt(event.args.versionIndex) === BigInt(input.versionIndex) &&
        getAddress(event.args.account) === account;
    } catch { return false; }
  });
  if (matches.length !== 1) {
    throw withConfirmedTransaction(new Error("Recommended source transaction did not emit the expected event"), result.transactionHash, "mismatch");
  }
  return result;
}
