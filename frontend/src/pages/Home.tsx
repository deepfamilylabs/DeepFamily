import { memo, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DynamicIcon } from "../components/home/DynamicIcon";
import LoadingFallback from "../components/home/LoadingFallback";
import { useActivePath } from "../context/ActivePathContext";
import {
  HERO_STYLES as HERO_STYLE_CONSTANTS,
  FLOATING_SHAPES as FLOATING_SHAPE_CONSTANTS,
  CTA_BUTTON_STYLES,
  HERO_CONTENT_STYLES,
  SCROLL_INDICATOR_STYLES,
  type ButtonConfig,
} from "../constants/homeStyles";
import { ANIMATION_CLASSES } from "../constants/animationStyles";

// Lazy loaded components
const ValuePropositions = lazy(() => import("../components/home/ValuePropositions"));
const TwoLayerValueSystem = lazy(() => import("../components/home/TwoLayerValueSystem"));
const WorkflowSection = lazy(() => import("../components/WorkflowSection"));
const CoreFeatures = lazy(() => import("../components/home/CoreFeatures"));
const Tokenomics = lazy(() => import("../components/home/Tokenomics"));
const Audience = lazy(() => import("../components/home/Audience"));
const CallToAction = lazy(() => import("../components/home/CallToAction"));

// Floating shapes component
const FloatingShapes = memo(() => (
  <div className="absolute inset-0 w-full h-full pointer-events-none">
    {FLOATING_SHAPE_CONSTANTS.map((shape, index) => (
      <div key={index} className={shape.className} />
    ))}
  </div>
));

// Scroll indicator component
const ScrollIndicator = memo(() => {
  const handleScroll = () => {
    window.scrollTo({
      top: window.innerHeight,
      behavior: "smooth",
    });
  };

  return (
    <div className={SCROLL_INDICATOR_STYLES.container} onClick={handleScroll}>
      <DynamicIcon name="ChevronDown" className={SCROLL_INDICATOR_STYLES.icon} />
    </div>
  );
});

// CTA buttons component
const CTAButtons = memo(() => {
  const { t } = useTranslation();
  const { setActivePath } = useActivePath();

  const buttons = useMemo(
    (): ButtonConfig[] => [
      {
        to: "/actions",
        icon: "Users",
        text: t("home.blockchainActions"),
        className: CTA_BUTTON_STYLES.primaryButton,
        hasOverlay: true,
      },
      {
        to: "/familyTree",
        icon: "Network",
        text: t("home.exploreFamilyTree"),
        className: `${CTA_BUTTON_STYLES.secondaryButton} ${CTA_BUTTON_STYLES.blueSecondary}`,
        hasOverlay: false,
      },
    ],
    [t],
  );

  return (
    <div className={CTA_BUTTON_STYLES.container}>
      {buttons.map((button) => (
        <NavLink
          key={button.to}
          to={button.to}
          className={button.className}
          onClick={() => setActivePath(button.to)}
        >
          {button.hasOverlay && <div className={CTA_BUTTON_STYLES.overlay} />}
          <div className={CTA_BUTTON_STYLES.content}>
            <span className={CTA_BUTTON_STYLES.text}>{button.text}</span>
          </div>
        </NavLink>
      ))}
    </div>
  );
});

type HomeSection = {
  key: string;
  render: () => JSX.Element;
};

