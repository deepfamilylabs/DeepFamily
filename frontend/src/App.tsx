import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Layout from './components/Layout'
import Home from './pages/Home'
import VisualizationPage from './pages/VisualizationPage'
import SettingsPage from './pages/SettingsPage'
import SearchPage from './pages/SearchPage'
import StoryDetailPage from './pages/StoryDetailPage'
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
        case '/settings':
          return `${baseName} - ${t('navigation.settings')}`
        default:
          if (location.pathname.startsWith('/story/')) {
            return `${baseName} - ${t('storyDetail.pageTitle', 'Story Details')}`
          }
          return `${baseName} - ${t('home.title')}`
      }
    }

    document.title = getPageTitle()
  }, [location.pathname, t, i18n.language])

  return null
}

export default function App() {
  return (
    <ConfigProvider>
      <ToastProvider>
        <BrowserRouter>
          <TitleUpdater />
          <VizOptionsProvider>
            {/* TreeDataProvider no longer needs traversal/includeX props; it reads VizOptions context directly */}
            <TreeDataProvider>
              <Routes>
                <Route path="/" element={<Layout />}> 
                  <Route index element={<Home />} />
                  <Route path="visualization" element={<VisualizationPage />} />
                  <Route path="search" element={<SearchPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
                <Route path="/story/:tokenId" element={<StoryDetailPage />} />
              </Routes>
            </TreeDataProvider>
          </VizOptionsProvider>
        </BrowserRouter>
      </ToastProvider>
    </ConfigProvider>
  )
}

