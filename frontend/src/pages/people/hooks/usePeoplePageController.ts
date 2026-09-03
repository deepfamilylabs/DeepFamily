import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useActivePath } from "../../../app/context";
import { useFamilyTreeProjection, useTreeGraphData, useTreeStatus } from "../../../domains/tree";
import type { NodeData } from "../../../shared/model";
import {
  buildGenerationIndex,
  createProjectedPeopleLookup,
  filterPeople,
  generationRange,
  getGenerationOptions,
  getPeoplePageStats,
  getPersonGeneration,
  hasPeopleRuleFilters,
  hasVisiblePeopleFilters,
  PEOPLE_PAGE_SIZE,
  resolveProjectedPerson,
  selectProjectedMintedPeople,
  toggleGenerationSelection,
  type PeopleFilterType,
  type PeopleFiltersState,
  type PeopleSortOrder,
  type PeopleViewMode,
} from "../model/peoplePageModel";

export function usePeoplePageController() {
  const { nodesData } = useTreeGraphData();
  const { loading, contractMessage, refresh } = useTreeStatus();
  const [projectionEnabled, setProjectionEnabled] = useState(false);
  const { graph } = useFamilyTreeProjection({ enabled: projectionEnabled });
  const location = useLocation();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const { setActivePath } = useActivePath();
  const openedViaClickRef = useRef(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<PeopleFilterType>("all");
  const [sortOrder, setSortOrder] = useState<PeopleSortOrder>("asc");
  const [viewMode, setViewMode] = useState<PeopleViewMode>("grid");
  const [selectedPerson, setSelectedPerson] = useState<NodeData | null>(null);
  const [selectedAddresses, setSelectedAddresses] = useState<string[]>([]);
  const [selectedGenerations, setSelectedGenerations] = useState<number[]>([]);
  const [addressInput, setAddressInput] = useState("");
  const [personQueryError, setPersonQueryError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PEOPLE_PAGE_SIZE);

  useEffect(() => {
    const handle = window.requestAnimationFrame(() => setProjectionEnabled(true));
    return () => window.cancelAnimationFrame(handle);
  }, []);

  const addAddress = useCallback(() => {
    const trimmed = addressInput.trim();
    if (trimmed && !selectedAddresses.includes(trimmed)) {
      setSelectedAddresses((prev) => [...prev, trimmed]);
      setAddressInput("");
    }
  }, [addressInput, selectedAddresses]);

  const removeAddress = useCallback((address: string) => {
    setSelectedAddresses((prev) => prev.filter((item) => item !== address));
  }, []);

  const handleAddressKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" || event.key === ",") {
        event.preventDefault();
        addAddress();
      }
    },
    [addAddress],
  );

  const toggleGeneration = useCallback((generation: number) => {
    setSelectedGenerations((prev) => toggleGenerationSelection(prev, generation));
  }, []);

  const selectGenerationRange = useCallback((from: number, to: number) => {
    setSelectedGenerations(generationRange(from, to));
  }, []);

  const clearGenerations = useCallback(() => setSelectedGenerations([]), []);

  const clearFilters = useCallback(() => {
    setSelectedAddresses([]);
    setSelectedGenerations([]);
    setAddressInput("");
    setSearchTerm("");
    setFilterType("all");
    setSortOrder("asc");
  }, []);

  const people = useMemo(
    () => selectProjectedMintedPeople(graph.nodes, nodesData),
    [graph.nodes, nodesData],
  );

  const projectedLookup = useMemo(() => createProjectedPeopleLookup(people), [people]);

  // The projection stamps a depth on every node; generation = depth + 1, so the
  // filter, the per-generation counts and the badge all read the one index.
  const generationIndex = useMemo(() => buildGenerationIndex(graph.nodes), [graph.nodes]);

  const generationOptions = useMemo(
    () => getGenerationOptions(people, generationIndex),
    [generationIndex, people],
  );

  const generationOf = useCallback(
    (person: NodeData) => getPersonGeneration(person, generationIndex),
    [generationIndex],
  );

  const clearPersonQuery = useCallback(() => {
    const searchParams = new URLSearchParams(location.search);
    searchParams.delete("person");
    navigate(
      { pathname: location.pathname, search: searchParams.toString() },
      { replace: true },
    );
    setPersonQueryError(null);
  }, [location.pathname, location.search, navigate]);

  const openTree = useCallback(() => {
    setActivePath("/familyTree");
    navigate("/familyTree");
  }, [navigate, setActivePath]);

  // The build session's own status, not the tree's error log. That log is an
  // append-only diagnostic record — a failure a later run recovered from stays
  // in it for the life of the page, so reading its newest entry showed "could
  // not load people" over the cold-start retry and then over every empty filter
  // result afterwards. `contractMessage` is cleared at the start of each run and
  // set only by a run that actually failed.
  const loadError = contractMessage || "";

  const stats = useMemo(
    () => getPeoplePageStats({ graphNodes: graph.nodes, nodesData, people }),
    [graph.nodes, nodesData, people],
  );

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const personQuery = searchParams.get("person");
    if (!personQuery) {
      setSelectedPerson(null);
      setPersonQueryError(null);
      return;
    }
    if (!projectionEnabled) return;

    const resolved = resolveProjectedPerson(personQuery, projectedLookup);

    if (resolved) {
      setPersonQueryError(null);
      setSelectedPerson(resolved);
      return;
    }

    setSelectedPerson(null);
    if (loading) return;
    setPersonQueryError(personQuery.trim());
  }, [loading, location.search, projectedLookup, projectionEnabled]);

  const openPerson = useCallback(
    (person: NodeData) => {
      openedViaClickRef.current = true;
      const searchParams = new URLSearchParams(location.search);
      searchParams.set("person", String(person.tokenId || person.personHash || person.id));
      navigate({ pathname: location.pathname, search: searchParams.toString() });
      setSelectedPerson(person);
    },
    [location.pathname, location.search, navigate],
  );

  const closePerson = useCallback(() => {
    const searchParams = new URLSearchParams(location.search);
    searchParams.delete("person");
    if (openedViaClickRef.current) {
      openedViaClickRef.current = false;
      navigate(-1);
    } else {
      navigate(
        { pathname: location.pathname, search: searchParams.toString() },
        { replace: true },
      );
    }
    setSelectedPerson(null);
  }, [location.pathname, location.search, navigate]);

  const filterState: PeopleFiltersState = useMemo(
    () => ({
      searchTerm,
      filterType,
      sortOrder,
      selectedAddresses,
      selectedGenerations,
    }),
    [filterType, searchTerm, selectedAddresses, selectedGenerations, sortOrder],
  );

  // One collator for the whole sort rather than a localeCompare() per comparison.
  const collator = useMemo(
    () => new Intl.Collator(i18n?.language || undefined, { usage: "sort", numeric: true }),
    [i18n?.language],
  );

  const filteredPeople = useMemo(
    () => filterPeople(people, filterState, { generations: generationIndex, collator }),
    [collator, generationIndex, people, filterState],
  );

  useEffect(() => {
    setVisibleCount(PEOPLE_PAGE_SIZE);
  }, [filterState, people.length]);

  const visiblePeople = useMemo(
    () => filteredPeople.slice(0, Math.max(0, visibleCount)),
    [filteredPeople, visibleCount],
  );

  const loadMore = useCallback(() => {
    setVisibleCount((count) => Math.min(count + PEOPLE_PAGE_SIZE, filteredPeople.length));
  }, [filteredPeople.length]);

  useEffect(() => {
    if (!projectionEnabled || loading) return;
    if (visibleCount >= filteredPeople.length) return;
    if (typeof window === "undefined" || typeof window.IntersectionObserver !== "function") return;
    const target = loadMoreSentinelRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { root: null, rootMargin: "600px", threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredPeople.length, loadMore, loading, projectionEnabled, visibleCount]);

  return {
    projectionEnabled,
    loading,
    error: loadError,
    retry: refresh,
    stats,
    filters: {
      searchTerm,
      setSearchTerm,
      filterType,
      setFilterType,
      sortOrder,
      setSortOrder,
      selectedAddresses,
      selectedGenerations,
      generationOptions,
      toggleGeneration,
      selectGenerationRange,
      clearGenerations,
      addressInput,
      setAddressInput,
      addAddress,
      removeAddress,
      handleAddressKeyDown,
      clearFilters,
      hasVisibleFilters: hasVisiblePeopleFilters(filterState),
      hasRuleFilters: hasPeopleRuleFilters(filterState),
    },
    view: {
      mode: viewMode,
      setMode: setViewMode,
    },
    personNotice: {
      query: personQueryError,
      clear: clearPersonQuery,
      openTree,
    },
    results: {
      filteredPeople,
      visiblePeople,
      visibleCount,
      hasMore: visibleCount < filteredPeople.length,
      loadMoreSentinelRef,
      generationOf,
    },
    modal: {
      selectedPerson,
      openPerson,
      closePerson,
    },
  };
}

export type PeoplePageController = ReturnType<typeof usePeoplePageController>;
