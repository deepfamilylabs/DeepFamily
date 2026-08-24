import {
  MAX_CANONICAL_JSON_BYTES,
  MAX_FULL_NAME_UTF8_BYTES,
  MAX_TAG_UTF8_BYTES,
  MAX_UINT256,
  PERSON_VERSION_SCHEMA,
  ZERO_BYTES32,
} from "./constants.js";
import {
  assertUnicodeScalarString,
  bigintFrom,
  decodeUtf8Fatal,
  equalBytesConstantTime,
  utf8Bytes,
} from "./bytes.js";
import { ProtocolError, protocolAssert } from "./errors.js";
import { normalizeUnicodeNfkc } from "./unicode-normalization.js";

// Unicode White_Space property, frozen by the v1 release manifest. The set is
// unchanged in Unicode 17.0 and is written explicitly so host RegExp tables do
// not silently redefine identity canonicalization.
export const UNICODE_WHITE_SPACE_VERSION = "17.0.0";
const UNICODE_WHITE_SPACE_RUN =
  /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu;
const UNICODE_WHITE_SPACE_ONLY =
  /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/u;
const LEADING_OR_TRAILING_ASCII_SPACE = /^ +| +$/gu;

const TOP_LEVEL_KEYS = ["schema", "person", "parents", "tag", "biography"];
const PERSON_KEYS = [
  "fullName",
  "gender",
  "birthYear",
  "birthMonth",
  "birthDay",
  "isBirthBC",
  "personHash",
];
const PARENTS_KEYS = ["father", "mother"];
const PARENT_KEYS = [...PERSON_KEYS, "versionIndex"];
const LOWER_BYTES32 = /^0x[0-9a-f]{64}$/;

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, expected, label) {
  protocolAssert(isPlainObject(value), "INVALID_OBJECT", `${label} must be an object`);
  const keys = Object.keys(value);
  const symbols = Object.getOwnPropertySymbols(value);
  protocolAssert(symbols.length === 0, "UNKNOWN_KEY", `${label} contains a symbol key`);
  protocolAssert(
    keys.length === expected.length,
    "INVALID_KEYS",
    `${label} has missing or unknown keys`,
  );
  const actual = new Set(keys);
  for (const key of expected) {
    protocolAssert(actual.has(key), "INVALID_KEYS", `${label}.${key} is required`);
  }
}

export function canonicalizeFullName(value) {
  protocolAssert(typeof value === "string", "INVALID_FULL_NAME", "fullName must be a string");
  assertUnicodeScalarString(value, "fullName");
  const normalized = normalizeUnicodeNfkc(value, "fullName");
  const collapsed = normalized
    .replace(UNICODE_WHITE_SPACE_RUN, " ")
    .replace(LEADING_OR_TRAILING_ASCII_SPACE, "");
  protocolAssert(collapsed.length > 0, "EMPTY_FULL_NAME", "Canonical fullName cannot be empty");
  protocolAssert(
    utf8Bytes(collapsed).length <= MAX_FULL_NAME_UTF8_BYTES,
    "FULL_NAME_TOO_LARGE",
    `Canonical fullName exceeds ${MAX_FULL_NAME_UTF8_BYTES} UTF-8 bytes`,
  );
  return collapsed;
}

/** Tests the release-frozen Unicode 17 White_Space set without host tables. */
export function isUnicodeWhiteSpaceOnly(value) {
  protocolAssert(typeof value === "string", "INVALID_STRING", "value must be a string");
  assertUnicodeScalarString(value, "value");
  return UNICODE_WHITE_SPACE_ONLY.test(value);
}

function assertCanonicalFullName(value) {
  const canonical = canonicalizeFullName(value);
  protocolAssert(
    canonical === value,
    "NON_CANONICAL_FULL_NAME",
    "fullName must already be NFKC-normalized with Unicode White_Space collapsed",
  );
  return value;
}

function smallUnsigned(value, maximum, label) {
  return Number(bigintFrom(value, label, BigInt(maximum)));
}

function canonicalPersonHash(value, label, { nonZero = true } = {}) {
  protocolAssert(
    typeof value === "string" && LOWER_BYTES32.test(value),
    "NON_CANONICAL_PERSON_HASH",
    `${label} must be 0x plus 64 lowercase hex characters`,
  );
  if (nonZero) {
    protocolAssert(value !== ZERO_BYTES32, "ZERO_PERSON_HASH", `${label} must be nonzero`);
  }
  return value;
}

