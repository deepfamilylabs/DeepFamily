import type { PaperGeneration, TranslateFn } from "./paperData";

export function clipText(value: string | undefined, max = 18): string {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

// Full-width glyphs (CJK ideographs/punctuation, full-width forms, Hangul, kana) advance ~1em
// in the paper body fonts; everything else (ASCII letters/digits/punctuation, spaces) ~0.5em.
// Measuring record text in half-em "units" (full-width = 2, half-width = 1) lets a fixed budget
// fill the same visual extent regardless of how digit-heavy the text is.
const PAPER_FULL_WIDTH_PATTERN =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

export function charVisualUnits(char: string): number {
  return PAPER_FULL_WIDTH_PATTERN.test(char) ? 2 : 1;
}

export function measureRecordUnits(text: string): number {
  let units = 0;
  for (const char of text) units += charVisualUnits(char);
  return units;
}

// Pack characters into chunks until each reaches the visual-width budget, so a record only
// spills into a continuation cell/lane once the current one is visually full. Text is preserved
// exactly (chunks join back to the input) so callers can reconstruct the full record.
export function splitTextByVisualUnits(text: string, maxUnits: number): string[] {
  if (measureRecordUnits(text) <= maxUnits) return [text];

  const chunks: string[] = [];
  let current = "";
  let currentUnits = 0;
  for (const char of text) {
    const charUnits = charVisualUnits(char);
    if (current && currentUnits + charUnits > maxUnits) {
      chunks.push(current);
      current = "";
      currentUnits = 0;
    }
    current += char;
    currentUnits += charUnits;
  }
  if (current) chunks.push(current);

  return chunks;
}

function getChineseSurname(value: string | undefined): string | null {
  const first = Array.from((value || "").trim())[0];
  return first && /\p{Script=Han}/u.test(first) ? first : null;
}

export function getPaperSpineTitle(generations: PaperGeneration[], t: TranslateFn): string {
  const root = generations[0]?.people[0]?.ui;
  const surname = getChineseSurname(root?.fullName || root?.titleText);
  return surname
    ? t("genealogyBook.ouSpineTitleWithSurname", "{{surname}}氏族谱", { surname })
    : t("genealogyBook.ouSpineTitle", "Genealogy");
}
