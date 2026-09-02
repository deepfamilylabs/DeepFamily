import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useActivePath } from "../../../app/context";
import { useFamilyTreeProjection, useTreeGraphData, useTreeStatus } from "../../../domains/tree";
import type { NodeData } from "../../../shared/model";
import {
  createProjectedPeopleLookup,
  filterPeople,
  getPeoplePageStats,
  hasPeopleRuleFilters,
  hasVisiblePeopleFilters,
  PEOPLE_PAGE_SIZE,
  resolveProjectedPerson,
  selectProjectedMintedPeople,
  type PeopleFilterType,
  type PeopleFiltersState,
  type PeopleSortOrder,
  type PeopleViewMode,
} from "../model/peoplePageModel";

export function usePeoplePageController() {
  const { nodesData } = useTreeGraphData();
  const { loading } = useTreeStatus();
  const [projectionEnabled, setProjectionEnabled] = useState(false);
  const { graph } = useFamilyTreeProjection({ enabled: projectionEnabled });
  const location = useLocation();
  const navigate = useNavigate();
  const { setActivePath } = useActivePath();
  const openedViaClickRef = useRef(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<PeopleFilterType>("all");
  const [sortOrder, setSortOrder] = useState<PeopleSortOrder>("asc");
  const [viewMode, setViewMode] = useState<PeopleViewMode>("grid");
  const [selectedPerson, setSelectedPerson] = useState<NodeData | null>(null);
  const [selectedAddresses, setSelectedAddresses] = useState<string[]>([]);
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

  const clearFilters = useCallback(() => {
    setSelectedAddresses([]);
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
    }),
    [filterType, searchTerm, selectedAddresses, sortOrder],
  );

  const filteredPeople = useMemo(() => filterPeople(people, filterState), [people, filterState]);

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
    stats,
    filters: {
      searchTerm,
      setSearchTerm,
      filterType,
      setFilterType,
      sortOrder,
      setSortOrder,
      selectedAddresses,
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
    },
    modal: {
      selectedPerson,
      openPerson,
      closePerson,
    },
  };
}

export type PeoplePageController = ReturnType<typeof usePeoplePageController>;
