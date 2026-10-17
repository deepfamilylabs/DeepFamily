import assert from "node:assert/strict";

/** Missing inputs and runtime errors must never count as rejected circuit constraints. */
export async function assertConstraintViolation(calculateWitness) {
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(calculateWitness, /Assert Failed\./u);
  } finally {
    console.error = originalError;
  }
}
