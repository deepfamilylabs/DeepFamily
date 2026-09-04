// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getChainReader, loadChainReaders, rememberChainReader } from "./chainReaderStore";

const STORAGE_KEY = "ft:readerByChain";
const READER_A = "0x" + "a".repeat(40);
const READER_B = "0x" + "b".repeat(40);

describe("chainReaderStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("knows nothing until something has resolved", () => {
    expect(loadChainReaders()).toEqual({});
    expect(getChainReader(31337)).toBe("");
  });

  it("keeps one reader per chain, and the chains apart", () => {
    rememberChainReader(31337, READER_A);
    rememberChainReader(71, READER_B);

    expect(getChainReader(31337)).toBe(READER_A);
    expect(getChainReader(71)).toBe(READER_B);
    expect(getChainReader(1030)).toBe("");
  });

  it("replaces a chain's reader when a different one resolves there", () => {
    rememberChainReader(31337, READER_A);
    rememberChainReader(31337, READER_B);

    expect(loadChainReaders()).toEqual({ "31337": READER_B });
  });

  it("refuses anything that is not an address, so a guess is never recorded", () => {
    rememberChainReader(31337, "not-an-address");
    rememberChainReader(31337, "");
    rememberChainReader(31337, "0x123");

    expect(loadChainReaders()).toEqual({});
  });

  it("refuses a chain id that could not name a network", () => {
    rememberChainReader(0, READER_A);
    rememberChainReader(-1, READER_A);
    rememberChainReader(1.5, READER_A);

    expect(loadChainReaders()).toEqual({});
    expect(getChainReader(0)).toBe("");
  });

  it("survives storage holding junk", () => {
    localStorage.setItem(STORAGE_KEY, "{not-json");
    expect(loadChainReaders()).toEqual({});

    localStorage.setItem(STORAGE_KEY, JSON.stringify(["nope"]));
    expect(loadChainReaders()).toEqual({});

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ "31337": READER_A, "71": "junk", notachain: READER_B }),
    );
    expect(loadChainReaders()).toEqual({ "31337": READER_A });
  });
});
