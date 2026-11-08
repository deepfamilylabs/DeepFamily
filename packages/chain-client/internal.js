export const sameHex = (left, right) =>
  typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();

/** Foreign errors can expose throwing accessors; public inspection reads only data properties. */
export function ownValue(value, key) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return undefined;
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
}

/** A wallet may fail its own gas estimate before accepting a send request. */
export function operationForFailure(error, operation) {
  return operation === "submit" && ownValue(error, "action") === "estimateGas" ? "estimate" : operation;
}
