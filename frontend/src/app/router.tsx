import React, { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layout } from "./ui";
import { ActivePathProvider } from "./context";
import { DomainErrorBoundary } from "./error-boundary";

// Page-level code splitting — each page is a separate chunk
const Home = lazy(() => import("../pages/Home"));
const TreePage = lazy(() => import("../pages/TreePage"));
const SearchPage = lazy(() => import("../pages/SearchPage"));
const PersonPage = lazy(() => import("../pages/PersonPage"));
const PeoplePage = lazy(() => import("../pages/PeoplePage"));
const StoryEditorPage = lazy(() => import("../pages/StoryEditorPage"));
const ActionsPage = lazy(() => import("../pages/ActionsPage"));
const KeyDerivationPage = lazy(() => import("../pages/KeyDerivationPage"));
const DecryptMetadataPage = lazy(() => import("../pages/DecryptMetadataPage"));
const GenealogyBookPage = lazy(() => import("../pages/GenealogyBookPage"));

function PageFallback() {
  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="animate-pulse text-gray-400">Loading...</div>
    </div>
  );
}

function TitleUpdater() {
  const { t, i18n } = useTranslation();
  const location = useLocation();

  useEffect(() => {
    const getPageTitle = () => {
      const baseName = "DeepFamily";
      switch (location.pathname) {
        case "/":
          return `${baseName} - ${t("home.title")}`;
        case "/familyTree":
          return `${baseName} - ${t("navigation.familyTree")}`;
        case "/genealogyBook":
          return `${baseName} - ${t("navigation.genealogyBook", "Genealogy")}`;
        case "/search":
          return `${baseName} - ${t("navigation.search")}`;
        case "/people":
          return `${baseName} - ${t("navigation.people")}`;
        case "/actions":
          return `${baseName} - ${t("navigation.actions", "Actions")}`;
        case "/keygen":
          return `${baseName} - Secure Key Derivation`;
        case "/decrypt":
          return `${baseName} - ${t("decryptMetadata.title", "Decrypt Metadata")}`;
        default:
          if (location.pathname.startsWith("/person/")) {
            return `${t("person.pageTitle", "Biography Wiki")}`;
          }
          if (location.pathname.startsWith("/editor/")) {
            return `${baseName} - ${t("storyEditor.title", "Story Editor")}`;
          }
          return `${baseName} - ${t("home.title")}`;
      }
    };

    document.title = getPageTitle();
  }, [location.pathname, t, i18n.language]);

  return null;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <ActivePathProvider>
        <TitleUpdater />
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="familyTree" element={<DomainErrorBoundary domain="tree"><TreePage /></DomainErrorBoundary>} />
              <Route path="genealogyBook" element={<DomainErrorBoundary domain="genealogy"><GenealogyBookPage /></DomainErrorBoundary>} />
              <Route path="search" element={<DomainErrorBoundary domain="search"><SearchPage /></DomainErrorBoundary>} />
              <Route path="people" element={<DomainErrorBoundary domain="people"><PeoplePage /></DomainErrorBoundary>} />
              <Route path="actions" element={<ActionsPage />} />
              <Route path="keygen" element={<KeyDerivationPage />} />
              <Route path="decrypt" element={<DecryptMetadataPage />} />
              <Route path="person/:tokenId" element={<DomainErrorBoundary domain="person"><PersonPage /></DomainErrorBoundary>} />
              <Route path="editor/:tokenId" element={<DomainErrorBoundary domain="story"><StoryEditorPage /></DomainErrorBoundary>} />
            </Route>
          </Routes>
        </Suspense>
      </ActivePathProvider>
    </BrowserRouter>
  );
}