function normalizeIdentityObject(value, label, parent) {
  assertExactKeys(value, parent ? PARENT_KEYS : PERSON_KEYS, label);
  const fullName = assertCanonicalFullName(value.fullName);
  const gender = smallUnsigned(value.gender, 255, `${label}.gender`);
  const birthYear = smallUnsigned(value.birthYear, 65_535, `${label}.birthYear`);
  const birthMonth = smallUnsigned(value.birthMonth, 12, `${label}.birthMonth`);
  const birthDay = smallUnsigned(value.birthDay, 31, `${label}.birthDay`);
  protocolAssert(
    typeof value.isBirthBC === "boolean",
    "INVALID_BOOLEAN",
    `${label}.isBirthBC must be boolean`,
  );
  const personHash = canonicalPersonHash(value.personHash, `${label}.personHash`);
  const normalized = {
    fullName,
    gender,
    birthYear,
    birthMonth,
    birthDay,
    isBirthBC: value.isBirthBC,
    personHash,
  };
  if (parent) {
    normalized.versionIndex = bigintFrom(value.versionIndex, `${label}.versionIndex`, MAX_UINT256);
  }
  return normalized;
}

export function validateCanonicalPersonVersion(value) {
  assertExactKeys(value, TOP_LEVEL_KEYS, "metadata");
  protocolAssert(
    value.schema === PERSON_VERSION_SCHEMA,
    "UNSUPPORTED_PLAINTEXT_SCHEMA",
    `schema must be ${PERSON_VERSION_SCHEMA}`,
  );
  const person = normalizeIdentityObject(value.person, "metadata.person", false);
  assertExactKeys(value.parents, PARENTS_KEYS, "metadata.parents");
  const father =
    value.parents.father === null
      ? null
      : normalizeIdentityObject(value.parents.father, "metadata.parents.father", true);
  const mother =
    value.parents.mother === null
      ? null
      : normalizeIdentityObject(value.parents.mother, "metadata.parents.mother", true);
  protocolAssert(typeof value.tag === "string", "INVALID_TAG", "tag must be a string");
  protocolAssert(
    typeof value.biography === "string",
    "INVALID_BIOGRAPHY",
    "biography must be a string",
  );
  assertUnicodeScalarString(value.tag, "tag");
  assertUnicodeScalarString(value.biography, "biography");
  protocolAssert(
    utf8Bytes(value.tag).length <= MAX_TAG_UTF8_BYTES,
    "TAG_TOO_LARGE",
    `tag exceeds ${MAX_TAG_UTF8_BYTES} UTF-8 bytes`,
  );
  return {
    schema: PERSON_VERSION_SCHEMA,
    person,
    parents: { father, mother },
    tag: value.tag,
    biography: value.biography,
  };
}

export function escapeCanonicalJsonString(value) {
  assertUnicodeScalarString(value);
  let output = '"';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    switch (code) {
      case 0x08:
        output += "\\b";
        break;
      case 0x09:
        output += "\\t";
        break;
      case 0x0a:
        output += "\\n";
        break;
      case 0x0c:
        output += "\\f";
        break;
      case 0x0d:
        output += "\\r";
        break;
      case 0x22:
        output += '\\"';
        break;
      case 0x5c:
        output += "\\\\";
        break;
      default:
        if (code <= 0x1f) {
          output += `\\u${code.toString(16).padStart(4, "0")}`;
        } else if (code >= 0xd800 && code <= 0xdbff) {
          output += value.slice(index, index + 2);
          index += 1;
        } else {
          output += value[index];
        }
    }
  }
  return `${output}"`;
}

function serializeIdentity(value, parent) {
  let output = `{"fullName":${escapeCanonicalJsonString(value.fullName)}`;
  output += `,"gender":${value.gender}`;
  output += `,"birthYear":${value.birthYear}`;
  output += `,"birthMonth":${value.birthMonth}`;
  output += `,"birthDay":${value.birthDay}`;
  output += `,"isBirthBC":${value.isBirthBC ? "true" : "false"}`;
  output += `,"personHash":${escapeCanonicalJsonString(value.personHash)}`;
  if (parent) output += `,"versionIndex":${value.versionIndex.toString()}`;
  return `${output}}`;
}

export function serializeCanonicalPersonVersion(value) {
  const metadata = validateCanonicalPersonVersion(value);
  let json = `{"schema":${escapeCanonicalJsonString(PERSON_VERSION_SCHEMA)}`;
  json += `,"person":${serializeIdentity(metadata.person, false)}`;
  json += `,"parents":{"father":${
    metadata.parents.father === null ? "null" : serializeIdentity(metadata.parents.father, true)
  },"mother":${
    metadata.parents.mother === null ? "null" : serializeIdentity(metadata.parents.mother, true)
  }}`;
  json += `,"tag":${escapeCanonicalJsonString(metadata.tag)}`;
  json += `,"biography":${escapeCanonicalJsonString(metadata.biography)}}`;
  const bytes = utf8Bytes(json);
  protocolAssert(
    bytes.length <= MAX_CANONICAL_JSON_BYTES,
    "CANONICAL_JSON_TOO_LARGE",
    `Canonical JSON exceeds ${MAX_CANONICAL_JSON_BYTES} bytes`,
  );
  return bytes;
}

class StrictJsonParser {
  constructor(text) {
    this.text = text;
    this.offset = 0;
  }

  fail(message) {
    throw new ProtocolError("INVALID_CANONICAL_JSON", `${message} at UTF-16 offset ${this.offset}`);
  }

