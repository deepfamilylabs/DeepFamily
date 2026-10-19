import { formatUnits } from "ethers";

/**
 * Display amounts group the integer part and drop trailing fraction zeros.
 * Inputs and Worker requests keep raw decimal strings.
 */
export function formatShieldedAmount(value: bigint | string, decimals: number): string {
  const text = formatUnits(BigInt(value), decimals);
  const negative = text.startsWith("-");
  const [integer, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = fraction.replace(/0+$/, "");
  return `${negative ? "-" : ""}${grouped}${trimmed ? `.${trimmed}` : ""}`;
}

/** Avatar text: the last two characters of a Han name, otherwise initials of the outer words. */
export function getShieldedAvatarText(fullName: string): string {
  const name = fullName.trim();
  if (!name) return "";
  if (/\p{Script=Han}/u.test(name)) return Array.from(name.replace(/\s+/g, "")).slice(-2).join("");
  const words = name.split(/\s+/);
  const outer = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0]];
  return outer.map((word) => (Array.from(word)[0] ?? "").toLocaleUpperCase()).join("");
}
