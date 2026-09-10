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
export function buildHistoricalStoryChunks(person) {
  const chunks = [];
  const storyData = person?.storyData || {};
  STORY_FIELDS.forEach((field, fieldIndex) => {
    const values = Array.isArray(storyData[field]) ? storyData[field] : [storyData[field]];
    values.forEach((content, arrayIndex) => {
      if (typeof content !== "string" || content.trim().length === 0) return;
      let part = "";
      let partBytes = 0;
      let partIndex = 0;
      const pushPart = () => {
        chunks.push({ type: fieldIndex + 1, content: part, arrayIndex, partIndex });
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
  return chunks;
}

/** Resume ordinary records without counting the optional biography as a chunk. */
export function getHistoricalStoryResume({ totalRecords, biographyRecordCount, chunks }) {
  const total = Number(totalRecords);
  const biographyCount = Number(biographyRecordCount);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("totalRecords must be a nonnegative safe integer");
  }
  if (biographyCount !== 0 && biographyCount !== 1) {
    throw new Error("biographyRecordCount must be 0 or 1");
  }
  if (!Array.isArray(chunks)) throw new Error("chunks must be an array");
  if (total < biographyCount) {
    throw new Error("Archive record count is smaller than the biography record count");
  }
  const existingChunks = total - biographyCount;
  if (existingChunks > chunks.length) {
    throw new Error("Archive has more ordinary story records than the source storyData");
  }
  return {
    existingChunks,
    pendingChunks: chunks.slice(existingChunks),
    nextRecordIndex: total,
  };
}
