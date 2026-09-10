import { expect } from "chai";
import fs from "node:fs";
import {
  buildHistoricalStoryChunks,
  getHistoricalStoryResume,
} from "../lib/historicalStoryChunks.js";

describe("historical story chunks", () => {
  it("keeps all 137 Cao Cao storyData chunks alongside the mint biography", () => {
    const family = JSON.parse(
      fs.readFileSync(new URL("../data/persons/zh-cao-family.json", import.meta.url), "utf8"),
    );
    const person = family.members.find((member) => member.fullName === "曹操");
    expect(person.story).to.be.a("string").and.not.empty;
    const chunks = buildHistoricalStoryChunks(person);
    expect(chunks).to.have.length(137);
    expect(chunks).to.deep.equal(buildHistoricalStoryChunks({ storyData: person.storyData }));
    expect(chunks[0]).to.deep.equal({
      type: 1,
      content: person.storyData.summary[0],
      arrayIndex: 0,
      partIndex: 0,
    });
    expect(chunks.at(-1).type).to.equal(19);
    expect(chunks.every((chunk) => Buffer.byteLength(chunk.content, "utf8") <= 16_384)).to.equal(
      true,
    );
  });

  it("orders all fields from summary 1 to notes 19, retaining item positions and whitespace", () => {
    const chunks = buildHistoricalStoryChunks({
      story: "Biography",
      storyData: {
        notes: " Final note\r\n",
        summary: [" \r\n", "  Summary\r\n", null, "Second summary\t"],
        education: " School\n",
        unknown: "Not a known story field",
      },
    });
    expect(chunks).to.deep.equal([
      { type: 1, content: "  Summary\r\n", arrayIndex: 1, partIndex: 0 },
      { type: 1, content: "Second summary\t", arrayIndex: 3, partIndex: 0 },
      { type: 3, content: " School\n", arrayIndex: 0, partIndex: 0 },
      { type: 19, content: " Final note\r\n", arrayIndex: 0, partIndex: 0 },
    ]);
    expect(buildHistoricalStoryChunks({ story: "Biography only" })).to.deep.equal([]);
  });

  it("splits at Unicode scalar boundaries and preserves the exact original text", () => {
    const content = `${"a".repeat(16_383)}😀\r\n ${"曹".repeat(6_000)}e\u0301\t`;
    const chunks = buildHistoricalStoryChunks({ storyData: { lifeEvents: [content] } });
    expect(chunks.map((chunk) => chunk.content).join("")).to.equal(content);
    expect(chunks[0].content).to.equal("a".repeat(16_383));
    expect(chunks[1].content.startsWith("😀\r\n ")).to.equal(true);
    expect(chunks.map((chunk) => chunk.partIndex)).to.deep.equal([0, 1, 2]);
    for (const chunk of chunks) {
      expect(chunk.type).to.equal(4);
      expect(chunk.arrayIndex).to.equal(0);
      expect(Buffer.byteLength(chunk.content, "utf8")).to.be.at.most(16_384);
      expect(Buffer.from(chunk.content, "utf8").toString("utf8")).to.equal(chunk.content);
    }
    expect(() => buildHistoricalStoryChunks({ storyData: { summary: "\ud800" } })).to.throw(
      "Invalid Unicode scalar",
    );
  });

  for (const biographyRecordCount of [0, 1]) {
    it(`resumes with ${biographyRecordCount} biography record without skipping or duplicating ordinary chunks`, () => {
      const chunks = buildHistoricalStoryChunks({ storyData: { summary: ["first", "second"] } });
      expect(
        getHistoricalStoryResume({
          totalRecords: biographyRecordCount,
          biographyRecordCount,
          chunks,
        }),
      ).to.deep.equal({
        existingChunks: 0,
        pendingChunks: chunks,
        nextRecordIndex: biographyRecordCount,
      });
      expect(
        getHistoricalStoryResume({
          totalRecords: biographyRecordCount + 1,
          biographyRecordCount,
          chunks,
        }),
      ).to.deep.equal({
        existingChunks: 1,
        pendingChunks: [chunks[1]],
        nextRecordIndex: biographyRecordCount + 1,
      });
      expect(
        getHistoricalStoryResume({
          totalRecords: BigInt(biographyRecordCount + 2),
          biographyRecordCount,
          chunks,
        }),
      ).to.deep.equal({
        existingChunks: 2,
        pendingChunks: [],
        nextRecordIndex: biographyRecordCount + 2,
      });
      expect(() =>
        getHistoricalStoryResume({
          totalRecords: biographyRecordCount + 3,
          biographyRecordCount,
          chunks,
        }),
      ).to.throw("more ordinary story records");
    });
  }

  it("rejects invalid Archive counts instead of silently skipping source data", () => {
    for (const totalRecords of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        getHistoricalStoryResume({ totalRecords, biographyRecordCount: 0, chunks: [] }),
      ).to.throw("nonnegative safe integer");
    }
    expect(() =>
      getHistoricalStoryResume({ totalRecords: 0, biographyRecordCount: 1, chunks: [] }),
    ).to.throw("smaller than the biography");
    expect(() =>
      getHistoricalStoryResume({ totalRecords: 2, biographyRecordCount: 2, chunks: [] }),
    ).to.throw("must be 0 or 1");
  });
});
