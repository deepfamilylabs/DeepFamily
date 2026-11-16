import { describe, expect, it, vi } from "vitest";
import { createWalletAuthorization } from "./walletAuthorization";

const ACCOUNT = `0x${"1".repeat(40)}`;
const OTHER = `0x${"2".repeat(40)}`;

function harness() {
  const state = {
    accounts: [ACCOUNT],
    chainId: "0x7a69",
    healthyGrant: false,
    active: true,
    beforeGrant: undefined as (() => void | Promise<void>) | undefined,
  };
  const request = vi.fn(
    async ({ method }: { method: string; params?: unknown[] | Record<string, unknown> }) => {
      if (method === "eth_chainId") return state.chainId;
      // Reproduce the reported MetaMask case: exposing an account does not
      // repair the grant used by eth_sendTransaction.
      if (method === "eth_accounts" || method === "eth_requestAccounts") return state.accounts;
      if (method === "wallet_requestPermissions") {
        await state.beforeGrant?.();
        state.healthyGrant = true;
        return [{ parentCapability: "eth_accounts" }];
      }
      if (method === "eth_sendTransaction") {
        if (!state.healthyGrant) throw Object.assign(new Error("Unauthorized"), { code: 4100 });
        return `0x${"ab".repeat(32)}`;
      }
      throw new Error(`Unexpected wallet request: ${method}`);
    },
  );
  const input = {
    provider: { request },
    walletId: "metamask",
    account: ACCOUNT,
    chainId: 31337,
    generation: 1,
    assertActive: () => {
      if (!state.active) throw new Error("connection retired");
    },
  };
  const permissionCalls = () =>
    request.mock.calls.filter(([call]) => call.method === "wallet_requestPermissions");
  return { state, input, request, permissionCalls, authorization: createWalletAuthorization() };
}

