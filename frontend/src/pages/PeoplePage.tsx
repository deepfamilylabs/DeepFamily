import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search, Users, User, Hash, X, Plus, BookOpen } from "lucide-react";
import { NodeData, isMinted } from "../types/graph";
import { useActivePath } from "../context/ActivePathContext";
import { useTreeData } from "../context/TreeDataContext";
import { useFamilyTreeProjection } from "../hooks/useFamilyTreeProjection";
import PersonStoryCard from "../components/PersonStoryCard";
import StoryChunksModal from "../components/StoryChunksModal";
import PageContainer from "../components/PageContainer";
import SortButton from "../components/SortButton";

type FilterType = "all" | "by_create_time" | "by_name" | "by_endorsement" | "by_birth_year";
type SortOrder = "asc" | "desc";

export default function PeoplePage() {
  const { t } = useTranslation();
  const { nodesData, loading } = useTreeData();
  const [projectionEnabled, setProjectionEnabled] = useState(false);
  const { graph } = useFamilyTreeProjection({ enabled: projectionEnabled });
  const location = useLocation();
  const navigate = useNavigate();
  const { setActivePath } = useActivePath();
  // Track whether modal was opened by clicking inside this page
  const openedViaClickRef = useRef(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [selectedPerson, setSelectedPerson] = useState<NodeData | null>(null);
  const [selectedAddresses, setSelectedAddresses] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [addressInput, setAddressInput] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [personQueryError, setPersonQueryError] = useState<string | null>(null);
  const PAGE_SIZE = 12;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  // Avoid blocking the navigation paint: enable heavy projection work one frame later.
  useEffect(() => {
    const handle = window.requestAnimationFrame(() => setProjectionEnabled(true));
    return () => window.cancelAnimationFrame(handle);
  }, []);

  // Handle adding addresses
  const handleAddressKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addAddress();
    }
  };

  const addAddress = () => {
    const trimmed = addressInput.trim();
    if (trimmed && !selectedAddresses.includes(trimmed)) {
      setSelectedAddresses((prev) => [...prev, trimmed]);
      setAddressInput("");
    }
  };

  const removeAddress = (address: string) => {
    setSelectedAddresses((prev) => prev.filter((a) => a !== address));
  };

  // Handle adding tags
  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    }
  };

  const addTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !selectedTags.includes(trimmed)) {
      setSelectedTags((prev) => [...prev, trimmed]);
      setTagInput("");
    }
  };

  const removeTag = (tag: string) => {
    setSelectedTags((prev) => prev.filter((t) => t !== tag));
  };

  // Get person data from the SAME tree projection as TreePage.
  // This ensures the People page strictly follows the projected tree (childrenMode/dedup/etc).
  const people = useMemo(() => {
    return graph.nodes
      .map((n) => nodesData[n.id])
      .filter((person): person is NodeData => !!person && isMinted(person));
  }, [graph.nodes, nodesData]);

  const projectedLookup = useMemo(() => {
    const byId = new Map<string, NodeData>();
    const byTokenId = new Map<string, NodeData>();
    const byHash = new Map<string, NodeData>();
    for (const p of people) {
      byId.set(String(p.id), p);
      if (p.tokenId) byTokenId.set(String(p.tokenId), p);
      if (p.personHash) byHash.set(String(p.personHash).toLowerCase(), p);
    }
    return { byId, byTokenId, byHash };
  }, [people]);

  const clearPersonQuery = useCallback(() => {
    const sp = new URLSearchParams(location.search);
    sp.delete("person");
    navigate({ pathname: location.pathname, search: sp.toString() }, { replace: true });
    setPersonQueryError(null);
  }, [location.pathname, location.search, navigate]);

  const data = useMemo(() => {
    // Calculate total NFT count from the projected tree only (matches TreePage projection).
    const totalNFTs = graph.nodes.reduce((acc, n) => {
      const nd = nodesData[n.id];
      return isMinted(nd) ? acc + 1 : acc;
    }, 0);

    // Unique people count (by personHash) within the projected tree's minted set.
    const uniquePeople = new Set<string>();
    for (const n of graph.nodes) {
      const nd = nodesData[n.id];
      if (!isMinted(nd)) continue;
      uniquePeople.add(String(nd.personHash || "").toLowerCase());
    }

    return {
      people,
      totalCount: uniquePeople.size,
      totalNFTs, // Total NFT count in the projected tree
      loading,
    };
  }, [people, loading, nodesData, graph.nodes]);

  // Sync selectedPerson with URL query param (?person=tokenId|personHash|id)
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const q = sp.get("person");
    if (!q) {
      setSelectedPerson(null);
      setPersonQueryError(null);
      return;
    }
    if (!projectionEnabled) return;
    const normalized = q.trim();

    // Strict mode (B): only allow opening a person that exists in the CURRENT projected tree.
    // This keeps PeoplePage selection semantics consistent with TreePage (childrenMode/dedup/root).
    const isHexHash = /^0x[a-fA-F0-9]{64}$/.test(normalized);
    const resolved =
      projectedLookup.byId.get(normalized) ||
      (isHexHash ? projectedLookup.byHash.get(normalized.toLowerCase()) : null) ||
      projectedLookup.byTokenId.get(normalized) ||
      null;

    if (resolved) {
      setPersonQueryError(null);
      setSelectedPerson(resolved);
      return;
    }

    // If tree data is still building, defer "not found" until the projection stabilizes.
    setSelectedPerson(null);
    if (loading) return;
    setPersonQueryError(normalized);
  }, [location.search, projectedLookup, loading, projectionEnabled]);

  // Reset pagination when filters or projected set changes.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [PAGE_SIZE, filterType, sortOrder, searchTerm, selectedAddresses, selectedTags, people.length]);

  // Open person: push state with ?person=...
  const openPerson = useCallback((person: NodeData) => {
    openedViaClickRef.current = true;
    const sp = new URLSearchParams(location.search);
    sp.set("person", String(person.tokenId || person.personHash || person.id));
    navigate({ pathname: location.pathname, search: sp.toString() });
    // Optimistic local state for immediate render
    setSelectedPerson(person);
  }, [location.pathname, location.search, navigate]);

  // Close person: back if opened via click, else replace to clear query
  const closePerson = () => {
    const sp = new URLSearchParams(location.search);
    sp.delete("person");
    if (openedViaClickRef.current) {
      openedViaClickRef.current = false;
      navigate(-1);
    } else {
      navigate({ pathname: location.pathname, search: sp.toString() }, { replace: true });
    }
    setSelectedPerson(null);
  };

  // Search and filter logic
  const filteredPeople = useMemo(() => {
    let filtered = data.people;

    // Search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (person) =>
          person.fullName?.toLowerCase().includes(term) ||
          person.personHash.toLowerCase().includes(term) ||
          person.birthPlace?.toLowerCase().includes(term) ||
          person.deathPlace?.toLowerCase().includes(term) ||
          person.story?.toLowerCase().includes(term) ||
          person.addedBy?.toLowerCase().includes(term) ||
          person.tag?.toLowerCase().includes(term),
      );
    }

    // Address filter - match if person's address is in selected addresses
    if (selectedAddresses.length > 0) {
      filtered = filtered.filter((person) =>
        selectedAddresses.some((address) =>
          person.addedBy?.toLowerCase().includes(address.toLowerCase()),
        ),
      );
    }

    // Tag filter - match if person's tag is in selected tags
    if (selectedTags.length > 0) {
      filtered = filtered.filter((person) =>
        selectedTags.some((tag) => person.tag?.toLowerCase().includes(tag.toLowerCase())),
      );
    }

    // Sort and filter
    switch (filterType) {
      case "all":
        // Sort by tokenId with sort order
        filtered = filtered.sort((a, b) => {
          const aTokenId = parseInt(a.tokenId || "0");
          const bTokenId = parseInt(b.tokenId || "0");
          return sortOrder === "desc" ? bTokenId - aTokenId : aTokenId - bTokenId;
        });
        break;
      case "by_create_time":
        filtered = filtered.sort((a, b) => {
          const timeA = a.timestamp || 0;
          const timeB = b.timestamp || 0;
          return sortOrder === "desc" ? timeB - timeA : timeA - timeB;
        });
        break;
      case "by_name":
        filtered = filtered.sort((a, b) => {
          const nameA = a.fullName || "";
          const nameB = b.fullName || "";
          const result = nameA.localeCompare(nameB);
          return sortOrder === "desc" ? -result : result;
        });
        break;
      case "by_endorsement":
        filtered = filtered.sort((a, b) => {
          const countA = a.endorsementCount || 0;
          const countB = b.endorsementCount || 0;
          return sortOrder === "desc" ? countB - countA : countA - countB;
        });
        break;
      case "by_birth_year":
        filtered = filtered.sort((a, b) => {
          const aYear = a.birthYear || 0;
          const bYear = b.birthYear || 0;
          if (aYear === 0 && bYear === 0) return 0;
          if (aYear === 0) return sortOrder === "desc" ? -1 : 1;
          if (bYear === 0) return sortOrder === "desc" ? 1 : -1;
          return sortOrder === "desc" ? bYear - aYear : aYear - bYear;
        });
        break;
    }

    return filtered;
  }, [data.people, searchTerm, filterType, sortOrder, selectedAddresses, selectedTags]);

  const visiblePeople = useMemo(
    () => filteredPeople.slice(0, Math.max(0, visibleCount)),
    [filteredPeople, visibleCount],
  );

  const loadMore = useCallback(() => {
    setVisibleCount((c) => Math.min(c + PAGE_SIZE, filteredPeople.length));
  }, [PAGE_SIZE, filteredPeople.length]);

  // Infinite scroll: when reaching the bottom sentinel, append the next page.
  useEffect(() => {
    if (!projectionEnabled || data.loading) return;
    if (visibleCount >= filteredPeople.length) return;
    if (typeof window === "undefined" || typeof window.IntersectionObserver !== "function") return;
    const target = loadMoreSentinelRef.current;
    if (!target) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { root: null, rootMargin: "600px", threshold: 0 },
    );
    obs.observe(target);
    return () => obs.disconnect();
  }, [projectionEnabled, data.loading, visibleCount, filteredPeople.length, loadMore]);

  // No longer full-page loading overlay; changed to light hint in top-right, page always interactive

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-black text-gray-900 dark:text-gray-100 selection:bg-orange-500/30">
      {/* Hero Header */}
      <section className="relative pt-24 pb-12 md:pt-32 md:pb-20 overflow-hidden">
        {/* Ambient Background */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] bg-[radial-gradient(ellipse_at_top,rgba(251,146,60,0.15),transparent_70%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(251,146,60,0.1),transparent_70%)] pointer-events-none" />

        <PageContainer className="relative z-10">
          {/* Title */}
          <div className="text-center mb-16 md:mb-24">
            <h1 className="text-6xl md:text-8xl font-bold tracking-tighter mb-6">
              <span className="bg-clip-text text-transparent bg-gradient-to-b from-gray-900 to-gray-600 dark:from-white dark:to-gray-400">
                {t("people.title", "Family Encyclopedia")}
              </span>
            </h1>
            <p className="text-xl md:text-2xl text-gray-500 dark:text-gray-400 max-w-2xl mx-auto font-light leading-relaxed">
              {t("people.subtitle", "Explore family member profiles preserved on the blockchain")}
            </p>
          </div>

          {personQueryError ? (
            <div className="max-w-3xl mx-auto mb-10 px-4">
              <div className="rounded-2xl border border-amber-200/70 dark:border-amber-900/40 bg-amber-50/70 dark:bg-amber-900/20 px-5 py-4 text-sm text-amber-900 dark:text-amber-100">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold">
                      {t(
                        "people.personNotInTree.title",
                        "This person isn’t in the current tree projection",
                      )}
                    </div>
                    <div className="mt-1 text-amber-800/90 dark:text-amber-200/90 break-all">
                      {t("people.personNotInTree.query", "Query")}: {personQueryError}
                    </div>
                    <div className="mt-2 text-amber-800/80 dark:text-amber-200/80">
                      {t(
                        "people.personNotInTree.hint",
                        "Adjust the global tree configuration (root/contract/network) to include it, or open the Tree page.",
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setActivePath("/familyTree");
                          navigate("/familyTree");
                        }}
                        className="px-3 py-1.5 rounded-full bg-amber-900/90 text-amber-50 hover:bg-amber-900 transition-colors text-xs font-semibold"
                      >
                        {t("people.personNotInTree.openTree", "Open Tree")}
                      </button>
                      <button
                        type="button"
                        onClick={clearPersonQuery}
                        className="px-3 py-1.5 rounded-full bg-white/90 dark:bg-slate-900/40 border border-amber-300/60 dark:border-amber-800/40 text-amber-900 dark:text-amber-100 hover:bg-white dark:hover:bg-slate-900/60 transition-colors text-xs font-semibold"
                      >
                        {t("common.dismiss", "Dismiss")}
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearPersonQuery}
                    className="p-2 rounded-full hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                    aria-label={t("common.close", "Close")}
                    title={t("common.close", "Close")}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Stats Cards - Minimalist */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {/* Total People */}
            <div className="group relative p-8 rounded-[2rem] bg-white dark:bg-gray-900 shadow-xl shadow-gray-200/50 dark:shadow-none border border-gray-100 dark:border-gray-800 overflow-hidden hover:-translate-y-1 transition-all duration-500">
              <div className="absolute -right-6 -top-6 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity duration-500 transform group-hover:scale-110 group-hover:rotate-12 origin-center">
                <Users className="w-40 h-40 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 transition-colors">
                    <Users className="w-5 h-5" />
                  </div>
                  <div className="text-xs font-bold text-blue-900/50 dark:text-blue-100/50 uppercase tracking-widest">
                    {t("people.totalPeople", "People")}
                  </div>
                </div>
                <div className="text-6xl font-black tracking-tighter bg-gradient-to-br from-blue-600 to-indigo-600 bg-clip-text text-transparent tabular-nums">
                  {data.totalCount}
                </div>
              </div>
            </div>

            {/* Stories */}
            <div className="group relative p-8 rounded-[2rem] bg-white dark:bg-gray-900 shadow-xl shadow-gray-200/50 dark:shadow-none border border-gray-100 dark:border-gray-800 overflow-hidden hover:-translate-y-1 transition-all duration-500">
              <div className="absolute -right-6 -top-6 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity duration-500 transform group-hover:scale-110 group-hover:rotate-12 origin-center">
                <BookOpen className="w-40 h-40 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 group-hover:bg-purple-100 dark:group-hover:bg-purple-900/30 transition-colors">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div className="text-xs font-bold text-purple-900/50 dark:text-purple-100/50 uppercase tracking-widest">
                    {t("people.withEncyclopedia", "Encyclopedia")}
                  </div>
                </div>
                <div className="text-6xl font-black tracking-tighter bg-gradient-to-br from-purple-600 to-pink-600 bg-clip-text text-transparent tabular-nums">
                  {
                    data.people.filter((p) => p.storyMetadata && p.storyMetadata.totalChunks > 0)
                      .length
                  }
                </div>
              </div>
            </div>

            {/* NFTs */}
            <div className="group relative p-8 rounded-[2rem] bg-white dark:bg-gray-900 shadow-xl shadow-gray-200/50 dark:shadow-none border border-gray-100 dark:border-gray-800 overflow-hidden hover:-translate-y-1 transition-all duration-500">
              <div className="absolute -right-6 -top-6 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity duration-500 transform group-hover:scale-110 group-hover:rotate-12 origin-center">
                <svg
                  className="w-40 h-40 text-orange-600 dark:text-orange-400"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                </svg>
              </div>
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2.5 rounded-xl bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 group-hover:bg-orange-100 dark:group-hover:bg-orange-900/30 transition-colors">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"
                      />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                    </svg>
                  </div>
                  <div className="text-xs font-bold text-orange-900/50 dark:text-orange-100/50 uppercase tracking-widest">
                    {t("people.withNFTs", "NFTs")}
                  </div>
                </div>
                <div className="text-6xl font-black tracking-tighter bg-gradient-to-br from-orange-500 to-red-600 bg-clip-text text-transparent tabular-nums">
                  {data.totalNFTs}
                </div>
              </div>
            </div>
          </div>
        </PageContainer>
      </section>

      {/* Search and Filter Controls */}
      <PageContainer className="mb-12" noPadding>
        <div className="mx-4 md:mx-0 bg-white/50 dark:bg-gray-900/50 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-xl shadow-gray-200/20 dark:shadow-black/20 overflow-hidden transition-all duration-300 hover:shadow-2xl hover:shadow-gray-200/30 dark:hover:shadow-black/30">
          {/* Search Bar */}
          <div className="p-6 border-b border-gray-100 dark:border-gray-800">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-orange-500 transition-colors duration-300" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t(
                  "people.searchPlaceholder",
                  "Search by name, location, or story content...",
                )}
                className="w-full pl-11 pr-4 py-2.5 rounded-full bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 focus:bg-white dark:focus:bg-gray-800 transition-all duration-300"
              />
            </div>
          </div>

          {/* Advanced Filters */}
          <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left: Filters */}
            <div className="lg:col-span-7 space-y-6">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
                  {t("people.filterRules", "Filter Rules")}
                </div>
                {(selectedAddresses.length > 0 || selectedTags.length > 0 || searchTerm) && (
                  <button
                    onClick={() => {
                      setSelectedAddresses([]);
                      setSelectedTags([]);
                      setAddressInput("");
                      setTagInput("");
                      setSearchTerm("");
                      setFilterType("all");
                      setSortOrder("desc");
                    }}
                    className="text-xs font-medium text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 transition-colors"
                  >
                    {t("people.clearFilters", "Clear all filters")}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Address Filter */}
                <div className="space-y-3">
                  <div className="relative flex gap-2">
                    <div className="relative flex-1 group">
                      <User className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-orange-500 transition-colors" />
                      <input
                        type="text"
                        value={addressInput}
                        onChange={(e) => setAddressInput(e.target.value)}
                        onKeyDown={handleAddressKeyDown}
                        placeholder={t("people.filterByAddress", "Add creator address...")}
                        className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/10 transition-all"
                      />
                    </div>
                    <button
                      onClick={addAddress}
                      disabled={!addressInput.trim()}
                      className="w-10 h-10 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-orange-600 dark:hover:bg-orange-400 disabled:opacity-50 disabled:hover:bg-gray-900 dark:disabled:hover:bg-white transition-all flex items-center justify-center flex-shrink-0 active:scale-95"
                    >
                      <Plus className="w-5 h-5" strokeWidth={2.5} />
                    </button>
                  </div>
                  {selectedAddresses.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedAddresses.map((address) => (
                        <div
                          key={address}
                          className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 rounded-full text-xs font-medium border border-orange-100 dark:border-orange-900/30"
                        >
                          <span className="truncate max-w-[100px]">{address}</span>
                          <button
                            onClick={() => removeAddress(address)}
                            className="p-0.5 hover:bg-orange-200 dark:hover:bg-orange-800/40 rounded-full transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Tag Filter */}
                <div className="space-y-3">
                  <div className="relative flex gap-2">
                    <div className="relative flex-1 group">
                      <Hash className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-orange-500 transition-colors" />
                      <input
                        type="text"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={handleTagKeyDown}
                        placeholder={t("people.filterByTag", "Add tag...")}
                        className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/10 transition-all"
                      />
                    </div>
                    <button
                      onClick={addTag}
                      disabled={!tagInput.trim()}
                      className="w-10 h-10 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-orange-600 dark:hover:bg-orange-400 disabled:opacity-50 disabled:hover:bg-gray-900 dark:disabled:hover:bg-white transition-all flex items-center justify-center flex-shrink-0 active:scale-95"
                    >
                      <Plus className="w-5 h-5" strokeWidth={2.5} />
                    </button>
                  </div>
                  {selectedTags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedTags.map((tag) => (
                        <div
                          key={tag}
                          className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full text-xs font-medium border border-gray-200 dark:border-gray-700"
                        >
                          <span className="truncate max-w-[100px]">{tag}</span>
                          <button
                            onClick={() => removeTag(tag)}
                            className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Sort */}
            <div className="lg:col-span-5 space-y-6 lg:border-l lg:border-gray-100 lg:dark:border-gray-800 lg:pl-8">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600"></span>
                <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                  {t("people.sortRules", "Sort Rules")}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <SortButton
                  label={t("people.filterAll", "Token ID")}
                  isActive={filterType === "all"}
                  sortOrder={sortOrder}
                  onClick={() => setFilterType("all")}
                  onSortOrderChange={setSortOrder}
                  showSortArrows={true}
                />
                <SortButton
                  label={t("people.filterByCreateTime", "Creation Time")}
                  isActive={filterType === "by_create_time"}
                  sortOrder={sortOrder}
                  onClick={() => setFilterType("by_create_time")}
                  onSortOrderChange={setSortOrder}
                  showSortArrows={true}
                />
                <SortButton
                  label={t("people.filterByName", "Name")}
                  isActive={filterType === "by_name"}
                  sortOrder={sortOrder}
                  onClick={() => setFilterType("by_name")}
                  onSortOrderChange={setSortOrder}
                  showSortArrows={true}
                />
                <SortButton
                  label={t("people.filterByEndorsement", "Endorsements")}
                  isActive={filterType === "by_endorsement"}
                  sortOrder={sortOrder}
                  onClick={() => setFilterType("by_endorsement")}
                  onSortOrderChange={setSortOrder}
                  showSortArrows={true}
                />
                <SortButton
                  label={t("people.filterByBirthYear", "Birth Year")}
                  isActive={filterType === "by_birth_year"}
                  sortOrder={sortOrder}
                  onClick={() => setFilterType("by_birth_year")}
                  onSortOrderChange={setSortOrder}
                  showSortArrows={true}
                />
              </div>
            </div>
          </div>

          {/* Results Bar */}
          <div className="px-6 py-3 bg-gray-50/50 dark:bg-gray-900/30 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <div className="text-sm font-medium text-gray-500 dark:text-gray-400 flex items-center gap-2">
              {data.loading && (
                <div className="w-4 h-4 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
              )}
              <span>
                {selectedAddresses.length > 0 || selectedTags.length > 0
                  ? t("people.filteredResults", "{{count}} filtered results", {
                      count: filteredPeople.length,
                    })
                  : t("people.allResults", "{{count}} total results", {
                      count: filteredPeople.length,
                    })}
              </span>
            </div>
          </div>
        </div>
      </PageContainer>

      {/* Main Content */}
      <PageContainer className="pb-24" noPadding>
        {!projectionEnabled || data.loading ? (
          <div className="grid gap-6 px-4 sm:px-6 lg:px-8 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-[520px] rounded-[2rem] border border-gray-200/80 dark:border-gray-800 bg-white/70 dark:bg-gray-900/40 animate-pulse"
              />
            ))}
          </div>
        ) : filteredPeople.length === 0 ? (
          <div className="text-center py-32">
            <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gray-50 dark:bg-gray-900 mb-6">
              <Users className="w-10 h-10 text-gray-300 dark:text-gray-600" strokeWidth={1.5} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              {t("people.noResults", "No stories found")}
            </h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-8">
              {t("people.noResultsDesc", "Try adjusting your search terms or filters")}
            </p>
            {(selectedAddresses.length > 0 || selectedTags.length > 0 || searchTerm) && (
              <button
                onClick={() => {
                  setSelectedAddresses([]);
                  setSelectedTags([]);
                  setAddressInput("");
                  setTagInput("");
                  setSearchTerm("");
                  setFilterType("all");
                  setSortOrder("desc");
                }}
                className="px-8 py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-full font-medium hover:bg-orange-600 dark:hover:bg-orange-400 transition-colors"
              >
                {t("people.resetFilters", "Reset filters")}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-6 px-4 sm:px-6 lg:px-8 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {visiblePeople.map((person) => (
                <PersonStoryCard
                  key={person.id}
                  person={person}
                  onOpen={openPerson}
                />
              ))}
            </div>
            {visibleCount < filteredPeople.length ? (
              <div className="mt-10 px-4 sm:px-6 lg:px-8">
                <div ref={loadMoreSentinelRef} className="h-1 w-full" />
                <div className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                  <div className="w-4 h-4 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
                  <span>{t("common.loadingMore", "Loading more...")}</span>
                </div>
              </div>
            ) : null}
          </>
        )}
      </PageContainer>

      {/* Story Chunks Viewer Modal */}
      {selectedPerson && (
        <StoryChunksModal person={selectedPerson} isOpen={!!selectedPerson} onClose={closePerson} />
      )}
    </div>
  );
}
