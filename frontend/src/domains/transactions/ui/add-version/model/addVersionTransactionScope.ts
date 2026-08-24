import { ethers } from "ethers";

export const ADD_VERSION_SCOPE_CHANGED = "ADD_VERSION_SCOPE_CHANGED";

export interface AddVersionTransactionScope {
  chainId: number;
  contractAddress: string;
  readerAddress: string;
  submitterAddress: string;
}

type ScopeSigner = Pick<ethers.Signer, "getAddress"> & {
  provider?:
    | {
        send?: (method: string, params: unknown[]) => Promise<unknown>;
        getNetwork?: () => Promise<{ chainId: bigint | number | string }>;
      }
    | null;
};

export function addVersionScopeChangedError(): Error {
  return Object.assign(
    new Error(
      "The wallet, network, DeepFamily proxy, or Reader changed after this Add Version package was prepared. Re-enter the identity passphrases and build a new package.",
    ),
    {
      code: ADD_VERSION_SCOPE_CHANGED,
      reason: ADD_VERSION_SCOPE_CHANGED,
    },
  );
}

export function createAddVersionTransactionScope(input: {
  chainId: number;
  contractAddress: string;
  readerAddress: string;
  submitterAddress: string;
}): AddVersionTransactionScope {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw addVersionScopeChangedError();
  }
  try {
    return {
      chainId: input.chainId,
      contractAddress: ethers.getAddress(input.contractAddress),
      readerAddress: ethers.getAddress(input.readerAddress),
      submitterAddress: ethers.getAddress(input.submitterAddress),
    };
  } catch {
    throw addVersionScopeChangedError();
  }
}

export function sameAddVersionTransactionScope(
  left: AddVersionTransactionScope,
  right: AddVersionTransactionScope,
): boolean {
  return (
    left.chainId === right.chainId &&
    left.contractAddress === right.contractAddress &&
    left.readerAddress === right.readerAddress &&
    left.submitterAddress === right.submitterAddress
  );
}

async function readWalletChainId(signer: ScopeSigner): Promise<bigint | null> {
  const provider = signer.provider;
  if (!provider) return null;

  if (typeof provider.send === "function") {
    const rawChainId = await provider.send("eth_chainId", []);
    if (typeof rawChainId === "string" || typeof rawChainId === "number") {
      return BigInt(rawChainId);
    }
    if (typeof rawChainId === "bigint") return rawChainId;
    throw addVersionScopeChangedError();
  }

  if (typeof provider.getNetwork === "function") {
    const network = await provider.getNetwork();
    return BigInt(network.chainId);
  }
  return null;
}

export async function assertAddVersionTransactionScope(input: {
  expected: AddVersionTransactionScope;
  chainId: number;
  contractAddress: string;
  readerAddress: string;
  signer: ScopeSigner;
}): Promise<void> {
  const current = createAddVersionTransactionScope({
    chainId: input.chainId,
    contractAddress: input.contractAddress,
    readerAddress: input.readerAddress,
    submitterAddress: await input.signer.getAddress(),
  });
  if (!sameAddVersionTransactionScope(input.expected, current)) {
    throw addVersionScopeChangedError();
  }

  // Read the wallet provider directly immediately before the transaction
  // request. React/config propagation can lag an injected-wallet chain event.
  const walletChainId = await readWalletChainId(input.signer);
  if (walletChainId !== null && walletChainId !== BigInt(input.expected.chainId)) {
    throw addVersionScopeChangedError();
  }
}
