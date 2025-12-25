import { useState, useMemo, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search, Users, User, Hash, X, Plus, BookOpen } from "lucide-react";
import { NodeData, isMinted } from "../types/graph";
import { useTreeData } from "../context/TreeDataContext";
import PersonStoryCard from "../components/PersonStoryCard";
import StoryChunksModal from "../components/StoryChunksModal";
import PageContainer from "../components/PageContainer";
import SortButton from "../components/SortButton";

type FilterType = "all" | "by_create_time" | "by_name" | "by_endorsement" | "by_birth_year";
type SortOrder = "asc" | "desc";

export default function PeoplePage() {
  const { t } = useTranslation();
  const { nodesData, loading, getNodeByTokenId, reachableNodeIds } = useTreeData();
  const location = useLocation();
  const navigate = useNavigate();
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

  // Get person data from TreeDataContext, only show people from root subtree with NFTs
  const people = useMemo(() => {
    const subtreePeopleWithNFTs = reachableNodeIds
      .map((id) => nodesData[id])
      .filter((person) => person && isMinted(person));

    // Group by personHash to get unique people (since one person can have multiple NFT versions)
    const uniquePeopleMap = new Map<string, NodeData>();

    subtreePeopleWithNFTs.forEach((person) => {
      const personHash = person.personHash;
      // If we haven't seen this personHash before, or if this version has more story chunks, use this version
      const existing = uniquePeopleMap.get(personHash);
      if (
        !existing ||
        (person.storyMetadata?.totalChunks || 0) > (existing.storyMetadata?.totalChunks || 0)
      ) {
        uniquePeopleMap.set(personHash, person);
      }
    });

    return Array.from(uniquePeopleMap.values());
  }, [nodesData, reachableNodeIds]);

  const data = useMemo(() => {
    // Calculate total NFT count from subtree only
    const totalNFTs = reachableNodeIds.reduce(
      (acc, id) => (isMinted(nodesData[id]) ? acc + 1 : acc),
      0,
    );

    return {
      people,
      totalCount: people.length, // Unique people count (by personHash)
      totalNFTs, // Total NFT count (can be more than people count)
      loading,
    };
  }, [people, loading, nodesData, reachableNodeIds]);

  // Sync selectedPerson with URL query param (?person=tokenId|personHash|id)
  useLayoutEffect(() => {
    const sp = new URLSearchParams(location.search);
    const q = sp.get("person");
    if (!q) {
      if (selectedPerson) setSelectedPerson(null);
      return;
    }
    // Prefer exact tokenId match from full nodesData (covers non-representative versions)
    const byToken = Object.values(nodesData).find((x) => x.tokenId && String(x.tokenId) === q);
    const p =
      byToken ||
      people.find(
        (x) => (x.tokenId && String(x.tokenId) === q) || x.personHash === q || String(x.id) === q,
      );
    // Always sync to the latest data object for the same person
    if (p) {
      setSelectedPerson(p);
    } else {
      // Cold start for tokenId deep link: fetch minimal details
      const isHexHash = /^0x[a-fA-F0-9]{64}$/.test(q);
      if (!isHexHash) {
        (async () => {
          const fetched = await getNodeByTokenId(q);
          if (fetched) setSelectedPerson(fetched);
        })();
      }
    }
  }, [location.search, people, nodesData]);

  // Open person: push state with ?person=...
  const openPerson = (person: NodeData) => {
    openedViaClickRef.current = true;
    const sp = new URLSearchParams(location.search);
    sp.set("person", String(person.tokenId || person.personHash || person.id));
    navigate({ pathname: location.pathname, search: sp.toString() });
    // Optimistic local state for immediate render
    setSelectedPerson(person);
  };

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
                    {data.people.filter((p) => p.storyMetadata && p.storyMetadata.totalChunks > 0).length}
                 </div>
              </div>
            </div>

            {/* NFTs */}
            <div className="group relative p-8 rounded-[2rem] bg-white dark:bg-gray-900 shadow-xl shadow-gray-200/50 dark:shadow-none border border-gray-100 dark:border-gray-800 overflow-hidden hover:-translate-y-1 transition-all duration-500">
              <div className="absolute -right-6 -top-6 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity duration-500 transform group-hover:scale-110 group-hover:rotate-12 origin-center">
                 <svg className="w-40 h-40 text-orange-600 dark:text-orange-400" fill="currentColor" viewBox="0 0 24 24"><path d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" /></svg>
              </div>
              <div className="relative z-10">
                 <div className="flex items-center gap-3 mb-4">
                    <div className="p-2.5 rounded-xl bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 group-hover:bg-orange-100 dark:group-hover:bg-orange-900/30 transition-colors">
                       <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" /><path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" /></svg>
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
                placeholder={t("people.searchPlaceholder", "Search by name, location, or story content...")}
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
                          <div key={address} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 rounded-full text-xs font-medium border border-orange-100 dark:border-orange-900/30">
                            <span className="truncate max-w-[100px]">{address}</span>
                            <button onClick={() => removeAddress(address)} className="p-0.5 hover:bg-orange-200 dark:hover:bg-orange-800/40 rounded-full transition-colors">
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
                          <div key={tag} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full text-xs font-medium border border-gray-200 dark:border-gray-700">
                            <span className="truncate max-w-[100px]">{tag}</span>
                            <button onClick={() => removeTag(tag)} className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors">
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
                    ? t("people.filteredResults", "{{count}} filtered results", { count: filteredPeople.length })
                    : t("people.allResults", "{{count}} total results", { count: filteredPeople.length })}
                </span>
             </div>
          </div>
        </div>
      </PageContainer>

      {/* Main Content */}
      <PageContainer className="pb-24" noPadding>
        {filteredPeople.length === 0 ? (
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
          <div className="grid gap-6 px-4 sm:px-6 lg:px-8 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {filteredPeople.map((person) => (
              <PersonStoryCard key={person.id} person={person} onClick={() => openPerson(person)} />
            ))}
          </div>
        )}
      </PageContainer>

      {/* Story Chunks Viewer Modal */}
      {selectedPerson && (
        <StoryChunksModal person={selectedPerson} isOpen={!!selectedPerson} onClose={closePerson} />
      )}
    </div>
  );
}
