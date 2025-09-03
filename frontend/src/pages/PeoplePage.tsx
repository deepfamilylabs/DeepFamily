import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Filter, Users, Book, Sparkles, ArrowRight, Grid, List as ListIcon, User, Hash } from 'lucide-react'
import { NodeData } from '../types/graph'
import { useTreeData } from '../context/TreeDataContext'
import PersonStoryCard from '../components/PersonStoryCard'
import StoryChunksViewer from '../components/StoryChunksViewer'
import PageContainer from '../components/PageContainer'

interface PeoplePageData {
  people: NodeData[]
  totalCount: number
  loading: boolean
}

type ViewMode = 'grid' | 'list'
type FilterType = 'all' | 'recent' | 'oldest' | 'by_name' | 'by_endorsement' | 'by_birth_year'

export default function PeoplePage() {
  const { t } = useTranslation()
  const { nodesData, loading } = useTreeData()
  
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [selectedPerson, setSelectedPerson] = useState<NodeData | null>(null)
  const [addressFilter, setAddressFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')

  // Get person data from TreeDataContext, only show people with NFTs (people with stories)
  const people = useMemo(() => {
    return Object.values(nodesData)
      .filter(person => {
        // Only people with NFT versions have stories
        const hasNFT = person.tokenId && person.tokenId !== '0'
        return hasNFT
      })
      .map(person => ({
        ...person,
        hasDetailedStory: !!(person.storyMetadata && person.storyMetadata.totalChunks > 0)
      }))
  }, [nodesData])

  const data = useMemo(() => ({
    people,
    totalCount: people.length,
    loading
  }), [people, loading])

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

    // Address filter
    if (addressFilter.trim()) {
      const addressTerm = addressFilter.toLowerCase()
      filtered = filtered.filter(person => 
        person.addedBy?.toLowerCase().includes(addressTerm)
      )
    }

    // Tag filter
    if (tagFilter.trim()) {
      const tagTerm = tagFilter.toLowerCase()
      filtered = filtered.filter(person => 
        person.tag?.toLowerCase().includes(tagTerm)
      )
    }

    // Sort and filter
    switch (filterType) {
      case 'all':
        // Default sort by tokenId (ascending)
        filtered = filtered.sort((a, b) => {
          const aTokenId = parseInt(a.tokenId || '0')
          const bTokenId = parseInt(b.tokenId || '0')
          return aTokenId - bTokenId
        })
        break
      case 'recent':
        filtered = filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 20)
        break
      case 'oldest':
        filtered = filtered.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).slice(0, 20)
        break
      case 'by_name':
        filtered = filtered.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
        break
      case 'by_endorsement':
        filtered = filtered.sort((a, b) => (b.endorsementCount || 0) - (a.endorsementCount || 0))
        break
      case 'by_birth_year':
        filtered = filtered.sort((a, b) => {
          const aYear = a.birthYear || 0
          const bYear = b.birthYear || 0
          if (aYear === 0 && bYear === 0) return 0
          if (aYear === 0) return 1  // No birth year goes to the end
          if (bYear === 0) return -1
          return aYear - bYear  // Sort by birth year ascending
        })
        break
    }

    return filtered
  }, [data.people, searchTerm, filterType, addressFilter, tagFilter])


  if (data.loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white dark:from-gray-950 dark:to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">{t('people.loading', 'Loading stories...')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white dark:from-gray-950 dark:to-gray-900">
      {/* Hero Header */}
      <section className="relative overflow-hidden bg-gradient-to-br from-blue-500/10 via-purple-500/8 to-indigo-500/10 dark:from-blue-600/20 dark:via-purple-600/15 dark:to-indigo-600/20 py-16 mb-8">
        {/* Background decorations */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-10 left-20 w-32 h-32 bg-gradient-to-br from-blue-400/20 to-cyan-400/15 rounded-full blur-2xl animate-float"></div>
          <div className="absolute top-20 right-16 w-40 h-40 bg-gradient-to-br from-purple-400/15 to-pink-400/12 rounded-full blur-2xl animate-pulse-soft"></div>
          <div className="absolute bottom-10 left-1/3 w-24 h-24 bg-gradient-to-br from-indigo-400/25 to-blue-400/20 rounded-full blur-xl animate-bounce-gentle"></div>
        </div>

        <PageContainer className="relative text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 border border-blue-200/50 dark:border-blue-600/30 mb-6 backdrop-blur-sm">
            <Book className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">{t('people.badge', 'Family Stories')}</span>
          </div>

          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 dark:text-gray-100 mb-6 leading-tight">
            <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 dark:from-blue-400 dark:via-purple-400 dark:to-indigo-400 bg-clip-text text-transparent">
              {t('people.title', 'Family Stories Encyclopedia')}
            </span>
          </h1>

          <p className="text-xl md:text-2xl text-gray-600 dark:text-gray-400 max-w-4xl mx-auto mb-8 leading-relaxed">
            {t('people.subtitle', 'Discover the rich narratives and biographical details of family members preserved on the blockchain')}
          </p>

          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-2xl mx-auto">
            <div className="bg-white/40 dark:bg-gray-800/40 backdrop-blur-sm rounded-2xl p-4 border border-white/20 dark:border-gray-700/20">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 mb-1">{data.totalCount}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">{t('people.totalPeople', 'Total People')}</div>
            </div>
            <div className="bg-white/40 dark:bg-gray-800/40 backdrop-blur-sm rounded-2xl p-4 border border-white/20 dark:border-gray-700/20">
              <div className="text-2xl font-bold text-purple-600 dark:text-purple-400 mb-1">
                {data.people.filter(p => p.storyMetadata && p.storyMetadata.totalChunks > 0).length}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">{t('people.withStories', 'With Detailed Stories')}</div>
            </div>
            <div className="bg-white/40 dark:bg-gray-800/40 backdrop-blur-sm rounded-2xl p-4 border border-white/20 dark:border-gray-700/20">
              <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mb-1">
                {data.people.filter(p => p.tokenId && p.tokenId !== '0').length}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">{t('people.withNFTs', 'With NFTs')}</div>
            </div>
          </div>
        </PageContainer>
      </section>

      {/* Search and Filter Controls */}
      <PageContainer className="mb-8">
        <div className="bg-white/95 dark:bg-gray-900/95 rounded-2xl shadow-lg border border-gray-200/50 dark:border-gray-700/50 p-6 backdrop-blur-xl">
          <div className="flex flex-col gap-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('people.searchPlaceholder', 'Search by name, location, or story content...')}
                className="w-full pl-12 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
              />
            </div>

            {/* Advanced Filters */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="relative">
                <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={addressFilter}
                  onChange={(e) => setAddressFilter(e.target.value)}
                  placeholder={t('people.filterByAddress', 'Filter by creator address...')}
                  className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                />
              </div>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  placeholder={t('people.filterByTag', 'Filter by tag...')}
                  className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                />
              </div>
            </div>

            {/* Clear Filters */}
            {(addressFilter || tagFilter || searchTerm) && (
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    setAddressFilter('')
                    setTagFilter('')
                    setSearchTerm('')
                    setFilterType('all')
                  }}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
                >
                  {t('people.clearFilters', 'Clear all filters')}
                </button>
              </div>
            )}

            <div className="flex flex-col gap-4">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {addressFilter || tagFilter ? 
                  t('people.filteredResults', '{{count}} filtered results', { count: filteredPeople.length }) :
                  t('people.allResults', '{{count}} total results', { count: filteredPeople.length })
                }
              </div>

              {/* Filters */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="overflow-x-auto">
                <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 min-w-max">
                <button
                  onClick={() => setFilterType('all')}
                  className={`px-2 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                    filterType === 'all'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700'
                  }`}
                >
                  {t('people.filterAll', 'All')}
                </button>
                <button
                  onClick={() => setFilterType('recent')}
                  className={`px-2 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                    filterType === 'recent'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700'
                  }`}
                >
                  {t('people.filterRecent', 'Recent')}
                </button>
                <button
                  onClick={() => setFilterType('oldest')}
                  className={`px-2 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                    filterType === 'oldest'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700'
                  }`}
                >
                  {t('people.filterOldest', 'Oldest')}
                </button>
                <button
                  onClick={() => setFilterType('by_name')}
                  className={`px-2 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                    filterType === 'by_name'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700'
                  }`}
                >
                  {t('people.filterByName', 'By Name')}
                </button>
                <button
                  onClick={() => setFilterType('by_endorsement')}
                  className={`px-2 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                    filterType === 'by_endorsement'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700'
                  }`}
                >
                  {t('people.filterByEndorsement', 'By Endorsement')}
                </button>
                <button
                  onClick={() => setFilterType('by_birth_year')}
                  className={`px-2 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                    filterType === 'by_birth_year'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700'
                  }`}
                >
                  {t('people.filterByBirthYear', 'By Birth Year')}
                </button>
              </div>
              </div>

              {/* View Mode Toggle */}
              <div className="flex-shrink-0">
                <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded-lg transition-colors ${
                    viewMode === 'grid'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700'
                  }`}
                  title={t('people.gridView', 'Grid View')}
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded-lg transition-colors ${
                    viewMode === 'list'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700'
                  }`}
                  title={t('people.listView', 'List View')}
                >
                  <ListIcon className="w-4 h-4" />
                </button>
              </div>
              </div>
            </div>
            </div>
          </div>

          {/* Results count */}
          <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            {t('people.resultsCount', '{{count}} results found', { count: filteredPeople.length })}
          </div>
        </div>
      </PageContainer>

      {/* Main Content */}
      <PageContainer className="pb-12">
        {filteredPeople.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <p className="text-xl text-gray-500 dark:text-gray-400 mb-2">
              {t('people.noResults', 'No stories found')}
            </p>
            <p className="text-gray-400 dark:text-gray-500">
              {t('people.noResultsDesc', 'Try adjusting your search terms or filters')}
            </p>
          </div>
        ) : (
          <div className={`grid gap-6 ${viewMode === 'grid' ? 'md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1 max-w-4xl mx-auto'}`}>
            {filteredPeople.map((person) => (
              <PersonStoryCard
                key={person.id}
                person={person}
                viewMode={viewMode}
                onClick={() => setSelectedPerson(person)}
              />
            ))}
          </div>
        )}
      </PageContainer>

      {/* Story Chunks Viewer Modal */}
      {selectedPerson && (
        <StoryChunksViewer
          person={selectedPerson}
          isOpen={!!selectedPerson}
          onClose={() => setSelectedPerson(null)}
        />
      )}
    </div>
  )
}