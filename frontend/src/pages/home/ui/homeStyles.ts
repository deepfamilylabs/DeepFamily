// Home page style constants.
//
// Colours go through the app's semantic tokens (surface / ink / hairline /
// primary, see index.css) so the landing page follows the theme like every
// other page. Only the hero's decorative glows carry explicit dark variants —
// they are literal rgba washes with no token equivalent.

export const HERO_STYLES = {
  section:
    "relative min-h-[calc(100vh-64px)] w-full overflow-hidden bg-surface flex items-center justify-center",
  container: "relative text-center z-10 w-full",
  // Subtle grid pattern for texture
  backgroundOverlay:
    "absolute inset-0 w-full h-full bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#94a3b814_1px,transparent_1px),linear-gradient(to_bottom,#94a3b814_1px,transparent_1px)] bg-size-[24px_24px] mask-[radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none",
  gradientOverlay: "hidden", // Removed heavy overlay to keep it clean
} as const;

// Floating shape styles - Using radial-gradient for optimal performance
// Gradients are GPU-friendly and produce similar soft glow effects as blur
export const FLOATING_SHAPES = [
  {
    // Left: Soft Blue/Cyan glow
    className:
      "absolute top-1/2 left-0 w-[800px] h-[800px] bg-[radial-gradient(circle,rgba(219,234,254,0.8)_0%,rgba(219,234,254,0.4)_30%,transparent_70%)] dark:bg-[radial-gradient(circle,rgba(37,99,235,0.20)_0%,rgba(37,99,235,0.10)_30%,transparent_70%)] -translate-x-1/4 -translate-y-1/2 animate-float pointer-events-none will-change-transform",
  },
  {
    // Right: Soft Orange/Pink glow
    className:
      "absolute top-1/2 right-0 w-[800px] h-[800px] bg-[radial-gradient(circle,rgba(255,237,213,0.8)_0%,rgba(255,237,213,0.4)_30%,transparent_70%)] dark:bg-[radial-gradient(circle,rgba(249,115,22,0.18)_0%,rgba(249,115,22,0.08)_30%,transparent_70%)] translate-x-1/4 -translate-y-1/2 animate-float animation-delay-2000 pointer-events-none will-change-transform",
  },
  {
    // Center/Bottom: Subtle purple glow for depth
    className:
      "absolute bottom-0 left-1/2 w-[600px] h-[400px] bg-[radial-gradient(ellipse,rgba(233,213,255,0.5)_0%,rgba(233,213,255,0.2)_40%,transparent_70%)] dark:bg-[radial-gradient(ellipse,rgba(147,51,234,0.16)_0%,rgba(147,51,234,0.07)_40%,transparent_70%)] -translate-x-1/2 translate-y-1/4 animate-pulse-soft pointer-events-none will-change-transform",
  },
] as const;

// Tag strip styles - Clean & Minimal
export const TAG_STRIP_STYLES = {
  container: "animate-fade-in-up animation-delay-500 mt-16 mb-12",
  wrapper: "flex flex-wrap items-center justify-center gap-3 max-w-4xl mx-auto px-4",
  tagBase:
    "flex items-center gap-2 px-4 py-2 rounded-full bg-surface border border-hairline shadow-xs transition-all hover:scale-105 hover:shadow-md cursor-default",
  dotBase: "w-1.5 h-1.5 rounded-full animate-pulse",
  text: "text-xs font-semibold text-ink-muted tracking-wide uppercase",
} as const;

// CTA button styles - Vibrant & High Contrast
export const CTA_BUTTON_STYLES = {
  container:
    "animate-fade-in-up animation-delay-400 flex flex-col sm:flex-row items-center justify-center gap-5 px-4",
  // Primary: Orange/Red Gradient
  primaryButton:
    "group relative inline-flex items-center justify-center px-10 py-4 rounded-full bg-linear-to-r from-orange-400 to-red-500 text-white font-bold text-base hover:shadow-lg hover:shadow-orange-500/25 hover:scale-105 transition-all duration-300 overflow-hidden",
  // Secondary: Clean White/Gray
  secondaryButton:
    "group inline-flex items-center justify-center px-10 py-4 rounded-full bg-surface text-ink-muted font-bold text-base border border-hairline hover:bg-surface-alt hover:border-hairline-strong hover:text-ink transition-all duration-300 shadow-xs hover:shadow-md",
  blueSecondary: "",
  greenSecondary: "",
  overlay:
    "absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300",
  content: "relative flex items-center gap-2",
  text: "",
} as const;

// Hero content styles - High Key Typography
export const HERO_CONTENT_STYLES = {
  badge:
    "inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-surface-alt border border-hairline mb-8 text-ink-muted shadow-xs",
  badgeIcon: "w-3.5 h-3.5 text-orange-500",
  badgeText: "text-xs font-bold tracking-wider uppercase",
  title:
    "text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight text-ink mb-8 max-w-5xl mx-auto leading-[1.1] drop-shadow-xs",
  titleGradient: "", // Removed gradient text for pure black elegance
  subtitle:
    "text-xl sm:text-2xl text-ink-muted max-w-3xl mx-auto mb-12 leading-relaxed font-normal",
} as const;

// Scroll indicator styles
export const SCROLL_INDICATOR_STYLES = {
  container:
    "absolute bottom-10 left-1/2 transform -translate-x-1/2 cursor-pointer z-20 opacity-40 hover:opacity-100 transition-opacity",
  icon: "w-8 h-8 text-ink-subtle animate-bounce-gentle",
} as const;

// Tag data - Updated colors to match light theme
export const TAG_DATA = [
  {
    key: "protocol",
    color: "blue",
    borderClass: "border-blue-500/20",
    dotClass: "bg-blue-500",
  },
  {
    key: "incentive",
    color: "orange",
    borderClass: "border-orange-500/20",
    dotClass: "bg-orange-500",
  },
  {
    key: "nft",
    color: "purple",
    borderClass: "border-purple-500/20",
    dotClass: "bg-purple-500",
  },
  {
    key: "zk",
    color: "emerald",
    borderClass: "border-emerald-500/20",
    dotClass: "bg-emerald-500",
  },
] as const;

// Button configuration type
export interface ButtonConfig {
  to: string;
  icon: "Users" | "Network" | "Search";
  text: string;
  className: string;
  hasOverlay: boolean;
}
