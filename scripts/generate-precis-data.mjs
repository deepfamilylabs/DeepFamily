#!/usr/bin/env node

// Derives the PRECIS FreeformClass repertoire (RFC 8264) from pinned UCD bytes.
// The derived property is computed here, at build time, so the shipped table is
// a plain range list and the runtime never carries raw Unicode property files.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UNICODE_VERSION = "17.0.0";
const SOURCES = Object.freeze([
  Object.freeze({
    name: "UnicodeData.txt",
    url: `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd/UnicodeData.txt`,
    sha256: "2e1efc1dcb59c575eedf5ccae60f95229f706ee6d031835247d843c11d96470c",
  }),
  Object.freeze({
    name: "DerivedCoreProperties.txt",
    url: `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd/DerivedCoreProperties.txt`,
    sha256: "24c7fed1195c482faaefd5c1e7eb821c5ee1fb6de07ecdbaa64b56a99da22c08",
  }),
  Object.freeze({
    name: "PropList.txt",
    url: `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd/PropList.txt`,
    sha256: "130dcddcaadaf071008bdfce1e7743e04fdfbc910886f017d9f9ac931d8c64dd",
  }),
  Object.freeze({
    name: "HangulSyllableType.txt",
    url: `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd/HangulSyllableType.txt`,
    sha256: "5a57450afde0d082bc5026f7458649eac3b615490cc7e3d916b0367f1593c0e3",
  }),
  Object.freeze({
    name: "DerivedJoiningType.txt",
    url: `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd/extracted/DerivedJoiningType.txt`,
    sha256: "f39ebe974825d6736aee15582250307aa532b2cfab3caf3f86bd23fddc9c5c4d",
  }),
  Object.freeze({
    name: "Scripts.txt",
    url: `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd/Scripts.txt`,
    sha256: "9f5e50d3abaee7d6ce09480f325c706f485ae3240912527e651954d2d6b035bf",
  }),
]);

const MAX_CODE_POINT = 0x10_ffff;

// RFC 5892 Section 2.6. Exceptions are consulted before every other category,
// so they are reproduced verbatim rather than derived.
const EXCEPTIONS = Object.freeze(
  new Map([
    [0x00df, "PVALID"],
    [0x03c2, "PVALID"],
    [0x06fd, "PVALID"],
    [0x06fe, "PVALID"],
    [0x0f0b, "PVALID"],
    [0x3007, "PVALID"],
    [0x00b7, "CONTEXTO"],
    [0x0375, "CONTEXTO"],
    [0x05f3, "CONTEXTO"],
    [0x05f4, "CONTEXTO"],
    [0x30fb, "CONTEXTO"],
    ...Array.from({ length: 10 }, (_, index) => [0x0660 + index, "CONTEXTO"]),
    ...Array.from({ length: 10 }, (_, index) => [0x06f0 + index, "CONTEXTO"]),
    [0x0640, "DISALLOWED"],
    [0x07fa, "DISALLOWED"],
    [0x302e, "DISALLOWED"],
    [0x302f, "DISALLOWED"],
    ...Array.from({ length: 5 }, (_, index) => [0x3031 + index, "DISALLOWED"]),
    [0x303b, "DISALLOWED"],
  ]),
);

