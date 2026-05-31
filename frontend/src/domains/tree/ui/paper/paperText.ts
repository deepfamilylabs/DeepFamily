import type { PaperGeneration, TranslateFn } from "./paperData";

export function clipText(value: string | undefined, max = 18): string {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
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
