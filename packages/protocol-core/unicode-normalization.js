import { assertUnicodeScalarString } from "./bytes.js";
import {
  UNICODE_CANONICAL_COMPOSITION_ENTRIES,
  UNICODE_COMBINING_CLASS_ENTRIES,
  UNICODE_COMPATIBILITY_DECOMPOSITION_ENTRIES,
  UNICODE_NORMALIZATION_VERSION,
} from "./unicode-normalization-data.js";

export { UNICODE_NORMALIZATION_VERSION };

const combiningClasses = new Map(UNICODE_COMBINING_CLASS_ENTRIES);
const compatibilityDecompositions = new Map(UNICODE_COMPATIBILITY_DECOMPOSITION_ENTRIES);
const compositionKey = (starter, codePoint) => starter * 0x11_0000 + codePoint;
const canonicalCompositions = new Map(
  UNICODE_CANONICAL_COMPOSITION_ENTRIES.map(([starter, codePoint, composite]) => [
    compositionKey(starter, codePoint),
    composite,
  ]),
);

const HANGUL_S_BASE = 0xac00;
const HANGUL_L_BASE = 0x1100;
const HANGUL_V_BASE = 0x1161;
const HANGUL_T_BASE = 0x11a7;
const HANGUL_L_COUNT = 19;
const HANGUL_V_COUNT = 21;
const HANGUL_T_COUNT = 28;
const HANGUL_N_COUNT = HANGUL_V_COUNT * HANGUL_T_COUNT;
const HANGUL_S_COUNT = HANGUL_L_COUNT * HANGUL_N_COUNT;

function compatibilityDecompose(codePoint, output) {
  const hangulIndex = codePoint - HANGUL_S_BASE;
  if (hangulIndex >= 0 && hangulIndex < HANGUL_S_COUNT) {
    output.push(HANGUL_L_BASE + Math.floor(hangulIndex / HANGUL_N_COUNT));
    output.push(HANGUL_V_BASE + Math.floor((hangulIndex % HANGUL_N_COUNT) / HANGUL_T_COUNT));
    const trailingIndex = hangulIndex % HANGUL_T_COUNT;
    if (trailingIndex !== 0) output.push(HANGUL_T_BASE + trailingIndex);
    return;
  }

  const mapping = compatibilityDecompositions.get(codePoint);
  if (!mapping) {
    output.push(codePoint);
    return;
  }
  for (const mappedCodePoint of mapping) compatibilityDecompose(mappedCodePoint, output);
}

function canonicalOrder(codePoints) {
  // UAX #15 canonical ordering is a stable insertion sort within each run of
  // non-starters. Identity inputs are small, and this form makes the blocking
  // rule explicit without relying on a host engine's Unicode tables or sort.
  for (let index = 1; index < codePoints.length; index += 1) {
    const currentClass = combiningClasses.get(codePoints[index]) ?? 0;
    if (currentClass === 0) continue;
    let insertionIndex = index;
    while (insertionIndex > 0) {
      const previousClass = combiningClasses.get(codePoints[insertionIndex - 1]) ?? 0;
      if (previousClass === 0 || previousClass <= currentClass) break;
      const previous = codePoints[insertionIndex - 1];
      codePoints[insertionIndex - 1] = codePoints[insertionIndex];
      codePoints[insertionIndex] = previous;
      insertionIndex -= 1;
    }
  }
  return codePoints;
}

function composeHangul(starter, codePoint) {
  const leadingIndex = starter - HANGUL_L_BASE;
  const vowelIndex = codePoint - HANGUL_V_BASE;
  if (
    leadingIndex >= 0 &&
    leadingIndex < HANGUL_L_COUNT &&
    vowelIndex >= 0 &&
    vowelIndex < HANGUL_V_COUNT
  ) {
    return HANGUL_S_BASE + (leadingIndex * HANGUL_V_COUNT + vowelIndex) * HANGUL_T_COUNT;
  }

  const syllableIndex = starter - HANGUL_S_BASE;
  const trailingIndex = codePoint - HANGUL_T_BASE;
  if (
    syllableIndex >= 0 &&
    syllableIndex < HANGUL_S_COUNT &&
    syllableIndex % HANGUL_T_COUNT === 0 &&
    trailingIndex > 0 &&
    trailingIndex < HANGUL_T_COUNT
  ) {
    return starter + trailingIndex;
  }
  return undefined;
}

function canonicalCompose(codePoints) {
  if (codePoints.length === 0) return codePoints;
  const output = [codePoints[0]];
  let starterPosition = 0;
  let starter = codePoints[0];
  let lastClass = combiningClasses.get(starter) ?? 0;

  for (let index = 1; index < codePoints.length; index += 1) {
    const codePoint = codePoints[index];
    const currentClass = combiningClasses.get(codePoint) ?? 0;
    const composite =
      composeHangul(starter, codePoint) ??
      canonicalCompositions.get(compositionKey(starter, codePoint));
    if (composite !== undefined && (lastClass === 0 || lastClass < currentClass)) {
      output[starterPosition] = composite;
      starter = composite;
      continue;
    }

    if (currentClass === 0) {
      starterPosition = output.length;
      starter = codePoint;
    }
    output.push(codePoint);
    lastClass = currentClass;
  }
  return output;
}

function codePointsToString(codePoints) {
  let output = "";
  // Avoid engine argument-count limits for a deliberately long passphrase.
  for (let offset = 0; offset < codePoints.length; offset += 4096) {
    output += String.fromCodePoint(...codePoints.slice(offset, offset + 4096));
  }
  return output;
}

function compatibilityDecomposeAndOrder(value, label) {
  assertUnicodeScalarString(value, label);
  const decomposed = [];
  for (const symbol of value) compatibilityDecompose(symbol.codePointAt(0), decomposed);
  return canonicalOrder(decomposed);
}

/** Unicode 17.0.0 NFKD independent of the host JavaScript/ICU version. */
export function normalizeUnicodeNfkd(value, label = "string") {
  return codePointsToString(compatibilityDecomposeAndOrder(value, label));
}

/** Unicode 17.0.0 NFKC independent of the host JavaScript/ICU version. */
export function normalizeUnicodeNfkc(value, label = "string") {
  return codePointsToString(canonicalCompose(compatibilityDecomposeAndOrder(value, label)));
}
