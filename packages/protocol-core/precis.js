import { assertUnicodeScalarString } from "./bytes.js";
import { ProtocolError } from "./errors.js";
import {
  PRECIS_UNICODE_VERSION,
  UNICODE_FREEFORM_CONTEXTJ_CODE_POINTS,
  UNICODE_FREEFORM_CONTEXTO_CODE_POINTS,
  UNICODE_FREEFORM_PVALID_RANGES,
  UNICODE_JOINING_TYPE_RANGES,
  UNICODE_SCRIPT_GREEK_RANGES,
  UNICODE_SCRIPT_HAN_RANGES,
  UNICODE_SCRIPT_HEBREW_RANGES,
  UNICODE_SCRIPT_HIRAGANA_RANGES,
  UNICODE_SCRIPT_KATAKANA_RANGES,
} from "./precis-data.js";
import { canonicalCombiningClass } from "./unicode-normalization.js";

export { PRECIS_UNICODE_VERSION };

const VIRAMA_COMBINING_CLASS = 9;
const LATIN_SMALL_LETTER_L = 0x006c;
const ZERO_WIDTH_NON_JOINER = 0x200c;
const ZERO_WIDTH_JOINER = 0x200d;
const GREEK_LOWER_NUMERAL_SIGN = 0x0375;
const HEBREW_GERESH = 0x05f3;
const HEBREW_GERSHAYIM = 0x05f4;
const MIDDLE_DOT = 0x00b7;
const KATAKANA_MIDDLE_DOT = 0x30fb;
const ARABIC_INDIC_DIGITS = Object.freeze([0x0660, 0x0669]);
const EXTENDED_ARABIC_INDIC_DIGITS = Object.freeze([0x06f0, 0x06f9]);

const contextJ = new Set(UNICODE_FREEFORM_CONTEXTJ_CODE_POINTS);
const contextO = new Set(UNICODE_FREEFORM_CONTEXTO_CODE_POINTS);

/** Ranges are generated sorted and disjoint, so a binary search is exact. */
function inRanges(ranges, codePoint) {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [start, end] = ranges[middle];
    if (codePoint < start) high = middle - 1;
    else if (codePoint > end) low = middle + 1;
    else return true;
  }
  return false;
}

function joiningType(codePoint) {
  let low = 0;
  let high = UNICODE_JOINING_TYPE_RANGES.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [start, end, value] = UNICODE_JOINING_TYPE_RANGES[middle];
    if (codePoint < start) high = middle - 1;
    else if (codePoint > end) low = middle + 1;
    else return value;
  }
  return "U";
}

const inRange = (codePoint, [start, end]) => codePoint >= start && codePoint <= end;

/** RFC 5892 Appendix A.1: the ZERO WIDTH NON-JOINER joining context. */
function zeroWidthNonJoinerAllowed(codePoints, index) {
  if (index > 0 && canonicalCombiningClass(codePoints[index - 1]) === VIRAMA_COMBINING_CLASS) {
    return true;
  }
  let before = index - 1;
  while (before >= 0 && joiningType(codePoints[before]) === "T") before -= 1;
  if (before < 0) return false;
  const leading = joiningType(codePoints[before]);
  if (leading !== "L" && leading !== "D") return false;

  let after = index + 1;
  while (after < codePoints.length && joiningType(codePoints[after]) === "T") after += 1;
  if (after >= codePoints.length) return false;
  const trailing = joiningType(codePoints[after]);
  return trailing === "R" || trailing === "D";
}

function contextJAllowed(codePoints, index) {
  const codePoint = codePoints[index];
  if (codePoint === ZERO_WIDTH_JOINER) {
    // RFC 5892 Appendix A.2.
    return (
      index > 0 && canonicalCombiningClass(codePoints[index - 1]) === VIRAMA_COMBINING_CLASS
    );
  }
  if (codePoint === ZERO_WIDTH_NON_JOINER) return zeroWidthNonJoinerAllowed(codePoints, index);
  return false;
}

/** RFC 5892 Appendix A.3 through A.9. */
function contextOAllowed(codePoints, index) {
  const codePoint = codePoints[index];
  if (codePoint === MIDDLE_DOT) {
    return (
      index > 0 &&
      index + 1 < codePoints.length &&
      codePoints[index - 1] === LATIN_SMALL_LETTER_L &&
      codePoints[index + 1] === LATIN_SMALL_LETTER_L
    );
  }
  if (codePoint === GREEK_LOWER_NUMERAL_SIGN) {
    return (
      index + 1 < codePoints.length &&
      inRanges(UNICODE_SCRIPT_GREEK_RANGES, codePoints[index + 1])
    );
  }
  if (codePoint === HEBREW_GERESH || codePoint === HEBREW_GERSHAYIM) {
    return index > 0 && inRanges(UNICODE_SCRIPT_HEBREW_RANGES, codePoints[index - 1]);
  }
  if (codePoint === KATAKANA_MIDDLE_DOT) {
    return codePoints.some(
      (candidate) =>
        inRanges(UNICODE_SCRIPT_HIRAGANA_RANGES, candidate) ||
        inRanges(UNICODE_SCRIPT_KATAKANA_RANGES, candidate) ||
        inRanges(UNICODE_SCRIPT_HAN_RANGES, candidate),
    );
  }
  if (inRange(codePoint, ARABIC_INDIC_DIGITS)) {
    return !codePoints.some((candidate) => inRange(candidate, EXTENDED_ARABIC_INDIC_DIGITS));
  }
  if (inRange(codePoint, EXTENDED_ARABIC_INDIC_DIGITS)) {
    return !codePoints.some((candidate) => inRange(candidate, ARABIC_INDIC_DIGITS));
  }
  return false;
}

/**
 * RFC 8265 Section 4.2.1 preparation: every code point must be allowed by the
 * PRECIS FreeformClass (RFC 8264 Section 4.3), with CONTEXTJ and CONTEXTO code
 * points admitted only when their RFC 5892 rule confirms the context.
 *
 * Errors never quote the offending input: this runs on secrets.
 */
export function assertFreeformClass(value, label = "string") {
  assertUnicodeScalarString(value, label);
  const codePoints = [];
  for (const symbol of value) codePoints.push(symbol.codePointAt(0));

  for (let index = 0; index < codePoints.length; index += 1) {
    const codePoint = codePoints[index];
    if (inRanges(UNICODE_FREEFORM_PVALID_RANGES, codePoint)) continue;
    if (contextJ.has(codePoint)) {
      if (contextJAllowed(codePoints, index)) continue;
      throw new ProtocolError(
        "CONTEXTUAL_RULE_NOT_SATISFIED",
        `${label} contains a join control in a context its rule does not allow`,
      );
    }
    if (contextO.has(codePoint)) {
      if (contextOAllowed(codePoints, index)) continue;
      throw new ProtocolError(
        "CONTEXTUAL_RULE_NOT_SATISFIED",
        `${label} contains a code point in a context its rule does not allow`,
      );
    }
    throw new ProtocolError(
      "DISALLOWED_CODE_POINT",
      `${label} contains a code point that the PRECIS FreeformClass disallows`,
    );
  }
}
