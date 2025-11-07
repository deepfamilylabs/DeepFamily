import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import FamilyTreeConfigForm from '../components/FamilyTreeConfigForm'
import ViewContainer from '../components/ViewContainer'
import { useTreeData } from '../context/TreeDataContext'
import { useVizOptions } from '../context/VizOptionsContext'
export default function TreePage() {
  const { traversal, setTraversal, deduplicateChildren, setDeduplicateChildren } = useVizOptions()
  const [viewMode, setViewMode] = useState<'dag' | 'tree' | 'force' | 'virtual'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('df:viewMode')
      if (saved === 'dag' || saved === 'tree' || saved === 'force' || saved === 'virtual') return saved as any
    }
    return 'tree'
  })
  const [editingConfig, setEditingConfig] = useState(false)

  const { t, i18n } = useTranslation()
  const { root, loading: loadingContract, progress, contractMessage, refresh } = useTreeData()

  const triggerRefresh = useCallback(() => refresh(), [refresh])
  useEffect(() => { triggerRefresh() }, [triggerRefresh])

  useEffect(() => { if (typeof window !== 'undefined') localStorage.setItem('df:viewMode', viewMode) }, [viewMode])

  return (
    <div className="space-y-4 text-gray-900 dark:text-gray-100 overflow-visible pb-4 md:pb-0 w-full max-w-full">
      {/* Configuration Card - Minimal Design */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden transition-shadow duration-200 hover:shadow-md dark:hover:shadow-slate-900/50">
        <FamilyTreeConfigForm
          editing={editingConfig}
          setEditing={setEditingConfig}
          locale={i18n.language}
          contractMessage={contractMessage}
          loading={loadingContract}
          onRefresh={triggerRefresh}
          t={t as any}
          traversal={traversal}
          setTraversal={setTraversal}
          deduplicateChildren={deduplicateChildren}
          setDeduplicateChildren={setDeduplicateChildren}
          progress={progress}
        />
      </div>

      {/* Tree Visualization Card - Minimal Design */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden transition-shadow duration-200 hover:shadow-lg dark:hover:shadow-slate-900/60">
        <ViewContainer
          viewMode={viewMode as any}
          root={root}
          contractMessage={contractMessage}
          loading={loadingContract}
          onViewModeChange={setViewMode}
          viewModeLabels={{ tree: t('familyTree.viewModes.tree'), dag: t('familyTree.viewModes.dag'), force: t('familyTree.viewModes.force'), virtual: t('familyTree.viewModes.virtual') }}
        />
      </div>
    </div>
  )
}
