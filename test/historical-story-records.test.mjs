import { expect } from "chai";
import fs from "node:fs";
import {
  buildHistoricalStoryRecords,
  getHistoricalStoryResume,
} from "../lib/historicalStoryRecords.js";

describe("historical story records", () => {
  it("keeps all 137 Cao Cao storyData records alongside the mint biography", () => {
    const family = JSON.parse(
      fs.readFileSync(new URL("../data/persons/zh-cao-family.json", import.meta.url), "utf8"),
    );
    const person = family.members.find((member) => member.fullName === "曹操");
    expect(person.story).to.be.a("string").and.not.empty;
    const records = buildHistoricalStoryRecords(person);
    expect(records).to.have.length(137);
    expect(records).to.deep.equal(buildHistoricalStoryRecords({ storyData: person.storyData }));
    expect(records[0]).to.deep.equal({
      type: 1,
      title: "",
      content: person.storyData.summary[0],
      arrayIndex: 0,
      partIndex: 0,
    });
    expect(records.at(-1).type).to.equal(19);
    expect(records.every((record) => Buffer.byteLength(record.content, "utf8") <= 16_384)).to.equal(
      true,
    );
  });

  it("orders all fields from summary 1 to notes 19, retaining item positions and whitespace", () => {
    const records = buildHistoricalStoryRecords({
      story: "Biography",
      storyData: {
        notes: " Final note\r\n",
        summary: [" \r\n", "  Summary\r\n", null, "Second summary\t"],
        education: " School\n",
        unknown: "Not a known story field",
      },
    });
    expect(records).to.deep.equal([
      { type: 1, title: "", content: "  Summary\r\n", arrayIndex: 1, partIndex: 0 },
      { type: 1, title: "", content: "Second summary\t", arrayIndex: 3, partIndex: 0 },
      { type: 3, title: "", content: " School\n", arrayIndex: 0, partIndex: 0 },
      { type: 19, title: "", content: " Final note\r\n", arrayIndex: 0, partIndex: 0 },
    ]);
    expect(buildHistoricalStoryRecords({ story: "Biography only" })).to.deep.equal([]);
  });

  it("retains exact optional titles on every part and validates supplied titles", () => {
    const title = "  第一次远行 😀 e\u0301\n ";
    const content = "中".repeat(6_000);
    const records = buildHistoricalStoryRecords({
      storyData: { lifeEvents: [{ title, content }, { content: "Untitled entry" }] },
    });
    expect(records).to.have.length(3);
    expect(records.slice(0, 2).map((record) => record.title)).to.deep.equal([title, title]);
    expect(
      records
        .slice(0, 2)
        .map((record) => record.content)
        .join(""),
    ).to.equal(content);
    expect(records[2].title).to.equal("");
    for (const invalidTitle of [42, {}, "\ud800"]) {
      expect(() =>
        buildHistoricalStoryRecords({
          storyData: { summary: [{ title: invalidTitle, content: "Entry" }] },
        }),
      ).to.throw();
    }
  });

  it("splits at Unicode scalar boundaries and preserves the exact original text", () => {
    const content = `${"a".repeat(16_383)}😀\r\n ${"曹".repeat(6_000)}e\u0301\t`;
    const records = buildHistoricalStoryRecords({ storyData: { lifeEvents: [content] } });
    expect(records.map((record) => record.content).join("")).to.equal(content);
    expect(records[0].content).to.equal("a".repeat(16_383));
    expect(records[1].content.startsWith("😀\r\n ")).to.equal(true);
    expect(records.map((record) => record.partIndex)).to.deep.equal([0, 1, 2]);
    for (const record of records) {
      expect(record.type).to.equal(4);
      expect(record.arrayIndex).to.equal(0);
      expect(Buffer.byteLength(record.content, "utf8")).to.be.at.most(16_384);
      expect(Buffer.from(record.content, "utf8").toString("utf8")).to.equal(record.content);
    }
    expect(() => buildHistoricalStoryRecords({ storyData: { summary: "\ud800" } })).to.throw(
      "Invalid Unicode scalar",
    );
  });

  for (const biographyRecordCount of [0, 1]) {
    it(`resumes with ${biographyRecordCount} biography record without skipping or duplicating ordinary records`, () => {
      const records = buildHistoricalStoryRecords({ storyData: { summary: ["first", "second"] } });
      expect(
        getHistoricalStoryResume({
          totalRecords: biographyRecordCount,
          biographyRecordCount,
          records,
        }),
      ).to.deep.equal({
        existingRecords: 0,
        pendingRecords: records,
        nextRecordIndex: biographyRecordCount,
      });
      expect(
        getHistoricalStoryResume({
          totalRecords: biographyRecordCount + 1,
          biographyRecordCount,
          records,
        }),
      ).to.deep.equal({
        existingRecords: 1,
        pendingRecords: [records[1]],
        nextRecordIndex: biographyRecordCount + 1,
      });
      expect(
        getHistoricalStoryResume({
          totalRecords: BigInt(biographyRecordCount + 2),
          biographyRecordCount,
          records,
        }),
      ).to.deep.equal({
        existingRecords: 2,
        pendingRecords: [],
        nextRecordIndex: biographyRecordCount + 2,
      });
      expect(() =>
        getHistoricalStoryResume({
          totalRecords: biographyRecordCount + 3,
          biographyRecordCount,
          records,
        }),
      ).to.throw("more ordinary story records");
    });
  }

  it("rejects invalid Archive counts instead of silently skipping source data", () => {
    for (const totalRecords of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        getHistoricalStoryResume({ totalRecords, biographyRecordCount: 0, records: [] }),
      ).to.throw("nonnegative safe integer");
    }
    expect(() =>
      getHistoricalStoryResume({ totalRecords: 0, biographyRecordCount: 1, records: [] }),
    ).to.throw("smaller than the biography");
    expect(() =>
      getHistoricalStoryResume({ totalRecords: 2, biographyRecordCount: 2, records: [] }),
    ).to.throw("must be 0 or 1");
  });
});
