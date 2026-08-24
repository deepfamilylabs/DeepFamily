import test from "node:test";
import assert from "node:assert/strict";
import {
  PERSON_VERSION_SCHEMA,
  ProtocolError,
  canonicalizeFullName,
  isUnicodeWhiteSpaceOnly,
  parseCanonicalPersonVersion,
  serializeCanonicalPersonVersion,
  utf8Bytes,
} from "../index.js";

const PERSON_HASH = `0x${"11".repeat(32)}`;
const FATHER_HASH = `0x${"22".repeat(32)}`;

function fixture() {
  return {
    schema: PERSON_VERSION_SCHEMA,
    person: {
      fullName: "王小明",
      gender: 0,
      birthYear: 1980,
      birthMonth: 1,
      birthDay: 2,
      isBirthBC: false,
      personHash: PERSON_HASH,
    },
    parents: {
      father: {
        fullName: "Father Name",
        gender: 1,
        birthYear: 1950,
        birthMonth: 0,
        birthDay: 0,
        isBirthBC: false,
        personHash: FATHER_HASH,
        versionIndex: "9007199254740993",
      },
      mother: null,
    },
    tag: "v1\n标签",
    biography: 'quote " slash / backslash \\ control \u000b emoji 😀',
  };
}

test("canonical serializer fixes field order, escapes, lowercase hex and bigint syntax", () => {
  const encoded = serializeCanonicalPersonVersion(fixture());
  const text = new TextDecoder().decode(encoded);
  assert.equal(
    text,
    `{"schema":"deepfamily/person-version@1.0","person":{"fullName":"王小明","gender":0,"birthYear":1980,"birthMonth":1,"birthDay":2,"isBirthBC":false,"personHash":"${PERSON_HASH}"},"parents":{"father":{"fullName":"Father Name","gender":1,"birthYear":1950,"birthMonth":0,"birthDay":0,"isBirthBC":false,"personHash":"${FATHER_HASH}","versionIndex":9007199254740993},"mother":null},"tag":"v1\\n标签","biography":"quote \\" slash / backslash \\\\ control \\u000b emoji 😀"}`,
  );
  const parsed = parseCanonicalPersonVersion(encoded);
  assert.equal(parsed.parents.father.versionIndex, 9_007_199_254_740_993n);
  assert.deepEqual(serializeCanonicalPersonVersion(parsed), encoded);
});

test("fullName canonicalization is NFKC with a frozen Unicode White_Space table", () => {
  assert.equal(canonicalizeFullName(" \u3000Ａlice\u00a0\tSmith \n"), "Alice Smith");
  assert.throws(() => canonicalizeFullName("\u2003\u3000"), /cannot be empty/);
});

test("Unicode White_Space classification uses the release-frozen table", () => {
  assert.equal(isUnicodeWhiteSpaceOnly("\u0085\u1680\u2028\u3000"), true);
  assert.equal(isUnicodeWhiteSpaceOnly("\t\n\u00a0\u2003\u202f\u205f"), true);
  assert.equal(isUnicodeWhiteSpaceOnly(""), false);
  assert.equal(isUnicodeWhiteSpaceOnly("\u200b"), false);
  assert.equal(isUnicodeWhiteSpaceOnly(" \u200b"), false);
});

test("strict parser rejects noncanonical JSON, duplicate/unknown keys, BOM and invalid UTF-8", () => {
  const canonical = new TextDecoder().decode(serializeCanonicalPersonVersion(fixture()));
  const cases = [
    canonical.replace('{"schema"', '{ "schema"'),
    canonical.replace('"schema":', '"schema":"x","schema":'),
    canonical.replace('"tag":', '"unknown":0,"tag":'),
    canonical.replace("slash /", "slash \\/"),
    canonical.replace("emoji 😀", "emoji \\ud83d\\ude00"),
    canonical.replace('"gender":0', '"gender":00'),
  ];
  for (const value of cases) {
    assert.throws(() => parseCanonicalPersonVersion(utf8Bytes(value)), ProtocolError);
  }
  const bytes = serializeCanonicalPersonVersion(fixture());
  assert.throws(
    () => parseCanonicalPersonVersion(Uint8Array.of(0xef, 0xbb, 0xbf, ...bytes)),
    /BOM/,
  );
  assert.throws(() => parseCanonicalPersonVersion(Uint8Array.of(0x7b, 0xff, 0x7d)), /UTF-8/);
});

test("serializer rejects unsafe Number, isolated surrogate, oversized tag and noncanonical hash/name", () => {
  const unsafe = fixture();
  unsafe.parents.father.versionIndex = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => serializeCanonicalPersonVersion(unsafe), /unsafe JavaScript Number/);

  const surrogate = fixture();
  surrogate.biography = "bad\ud800";
  assert.throws(() => serializeCanonicalPersonVersion(surrogate), /isolated surrogate/);

  const tag = fixture();
  tag.tag = "é".repeat(129);
  assert.throws(() => serializeCanonicalPersonVersion(tag), /256 UTF-8 bytes/);

  const hash = fixture();
  hash.person.personHash = `0x${"AA".repeat(32)}`;
  assert.throws(() => serializeCanonicalPersonVersion(hash), /lowercase hex/);

  const name = fixture();
  name.person.fullName = " 王小明 ";
  assert.throws(() => serializeCanonicalPersonVersion(name), /already be NFKC-normalized/);
});
