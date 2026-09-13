import { assertUnicodeScalarString } from "@deepfamily/protocol-core";

const MAX_CONTENT_BYTES = 16_384;

const STORY_FIELDS = [
  "summary",
  "earlyLife",
  "education",
  "lifeEvents",
  "career",
  "works",
  "achievements",
  "philosophy",
  "quotes",
  "family",
  "lifestyle",
  "relations",
  "activities",
  "anecdotes",
  "controversies",
  "legacy",
  "gallery",
  "references",
  "notes",
];

/** Build ordinary story records independently of the mint biography. */
export function buildHistoricalStoryRecords(person) {
  const records = [];
  const storyData = person?.storyData || {};
  STORY_FIELDS.forEach((field, fieldIndex) => {
    const values = Array.isArray(storyData[field]) ? storyData[field] : [storyData[field]];
    values.forEach((entry, arrayIndex) => {
      const content = typeof entry === "string" ? entry : entry?.content;
      if (typeof content !== "string" || content.trim().length === 0) return;
      const title = typeof entry === "string" ? "" : (entry.title ?? "");
      assertUnicodeScalarString(title, `storyData.${field}[${arrayIndex}].title`);
      let part = "";
      let partBytes = 0;
      let partIndex = 0;
      const pushPart = () => {
        records.push({ type: fieldIndex + 1, title, content: part, arrayIndex, partIndex });
        partIndex += 1;
        part = "";
        partBytes = 0;
      };
      for (const scalar of content) {
        const codePoint = scalar.codePointAt(0);
        if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
          throw new Error(`Invalid Unicode scalar in storyData.${field}[${arrayIndex}]`);
        }
        const bytes = Buffer.byteLength(scalar, "utf8");
        if (partBytes + bytes > MAX_CONTENT_BYTES) pushPart();
        part += scalar;
        partBytes += bytes;
      }
      if (part) pushPart();
    });
  });
  return records;
}

/** Resume ordinary records excluding the optional biography from the ordinary record count. */
export function getHistoricalStoryResume({ totalRecords, biographyRecordCount, records }) {
  const total = Number(totalRecords);
  const biographyCount = Number(biographyRecordCount);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("totalRecords must be a nonnegative safe integer");
  }
  if (biographyCount !== 0 && biographyCount !== 1) {
    throw new Error("biographyRecordCount must be 0 or 1");
  }
  if (!Array.isArray(records)) throw new Error("records must be an array");
  if (total < biographyCount) {
    throw new Error("Archive record count is smaller than the biography record count");
  }
  const existingRecords = total - biographyCount;
  if (existingRecords > records.length) {
    throw new Error("Archive has more ordinary story records than the source storyData");
  }
  return {
    existingRecords,
    pendingRecords: records.slice(existingRecords),
    nextRecordIndex: total,
  };
}
