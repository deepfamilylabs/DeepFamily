import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Layout from './components/Layout'
import Home from './pages/Home'
import VisualizationPage from './pages/VisualizationPage'
import SearchPage from './pages/SearchPage'
import PersonPage from './pages/PersonPage'
import PeoplePage from './pages/PeoplePage'
import StoryEditorPage from './pages/StoryEditorPage'
import { ConfigProvider } from './context/ConfigContext'
import { ToastProvider } from './components/ToastProvider'
import { VizOptionsProvider } from './context/VizOptionsContext'
import { TreeDataProvider } from './context/TreeDataContext'

function TitleUpdater() {
  const { t, i18n } = useTranslation()
  const location = useLocation()

  useEffect(() => {
    const getPageTitle = () => {
      const baseName = 'DeepFamily'
      switch (location.pathname) {
        case '/':
          return `${baseName} - ${t('home.title')}`
        case '/visualization':
          return `${baseName} - ${t('navigation.visualization')}`
        case '/search':
          return `${baseName} - ${t('navigation.search')}`
        case '/people':
          return `${baseName} - ${t('navigation.people')}`
        default:
          if (location.pathname.startsWith('/person/')) {
            return `${baseName} - ${t('person.pageTitle', 'Person Biography')}`
          }
          return `${baseName} - ${t('home.title')}`
      }
    }

    document.title = getPageTitle()
  }, [location.pathname, t, i18n.language])

  return null
}

function RouterContent() {
  const location = useLocation()
  const state = location.state as { backgroundLocation?: Location } | undefined
  return (
    <VizOptionsProvider>
      {/* TreeDataProvider no longer needs traversal/includeX props; it reads VizOptions context directly */}
      <TreeDataProvider>
        {/* Base routes render either normal location or the background one if present */}
        <Routes location={state?.backgroundLocation || location}>
          <Route path="/" element={<Layout />}> 
            <Route index element={<Home />} />
            <Route path="visualization" element={<VisualizationPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="people" element={<PeoplePage />} />
          </Route>
          <Route path="/person/:tokenId" element={<PersonPage />} />
          <Route path="/editor/:tokenId" element={<StoryEditorPage />} />
        </Routes>
        {/* If there's a background location, render editor as an overlay route */}
        {state?.backgroundLocation && (
          <div className="fixed inset-0 z-[2000] bg-white dark:bg-gray-900">
            <Routes>
              <Route path="/editor/:tokenId" element={<StoryEditorPage />} />
            </Routes>
          </div>
        )}
      </TreeDataProvider>
    </VizOptionsProvider>
  )
}

export default function App() {
  return (
    <ConfigProvider>
      <ToastProvider>
        <BrowserRouter>
          <TitleUpdater />
          <RouterContent />
        </BrowserRouter>
      </ToastProvider>
    </ConfigProvider>
  )
}
