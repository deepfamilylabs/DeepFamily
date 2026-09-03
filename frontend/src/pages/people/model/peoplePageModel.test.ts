import { describe, expect, it } from "vitest";
import { makeNodeId, type NodeData } from "../../../shared/model";
import {
  buildGenerationIndex,
  createProjectedPeopleLookup,
  filterPeople,
  getGenerationOptions,
  isContiguousGenerationRun,
  getPeoplePageStats,
  resolveProjectedPerson,
  selectProjectedMintedPeople,
  toggleGenerationSelection,
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
  selectedGenerations: [],
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
  it("numbers generations from the projection depth and counts the people in each", () => {
    const root = makePerson({ personHash: "0xroot", tokenId: "1" });
    const childA = makePerson({ personHash: "0xchild-a", tokenId: "2" });
    const childB = makePerson({ personHash: "0xchild-b", tokenId: "3" });
    const grandchild = makePerson({ personHash: "0xgrandchild", tokenId: "4" });
    const people = [root, childA, childB, grandchild];
    const graphNodes = [
      { id: root.id, depth: 0 },
      { id: childA.id, depth: 1 },
      { id: childB.id, depth: 1 },
      { id: grandchild.id, depth: 2 },
      // the same node reached again deeper keeps its shallowest generation
      { id: childB.id, depth: 3 },
      // nodes the walk never sized stay out of the index
      { id: "0xunsized-v-1" },
    ];

    const generations = buildGenerationIndex(graphNodes);

    expect(generations.get(root.id)).toBe(1);
    expect(generations.get(childB.id)).toBe(2);
    expect(generations.get(grandchild.id)).toBe(3);
    expect(generations.has("0xunsized-v-1")).toBe(false);
    expect(getGenerationOptions(people, generations)).toEqual([
      { generation: 1, count: 1 },
      { generation: 2, count: 2 },
      { generation: 3, count: 1 },
    ]);
  });

  it("keeps only the picked generations, and leaves the list alone without an index", () => {
    const root = makePerson({ personHash: "0xroot", tokenId: "1", fullName: "Root" });
    const child = makePerson({ personHash: "0xchild", tokenId: "2", fullName: "Child" });
    const grandchild = makePerson({
      personHash: "0xgrandchild",
      tokenId: "3",
      fullName: "Grandchild",
    });
    const people = [root, child, grandchild];
    const generations = buildGenerationIndex([
      { id: root.id, depth: 0 },
      { id: child.id, depth: 1 },
      { id: grandchild.id, depth: 2 },
    ]);
    const filters = { ...baseFilters, selectedGenerations: [2, 3] };

    expect(
      filterPeople(people, filters, { generations }).map((person) => person.fullName),
    ).toEqual(["Child", "Grandchild"]);
    expect(filterPeople(people, filters).map((person) => person.fullName)).toEqual([
      "Root",
      "Child",
      "Grandchild",
    ]);
  });

  it("toggles generations and recognises a contiguous run", () => {
    expect(toggleGenerationSelection([4, 2], 3)).toEqual([2, 3, 4]);
    expect(toggleGenerationSelection([2, 3, 4], 3)).toEqual([2, 4]);
    expect(isContiguousGenerationRun([2, 3, 4])).toBe(true);
    expect(isContiguousGenerationRun([2, 4])).toBe(false);
    expect(isContiguousGenerationRun([3])).toBe(false);
  });
  it("orders by the whole birth date, keeps BC first and undated people last", () => {
    const people = [
      makePerson({ personHash: "0xundated", tokenId: "1", fullName: "Undated" }),
      makePerson({
        personHash: "0xjune",
        tokenId: "2",
        fullName: "June 1868",
        birthYear: 1868,
        birthMonth: 6,
        birthDay: 2,
      }),
      makePerson({
        personHash: "0xmarch",
        tokenId: "3",
        fullName: "March 1868",
        birthYear: 1868,
        birthMonth: 3,
        birthDay: 5,
      }),
      makePerson({ personHash: "0xyear", tokenId: "4", fullName: "1868", birthYear: 1868 }),
      makePerson({
        personHash: "0xancient",
        tokenId: "5",
        fullName: "200 BC",
        birthYear: 200,
        isBirthBC: true,
      }),
    ];
    const sortByBirth = (sortOrder: PeopleFiltersState["sortOrder"]) =>
      filterPeople(people, { ...baseFilters, filterType: "by_birth_date", sortOrder }).map(
        (person) => person.fullName,
      );

    expect(sortByBirth("asc")).toEqual([
      "200 BC",
      "1868",
      "March 1868",
      "June 1868",
      "Undated",
    ]);
    expect(sortByBirth("desc")).toEqual([
      "June 1868",
      "March 1868",
      "1868",
      "200 BC",
      "Undated",
    ]);
  });

  it("floats people whose name matches above the ones whose biography mentions them", () => {
    const people = [
      makePerson({
        personHash: "0xbian",
        tokenId: "1",
        fullName: "卞氏",
        nftPublicStory: "卞氏是曹操继室，曹丕、曹彰的生母。",
      }),
      makePerson({
        personHash: "0xcaocao",
        tokenId: "2",
        fullName: "曹操",
        nftPublicStory: "东汉末年丞相，曹魏政权的奠基者。",
      }),
      makePerson({
        personHash: "0xding",
        tokenId: "3",
        fullName: "丁夫人",
        nftPublicStory: "丁夫人是曹操早期正室。",
      }),
    ];

    const filtered = filterPeople(people, { ...baseFilters, searchTerm: "曹操" });

    expect(filtered.map((person) => person.fullName)).toEqual(["曹操", "卞氏", "丁夫人"]);
  });
  it("sorts by generation, eldest first inside a generation, unplaced people last", () => {
    const root = makePerson({
      personHash: "0xroot",
      tokenId: "1",
      fullName: "Root",
      birthYear: 1840,
    });
    const elderChild = makePerson({
      personHash: "0xelder",
      tokenId: "2",
      fullName: "Elder child",
      birthYear: 1868,
      birthMonth: 3,
    });
    const youngerChild = makePerson({
      personHash: "0xyounger",
      tokenId: "3",
      fullName: "Younger child",
      birthYear: 1868,
      birthMonth: 9,
    });
    const unplaced = makePerson({ personHash: "0xunplaced", tokenId: "4", fullName: "Unplaced" });
    const people = [youngerChild, unplaced, root, elderChild];
    const generations = buildGenerationIndex([
      { id: root.id, depth: 0 },
      { id: elderChild.id, depth: 1 },
      { id: youngerChild.id, depth: 1 },
    ]);
    const sortByGeneration = (sortOrder: PeopleFiltersState["sortOrder"]) =>
      filterPeople(
        people,
        { ...baseFilters, filterType: "by_generation", sortOrder },
        { generations },
      ).map((person) => person.fullName);

    expect(sortByGeneration("asc")).toEqual([
      "Root",
      "Elder child",
      "Younger child",
      "Unplaced",
    ]);
    // the direction flips generations, not the elder-first order inside one
    expect(sortByGeneration("desc")).toEqual([
      "Elder child",
      "Younger child",
      "Root",
      "Unplaced",
    ]);
  });
  it("sorts names with the given collator and leaves unnamed people last", () => {
    const people = [
      makePerson({ personHash: "0xzhang", tokenId: "1", fullName: "张辽" }),
      makePerson({ personHash: "0xnameless", tokenId: "2", fullName: "" }),
      makePerson({ personHash: "0xchen", tokenId: "3", fullName: "陈群" }),
      makePerson({ personHash: "0xbai", tokenId: "4", fullName: "白起" }),
    ];
    const collator = new Intl.Collator("zh-Hans-CN", { usage: "sort", numeric: true });
    const sortByName = (sortOrder: PeopleFiltersState["sortOrder"]) =>
      filterPeople(people, { ...baseFilters, filterType: "by_name", sortOrder }, { collator }).map(
        (person) => person.fullName,
      );

    // pinyin order: bai, chen, zhang — not the code-point order 张 白 陈
    expect(sortByName("asc")).toEqual(["白起", "陈群", "张辽", ""]);
    expect(sortByName("desc")).toEqual(["张辽", "陈群", "白起", ""]);
  });
  it("breaks endorsement ties by birth date, then by mint order", () => {
    const people = [
      makePerson({
        personHash: "0xyoung",
        tokenId: "9",
        fullName: "Younger",
        birthYear: 1901,
        endorsementCount: 2,
      }),
      makePerson({
        personHash: "0xelder",
        tokenId: "4",
        fullName: "Elder",
        birthYear: 1868,
        endorsementCount: 2,
      }),
      makePerson({ personHash: "0xundated", tokenId: "7", fullName: "Undated", endorsementCount: 2 }),
      makePerson({ personHash: "0xstar", tokenId: "1", fullName: "Most endorsed", endorsementCount: 9 }),
    ];
    const sortByEndorsement = (sortOrder: PeopleFiltersState["sortOrder"]) =>
      filterPeople(people, { ...baseFilters, filterType: "by_endorsement", sortOrder }).map(
        (person) => person.fullName,
      );

    expect(sortByEndorsement("desc")).toEqual([
      "Most endorsed",
      "Elder",
      "Younger",
      "Undated",
    ]);
    // the tie order stays the same either way; only the counts flip
    expect(sortByEndorsement("asc")).toEqual([
      "Elder",
      "Younger",
      "Undated",
      "Most endorsed",
    ]);
  });
  it("breaks creation-time and birth-date ties the same way", () => {
    const elder = makePerson({
      personHash: "0xelder",
      tokenId: "8",
      fullName: "Elder",
      birthYear: 1868,
      timestamp: 100,
    });
    const younger = makePerson({
      personHash: "0xyounger",
      tokenId: "3",
      fullName: "Younger",
      birthYear: 1901,
      timestamp: 100,
    });
    const undatedEarly = makePerson({
      personHash: "0xundated-early",
      tokenId: "2",
      fullName: "Undated #2",
      timestamp: 100,
    });
    const undatedLate = makePerson({
      personHash: "0xundated-late",
      tokenId: "6",
      fullName: "Undated #6",
      timestamp: 100,
    });
    const people = [undatedLate, younger, undatedEarly, elder];

    // same timestamp -> elder first, then the undated pair in mint order
    expect(
      filterPeople(people, { ...baseFilters, filterType: "by_create_time" }).map(
        (person) => person.fullName,
      ),
    ).toEqual(["Elder", "Younger", "Undated #2", "Undated #6"]);

    // undated people cannot be dated, so they keep mint order at the end
    expect(
      filterPeople(people, { ...baseFilters, filterType: "by_birth_date" }).map(
        (person) => person.fullName,
      ),
    ).toEqual(["Elder", "Younger", "Undated #2", "Undated #6"]);
  });
});
