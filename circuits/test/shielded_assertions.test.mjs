import assert from "node:assert/strict";
import test from "node:test";
import { assertConstraintViolation } from "./constraint_assertions.mjs";

test("negative circuit checks require a constraint assertion", async (t) => {
  await t.test("accepts a Circom constraint failure", async () => {
    await assertConstraintViolation(async () => {
      throw new Error("Error: Assert Failed. Error in template Num2Bits_0 line: 38");
    });
  });
  for (const message of [
    "Not enough values for input signal outputNonces",
    "Too many values for input signal unexpected",
    "RuntimeError: memory access out of bounds",
  ]) {
    await t.test(`fails on ${message}`, async () => {
      await assert.rejects(
        () =>
          assertConstraintViolation(async () => {
            throw new Error(message);
          }),
        { code: "ERR_ASSERTION" },
      );
    });
  }
  await t.test("fails if the invalid witness is accepted", async () => {
    await assert.rejects(() => assertConstraintViolation(async () => {}), {
      code: "ERR_ASSERTION",
    });
  });
});
