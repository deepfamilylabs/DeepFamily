import { describe, expect, it } from "vitest";
import {
  detectSearchSubject,
  getDefaultFacet,
  getFacetsForSubject,
  isFacetRunnable,
  getFacetDescriptor,
  toResolvedSubject,
} from "./searchSubject";

const hash = `0x${"a".repeat(64)}`;
const address = `0x${"b".repeat(40)}`;

describe("detectSearchSubject", () => {
  it("classifies by shape, normalising hex case", () => {
    expect(detectSearchSubject(`0x${"A".repeat(64)}`)).toEqual({
      kind: "personHash",
      personHash: hash,
    });
    expect(detectSearchSubject("  128 ")).toEqual({ kind: "tokenId", tokenId: 128 });
    expect(detectSearchSubject(address.toUpperCase().replace("0X", "0x"))).toEqual({
      kind: "address",
      address,
    });
    expect(detectSearchSubject("")).toEqual({ kind: "empty" });
  });

  it("reports the hex length so the UI can say how far off the input is", () => {
    expect(detectSearchSubject("0xabc123")).toEqual({
      kind: "invalid",
      reason: "hexLength",
      hexLength: 6,
    });
  });

  it("rejects non-hex and token id zero", () => {
    expect(detectSearchSubject("0xzzzz")).toEqual({ kind: "invalid", reason: "unrecognized" });
    expect(detectSearchSubject("hello")).toEqual({ kind: "invalid", reason: "unrecognized" });
    expect(detectSearchSubject("0")).toEqual({ kind: "invalid", reason: "unrecognized" });
  });
});

describe("facet routing", () => {
  it("offers only the facets a subject can answer", () => {
    const person = toResolvedSubject(detectSearchSubject(hash))!;
    const token = toResolvedSubject(detectSearchSubject("128"))!;
    const account = toResolvedSubject(detectSearchSubject(address))!;

    expect(getFacetsForSubject(person).map((f) => f.key)).toEqual([
      "versions",
      "trustedEndorsers",
      "endorsement",
      "children",
      "personNfts",
      "storyChunks",
      "uri",
    ]);
    expect(getFacetsForSubject(token).map((f) => f.key)).toEqual(["storyChunks", "uri"]);
    expect(getFacetsForSubject(account).map((f) => f.key)).toEqual([
      "accountVersions",
      "accountEndorsements",
      "accountNfts",
    ]);
    expect(getFacetsForSubject(null)).toEqual([]);

    expect(getDefaultFacet(person)).toBe("versions");
    expect(getDefaultFacet(token)).toBe("storyChunks");
    expect(getDefaultFacet(account)).toBe("accountVersions");
  });

  it("gates version-scoped facets on a version index of the right floor", () => {
    const person = toResolvedSubject(detectSearchSubject(hash))!;
    const endorsers = getFacetDescriptor("trustedEndorsers");
    const children = getFacetDescriptor("children");

    // trustedEndorsers is 1-based on chain; children accepts version 0.
    expect(isFacetRunnable(endorsers, person, 0, undefined)).toBe(false);
    expect(isFacetRunnable(endorsers, person, 1, undefined)).toBe(true);
    expect(isFacetRunnable(children, person, 0, undefined)).toBe(true);
    expect(isFacetRunnable(endorsers, person, undefined, undefined)).toBe(false);
  });

  it("gates token facets on a token id and account facets on an address", () => {
    const person = toResolvedSubject(detectSearchSubject(hash))!;
    const account = toResolvedSubject(detectSearchSubject(address))!;
    const story = getFacetDescriptor("storyChunks");
    const accountNfts = getFacetDescriptor("accountNfts");

    expect(isFacetRunnable(story, person, undefined, undefined)).toBe(false);
    expect(isFacetRunnable(story, person, undefined, 128)).toBe(true);
    expect(isFacetRunnable(accountNfts, account, undefined, undefined)).toBe(true);
    expect(isFacetRunnable(accountNfts, person, undefined, undefined)).toBe(false);
  });
});