describe("wallet transaction authorization", () => {
  it("repairs a restored MetaMask grant before the first send without prompting for later writes", async () => {
    const f = harness();
    await expect(f.input.provider.request({ method: "eth_sendTransaction" })).rejects.toMatchObject(
      { code: 4100 },
    );
    await f.authorization.ensure(f.input);
    await expect(f.input.provider.request({ method: "eth_sendTransaction" })).resolves.toMatch(
      /^0x/,
    );
    await f.authorization.ensure(f.input);
    expect(f.permissionCalls()).toHaveLength(1);
    expect(f.permissionCalls()[0][0]).toEqual({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    });
  });

  it("does not prompt again after permission was granted during an explicit connection", async () => {
    const f = harness();
    f.authorization.remember(f.input);
    await f.authorization.ensure(f.input);
    expect(f.permissionCalls()).toHaveLength(0);
    expect(f.request).toHaveBeenCalledWith({ method: "eth_accounts" });
  });

  it("shares one in-flight permission request between concurrent preparations", async () => {
    const f = harness();
    let release!: () => void;
    f.state.beforeGrant = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const first = f.authorization.ensure(f.input);
    const second = f.authorization.ensure(f.input);
    await vi.waitFor(() => expect(f.permissionCalls()).toHaveLength(1));
    release();
    await Promise.all([first, second]);
    expect(f.permissionCalls()).toHaveLength(1);
  });

  it("does not open a permission prompt if preparation was cancelled during the account read", async () => {
    const f = harness();
    const promise = f.authorization.ensure(f.input);
    f.state.active = false;
    await expect(promise).rejects.toThrow("connection retired");
    expect(f.permissionCalls()).toHaveLength(0);
  });

  it("keeps an existing grant when a modal closes during a passive account check", async () => {
    const f = harness();
    f.authorization.remember(f.input);
    const first = f.authorization.ensure(f.input);
    f.state.active = false;
    await expect(first).rejects.toThrow("connection retired");
    f.state.active = true;
    await f.authorization.ensure(f.input);
    expect(f.permissionCalls()).toHaveLength(0);
  });

  it("lets an active preparation share authorization after another caller cancels", async () => {
    const f = harness();
    const cancelled = f.authorization.ensure(f.input);
    const active = f.authorization.ensure({ ...f.input, assertActive: () => {} });
    f.state.active = false;
    await expect(cancelled).rejects.toThrow("connection retired");
    await active;
    expect(f.permissionCalls()).toHaveLength(1);
  });

  it("renews permission after reconnecting even if the provider and address are unchanged", async () => {
    const f = harness();
    await f.authorization.ensure(f.input);
    await f.authorization.ensure({ ...f.input, generation: 2 });
    expect(f.permissionCalls()).toHaveLength(2);
  });

  it("detects a silently revoked grant despite a remembered connection", async () => {
    const f = harness();
    f.authorization.remember(f.input);
    f.state.accounts = [];
    f.state.beforeGrant = () => {
      f.state.accounts = [ACCOUNT];
    };
    await f.authorization.ensure(f.input);
    expect(f.permissionCalls()).toHaveLength(1);
  });

  it.each(["account", "chain"])("does not authorize a changed %s", async (changed) => {
    const f = harness();
    if (changed === "account") f.state.accounts = [OTHER];
    else f.state.chainId = "0x1";
    await expect(f.authorization.ensure(f.input)).rejects.toMatchObject({
      code: "CHAIN_WALLET_SCOPE_CHANGED",
    });
    expect(f.permissionCalls()).toHaveLength(0);
  });

  it.each(["account", "chain"])("rechecks the %s after the permission prompt", async (changed) => {
    const f = harness();
    f.state.beforeGrant = () => {
      if (changed === "account") f.state.accounts = [OTHER];
      else f.state.chainId = "0x1";
    };
    await expect(f.authorization.ensure(f.input)).rejects.toMatchObject({
      code: "CHAIN_WALLET_SCOPE_CHANGED",
    });
    f.state.accounts = [ACCOUNT];
    f.state.chainId = "0x7a69";
    f.state.beforeGrant = undefined;
    await f.authorization.ensure(f.input);
    expect(f.permissionCalls()).toHaveLength(2);
  });

  it("does not remember a rejected grant or retry it automatically", async () => {
    const f = harness();
    f.state.beforeGrant = () => {
      throw Object.assign(new Error("Rejected"), { code: 4001 });
    };
    await expect(f.authorization.ensure(f.input)).rejects.toMatchObject({ code: 4001 });
    expect(f.permissionCalls()).toHaveLength(1);
    f.state.beforeGrant = undefined;
    await f.authorization.ensure(f.input);
    expect(f.permissionCalls()).toHaveLength(2);
  });

  it("retires a remembered grant after a failed renewal even if the account becomes visible again", async () => {
    const f = harness();
    f.authorization.remember(f.input);
    f.state.accounts = [];
    f.state.beforeGrant = () => {
      throw Object.assign(new Error("Rejected"), { code: 4001 });
    };
    await expect(f.authorization.ensure(f.input)).rejects.toMatchObject({ code: 4001 });
    f.state.accounts = [ACCOUNT];
    f.state.beforeGrant = undefined;
    await f.authorization.ensure(f.input);
    expect(f.permissionCalls()).toHaveLength(2);
  });

  it("discards a late grant after disconnect without caching it", async () => {
    const f = harness();
    let release!: () => void;
    f.state.beforeGrant = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const first = f.authorization.ensure(f.input);
    const rejected = expect(first).rejects.toThrow("connection retired");
    await vi.waitFor(() => expect(f.permissionCalls()).toHaveLength(1));
    f.state.active = false;
    release();
    await rejected;
    f.state.active = true;
    f.state.beforeGrant = undefined;
    await f.authorization.ensure(f.input);
    expect(f.permissionCalls()).toHaveLength(2);
  });

  it("keeps Fluent's existing account permission and never sends as part of the check", async () => {
    const f = harness();
    await f.authorization.ensure({ ...f.input, walletId: "fluent" });
    expect(
      f.request.mock.calls.every(([call]) => ["eth_accounts", "eth_chainId"].includes(call.method)),
    ).toBe(true);
  });
});
