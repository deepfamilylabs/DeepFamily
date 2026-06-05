import type { PaperGeneration, PaperPerson, TranslateFn } from "./paperData";

export function clipText(value: string | undefined, max = 18): string {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

export function toChineseNumeral(value: number): string {
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value <= 0 || value >= 100) return String(value);
  if (value < 10) return digits[value];
  if (value === 10) return "十";
  if (value < 20) return `十${digits[value % 10]}`;
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${digits[tens]}十${ones ? digits[ones] : ""}`;
}

export function getPaperGenerationMark(depth: number, t: TranslateFn): string {
  return t("genealogyBook.generationMark", "{{han}}世", {
    han: toChineseNumeral(depth + 1),
    number: depth + 1,
  });
}

// A person-like shape carrying just the fields needed to derive a relation label, so the
// helpers work for PaperPerson as well as the per-style node/entry types (Pagoda, Lineage).
type RelationSource = Pick<PaperPerson, "relation" | "nodeData" | "ui">;

// Birth-rank word following the traditional rule: a sole same-gender child is 之子/之女, while
// two or more are 长子/次子/三子… (and 长女/次女…). Returns "" for the root, non-children, or
// children whose gender is unknown (those stay unlabeled).
export function getChildRankWord(person: RelationSource, t: TranslateFn): string {
  if (person.relation?.kind !== "child") return "";
  const gender = person.nodeData?.gender ?? person.ui.gender;
  if (gender !== 1 && gender !== 2) return "";

  const { siblingIndex, siblingCount } = person.relation;
  const number = siblingIndex + 1;
  const han = toChineseNumeral(number);
  if (gender === 2) {
    if (siblingCount === 1) return t("genealogyBook.onlyDaughter", "之女");
    if (number === 1) return t("genealogyBook.firstDaughter", "长女");
    if (number === 2) return t("genealogyBook.secondDaughter", "次女");
    return t("genealogyBook.nthDaughter", "{{han}}女", { han, number });
  }
  if (siblingCount === 1) return t("genealogyBook.onlySon", "之子");
  if (number === 1) return t("genealogyBook.firstSon", "长子");
  if (number === 2) return t("genealogyBook.secondSon", "次子");
  return t("genealogyBook.nthSon", "{{han}}子", { han, number });
}

// Full relation label: 始祖 for the root, otherwise the rank word optionally prefixed with the
// (clipped) father's name — e.g. "曹操长子" or, with separator "\n", a two-line "曹操\n长子".
export function getPaperRelationLabel(
  person: RelationSource,
  t: TranslateFn,
  opts?: { withParentName?: boolean; separator?: string; parentNameMax?: number },
): string {
  if (person.relation?.kind === "root") return t("genealogyBook.rootLabel", "ancestor");
  const rank = getChildRankWord(person, t);
  if (!rank) return "";

  const parentName =
    opts?.withParentName && person.relation?.kind === "child"
      ? clipText(person.relation.parentName, opts.parentNameMax ?? 4)
      : "";
  return parentName ? `${parentName}${opts?.separator ?? ""}${rank}` : rank;
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

export function getPaperSpineVolumeLabel(chartIndex: number, t: TranslateFn): string {
  return t("genealogyBook.spineVolumeLabel", "卷{{han}}", {
    number: chartIndex,
    han: toChineseNumeral(chartIndex),
  });
}

export function getPaperSpinePageLabel(pageNumber: number, t: TranslateFn): string {
  return t("genealogyBook.spinePageNumber", "{{han}}", {
    number: pageNumber,
    han: toChineseNumeral(pageNumber),
  });
}
