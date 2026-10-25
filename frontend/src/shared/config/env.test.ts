import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getChainEntryReaderAddress,
  getDefaultReaderAddress,
  getShieldedPoolFactoryAddress,
  getShieldedPoolFactoryDeploymentBlock,
  readBooleanEnv,
  readNumberEnv,
  readPositiveNumberEnv,
  shouldShowNodeModeToggle,
} from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("shielded module addresses", () => {
  it("uses the selected chain's addresses and falls back to the default", () => {
    const pool = "0x" + "2".repeat(40);
    vi.stubEnv("VITE_SHIELDED_POOL_FACTORY_ADDRESS", READER);
    vi.stubEnv("VITE_SHIELDED_POOL_FACTORY_ADDRESS_31337", pool);
    vi.stubEnv("VITE_SHIELDED_POOL_FACTORY_FROM_BLOCK", "40");
    vi.stubEnv("VITE_SHIELDED_POOL_FACTORY_FROM_BLOCK_31337", "42");
    expect(getShieldedPoolFactoryAddress(31337)).toBe(pool);
    expect(getShieldedPoolFactoryAddress(71)).toBe(READER);
    expect(getShieldedPoolFactoryDeploymentBlock(31337)).toBe(42);
    expect(getShieldedPoolFactoryDeploymentBlock(71)).toBe(40);
  });
});

describe("readBooleanEnv", () => {
  it("treats explicit true-like values as enabled", () => {
    expect(readBooleanEnv(true)).toBe(true);
    expect(readBooleanEnv("true")).toBe(true);
    expect(readBooleanEnv("TRUE")).toBe(true);
    expect(readBooleanEnv(" 1 ")).toBe(true);
    expect(readBooleanEnv("yes")).toBe(true);
  });

  it("treats missing and non-true-like values as disabled", () => {
    expect(readBooleanEnv(undefined)).toBe(false);
    expect(readBooleanEnv(false)).toBe(false);
    expect(readBooleanEnv("false")).toBe(false);
    expect(readBooleanEnv("0")).toBe(false);
    expect(readBooleanEnv("")).toBe(false);
  });

  it("supports explicit default values", () => {
    expect(readBooleanEnv(undefined, true)).toBe(true);
    expect(readBooleanEnv("unexpected", true)).toBe(true);
    expect(readBooleanEnv("no", true)).toBe(false);
  });
});

describe("number env readers", () => {
  it("falls back for empty and invalid values", () => {
    expect(readNumberEnv("", 10)).toBe(10);
    expect(readNumberEnv("abc", 10)).toBe(10);
    expect(readNumberEnv("42", 10)).toBe(42);
  });

  it("requires positive values when requested", () => {
    expect(readPositiveNumberEnv("0", 10)).toBe(10);
    expect(readPositiveNumberEnv("-1", 10)).toBe(10);
    expect(readPositiveNumberEnv("42", 10)).toBe(42);
  });
});

describe("shouldShowNodeModeToggle", () => {
  it("reads the node-mode env flag", () => {
    vi.stubEnv("VITE_SHOW_NODE_MODE_TOGGLE", "1");
    expect(shouldShowNodeModeToggle()).toBe(true);

    vi.stubEnv("VITE_SHOW_NODE_MODE_TOGGLE", "0");
    expect(shouldShowNodeModeToggle()).toBe(false);
  });
});

const READER = "0x" + "1".repeat(40);

describe("entry reader address", () => {
  // A developer's own .env.local is loaded into import.meta.env here, so the
  // variable is stated in every case rather than assumed absent.
  it("comes from the one variable a build is given", () => {
    vi.stubEnv("VITE_READER_ADDRESS", READER);
    expect(getDefaultReaderAddress()).toBe(READER);
  });

  it("answers with nothing when a build names no reader at all", () => {
    vi.stubEnv("VITE_READER_ADDRESS", "");
    expect(getDefaultReaderAddress()).toBe("");
  });
});

describe("per-chain entry reader address book", () => {
  it("answers for the chain it was given an address for", () => {
    vi.stubEnv("VITE_READER_ADDRESS_71", READER);
    expect(getChainEntryReaderAddress(71)).toBe(READER);
  });

  it("keeps the chains apart, and refuses an id that names none", () => {
    vi.stubEnv("VITE_READER_ADDRESS_71", READER);
    vi.stubEnv("VITE_READER_ADDRESS_1030", "");
    expect(getChainEntryReaderAddress(1030)).toBe("");
    expect(getChainEntryReaderAddress(0)).toBe("");
    expect(getChainEntryReaderAddress(-1)).toBe("");
  });
});