// RFC 5892 Section 2.1 / RFC 8264 Sections 9.14 to 9.18.
const LETTER_DIGITS = new Set(["Ll", "Lu", "Lo", "Nd", "Lm", "Mn", "Mc"]);
const OTHER_LETTER_DIGITS = new Set(["Lt", "Nl", "No", "Me"]);
const SYMBOLS = new Set(["Sm", "Sc", "Sk", "So"]);
const PUNCTUATION = new Set(["Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po"]);
const CONTEXTUAL_SCRIPTS = Object.freeze(["Greek", "Hebrew", "Hiragana", "Katakana", "Han"]);

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const outputPath = path.join(repositoryRoot, "packages", "protocol-core", "precis-data.js");
const licensePath = path.join(repositoryRoot, "packages", "protocol-core", "UNICODE-LICENSE.txt");
const UNICODE_LICENSE_SHA256 = "e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fetchPinnedSource(source) {
  const response = await fetch(source.url, {
    headers: { "user-agent": "DeepFamily PRECIS data generator" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${source.name} download failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== source.sha256) {
    throw new Error(`${source.name} SHA-256 mismatch: expected ${source.sha256}, got ${actual}`);
  }
  return bytes.toString("utf8");
}

/** Parses the `start..end ; Value` shape shared by every derived UCD file. */
function forEachPropertyRecord(source, visit) {
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.replace(/#.*/u, "").trim();
    if (!line) continue;
    const fields = line.split(";").map((field) => field.trim());
    const [startText, endText = startText] = fields[0].split("..");
    visit(Number.parseInt(startText, 16), Number.parseInt(endText, 16), fields[1]);
  }
}

function parseGeneralCategories(source) {
  const categories = new Array(MAX_CODE_POINT + 1).fill("Cn");
  let rangeStart = null;
  for (const line of source.split(/\r?\n/u)) {
    if (!line) continue;
    const fields = line.split(";");
    const codePoint = Number.parseInt(fields[0], 16);
    const name = fields[1];
    const category = fields[2];
    if (name.endsWith(", First>")) {
      rangeStart = codePoint;
      continue;
    }
    if (name.endsWith(", Last>")) {
      if (rangeStart === null) throw new Error(`Unpaired UnicodeData range end at ${fields[0]}`);
      for (let cp = rangeStart; cp <= codePoint; cp += 1) categories[cp] = category;
      rangeStart = null;
      continue;
    }
    categories[codePoint] = category;
  }
  if (rangeStart !== null) throw new Error("Unterminated UnicodeData range");
  return categories;
}

function parseBinaryProperty(source, property) {
  const members = new Set();
  forEachPropertyRecord(source, (start, end, value) => {
    if (value !== property) return;
    for (let cp = start; cp <= end; cp += 1) members.add(cp);
  });
  if (members.size === 0) throw new Error(`No code points found for property ${property}`);
  return members;
}

function parseEnumProperty(source, accept) {
  const values = new Map();
  forEachPropertyRecord(source, (start, end, value) => {
    if (!accept(value)) return;
    for (let cp = start; cp <= end; cp += 1) values.set(cp, value);
  });
  if (values.size === 0) throw new Error("No code points found for enumerated property");
  return values;
}

/** RFC 8264 Section 8. The order of operations is normative and fixed. */
function derivePrecisProperty(codePoint, tables) {
  const exception = EXCEPTIONS.get(codePoint);
  if (exception !== undefined) return exception;
  // BackwardCompatible (RFC 5892 Section 2.7) is currently the empty set.
  const category = tables.categories[codePoint];
  if (category === "Cn" && !tables.noncharacters.has(codePoint)) return "UNASSIGNED";
  if (codePoint >= 0x21 && codePoint <= 0x7e) return "PVALID";
  if (tables.joinControls.has(codePoint)) return "CONTEXTJ";
  if (tables.oldHangulJamo.has(codePoint)) return "DISALLOWED";
  if (tables.defaultIgnorable.has(codePoint) || tables.noncharacters.has(codePoint)) {
    return "DISALLOWED";
  }
  if (category === "Cc") return "DISALLOWED";
  if (tables.hasCompat(codePoint)) return "FREE_PVAL";
  if (LETTER_DIGITS.has(category)) return "PVALID";
  if (OTHER_LETTER_DIGITS.has(category)) return "FREE_PVAL";
  if (category === "Zs") return "FREE_PVAL";
  if (SYMBOLS.has(category)) return "FREE_PVAL";
  if (PUNCTUATION.has(category)) return "FREE_PVAL";
  return "DISALLOWED";
}

function toRanges(predicate) {
  const ranges = [];
  let start = null;
  for (let cp = 0; cp <= MAX_CODE_POINT + 1; cp += 1) {
    const inside = cp <= MAX_CODE_POINT && predicate(cp);
    if (inside && start === null) start = cp;
    if (!inside && start !== null) {
      ranges.push([start, cp - 1]);
      start = null;
    }
  }
  return ranges;
}

const serializeRows = (rows) => rows.map((row) => `  ${JSON.stringify(row)},`).join("\n");

const formatUnicodeLicenseComment = (licenseText) =>
  `/*! @license Unicode-3.0\n${licenseText
    .trimEnd()
    .split(/\r?\n/u)
    .map((line) => (line === "" ? " *" : ` * ${line}`))
    .join("\n")}\n */\n`;

function generateModule({ pvalid, contexto, joining, scripts, unicodeLicense }) {
  const sourceSummary = SOURCES.map((s) => `// - ${s.url} (SHA-256 ${s.sha256})`).join("\n");
  const scriptExports = CONTEXTUAL_SCRIPTS.map(
    (name) =>
      `// prettier-ignore\nexport const UNICODE_SCRIPT_${name.toUpperCase()}_RANGES = [\n${serializeRows(
        scripts[name],
      )}\n];\n`,
  ).join("\n");
  return (
    `// Generated by scripts/generate-precis-data.mjs. Do not edit.\n` +
    formatUnicodeLicenseComment(unicodeLicense) +
    `// PRECIS FreeformClass repertoire (RFC 8264 Section 4.3) derived from Unicode ${UNICODE_VERSION}:\n` +
    `${sourceSummary}\n\n` +
    `export const PRECIS_UNICODE_VERSION = "${UNICODE_VERSION}";\n\n` +
    `// prettier-ignore\n` +
    `export const UNICODE_FREEFORM_PVALID_RANGES = [\n${serializeRows(pvalid)}\n];\n\n` +
    `// prettier-ignore\n` +
    `export const UNICODE_FREEFORM_CONTEXTJ_CODE_POINTS = [8204,8205];\n\n` +
    `// prettier-ignore\n` +
    `export const UNICODE_FREEFORM_CONTEXTO_CODE_POINTS = [\n${serializeRows(contexto)}\n];\n\n` +
    `// prettier-ignore\n` +
    `export const UNICODE_JOINING_TYPE_RANGES = [\n${serializeRows(joining)}\n];\n\n` +
    scriptExports
  );
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--check")) {
    throw new Error("Usage: node scripts/generate-precis-data.mjs [--check]");
  }
  const [unicodeData, derivedCore, propList, hangul, joiningTypes, scriptValues] =
    await Promise.all(SOURCES.map(fetchPinnedSource));
  const unicodeLicense = await fs.readFile(licensePath, "utf8");
  if (sha256(Buffer.from(unicodeLicense, "utf8")) !== UNICODE_LICENSE_SHA256) {
    throw new Error("UNICODE-LICENSE.txt does not match the reviewed Unicode-3.0 notice");
  }

  const { normalizeUnicodeNfkc } = await import(
    "../packages/protocol-core/unicode-normalization.js"
  );
  const categories = parseGeneralCategories(unicodeData);
  const hangulTypes = parseEnumProperty(hangul, (value) => ["L", "V", "T"].includes(value));
  const joiningMap = parseEnumProperty(joiningTypes, (value) =>
    ["L", "D", "T", "R"].includes(value),
  );
  const scriptMap = parseEnumProperty(scriptValues, (value) => CONTEXTUAL_SCRIPTS.includes(value));

  const tables = {
    categories,
    defaultIgnorable: parseBinaryProperty(derivedCore, "Default_Ignorable_Code_Point"),
    noncharacters: parseBinaryProperty(propList, "Noncharacter_Code_Point"),
    joinControls: parseBinaryProperty(propList, "Join_Control"),
    oldHangulJamo: new Set(hangulTypes.keys()),
    hasCompat(codePoint) {
      // Surrogates are not scalars and never reach normalization.
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) return false;
      const value = String.fromCodePoint(codePoint);
      return normalizeUnicodeNfkc(value) !== value;
    },
  };

  const derived = new Array(MAX_CODE_POINT + 1);
  for (let cp = 0; cp <= MAX_CODE_POINT; cp += 1) derived[cp] = derivePrecisProperty(cp, tables);

  const pvalid = toRanges((cp) => derived[cp] === "PVALID" || derived[cp] === "FREE_PVAL");
  const contexto = [...EXCEPTIONS.entries()]
    .filter(([, value]) => value === "CONTEXTO")
    .map(([cp]) => cp)
    .sort((left, right) => left - right);
  const joining = toRanges(() => false);
  const joiningRanges = [];
  {
    let start = null;
    let current = null;
    for (let cp = 0; cp <= MAX_CODE_POINT + 1; cp += 1) {
      const value = cp <= MAX_CODE_POINT ? (joiningMap.get(cp) ?? null) : null;
      if (value !== current) {
        if (current !== null) joiningRanges.push([start, cp - 1, current]);
        start = cp;
        current = value;
      }
    }
    joining.length = 0;
    joining.push(...joiningRanges);
  }
  const scripts = Object.fromEntries(
    CONTEXTUAL_SCRIPTS.map((name) => [name, toRanges((cp) => scriptMap.get(cp) === name)]),
  );

  const generated = generateModule({ pvalid, contexto, joining, scripts, unicodeLicense });
  if (argv[0] === "--check") {
    const current = await fs.readFile(outputPath, "utf8");
    if (current !== generated) throw new Error("Generated PRECIS data is stale");
  } else {
    const temporaryPath = `${outputPath}.tmp`;
    await fs.writeFile(temporaryPath, generated, { encoding: "utf8", mode: 0o644 });
    await fs.rename(temporaryPath, outputPath);
  }
  console.log(
    `PRECIS FreeformClass data ${argv[0] === "--check" ? "verified" : "generated"}: ` +
      `${pvalid.length} PVALID ranges, ${joining.length} joining ranges, ` +
      `sha256 ${sha256(Buffer.from(generated, "utf8"))}`,
  );
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    console.error(`[precis-data] ${error.message}`);
    process.exitCode = 1;
  });
}
