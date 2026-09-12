// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addressBook: {} as Record<number, string>,
}));

vi.mock("../../../shared/config/env", () => ({
  getChainEntryReaderAddress: (chainId: number) => mocks.addressBook[chainId] ?? "",
}));

import { resolveEntryReaderForChain } from "./entryReaderResolver";

const BOOK = "0x" + "b".repeat(40);
const DECLARED = "0x" + "9".repeat(40);
const ENV_PAIR = "0x" + "e".repeat(40);

function saveCustom(entries: unknown[]) {
  localStorage.setItem("ft:customNetworks", JSON.stringify(entries));
}

describe("resolveEntryReaderForChain", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.addressBook = {};
  });

  it("takes a preset's address from the build's address book", () => {
    mocks.addressBook = { 71: BOOK };
    expect(resolveEntryReaderForChain(71)).toBe(BOOK);
  });

  it("reads a custom network's own declaration when no list is handed in", () => {
    saveCustom([
      { chainId: 31338, name: "Mine", rpcUrl: "http://mine", readerAddress: DECLARED },
    ]);
    expect(resolveEntryReaderForChain(31338)).toBe(DECLARED);
  });

  it("prefers a live list over the saved one, so a correction takes effect at once", () => {
    saveCustom([{ chainId: 31338, name: "Mine", rpcUrl: "http://mine", readerAddress: BOOK }]);
    const corrected = resolveEntryReaderForChain(31338, {
      customNetworks: [
        { chainId: 31338, name: "Mine", rpcUrl: "http://mine", readerAddress: DECLARED },
      ],
    });
    expect(corrected).toBe(DECLARED);
  });

  it("lets a custom network's declaration win over the address book", () => {
    mocks.addressBook = { 31338: BOOK };
    saveCustom([
      { chainId: 31338, name: "Mine", rpcUrl: "http://mine", readerAddress: DECLARED },
    ]);
    expect(resolveEntryReaderForChain(31338)).toBe(DECLARED);
  });

  it("uses the unsuffixed env pair only on the chain that pair describes", () => {
    const lookup = { envChainId: 31337, envReaderAddress: ENV_PAIR };
    expect(resolveEntryReaderForChain(31337, lookup)).toBe(ENV_PAIR);
    expect(resolveEntryReaderForChain(71, lookup)).toBe("");
  });

  it("ranks the address book above the unsuffixed pair on the same chain", () => {
    mocks.addressBook = { 31337: BOOK };
    expect(
      resolveEntryReaderForChain(31337, { envChainId: 31337, envReaderAddress: ENV_PAIR }),
    ).toBe(BOOK);
  });

  it("answers with nothing for a chain the build was told nothing about", () => {
    // The caller must apply this as-is. Falling back to whatever was in use
    // would read one chain through another chain's entry contract.
    expect(resolveEntryReaderForChain(1030)).toBe("");
  });

  it("refuses a chain id that could not name a network", () => {
    mocks.addressBook = { 0: BOOK };
    expect(resolveEntryReaderForChain(0)).toBe("");
    expect(resolveEntryReaderForChain(-1)).toBe("");
    expect(resolveEntryReaderForChain(1.5)).toBe("");
  });

  it("survives a saved list holding junk", () => {
    localStorage.setItem("ft:customNetworks", "{not-json");
    expect(resolveEntryReaderForChain(31338)).toBe("");
  });
});
