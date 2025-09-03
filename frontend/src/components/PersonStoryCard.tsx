import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { 
  User, 
  MapPin, 
  Calendar, 
  Book, 
  Star, 
  Clock, 
  FileText, 
  Hash, 
  Award,
  ChevronRight,
  Eye
} from 'lucide-react'
import { NodeData } from '../types/graph'
import { shortHash } from '../types/graph'

interface PersonStoryCardProps {
  person: NodeData
  viewMode: 'grid' | 'list'
  onClick: () => void
}

export default function PersonStoryCard({ person, viewMode, onClick }: PersonStoryCardProps) {
  const { t } = useTranslation()

  // Format date
  const formatDate = useMemo(() => {
    const formatDatePart = (year?: number, month?: number, day?: number, isBC?: boolean) => {
      if (!year) return ''
      let dateStr = isBC ? `BC ${year}` : year.toString()
      if (month && month > 0) {
        dateStr += `-${month.toString().padStart(2, '0')}`
        if (day && day > 0) {
          dateStr += `-${day.toString().padStart(2, '0')}`
        }
      }
      return dateStr
    }

    const birth = formatDatePart(person.birthYear, person.birthMonth, person.birthDay, person.isBirthBC)
    const death = formatDatePart(person.deathYear, person.deathMonth, person.deathDay, person.isDeathBC)
    
    return { birth, death }
  }, [person])

  // Gender display
  const genderText = useMemo(() => {
    switch (person.gender) {
      case 1: return t('visualization.nodeDetail.genders.male', 'Male')
      case 2: return t('visualization.nodeDetail.genders.female', 'Female')
      case 3: return t('visualization.nodeDetail.genders.other', 'Other')
      default: return ''
    }
  }, [person.gender, t])

  // Story preview
  const storyPreview = useMemo(() => {
    if (!person.story) return ''
    return person.story.length > 150 ? person.story.substring(0, 150) + '...' : person.story
  }, [person.story])

  if (viewMode === 'list') {
    return (
      <div 
        onClick={onClick}
        className="group bg-white/95 dark:bg-gray-900/95 rounded-2xl shadow-lg hover:shadow-xl border border-gray-200/50 dark:border-gray-700/50 p-6 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 cursor-pointer relative overflow-hidden"
      >
        {/* Subtle background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-transparent to-purple-50/20 dark:from-blue-900/10 dark:via-transparent dark:to-purple-900/5 pointer-events-none rounded-2xl"></div>
        
        <div className="relative flex items-start gap-6">
          {/* Avatar/Icon */}
          <div className="flex-shrink-0">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 dark:from-blue-400 dark:to-purple-500 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-lg">
              <User className="w-8 h-8 text-white" />
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {person.fullName || `Person #${shortHash(person.personHash)}`}
                </h3>
                <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                  {genderText && (
                    <span className="flex items-center gap-1">
                      <User className="w-4 h-4" />
                      {genderText}
                    </span>
                  )}
                  {person.tokenId && person.tokenId !== '0' && (
                    <span className="flex items-center gap-1 font-mono">
                      <Hash className="w-4 h-4" />
                      #{person.tokenId}
                      {person.endorsementCount !== undefined && person.endorsementCount > 0 && (
                        <>
                          <span className="text-gray-400 mx-1">•</span>
                          <Star className="w-4 h-4 text-yellow-500" />
                          <span className="text-yellow-600 dark:text-yellow-400">{person.endorsementCount}</span>
                        </>
                      )}
                    </span>
                  )}
                </div>
              </div>
              
              {/* Badges */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {person.hasDetailedStory && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 text-xs font-medium">
                    <Book className="w-3 h-3" />
                    {t('storyPage.hasStory', 'Story')}
                  </span>
                )}
                {person.tokenId && person.tokenId !== '0' && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 text-xs font-medium">
                    <Award className="w-3 h-3" />
                    {t('storyPage.hasNFT', 'NFT')}
                  </span>
                )}
              </div>
            </div>

            {/* Dates and Locations */}
            {(formatDate.birth || formatDate.death || person.birthPlace || person.deathPlace) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                {(formatDate.birth || person.birthPlace) && (
                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <Calendar className="w-4 h-4 text-green-500" />
                    <span>{t('storyPage.born', 'Born')}: </span>
                    <span className="font-mono text-xs">
                      {[formatDate.birth, person.birthPlace].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                )}
                {(formatDate.death || person.deathPlace) && (
                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <Calendar className="w-4 h-4 text-gray-500" />
                    <span>{t('storyPage.died', 'Died')}: </span>
                    <span className="font-mono text-xs">
                      {[formatDate.death, person.deathPlace].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Story Preview */}
            {storyPreview && (
              <div className="mb-4">
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-3">
                  {storyPreview}
                </p>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                {person.timestamp && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(person.timestamp * 1000).toLocaleDateString()}
                  </span>
                )}
                {person.storyMetadata && (
                  <span className="flex items-center gap-1">
                    <FileText className="w-3 h-3" />
                    {t('storyPage.chunks', '{{count}} chunks', { count: person.storyMetadata.totalChunks })}
                  </span>
                )}
              </div>
              
              <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-blue-500 group-hover:translate-x-1 transition-all duration-200" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Grid view
  return (
    <div 
      onClick={onClick}
      className="group bg-white/95 dark:bg-gray-900/95 rounded-2xl shadow-lg hover:shadow-xl border border-gray-200/50 dark:border-gray-700/50 p-6 backdrop-blur-xl transition-all duration-300 hover:-translate-y-2 cursor-pointer relative overflow-hidden h-full flex flex-col"
    >
      {/* Subtle background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-transparent to-purple-50/20 dark:from-blue-900/10 dark:via-transparent dark:to-purple-900/5 pointer-events-none rounded-2xl"></div>
      
      <div className="relative flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 dark:from-blue-400 dark:to-purple-500 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-lg">
              <User className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1">
                {person.fullName || `Person #${shortHash(person.personHash)}`}
              </h3>
              {person.tokenId && person.tokenId !== '0' && (
                <div className="flex items-center gap-1 text-xs font-mono text-gray-500 dark:text-gray-400">
                  <span>#{person.tokenId}</span>
                  {person.endorsementCount !== undefined && person.endorsementCount > 0 && (
                    <>
                      <span className="text-gray-300 dark:text-gray-600 mx-1">•</span>
                      <Star className="w-3 h-3 text-yellow-500" />
                      <span className="text-yellow-600 dark:text-yellow-400">{person.endorsementCount}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          
          {/* Status Badges */}
          <div className="flex flex-col gap-1">
            {person.hasDetailedStory && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 text-xs font-medium">
                <Book className="w-3 h-3" />
              </span>
            )}
            {person.tokenId && person.tokenId !== '0' && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 text-xs font-medium">
                <Award className="w-3 h-3" />
              </span>
            )}
          </div>
        </div>

        {/* Basic Info */}
        <div className="space-y-2 mb-4 flex-1">
          {genderText && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <User className="w-4 h-4" />
              <span>{genderText}</span>
            </div>
          )}
          
          {(formatDate.birth || person.birthPlace) && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <Calendar className="w-4 h-4 text-green-500" />
              <span className="text-xs font-mono truncate">
                {[formatDate.birth, person.birthPlace].filter(Boolean).join(' · ')}
              </span>
            </div>
          )}

          {(formatDate.death || person.deathPlace) && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <MapPin className="w-4 h-4 text-gray-500" />
              <span className="text-xs font-mono truncate">
                {[formatDate.death, person.deathPlace].filter(Boolean).join(' · ')}
              </span>
            </div>
          )}

          {/* Story Preview */}
          {storyPreview && (
            <div className="mt-3 p-3 bg-gray-50/50 dark:bg-gray-800/30 rounded-lg border border-gray-200/50 dark:border-gray-700/30">
              <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-4">
                {storyPreview}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-200/50 dark:border-gray-700/30">
          <div className="flex items-center gap-2">
            {person.timestamp && (
              <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                <Clock className="w-3 h-3" />
                {new Date(person.timestamp * 1000).toLocaleDateString()}
              </span>
            )}
          </div>
          
          <button className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium group-hover:gap-2 transition-all duration-200">
            <Eye className="w-3 h-3" />
            {t('storyPage.viewDetails', 'View')}
          </button>
        </div>
      </div>
    </div>
  )
}