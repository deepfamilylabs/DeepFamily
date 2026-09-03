import { describe, expect, it } from "vitest";
import { resolveNavSection } from "./navSections";

describe("resolveNavSection", () => {
  it("maps every family volume and detail route to the family entry", () => {
    for (const path of [
      "/familyTree",
      "/people",
      "/genealogyBook",
      "/person/12",
      "/editor/12",
    ]) {
      expect(resolveNavSection(path)).toBe("familyTree");
    }
  });

  it("matches home exactly rather than as a prefix", () => {
    expect(resolveNavSection("/")).toBe("home");
    expect(resolveNavSection("/search")).toBe("search");
    expect(resolveNavSection("/actions")).toBe("actions");
  });

  it("returns null for routes no nav entry owns", () => {
    expect(resolveNavSection("/keygen")).toBeNull();
    expect(resolveNavSection("/decrypt")).toBeNull();
  });

  it("does not treat a longer path segment as a match", () => {
    expect(resolveNavSection("/searching")).toBeNull();
    expect(resolveNavSection("/peoples")).toBeNull();
  });
});
