import type { CSSProperties } from "react";

export const PAPER_BODY_FONT_STACK =
  '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", "SimSun", "PMingLiU", Georgia, serif';
export const PAPER_TITLE_FONT_STACK =
  '"STKaiti", "KaiTi", "Kaiti SC", "Songti SC", "STSong", "Noto Serif CJK SC", serif';
export const PAPER_NOTE_FONT_STACK =
  '"FangSong", "STFangsong", "FangSong_GB2312", "Songti SC", "SimSun", serif';

export const PAPER_VARS = {
  "--df-paper-bg": "#e6d6ad",
  "--df-paper-sheet": "#f7efd8",
  "--df-paper-panel": "#fbf6e8",
  "--df-paper-line": "#8a6a3b",
  "--df-paper-line-soft": "rgba(138, 106, 59, 0.32)",
  "--df-paper-ink": "#332414",
  "--df-paper-muted": "#755f3c",
  "--df-paper-red": "#9b2f25",
} as CSSProperties;

export const PAPER_SHEET_STYLE: CSSProperties = {
  backgroundColor: "var(--df-paper-sheet)",
  backgroundImage:
    "linear-gradient(90deg, rgba(138, 106, 59, 0.045) 1px, transparent 1px), linear-gradient(0deg, rgba(138, 106, 59, 0.035) 1px, transparent 1px)",
  backgroundSize: "28px 28px",
};
