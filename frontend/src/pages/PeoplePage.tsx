import { useState, useMemo, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search, Users, User, Hash, X, Plus } from 'lucide-react'
import { NodeData, isMinted, GraphNode, makeNodeId } from '../types/graph'
import { useTreeData } from '../context/TreeDataContext'
import PersonStoryCard from '../components/PersonStoryCard'
import StoryChunksModal from '../components/StoryChunksModal'
import PageContainer from '../components/PageContainer'
import SortButton from '../components/SortButton'

type FilterType = 'all' | 'by_create_time' | 'by_name' | 'by_endorsement' | 'by_birth_year'
type SortOrder = 'asc' | 'desc'

// Helper function to collect all nodes from root GraphNode tree structure
const collectAllNodesFromTree = (root: GraphNode | null): GraphNode[] => {
  if (!root) return []

  const nodes: GraphNode[] = []
  const stack: GraphNode[] = [root]

  while (stack.length > 0) {
    const node = stack.pop()!
    nodes.push(node)

    if (node.children) {
      stack.push(...node.children)
    }
  }

  return nodes
}

export default function PeoplePage() {
  const { t } = useTranslation()
  const { nodesData, loading, getNodeByTokenId, root } = useTreeData()
  const location = useLocation()
  const navigate = useNavigate()
  // Track whether modal was opened by clicking inside this page
  const openedViaClickRef = useRef(false)
  
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [selectedPerson, setSelectedPerson] = useState<NodeData | null>(null)
  const [selectedAddresses, setSelectedAddresses] = useState<string[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [addressInput, setAddressInput] = useState('')
  const [tagInput, setTagInput] = useState('')

  // Handle adding addresses
  const handleAddressKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addAddress()
    }
  }

  const addAddress = () => {
    const trimmed = addressInput.trim()
    if (trimmed && !selectedAddresses.includes(trimmed)) {
      setSelectedAddresses(prev => [...prev, trimmed])
      setAddressInput('')
    }
  }

  const removeAddress = (address: string) => {
    setSelectedAddresses(prev => prev.filter(a => a !== address))
  }

  // Handle adding tags
  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag()
    }
  }

  const addTag = () => {
    const trimmed = tagInput.trim()
    if (trimmed && !selectedTags.includes(trimmed)) {
      setSelectedTags(prev => [...prev, trimmed])
      setTagInput('')
    }
  }

  const removeTag = (tag: string) => {
    setSelectedTags(prev => prev.filter(t => t !== tag))
  }

  // Get person data from TreeDataContext, only show people from root subtree with NFTs
  const people = useMemo(() => {
    // Get all GraphNode instances from the root tree structure
    const allTreeNodes = collectAllNodesFromTree(root)

    // Convert GraphNodes to NodeData format and filter for those with NFTs
    const subtreePeopleWithNFTs = allTreeNodes
      .map(graphNode => {
        const nodeId = makeNodeId(graphNode.personHash, Number(graphNode.versionIndex))
        return nodesData[nodeId]
      })
      .filter(person => person && isMinted(person))

    // Group by personHash to get unique people (since one person can have multiple NFT versions)
    const uniquePeopleMap = new Map<string, NodeData>()

    subtreePeopleWithNFTs.forEach(person => {
      const personHash = person.personHash
      // If we haven't seen this personHash before, or if this version has more story chunks, use this version
      const existing = uniquePeopleMap.get(personHash)
      if (!existing ||
          (person.storyMetadata?.totalChunks || 0) > (existing.storyMetadata?.totalChunks || 0)) {
        uniquePeopleMap.set(personHash, person)
      }
    })

    return Array.from(uniquePeopleMap.values())
  }, [nodesData, root])

  const data = useMemo(() => {
    // Calculate total NFT count from subtree only
    const allTreeNodes = collectAllNodesFromTree(root)
    const totalNFTs = allTreeNodes
      .map(graphNode => {
        const nodeId = makeNodeId(graphNode.personHash, Number(graphNode.versionIndex))
        return nodesData[nodeId]
      })
      .filter(person => person && isMinted(person)).length

    return {
      people,
      totalCount: people.length, // Unique people count (by personHash)
      totalNFTs, // Total NFT count (can be more than people count)
      loading
    }
  }, [people, loading, nodesData, root])

  // Sync selectedPerson with URL query param (?person=tokenId|personHash|id)
  useLayoutEffect(() => {
    const sp = new URLSearchParams(location.search)
    const q = sp.get('person')
    if (!q) {
      if (selectedPerson) setSelectedPerson(null)
      return
    }
    // Prefer exact tokenId match from full nodesData (covers non-representative versions)
    const byToken = Object.values(nodesData).find((x) => x.tokenId && String(x.tokenId) === q)
    const p = byToken || people.find(
      (x) => (x.tokenId && String(x.tokenId) === q) || x.personHash === q || String(x.id) === q
    )
    // Always sync to the latest data object for the same person
    if (p) {
      setSelectedPerson(p)
    } else {
      // Cold start for tokenId deep link: fetch minimal details
      const isHexHash = /^0x[a-fA-F0-9]{64}$/.test(q)
      if (!isHexHash) {
        ;(async () => {
          const fetched = await getNodeByTokenId(q)
          if (fetched) setSelectedPerson(fetched)
        })()
      }
    }
  }, [location.search, people, nodesData])

  // Open person: push state with ?person=...
  const openPerson = (person: NodeData) => {
    openedViaClickRef.current = true
    const sp = new URLSearchParams(location.search)
    sp.set('person', String(person.tokenId || person.personHash || person.id))
    navigate({ pathname: location.pathname, search: sp.toString() })
    // Optimistic local state for immediate render
    setSelectedPerson(person)
  }

  // Close person: back if opened via click, else replace to clear query
  const closePerson = () => {
    const sp = new URLSearchParams(location.search)
    sp.delete('person')
    if (openedViaClickRef.current) {
      openedViaClickRef.current = false
      navigate(-1)
    } else {
      navigate({ pathname: location.pathname, search: sp.toString() }, { replace: true })
    }
    setSelectedPerson(null)
  }

  // Search and filter logic
  const filteredPeople = useMemo(() => {
    let filtered = data.people

    // Search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(person => 
        person.fullName?.toLowerCase().includes(term) ||
        person.personHash.toLowerCase().includes(term) ||
        person.birthPlace?.toLowerCase().includes(term) ||
        person.deathPlace?.toLowerCase().includes(term) ||
        person.story?.toLowerCase().includes(term) ||
        person.addedBy?.toLowerCase().includes(term) ||
        person.tag?.toLowerCase().includes(term)
      )
    }

    // Address filter - match if person's address is in selected addresses
    if (selectedAddresses.length > 0) {
      filtered = filtered.filter(person => 
        selectedAddresses.some(address => 
          person.addedBy?.toLowerCase().includes(address.toLowerCase())
        )
      )
    }

    // Tag filter - match if person's tag is in selected tags
    if (selectedTags.length > 0) {
      filtered = filtered.filter(person => 
        selectedTags.some(tag => 
          person.tag?.toLowerCase().includes(tag.toLowerCase())
        )
      )
    }

    // Sort and filter
    switch (filterType) {
      case 'all':
        // Sort by tokenId with sort order
        filtered = filtered.sort((a, b) => {
          const aTokenId = parseInt(a.tokenId || '0')
          const bTokenId = parseInt(b.tokenId || '0')
          return sortOrder === 'desc' ? bTokenId - aTokenId : aTokenId - bTokenId
        })
        break
      case 'by_create_time':
        filtered = filtered.sort((a, b) => {
          const timeA = a.timestamp || 0
          const timeB = b.timestamp || 0
          return sortOrder === 'desc' ? timeB - timeA : timeA - timeB
        })
        break
      case 'by_name':
        filtered = filtered.sort((a, b) => {
          const nameA = a.fullName || ''
          const nameB = b.fullName || ''
          const result = nameA.localeCompare(nameB)
          return sortOrder === 'desc' ? -result : result
        })
        break
      case 'by_endorsement':
        filtered = filtered.sort((a, b) => {
          const countA = a.endorsementCount || 0
          const countB = b.endorsementCount || 0
          return sortOrder === 'desc' ? countB - countA : countA - countB
        })
        break
      case 'by_birth_year':
        filtered = filtered.sort((a, b) => {
          const aYear = a.birthYear || 0
          const bYear = b.birthYear || 0
          if (aYear === 0 && bYear === 0) return 0
          if (aYear === 0) return sortOrder === 'desc' ? -1 : 1
          if (bYear === 0) return sortOrder === 'desc' ? 1 : -1
          return sortOrder === 'desc' ? bYear - aYear : aYear - bYear
        })
        break
    }

    return filtered
  }, [data.people, searchTerm, filterType, sortOrder, selectedAddresses, selectedTags])


  // No longer full-page loading overlay; changed to light hint in top-right, page always interactive

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white dark:from-gray-950 dark:to-gray-900">
      {/* Hero Header */}
      <section className="relative overflow-hidden bg-white dark:bg-gray-900">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.08),transparent_50%),radial-gradient(circle_at_70%_60%,rgba(168,85,247,0.08),transparent_50%)] dark:bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.15),transparent_50%),radial-gradient(circle_at_70%_60%,rgba(168,85,247,0.15),transparent_50%)]"></div>

        {/* Subtle Grid */}
        <div className="absolute inset-0" style={{
          backgroundImage: 'linear-gradient(rgba(156,163,175,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(156,163,175,0.03) 1px, transparent 1px)',
          backgroundSize: '48px 48px'
        }}></div>

        <PageContainer className="relative py-16 md:py-20">
          {/* Title */}
          <div className="text-center mb-10">
            <h1 className="text-5xl md:text-6xl font-black tracking-tight mb-4">
              <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 dark:from-blue-400 dark:via-indigo-400 dark:to-purple-400 bg-clip-text text-transparent">
                {t('people.title', 'Family Encyclopedia')}
              </span>
            </h1>
            <p className="text-lg md:text-xl text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
              {t('people.subtitle', 'Explore family member profiles preserved on the blockchain')}
            </p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-4xl mx-auto">
            {/* Total People */}
            <div className="group relative bg-gradient-to-br from-blue-500 to-blue-600 dark:from-blue-600 dark:to-blue-700 rounded-2xl p-6 overflow-hidden shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16"></div>
              <div className="absolute bottom-0 left-0 w-24 h-24 bg-black/10 rounded-full -ml-12 -mb-12"></div>

              <div className="relative">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold text-blue-100 uppercase tracking-wider">
                    {t('people.totalPeople', 'People')}
                  </div>
                  <Users className="w-5 h-5 text-blue-200" />
                </div>
                <div className="text-5xl font-black text-white tabular-nums">
                  {data.totalCount}
                </div>
              </div>
            </div>

            {/* Stories */}
            <div className="group relative bg-gradient-to-br from-purple-500 to-purple-600 dark:from-purple-600 dark:to-purple-700 rounded-2xl p-6 overflow-hidden shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16"></div>
              <div className="absolute bottom-0 left-0 w-24 h-24 bg-black/10 rounded-full -ml-12 -mb-12"></div>

              <div className="relative">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold text-purple-100 uppercase tracking-wider">
                    {t('people.withStories', 'Stories')}
                  </div>
                  <svg className="w-5 h-5 text-purple-200" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                  </svg>
                </div>
                <div className="text-5xl font-black text-white tabular-nums">
                  {data.people.filter(p => p.storyMetadata && p.storyMetadata.totalChunks > 0).length}
                </div>
              </div>
            </div>

            {/* NFTs */}
            <div className="group relative bg-gradient-to-br from-indigo-500 to-indigo-600 dark:from-indigo-600 dark:to-indigo-700 rounded-2xl p-6 overflow-hidden shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16"></div>
              <div className="absolute bottom-0 left-0 w-24 h-24 bg-black/10 rounded-full -ml-12 -mb-12"></div>

              <div className="relative">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold text-indigo-100 uppercase tracking-wider">
                    {t('people.withNFTs', 'NFTs')}
                  </div>
                  <svg className="w-5 h-5 text-indigo-200" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                  </svg>
                </div>
                <div className="text-5xl font-black text-white tabular-nums">
                  {data.totalNFTs}
                </div>
              </div>
            </div>
          </div>
        </PageContainer>
      </section>

      {/* Search and Filter Controls */}
      <PageContainer className="mt-8 mb-8" noPadding>
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-lg shadow-gray-100/50 dark:shadow-none overflow-hidden">
          {/* Search Bar */}
          <div className="p-6">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('people.searchPlaceholder', 'Search by name, location, or story content...')}
                className="w-full pl-12 pr-4 py-3.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:bg-white dark:focus:bg-gray-800 transition-all"
              />
            </div>
          </div>

          {/* Advanced Filters */}
          <div className="px-6 py-5 bg-gradient-to-b from-gray-50/80 to-gray-50/40 dark:from-gray-900/50 dark:to-gray-900/20 border-t border-gray-200/50 dark:border-gray-700/50">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <div className="w-1 h-4 bg-gradient-to-b from-blue-500 to-purple-500 rounded-full"></div>
                {t('people.filterRules', 'Filter Rules')}
              </div>
              {/* Clear Filters - moved to top right */}
              {(selectedAddresses.length > 0 || selectedTags.length > 0 || searchTerm) && (
                <button
                  onClick={() => {
                    setSelectedAddresses([])
                    setSelectedTags([])
                    setAddressInput('')
                    setTagInput('')
                    setSearchTerm('')
                    setFilterType('all')
                    setSortOrder('desc')
                  }}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium hover:underline transition-colors"
                >
                  {t('people.clearFilters', 'Clear all filters')}
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Creator Address Filter */}
              <div className="space-y-2.5">
                <div className="relative group flex gap-2">
                  <div className="relative flex-1">
                    <User className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    <input
                      type="text"
                      value={addressInput}
                      onChange={(e) => setAddressInput(e.target.value)}
                      onKeyDown={handleAddressKeyDown}
                      placeholder={t('people.filterByAddress', 'Add creator address...')}
                      className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-all"
                    />
                  </div>
                  <button
                    onClick={addAddress}
                    disabled={!addressInput.trim()}
                    className="w-10 h-10 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-all flex items-center justify-center flex-shrink-0 hover:scale-105 disabled:hover:scale-100 active:scale-95"
                  >
                    <Plus className="w-5 h-5" strokeWidth={2.5} />
                  </button>
                </div>
                {selectedAddresses.length > 0 && (
                  <div className="flex flex-wrap gap-2 p-2 bg-blue-50/50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-900/30">
                    {selectedAddresses.map((address) => (
                      <div
                        key={address}
                        className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 rounded-full text-sm shadow-sm hover:shadow-md transition-shadow"
                      >
                        <span className="font-mono text-xs truncate max-w-24">{address}</span>
                        <button
                          onClick={() => removeAddress(address)}
                          className="p-0.5 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800/60 transition-colors flex-shrink-0"
                          aria-label={`Remove ${address}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tag Filter */}
              <div className="space-y-2.5">
                <div className="relative group flex gap-2">
                  <div className="relative flex-1">
                    <Hash className="absolute left-3.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-purple-500 transition-colors" />
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={handleTagKeyDown}
                      placeholder={t('people.filterByTag', 'Add tag...')}
                      className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all"
                    />
                  </div>
                  <button
                    onClick={addTag}
                    disabled={!tagInput.trim()}
                    className="w-10 h-10 bg-purple-600 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-all flex items-center justify-center flex-shrink-0 hover:scale-105 disabled:hover:scale-100 active:scale-95"
                  >
                    <Plus className="w-5 h-5" strokeWidth={2.5} />
                  </button>
                </div>
                {selectedTags.length > 0 && (
                  <div className="flex flex-wrap gap-2 p-2 bg-purple-50/50 dark:bg-purple-900/10 rounded-lg border border-purple-100 dark:border-purple-900/30">
                    {selectedTags.map((tag) => (
                      <div
                        key={tag}
                        className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 rounded-full text-sm shadow-sm hover:shadow-md transition-shadow"
                      >
                        <span className="truncate max-w-24">{tag}</span>
                        <button
                          onClick={() => removeTag(tag)}
                          className="p-0.5 rounded-full hover:bg-purple-200 dark:hover:bg-purple-800/60 transition-colors flex-shrink-0"
                          aria-label={`Remove ${tag}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sort Controls */}
          <div className="px-6 py-5 border-t border-gray-200/50 dark:border-gray-700/50 bg-white dark:bg-gray-800">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-4 bg-gradient-to-b from-indigo-500 to-blue-500 rounded-full"></div>
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                {t('people.sortRules', 'Sort Rules')}
              </div>
            </div>
            <div className="inline-flex flex-wrap items-center gap-2 bg-gray-50 dark:bg-gray-900/50 rounded-xl p-2 border border-gray-200/80 dark:border-gray-700/80">
              <SortButton
                label={t('people.filterAll', 'Token ID')}
                isActive={filterType === 'all'}
                sortOrder={sortOrder}
                onClick={() => setFilterType('all')}
                onSortOrderChange={setSortOrder}
                showSortArrows={true}
              />
              <SortButton
                label={t('people.filterByCreateTime', 'Creation Time')}
                isActive={filterType === 'by_create_time'}
                sortOrder={sortOrder}
                onClick={() => setFilterType('by_create_time')}
                onSortOrderChange={setSortOrder}
                showSortArrows={true}
              />
              <SortButton
                label={t('people.filterByName', 'Name')}
                isActive={filterType === 'by_name'}
                sortOrder={sortOrder}
                onClick={() => setFilterType('by_name')}
                onSortOrderChange={setSortOrder}
                showSortArrows={true}
              />
              <SortButton
                label={t('people.filterByEndorsement', 'Endorsements')}
                isActive={filterType === 'by_endorsement'}
                sortOrder={sortOrder}
                onClick={() => setFilterType('by_endorsement')}
                onSortOrderChange={setSortOrder}
                showSortArrows={true}
              />
              <SortButton
                label={t('people.filterByBirthYear', 'Birth Year')}
                isActive={filterType === 'by_birth_year'}
                sortOrder={sortOrder}
                onClick={() => setFilterType('by_birth_year')}
                onSortOrderChange={setSortOrder}
                showSortArrows={true}
              />
            </div>
          </div>

          {/* Results count */}
          <div className="px-6 py-4 bg-gradient-to-r from-blue-50/30 via-purple-50/20 to-indigo-50/30 dark:from-blue-950/10 dark:via-purple-950/5 dark:to-indigo-950/10 border-t border-gray-200/50 dark:border-gray-700/50">
            <div className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2.5" aria-live="polite">
              {data.loading && (
                <>
                  <div className="relative">
                    <div className="w-4 h-4 border-2 border-blue-200 dark:border-blue-800 rounded-full"></div>
                    <div className="w-4 h-4 border-2 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full animate-spin absolute inset-0"></div>
                  </div>
                  <span className="font-medium">{t('people.syncing', 'Syncing...')}</span>
                  <span className="text-gray-300 dark:text-gray-600">·</span>
                </>
              )}
              <span className="font-semibold text-gray-900 dark:text-gray-100">
                {selectedAddresses.length > 0 || selectedTags.length > 0 ?
                  t('people.filteredResults', '{{count}} filtered results', { count: filteredPeople.length }) :
                  t('people.allResults', '{{count}} total results', { count: filteredPeople.length })
                }
              </span>
            </div>
          </div>
        </div>
      </PageContainer>

      {/* Main Content */}
      <PageContainer className="pb-12" noPadding>
        {filteredPeople.length === 0 ? (
          <div className="text-center py-20">
            <div className="relative inline-block mb-6">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/20 dark:to-purple-900/20 rounded-full blur-2xl opacity-50"></div>
              <div className="relative bg-white dark:bg-gray-800 rounded-2xl p-8 border-2 border-dashed border-gray-300 dark:border-gray-600">
                <Users className="w-20 h-20 text-gray-400 dark:text-gray-500 mx-auto" strokeWidth={1.5} />
              </div>
            </div>
            <p className="text-2xl font-semibold text-gray-700 dark:text-gray-300 mb-3">
              {t('people.noResults', 'No stories found')}
            </p>
            <p className="text-base text-gray-500 dark:text-gray-400 max-w-md mx-auto">
              {t('people.noResultsDesc', 'Try adjusting your search terms or filters')}
            </p>
            {(selectedAddresses.length > 0 || selectedTags.length > 0 || searchTerm) && (
              <button
                onClick={() => {
                  setSelectedAddresses([])
                  setSelectedTags([])
                  setAddressInput('')
                  setTagInput('')
                  setSearchTerm('')
                  setFilterType('all')
                  setSortOrder('desc')
                }}
                className="mt-6 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30"
              >
                {t('people.resetFilters', 'Reset filters')}
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-6 px-4 sm:px-6 lg:px-8 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {filteredPeople.map((person) => (
              <PersonStoryCard
                key={person.id}
                person={person}
                onClick={() => openPerson(person)}
              />
            ))}
          </div>
        )}
      </PageContainer>

      {/* Story Chunks Viewer Modal */}
      {selectedPerson && (
        <StoryChunksModal
          person={selectedPerson}
          isOpen={!!selectedPerson}
          onClose={closePerson}
        />
      )}
    </div>
  )
}
