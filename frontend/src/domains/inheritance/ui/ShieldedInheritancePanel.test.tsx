// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Signer } from "ethers";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";
import { InheritanceError } from "../model/inheritanceErrors";
import { ShieldedInheritancePanel } from "./ShieldedInheritancePanel";

const mocks = vi.hoisted(() => ({
  deriveIdentityFromForm: vi.fn(),
  loadKeyRegistrySnapshot: vi.fn(),
  registerShieldedHeirKey: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { detail?: string }) =>
      key === "shielded.confirmedRefreshFailed"
        ? `Transaction confirmed; event recovery failed: ${options?.detail}`
        : key,
  }),
}));
vi.mock("../../person", async () => {
  const React = await import("react");
  return {
    PersonHashCalculator: React.forwardRef((_props, ref) => {
      React.useImperativeHandle(ref, () => ({ clearSecretInputs: () => {} }));
      return <div />;
    }),
  };
});
vi.mock("../services/inheritanceIdentity", () => ({
  deriveIdentityFromForm: mocks.deriveIdentityFromForm,
}));
vi.mock("../services/shieldedKeyRegistryChain", () => ({
  loadKeyRegistrySnapshot: mocks.loadKeyRegistrySnapshot,
}));
vi.mock("../services/shieldedKeyRegistrationFlow", () => ({
  registerShieldedHeirKey: mocks.registerShieldedHeirKey,
}));
vi.mock("../../../shared/config/env", () => ({
  getShieldedKeyRegistryDeploymentBlock: () => 0,
  getShieldedPoolDeploymentBlock: () => 0,
}));

const account = "0x00000000000000000000000000000000000000aa";
const hash = `0x${"ab".repeat(32)}`;

describe("ShieldedInheritancePanel confirmed action status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deriveIdentityFromForm.mockResolvedValue({
      derivedSecretField: "123",
      identityCommitment: "456",
      personHash: `0x${"12".repeat(32)}`,
    });
    mocks.loadKeyRegistrySnapshot
      .mockResolvedValueOnce({ keys: new Map(), invalidated: false })
      .mockRejectedValueOnce(new Error("RPC unavailable"));
    mocks.registerShieldedHeirKey.mockResolvedValue({
      receipt: { status: 1 },
      transactionHash: hash,
    });
  });

  afterEach(() => cleanup());

  it("shows the confirmed transaction hash when a later event scan fails", async () => {
    const modules = {
      chainId: 31337n,
      registry: {},
      tokenDecimals: 18,
    } as unknown as ShieldedPageModules;
    const signer = {
      provider: { getNetwork: async () => ({ chainId: 31337n }) },
      getAddress: async () => account,
    } as unknown as Signer;
    render(
      <ShieldedInheritancePanel
        modules={modules}
        signer={signer}
        account={account}
        publicActivityAddresses={new Set()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "shielded.actions.register" }));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Transaction confirmed"),
    );
    expect(screen.getByRole("alert").textContent).toContain("RPC unavailable");
    expect(screen.getByRole("alert").textContent).toContain(hash);
    expect(mocks.registerShieldedHeirKey).toHaveBeenCalledTimes(1);
  });

  it("shows a translated identity form error before any transaction", async () => {
    mocks.deriveIdentityFromForm.mockRejectedValueOnce(new InheritanceError("nameRequired"));
    const modules = { chainId: 31337n, tokenDecimals: 18 } as unknown as ShieldedPageModules;
    const signer = {} as Signer;
    render(
      <ShieldedInheritancePanel
        modules={modules}
        signer={signer}
        account={account}
        publicActivityAddresses={new Set()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "shielded.actions.register" }));
    fireEvent.click(screen.getByRole("button", { name: "shielded.submit" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("inheritance.errors.nameRequired"),
    );
    expect(mocks.registerShieldedHeirKey).not.toHaveBeenCalled();
  });

  it("starts private transfer with one note and offers a second note only when selected", () => {
    const modules = { chainId: 31337n, tokenDecimals: 18 } as unknown as ShieldedPageModules;
    render(
      <ShieldedInheritancePanel
        modules={modules}
        signer={{} as Signer}
        account={account}
        publicActivityAddresses={new Set()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "shielded.actions.privateTransfer" }));
    const option = screen.getByRole("checkbox", { name: "shielded.fields.useSecondValueNote" });
    expect(screen.queryByText("shielded.fields.secondValueNote")).toBeNull();
    fireEvent.click(option);
    expect(screen.getByText("shielded.fields.secondValueNote")).toBeTruthy();
    fireEvent.click(option);
    expect(screen.queryByText("shielded.fields.secondValueNote")).toBeNull();
  });
});
