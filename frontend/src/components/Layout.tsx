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
import PageContainer from "./PageContainer";
import SiteHeader from "./SiteHeader";
import FloatingActionButton from "./FloatingActionButton";
import SiteFooter from "./SiteFooter";
import GlobalSidebar from "./GlobalSidebar";
import { useSidebar } from "../context/SidebarContext";

export default function Layout() {
  const location = useLocation();
  const { activeSection } = useSidebar();
  const isHomePage = location.pathname === "/";
  const isPeoplePage = location.pathname === "/people";
  const isTreePage = location.pathname === "/familyTree";
  const isFullWidthPage = isHomePage || isPeoplePage || isTreePage;

  // Dynamic background based on page type
  const bgClass = isPeoplePage || isTreePage
    ? "bg-white dark:bg-black" // PeoplePage and TreePage handle their own background
    : "bg-gradient-to-b from-sky-50 to-white dark:from-gray-950 dark:to-gray-900";

  // Desktop padding logic:
  // Base strip width: w-16 (4rem) -> pl-16
  // Expanded width: w-16 + w-80 (20rem) = 24rem -> pl-96
  const desktopPadding = activeSection ? 'md:pl-96' : 'md:pl-16';

  return (
    <div className={`${bgClass} min-h-screen transition-colors duration-300`}>
      <SiteHeader />
      <GlobalSidebar />
      <main className={`relative transition-all duration-300 ${desktopPadding}`}>
        {isFullWidthPage ? (
          <Outlet />
        ) : (
          <PageContainer className="pt-10 pb-16 md:pb-6">
            <Outlet />
          </PageContainer>
        )}
      </main>
      {isHomePage && <SiteFooter />}
      <div className="md:hidden">
        <BottomNav />
      </div>
      <FloatingActionButton />
    </div>
  );
}
