// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ZeroAddress } from "ethers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShieldedAssetToolbar, type ShieldedAssetToolbarProps } from "./ShieldedAssetToolbar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

const DEEP = "0x0000000000000000000000000000000000000011";
const TOKEN = "0x0000000000000000000000000000000000000022";
const propsFor = (
  overrides: Partial<ShieldedAssetToolbarProps> = {},
): ShieldedAssetToolbarProps => ({
  selectedAddress: DEEP,
  deepTokenAddress: DEEP,
  nativeSymbol: "CFX",
  importedAssets: [],
  disabled: false,
  onSelect: vi.fn(),
  importAddress: "",
  onImportAddressChange: vi.fn(),
  onImport: vi.fn(),
  ...overrides,
});

describe("ShieldedAssetToolbar", () => {
  it("shows one compact asset selector and hides token import until requested", () => {
    render(<ShieldedAssetToolbar {...propsFor()} />);
    expect(screen.getByRole("combobox", { name: "shielded.assets.label" })).toBeTruthy();
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "DEEP",
      "CFX",
    ]);
    expect(screen.queryByRole("textbox")).toBeNull();
    const add = screen.getByRole("button", { name: "shielded.assets.add" });
    expect(add.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(add);
    expect(screen.getByRole("textbox", { name: "shielded.assets.tokenAddress" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "shielded.assets.import" }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "shielded.assets.cancel" }));
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("selects native or imported assets without duplicating the default options", () => {
    const props = propsFor({
      importedAssets: [
        { address: DEEP, kind: "erc20", symbol: "DEEP", decimals: 18, token: null },
        { address: ZeroAddress, kind: "native", symbol: "CFX", decimals: 18, token: null },
        { address: TOKEN, kind: "erc20", symbol: "USDT", decimals: 6, token: null },
      ],
    });
    render(<ShieldedAssetToolbar {...props} />);
    expect(screen.getAllByRole("option")).toHaveLength(3);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: ZeroAddress } });
    fireEvent.change(select, { target: { value: TOKEN } });
    expect(props.onSelect).toHaveBeenNthCalledWith(1, ZeroAddress);
    expect(props.onSelect).toHaveBeenNthCalledWith(2, TOKEN);
    expect(screen.getByRole("option", { name: "USDT · 0x0000…0022" })).toBeTruthy();
  });

  it("keeps a failed import open and closes after a submitted address is cleared", () => {
    const props = propsFor({ importAddress: TOKEN });
    const { rerender } = render(<ShieldedAssetToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "shielded.assets.add" }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "invalid-token" } });
    expect(props.onImportAddressChange).toHaveBeenCalledWith("invalid-token");
    fireEvent.click(screen.getByRole("button", { name: "shielded.assets.import" }));
    expect(props.onImport).toHaveBeenCalledOnce();

    rerender(<ShieldedAssetToolbar {...props} importAddress="invalid-token" importing={false} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("invalid-token");
    expect(screen.getByRole("button", { name: "shielded.assets.cancel" })).toBeTruthy();
    rerender(<ShieldedAssetToolbar {...props} importAddress="" />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "shielded.assets.add" })).toBeTruthy();
  });

  it("keeps manual edits open before an import is submitted", () => {
    const props = propsFor({ importAddress: TOKEN });
    const { rerender } = render(<ShieldedAssetToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "shielded.assets.add" }));
    rerender(<ShieldedAssetToolbar {...props} importAddress="" />);
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("disables selection and every import control during protected operations", () => {
    const props = propsFor({ importAddress: TOKEN });
    const { rerender } = render(<ShieldedAssetToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "shielded.assets.add" }));
    for (const state of [{ disabled: true }, { importing: true }]) {
      rerender(<ShieldedAssetToolbar {...props} {...state} />);
      for (const control of [
        screen.getByRole("combobox"),
        screen.getByRole("textbox"),
        screen.getByRole("button", { name: "shielded.assets.cancel" }),
        screen.getByRole("button", { name: "shielded.assets.import" }),
      ])
        expect(control.hasAttribute("disabled")).toBe(true);
      fireEvent.submit(screen.getByRole("textbox").closest("form")!);
      expect(props.onImport).not.toHaveBeenCalled();
    }
  });
});