const HOME_SECTIONS: HomeSection[] = [
  {
    key: "value-propositions",
    render: () => (
      <Suspense fallback={<LoadingFallback />}>
        <ValuePropositions />
      </Suspense>
    ),
  },
  {
    key: "two-layer-value-system",
    render: () => (
      <Suspense fallback={<LoadingFallback />}>
        <TwoLayerValueSystem />
      </Suspense>
    ),
  },
  {
    key: "workflow-section",
    render: () => (
      <Suspense fallback={<LoadingFallback variant="banner" />}>
        <WorkflowSection />
      </Suspense>
    ),
  },
  {
    key: "core-features",
    render: () => (
      <Suspense fallback={<LoadingFallback />}>
        <CoreFeatures />
      </Suspense>
    ),
  },
  {
    key: "tokenomics",
    render: () => (
      <Suspense fallback={<LoadingFallback />}>
        <Tokenomics />
      </Suspense>
    ),
  },
  {
    key: "audience",
    render: () => (
      <Suspense fallback={<LoadingFallback />}>
        <Audience />
      </Suspense>
    ),
  },
  {
    key: "call-to-action",
    render: () => (
      <Suspense fallback={<LoadingFallback variant="banner" />}>
        <CallToAction />
      </Suspense>
    ),
  },
];

export default function Home() {
  const { t } = useTranslation();
  const [showFloatingShapes, setShowFloatingShapes] = useState(false);
  const [hasUserScrolled, setHasUserScrolled] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const lastLoadAtRef = useRef<number>(0);

  const sectionsPerPage = 1;
  const maxPages = Math.max(1, Math.ceil(HOME_SECTIONS.length / sectionsPerPage));
  const visibleCount = Math.min(HOME_SECTIONS.length, pageCount * sectionsPerPage);

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      setShowFloatingShapes(true);
      setPageCount(1);
    });
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      if (window.scrollY > 0) setHasUserScrolled(true);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target) return;
    if (!hasUserScrolled) return;
    if (!("IntersectionObserver" in window)) return;
    if (pageCount >= maxPages) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        const now = performance.now();
        if (now - lastLoadAtRef.current < 500) return;
        lastLoadAtRef.current = now;
        setPageCount((count) => Math.min(maxPages, count + 1));
      },
      { rootMargin: "800px 0px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasUserScrolled, maxPages, pageCount]);

  return (
    <>
      {/* Hero Section - Full Width */}
      <section className={HERO_STYLE_CONSTANTS.section}>
        <div className={HERO_STYLE_CONSTANTS.backgroundOverlay} />

        {/* Floating background shapes with animations (deferred to improve first paint) */}
        {showFloatingShapes && <FloatingShapes />}

        {/* Gradient overlay for depth */}
        <div className={HERO_STYLE_CONSTANTS.gradientOverlay} />

        <div className="relative text-center w-full">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Enhanced Main Title with animations */}
            <div className={ANIMATION_CLASSES.FADE_IN_UP}>
              <div className={HERO_CONTENT_STYLES.badge}>
                <DynamicIcon name="Sparkles" className={HERO_CONTENT_STYLES.badgeIcon} />
                <span className={HERO_CONTENT_STYLES.badgeText}>Digital Legacy</span>
              </div>

              <h1 className={HERO_CONTENT_STYLES.title}>
                <span className={HERO_CONTENT_STYLES.titleGradient}>{t("home.title")}</span>
              </h1>
            </div>

            {/* Enhanced Subtitle */}
            <div className={`${ANIMATION_CLASSES.FADE_IN_UP} ${ANIMATION_CLASSES.DELAY_200}`}>
              <p className={HERO_CONTENT_STYLES.subtitle}>{t("home.subtitle")}</p>
            </div>

            {/* Enhanced CTA Buttons */}
            <CTAButtons />
          </div>
        </div>

        {/* Scroll Indicator */}
        <ScrollIndicator />
      </section>

      {/* Content (progressive mount on scroll) */}
      {HOME_SECTIONS.slice(0, visibleCount).map((section) => (
        <section key={section.key}>{section.render()}</section>
      ))}

      {visibleCount < HOME_SECTIONS.length && (
        <div className="py-16 bg-white dark:bg-slate-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div ref={loadMoreRef} className="h-1 w-full" />
            {!hasUserScrolled ? (
              <div className="text-center text-slate-500 dark:text-slate-400 text-sm">
                Scroll to load more
              </div>
            ) : (
              <div className="text-center text-slate-500 dark:text-slate-400 text-sm animate-pulse">
                {t("common.loadingMore")}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
