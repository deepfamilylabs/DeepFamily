// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NetworkSelectionModal from "./NetworkSelectionModal";
import WalletSelectionModal from "./WalletSelectionModal";
import type { WalletOption } from "../context";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

const wallet: WalletOption = {
  id: "metamask",
  name: "MetaMask",
  icon: "",
  provider: {},
};

describe("wallet selection modals a11y", () => {
  it("exposes WalletSelectionModal as a labelled dialog and closes from Escape", async () => {
    const onClose = vi.fn();

    render(
      <>
        <button type="button">Before modal</button>
        <WalletSelectionModal
          isOpen
          wallets={[wallet]}
          onSelect={vi.fn()}
          onClose={onClose}
        />
      </>,
    );

    const dialog = screen.getByRole("dialog", { name: "Select Wallet" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(dialog));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("exposes NetworkSelectionModal as a labelled dialog and closes from Escape", async () => {
    const onClose = vi.fn();

    render(
      <>
        <button type="button">Before modal</button>
        <NetworkSelectionModal
          isOpen
          currentChainId={1030}
          onSelect={vi.fn(async () => true)}
          onClose={onClose}
        />
      </>,
    );

    const dialog = screen.getByRole("dialog", { name: "Switch Network" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(dialog));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
