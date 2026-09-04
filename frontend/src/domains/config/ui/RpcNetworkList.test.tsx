// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  menu: {
    presets: [
      { chainId: 1, name: "Preset One", rpcUrl: "http://preset-1" },
      { chainId: 2, name: "Preset Two", rpcUrl: "http://preset-2" },
    ],
    custom: [] as { chainId: number; name: string; rpcUrl: string }[],
    selected: 1 as number | "custom",
    chainId: 1,
    rpcUrl: "http://preset-1",
    select: vi.fn(),
    addForm: {
      isOpen: false,
      toggle: vi.fn(),
      name: "",
      chainId: "" as number | "",
      rpc: "",
      error: null as string | null,
      showCspHint: false,
      setName: vi.fn(),
      setChainId: vi.fn(),
      setRpc: vi.fn(),
      submit: vi.fn(),
    },
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("./hooks/useRpcNetworkMenu", () => ({
  useRpcNetworkMenu: () => mocks.menu,
}));

vi.mock("./sections", () => ({
  CustomNetworkForm: () => <div data-testid="custom-network-form" />,
}));

import RpcNetworkList from "./RpcNetworkList";

describe("RpcNetworkList", () => {
  beforeEach(() => {
    mocks.menu.custom = [];
    mocks.menu.selected = 1;
    mocks.menu.chainId = 1;
    mocks.menu.rpcUrl = "http://preset-1";
    mocks.menu.addForm.isOpen = false;
    mocks.menu.select.mockReset();
    mocks.menu.addForm.toggle.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows every network with the endpoint it resolves to, and checks the active one", () => {
    render(<RpcNetworkList />);

    const rows = screen.getAllByRole("radio");
    expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(screen.getByText("http://preset-1")).toBeTruthy();
    expect(screen.getByText("http://preset-2")).toBeTruthy();
  });

  it("picks a network and tells the host it is done", () => {
    const onPicked = vi.fn();
    render(<RpcNetworkList onPicked={onPicked} />);

    fireEvent.click(screen.getByRole("radio", { name: /Preset Two/ }));
    expect(mocks.menu.select).toHaveBeenCalledWith(2);
    expect(onPicked).toHaveBeenCalled();
  });

  it("groups saved custom networks under their own heading", () => {
    mocks.menu.custom = [{ chainId: 31338, name: "My Local", rpcUrl: "http://my-local" }];
    render(<RpcNetworkList />);

    expect(screen.getByText("Custom")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /My Local/ })).toBeTruthy();
  });

  it("still names the endpoint in use when it matches no known network", () => {
    mocks.menu.selected = "custom";
    mocks.menu.rpcUrl = "http://somewhere-else";
    mocks.menu.chainId = 4242;
    render(<RpcNetworkList />);

    expect(screen.getByText("http://somewhere-else")).toBeTruthy();
    expect(screen.getByText("4242")).toBeTruthy();
    // It is a readout, not a choice — nothing to pick that is already in use.
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("keeps the add form behind its own disclosure", () => {
    const { rerender } = render(<RpcNetworkList />);
    const toggle = screen.getByRole("button", { expanded: false });
    expect(screen.queryByTestId("custom-network-form")).toBeNull();

    fireEvent.click(toggle);
    expect(mocks.menu.addForm.toggle).toHaveBeenCalled();

    mocks.menu.addForm.isOpen = true;
    rerender(<RpcNetworkList />);
    expect(screen.getByTestId("custom-network-form")).toBeTruthy();
  });
});
