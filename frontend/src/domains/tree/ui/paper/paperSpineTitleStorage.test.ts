// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getPaperSpineTitleStorageKey,
  loadPaperSpineTitleOverride,
  savePaperSpineTitleOverride,
} from "./paperSpineTitleStorage";

describe("paperSpineTitleStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("builds a per-root storage key", () => {
    expect(getPaperSpineTitleStorageKey("0xroot-v-1")).toBe("df:paperSpineTitle:0xroot-v-1");
  });

  it("returns null when no override is stored", () => {
    expect(loadPaperSpineTitleOverride("0xroot-v-1")).toBeNull();
  });

  it("persists and reloads an override for a root", () => {
    savePaperSpineTitleOverride("0xroot-v-1", "曹氏宗谱");
    expect(loadPaperSpineTitleOverride("0xroot-v-1")).toBe("曹氏宗谱");
    expect(localStorage.getItem("df:paperSpineTitle:0xroot-v-1")).toBe("曹氏宗谱");
  });

  it("isolates overrides by rootId", () => {
    savePaperSpineTitleOverride("0xrootA-v-1", "曹氏宗谱");
    savePaperSpineTitleOverride("0xrootB-v-1", "孙氏族谱");

    expect(loadPaperSpineTitleOverride("0xrootA-v-1")).toBe("曹氏宗谱");
    expect(loadPaperSpineTitleOverride("0xrootB-v-1")).toBe("孙氏族谱");
  });

  it("clears the entry when saving a blank/whitespace title so the view reverts to auto", () => {
    savePaperSpineTitleOverride("0xroot-v-1", "曹氏宗谱");
    savePaperSpineTitleOverride("0xroot-v-1", "   ");

    expect(loadPaperSpineTitleOverride("0xroot-v-1")).toBeNull();
    expect(localStorage.getItem("df:paperSpineTitle:0xroot-v-1")).toBeNull();
  });

  it("is a no-op when rootId is null", () => {
    savePaperSpineTitleOverride(null, "曹氏宗谱");
    expect(loadPaperSpineTitleOverride(null)).toBeNull();
  });
});
