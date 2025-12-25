// Home page style constants - Optimized for Light, Airy, Vibrant aesthetic

export const HERO_STYLES = {
  section:
    "relative min-h-[calc(100vh-64px)] w-full overflow-hidden bg-white flex items-center justify-center",
  container: "relative text-center z-10 w-full",
  // Subtle grid pattern for texture
  backgroundOverlay:
    "absolute inset-0 w-full h-full bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none",
  gradientOverlay: "hidden", // Removed heavy overlay to keep it clean
} as const;

// Floating shape styles - Soft, Large, Colorful Blurs
export const FLOATING_SHAPES = [
  {
    // Left: Soft Blue/Cyan
    className:
      "absolute top-1/2 left-0 w-[800px] h-[800px] bg-blue-100/80 rounded-full blur-[120px] -translate-x-1/4 -translate-y-1/2 mix-blend-multiply animate-float pointer-events-none",
  },
  {
    // Right: Soft Pink/Orange
    className:
      "absolute top-1/2 right-0 w-[800px] h-[800px] bg-orange-100/80 rounded-full blur-[120px] translate-x-1/4 -translate-y-1/2 mix-blend-multiply animate-float animation-delay-2000 pointer-events-none",
  },
  {
    // Center/Bottom: Very subtle purple for depth
    className:
      "absolute bottom-0 left-1/2 w-[600px] h-[400px] bg-purple-100/50 rounded-full blur-[100px] -translate-x-1/2 translate-y-1/4 mix-blend-multiply animate-pulse-soft pointer-events-none",
  },
] as const;

// Tag strip styles - Clean & Minimal
export const TAG_STRIP_STYLES = {
  container: "animate-fade-in-up animation-delay-500 mt-16 mb-12",
  wrapper: "flex flex-wrap items-center justify-center gap-3 max-w-4xl mx-auto px-4",
  tagBase:
    "flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-slate-200 shadow-sm transition-all hover:scale-105 hover:shadow-md cursor-default",
  dotBase: "w-1.5 h-1.5 rounded-full animate-pulse",
  text: "text-xs font-semibold text-slate-600 tracking-wide uppercase",
} as const;

// CTA button styles - Vibrant & High Contrast
export const CTA_BUTTON_STYLES = {
  container:
    "animate-fade-in-up animation-delay-400 flex flex-col sm:flex-row items-center justify-center gap-5 px-4",
  // Primary: Orange/Red Gradient
  primaryButton:
    "group relative inline-flex items-center justify-center px-10 py-4 rounded-full bg-gradient-to-r from-orange-400 to-red-500 text-white font-bold text-base hover:shadow-lg hover:shadow-orange-500/25 hover:scale-105 transition-all duration-300 overflow-hidden",
  // Secondary: Clean White/Gray
  secondaryButton:
    "group inline-flex items-center justify-center px-10 py-4 rounded-full bg-white text-slate-600 font-bold text-base border border-slate-200 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 transition-all duration-300 shadow-sm hover:shadow-md",
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
    "inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-50 border border-slate-200 mb-8 text-slate-600 shadow-sm",
  badgeIcon: "w-3.5 h-3.5 text-orange-500",
  badgeText: "text-xs font-bold tracking-wider uppercase",
  title:
    "text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight text-slate-900 mb-8 max-w-5xl mx-auto leading-[1.1] drop-shadow-sm",
  titleGradient: "", // Removed gradient text for pure black elegance
  subtitle:
    "text-xl sm:text-2xl text-slate-500 max-w-3xl mx-auto mb-12 leading-relaxed font-normal",
} as const;

// Scroll indicator styles
export const SCROLL_INDICATOR_STYLES = {
  container:
    "absolute bottom-10 left-1/2 transform -translate-x-1/2 cursor-pointer z-20 opacity-40 hover:opacity-100 transition-opacity",
  icon: "w-8 h-8 text-slate-400 animate-bounce-gentle",
} as const;

// Tag data - Updated colors to match light theme
export const TAG_DATA = [
  {
    key: "protocol",
    color: "blue",
    borderClass: "border-blue-100",
    dotClass: "bg-blue-500",
  },
  {
    key: "incentive",
    color: "orange",
    borderClass: "border-orange-100",
    dotClass: "bg-orange-500",
  },
  {
    key: "nft",
    color: "purple",
    borderClass: "border-purple-100",
    dotClass: "bg-purple-500",
  },
  {
    key: "zk",
    color: "emerald",
    borderClass: "border-emerald-100",
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
