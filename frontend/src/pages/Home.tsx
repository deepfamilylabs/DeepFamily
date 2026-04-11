import { memo, useEffect, useState, lazy, Suspense, useCallback } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Sparkles, ChevronDown } from "lucide-react";
import LoadingFallback from "./home/ui/LoadingFallback";
import { useActivePath } from "../app/context";
import {
  HERO_STYLES as HERO_STYLE_CONSTANTS,
  FLOATING_SHAPES as FLOATING_SHAPE_CONSTANTS,
  CTA_BUTTON_STYLES,
  HERO_CONTENT_STYLES,
  SCROLL_INDICATOR_STYLES,
} from "../constants/homeStyles";
import { ANIMATION_CLASSES } from "../constants/animationStyles";

// Lazy loaded components
const ValuePropositions = lazy(() => import("./home/ui/ValuePropositions"));
const TwoLayerValueSystem = lazy(() => import("./home/ui/TwoLayerValueSystem"));
const WorkflowSection = lazy(() => import("./home/ui/WorkflowSection"));
const CoreFeatures = lazy(() => import("./home/ui/CoreFeatures"));
const Tokenomics = lazy(() => import("./home/ui/Tokenomics"));
const Audience = lazy(() => import("./home/ui/Audience"));
const CallToAction = lazy(() => import("./home/ui/CallToAction"));

// Floating shapes component - uses CSS gradients for optimal performance
const FloatingShapes = memo(() => (
  <div className="absolute inset-0 w-full h-full pointer-events-none">
    {FLOATING_SHAPE_CONSTANTS.map((shape, index) => (
      <div key={index} className={shape.className} />
    ))}
  </div>
));

// Scroll indicator component - using direct import for performance
const ScrollIndicator = memo(() => {
  const handleScroll = useCallback(() => {
    window.scrollTo({
      top: window.innerHeight,
      behavior: "smooth",
    });
  }, []);

  return (
    <div className={SCROLL_INDICATOR_STYLES.container} onClick={handleScroll}>
      <ChevronDown className={SCROLL_INDICATOR_STYLES.icon} />
    </div>
  );
});

// CTA buttons component
const CTAButtons = memo(() => {
  const { t } = useTranslation();
  const { setActivePath } = useActivePath();

  return (
    <div className={CTA_BUTTON_STYLES.container}>
      <NavLink
        to="/familyTree"
        onClick={() => setActivePath("/familyTree")}
        className="relative inline-flex h-14 overflow-hidden rounded-full p-[2px] focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-50 hover:scale-105 transition-transform duration-300"
      >
        <span className="absolute inset-[-1000%] animate-[spin_2s_linear_infinite] bg-[conic-gradient(from_90deg_at_50%_50%,#ffffff_0%,#ff9e64_50%,#ffffff_100%)]" />
        <span className="relative z-10 inline-flex h-full w-full cursor-pointer items-center justify-center rounded-full bg-gradient-to-r from-orange-400 to-red-500 px-10 py-1 text-base font-bold text-white transition-opacity hover:opacity-90">
          {t("home.getStarted")}
        </span>
      </NavLink>
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

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      setShowFloatingShapes(true);
    });
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  return (
    <>
      {/* Hero Section - Full Width */}
      <section className={HERO_STYLE_CONSTANTS.section}>
        <div className={HERO_STYLE_CONSTANTS.backgroundOverlay} />

        {/* Floating background shapes - uses CSS gradients for performance */}
        {showFloatingShapes && <FloatingShapes />}

        {/* Gradient overlay for depth */}
        <div className={HERO_STYLE_CONSTANTS.gradientOverlay} />

        <div className="relative text-center w-full">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Enhanced Main Title with animations */}
            <div className={ANIMATION_CLASSES.FADE_IN_UP}>
              <div className={HERO_CONTENT_STYLES.badge}>
                <Sparkles className={HERO_CONTENT_STYLES.badgeIcon} />
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

      {/* Content */}
      {HOME_SECTIONS.map((section) => (
        <section key={section.key}>{section.render()}</section>
      ))}
    </>
  );
}
