import { getAddress, type Eip1193Provider } from "ethers";

interface AuthorizationScope {
  provider: Eip1193Provider;
  walletId: string | null;
  account: string;
  chainId: number;
  generation: number;
  assertActive: () => void;
}

const scopeChanged = () =>
  Object.assign(new Error("Wallet network or account changed; review the transaction again"), {
    code: "CHAIN_WALLET_SCOPE_CHANGED",
  });

function scopeKey(input: AuthorizationScope): string {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw scopeChanged();
  return `${input.walletId}:${getAddress(input.account).toLowerCase()}:${input.chainId}:${input.generation}`;
}

/** Permission grants are remembered only for this provider and connection generation. */
export function createWalletAuthorization() {
  const granted = new WeakMap<Eip1193Provider, string>();
  const pending = new WeakMap<
    Eip1193Provider,
    {
      key: string;
      assertions: Set<() => void>;
      promise: Promise<void>;
    }
  >();

  const remember = (input: AuthorizationScope) => {
    input.assertActive();
    granted.set(input.provider, scopeKey(input));
  };

  const readScope = async (input: AuthorizationScope) => {
    input.assertActive();
    const [accounts, chainId] = await Promise.all([
      input.provider.request({ method: "eth_accounts" }),
      input.provider.request({ method: "eth_chainId" }),
    ]);
    input.assertActive();
    if (
      !Array.isArray(accounts) ||
      typeof chainId !== "string" ||
      !/^0x[0-9a-f]+$/i.test(chainId) ||
      BigInt(chainId) !== BigInt(input.chainId)
    ) {
      throw scopeChanged();
    }
    const includesAccount = accounts.some(
      (account) =>
        typeof account === "string" && account.toLowerCase() === input.account.toLowerCase(),
    );
    if (accounts.length > 0 && !includesAccount) throw scopeChanged();
    return includesAccount;
  };

  const authorize = async (input: AuthorizationScope, key: string) => {
    const exposed = await readScope(input);
    if (!exposed && granted.get(input.provider) === key) granted.delete(input.provider);
    if (input.walletId === "metamask" && (!exposed || granted.get(input.provider) !== key)) {
      // Existing eth_requestAccounts responses can leave a stale grant intact.
      // Renew once on the first user-initiated write after a restored connection.
      await input.provider.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });
    } else if (!exposed) {
      await input.provider.request({ method: "eth_requestAccounts" });
    } else {
      return;
    }
    input.assertActive();
    if (!(await readScope(input))) {
      throw Object.assign(new Error("Wallet account authorization is required"), { code: 4100 });
    }
    remember(input);
  };

  return {
    remember,
    async ensure(input: AuthorizationScope): Promise<void> {
      input.assertActive();
      const key = scopeKey(input);
      const existing = pending.get(input.provider);
      if (existing?.key === key) {
        existing.assertions.add(input.assertActive);
        await existing.promise;
        input.assertActive();
        return;
      }
      const assertions = new Set([input.assertActive]);
      let abandoned = false;
      const assertAnyActive = () => {
        let cancellation: unknown;
        for (const assertActive of assertions) {
          try {
            assertActive();
            return;
          } catch (error) {
            cancellation = error;
          }
        }
        abandoned = true;
        throw cancellation;
      };
      const promise = authorize({ ...input, assertActive: assertAnyActive }, key)
        .catch((error: unknown) => {
          // An observed revocation or failed renewal retires this grant. A late
          // old request must not erase a newer connection's successful grant.
          if (!abandoned && granted.get(input.provider) === key) granted.delete(input.provider);
          throw error;
        })
        .finally(() => {
          if (pending.get(input.provider)?.promise === promise) pending.delete(input.provider);
        });
      pending.set(input.provider, { key, assertions, promise });
      await promise;
      input.assertActive();
    },
  };
}
