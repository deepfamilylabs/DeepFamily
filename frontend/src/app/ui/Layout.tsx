/**
 * Layout Component
 *
 * Copyright notice:
 * - TreeDeciduous icon and other icons from Lucide React (https://lucide.dev)
 * - Licensed under ISC License - allows commercial use, modification, and distribution
 * - Copyright (c) 2020, Lucide Contributors
 */

import { Outlet, useLocation } from "react-router-dom";
import BottomNav from "./BottomNav";
import { PageContainer } from "../../shared/ui";
import SiteHeader from "./SiteHeader";
import FloatingActionButton from "./FloatingActionButton";
import GlobalSidebar from "./GlobalSidebar";
import StatusBar from "./StatusBar";

export default function Layout() {
  const location = useLocation();
  const isHomePage = location.pathname === "/";
  const isPeoplePage = location.pathname === "/people";
  const isTreePage = location.pathname === "/familyTree";
  const isGenealogyBookPage = location.pathname === "/genealogyBook";
  const isFullWidthPage = isHomePage || isPeoplePage || isTreePage || isGenealogyBookPage;

  // Dynamic background based on page type
  const bgClass =
    isPeoplePage || isTreePage || isGenealogyBookPage
      ? "bg-white dark:bg-black" // Full-width pages handle their own background
      : isHomePage
        ? // The landing page keeps its own wash
          "bg-linear-to-b from-sky-50 to-white dark:from-gray-950 dark:to-gray-900"
        : "bg-surface-body";

  // The desktop rail is 4rem wide and runs the full viewport height, so the
  // header, the page and the status bar all clear it by the same constant 4rem.
  // Its open states overlay the page, so opening the sidebar never reflows it.
  return (
    <div className={`${bgClass} min-h-screen transition-colors duration-300`}>
      <SiteHeader />
      <GlobalSidebar />
      <main className="relative md:pl-16">
        {isFullWidthPage ? (
          <Outlet />
        ) : (
          <PageContainer className="pt-10 pb-16 md:pb-12">
            <Outlet />
          </PageContainer>
        )}
      </main>
      <StatusBar />
      <div className="md:hidden">
        <BottomNav />
      </div>
      <FloatingActionButton />
    </div>
  );
}