  parse() {
    const value = this.parseValue();
    if (this.offset !== this.text.length) this.fail("Trailing JSON data");
    return value;
  }

  parseValue() {
    const current = this.text[this.offset];
    if (current === "{") return this.parseObject();
    if (current === '"') return this.parseString();
    if (current === "t" && this.text.startsWith("true", this.offset)) {
      this.offset += 4;
      return true;
    }
    if (current === "f" && this.text.startsWith("false", this.offset)) {
      this.offset += 5;
      return false;
    }
    if (current === "n" && this.text.startsWith("null", this.offset)) {
      this.offset += 4;
      return null;
    }
    if (current >= "0" && current <= "9") return this.parseInteger();
    if (current === "[") this.fail("Arrays are not part of df-meta-v1");
    this.fail("Unexpected JSON token");
  }

  parseObject() {
    this.offset += 1;
    const object = Object.create(null);
    const seen = new Set();
    if (this.text[this.offset] === "}") {
      this.offset += 1;
      return object;
    }
    while (this.offset < this.text.length) {
      if (this.text[this.offset] !== '"') this.fail("Object key must be a string");
      const key = this.parseString();
      if (seen.has(key)) this.fail(`Duplicate object key ${JSON.stringify(key)}`);
      seen.add(key);
      if (this.text[this.offset] !== ":") this.fail("Expected colon");
      this.offset += 1;
      object[key] = this.parseValue();
      const separator = this.text[this.offset];
      if (separator === "}") {
        this.offset += 1;
        return object;
      }
      if (separator !== ",") this.fail("Expected comma or object end");
      this.offset += 1;
    }
    this.fail("Unterminated object");
  }

  parseInteger() {
    const start = this.offset;
    if (this.text[this.offset] === "0") {
      this.offset += 1;
      if (/[0-9]/.test(this.text[this.offset] ?? "")) this.fail("Leading zero in integer");
    } else {
      while (/[0-9]/.test(this.text[this.offset] ?? "")) this.offset += 1;
    }
    const token = this.text.slice(start, this.offset);
    try {
      return BigInt(token);
    } catch {
      this.fail("Invalid integer");
    }
  }

  parseString() {
    this.offset += 1;
    let output = "";
    while (this.offset < this.text.length) {
      const code = this.text.charCodeAt(this.offset);
      if (code === 0x22) {
        this.offset += 1;
        return output;
      }
      if (code <= 0x1f) this.fail("Unescaped control character");
      if (code === 0x5c) {
        this.offset += 1;
        output += this.parseEscape();
        continue;
      }
      if (code >= 0xd800 && code <= 0xdbff) {
        const low = this.text.charCodeAt(this.offset + 1);
        if (!(low >= 0xdc00 && low <= 0xdfff)) this.fail("Isolated high surrogate");
        output += this.text.slice(this.offset, this.offset + 2);
        this.offset += 2;
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff) this.fail("Isolated low surrogate");
      output += this.text[this.offset];
      this.offset += 1;
    }
    this.fail("Unterminated string");
  }

  parseEscape() {
    const escaped = this.text[this.offset];
    this.offset += 1;
    const simple = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (Object.prototype.hasOwnProperty.call(simple, escaped)) return simple[escaped];
    if (escaped !== "u") this.fail("Invalid string escape");
    const first = this.readEscapedCodeUnit();
    if (first >= 0xd800 && first <= 0xdbff) {
      if (this.text[this.offset] !== "\\" || this.text[this.offset + 1] !== "u") {
        this.fail("Escaped high surrogate must be followed by an escaped low surrogate");
      }
      this.offset += 2;
      const second = this.readEscapedCodeUnit();
      if (!(second >= 0xdc00 && second <= 0xdfff)) this.fail("Invalid escaped surrogate pair");
      return String.fromCharCode(first, second);
    }
    if (first >= 0xdc00 && first <= 0xdfff) this.fail("Isolated escaped low surrogate");
    return String.fromCharCode(first);
  }

  readEscapedCodeUnit() {
    const token = this.text.slice(this.offset, this.offset + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(token)) this.fail("Invalid Unicode escape");
    this.offset += 4;
    return Number.parseInt(token, 16);
  }
}

export function parseCanonicalPersonVersion(bytes) {
  const input = new Uint8Array(bytes);
  protocolAssert(
    input.length <= MAX_CANONICAL_JSON_BYTES,
    "CANONICAL_JSON_TOO_LARGE",
    `Canonical JSON exceeds ${MAX_CANONICAL_JSON_BYTES} bytes`,
  );
  const text = decodeUtf8Fatal(input);
  const parsed = new StrictJsonParser(text).parse();
  const metadata = validateCanonicalPersonVersion(parsed);
  const reserialized = serializeCanonicalPersonVersion(metadata);
  protocolAssert(
    equalBytesConstantTime(input, reserialized),
    "NON_CANONICAL_JSON",
    "Plaintext bytes are valid JSON but not the canonical df-meta-v1 encoding",
  );
  return metadata;
}
