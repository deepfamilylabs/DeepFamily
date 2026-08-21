import { describe, expect, it } from "vitest";
import { makeNodeId, type NodeData } from "../../../shared/model";
import {
  createProjectedPeopleLookup,
  filterPeople,
  getPeoplePageStats,
  resolveProjectedPerson,
  selectProjectedMintedPeople,
  type PeopleFiltersState,
} from "./peoplePageModel";

function makePerson(overrides: Partial<NodeData>): NodeData {
  const personHash = overrides.personHash ?? "0xperson";
  const versionIndex = overrides.versionIndex ?? 1;
  return {
    personHash,
    versionIndex,
    id: overrides.id ?? makeNodeId(personHash, versionIndex),
    tokenId: overrides.tokenId ?? "1",
    fullName: overrides.fullName ?? "Ada Lovelace",
    endorsementCount: overrides.endorsementCount ?? 0,
    ...overrides,
  };
}

const baseFilters: PeopleFiltersState = {
  searchTerm: "",
  filterType: "all",
  sortOrder: "asc",
  selectedAddresses: [],
};

describe("peoplePageModel", () => {
  it("selects minted people from the current projection and counts unique people", () => {
    const adaV1 = makePerson({ personHash: "0xada", versionIndex: 1, tokenId: "7" });
    const adaV2 = makePerson({ personHash: "0xADA", versionIndex: 2, tokenId: "8" });
    const draft = makePerson({ personHash: "0xdraft", tokenId: "0" });
    const missingId = "0xmissing-v-1";
    const nodesData = {
      [adaV1.id]: adaV1,
      [adaV2.id]: adaV2,
      [draft.id]: draft,
    };
    const graphNodes = [
      { id: adaV1.id },
      { id: adaV2.id },
      { id: draft.id },
      { id: missingId },
    ];

    const people = selectProjectedMintedPeople(graphNodes, nodesData);
    const stats = getPeoplePageStats({ graphNodes, nodesData, people });

    expect(people.map((person) => person.tokenId)).toEqual(["7", "8"]);
    expect(stats.totalNFTs).toBe(2);
    expect(stats.totalCount).toBe(1);
  });

  it("resolves URL person queries by id, 64-hex hash, or token id", () => {
    const hash = `0x${"a".repeat(64)}`;
    const ada = makePerson({ personHash: hash, tokenId: "7" });
    const lookup = createProjectedPeopleLookup([ada]);

    expect(resolveProjectedPerson(ada.id, lookup)).toBe(ada);
    expect(resolveProjectedPerson(`0x${"A".repeat(64)}`, lookup)).toBe(ada);
    expect(resolveProjectedPerson("7", lookup)).toBe(ada);
    expect(resolveProjectedPerson("0xada", lookup)).toBeNull();
  });

  it("filters by public search text and address before applying sort order", () => {
    const people = [
      makePerson({
        tokenId: "1",
        fullName: "Ada Lovelace",
        addedBy: "0xCreatorA",
        nftPublicStory: "Analytical engine mathematics",
        endorsementCount: 2,
      }),
      makePerson({
        personHash: "0xgrace",
        tokenId: "2",
        fullName: "Grace Hopper",
        addedBy: "0xCreatorB",
        nftPublicStory: "Navy compiler pioneer",
        endorsementCount: 5,
      }),
      makePerson({
        personHash: "0xkatherine",
        tokenId: "3",
        fullName: "Katherine Johnson",
        addedBy: "0xCreatorA",
        nftPublicStory: "Orbital calculation mathematics",
        endorsementCount: 9,
      }),
    ];

    const filtered = filterPeople(people, {
      ...baseFilters,
      searchTerm: "math",
      selectedAddresses: ["creatora"],
      filterType: "by_endorsement",
      sortOrder: "desc",
    });

    expect(filtered.map((person) => person.fullName)).toEqual([
      "Katherine Johnson",
      "Ada Lovelace",
    ]);
  });
});
