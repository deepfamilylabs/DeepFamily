import { describe, expect, it } from "vitest";
import { decodeBudgetRule, encodeBudgetRule } from "./budgetRule";

const fields = {
  chainId: "31337",
  poolAddress: "0x0000000000000000000000000000000000004321",
  familyCommitment: "11",
  parentVersion: "1",
  rate: "10",
  periodDays: "30",
  policySalt: "12",
  allocationKeyCommitment: "13",
};
const encode = (value: unknown) =>
  `dfpolicy.${btoa(JSON.stringify(value)).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "")}`;

describe("budget rule text", () => {
  it("reads back the scope and schedule it was created with", () => {
    expect(decodeBudgetRule(` ${encodeBudgetRule(fields)}\n`)).toEqual({
      chainId: "31337",
      poolAddress: fields.poolAddress,
      policy: {
        familyCommitment: 11n,
        parentVersion: 1n,
        rate: 10n,
        periodDays: 30n,
        policySalt: 12n,
        allocationKeyCommitment: 13n,
      },
    });
  });

  it.each([
    ["another prefix", "dfrecv.abc"],
    ["text that is not JSON", "dfpolicy.not-json"],
    ["a missing pool", encode({ ...fields, poolAddress: undefined })],
    ["a zero rate", encode({ ...fields, rate: "0" })],
    ["a non-canonical number", encode({ ...fields, periodDays: "030" })],
    ["a numeric field", encode({ ...fields, policySalt: 12 })],
  ])("rejects %s", (_name, text) => {
    expect(() => decodeBudgetRule(text)).toThrow("Invalid receiving budget rule");
  });
});
